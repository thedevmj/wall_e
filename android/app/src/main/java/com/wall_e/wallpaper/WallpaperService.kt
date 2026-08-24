package com.wall_e.wallpaper

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.SurfaceHolder

class LiveWallpaperService : WallpaperService() {
    override fun onCreateEngine(): Engine = WallpaperEngine()

    private inner class WallpaperEngine : WallpaperService.Engine() {
        private val handler = Handler(Looper.getMainLooper())
        private val paint = Paint().apply {
            color = Color.WHITE
            strokeWidth = 6f
            isAntiAlias = true
        }
        private var drawRunnable: Runnable? = null
        private var mediaPlayer: MediaPlayer? = null
        private var videoPrepared = false
        private var videoCompleted = false
        private var startedAt = 0L
        private var videoDurationSeconds = 30
        private var playbackRestart: Runnable? = null
        private var wallpaperId = ""
        private var wallpaperKind = "doodle"
        private var configuredVideoUri = ""
        private var accentColor = Color.parseColor("#7C3AED")

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setTouchEventsEnabled(false)
        }

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            if (!holder.surface.isValid) return
            startVideoIfConfigured(holder)
            startRendering()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            if (wallpaperKind == "video" && holder.surface.isValid) {
                if (mediaPlayer == null) startVideoIfConfigured(holder) else mediaPlayer?.setSurface(holder.surface)
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            stopRendering()
            handler.removeCallbacksAndMessages(null)
            mediaPlayer?.release()
            mediaPlayer = null
            videoPrepared = false
        }

        override fun onVisibilityChanged(visible: Boolean) {
            super.onVisibilityChanged(visible)
            if (visible) {
                val previousWallpaperId = wallpaperId
                val previousWallpaperKind = wallpaperKind
                val previousVideoUri = configuredVideoUri
                val preferences = loadConfiguration()
                if (previousWallpaperId != wallpaperId || previousWallpaperKind != wallpaperKind || previousVideoUri != preferences.getString("videoUri", "").orEmpty()) {
                    releaseVideo()
                    startVideoIfConfigured(surfaceHolder)
                }
                if (videoPrepared) {
                    mediaPlayer?.start()
                    schedulePlaybackRestart()
                } else if (videoCompleted) {
                    mediaPlayer?.seekTo(0)
                    mediaPlayer?.start()
                    videoPrepared = true
                    schedulePlaybackRestart()
                }
                startRendering()
            } else {
                mediaPlayer?.pause()
                playbackRestart?.let(handler::removeCallbacks)
                stopRendering()
            }
        }

        private fun startRendering() {
            stopRendering()
            startedAt = System.currentTimeMillis()
            drawRunnable = object : Runnable {
                override fun run() {
                    val holder = surfaceHolder ?: return
                    var canvas: Canvas? = null
                    try {
                        if (mediaPlayer == null && wallpaperKind == "doodle") canvas = holder.lockCanvas()
                        if (canvas != null) {
                            val elapsed = (System.currentTimeMillis() - startedAt) / 1000f
                            canvas.drawColor(Color.parseColor("#020817"))
                            val centerX = canvas.width / 2f
                            val centerY = canvas.height / 2f
                            val size = canvas.width.coerceAtMost(canvas.height)
                            val radius = size * (0.18f + 0.025f * kotlin.math.sin(elapsed * 2.2f))
                            paint.color = accentColor
                            canvas.drawCircle(centerX, centerY, radius, paint)
                            paint.color = if (wallpaperId == "doodle-spark") Color.parseColor("#34D399") else Color.parseColor("#22D3EE")
                            canvas.drawCircle(centerX + radius * (0.7f + 0.12f * kotlin.math.sin(elapsed * 1.4f)), centerY - radius * 0.5f, radius * 0.42f, paint)
                        }
                    } finally {
                        if (canvas != null) {
                            holder.unlockCanvasAndPost(canvas)
                        }
                    }
                    handler.postDelayed(this, 16)
                }
            }
            handler.post(drawRunnable!!)
        }

        private fun startVideoIfConfigured(holder: SurfaceHolder) {
            val preferences = loadConfiguration()
            val uriValue = preferences.getString("videoUri", "").orEmpty()
            configuredVideoUri = uriValue
            if (wallpaperKind != "video" || uriValue.isBlank() || !holder.surface.isValid) {
                releaseVideo()
                return
            }
            try {
                mediaPlayer = MediaPlayer().apply {
                    videoPrepared = false
                    videoCompleted = false
                    videoDurationSeconds = preferences.getInt("playbackDuration", 30).coerceIn(1, 30)
                    setDataSource(this@LiveWallpaperService, Uri.parse(uriValue))
                    val shouldLoop = preferences.getBoolean("loop", true)
                    val includeAudio = preferences.getBoolean("audio", false)
                    isLooping = false
                    setVolume(if (includeAudio) 1f else 0f, if (includeAudio) 1f else 0f)
                    setVideoScalingMode(MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING)
                    setSurface(holder.surface)
                    setOnPreparedListener { player ->
                        videoPrepared = true
                        videoCompleted = false
                        player.start()
                        schedulePlaybackRestart()
                    }
                    setOnCompletionListener { player ->
                        if (shouldLoop) {
                            player.seekTo(0)
                            player.start()
                            schedulePlaybackRestart()
                        } else {
                            videoPrepared = false
                            videoCompleted = true
                        }
                    }
                    setOnErrorListener { _, _, _ ->
                        videoPrepared = false
                        Log.e(TAG, "Unable to play wallpaper video: $uriValue")
                        releaseVideo()
                        true
                    }
                    prepareAsync()
                }
            } catch (error: Exception) {
                Log.e(TAG, "Unable to prepare wallpaper video: $uriValue", error)
                releaseVideo()
            }
        }

        private fun releaseVideo() {
            playbackRestart?.let(handler::removeCallbacks)
            mediaPlayer?.release()
            mediaPlayer = null
            videoPrepared = false
            videoCompleted = false
        }

        private fun loadConfiguration(): android.content.SharedPreferences {
            val preferences = getSharedPreferences("wallpaper", MODE_PRIVATE)
            wallpaperId = preferences.getString("wallpaperId", "").orEmpty()
            wallpaperKind = preferences.getString("wallpaperKind", "doodle").orEmpty()
            accentColor = try {
                Color.parseColor(preferences.getString("accent", "#7C3AED"))
            } catch (_: IllegalArgumentException) {
                Color.parseColor("#7C3AED")
            }
            return preferences
        }

        private fun restartVideo() {
            val player = mediaPlayer ?: return
            val preferences = getSharedPreferences("wallpaper", MODE_PRIVATE)
            if (!videoPrepared || !preferences.getBoolean("loop", true)) {
                if (!preferences.getBoolean("loop", true)) player.pause()
                return
            }
            player.seekTo(0)
            player.start()
            schedulePlaybackRestart()
        }

        private fun schedulePlaybackRestart() {
            playbackRestart?.let(handler::removeCallbacks)
            val shouldLoop = getSharedPreferences("wallpaper", MODE_PRIVATE).getBoolean("loop", true)
            playbackRestart = Runnable {
                if (shouldLoop) {
                    restartVideo()
                } else {
                    mediaPlayer?.pause()
                    videoPrepared = false
                    videoCompleted = true
                }
            }
            handler.postDelayed(playbackRestart!!, videoDurationSeconds * 1000L)
        }

        private fun stopRendering() {
            drawRunnable?.let { handler.removeCallbacks(it) }
            drawRunnable = null
            playbackRestart?.let(handler::removeCallbacks)
        }
    }

    companion object {
        private const val TAG = "LiveWallpaperService"
    }
}
