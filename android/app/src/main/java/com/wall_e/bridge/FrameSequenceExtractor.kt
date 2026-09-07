package com.wall_e.bridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Extracts a video file into a directory of small JPEG frames plus a manifest,
 * using a pure software/CPU decode-to-buffer pipeline that never touches a GPU
 * surface. This is the backbone of the self-owned software playback path: the
 * wallpaper service can replay a wallpaper from cheap JPEGs even on devices
 * whose hardware (or Media3) AVC decoder cannot initialize for the wallpaper
 * surface at all.
 *
 * Supported sources: any stream MediaCodec can decode (H.264 / Baseline+High,
 * H.265, VP8/VP9 on capable devices). Frames are emitted at the source rate,
 * capped at MAX_FPS (120), so 24/30/60/90/120 fps videos all stay buttery.
 * Output JPEGs are scaled down to max SQ_HEIGHT so a long clip still fits the
 * storage quota.
 */
object FrameSequenceExtractor {
    private const val TAG = "FrameSequenceExtractor"
    private const val MAX_FPS = 120
    private const val MAX_OUTPUT_DIMENSION = 1280
    private const val JPEG_QUALITY = 68
    private const val TIMEOUT_USEC = 10_000L
    private const val MAX_SECONDS_EXTRACTED = 300L

    const val MANIFEST_NAME = "manifest.json"
    const val FRAME_PREFIX = "frame_"

    /**
     * Writes a frame sequence for [srcPath] into [dirPath] (created if missing)
     * and returns a summary. Throws on unrecoverable failure; a partially
     * extracted (but non-empty) sequence is returned normally so playback has
     * something to show even when a clipped source is cut short.
     */
    fun extract(
        context: Context,
        srcPath: String,
        dirPath: String,
        maxDimension: Int = MAX_OUTPUT_DIMENSION,
        maxFps: Int = MAX_FPS,
    ): FrameSequenceInfo {
        val dir = File(dirPath).apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }

        var retriever: MediaMetadataRetriever? = null
        var extractor: MediaExtractor? = null
        var codec: MediaCodec? = null
        var softwareAttempt = false
        try {
            retriever = MediaMetadataRetriever()
            retriever.setDataSource(srcPath)
            val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull() ?: 0L
            val sourceRotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                ?.toIntOrNull() ?: 0
            val sourceWidth = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
                ?.toIntOrNull() ?: 1280
            val sourceHeight = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
                ?.toIntOrNull() ?: 720

            if (durationMs <= 0L) throw IllegalStateException("Video has no readable duration")

            extractor = MediaExtractor()
            extractor.setDataSource(srcPath)
            var videoTrack = -1
            var videoFormat: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                if (f.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) {
                    videoTrack = i
                    videoFormat = f
                    break
                }
            }
            if (videoTrack < 0 || videoFormat == null) {
                throw IllegalStateException("No video track in the selected file")
            }
            val mime = videoFormat.getString(MediaFormat.KEY_MIME)!!

            var codecName: String? = "default"
            try {
                codec = MediaCodec.createDecoderByType(mime)
                codec.configure(videoFormat, null, null, 0)
                codec.start()
            } catch (e: Exception) {
                Log.w(TAG, "Default decoder failed ($mime); trying software decoder", e)
                softwareAttempt = true
                codec?.release()
                codec = createSoftwareDecoder(mime)
                codec.configure(videoFormat, null, null, 0)
                codec.start()
                codecName = codec.name
            }
            Log.i(
                TAG,
                "Extracting to ${dir.absolutePath} with codec=$codecName src=${srcPath} src=${sourceWidth}x$sourceHeight dur=${durationMs}ms rot=$sourceRotation",
            )

            extractor.selectTrack(videoTrack)

            val outputDimension = minOf(maxDimension, maxOf(sourceWidth, sourceHeight))
            val scaleToTarget = sourceWidth > outputDimension || sourceHeight > outputDimension

            val acceptedPtsUs = ArrayList<Long>()
            var inputDone = false
            var outputDone = false
            var frameIndex = 0
            var lastAcceptedPtsUs = -1L
            val minStepUs =
                if (maxFps > 0) 1_000_000L / maxFps else 1L
            val startedAt = System.currentTimeMillis()

            // Feed whole input (decoders can buffer internally), then drain output.
            while (!outputDone) {
                if (System.currentTimeMillis() - startedAt > 10 * 60_000L) {
                    Log.w(TAG, "Extraction deadline exceeded; keeping partial sequence")
                    break
                }

                // Feed input.
                var fed = false
                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(TIMEOUT_USEC)
                    if (inIdx >= 0) {
                        val sampleTime = extractor.sampleTime
                        if (sampleTime < 0L) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            val buf = codec.getInputBuffer(inIdx)!!
                            val size = extractor.readSampleData(buf, 0)
                            codec.queueInputBuffer(inIdx, 0, size, sampleTime, 0)
                            extractor.advance()
                        }
                        fed = true
                    }
                }

                // Drain output.
                val info = MediaCodec.BufferInfo()
                var outIdx = codec.dequeueOutputBuffer(info, 0)
                when (outIdx) {
                    MediaCodec.INFO_TRY_AGAIN_LATER -> {}
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {}
                    MediaCodec.INFO_OUTPUT_BUFFERS_CHANGED -> {}
                    else -> {
                        if (outIdx >= 0) {
                            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                                codec.releaseOutputBuffer(outIdx, false)
                            } else if (info.size > 0) {
                                val ptsUs = info.presentationTimeUs
                                // Cap effective output at maxFps and drop duplicates.
                                val accept =
                                    lastAcceptedPtsUs < 0 || (ptsUs - lastAcceptedPtsUs) >= minStepUs
                                if (accept) {
                                    val frame = frameBitmap(codec, outIdx)
                                    if (frame != null) {
                                        val rotated =
                                            if (sourceRotation != 0) rotate(frame, sourceRotation) else frame
                                        val toWrite = if (scaleToTarget) scale(rotated, outputDimension) else rotated
                                        val file = File(dir, String.format("%s%06d.jpg", FRAME_PREFIX, frameIndex))
                                        toWrite.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, file.outputStream())
                                        frameIndex++
                                        lastAcceptedPtsUs = ptsUs
                                        acceptedPtsUs.add(ptsUs)
                                        if (toWrite !== rotated) rotated.recycle()
                                        if (toWrite !== frame) toWrite.recycle()
                                        if (frame !== rotated) frame.recycle()
                                    }
                                }
                            }
                            codec.releaseOutputBuffer(outIdx, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                outputDone = true
                            }
                        }
                    }
                }

                if (!fed && outIdx == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    // Give the codec a moment to complete partial drain cycles.
                    try { Thread.sleep(2) } catch (_: InterruptedException) {}
                }
            }

            val frames = frameIndex
            if (frames == 0) throw IllegalStateException("Decoder produced no frames")

            val fps = estimateFps(acceptedPtsUs, durationMs)
            val manifest = JSONObject().apply {
                put("fps", fps)
                put("frames", frames)
                put("width", minOf(outputDimension, sourceWidth))
                put("height", minOf(outputDimension, sourceHeight))
                put("durationMs", durationMs)
                put("sourceRotation", sourceRotation)
                put("outDimension", outputDimension)
            }
            File(dir, MANIFEST_NAME).writeText(manifest.toString())
            Log.i(TAG, "Sequence ready: frames=$frames fps=$fps dir=${dir.absolutePath}")

            return FrameSequenceInfo(
                dirPath,
                frames,
                fps,
                minOf(outputDimension, sourceWidth),
                minOf(outputDimension, sourceHeight),
                durationMs,
            )
        } finally {
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            try { extractor?.release() } catch (_: Exception) {}
            try { retriever?.release() } catch (_: Exception) {}
            if (softwareAttempt) Log.i(TAG, "Used software decoder for this extraction")
        }
    }

    private fun createSoftwareDecoder(mime: String): MediaCodec {
        val decoders: MutableList<String> = ArrayList()
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        for (info in list.codecInfos) {
            if (!info.isEncoder && info.getSupportedTypes().any { it.equals(mime, ignoreCase = true) }) {
                val name = info.name.lowercase()
                val isSoftware =
                    name.contains("c2.android") || name.contains("omx.google") || name.contains("arc.")
                if (isSoftware) decoders.add(info.name)
            }
        }
        if (decoders.isEmpty()) {
            // Last resort: any AVC decoder, preferring 'secure'-free.
            for (info in list.codecInfos) {
                if (!info.isEncoder && info.getSupportedTypes().any { it.equals(mime, ignoreCase = true) }) {
                    if (!info.name.lowercase().contains("secure")) decoders.add(info.name)
                }
            }
        }
        if (decoders.isEmpty()) {
            throw IllegalStateException("No usable decoder found for $mime (software list empty)")
        }
        // Prefer a Google/C2 decoder (arc.) last since it is slowest.
        decoders.sortWith(compareBy<String> { name ->
            when {
                name.contains("c2.android") || name.contains("omx.google") -> 0
                name.contains("arc.") -> 2
                else -> 1
            }
        })
        return MediaCodec.createByCodecName(decoders[0])
    }

    private fun frameBitmap(codec: MediaCodec, index: Int): Bitmap? {
        return try {
            val image: Image = codec.getOutputImage(index) ?: return null
            try {
                val nv21 = imageToNv21(image)
                val out = ByteArrayOutputStream()
                YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
                    .compressToJpeg(Rect(0, 0, image.width, image.height), JPEG_QUALITY, out)
                val bytes = out.toByteArray()
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } finally {
                image.close()
            }
        } catch (error: Exception) {
            Log.w(TAG, "frameBitmap failed for index $index", error)
            null
        }
    }

    private fun imageToNv21(image: Image): ByteArray {
        val width = image.width
        val height = image.height
        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]
        val yRowStride = yPlane.rowStride
        val uvRowStride = uPlane.rowStride
        val yPixelStride = yPlane.pixelStride
        val uvPixelStride = uPlane.pixelStride

        val nv21 = ByteArray(width * height + 2 * ((width + 1) / 2) * ((height + 1) / 2))
        var outPos = 0
        var yRowStart = 0
        for (row in 0 until height) {
            var px = yRowStart
            for (col in 0 until width) {
                nv21[outPos++] = yPlane.buffer[px]
                px += yPixelStride
            }
            yRowStart += yRowStride
        }

        var uvPos = width * height
        var uRowStart = 0
        var vRowStart = 0
        for (row in 0 until (height + 1) / 2) {
            var ux = uRowStart
            var vx = vRowStart
            for (col in 0 until (width + 1) / 2) {
                nv21[uvPos++] = vPlane.buffer[vx] // V first for NV21
                nv21[uvPos++] = uPlane.buffer[ux]
                ux += uvPixelStride
                vx += uvPixelStride
            }
            uRowStart += uvRowStride
            vRowStart += uvRowStride
        }
        return nv21
    }

    private fun scale(bitmap: Bitmap, maxDimension: Int): Bitmap {
        val scale = maxDimension.toFloat() / maxOf(bitmap.width, bitmap.height)
        val w = (bitmap.width * scale).toInt().coerceAtLeast(2)
        val h = (bitmap.height * scale).toInt().coerceAtLeast(2)
        return Bitmap.createScaledBitmap(bitmap, w, h, true)
    }

    private fun rotate(bitmap: Bitmap, rotation: Int): Bitmap {
        val matrix = Matrix()
        matrix.postRotate(rotation.toFloat())
        val out = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        return out
    }

    private fun estimateFps(ptsUs: List<Long>, durationMs: Long): Int {
        if (ptsUs.size < 2) {
            return 1
        }
        val deltas = ArrayList<Long>(ptsUs.size - 1)
        for (i in 1 until ptsUs.size) {
            val d = ptsUs[i] - ptsUs[i - 1]
            if (d > 0L) deltas.add(d)
        }
        if (deltas.isEmpty()) return 1
        deltas.sort()
        val medianDeltaUs = deltas[deltas.size / 2]
        if (medianDeltaUs <= 0L) return 1
        val fps = (1_000_000L / medianDeltaUs).coerceIn(1L, MAX_FPS.toLong()).toInt()
        return fps
    }
}

data class FrameSequenceInfo(
    val dirPath: String,
    val frames: Int,
    val fps: Int,
    val width: Int,
    val height: Int,
    val durationMs: Long,
)