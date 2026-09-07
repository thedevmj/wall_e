package com.wall_e.bridge

import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.opengl.EGL14
import android.opengl.EGLExt
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.util.Log
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Rotates a video file once using the device's hardware codecs (decode with
 * MediaCodec, rotate with a GLES2 pass, re-encode to H.264, mux). The output
 * can then be played through the plain direct-surface path with rotation = 0,
 * so rotation is reliable on every device instead of relying on an exotic
 * runtime renderer.
 */
object VideoRotationProcessor {
    private const val TAG = "VideoRotationProcessor"
    private const val TIMEOUT_USEC = 10_000L
    private const val ABORT_MS = 90_000L
    private const val EGL_OPENGL_ES2_BIT = 4
    private const val EGL_RECORDABLE_ANDROID = 0x3142

    private val QUAD_VERTS = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)

    private const val VERTEX_SHADER = """
        attribute vec4 aPosition;
        uniform mat4 uSTMatrix;
        uniform mat4 uMvp;
        varying vec2 vTexCoord;
        void main() {
            gl_Position = uMvp * aPosition;
            vec4 p = vec4(aPosition.xy * 0.5 + vec2(0.5), 0.0, 1.0);
            vTexCoord = (uSTMatrix * p).xy;
        }
    """

    private const val FRAGMENT_SHADER = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;
        uniform samplerExternalOES uTexture;
        varying vec2 vTexCoord;
        void main() {
            gl_FragColor = texture2D(uTexture, vTexCoord);
        }
    """

    /**
     * @return true when the rotated file was written to [dstPath].
     * Never throws; any device error returns false.
     */
    fun transcode(srcPath: String, dstPath: String, rotationDeg: Int): Boolean {
        val rotation = ((rotationDeg % 360) + 360) % 360
        if (rotation <= 0) return false

        var extractor: MediaExtractor? = null
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var muxer: MediaMuxer? = null
        var encoderInputSurface: Surface? = null
        var decoderOutputSurface: Surface? = null
        var texture: SurfaceTexture? = null
        var eglDisplay: android.opengl.EGLDisplay? = null
        var eglContext: android.opengl.EGLContext? = null
        var eglSurface: android.opengl.EGLSurface? = null
        var program = 0
        var textureId = 0
        var success = false

        try {
            // --- source track ---
            extractor = MediaExtractor()
            extractor.setDataSource(srcPath)
            var videoTrack = -1
            var sourceFormat: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/")) {
                    videoTrack = i
                    sourceFormat = f
                    break
                }
            }
            if (videoTrack < 0 || sourceFormat == null) {
                Log.e(TAG, "No video track found in $srcPath")
                return false
            }
            extractor.selectTrack(videoTrack)

            val sourceMime = sourceFormat.getString(MediaFormat.KEY_MIME)!!
            val sourceWidth = try { sourceFormat.getInteger(MediaFormat.KEY_WIDTH) } catch (_: Exception) { 0 }
            val sourceHeight = try { sourceFormat.getInteger(MediaFormat.KEY_HEIGHT) } catch (_: Exception) { 0 }
            if (sourceWidth <= 0 || sourceHeight <= 0) {
                Log.e(TAG, "Invalid source dims ${sourceWidth}x${sourceHeight}")
                return false
            }
            val sourceRotation = if (sourceFormat.containsKey(MediaFormat.KEY_ROTATION)) {
                try { sourceFormat.getInteger(MediaFormat.KEY_ROTATION) } catch (_: Exception) { 0 }
            } else {
                0
            }
            val totalRotation = ((sourceRotation + rotation) % 360 + 360) % 360
            val sourceFps = try {
                sourceFormat.getInteger(MediaFormat.KEY_FRAME_RATE)
            } catch (_: Exception) {
                try { sourceFormat.getFloat(MediaFormat.KEY_FRAME_RATE).roundToInt() } catch (_: Exception) { 30 }
            }.coerceIn(1, 30)

            val rotatedWidth = if (totalRotation % 180 == 0) sourceWidth else sourceHeight
            val rotatedHeight = if (totalRotation % 180 == 0) sourceHeight else sourceWidth
            val outWidth = ((rotatedWidth + 1) / 2).coerceAtLeast(1) * 2
            val outHeight = ((rotatedHeight + 1) / 2).coerceAtLeast(1) * 2
            // Use a near-lossless bitrate keyed to the output resolution so the
            // rotated wallpaper keeps the original quality instead of being
            // visibly re-compressed.
            val pixelsPerSecond = outWidth.toLong() * outHeight * sourceFps
            val bitRate = (pixelsPerSecond / 60L).coerceIn(4_000_000L, 40_000_000L).toInt()

            Log.i(
                TAG,
                "Transcode: src=${srcPath} ${sourceWidth}x${sourceHeight} fps=$sourceFps rotation=${rotation} totalRotation=$totalRotation -> dst=${dstPath} ${outWidth}x${outHeight} bitrate=$bitRate",
            )

            // --- EGL (offscreen, recordable for encoder input surface) ---
            eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            if (eglDisplay === EGL14.EGL_NO_DISPLAY) throw IllegalStateException("EGL_NO_DISPLAY")
            val eglVersion = IntArray(2)
            if (!EGL14.eglInitialize(eglDisplay, eglVersion, 0, eglVersion, 1)) {
                throw IllegalStateException("eglInitialize failed ${EGL14.eglGetError()}")
            }
            val config = chooseConfig(eglDisplay) ?: throw IllegalStateException("no EGL config ${EGL14.eglGetError()}")
            eglContext = EGL14.eglCreateContext(
                eglDisplay,
                config,
                EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE),
                0,
            )
            if (eglContext === EGL14.EGL_NO_CONTEXT) throw IllegalStateException("eglCreateContext failed ${EGL14.eglGetError()}")

            // --- encoder ---
            val encoderFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, outWidth, outHeight)
            encoderFormat.setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
            )
            encoderFormat.setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            encoderFormat.setInteger(MediaFormat.KEY_FRAME_RATE, sourceFps)
            encoderFormat.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            encoderFormat.setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
            // Baseline-profile H.264 is the safest output for device decoders
            // that ship a broken/limited AVC-decoder advertisement (e.g. some
            // budget MediaTek/Redmi devices): Android guarantees every device
            // can decode Baseline, while High-profile streams are optional.
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            encoder.configure(encoderFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoderInputSurface = encoder.createInputSurface()
            encoder.start()

            // --- EGL window surface from the encoder input surface ---
            eglSurface = EGL14.eglCreateWindowSurface(eglDisplay!!, config, encoderInputSurface, null, 0)
            if (eglSurface === EGL14.EGL_NO_SURFACE) {
                throw IllegalStateException("eglCreateWindowSurface failed ${EGL14.eglGetError()}")
            }
            EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)
            program = buildProgram()
            if (program == 0) throw IllegalStateException("program link failed")
            val texId = IntArray(1)
            GLES20.glGenTextures(1, texId, 0)
            textureId = texId[0]
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

            texture = SurfaceTexture(textureId)
            texture.setDefaultBufferSize(if (totalRotation % 180 == 0) sourceWidth else sourceHeight, if (totalRotation % 180 == 0) sourceHeight else sourceWidth)
            decoderOutputSurface = Surface(texture)

            // --- decoder ---
            decoder = MediaCodec.createDecoderByType(sourceMime)
            decoder.configure(sourceFormat, decoderOutputSurface, null, 0)
            decoder.start()

            // --- muxer ---
            muxer = MediaMuxer(dstPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val dec: MediaCodec = decoder ?: return false
            val enc: MediaCodec = encoder ?: return false
            val mux: MediaMuxer = muxer ?: return false
            val ex: MediaExtractor = extractor ?: return false
            var muxerTrack = -1
            var muxerStarted = false

            val stMatrix = FloatArray(16)
            val vertexBuffer: FloatBuffer = ByteBuffer
                .allocateDirect(QUAD_VERTS.size * 4)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer()
                .apply { put(QUAD_VERTS); position(0) }
            val mvpLoc = GLES20.glGetUniformLocation(program, "uMvp")
            val stLoc = GLES20.glGetUniformLocation(program, "uSTMatrix")
            val texLoc = GLES20.glGetUniformLocation(program, "uTexture")
            var frameAvailable = false
            texture.setOnFrameAvailableListener({ frameAvailable = true })

            var pendingPtsUs: Long? = null
            var inputDone = false
            var decoderDone = false
            var encoderDone = false
            var encoderEosSent = false
            val startedAt = System.currentTimeMillis()
            var lastDecodedAt = startedAt

            fun present() {
                val pts = pendingPtsUs ?: return
                texture?.updateTexImage()
                texture?.getTransformMatrix(stMatrix)
                GLES20.glViewport(0, 0, outWidth, outHeight)
                GLES20.glClearColor(0f, 0f, 0f, 1f)
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                GLES20.glUseProgram(program)
                vertexBuffer.position(0)
                GLES20.glEnableVertexAttribArray(0)
                GLES20.glVertexAttribPointer(0, 2, GLES20.GL_FLOAT, false, 8, vertexBuffer)
                GLES20.glUniformMatrix4fv(mvpLoc, 1, false, computeMvp(outWidth, outHeight, totalRotation, sourceWidth, sourceHeight), 0)
                GLES20.glUniformMatrix4fv(stLoc, 1, false, stMatrix, 0)
                GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
                GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
                GLES20.glUniform1i(texLoc, 0)
                GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
                GLES20.glDisableVertexAttribArray(0)
                EGLExt.eglPresentationTimeANDROID(eglDisplay!!, eglSurface!!, pts * 1000L)
                EGL14.eglSwapBuffers(eglDisplay!!, eglSurface!!)
                lastDecodedAt = System.currentTimeMillis()
            }

            while (!encoderDone) {
                val now = System.currentTimeMillis()
                if (now - lastDecodedAt > 10_000L && !decoderDone) {
                    Log.e(TAG, "Transcode stalled (no decoded frames); aborting")
                    return false
                }
                if (now - startedAt > ABORT_MS) {
                    Log.e(TAG, "Transcode deadline exceeded; aborting")
                    return false
                }

                var worked = false

// feed decoder
                if (!inputDone) {
                    val inIdx = dec.dequeueInputBuffer(TIMEOUT_USEC)
                    if (inIdx >= 0) {
                        val sampleTime = ex.sampleTime
                        if (sampleTime == -1L) {
                            dec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                            worked = true
                        } else {
                            val buf = dec.getInputBuffer(inIdx)!!
                            val size = ex.readSampleData(buf, 0)
                            if (size < 0) {
                                dec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                inputDone = true
                            } else {
                                dec.queueInputBuffer(inIdx, 0, size, sampleTime, 0)
                                ex.advance()
                            }
                            worked = true
                        }
                    }
                }

                // drain one decoder buffer
                val outInfo = MediaCodec.BufferInfo()
                var outIdx = dec.dequeueOutputBuffer(outInfo, 0)
                when (outIdx) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> {}
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {}
                    else -> {
                        if (outIdx >= 0) {
                            if (outInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                decoderDone = true
                                dec.releaseOutputBuffer(outIdx, false)
                            } else {
                                pendingPtsUs = outInfo.presentationTimeUs
                                dec.releaseOutputBuffer(outIdx, true)
                            }
                            worked = true
                            lastDecodedAt = System.currentTimeMillis()
                        }
                    }
                }

                // present the latest decoded frame
                if (frameAvailable && pendingPtsUs != null) {
                    frameAvailable = false
                    present()
                    pendingPtsUs = null
                }
                if (decoderDone && !encoderEosSent) {
                    if (frameAvailable && pendingPtsUs != null) {
                        frameAvailable = false
                        present()
                        pendingPtsUs = null
                    }
                    enc.signalEndOfInputStream()
                    encoderEosSent = true
                    worked = true
                }

                // drain encoder
                val encInfo = MediaCodec.BufferInfo()
                var encIdx = enc.dequeueOutputBuffer(encInfo, 0)
                when (encIdx) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> {}
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        if (!muxerStarted) {
                            muxerTrack = mux.addTrack(enc.outputFormat)
                            mux.start()
                            muxerStarted = true
                        }
                    }
                    else -> {
                        if (encIdx >= 0) {
                            if (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                                enc.releaseOutputBuffer(encIdx, false)
                            } else if (encInfo.size > 0 && muxerStarted) {
                                mux.writeSampleData(muxerTrack, enc.getOutputBuffer(encIdx)!!, encInfo)
                                enc.releaseOutputBuffer(encIdx, false)
                            } else {
                                enc.releaseOutputBuffer(encIdx, false)
                            }
                            if (encInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                encoderDone = true
                            }
                            worked = true
                        }
                    }
                }

                if (!worked) {
                    Thread.sleep(2)
                }
            }

            success = muxerStarted
            Log.i(TAG, "Transcode finished: dst=${dstPath} success=$success")
        } catch (error: Throwable) {
            Log.e(TAG, "Transcode failed for $srcPath", error)
            success = false
        } finally {
            try { muxer?.stop() } catch (_: Exception) {}
            try { muxer?.release() } catch (_: Exception) {}
            try {
                if (decoder != null) {
                    try { decoder.stop() } catch (_: Exception) {}
                    try { decoder.release() } catch (_: Exception) {}
                }
            } catch (_: Exception) {}
            try {
                if (encoder != null) {
                    try { encoder.stop() } catch (_: Exception) {}
                    try { encoder.release() } catch (_: Exception) {}
                }
            } catch (_: Exception) {}
            try { decoderOutputSurface?.release() } catch (_: Exception) {}
            try { texture?.release() } catch (_: Exception) {}
            try { extractor?.release() } catch (_: Exception) {}
            try {
                val display = eglDisplay
                if (display != null) {
                    EGL14.eglMakeCurrent(display, eglSurface, eglSurface, eglContext)
                    if (textureId != 0) {
                        GLES20.glDeleteTextures(1, intArrayOf(textureId), 0)
                        textureId = 0
                    }
                    if (program != 0) {
                        GLES20.glDeleteProgram(program)
                        program = 0
                    }
                    eglSurface?.let { EGL14.eglDestroySurface(display, it) }
                    eglContext?.let { EGL14.eglDestroyContext(display, it) }
                    EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                    EGL14.eglTerminate(display)
                }
            } catch (_: Exception) {}
            try { encoderInputSurface?.release() } catch (_: Exception) {}
            if (!success) {
                try { java.io.File(dstPath).delete() } catch (_: Exception) {}
            }
        }
        return success
    }

    private fun chooseConfig(display: android.opengl.EGLDisplay): android.opengl.EGLConfig? {
        val recordable = tryConfig(display, recordable = true)
        if (recordable != null) return recordable
        return tryConfig(display, recordable = false)
    }

    private fun tryConfig(display: android.opengl.EGLDisplay, recordable: Boolean): android.opengl.EGLConfig? {
        val attribs = if (recordable) {
            intArrayOf(
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
                EGL_RECORDABLE_ANDROID, 1,
                EGL14.EGL_NONE,
            )
        } else {
            intArrayOf(
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
                EGL14.EGL_NONE,
            )
        }
        val configs = arrayOfNulls<android.opengl.EGLConfig>(1)
        val numConfigs = IntArray(1)
        if (!EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, numConfigs, 0) || numConfigs[0] == 0) {
            return null
        }
        return configs[0]
    }

    private fun buildProgram(): Int {
        val vs = compileShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
        val fs = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
        if (vs == 0 || fs == 0) return 0
        val program = GLES20.glCreateProgram()
        if (program == 0) return 0
        GLES20.glAttachShader(program, vs)
        GLES20.glAttachShader(program, fs)
        GLES20.glLinkProgram(program)
        GLES20.glDeleteShader(vs)
        GLES20.glDeleteShader(fs)
        val linkStatus = IntArray(1)
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linkStatus, 0)
        if (linkStatus[0] == 0) {
            Log.e(TAG, "Program link failed: ${GLES20.glGetProgramInfoLog(program)}")
            GLES20.glDeleteProgram(program)
            return 0
        }
        return program
    }

    private fun compileShader(type: Int, source: String): Int {
        val shader = GLES20.glCreateShader(type)
        if (shader == 0) return 0
        GLES20.glShaderSource(shader, source)
        GLES20.glCompileShader(shader)
        val compiled = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0)
        if (compiled[0] == 0) {
            Log.e(TAG, "Shader compile failed: ${GLES20.glGetShaderInfoLog(shader)}")
            GLES20.glDeleteShader(shader)
            return 0
        }
        return shader
    }

    private fun computeMvp(surfaceWidth: Int, surfaceHeight: Int, rotationDeg: Int, videoWidth: Int, videoHeight: Int): FloatArray {
        val angle = Math.toRadians(-rotationDeg.toDouble()).toFloat()
        val cosA = cos(angle)
        val sinA = sin(angle)

        val rotatedWidth = if (rotationDeg % 180 == 0) videoWidth else videoHeight
        val rotatedHeight = if (rotationDeg % 180 == 0) videoHeight else videoWidth
        val scale = maxOf(
            surfaceWidth.toFloat() / rotatedWidth.coerceAtLeast(1),
            surfaceHeight.toFloat() / rotatedHeight.coerceAtLeast(1),
        )
        val quadWidth = (rotatedWidth * scale) / surfaceWidth
        val quadHeight = (rotatedHeight * scale) / surfaceHeight

        val scaleMat = floatArrayOf(
            quadWidth, 0f, 0f, 0f,
            0f, quadHeight, 0f, 0f,
            0f, 0f, 1f, 0f,
            0f, 0f, 0f, 1f,
        )
        val rotateMat = floatArrayOf(
            cosA, -sinA, 0f, 0f,
            sinA, cosA, 0f, 0f,
            0f, 0f, 1f, 0f,
            0f, 0f, 0f, 1f,
        )
        val result = FloatArray(16)
        for (col in 0 until 4) {
            for (row in 0 until 4) {
                var sum = 0f
                for (k in 0 until 4) {
                    sum += rotateMat[k * 4 + row] * scaleMat[col * 4 + k]
                }
                result[col * 4 + row] = sum
            }
        }
        return result
    }
}