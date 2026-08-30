package com.wall_e.wallpaper

import android.graphics.BitmapFactory
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
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.mediacodec.MediaCodecRenderer
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
        private var playbackDuration = 30          // seconds from W_DURATION (default 30)
        private var videoRotationDegrees = 0       // degrees from W_ROTATION (0/90/180/270)
        private var videoFailed = false
        private var videoErrorMessage = ""
        private var isPlayerReady = false
        private var enforceDurationRunnable: Runnable? = null
        private var videoGlRenderer: VideoGlRenderer? = null
        private var glFallbackTriggered = false
        private var glFirstFrameSeen = false
        private var glEndedPending = false
        private var glEndedFrames = 0
        private var glReadyAt = 0L
        private var frameFallbackRetriever: MediaMetadataRetriever? = null
        private var frameFallbackDurationUs = 0L
        private var frameFallbackBitmap: android.graphics.Bitmap? = null
        private var frameFallbackStartedAt = 0L
        private var frameFallbackFinished = false
        private val frameFallbackIntervalMs = 33L
        private var frameFallbackRunning = false
        private var staticBitmap: android.graphics.Bitmap? = null
        private var frameFallbackFailures = 0

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
                            frameFallbackBitmap = downscaleFallbackBitmap(bitmap)
                            previousBitmap?.recycle()
                            if (frameFallbackBitmap != bitmap) bitmap.recycle()
                        }
                        frameFallbackFailures = 0
                    }
                    frameFallbackFinished = !shouldLoop && elapsedUs >= durationUs
                } catch (error: Exception) {
                    Log.e(TAG, "Frame fallback decode failed at ${positionUs}us", error)
                    frameFallbackFailures++
                    if (frameFallbackFailures >= 6) {
                        Log.e(TAG, "Frame fallback failed repeatedly; marking video as failed")
                        synchronized(playerLock) {
                            videoFailed = true
                            videoErrorMessage = "This device cannot play the selected video format"
                        }
                        releaseFrameFallback()
                        mainHandler.post { refreshRendering() }
                        return
                    }
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
            loadStaticImage()
            startExoPlayer(holder)
            refreshRendering()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            Log.i(TAG, "ON_SURFACE_CHANGED: ${width}x${height}, format=$format")
            if (wallpaperKind == "video") {
                synchronized(playerLock) {
                    videoGlRenderer?.updateSurfaceSize(width, height)
                    if (videoGlRenderer == null) exoPlayer?.setVideoSurface(holder.surface)
                }
            } else if (wallpaperKind == "static") {
                // Orientation/size changes need a fresh paint of the still image.
                stopRendering()
                startRendering()
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            Log.i(TAG, "ON_SURFACE_DESTROYED")
            stopRendering()
            releaseExoPlayer()
            releaseFrameFallback()
            releaseStaticImage()
        }

        override fun onVisibilityChanged(visible: Boolean) {
            super.onVisibilityChanged(visible)
            Log.i(TAG, "ON_VISIBILITY_CHANGED: $visible")
            if (visible) {
                val previousKind = wallpaperKind
                val previousUri = configuredVideoUriString
                val previousLoop = shouldLoop
                val previousAudio = includeAudio
                val previousDuration = playbackDuration
                val previousRotation = videoRotationDegrees
                loadConfiguration()

                val configChanged =
                    previousKind != wallpaperKind ||
                        previousUri != configuredVideoUriString ||
                        previousLoop != shouldLoop ||
                        previousAudio != includeAudio ||
                        previousDuration != playbackDuration ||
                        previousRotation != videoRotationDegrees

                if (configChanged) {
                    Log.i(TAG, "CONFIG CHANGED: kind $previousKind->$wallpaperKind, uri $previousUri->$configuredVideoUriString, loop $previousLoop->$shouldLoop, audio $previousAudio->$includeAudio, duration $previousDuration->$playbackDuration, rotation $previousRotation->$videoRotationDegrees")
                    releaseExoPlayer()
                    releaseStaticImage()
                    loadStaticImage()
                    startExoPlayer(surfaceHolder)
                } else {
                    synchronized(playerLock) {
                        if (!shouldLoop) {
                            Log.i(TAG, "Unlock: holding one-shot at final frame")
                            val durationMs = playbackDuration * 1000L
                            exoPlayer?.seekTo(durationMs.coerceAtMost(durationMs))
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
                refreshRendering()
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

            // Rotated videos render through a GPU texture pipeline so playback
            // stays smooth and lossless at any angle. If the GL renderer cannot
            // start we fall back to the centered canvas path.
            val isRotated = videoRotationDegrees % 360 != 0
            if (isRotated) {
                videoGlRenderer = try {
                    VideoGlRenderer(
                        holder.surface,
                        holder.surfaceFrame.width().coerceAtLeast(1),
                        holder.surfaceFrame.height().coerceAtLeast(1),
                        videoRotationDegrees,
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "GL renderer init failed; using frame fallback", e)
                    videoGlRenderer?.release()
                    videoGlRenderer = null
                    null
                }
                if (videoGlRenderer == null) {
                    startFrameFallback(videoUri)
                    return
                }
                glFallbackTriggered = false
                glFirstFrameSeen = false
                glReadyAt = 0L
                Log.i(TAG, "Rotated video: rendering via GPU pipeline (rotation=$videoRotationDegrees)")
            }

            Log.i(TAG, "STARTING EXOPLAYER FOR: $videoUri")
            logVideoMetadata(videoUri)

            synchronized(playerLock) {
                releaseExoPlayerLocked()
                videoFailed = false
                videoErrorMessage = ""
                isPlayerReady = false

                // Use the default (hardware-first) codec order with automatic
                // fallback so playable videos decode fast and smooth.
                val renderersFactory = DefaultRenderersFactory(this@LiveWallpaperService)
                    .setEnableDecoderFallback(true)
                Log.i(TAG, "Creating ExoPlayer with hardware-first decoders and fallback enabled")
                exoPlayer = ExoPlayer.Builder(this@LiveWallpaperService, renderersFactory).build().apply {
                    Log.i(TAG, "ExoPlayer created: applicationContext=${this@LiveWallpaperService.applicationContext.packageName}")
                    setVideoSurface(videoGlRenderer?.videoSurfaceForPlayer() ?: holder.surface)
                    videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
                    repeatMode = if (shouldLoop) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
                    volume = if (includeAudio) 1f else 0f
                    
                    addListener(object : Player.Listener {
                        override fun onPlaybackStateChanged(state: Int) {
                            Log.i(TAG, "VIDEO PLAYER STATE = $state")
                            if (state == Player.STATE_READY) {
                                isPlayerReady = true
                                videoFailed = false
                                if (videoGlRenderer != null && glReadyAt == 0L) {
                                    glReadyAt = System.currentTimeMillis()
                                }
                                refreshRendering()
                            } else if (state == Player.STATE_ENDED && videoGlRenderer != null && !shouldLoop) {
                                glEndedFrames = videoGlRenderer?.framesRendered ?: 0
                                glEndedPending = true
                            }
                        }

                        override fun onVideoSizeChanged(videoSize: VideoSize) {
                            videoGlRenderer?.setVideoSize(videoSize.width, videoSize.height)
                            Log.i(TAG, "VIDEO SIZE = ${videoSize.width}x${videoSize.height}")
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
                            releaseGlRenderer()
                            startFrameFallback(videoUri)
                            mainHandler.post { refreshRendering() }
                        }
                    })

                    val mediaItem = MediaItem.fromUri(videoUri)
                    Log.i(TAG, "ExoPlayer media item: uri=${mediaItem.localConfiguration?.uri} mime=${mediaItem.localConfiguration?.mimeType}")
                    setMediaItem(mediaItem)
                    prepare()
                    play()

                    // Enforce the preview duration (W_DURATION). Loop mode rewinds
                    // to 0; one-shot mode holds the final frame without re-seeking.
                    val durationMs = playbackDuration * 1000L
                    mainHandler.removeCallbacks(enforceDurationRunnable ?: Runnable {})
                    enforceDurationRunnable = object : Runnable {
                        override fun run() {
                            synchronized(playerLock) {
                                val player = exoPlayer
                                val pos = player?.currentPosition ?: 0
                                if (pos >= durationMs) {
                                    if (shouldLoop) {
                                        player?.seekTo(0L)
                                    } else if (player?.playbackState != Player.STATE_ENDED) {
                                        player?.seekTo(durationMs)
                                    }
                                }
                            }
                            mainHandler.postDelayed(this, 500)
                        }
                    }
                    mainHandler.postDelayed(enforceDurationRunnable!!, 500)
                }
            }
        }

        private fun releaseExoPlayer() {
            synchronized(playerLock) {
                releaseExoPlayerLocked()
            }
        }

        private fun releaseExoPlayerLocked() {
            mainHandler.removeCallbacks(enforceDurationRunnable ?: Runnable {})
            enforceDurationRunnable = null
            releaseGlRenderer()
            exoPlayer?.stop()
            exoPlayer?.release()
            exoPlayer = null
            isPlayerReady = false
        }

        private fun releaseGlRenderer() {
            try {
                videoGlRenderer?.release()
            } catch (_: Exception) {
                // best-effort GL teardown
            }
            videoGlRenderer = null
            glFallbackTriggered = false
            glFirstFrameSeen = false
            glEndedPending = false
            glEndedFrames = 0
            glReadyAt = 0L
        }

        private fun switchGlToFallback() {
            if (glFallbackTriggered) return
            glFallbackTriggered = true
            Log.w(TAG, "GPU video pipeline unavailable; switching to frame fallback")
            synchronized(playerLock) {
                releaseExoPlayerLocked()
            }
            val videoUri = try {
                Uri.parse(configuredVideoUriString)
            } catch (e: Exception) {
                null
            }
            if (videoUri != null) {
                frameFallbackFailures = 0
                startFrameFallback(videoUri)
            }
            mainHandler.post { refreshRendering() }
        }

        private fun checkGlWatchdog() {
            if (glFallbackTriggered || glFirstFrameSeen) return
            val renderer = videoGlRenderer ?: return
            if (renderer.hasError) {
                switchGlToFallback()
                return
            }
            if (!isPlayerReady || glReadyAt == 0L) return
            if (System.currentTimeMillis() - glReadyAt > 3500L) {
                Log.w(TAG, "GPU pipeline produced no frames within 3.5s; switching to frame fallback")
                switchGlToFallback()
            }
        }

        private fun startFrameFallback(videoUri: Uri) {
            releaseFrameFallback()
            try {
                val retriever = MediaMetadataRetriever()
                retriever.setDataSource(this@LiveWallpaperService, videoUri)
                val durationMs = (playbackDuration * 1000L).coerceAtLeast(1L)
                val videoDurationMs = retriever
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

        private fun downscaleFallbackBitmap(source: android.graphics.Bitmap): android.graphics.Bitmap {
            val maxWidth = 480
            if (source.width <= maxWidth) return source
            val scale = maxWidth.toFloat() / source.width
            val w = (source.width * scale).toInt()
            val h = (source.height * scale).toInt()
            return android.graphics.Bitmap.createScaledBitmap(source, w, h, true)
        }

        private fun renderFrameFallback(canvas: Canvas): Boolean {
            synchronized(frameLock) {
                val bitmap = frameFallbackBitmap ?: return false
                drawRotatedBitmap(canvas, bitmap)
                return true
            }
        }

        private fun renderStaticImage(canvas: Canvas): Boolean {
            val bitmap = staticBitmap ?: return false
            drawRotatedBitmap(canvas, bitmap)
            return true
        }

        private fun drawRotatedBitmap(canvas: Canvas, bitmap: android.graphics.Bitmap) {
            val canvasWidth = canvas.width
            val canvasHeight = canvas.height
            val saveCount = canvas.save()

            if (videoRotationDegrees != 0) {
                val rotateCenterWidth = canvasWidth / 2f
                val rotateCenterHeight = canvasHeight / 2f
                canvas.rotate(videoRotationDegrees.toFloat(), rotateCenterWidth, rotateCenterHeight)
            }

            canvas.drawColor(Color.BLACK)
            val source = android.graphics.Rect(0, 0, bitmap.width, bitmap.height)

            // The rotated footprint of the content on screen.
            val rotatedWidth: Float
            val rotatedHeight: Float
            if (videoRotationDegrees == 90 || videoRotationDegrees == 270) {
                rotatedWidth = bitmap.height.toFloat()
                rotatedHeight = bitmap.width.toFloat()
            } else {
                rotatedWidth = bitmap.width.toFloat()
                rotatedHeight = bitmap.height.toFloat()
            }

            // Cover: stretch to fill the whole screen and center (crop the overflow).
            val scaleX = canvasWidth.toFloat() / rotatedWidth
            val scaleY = canvasHeight.toFloat() / rotatedHeight
            val scale = maxOf(scaleX, scaleY)
            val drawWidth = rotatedWidth * scale
            val drawHeight = rotatedHeight * scale
            val left = (canvasWidth - drawWidth) / 2f
            val top = (canvasHeight - drawHeight) / 2f
            val destination = android.graphics.Rect(
                left.toInt(),
                top.toInt(),
                (left + drawWidth).toInt(),
                (top + drawHeight).toInt(),
            )

            canvas.drawBitmap(bitmap, source, destination, videoPaint)
            canvas.restoreToCount(saveCount)
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

        /**
         * Only run the display-driven frame loop when we actually need to paint
         * (doodles, frame-fallback video, or the error screen). When ExoPlayer
         * renders directly to the wallpaper surface we keep the loop off so the
         * device is not woken every frame for nothing — smoother and lighter on
         * battery while the video plays.
         */
        private fun refreshRendering() {
            synchronized(playerLock) {
                val videoOwnsSurface =
                    wallpaperKind == "video" &&
                        videoRotationDegrees % 360 == 0 &&
                        exoPlayer != null &&
                        isPlayerReady &&
                        !videoFailed &&
                        videoErrorMessage.isBlank()
                if (videoOwnsSurface) {
                    stopRendering()
                } else {
                    startRendering()
                }
            }
        }

        override fun doFrame(frameTimeNanos: Long) {
            if (!isRendering) return
            val holder = surfaceHolder ?: return

            val glActive = synchronized(playerLock) {
                wallpaperKind == "video" &&
                    videoRotationDegrees % 360 != 0 &&
                    videoGlRenderer != null &&
                    exoPlayer != null &&
                    !videoFailed &&
                    isPlayerReady
            }

            if (glActive) {
                videoGlRenderer?.let { renderer ->
                    if (renderer.hasError) {
                        switchGlToFallback()
                    } else {
                        renderer.render()
                        if (renderer.framesRendered > 0 && !glFirstFrameSeen) {
                            glFirstFrameSeen = true
                            Log.i(TAG, "GPU pipeline producing frames")
                        }
                        checkGlWatchdog()
                        if (glEndedPending && renderer.framesRendered > glEndedFrames) {
                            glEndedPending = false
                            stopRendering()
                        }
                    }
                }
            } else {
                val drawWithCanvas = synchronized(playerLock) {
                    wallpaperKind == "static" ||
                        (wallpaperKind == "video" && videoGlRenderer == null && (videoFailed || videoRotationDegrees % 360 != 0))
                }

                if (drawWithCanvas) {
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

                    if (wallpaperKind == "static") {
                        // A still image only needs a single paint; stop the loop to save battery.
                        stopRendering()
                        return
                    }
                    if (!shouldLoop && frameFallbackFinished) {
                        // One-shot canvas playback: hold the final frame, stop the loop.
                        stopRendering()
                        return
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

            if (wallpaperKind == "static") {
                if (renderStaticImage(canvas)) return
                canvas.drawColor(accentColor)
                secondaryPaint.color = Color.WHITE
                secondaryPaint.textSize = size * 0.05f
                secondaryPaint.textAlign = Paint.Align.CENTER
                canvas.drawText("No image selected", centerX, centerY, secondaryPaint)
                return
            }

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
            playbackDuration = preferences.getInt("W_DURATION", 30).coerceIn(1, 30)
            videoRotationDegrees = preferences.getInt("W_ROTATION", 0).coerceIn(0, 270)

            val accentStr = preferences.getString("W_ACCENT", "#7C3AED") ?: "#7C3AED"
            accentColor = try { Color.parseColor(accentStr) } catch (_: Exception) { Color.parseColor("#7C3AED") }

            Log.i(TAG, "LOAD CONFIG: kind=$wallpaperKind, path=$configuredVideoUriString, rotation=$videoRotationDegrees")
            if (configuredVideoUriString.startsWith("file://")) {
                val configuredFile = File(Uri.parse(configuredVideoUriString).path ?: "")
                Log.i(TAG, "Configured file: path=${configuredFile.absolutePath} exists=${configuredFile.exists()} bytes=${configuredFile.length()} readable=${configuredFile.canRead()}")
            }

            val hsv = FloatArray(3)
            Color.colorToHSV(accentColor, hsv)
            hsv[0] = (hsv[0] + 180) % 360
            secondaryColor = Color.HSVToColor(hsv)
        }

        private fun loadStaticImage() {
            releaseStaticImage()
            if (wallpaperKind != "static") return
            if (configuredVideoUriString.isBlank()) {
                Log.e(TAG, "LOAD STATIC: no image path configured")
                return
            }
            try {
                val uri = Uri.parse(configuredVideoUriString)
                val bitmap = if (uri.scheme == "content") {
                    BitmapFactory.decodeStream(contentResolver.openInputStream(uri))
                } else if (uri.scheme == "file") {
                    BitmapFactory.decodeFile(uri.path)
                } else {
                    BitmapFactory.decodeFile(configuredVideoUriString)
                }
                if (bitmap == null) {
                    Log.e(TAG, "LOAD STATIC: failed to decode image at $configuredVideoUriString")
                    return
                }
                staticBitmap = bitmap
                Log.i(TAG, "LOAD STATIC: decoded ${bitmap.width}x${bitmap.height}")
            } catch (error: Exception) {
                Log.e(TAG, "LOAD STATIC: failed to load image", error)
            }
        }

        private fun releaseStaticImage() {
            staticBitmap?.recycle()
            staticBitmap = null
        }
    }

    companion object {
        private const val TAG = "LiveWallpaperService"
    }
}
