package com.wall_e.wallpaper

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.media.MediaCodecList
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.BatteryManager
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
import kotlin.math.cos
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
        private var playerStartedAt = 0L   // when ExoPlayer.ready was last initiated; 0 = not starting

        // The settled wallpaper loads its config when it becomes visible. The
        // committed store can be updated asynchronously afterwards (the app's
        // resolvePendingApply promotes a picker-confirmed selection on resume),
        // and no visibility/surface event retriggers a reload then. The watchdog
        // polls the on-disk config while the engine is visible so the wallpaper
        // always converges to the newly-confirmed/committed configuration.
        private var configWatchdogRunning = false
        private val configWatchdog = object : Runnable {
            override fun run() {
                if (!configWatchdogRunning) return
                try {
                    if (currentConfigSignature() != expectedConfigSignature()) {
                        Log.i(TAG, "CONFIG CHANGED ON DISK; reloading engine")
                        reloadConfigurationFromDisk()
                    }
                } catch (error: Exception) {
                    Log.w(TAG, "Config watchdog check failed", error)
                }
                mainHandler.postDelayed(this, 1000L)
            }
        }

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
        // Fade-to-black + fade-back-in cycle for one-shot clips. One-shot clips are
        // rendered through the GL pipeline, and the GL fragment shader blends the
        // video toward black using fadeAlpha, so the fade is composited on the live
        // frames with no canvas-over-surface rendering race.
        private var fadePhase = 0 // 0 idle, 1 fading-out, 2 black-hold, 3 fading-in
        private var fadeAlpha = 0f
        private var fadeTickMs = 0L
        private var oneShotEndSeen = false
        private val fadeFadeMs = 700L
        private val fadeBlackHoldMs = 150L
        private val fadeTickIntervalMs = 50L
        private val fadeRunnable = object : Runnable {
            override fun run() {
                synchronized(playerLock) {
                    if (fadePhase == 0) return
                    val player = exoPlayer ?: return
                    when (fadePhase) {
                        1 -> {
                            val t = (System.currentTimeMillis() - fadeTickMs) / fadeFadeMs.toFloat()
                            fadeAlpha = t.coerceIn(0f, 1f)
                            if (t >= 1f) { fadePhase = 2; fadeTickMs = System.currentTimeMillis() }
                            ensureFadeRendering()
                            mainHandler.postDelayed(this, fadeTickIntervalMs)
                        }
                        2 -> {
                            fadeAlpha = 1f
                            ensureFadeRendering()
                            if (System.currentTimeMillis() - fadeTickMs >= fadeBlackHoldMs) {
                                // Restart from the beginning and resume playback while the
                                // screen is still black, so fresh frames arrive under the
                                // black as it fades back in.
                                player.seekTo(0L)
                                player.play()
                                fadePhase = 3
                                fadeTickMs = System.currentTimeMillis()
                            }
                            mainHandler.postDelayed(this, fadeTickIntervalMs)
                        }
                        3 -> {
                            val t = (System.currentTimeMillis() - fadeTickMs) / fadeFadeMs.toFloat()
                            fadeAlpha = 1f - t.coerceIn(0f, 1f)
                            if (t >= 1f) {
                                finishFadeCycleLocked(player)
                                return
                            }
                            ensureFadeRendering()
                            mainHandler.postDelayed(this, fadeTickIntervalMs)
                        }
                    }
                }
            }
        }
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
        // "Fade to black + fade back in" for one-shot clips: instead of freezing on
        // the (often ugly) last frame, the clip loops through the video and fades to
        // black between cycles so the wallpaper is never static. Segment lengths in
        // microseconds.
        private val oneShotFadeUs = 700_000L
        private val oneShotBlackUs = 400_000L
        @Volatile private var oneShotCycleUs = 0L
        private val frameFallbackIntervalMs = 33L
        private var frameFallbackRunning = false
        private var staticBitmap: android.graphics.Bitmap? = null
        private var frameFallbackFailures = 0

        // ── Battery fluid (kind == "battery") ─────────────────────────────────
        @Volatile private var batteryPercent = 1f        // 0..1 current charge
        @Volatile private var batteryIsCharging = false  // plugged + charging
        private val tiltX = 0f                           // tilt disabled (no gyro/accel)
        private val tiltY = 0f
        private var fluidDisplayLevel = 1f               // smoothed 0..1 liquid fill
        private var fluidAnimTimeSec = 0f                // fallback animation clock
        private var batterySensorsRegistered = false
        // Reusable drawing objects (allocated once) so the fluid renderer never
        // allocates a Path/Paint/Gradient per frame — keeps GC pauses away and
        // the frame rate at the top.
        private val fluidSurfacePath = Path()
        private val fluidFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        private val fluidBandPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
        private var fluidGradient = android.graphics.LinearGradient(
            0f, 0f, 0f, 1f, Color.parseColor("#22C55E"), Color.parseColor("#064E3B"), android.graphics.Shader.TileMode.CLAMP
        )
        // Reusable paint for the pixel-art wallpaper (sharp, no antialiasing so
        // the blocks stay crisp and "retro").
        private val pixelPaint = Paint().apply { style = Paint.Style.FILL }
        // Pixel wallpaper variant, derived from the configured accent colour.
        // "calm" = minimalist teal, "synth" = neon synthwave, "aura" = premium
        // flowing-gradient (Dark Elegant) wallpaper.
        private var pixelVariant = "synth"
        private var derivedPixelPalette = intArrayOf(
            Color.parseColor("#FF006E"),
            Color.parseColor("#00D9FF"),
            Color.parseColor("#8338EC"),
        )
        // Reusable paint for the aura (flowing gradient) wallpaper. Antialiased and
        // radial-shader filled circles only — GPU cheap, large soft blobs.
        private val auraPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        private var auraGradients = arrayOf<android.graphics.RadialGradient?>(null, null, null)
        private var auraGradientRes = 0

        // Paint/shader/cache fields for the premium aurora wallpaper.
        private val auroraPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        private var auroraGradient: android.graphics.RadialGradient? = null
        private val vignettePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        private var vignetteGradient: android.graphics.RadialGradient? = null
        private val grainPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        private var grainBitmap: android.graphics.Bitmap? = null

        // Paint/shader/cache fields for the premium "membrane" (Crimson Bloom)
        // wallpaper. Enormous soft surfaces of pink-lavender and deep crimson
        // over a midnight-navy void, separated by one huge flowing curved boundary.
        private val membranePath = Path()
        private val membranePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        private var membraneGradient: android.graphics.RadialGradient? = null

        // Supernova accents for the membrane wallpaper: a pulsing energetic core
        // glow plus luminous rays that stream outward. A dedicated ray path and
        // stroke brush keep per-frame allocations to zero.
        private val rayPath = Path()
        private val rayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
        }
        private val corePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        private var coreGradient: android.graphics.RadialGradient? = null

        // Membrane renderer cache: the palette colours and unit radial gradients
        // are rebuilt ONLY when the accent hue changes, then positioned each frame
        // through a single reused matrix. This removes ~6 gradient objects and
        // ~12 small arrays of per-frame allocation (the previous hot path).
        private var mbCacheHue: Float = Float.NaN
        private val mbMatrix = android.graphics.Matrix()
        private var mbPink: android.graphics.RadialGradient? = null
        private var mbWine: android.graphics.RadialGradient? = null
        private var mbIndigo: android.graphics.RadialGradient? = null
        private var mbBoundary: android.graphics.RadialGradient? = null
        private var mbCoreGlow: android.graphics.RadialGradient? = null
        private var mbVignette: android.graphics.RadialGradient? = null
        private var mbWhiteHot = 0
        private var mbPaleHot = 0
        private var mbHotViolet = 0
        private var mbRayInner = 0
        private var mbRayHalo = 0

        private var fluidGradientRes = 0 // pixel height the cached gradient was built for
        private val batteryReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != Intent.ACTION_BATTERY_CHANGED) return
                val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                if (level >= 0 && scale > 0) {
                    batteryPercent = (level.toFloat() / scale.toFloat()).coerceIn(0f, 1f)
                }
                batteryIsCharging =
                    status == BatteryManager.BATTERY_STATUS_CHARGING ||
                        status == BatteryManager.BATTERY_STATUS_FULL
                Log.i(TAG, "BATTERY: percent=$batteryPercent charging=$batteryIsCharging")
            }
        }

        private val decodeFallbackFrame = object : Runnable {
            override fun run() {
                val retriever = frameFallbackRetriever ?: return
                val durationUs = frameFallbackDurationUs
                if (durationUs <= 0L) return

                val elapsedUs = (System.currentTimeMillis() - frameFallbackStartedAt) * 1000L
                val positionUs = if (shouldLoop) {
                    elapsedUs % durationUs
                } else {
                    // One-shot loops through a cycle made of play + fade-out + black
                    // hold + fade-in, so the clip restarts with a fade instead of
                    // freezing on the last frame. The fade alpha itself is blended in
                    // drawFrame() using the same cycle.
                    val fadeUs = oneShotFadeUs
                    val blackUs = oneShotBlackUs
                    val cycleUs = durationUs + fadeUs + blackUs + fadeUs
                    oneShotCycleUs = cycleUs
                    val pos = elapsedUs % cycleUs
                    when {
                        pos < durationUs -> pos
                        pos < durationUs + fadeUs -> durationUs - 1L
                        pos < durationUs + fadeUs + blackUs -> durationUs - 1L
                        else -> 0L
                    }
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
                    // One-shot never freezes on the last frame; it keeps cycling so
                    // the fade-to-black + fade-back-in loop runs continuously.
                    frameFallbackFinished = false
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
            stopConfigWatchdog()
            unregisterBatterySensors()
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
            if (wallpaperKind == "battery") registerBatterySensors()
            startExoPlayer(holder)
            refreshRendering()
            startConfigWatchdog()
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
            unregisterBatterySensors()
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
                        // Do NOT seek to the end here. The enforceDurationRunnable
                        // (started in startExoPlayer) advances one-shot playback to
                        // W_DURATION and holds it there once it is reached. Seeking to
                        // playbackDuration on every visibility event jumped a freshly
                        // loaded play-once video straight to the end before the first
                        // frame rendered, so the picker/preview showed an instant
                        // STATE_ENDED / black screen instead of playing once.
                        val playerAlive = exoPlayer != null && isPlayerReady
                        if (wallpaperKind == "video" && !playerAlive) {
                            // The engine was torn down during screen-off (surface
                            // destroyed released the player). If the system resumes the
                            // engine by visibility alone without a new onSurfaceCreated,
                            // a bare play() on a released player would leave the
                            // wallpaper frozen. Restart the full pipeline instead.
                            mainHandler.post { restartVideoPipeline() }
                        } else {
                            exoPlayer?.let { player ->
                                if (!shouldLoop) {
                                    // Play-once: always restart from the beginning
                                    // whenever the wallpaper becomes visible again
                                    // (leaving an app, returning home, screen-on/unlock).
                                    // Cancel any in-progress fade and seek to 0 (play() is
                                    // a no-op on a STATE_ENDED player, so seek first).
                                    cancelFade()
                                    player.seekTo(0L)
                                    player.play()
                                    scheduleEnforceDuration()
                                } else {
                                    player.play()
                                }
                            }
                        }
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
                if (wallpaperKind == "battery") {
                    registerBatterySensors()
                } else {
                    unregisterBatterySensors()
                }
                refreshRendering()
                startConfigWatchdog()
            } else {
                stopConfigWatchdog()
                unregisterBatterySensors()
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

            // One-shot ("play once") clips always render through the GPU texture
            // pipeline so the GL pass can blend the fade-to-black / fade-back-in
            // overlay smoothly on top of the live frames. Loop clips also use GL
            // when rotated; otherwise they render directly to the surface.
            val isRotated = videoRotationDegrees % 360 != 0
            val useGl = isRotated || !shouldLoop
            if (useGl) {
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
                Log.i(TAG, "Using GPU pipeline (rotation=$videoRotationDegrees, loop=$shouldLoop, oneShot=${!shouldLoop})")
            }

            Log.i(TAG, "STARTING EXOPLAYER FOR: $videoUri")
            logVideoMetadata(videoUri)

            synchronized(playerLock) {
                releaseExoPlayerLocked()
                videoFailed = false
                videoErrorMessage = ""
                isPlayerReady = false
                playerStartedAt = System.currentTimeMillis()

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
                                if (videoGlRenderer == null) {
                                    // ExoPlayer recovers after the watchdog fell
                                    // back to frame decoding; stop that background
                                    // decoding now that the real pipeline works.
                                    releaseFrameFallback()
                                }
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
                    // to 0. One-shot mode plays through once and then holds the
                    // final frame gracefully: pause the player and settle on the
                    // last frame instead of re-seeking forever, which looked stuck.
                    scheduleEnforceDuration()
                }
            }
        }

        private fun scheduleEnforceDuration() {
            // (Re)arms the duration watcher. When a finished play-once clip is
            // restarted from onVisibilityChanged, this re-arms the watcher so the
            // replayed clip is again cut to W_DURATION and held gracefully instead
            // of playing to its natural END and getting stuck again.
            val durationMs = playbackDuration * 1000L
            mainHandler.removeCallbacks(enforceDurationRunnable ?: Runnable {})
            enforceDurationRunnable = object : Runnable {
                var working = true
                override fun run() {
                    if (!working) return
                    synchronized(playerLock) {
                        val player = exoPlayer
                        if (player == null) { working = false; return }
                        val pos = player.currentPosition
                        if (shouldLoop) {
                            if (pos < durationMs) {
                                mainHandler.postDelayed(this, 500)
                                return
                            }
                            if (player.playbackState != Player.STATE_ENDED) {
                                player.seekTo(0L)
                            }
                            mainHandler.postDelayed(this, 500)
                        } else {
                            // One-shot: play the full clip, then fade to black when it
                            // actually ends (its real duration / STATE_ENDED) — never cut
                            // short at the W_DURATION preview window, or the fade would
                            // happen mid-video instead of on the last frame.
                            val endMs = if (player.duration > 0L) player.duration else durationMs
                            val ended = player.playbackState == Player.STATE_ENDED || pos >= endMs
                            if (!oneShotEndSeen && ended) {
                                beginFadeCycleLocked(player)
                            }
                            working = false
                        }
                    }
                }
            }
            mainHandler.postDelayed(enforceDurationRunnable!!, 500)
        }

        /**
         * Starts the fade-out phase for a finished one-shot clip. ExoPlayer is
         * paused first (leaving a static frame on the surface) so the engine canvas
         * can safely blend the black overlay, then playback restarts with a fade-in.
         * Must be called while holding playerLock.
         */
        private fun beginFadeCycleLocked(player: Player) {
            if (fadePhase != 0) return
            oneShotEndSeen = true
            player.pause()
            // Pause briefly so the final frame settles on the surface before we paint
            // over it, avoiding a flash of the previous frame.
            fadePhase = 1
            fadeAlpha = 0f
            fadeTickMs = System.currentTimeMillis() + fadeTickIntervalMs
            refreshRendering()
            mainHandler.postDelayed(fadeRunnable, fadeTickIntervalMs)
        }

        /** Finishes a fade-in and hands rendering back to live ExoPlayer playback. */
        private fun finishFadeCycleLocked(player: Player) {
            fadePhase = 0
            fadeAlpha = 0f
            oneShotEndSeen = false
            player.play()
            refreshRendering()
            scheduleEnforceDuration()
        }

        private fun ensureFadeRendering() {
            mainHandler.post { refreshRendering() }
        }

        private fun cancelFade() {
            mainHandler.removeCallbacks(fadeRunnable)
            fadePhase = 0
            fadeAlpha = 0f
            oneShotEndSeen = false
        }

        private fun releaseExoPlayer() {
            synchronized(playerLock) {
                releaseExoPlayerLocked()
            }
        }

        /**
         * Rebuilds the video/static pipeline from scratch. Used when the engine is
         * resumed by visibility alone after the surface/player were torn down
         * (screen off and back on on some devices), so the wallpaper does not stay
         * frozen on a released/buffering player.
         */
        private fun restartVideoPipeline() {
            Log.i(TAG, "Restarting pipeline from visibility resume")
            synchronized(playerLock) {
                releaseExoPlayerLocked()
            }
            releaseFrameFallback()
            releaseStaticImage()
            loadStaticImage()
            startExoPlayer(surfaceHolder)
            refreshRendering()
        }

        private fun releaseExoPlayerLocked() {
            mainHandler.removeCallbacks(enforceDurationRunnable ?: Runnable {})
            enforceDurationRunnable = null
            cancelFade()
            releaseGlRenderer()
            exoPlayer?.stop()
            exoPlayer?.release()
            exoPlayer = null
            isPlayerReady = false
            playerStartedAt = 0L
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

        /**
         * Non-rotated videos render straight to the wallpaper surface via
         * ExoPlayer. If the player never becomes ready (a stalled preview in the
         * system picker, a codec that refuses to start, etc.) the surface would
         * stay black forever, so we switch to the MediaMetadataRetriever-based
         * frame fallback after a short grace period instead of hanging.
         */
        private fun checkPlayerWatchdog() {
            synchronized(playerLock) {
                if (exoPlayer == null || isPlayerReady || videoFailed) return
                if (playerStartedAt == 0L) return
                if (System.currentTimeMillis() - playerStartedAt <= 4000L) return
            }
            if (frameFallbackRetriever != null) return
            val videoUri = try {
                Uri.parse(configuredVideoUriString)
            } catch (e: Exception) {
                null
            }
            if (videoUri != null) {
                Log.w(TAG, "ExoPlayer not ready within 4s; switching to frame fallback")
                frameFallbackFailures = 0
                startFrameFallback(videoUri)
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
                if (videoDurationMs <= 0L) {
                    retriever.release()
                    Log.e(TAG, "Frame fallback unavailable: video duration is invalid")
                    synchronized(playerLock) {
                        videoFailed = true
                        videoErrorMessage = "Video preview unavailable"
                    }
                    mainHandler.post { refreshRendering() }
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
                synchronized(playerLock) {
                    videoFailed = true
                    videoErrorMessage = "Could not decode video on this device"
                }
                mainHandler.post { refreshRendering() }
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

        /**
         * Black-fade alpha (0..1) for a one-shot clip at the given wall-clock time,
         * derived from the same play/fade-out/black/fade-in cycle used to pick the
         * decoded frame in decodeFallbackFrame(). Mirrors that cycle so the overlay
         * stays in sync with which region of video is being shown.
         */
        private fun oneShotFadeAlphaAt(nowMs: Long): Float {
            val cycleUs = oneShotCycleUs
            if (cycleUs <= 0L) return 0f
            val durationUs = frameFallbackDurationUs
            if (durationUs <= 0L) return 0f
            val fadeUs = oneShotFadeUs
            val blackUs = oneShotBlackUs
            val elapsedUs = (nowMs - frameFallbackStartedAt) * 1000L
            val pos = ((elapsedUs % cycleUs) + cycleUs) % cycleUs
            return when {
                pos < durationUs -> 0f
                pos < durationUs + fadeUs -> (pos - durationUs).toFloat() / fadeUs.toFloat()
                pos < durationUs + fadeUs + blackUs -> 1f
                else -> {
                    val t = (pos - (durationUs + fadeUs + blackUs)).toFloat() / fadeUs.toFloat()
                    1f - t.coerceIn(0f, 1f)
                }
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
                // One-shot clips use the GL pipeline (which composites the fade), so
                // they must run the render loop and never own the surface directly.
                // Only looping, non-rotated clips render through ExoPlayer directly.
                val videoOwnsSurface =
                    shouldLoop &&
                        fadePhase == 0 &&
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
                    (videoRotationDegrees % 360 != 0 || !shouldLoop) &&
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
                        // Apply the current one-shot fade blend before rendering so
                        // the fade-to-black/fade-back-in is composited on the frame.
                        val fade = synchronized(playerLock) { if (!shouldLoop) fadeAlpha else 0f }
                        renderer.setFadeAlpha(fade)
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
                // Legacy direct-surface / canvas render path (loop clips and fallback).
                if (wallpaperKind == "video" && videoGlRenderer == null) {
                    checkPlayerWatchdog()
                }
                val drawWithCanvas = synchronized(playerLock) {
                    wallpaperKind == "battery" ||
                        wallpaperKind == "membrane" ||
                        wallpaperKind == "static" ||
                        wallpaperKind == "doodle" ||
                        (wallpaperKind == "video" &&
                            videoGlRenderer == null &&
                            (videoFailed || videoRotationDegrees % 360 != 0 || frameFallbackBitmap != null || frameFallbackRetriever != null))
                }

                if (drawWithCanvas) {
                    var canvas: Canvas? = null
                    try {
                        canvas = holder.lockCanvas()
                        if (canvas != null) {
                            // Drive the animation off the exact vsync timestamp (nanos
                            // -> seconds). It is monotonic and frame-locked, so the motion
                            // glides smoothly with no accumulated-drift jitter.
                            val animSeconds =
                                if (wallpaperKind == "battery" || wallpaperKind == "membrane")
                                    frameTimeNanos / 1e9f
                                else fluidAnimTimeSec
                            drawFrame(canvas, animSeconds)
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

        /**
         * Renders the battery fluid wallpaper. Kept intentionally light: a single
         * smooth wave surface over a solid deep body, one Path fill per frame and
         * a stable monotonic clock, so it stays fluid without jitter on low-end
         * GPUs. Fill level tracks the real battery % and rises gradually.
         */
        private fun drawBatteryFluid(canvas: Canvas, elapsed: Float) {
            val w = canvas.width.toFloat()
            val h = canvas.height.toFloat()

            val target = batteryPercent.coerceIn(0f, 1f)
            fluidDisplayLevel += (target - fluidDisplayLevel) * 0.05f
            if (fluidDisplayLevel < 0.04f) fluidDisplayLevel = 0.04f

            canvas.drawColor(Color.parseColor("#05070C"))

            val fillTop = h - h * fluidDisplayLevel

            // Map the fluid colour to battery "health" across a full spectrum so the
            // level is readable at a glance: red/orange near empty, green in the
            // healthy mid-range, and a fresh cyan-blue near full. The chosen accent
            // seeds the hue family so the custom-colour picker still lands.
            val accentHsv = FloatArray(3)
            android.graphics.Color.colorToHSV(accentColor, accentHsv)

            // Build a health ramp in an HSV hue space centred around the accent hue:
            //   level 0   → hue -110° (roughly red/orange, urgent)
            //   level 50% → hue +0°  (the accent / healthy mid)
            //   level 100%→ hue +85° (fresh cyan-blue, full)
            // Wrapped into [0,360). Saturation is kept high, and only the hue moves.
            val rampHue = (accentHsv[0] - 110f + 240f * (fluidDisplayLevel.coerceIn(0f, 1f))).let { ((it % 360f) + 360f) % 360f }
            val sat = maxOf(0.65f, accentHsv[1])
            val value = if (batteryIsCharging) 0.98f else 0.82f
            val surfaceColor = Color.HSVToColor(floatArrayOf(rampHue, sat, value))
            val deepColor = Color.HSVToColor(floatArrayOf(rampHue, 0.9f, value * 0.4f))

            if (h.toInt() != fluidGradientRes) {
                fluidGradientRes = h.toInt()
                fluidGradient = android.graphics.LinearGradient(
                    0f, 0f, 0f, h, surfaceColor, deepColor, android.graphics.Shader.TileMode.CLAMP
                )
            }
            fluidFillPaint.shader = fluidGradient

            // Solid deep body (single cheap rect) so the wave never shows gaps.
            fluidFillPaint.shader = null
            fluidFillPaint.color = deepColor
            canvas.drawRect(0f, fillTop, w, h, fluidFillPaint)

            // One smooth wave surface: a primary roll plus a gentle counter-drift
            // for a natural, continuous slide. Low step count for speed.
            val amp = h * 0.014f
            val freq = 0.02f
            val speed = 3.0f
            val driftAmp = amp * 0.5f
            val driftFreq = 0.04f
            val steps = 56

            val surfacePath = fluidSurfacePath
            surfacePath.rewind()
            surfacePath.moveTo(-w * 0.3f, h)
            for (i in 0..steps) {
                val x = w * i.toFloat() / steps
                val y = fillTop +
                    amp * sin(elapsed * speed + i * freq) +
                    driftAmp * sin(elapsed * speed * 0.5f + i * driftFreq)
                surfacePath.lineTo(x, y)
            }
            surfacePath.lineTo(w + w * 0.3f, h)

            fluidFillPaint.shader = fluidGradient
            canvas.drawPath(surfacePath, fluidFillPaint)
            surfacePath.close()

            // Charging pulse: a soft bright line on the surface.
            if (batteryIsCharging) {
                val pulse = (sin(elapsed * 3.0) * 0.5 + 0.5) * 0.35f + 0.15f
                fluidBandPaint.color = Color.argb(((255 * pulse).toInt()).coerceIn(0, 255), 180, 255, 190)
                fluidBandPaint.strokeWidth = h * 0.007f
                canvas.drawPath(surfacePath, fluidBandPaint)
            }
        }

        /**
         * Renders the animated pixel-art wallpaper. Variants are chosen by the
         * configured accent colour:
         *  - calm (teal accent): minimalist symmetric grid, slowly flowing teal /
         *    ocean / navy blocks on dark navy — peaceful and meditative.
         *  - synth (pink accent): denser neon grid on pure black with vivid pink /
         *    cyan / violet colour-shifting blocks — retro-futuristic and hypnotic.
         *  - aura (deep-purple accent): premium flowing-gradient wallpaper — a few
         *    large soft radial-gradient orbs drifting and colour-blending over a
         *    dark charcoal background (see drawAura).
         * The pixel grids are pure drawRect fills (no shaders, allocations or
         * antialiasing) so they stay smooth even on low-end GPUs.
         */
        private fun drawPixelArt(canvas: Canvas, elapsed: Float) {
            if (pixelVariant == "aura") {
                drawAura(canvas, elapsed)
                return
            }

            val w = canvas.width.toFloat()
            val h = canvas.height.toFloat()

            val synth = pixelVariant == "synth"

            val palette: IntArray
            val bg: Int
            val cols: Int
            val rows: Int
            val flowSpeed: Float
            val waveSpread: Float
            val pulseSpeed: Float
            val baseAlpha: Float
            val alphaRange: Float

            if (synth) {
                palette = derivedPixelPalette
                bg = Color.parseColor("#000000")
                cols = 20
                rows = 36
                flowSpeed = 1.15f
                waveSpread = 0.7f
                pulseSpeed = 1.6f
                baseAlpha = 0.55f
                alphaRange = 0.45f
            } else {
                palette = derivedPixelPalette
                bg = Color.parseColor("#0A1622")
                cols = 12
                rows = 21
                flowSpeed = 0.5f
                waveSpread = 0.42f
                pulseSpeed = 0.7f
                baseAlpha = 0.5f
                alphaRange = 0.24f
            }

            canvas.drawColor(bg)

            val cellW = w / cols
            val cellH = h / rows

            val globalPulse = (sin(elapsed * (if (synth) 0.95f else 0.4f)) * 0.5 + 0.5f).toFloat()

            for (row in 0 until rows) {
                val y = row * cellH
                for (col in 0 until cols) {
                    val base = (col * 7 + row * 13) and 0x7FFFFFFF
                    val f = (sin(elapsed * flowSpeed + col * waveSpread + row * waveSpread) * 0.5 + 0.5f).toFloat()
                    val a = palette[base % palette.size]
                    val b = palette[(base + 1) % palette.size]
                    val pulse = (sin(elapsed * pulseSpeed + col * 0.3 + row * 0.9) * 0.5 + 0.5f).toFloat()
                    val alpha = ((baseAlpha + alphaRange * pulse) * (0.85f + 0.15f * globalPulse) * 255).toInt().coerceIn(0, 255)
                    val x = col * cellW

                    val r = (Color.red(a) + (Color.red(b) - Color.red(a)) * f).toInt()
                    val g = (Color.green(a) + (Color.green(b) - Color.green(a)) * f).toInt()
                    val bl = (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * f).toInt()
                    pixelPaint.color = (alpha shl 24) or (r shl 16) or (g shl 8) or bl
                    canvas.drawRect(x, y, x + cellW, y + cellH, pixelPaint)
                }
            }
        }

        /**
         * Premium "Dark Elegant" flowing-gradient wallpaper. Three large soft
         * radial-gradient orbs (charcoal / deep purple / soft lavender) drift and
         * expand slowly over a ~14s loop on a very dark charcoal background.
         * Only a handful of GPU-accelerated drawCircle calls per frame — no
         * particles, no complexity — so it stays 60 FPS and battery-friendly on
         * mid-range devices. Color blends and positions use simple linear sine
         * motion; gradients are built once per surface size and reused.
         */
        private fun drawAura(canvas: Canvas, elapsed: Float) {
            val w = canvas.width.toFloat()
            val h = canvas.height.toFloat()

            canvas.drawColor(Color.parseColor("#16161F"))

            if (auraGradientRes != canvas.width || auraGradients[0] == null) {
                // Derive aura orb tints from the chosen accent colour.
                val hsv = FloatArray(3)
                android.graphics.Color.colorToHSV(accentColor, hsv)
                val lightHsv = floatArrayOf(hsv[0], maxOf(0.4f, hsv[1] * 0.8f), minOf(1f, hsv[2] * 1.3f))
                val soft = android.graphics.Color.HSVToColor(lightHsv)
                val deep = android.graphics.Color.HSVToColor(floatArrayOf(hsv[0], minOf(1f, hsv[1] + 0.2f), maxOf(0.08f, hsv[2] * 0.5f)))
                auraGradients = arrayOf(
                    android.graphics.RadialGradient(0f, 0f, 1f, intArrayOf(soft, accentColor, deep),
                        floatArrayOf(0f, 0.55f, 1f), android.graphics.Shader.TileMode.CLAMP),
                    android.graphics.RadialGradient(0f, 0f, 1f, intArrayOf(accentColor, deep, soft),
                        floatArrayOf(0f, 0.5f, 1f), android.graphics.Shader.TileMode.CLAMP),
                    android.graphics.RadialGradient(0f, 0f, 1f, intArrayOf(soft, deep, accentColor),
                        floatArrayOf(0f, 0.6f, 1f), android.graphics.Shader.TileMode.CLAMP),
                )
                auraGradientRes = canvas.width
            }

            val loop = 14f
            val t = elapsed % loop

            // Three orbs drift on slow, independent sine loops.
            val orbData = arrayOf(
                Triple(0.28f, 0.32f, 0.0f),   // frac cx, frac cy(inv), phase
                Triple(0.62f, 0.58f, 2.1f),
                Triple(0.45f, 0.78f, 4.2f),
            )

            for (i in orbData.indices) {
                val (fx, fyInv, phase) = orbData[i]
                val cx = w * (fx + 0.12f * sin(t * 0.5 + phase).toFloat())
                val cy = h * (fyInv - 0.10f * cos(t * 0.4 + phase * 1.3).toFloat())
                val baseR = w * (0.34f + 0.05f * sin(t * 0.35 + phase * 2.0).toFloat())
                val radius = baseR * (0.9f + 0.25f * sin(t * 0.6 + phase).toFloat())

                val grad = auraGradients[i % auraGradients.size]
                grad?.let { g ->
                    auraPaint.shader = g
                    auraPaint.alpha = 150 + (110 * (0.5f + 0.5f * sin(t * 0.5 + phase).toFloat())).toInt()
                    // The cached gradient is unit-spaced; scale it to the orb radius
                    // by drawing through a centred transform.
                    canvas.save()
                    canvas.translate(cx, cy)
                    canvas.scale(radius, radius)
                    canvas.drawCircle(0f, 0f, 1f, auraPaint)
                    canvas.restore()
                }
            }
        }

        /**
         * Premium "living light" aurora wallpaper — the flagship dynamic style.
         *
         * A deep midnight-navy canvas carrying several large, feathered colour
         * fields (midnight navy, indigo, violet, electric purple, soft lavender,
         * magenta) that drift, stretch, rotate and breathe on slow independent
         * sine loops. Each field is a soft radial-gradient blob that bleeds past
         * the screen edges and blends into its neighbours, so the composition
         * morphs continuously with no visible beginning or end. A subtle rolling
         * film-grain veil and gentle vignette add depth while keeping the look
         * clean and OLED-friendly.
         */
        private fun drawAurora(canvas: Canvas, elapsed: Float) {
            val w = canvas.width.toFloat()
            val h = canvas.height.toFloat()

            // Deep midnight-navy canvas.
            canvas.drawColor(android.graphics.Color.rgb(2, 7, 20))

            // Derive the accent-seeded hues (midnight navy, indigo, violet, purple,
            // lavender, magenta) around the user's chosen accent colour.
            val accentHsv = FloatArray(3)
            android.graphics.Color.colorToHSV(accentColor, accentHsv)

            val base = accentHsv[0]
            val fields = arrayOf(
                // [hueOffset, saturation, value, sizeFrac, baseXFrac, cyFrac, bleed, alpha]
                floatArrayOf(0f, 0.62f, 0.16f, 1.35f, 0.02f, 0.06f, 0.35f, 0.95f),  // midnight navy
                floatArrayOf(-28f, 0.62f, 0.32f, 1.15f, 0.14f, 0.12f, 0.4f, 0.55f), // indigo
                floatArrayOf(-10f, 0.7f, 0.42f, 1.05f, 0.42f, 0.32f, 0.22f, 0.55f), // violet
                floatArrayOf(12f, 0.75f, 0.55f, 0.95f, 0.60f, 0.50f, 0.28f, 0.5f),  // electric purple
                floatArrayOf(30f, 0.55f, 0.78f, 0.9f, 0.72f, 0.62f, 0.18f, 0.5f),  // soft lavender
                floatArrayOf(52f, 0.7f, 0.66f, 1.0f, 0.98f, 0.82f, 0.4f, 0.42f),  // magenta / hot pink
            )

            // Layer count-controlled blobs so the effect is rich but still cheap.
            val layers = 3
            val loop = 34f // very slow, seamless loop
            val t = elapsed % loop

            for (li in 0 until layers) {
                for (field in fields) {
                    val hueOffset = field[0]; val sat = field[1]; val value = field[2]
                    val sizeFrac = field[3]; val cxFrac = field[4]; val cyFrac = field[5]
                    val bleed = field[6]; val alpha = field[7]

                    // Independent sinusoidal motion per layer: large forms drift,
                    // and the hue subtly flows so colours migrate between regions.
                    val phase = li * 1.7f + hueOffset * 0.03f
                    val cx = w * (cxFrac + 0.10f * sin(t * 0.35f + phase).toFloat())
                    val cy = h * (cyFrac - 0.08f * cos(t * 0.28f + phase * 1.1).toFloat())
                    val radius = w * (sizeFrac * 0.5f) * (0.92f + 0.16f * sin(t * 0.2f + phase * 2.0).toFloat())

                    // Gentle hue drift so neighbouring regions blend into each other.
                    val hue = (base + hueOffset + 8.0f * sin(t * 0.05f + phase).toFloat() + 360.0f) % 360.0f
                    val center = android.graphics.Color.HSVToColor(
                        floatArrayOf(hue, sat.coerceIn(0.35f, 0.85f), value.coerceIn(0.12f, 0.9f))
                    )

                    // Feathered radial gradient: centre colour → soft edge (transparent).
                    var colorInt = center.toInt()
                    val cRed = (colorInt shr 16) and 0xFF
                    val cGreen = (colorInt shr 8) and 0xFF
                    val cBlue = colorInt and 0xFF
                    val fade = android.graphics.Color.argb(
                        ((alpha * 255).toInt()).coerceIn(0, 255),
                        cRed, cGreen, cBlue
                    )

                    if (li == 0) {
                        auroraGradient = android.graphics.RadialGradient(
                            0f, 0f, 1f,
                            intArrayOf(fade, center, android.graphics.Color.TRANSPARENT),
                            floatArrayOf(0f, 0.55f, 1f),
                            android.graphics.Shader.TileMode.CLAMP
                        )
                    } else {
                        auroraGradient = android.graphics.RadialGradient(
                            0f, 0f, 1f,
                            intArrayOf(fade, center, android.graphics.Color.TRANSPARENT),
                            floatArrayOf(0.1f, 0.6f, 1f),
                            android.graphics.Shader.TileMode.CLAMP
                        )
                    }

                    // Draw the feathered blob, allowing it to bleed far past the edges.
                    val scale = radius * (1f + bleed)
                    auroraPaint.shader = auroraGradient
                    auroraPaint.alpha = ((alpha * 255) * (0.75f + 0.25f * sin(t * 0.4f + phase * 1.3f).toFloat())).toInt().coerceIn(0, 255)
                    canvas.save()
                    canvas.translate(cx, cy)
                    canvas.scale(scale, scale)
                    canvas.drawCircle(0f, 0f, 1f, auroraPaint)
                    canvas.restore()
                }
            }

            // Soft vignette to deepen the corners and keep the composition centred.
            vignetteGradient = android.graphics.RadialGradient(
                w / 2f, h / 2f, h * 0.9f,
                intArrayOf(android.graphics.Color.TRANSPARENT, android.graphics.Color.argb(120, 0, 2, 12)),
                floatArrayOf(0.55f, 1f),
                android.graphics.Shader.TileMode.CLAMP
            )
            vignettePaint.shader = vignetteGradient
            canvas.drawRect(0f, 0f, w, h, vignettePaint)

            // Subtle rolling film grain for texture (fast, non-allocating-ish via paint).
            val currentGrain = grainBitmap
            if (currentGrain == null || currentGrain.width != canvas.width) {
                buildGrain(canvas.width, canvas.height)
            }
            grainBitmap?.let { gb ->
                grainPaint.alpha = 26 + (6 * sin(elapsed * 0.7).toInt())
                canvas.drawBitmap(gb, 0f, 0f, grainPaint)
            }
        }

        private fun buildGrain(width: Int, height: Int) {
            if (width <= 0 || height <= 0) return
            val smallW = (width / 4).coerceAtLeast(1)
            val smallH = (height / 4).coerceAtLeast(1)
            val bmp = android.graphics.Bitmap.createBitmap(smallW, smallH, android.graphics.Bitmap.Config.ARGB_8888)
            val pixels = IntArray(smallW * smallH)
            val rnd = java.util.Random(1337)
            for (i in pixels.indices) {
                val v = (rnd.nextInt(40) - 20 + 128).coerceIn(0, 255)
                pixels[i] = android.graphics.Color.argb(255, v, v, v)
            }
            bmp.setPixels(pixels, 0, smallW, 0, 0, smallW, smallH)
            grainBitmap = bmp
            grainPaint.isFilterBitmap = true
        }

        private fun drawMembrane(canvas: Canvas, elapsed: Float) {
            val w = canvas.width.toFloat()
            val h = canvas.height.toFloat()

            // Deep midnight-navy void (spacious upper/right negative space),
            // just above pure black so the OLED panel can rest true blacks.
            canvas.drawColor(Color.rgb(2, 6, 16))

            val accentHsv = FloatArray(3)
            android.graphics.Color.colorToHSV(accentColor, accentHsv)
            val baseHue = accentHsv[0]

            // One seamless, ultra-slow loop. Every term is a submultiple so the
            // whole composition returns to its start with no visible jump.
            val loop = 44f
            val t = elapsed % loop
            val p = (2f * Math.PI * (t / loop)).toFloat()

            // Rebuild the cached palette + unit gradients only when the accent hue
            // changes (user picks a new accent colour), not every frame.
            if (mbCacheHue != baseHue) mbBuildCache(baseHue)

            // A small helper: slow sum-of-sines drift (phase-shifted, integer
            // harmonics) so gestures never speed up and the loop stays seamless.
            // Pure Float (no Double boxing) to keep the render loop cheap.
            fun drift(a: Float, b: Float, c: Float): Float {
                val A = a; val B = b; val C = c; val P = p
                return 0.5f * kotlin.math.sin(A * P + B) +
                    0.3f * kotlin.math.sin(2.0f * A * P + C + 1.7f) +
                    0.2f * kotlin.math.sin(3.0f * A * P + B * 1.3f)
            }

            // Reposition a cached unit radial gradient to (cx, cy, radius) using
            // the shared matrix — no per-frame shader or array allocation.
            fun place(paint: Paint, shader: android.graphics.RadialGradient?, cx: Float, cy: Float, radius: Float) {
                mbMatrix.setTranslate(cx, cy)
                mbMatrix.preScale(radius, radius)
                shader?.setLocalMatrix(mbMatrix)
                paint.shader = shader
            }

            // ---- 1. The luminous pink/lavender surface, lower-left ----
            // Enormous radius so the bright pale core is pushed toward the bottom
            // edge and the feather bleeds up into the middle and left — reading as
            // one huge curved organic surface, not a centred orb.
            val pA = drift(0.55f, 0.0f, 0.4f)
            val pinkCx = w * (0.30f + 0.04f * pA)
            val pinkCy = h * (0.78f + 0.05f * drift(0.5f, 2.1f, 1.2f))
            val pinkR = h * (0.95f + 0.08f * drift(0.33f, 1.0f, 0.2f))
            place(membranePaint, mbPink, pinkCx, pinkCy, pinkR)
            membranePaint.alpha = 255
            canvas.drawRect(0f, 0f, w, h, membranePaint)

            // ---- 2. The deep crimson / wine surface, lower-right ----
            // Darker and atmospheric, merging into the pink region above the sweep.
            val pB = drift(0.48f, 3.0f, 1.9f)
            val wineCx = w * (0.86f + 0.05f * pB)
            val wineCy = h * (0.85f + 0.04f * drift(0.42f, 4.4f, 0.9f))
            val wineR = h * (1.0f + 0.06f * drift(0.28f, 2.2f, 3.1f))
            place(membranePaint, mbWine, wineCx, wineCy, wineR)
            membranePaint.alpha = 235
            canvas.drawRect(0f, 0f, w, h, membranePaint)

            // ---- 3. The deep-navy/indigo upper region ----
            // A cool, very dark mass in the upper-left keeps the empty navy top
            // from feeling flat while leaving the upper-right truly sparse.
            val indigoCx = w * (0.18f + 0.05f * drift(0.5f, 5.0f, 0.6f))
            val indigoCy = h * (0.16f + 0.05f * drift(0.44f, 1.4f, 2.6f))
            val indigoR = h * (0.55f + 0.10f * drift(0.38f, 3.6f, 1.5f))
            place(membranePaint, mbIndigo, indigoCx, indigoCy, indigoR)
            membranePaint.alpha = 170
            canvas.drawRect(0f, 0f, w, h, membranePaint)

            // ---- 4. One huge flowing curved boundary ----
            // A single organic curve sweeping from upper-middle down to the lower
            // third, feathered on both sides. It carves out the negative space and
            // gives the surfaces their 2.5D depth without any hard edge.
            val sweepX = w * (0.62f + 0.05f * drift(0.5f, 0.8f, 2.2f))
            val amp = h * (0.14f + 0.05f * drift(0.4f, 5.5f, 0.3f))
            val peakY = h * (0.30f + 0.06f * drift(0.3f, 2.6f, 4.1f))
            membranePath.reset()
            membranePath.moveTo(-w, h)
            membranePath.cubicTo(
                w * 0.10f, h * (0.96f + 0.04f * drift(0.35f, 6.0f, 0.5f)),  // control 1
                w * 0.34f, h * 0.86f - amp,                                        // control 2
                sweepX, peakY                                                       // end (upper, on the dark side)
            )
            membranePath.cubicTo(
                sweepX + amp, peakY - h * 0.12f,
                w * 1.05f, h * 0.10f,
                w * 1.2f, -h * 0.2f
            )
            membranePath.lineTo(w * 1.2f, h)
            membranePath.close()

            place(membranePaint, mbBoundary, sweepX - w * 0.18f, peakY + amp, h * 0.9f)
            membranePaint.alpha = 120
            canvas.drawPath(membranePath, membranePaint)

            // ---- 5. "Moving supernova" core + radiating rays ----
            // A bright, breathing energy heart with a soft expanding glow, then
            // a set of luminous rays that stream outward from it — the active,
            // supernova-like motion layer on top of the calm colour surfaces.
            val coreX = w * (0.32f + 0.05f * drift(0.5f, 4.0f, 1.1f))
            val coreY = h * (0.72f + 0.05f * drift(0.44f, 6.2f, 2.4f))

            // Core brightness and size breathe on a slow, audible "heartbeat".
            val beat = 0.5f + 0.5f * sin(elapsed * 0.9f).toFloat() // 0..1
            val coreR = w * (0.085f + 0.030f * beat)

            // Soft outer glow that swells around the core.
            place(corePaint, mbCoreGlow, coreX, coreY, coreR * 3.4f)
            corePaint.alpha = (110 + 90 * beat).toInt().coerceIn(0, 255)
            canvas.drawCircle(coreX, coreY, coreR * 3.4f, corePaint)

            // Bright inner heart.
            corePaint.shader = null
            corePaint.color = mbWhiteHot
            corePaint.alpha = (170 + 70 * beat).toInt().coerceIn(0, 255)
            canvas.drawCircle(coreX, coreY, coreR, corePaint)

            // Radiating rays: each one sways, rotates and pulses independently so
            // the whole field streams outward like supernova filaments.
            val rayCount = 12
            repeat(rayCount) { i ->
                val base = (i.toFloat() / rayCount) * 2f * Math.PI.toFloat()
                val rot = base + 0.7f * sin(elapsed * 0.22f + i * 1.7f).toFloat()
                val sway = 0.6f * sin(elapsed * 0.31f + i * 2.3f).toFloat()
                val lenBreath = 0.5f + 0.5f * sin(elapsed * 0.40f + i * 1.1f).toFloat()
                val length = w * (0.45f + 0.95f * lenBreath)
                val startX = coreX + cos(rot) * coreR
                val startY = coreY + sin(rot) * coreR
                val endX = coreX + cos(rot + sway * 0.2f) * length
                val endY = coreY + sin(rot + sway * 0.2f) * length
                // A control point off the chord curving each ray into a filament.
                val mx = (startX + endX) / 2f + cos(sway) * (endY - startY) * 0.22f
                val my = (startY + endY) / 2f - sin(sway) * (endX - startX) * 0.22f

                rayPath.reset()
                rayPath.moveTo(startX, startY)
                rayPath.quadTo(mx, my, endX, endY)

                // Soft luminous halo around the ray.
                rayPaint.shader = null
                rayPaint.color = mbRayHalo
                rayPaint.strokeWidth = w * (0.014f + 0.010f * beat)
                rayPaint.alpha = (26 + 30 * lenBreath).toInt().coerceIn(0, 90)
                canvas.drawPath(rayPath, rayPaint)

                // Bright inner filament.
                rayPaint.color = mbRayInner
                rayPaint.strokeWidth = w * (0.0035f + 0.0025f * beat)
                rayPaint.alpha = (120 + 110 * beat).toInt().coerceIn(0, 235)
                canvas.drawPath(rayPath, rayPaint)
            }

            // ---- Soft vignette to dim the corners and centre the glow ----
            place(vignettePaint, mbVignette, w / 2f, h * 0.45f, h * 0.95f)
            canvas.drawRect(0f, 0f, w, h, vignettePaint)
        }

        private fun mbHsv(baseHue: Float, hueOffset: Float, sat: Float, value: Float): Int =
            android.graphics.Color.HSVToColor(
                floatArrayOf(((baseHue + hueOffset) % 360f + 360f) % 360f, sat.coerceIn(0f, 1f), value.coerceIn(0f, 1f))
            )

        // Build the membrane palette + unit radial gradients once per accent hue.
        // The gradients are anchored at the origin with unit radius and moved each
        // frame via mbMatrix, so this runs only on accent changes — never per frame.
        private fun mbBuildCache(baseHue: Float) {
            mbWhiteHot = mbHsv(baseHue, -2f, 0.16f, 1.0f)
            mbPaleHot = mbHsv(baseHue, -8f, 0.45f, 0.95f)
            mbHotViolet = mbHsv(baseHue, -22f, 0.6f, 0.7f)
            mbRayInner = mbHsv(baseHue, -10f, 0.5f, 0.96f)
            mbRayHalo = mbHsv(baseHue, -20f, 0.55f, 0.78f)

            fun unit(colors: IntArray, positions: FloatArray) =
                android.graphics.RadialGradient(0f, 0f, 1f, colors, positions, android.graphics.Shader.TileMode.CLAMP)

            mbPink = unit(
                intArrayOf(
                    mbHsv(baseHue, -6f, 0.32f, 0.97f),
                    mbHsv(baseHue, -18f, 0.5f, 0.85f),
                    mbHsv(baseHue, -30f, 0.62f, 0.62f),
                    mbHsv(baseHue, -40f, 0.66f, 0.42f),
                    android.graphics.Color.TRANSPARENT
                ),
                floatArrayOf(0f, 0.28f, 0.55f, 0.78f, 1f)
            )
            mbWine = unit(
                intArrayOf(
                    mbHsv(baseHue, 8f, 0.7f, 0.55f),
                    mbHsv(baseHue, 10f, 0.78f, 0.38f),
                    mbHsv(baseHue, 16f, 0.8f, 0.22f),
                    android.graphics.Color.TRANSPARENT
                ),
                floatArrayOf(0f, 0.32f, 0.62f, 1f)
            )
            mbIndigo = unit(
                intArrayOf(
                    mbHsv(baseHue, -52f, 0.55f, 0.16f),
                    mbHsv(baseHue, -34f, 0.55f, 0.30f),
                    android.graphics.Color.TRANSPARENT
                ),
                floatArrayOf(0f, 0.45f, 1f)
            )
            mbBoundary = unit(
                intArrayOf(
                    mbHsv(baseHue, -14f, 0.42f, 0.66f),
                    mbHsv(baseHue, -34f, 0.6f, 0.4f),
                    android.graphics.Color.TRANSPARENT
                ),
                floatArrayOf(0f, 0.5f, 1f)
            )
            mbCoreGlow = unit(
                intArrayOf(mbWhiteHot, mbPaleHot, mbHotViolet, android.graphics.Color.TRANSPARENT),
                floatArrayOf(0f, 0.30f, 0.62f, 1f)
            )
            mbVignette = unit(
                intArrayOf(android.graphics.Color.TRANSPARENT, android.graphics.Color.argb(150, 0, 3, 14)),
                floatArrayOf(0.5f, 1f)
            )
            mbCacheHue = baseHue
        }

        private fun drawFrame(canvas: Canvas, animSeconds: Float) {
            val elapsed = if (wallpaperKind == "battery" || wallpaperKind == "membrane")
                animSeconds else (System.currentTimeMillis() - startedAt) / 1000f
            val bgColor = Color.parseColor("#020817")
            canvas.drawColor(bgColor)

            val centerX = canvas.width / 2f
            val centerY = canvas.height / 2f
            val size = canvas.width.coerceAtMost(canvas.height)

            if (wallpaperKind == "battery") {
                drawBatteryFluid(canvas, elapsed)
                return
            }

            if (wallpaperKind == "membrane") {
                drawMembrane(canvas, elapsed)
                return
            }

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
                if (renderFrameFallback(canvas)) {
                    // One-shot: blend the black fade over the final/start frames so the
                    // clip fades out to black, holds, then fades back in and replays.
                    if (!shouldLoop && !videoFailed && oneShotCycleUs > 0) {
                        val alpha = oneShotFadeAlphaAt(System.currentTimeMillis())
                        if (alpha > 0f) {
                            canvas.drawColor(Color.argb((alpha * 255).toInt(), 0, 0, 0))
                        }
                    }
                    return
                }
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
            val committedPrefs = getSharedPreferences("wallpaper_pref", MODE_PRIVATE)
            val previewPrefs = getSharedPreferences("wallpaper_preview_pref", MODE_PRIVATE)

            // Preview engines (the system wallpaper picker) show the pending
            // selection being applied. Settled engines always read the committed
            // wallpaper so a cancelled preview never changes what is set.
            val usePreview =
                isPreview && !previewPrefs.getString("W_KIND", "").orEmpty().isBlank()
            val preferences = if (usePreview) previewPrefs else committedPrefs

            wallpaperKind = preferences.getString("W_KIND", "doodle").orEmpty()
            configuredVideoUriString = preferences.getString("W_PATH", "").orEmpty()
            shouldLoop = preferences.getBoolean("W_LOOP", true)
            includeAudio = preferences.getBoolean("W_AUDIO", false)
            playbackDuration = preferences.getInt("W_DURATION", 30).coerceIn(1, 30)
            videoRotationDegrees = preferences.getInt("W_ROTATION", 0).coerceIn(0, 270)

            val accentStr = preferences.getString("W_ACCENT", "#7C3AED") ?: "#7C3AED"
            accentColor = try { Color.parseColor(accentStr) } catch (_: Exception) { Color.parseColor("#7C3AED") }

            // Derive pixel variant from accent brightness instead of exact colour match.
            val hsv = FloatArray(3)
            Color.colorToHSV(accentColor, hsv)
            pixelVariant = when {
                hsv[1] < 0.35f && hsv[2] > 0.8f -> "calm"
                hsv[2] < 0.35f -> "aura"
                else -> "synth"
            }

            // Build a 3-colour palette from the accent: accent itself, a hue-shifted
            // complement, and a dark/shadow tone — replacing the old hardcoded arrays.
            val compHsv = floatArrayOf((hsv[0] + 150) % 360, maxOf(0.55f, hsv[1]), minOf(1f, hsv[2] + 0.1f))
            val darkHsv = floatArrayOf((hsv[0] + 30) % 360, maxOf(0.4f, hsv[1]), maxOf(0.15f, hsv[2] * 0.35f))
            derivedPixelPalette = intArrayOf(
                accentColor,
                Color.HSVToColor(compHsv),
                Color.HSVToColor(darkHsv),
            )

            // Secondary colour for doodle orbit: accent hue opposite on the wheel.
            hsv[0] = (hsv[0] + 180) % 360
            secondaryColor = Color.HSVToColor(hsv)

            auraGradientRes = 0 // force aura gradients to rebuild for a new surface size

            Log.i(TAG, "LOAD CONFIG (${if (usePreview) "preview" else "committed"}): kind=$wallpaperKind, path=$configuredVideoUriString, rotation=$videoRotationDegrees")
            if (configuredVideoUriString.startsWith("file://")) {
                val configuredFile = File(Uri.parse(configuredVideoUriString).path ?: "")
                Log.i(TAG, "Configured file: path=${configuredFile.absolutePath} exists=${configuredFile.exists()} bytes=${configuredFile.length()} readable=${configuredFile.canRead()}")
            }
        }

        /** Registers the battery broadcast receiver once for the fluid wallpaper. */
        private fun registerBatterySensors() {
            if (batterySensorsRegistered) return
            batterySensorsRegistered = true
            try {
                mainHandler.post {
                    try {
                        registerReceiver(
                            batteryReceiver,
                            IntentFilter(Intent.ACTION_BATTERY_CHANGED)
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "Battery receiver registration failed", e)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Battery receiver registration failed", e)
            }
        }

        private fun unregisterBatterySensors() {
            if (!batterySensorsRegistered) return
            batterySensorsRegistered = false
            try {
                mainHandler.post {
                    try {
                        unregisterReceiver(batteryReceiver)
                    } catch (_: Exception) {
                        // receiver may already be unregistered
                    }
                }
            } catch (_: Exception) {
            }
        }

        private fun startConfigWatchdog() {
            if (configWatchdogRunning) return
            configWatchdogRunning = true
            mainHandler.postDelayed(configWatchdog, 1000L)
        }

        private fun stopConfigWatchdog() {
            configWatchdogRunning = false
            mainHandler.removeCallbacks(configWatchdog)
        }

        /** Stable signature of the config the engine currently has in memory. */
        private fun currentConfigSignature(): String =
            "$wallpaperKind|$configuredVideoUriString|$shouldLoop|$includeAudio|$playbackDuration|$videoRotationDegrees|$accentColor"

        /** Signature of the config the engine *should* use, read fresh from disk. */
        private fun expectedConfigSignature(): String {
            val committedPrefs = getSharedPreferences("wallpaper_pref", MODE_PRIVATE)
            val previewPrefs = getSharedPreferences("wallpaper_preview_pref", MODE_PRIVATE)
            val usePreview =
                isPreview && !previewPrefs.getString("W_KIND", "").orEmpty().isBlank()
            val preferences = if (usePreview) previewPrefs else committedPrefs
            val kind = preferences.getString("W_KIND", "doodle").orEmpty()
            val path = preferences.getString("W_PATH", "").orEmpty()
            val loop = preferences.getBoolean("W_LOOP", true)
            val audio = preferences.getBoolean("W_AUDIO", false)
            val duration = preferences.getInt("W_DURATION", 30).coerceIn(1, 30)
            val rotation = preferences.getInt("W_ROTATION", 0).coerceIn(0, 270)
            val accentStr = preferences.getString("W_ACCENT", "#7C3AED") ?: "#7C3AED"
            val accent = try {
                Color.parseColor(accentStr)
            } catch (_: Exception) {
                Color.parseColor("#7C3AED")
            }
            return "$kind|$path|$loop|$audio|$duration|$rotation|$accent"
        }

        /** Reload config from disk and rebuild player/renderers without a visibility change. */
        private fun reloadConfigurationFromDisk() {
            val previousKind = wallpaperKind
            val previousUri = configuredVideoUriString
            val previousLoop = shouldLoop
            val previousAudio = includeAudio
            val previousDuration = playbackDuration
            val previousRotation = videoRotationDegrees

            loadConfiguration()
            loadStaticImage()

            val configChanged =
                previousKind != wallpaperKind ||
                    previousUri != configuredVideoUriString ||
                    previousLoop != shouldLoop ||
                    previousAudio != includeAudio ||
                    previousDuration != playbackDuration ||
                    previousRotation != videoRotationDegrees

            if (!configChanged) return

            Log.i(TAG, "WATCHDOG RELOAD: kind $previousKind->$wallpaperKind, uri $previousUri->$configuredVideoUriString, loop $previousLoop->$shouldLoop, audio $previousAudio->$includeAudio, duration $previousDuration->$playbackDuration, rotation $previousRotation->$videoRotationDegrees")
            if (wallpaperKind == "battery") {
                registerBatterySensors()
            } else {
                unregisterBatterySensors()
            }
            releaseExoPlayer()
            releaseStaticImage()
            loadStaticImage()
            startExoPlayer(surfaceHolder)
            refreshRendering()
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
