package com.wall_e.wallpaper

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaCodecList
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.Choreographer
import android.view.SurfaceHolder
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.mediacodec.MediaCodecRenderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import java.io.File
import kotlin.math.sin

class LiveWallpaperService : WallpaperService() {
    
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "LiveWallpaperService ON_CREATE")
    }

    override fun onCreateEngine(): Engine {
        Log.i(TAG, "LiveWallpaperService ON_CREATE_ENGINE")
        return WallpaperEngine()
    }

    private inner class WallpaperEngine : WallpaperService.Engine(), Choreographer.FrameCallback {
        private val mainHandler = Handler(Looper.getMainLooper())
        private val choreographer = Choreographer.getInstance()
        private val frameDecoderThread = HandlerThread("WallpaperFrameDecoder").apply { start() }
        private val frameDecoderHandler = Handler(frameDecoderThread.looper)
        private val frameLock = Any()

        private val paint = Paint().apply {
            color = Color.WHITE
            strokeWidth = 6f
            isAntiAlias = true
            style = Paint.Style.FILL
        }
        private val secondaryPaint = Paint().apply {
            isAntiAlias = true
            style = Paint.Style.FILL
        }
        private val videoPaint = Paint().apply {
            isAntiAlias = true
            isFilterBitmap = true
            isDither = true
        }

        private var exoPlayer: ExoPlayer? = null
        private val playerLock = Any()
        private var isRendering = false
        private var startedAt = 0L

        // Cached configuration
        private var wallpaperKind = "doodle"
        private var configuredVideoUriString = ""
        private var accentColor = Color.parseColor("#7C3AED")
        private var secondaryColor = Color.parseColor("#22D3EE")
        private var shouldLoop = true
        private var includeAudio = false
        private var videoFailed = false
        private var videoErrorMessage = ""
        private var isPlayerReady = false
        private var frameFallbackRetriever: MediaMetadataRetriever? = null
        private var frameFallbackDurationUs = 0L
        private var frameFallbackBitmap: android.graphics.Bitmap? = null
        private var frameFallbackStartedAt = 0L
        private var frameFallbackFinished = false
        private val frameFallbackIntervalMs = 33L
        private var frameFallbackRunning = false

        private val decodeFallbackFrame = object : Runnable {
            override fun run() {
                val retriever = frameFallbackRetriever ?: return
                val durationUs = frameFallbackDurationUs
                if (durationUs <= 0L) return

                val elapsedUs = (System.currentTimeMillis() - frameFallbackStartedAt) * 1000L
                val positionUs = if (shouldLoop) {
                    elapsedUs % durationUs
                } else {
                    elapsedUs.coerceAtMost(durationUs - 1L)
                }
                try {
                    val bitmap = retriever.getFrameAtTime(positionUs, MediaMetadataRetriever.OPTION_CLOSEST)
                    if (bitmap != null) {
                        synchronized(frameLock) {
                            val previousBitmap = frameFallbackBitmap
                            frameFallbackBitmap = bitmap
                            previousBitmap?.recycle()
                        }
                    }
                    frameFallbackFinished = !shouldLoop && elapsedUs >= durationUs
                } catch (error: Exception) {
                    Log.e(TAG, "Frame fallback decode failed at ${positionUs}us", error)
                }

                if (frameFallbackRunning && frameFallbackRetriever != null && (!frameFallbackFinished || frameFallbackBitmap != null)) {
                    frameDecoderHandler.postDelayed(this, frameFallbackIntervalMs)
                }
            }
        }

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            Log.i(TAG, "WallpaperEngine ON_CREATE")
            setTouchEventsEnabled(false)
        }

        override fun onDestroy() {
            stopRendering()
            releaseExoPlayer()
            releaseFrameFallback()
            frameDecoderThread.quitSafely()
            super.onDestroy()
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            Log.i(TAG, "ON_SURFACE_CREATED: valid=${holder.surface.isValid}")
            loadConfiguration()
            startExoPlayer(holder)
            startRendering()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            Log.i(TAG, "ON_SURFACE_CHANGED: ${width}x${height}, format=$format")
            if (wallpaperKind == "video") {
                synchronized(playerLock) {
                    exoPlayer?.setVideoSurface(holder.surface)
                }
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            Log.i(TAG, "ON_SURFACE_DESTROYED")
            stopRendering()
            releaseExoPlayer()
            releaseFrameFallback()
        }

        override fun onVisibilityChanged(visible: Boolean) {
            super.onVisibilityChanged(visible)
            Log.i(TAG, "ON_VISIBILITY_CHANGED: $visible")
            if (visible) {
                val previousKind = wallpaperKind
                val previousUri = configuredVideoUriString
                loadConfiguration()

                if (previousKind != wallpaperKind || previousUri != configuredVideoUriString) {
                    Log.i(TAG, "URI CHANGED: $previousUri -> $configuredVideoUriString")
                    releaseExoPlayer()
                    startExoPlayer(surfaceHolder)
                } else {
                    synchronized(playerLock) {
                        if (!shouldLoop) {
                            Log.i(TAG, "Unlock detected: restarting one-shot video from the beginning")
                            exoPlayer?.seekTo(0L)
                        }
                        exoPlayer?.play()
                    }
                    if (!shouldLoop && frameFallbackRetriever != null) {
                        frameFallbackStartedAt = System.currentTimeMillis()
                        frameFallbackFinished = false
                        frameFallbackRunning = true
                        frameDecoderHandler.removeCallbacks(decodeFallbackFrame)
                        frameDecoderHandler.post(decodeFallbackFrame)
                    } else if (shouldLoop && frameFallbackRetriever != null) {
                        frameFallbackRunning = true
                        frameDecoderHandler.post(decodeFallbackFrame)
                    }
                }
                startRendering()
            } else {
                synchronized(playerLock) {
                    exoPlayer?.pause()
                }
                frameFallbackRunning = false
                frameDecoderHandler.removeCallbacks(decodeFallbackFrame)
                stopRendering()
            }
        }

        private fun logVideoMetadata(uri: Uri) {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(this@LiveWallpaperService, uri)
                val mime = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
                val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
                val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
                val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                
                Log.i(TAG, "--- VIDEO METADATA ---")
                Log.i(TAG, "URI: $uri")
                Log.i(TAG, "MIME: $mime")
                Log.i(TAG, "Resolution: ${width}x${height}, rotation=$rotation")
                Log.i(TAG, "----------------------")
            } catch (e: Exception) {
                Log.e(TAG, "FAILED TO READ VIDEO METADATA for $uri", e)
            } finally {
                retriever.release()
            }
        }

        private fun logAvailableDecoders() {
            val list = MediaCodecList(MediaCodecList.ALL_CODECS)
            Log.i(TAG, "--- AVAILABLE DECODERS ---")
            for (info in list.codecInfos) {
                if (info.isEncoder) continue
                Log.i(TAG, "Decoder: ${info.name}, Types: ${info.supportedTypes.joinToString()}")
            }
            Log.i(TAG, "--------------------------")
        }

        private fun startExoPlayer(holder: SurfaceHolder?) {
            Log.i(TAG, "startExoPlayer: kind=$wallpaperKind uri=$configuredVideoUriString surfaceValid=${holder?.surface?.isValid}")
            if (wallpaperKind != "video" || holder == null || !holder.surface.isValid) {
                Log.w(TAG, "START_PLAYER SKIPPED: kind=$wallpaperKind, surfaceValid=${holder?.surface?.isValid}")
                return
            }

            if (configuredVideoUriString.isBlank()) {
                Log.e(TAG, "START_PLAYER ERROR: configuredVideoUriString IS BLANK")
                videoFailed = true
                videoErrorMessage = "No video selected"
                return
            }

            val videoUri = try {
                Uri.parse(configuredVideoUriString)
            } catch (e: Exception) {
                Log.e(TAG, "FAILED TO PARSE URI: $configuredVideoUriString", e)
                null
            }

            if (videoUri == null) {
                videoFailed = true
                videoErrorMessage = "Invalid video URI"
                return
            }

            Log.i(TAG, "STARTING EXOPLAYER FOR: $videoUri")
            logVideoMetadata(videoUri)

            synchronized(playerLock) {
                releaseExoPlayerLocked()
                videoFailed = false
                videoErrorMessage = ""
                isPlayerReady = false

                val renderersFactory = DefaultRenderersFactory(this@LiveWallpaperService)
                    .setEnableDecoderFallback(true)
                    .setMediaCodecSelector(MediaCodecSelector { mimeType, requiresSecureDecoder, requiresTunnelingDecoder ->
                        val decoderInfos = MediaCodecSelector.DEFAULT.getDecoderInfos(
                            mimeType,
                            requiresSecureDecoder,
                            requiresTunnelingDecoder,
                        )
                        if (mimeType == MimeTypes.VIDEO_H264) {
                            val softwareDecoders = decoderInfos.filter { it.softwareOnly }
                            Log.i(TAG, "H.264 decoder candidates: all=${decoderInfos.map { it.name }} software=${softwareDecoders.map { it.name }}")
                            if (softwareDecoders.isNotEmpty()) softwareDecoders else decoderInfos
                        } else {
                            decoderInfos
                        }
                    })
                Log.i(TAG, "Creating ExoPlayer with decoder fallback enabled")
                exoPlayer = ExoPlayer.Builder(this@LiveWallpaperService, renderersFactory).build().apply {
                    Log.i(TAG, "ExoPlayer created: applicationContext=${this@LiveWallpaperService.applicationContext.packageName}")
                    setVideoSurface(holder.surface)
                    repeatMode = if (shouldLoop) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
                    volume = if (includeAudio) 1f else 0f
                    
                    addListener(object : Player.Listener {
                        override fun onPlaybackStateChanged(state: Int) {
                            Log.i(TAG, "VIDEO PLAYER STATE = $state")
                            if (state == Player.STATE_READY) {
                                isPlayerReady = true
                                videoFailed = false
                            }
                        }

                        override fun onPlayerError(error: PlaybackException) {
                            Log.e(TAG, "!!! VIDEO PLAYER ERROR !!!")
                            Log.e(TAG, "ErrorCode: ${error.errorCodeName} (${error.errorCode})")
                            Log.e(TAG, "Message: ${error.message}")
                            
                            var cause: Throwable? = error.cause
                            while (cause != null) {
                                Log.e(TAG, "Cause: ${cause.javaClass.simpleName}: ${cause.message}")
                                if (cause is MediaCodecRenderer.DecoderInitializationException) {
                                    Log.e(TAG, "DecoderInitException: codec=${cause.codecInfo?.name}, mime=${cause.mimeType}")
                                }
                                cause = cause.cause
                            }
                            
                            logAvailableDecoders()
                            
                            videoFailed = true
                            videoErrorMessage = "Playback error: ${error.errorCodeName}"
                            startFrameFallback(videoUri)
                            mainHandler.post { startRendering() }
                        }
                    })

                    val mediaItem = MediaItem.fromUri(videoUri)
                    Log.i(TAG, "ExoPlayer media item: uri=${mediaItem.localConfiguration?.uri} mime=${mediaItem.localConfiguration?.mimeType}")
                    setMediaItem(mediaItem)
                    prepare()
                    play()
                }
            }
        }

        private fun releaseExoPlayer() {
            synchronized(playerLock) {
                releaseExoPlayerLocked()
            }
        }

        private fun releaseExoPlayerLocked() {
            exoPlayer?.stop()
            exoPlayer?.release()
            exoPlayer = null
            isPlayerReady = false
        }

        private fun startFrameFallback(videoUri: Uri) {
            releaseFrameFallback()
            try {
                val retriever = MediaMetadataRetriever()
                retriever.setDataSource(this@LiveWallpaperService, videoUri)
                val durationMs = retriever
                    .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull() ?: 0L
                if (durationMs <= 0L) {
                    retriever.release()
                    Log.e(TAG, "Frame fallback unavailable: video duration is invalid")
                    return
                }
                frameFallbackRetriever = retriever
                frameFallbackDurationUs = durationMs * 1000L
                frameFallbackStartedAt = System.currentTimeMillis()
                frameFallbackFinished = false
                frameFallbackRunning = true
                videoErrorMessage = "Using compatibility frame playback"
                Log.w(TAG, "Starting frame playback fallback: durationMs=$durationMs")
                frameDecoderHandler.post(decodeFallbackFrame)
            } catch (error: Exception) {
                Log.e(TAG, "Frame playback fallback could not open video", error)
                releaseFrameFallback()
            }
        }

        private fun releaseFrameFallback() {
            frameDecoderHandler.removeCallbacks(decodeFallbackFrame)
            frameFallbackRunning = false
            synchronized(frameLock) {
                frameFallbackBitmap?.recycle()
                frameFallbackBitmap = null
            }
            try {
                frameFallbackRetriever?.release()
            } catch (_: Exception) {
                // release() can throw on some devices
            }
            frameFallbackRetriever = null
            frameFallbackDurationUs = 0L
            frameFallbackStartedAt = 0L
            frameFallbackFinished = false
        }

        private fun renderFrameFallback(canvas: Canvas): Boolean {
            synchronized(frameLock) {
                val bitmap = frameFallbackBitmap ?: return false
                val source = android.graphics.Rect(0, 0, bitmap.width, bitmap.height)
                val destination = android.graphics.Rect(0, 0, canvas.width, canvas.height)
                canvas.drawColor(Color.BLACK)
                canvas.drawBitmap(bitmap, source, destination, videoPaint)
                return true
            }
        }

        private fun startRendering() {
            if (isRendering) return
            isRendering = true
            startedAt = System.currentTimeMillis()
            choreographer.postFrameCallback(this)
        }

        private fun stopRendering() {
            isRendering = false
            choreographer.removeFrameCallback(this)
        }

        override fun doFrame(frameTimeNanos: Long) {
            if (!isRendering) return
            val holder = surfaceHolder ?: return

            val isVideoActive = synchronized(playerLock) {
                wallpaperKind == "video" && exoPlayer != null && !videoFailed
            }
            val videoFullyReady = isVideoActive && isPlayerReady && !videoFailed

            if (!videoFullyReady) {
                var canvas: Canvas? = null
                try {
                    canvas = holder.lockCanvas()
                    if (canvas != null) {
                        drawFrame(canvas)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Render frame error", e)
                } finally {
                    canvas?.let {
                        try { holder.unlockCanvasAndPost(it) } catch (_: Exception) {}
                    }
                }
            }

            if (isRendering) {
                // Continuous display-driven loop for smooth playback; ExoPlayer handles direct surface rendering.
                choreographer.postFrameCallback(this)
            }
        }

        private fun drawFrame(canvas: Canvas) {
            val elapsed = (System.currentTimeMillis() - startedAt) / 1000f
            val bgColor = Color.parseColor("#020817")
            canvas.drawColor(bgColor)

            val centerX = canvas.width / 2f
            val centerY = canvas.height / 2f
            val size = canvas.width.coerceAtMost(canvas.height)

            if (wallpaperKind == "video") {
                if (renderFrameFallback(canvas)) return
                if (videoFailed) {
                    canvas.drawColor(Color.parseColor("#1E293B"))
                    secondaryPaint.color = Color.WHITE
                    secondaryPaint.textSize = size * 0.05f
                    secondaryPaint.textAlign = Paint.Align.CENTER
                    canvas.drawText("Video unavailable", centerX, centerY, secondaryPaint)

                    secondaryPaint.textSize = size * 0.03f
                    secondaryPaint.color = Color.parseColor("#FDA4AF")
                    canvas.drawText(videoErrorMessage, centerX, centerY + size * 0.08f, secondaryPaint)

                    secondaryPaint.color = Color.argb(180, 255, 255, 255)
                    canvas.drawText("Try re-selecting the video", centerX, centerY + size * 0.16f, secondaryPaint)
                } else if (!isPlayerReady) {
                    // Video is loading; keep black background, no error message, to avoid flicker.
                    // The ExoPlayer will render smoothly once STATE_READY fires.
                }
                return
            }

            val radius = size * (0.18f + 0.025f * sin(elapsed * 2.2f))
            paint.color = accentColor
            canvas.drawCircle(centerX, centerY, radius, paint)

            secondaryPaint.color = secondaryColor
            val orbitX = centerX + radius * (0.7f + 0.12f * sin(elapsed * 1.4f))
            val orbitY = centerY - radius * 0.5f
            canvas.drawCircle(orbitX, orbitY, radius * 0.42f, secondaryPaint)
        }

        private fun loadConfiguration() {
            val preferences = getSharedPreferences("wallpaper_pref", MODE_PRIVATE)
            wallpaperKind = preferences.getString("W_KIND", "doodle").orEmpty()
            configuredVideoUriString = preferences.getString("W_PATH", "").orEmpty()
            shouldLoop = preferences.getBoolean("W_LOOP", true)
            includeAudio = preferences.getBoolean("W_AUDIO", false)

            val accentStr = preferences.getString("W_ACCENT", "#7C3AED") ?: "#7C3AED"
            accentColor = try { Color.parseColor(accentStr) } catch (_: Exception) { Color.parseColor("#7C3AED") }

            Log.i(TAG, "LOAD CONFIG: kind=$wallpaperKind, path=$configuredVideoUriString")
            if (configuredVideoUriString.startsWith("file://")) {
                val configuredFile = File(Uri.parse(configuredVideoUriString).path ?: "")
                Log.i(TAG, "Configured file: path=${configuredFile.absolutePath} exists=${configuredFile.exists()} bytes=${configuredFile.length()} readable=${configuredFile.canRead()}")
            }

            val hsv = FloatArray(3)
            Color.colorToHSV(accentColor, hsv)
            hsv[0] = (hsv[0] + 180) % 360
            secondaryColor = Color.HSVToColor(hsv)
        }
    }

    companion object {
        private const val TAG = "LiveWallpaperService"
    }
}
