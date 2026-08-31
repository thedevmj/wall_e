package com.wall_e.wallpaper

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/**
 * Renders an external (SurfaceTexture) video stream onto the wallpaper surface
 * with an EGL window surface and a GLES2 textured quad. The video is scaled to
 * cover the full screen and centered, and it is rotated on the GPU, so rotated
 * playback (0/90/180/270 degrees) stays smooth and lossless.
 */
class VideoGlRenderer(
    private val outputSurface: Surface,
    initialWidth: Int,
    initialHeight: Int,
    private val rotationDegrees: Int,
) {
    companion object {
        private const val TAG = "VideoGlRenderer"
        private const val EGL_OPENGL_ES2_BIT = 4
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
            uniform float uFade;
            varying vec2 vTexCoord;
            void main() {
                vec4 c = texture2D(uTexture, vTexCoord);
                gl_FragColor = vec4(c.rgb * (1.0 - uFade), 1.0);
            }
        """
    }

    private var eglDisplay: EGLDisplay? = null
    private var eglContext: EGLContext? = null
    private var eglSurface: EGLSurface? = null
    private var program = 0
    private var textureId = 0
    private var uniformMvpLoc = -1
    private var uniformStLoc = -1
    private var uniformTextureLoc = -1
    private var uniformFadeLoc = -1

    private var surfaceWidth = max(initialWidth, 1)
    private var surfaceHeight = max(initialHeight, 1)
    private var videoWidth = 0
    private var videoHeight = 0
    private var released = false

    private val transformMatrix = FloatArray(16)

    @Volatile
    private var frameAvailable = false

    @Volatile
    private var fadeAlpha = 0f

    @Volatile
    private var hasFrame = false

    var framesRendered = 0
        private set
    var hasError = false
        private set

    var surfaceTexture: SurfaceTexture? = null
        private set

    private var videoSurface: Surface? = null

    private val vertexBuffer: FloatBuffer = ByteBuffer
        .allocateDirect(QUAD_VERTS.size * 4)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()
        .apply {
            put(QUAD_VERTS)
            position(0)
        }

    init {
        try {
            initEgl()
        } catch (e: Throwable) {
            Log.e(TAG, "GL init failed", e)
            hasError = true
            release()
        }
    }

    fun videoSurfaceForPlayer(): Surface? = videoSurface

    fun setVideoSize(width: Int, height: Int) {
        if (width > 0 && height > 0) {
            videoWidth = width
            videoHeight = height
        }
    }

    /** Set the black-fade blend (0..1) applied on top of the video each frame. */
    fun setFadeAlpha(alpha: Float) {
        fadeAlpha = alpha.coerceIn(0f, 1f)
    }

    fun updateSurfaceSize(width: Int, height: Int) {
        surfaceWidth = max(width, 1)
        surfaceHeight = max(height, 1)
        if (eglDisplay == null || eglSurface == null) return
        try {
            if (!eglMakeCurrent()) return
            GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
        } catch (e: Throwable) {
            Log.e(TAG, "updateSurfaceSize error", e)
            hasError = true
        }
    }

    fun render(): Boolean {
        if (hasError || released) return false
        val texture = surfaceTexture ?: return false
        val newFrame = frameAvailable
        // Draw when a fresh frame arrives, or when a fade is active so the black
        // blend keeps progressing even while ExoPlayer is paused on a static frame.
        if (!newFrame && fadeAlpha <= 0f) return false
        frameAvailable = false
        try {
            if (!eglMakeCurrent()) {
                hasError = true
                return false
            }
            if (newFrame || !hasFrame) {
                texture.updateTexImage()
                texture.getTransformMatrix(transformMatrix)
                hasFrame = true
            }
            drawFrame(transformMatrix)
            eglSwapBuffers()
            framesRendered++
            return true
        } catch (e: Throwable) {
            Log.e(TAG, "render error", e)
            hasError = true
            return false
        }
    }

    private fun initEgl() {
        val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        if (display === EGL14.EGL_NO_DISPLAY) throw IllegalStateException("No EGL display (${EGL14.eglGetError()})")

        val major = IntArray(1)
        val minor = IntArray(1)
        if (!EGL14.eglInitialize(display, major, 0, minor, 0)) {
            throw IllegalStateException("eglInitialize failed ${EGL14.eglGetError()}")
        }
        eglDisplay = display

        val config = chooseConfig(display) ?: throw IllegalStateException("No matching EGL config ${EGL14.eglGetError()}")

        val context = EGL14.eglCreateContext(
            display,
            config,
            EGL14.EGL_NO_CONTEXT,
            intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE),
            0,
        )
        if (context === EGL14.EGL_NO_CONTEXT || EGL14.eglGetError() != EGL14.EGL_SUCCESS) {
            throw IllegalStateException("eglCreateContext failed ${EGL14.eglGetError()}")
        }
        eglContext = context

        val surface = EGL14.eglCreateWindowSurface(display, config, outputSurface, null, 0)
        if (surface === EGL14.EGL_NO_SURFACE || EGL14.eglGetError() != EGL14.EGL_SUCCESS) {
            throw IllegalStateException("eglCreateWindowSurface failed ${EGL14.eglGetError()}")
        }
        eglSurface = surface

        if (!eglMakeCurrent()) throw IllegalStateException("eglMakeCurrent failed")

        GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)

        program = buildProgram()
        if (program == 0) throw IllegalStateException("Shader program link failed")

        uniformMvpLoc = GLES20.glGetUniformLocation(program, "uMvp")
        uniformStLoc = GLES20.glGetUniformLocation(program, "uSTMatrix")
        uniformTextureLoc = GLES20.glGetUniformLocation(program, "uTexture")
        uniformFadeLoc = GLES20.glGetUniformLocation(program, "uFade")

        val texIds = IntArray(1)
        GLES20.glGenTextures(1, texIds, 0)
        textureId = texIds[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        val texture = SurfaceTexture(textureId)
        texture.setOnFrameAvailableListener({ frameAvailable = true }, Handler(Looper.getMainLooper()))
        surfaceTexture = texture
        videoSurface = Surface(texture)
    }

    private fun chooseConfig(display: EGLDisplay): EGLConfig? {
        val attribs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
            EGL14.EGL_NONE,
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val numConfigs = IntArray(1)
        if (!EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, numConfigs, 0) || numConfigs[0] == 0) {
            return null
        }
        return configs[0]
    }

    private fun buildProgram(): Int {
        val vertex = compileShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER)
        val fragment = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER)
        if (vertex == 0 || fragment == 0) return 0
        val programHandle = GLES20.glCreateProgram()
        if (programHandle == 0) return 0
        GLES20.glAttachShader(programHandle, vertex)
        GLES20.glAttachShader(programHandle, fragment)
        GLES20.glLinkProgram(programHandle)
        GLES20.glDeleteShader(vertex)
        GLES20.glDeleteShader(fragment)
        val linkStatus = IntArray(1)
        GLES20.glGetProgramiv(programHandle, GLES20.GL_LINK_STATUS, linkStatus, 0)
        if (linkStatus[0] == 0) {
            Log.e(TAG, "Program link failed: ${GLES20.glGetProgramInfoLog(programHandle)}")
            GLES20.glDeleteProgram(programHandle)
            return 0
        }
        return programHandle
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

    private fun drawFrame(transform: FloatArray) {
        GLES20.glViewport(0, 0, surfaceWidth, surfaceHeight)
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)

        GLES20.glUseProgram(program)

        vertexBuffer.position(0)
        GLES20.glEnableVertexAttribArray(0)
        GLES20.glVertexAttribPointer(0, 2, GLES20.GL_FLOAT, false, 8, vertexBuffer)

        GLES20.glUniformMatrix4fv(uniformMvpLoc, 1, false, computeMvp(), 0)
        GLES20.glUniformMatrix4fv(uniformStLoc, 1, false, transform, 0)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glUniform1i(uniformTextureLoc, 0)
        GLES20.glUniform1f(uniformFadeLoc, fadeAlpha)

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(0)
    }

    private fun computeMvp(): FloatArray {
        val angle = Math.toRadians(-rotationDegrees.toDouble()).toFloat()
        val cosA = cos(angle)
        val sinA = sin(angle)

        val sourceWidth = if (videoWidth > 0) videoWidth else surfaceWidth
        val sourceHeight = if (videoHeight > 0) videoHeight else surfaceHeight
        val rotatedWidth = if (rotationDegrees % 180 == 0) sourceWidth else sourceHeight
        val rotatedHeight = if (rotationDegrees % 180 == 0) sourceHeight else sourceWidth

        // Cover: scale up until the whole screen is filled, then center (crop overflow).
        val scale = max(
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
        return multiply(rotateMat, scaleMat)
    }

    private fun multiply(a: FloatArray, b: FloatArray): FloatArray {
        val result = FloatArray(16)
        for (col in 0 until 4) {
            for (row in 0 until 4) {
                var sum = 0f
                for (k in 0 until 4) {
                    sum += a[k * 4 + row] * b[col * 4 + k]
                }
                result[col * 4 + row] = sum
            }
        }
        return result
    }

    private fun eglMakeCurrent(): Boolean {
        val display = eglDisplay ?: return false
        val surface = eglSurface ?: return false
        return try {
            EGL14.eglMakeCurrent(display, surface, surface, eglContext)
        } catch (e: Throwable) {
            Log.e(TAG, "eglMakeCurrent error", e)
            false
        }
    }

    private fun eglSwapBuffers() {
        val display = eglDisplay ?: return
        val surface = eglSurface ?: return
        EGL14.eglSwapBuffers(display, surface)
    }

    fun release() {
        if (released) return
        released = true
        try {
            val display = eglDisplay
            if (display != null) {
                try {
                    EGL14.eglMakeCurrent(display, eglSurface, eglSurface, eglContext)
                } catch (_: Throwable) {
                    // best-effort
                }
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
        } catch (e: Throwable) {
            Log.e(TAG, "release error", e)
        } finally {
            videoSurface?.release()
            videoSurface = null
            surfaceTexture?.release()
            surfaceTexture = null
            eglDisplay = null
            eglContext = null
            eglSurface = null
        }
    }
}