package com.wall_e.wallpaper

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.SurfaceHolder
import java.io.File

class LiveWallpaperService : WallpaperService() {
    override fun onCreateEngine(): Engine = WallpaperEngine()

    private inner class WallpaperEngine : WallpaperService.Engine() {
        // Dedicated thread for doodle rendering — keeps main thread free
        private var renderThread: HandlerThread? = null
        private var renderHandler: Handler? = null
        private val mainHandler = Handler(Looper.getMainLooper())

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

        private var drawRunnable: Runnable? = null
        private var mediaPlayer: MediaPlayer? = null
        private val mediaPlayerLock = Any()
        private var videoPrepared = false
        private var videoCompleted = false
        private var startedAt = 0L
        private var playbackRestart: Runnable? = null

        // Cached configuration — avoids re-reading SharedPreferences on every frame/callback
        private var wallpaperId = ""
        private var wallpaperKind = "doodle"
        private var configuredVideoUri = ""
        private var accentColor = Color.parseColor("#7C3AED")
        private var secondaryColor = Color.parseColor("#22D3EE")
        private var shouldLoop = true
        private var includeAudio = false
        private var videoDurationSeconds = 30
        private var videoFailed = false

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setTouchEventsEnabled(false)
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            if (!holder.surface.isValid) return
            loadConfiguration()
            startVideoIfConfigured(holder)
            startRendering()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            if (wallpaperKind == "video" && holder.surface.isValid) {
                synchronized(mediaPlayerLock) {
                    if (mediaPlayer == null) {
                        startVideoIfConfigured(holder)
                    } else {
                        try {
                            mediaPlayer?.setSurface(holder.surface)
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to update surface on media player", e)
                        }
                    }
                }
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            stopRendering()
            stopRenderThread()
            mainHandler.removeCallbacksAndMessages(null)
            releaseVideo()
        }

        override fun onVisibilityChanged(visible: Boolean) {
            super.onVisibilityChanged(visible)
            if (visible) {
                val previousWallpaperId = wallpaperId
                val previousWallpaperKind = wallpaperKind
                val previousVideoUri = configuredVideoUri
                loadConfiguration()

                // If config changed, restart the video
                if (previousWallpaperId != wallpaperId ||
                    previousWallpaperKind != wallpaperKind ||
                    previousVideoUri != configuredVideoUri) {
                    releaseVideo()
                    videoFailed = false
                    val holder = surfaceHolder
                    if (holder != null && holder.surface.isValid) {
                        startVideoIfConfigured(holder)
                    }
                }

                synchronized(mediaPlayerLock) {
                    val player = mediaPlayer
                    if (player != null) {
                        if (videoPrepared) {
                            try {
                                player.start()
                                schedulePlaybackRestart()
                            } catch (e: Exception) {
                                Log.w(TAG, "Failed to resume video playback", e)
                            }
                        } else if (videoCompleted) {
                            try {
                                player.seekTo(0)
                                player.start()
                                videoPrepared = true
                                videoCompleted = false
                                schedulePlaybackRestart()
                            } catch (e: Exception) {
                                Log.w(TAG, "Failed to restart completed video", e)
                            }
                        }
                    }
                }
                startRendering()
            } else {
                synchronized(mediaPlayerLock) {
                    try {
                        mediaPlayer?.pause()
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to pause video", e)
                    }
                }
                cancelPlaybackRestart()
                stopRendering()
            }
        }

        private fun ensureRenderThread(): Handler {
            if (renderThread == null || renderThread?.isAlive != true) {
                renderThread = HandlerThread("WallpaperRenderThread").also { it.start() }
                renderHandler = Handler(renderThread!!.looper)
            }
            return renderHandler!!
        }

        private fun stopRenderThread() {
            renderThread?.quitSafely()
            renderThread = null
            renderHandler = null
        }

        private fun startRendering() {
            stopRendering()
            startedAt = System.currentTimeMillis()
            val handler = ensureRenderThread()

            drawRunnable = object : Runnable {
                override fun run() {
                    val holder = surfaceHolder ?: return

                    // For video wallpapers where video is playing fine, don't draw over it
                    val isVideoPlaying = synchronized(mediaPlayerLock) {
                        wallpaperKind == "video" && mediaPlayer != null && videoPrepared && !videoFailed
                    }
                    if (isVideoPlaying) {
                        // Video renders itself to the surface; just schedule the next check
                        handler.postDelayed(this, 500)
                        return
                    }

                    var canvas: Canvas? = null
                    try {
                        canvas = holder.lockCanvas()
                        if (canvas != null) {
                            drawFrame(canvas)
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Render frame error", e)
                    } finally {
                        if (canvas != null) {
                            try {
                                holder.unlockCanvasAndPost(canvas)
                            } catch (e: Exception) {
                                Log.w(TAG, "Failed to post canvas", e)
                            }
                        }
                    }
                    handler.postDelayed(this, 16) // ~60fps
                }
            }
            handler.post(drawRunnable!!)
        }

        private fun drawFrame(canvas: Canvas) {
            val elapsed = (System.currentTimeMillis() - startedAt) / 1000f
            val bgColor = try { Color.parseColor("#020817") } catch (_: Exception) { Color.BLACK }
            canvas.drawColor(bgColor)

            val centerX = canvas.width / 2f
            val centerY = canvas.height / 2f
            val size = canvas.width.coerceAtMost(canvas.height)

            if (wallpaperKind == "video" && videoFailed) {
                // Fallback: draw a subtle animated gradient when video fails
                paint.color = accentColor
                val pulseRadius = size * (0.12f + 0.03f * kotlin.math.sin(elapsed * 1.5f))
                canvas.drawCircle(centerX, centerY, pulseRadius, paint)
                secondaryPaint.color = Color.argb(80, 255, 255, 255)
                secondaryPaint.textSize = size * 0.04f
                secondaryPaint.textAlign = Paint.Align.CENTER
                canvas.drawText("Video unavailable", centerX, centerY + size * 0.22f, secondaryPaint)
                return
            }

            // Doodle animation
            val radius = size * (0.18f + 0.025f * kotlin.math.sin(elapsed * 2.2f))
            paint.color = accentColor
            canvas.drawCircle(centerX, centerY, radius, paint)

            secondaryPaint.color = secondaryColor
            val orbitX = centerX + radius * (0.7f + 0.12f * kotlin.math.sin(elapsed * 1.4f))
            val orbitY = centerY - radius * 0.5f
            canvas.drawCircle(orbitX, orbitY, radius * 0.42f, secondaryPaint)

            // Third smaller accent orb for visual richness
            val smallOrbitX = centerX - radius * (0.5f + 0.08f * kotlin.math.cos(elapsed * 1.8f))
            val smallOrbitY = centerY + radius * (0.6f + 0.1f * kotlin.math.sin(elapsed * 2.5f))
            secondaryPaint.color = Color.argb(100, 255, 255, 255)
            canvas.drawCircle(smallOrbitX, smallOrbitY, radius * 0.25f, secondaryPaint)
        }

        private fun startVideoIfConfigured(holder: SurfaceHolder) {
            if (wallpaperKind != "video" || configuredVideoUri.isBlank() || !holder.surface.isValid) {
                releaseVideo()
                return
            }

            // Validate the video file exists before trying to play it
            val videoFile = try { File(Uri.parse(configuredVideoUri).path ?: "") } catch (_: Exception) { null }
            if (videoFile == null || !videoFile.exists()) {
                Log.e(TAG, "Video file does not exist: $configuredVideoUri")
                videoFailed = true
                releaseVideo()
                return
            }

            synchronized(mediaPlayerLock) {
                try {
                    releaseVideoLocked()
                    videoFailed = false
                    mediaPlayer = MediaPlayer().apply {
                        videoPrepared = false
                        videoCompleted = false

                        setDataSource(this@LiveWallpaperService, Uri.parse(configuredVideoUri))
                        isLooping = false
                        setVolume(if (includeAudio) 1f else 0f, if (includeAudio) 1f else 0f)
                        setVideoScalingMode(MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING)
                        setSurface(holder.surface)

                        setOnPreparedListener { player ->
                            synchronized(mediaPlayerLock) {
                                videoPrepared = true
                                videoCompleted = false
                                videoFailed = false
                                try {
                                    player.start()
                                    schedulePlaybackRestart()
                                } catch (e: Exception) {
                                    Log.e(TAG, "Failed to start video after prepare", e)
                                    videoFailed = true
                                }
                            }
                        }
                        setOnCompletionListener { player ->
                            synchronized(mediaPlayerLock) {
                                if (shouldLoop) {
                                    try {
                                        player.seekTo(0)
                                        player.start()
                                        schedulePlaybackRestart()
                                    } catch (e: Exception) {
                                        Log.w(TAG, "Failed to loop video", e)
                                        videoFailed = true
                                    }
                                } else {
                                    videoPrepared = false
                                    videoCompleted = true
                                }
                            }
                        }
                        setOnErrorListener { _, what, extra ->
                            synchronized(mediaPlayerLock) {
                                videoPrepared = false
                                videoFailed = true
                                Log.e(TAG, "MediaPlayer error: what=$what, extra=$extra, uri=$configuredVideoUri")
                                releaseVideoLocked()
                            }
                            true
                        }
                        prepareAsync()
                    }
                } catch (error: Exception) {
                    Log.e(TAG, "Unable to prepare wallpaper video: $configuredVideoUri", error)
                    videoFailed = true
                    releaseVideoLocked()
                }
            }
        }

        private fun releaseVideo() {
            synchronized(mediaPlayerLock) {
                releaseVideoLocked()
            }
        }

        /** Must be called while holding [mediaPlayerLock]. */
        private fun releaseVideoLocked() {
            cancelPlaybackRestart()
            try {
                mediaPlayer?.release()
            } catch (e: Exception) {
                Log.w(TAG, "Error releasing media player", e)
            }
            mediaPlayer = null
            videoPrepared = false
            videoCompleted = false
        }

        private fun loadConfiguration() {
            val preferences = getSharedPreferences("wallpaper", MODE_PRIVATE)
            wallpaperId = preferences.getString("wallpaperId", "").orEmpty()
            wallpaperKind = preferences.getString("wallpaperKind", "doodle").orEmpty()
            configuredVideoUri = preferences.getString("videoUri", "").orEmpty()
            shouldLoop = preferences.getBoolean("loop", true)
            includeAudio = preferences.getBoolean("audio", false)
            videoDurationSeconds = preferences.getInt("playbackDuration", 30).coerceIn(1, 30)

            accentColor = try {
                Color.parseColor(preferences.getString("accent", "#7C3AED"))
            } catch (_: IllegalArgumentException) {
                Color.parseColor("#7C3AED")
            }

            secondaryColor = if (wallpaperId == "doodle-spark") {
                Color.parseColor("#34D399")
            } else {
                Color.parseColor("#22D3EE")
            }
        }

        private fun restartVideo() {
            synchronized(mediaPlayerLock) {
                val player = mediaPlayer ?: return
                if (!videoPrepared || !shouldLoop) {
                    if (!shouldLoop) {
                        try { player.pause() } catch (_: Exception) {}
                    }
                    return
                }
                try {
                    player.seekTo(0)
                    player.start()
                    schedulePlaybackRestart()
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to restart video", e)
                    videoFailed = true
                }
            }
        }

        private fun schedulePlaybackRestart() {
            cancelPlaybackRestart()
            playbackRestart = Runnable {
                if (shouldLoop) {
                    restartVideo()
                } else {
                    synchronized(mediaPlayerLock) {
                        try { mediaPlayer?.pause() } catch (_: Exception) {}
                        videoPrepared = false
                        videoCompleted = true
                    }
                }
            }
            mainHandler.postDelayed(playbackRestart!!, videoDurationSeconds * 1000L)
        }

        private fun cancelPlaybackRestart() {
            playbackRestart?.let { mainHandler.removeCallbacks(it) }
            playbackRestart = null
        }

        private fun stopRendering() {
            drawRunnable?.let { runnable ->
                renderHandler?.removeCallbacks(runnable)
            }
            drawRunnable = null
            cancelPlaybackRestart()
        }
    }

    companion object {
        private const val TAG = "LiveWallpaperService"
    }
}
