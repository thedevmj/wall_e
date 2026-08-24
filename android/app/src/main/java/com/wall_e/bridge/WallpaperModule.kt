package com.wall_e.bridge

import android.app.WallpaperManager
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.ActivityNotFoundException
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableArray
import java.io.File
import android.media.MediaMetadataRetriever
import android.util.Log

class WallpaperModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private var videoPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(object : com.facebook.react.bridge.BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != VIDEO_REQUEST_CODE) return
                val promise = videoPromise
                videoPromise = null

                if (promise == null) return

                if (resultCode != Activity.RESULT_OK) {
                    promise.resolve(null)
                    return
                }

                val uri = data?.data ?: data?.clipData?.getItemAt(0)?.uri
                if (uri == null) {
                    promise.resolve(null)
                    return
                }

                try {
                    // Use unique filename per pick to avoid overwriting previous wallpaper videos
                    val videoFile = File(reactContext.filesDir, "wallpaper-video-${System.currentTimeMillis()}.mp4")
                    reactContext.contentResolver.openInputStream(uri)?.use { input ->
                        videoFile.outputStream().use { output -> input.copyTo(output) }
                    } ?: throw IllegalStateException("Unable to read the selected video stream")

                    if (!videoFile.exists() || videoFile.length() == 0L) {
                        throw IllegalStateException("The selected video is empty or could not be saved")
                    }

                    val durationSeconds = extractVideoDuration(videoFile)

                    val result: WritableMap = Arguments.createMap().apply {
                        putString("uri", Uri.fromFile(videoFile).toString())
                        putDouble("durationSeconds", durationSeconds.toDouble())
                    }
                    promise.resolve(result)
                } catch (error: Exception) {
                    Log.e(TAG, "Failed to process picked video", error)
                    promise.reject("VIDEO_READ_ERROR", "Unable to read the selected video: ${error.message}", error)
                }
            }
        })
    }

    companion object {
        private const val VIDEO_REQUEST_CODE = 4107
        private const val TAG = "WallpaperModule"
    }

    override fun getName(): String = "WallpaperModule"

    @ReactMethod
    fun getCapabilities(promise: Promise) {
        try {
            val wallpaperManager = reactContext.getSystemService(WallpaperManager::class.java)
            val supportsLive = wallpaperManager?.isWallpaperSupported == true && wallpaperManager.isSetWallpaperAllowed

            val featuresArray: WritableArray = Arguments.createArray().apply {
                pushString("Doodle renderer")
                pushString("Video preview")
                pushString("Wallpaper picker")
            }

            val capabilities: WritableMap = Arguments.createMap().apply {
                putBoolean("supportsLiveWallpaper", supportsLive)
                putInt("minSdk", 24)
                putInt("targetSdk", 36)
                putArray("features", featuresArray)
            }
            promise.resolve(capabilities)
        } catch (error: Exception) {
            Log.e(TAG, "Failed to get capabilities", error)
            val fallback: WritableMap = Arguments.createMap().apply {
                putBoolean("supportsLiveWallpaper", false)
                putInt("minSdk", 24)
                putInt("targetSdk", 36)
                val fallbackFeatures: WritableArray = Arguments.createArray().apply {
                    pushString("Doodle renderer")
                    pushString("Video preview")
                    pushString("Wallpaper picker")
                }
                putArray("features", fallbackFeatures)
            }
            promise.resolve(fallback)
        }
    }

    @ReactMethod
    fun applyWallpaper(id: String, kind: String, destination: String, videoUri: String, loop: Boolean, playbackDuration: Int, audio: Boolean, promise: Promise) {
        try {
            // For video wallpapers, validate the video file exists
            if (kind == "video" && videoUri.isNotBlank()) {
                val videoFile = try { File(Uri.parse(videoUri).path ?: "") } catch (_: Exception) { null }
                if (videoFile == null || !videoFile.exists()) {
                    val result: WritableMap = Arguments.createMap().apply {
                        putBoolean("ok", false)
                        putString("id", id)
                        putString("destination", destination)
                        putString("error", "The video file no longer exists. Please select a new video.")
                        putString("errorCode", "VIDEO_NOT_FOUND")
                    }
                    promise.resolve(result)
                    return
                }
            }

            saveWallpaperConfig(id, kind, videoUri, loop, playbackDuration, audio, "")
            val component = ComponentName(reactContext.packageName, "com.wall_e.wallpaper.LiveWallpaperService")
            val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
                putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startPickerActivity(intent)

            val result: WritableMap = Arguments.createMap().apply {
                putBoolean("ok", true)
                putString("id", id)
                putString("destination", destination)
                putString("mode", "native-wallpaper-service")
            }
            promise.resolve(result)
        } catch (error: Exception) {
            Log.e(TAG, "Failed to apply wallpaper", error)
            val result: WritableMap = Arguments.createMap().apply {
                putBoolean("ok", false)
                putString("id", id)
                putString("destination", destination)
                putString("error", "Unable to open the wallpaper picker: ${error.message}")
                putString("errorCode", "WALLPAPER_APPLY_ERROR")
            }
            promise.resolve(result)
        }
    }

    @ReactMethod
    fun pickVideo(promise: Promise) {
        if (videoPromise != null) {
            promise.reject("VIDEO_PICKER_BUSY", "A video picker is already open")
            return
        }
        videoPromise = promise
        val documentIntent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "video/*"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        val intent = if (documentIntent.resolveActivity(reactContext.packageManager) != null) {
            documentIntent
        } else {
            Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "video/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        try {
            reactContext.startActivityForResult(intent, VIDEO_REQUEST_CODE, null)
        } catch (error: Exception) {
            videoPromise = null
            Log.e(TAG, "Failed to open video picker", error)
            promise.reject("VIDEO_PICKER_ERROR", "Unable to open video storage: ${error.message}", error)
        }
    }

    @ReactMethod
    fun openWallpaperPicker(id: String, kind: String, videoUri: String, loop: Boolean, playbackDuration: Int, accent: String, audio: Boolean, promise: Promise) {
        try {
            // For video wallpapers, validate the video file exists
            if (kind == "video" && videoUri.isNotBlank()) {
                val videoFile = try { File(Uri.parse(videoUri).path ?: "") } catch (_: Exception) { null }
                if (videoFile == null || !videoFile.exists()) {
                    promise.reject("VIDEO_NOT_FOUND", "The video file no longer exists. Please select a new video.")
                    return
                }
            }

            saveWallpaperConfig(id, kind, videoUri, loop, playbackDuration, audio, accent)
            val component = ComponentName(reactContext.packageName, "com.wall_e.wallpaper.LiveWallpaperService")
            val appPreviewIntent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
                putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                // Do not preflight with resolveActivity: some Android launchers hide their
                // picker from package-visibility queries until it has already been opened.
                startPickerActivity(appPreviewIntent)
            } catch (_: ActivityNotFoundException) {
                val genericPickerIntent = Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startPickerActivity(genericPickerIntent)
            }
            promise.resolve(true)
        } catch (error: Exception) {
            Log.e(TAG, "Failed to open wallpaper picker", error)
            promise.reject("PICKER_ERROR", "Unable to open the wallpaper picker: ${error.message}", error)
        }
    }

    private fun saveWallpaperConfig(id: String, kind: String, videoUri: String, loop: Boolean, playbackDuration: Int, audio: Boolean, accent: String) {
        val preferences = reactContext.getSharedPreferences("wallpaper", 0)
        preferences.edit()
            .putString("wallpaperId", id)
            .putString("wallpaperKind", kind)
            .putString("videoUri", videoUri)
            .putBoolean("loop", loop)
            .putInt("playbackDuration", playbackDuration.coerceIn(1, 30))
            .putBoolean("audio", audio)
            .putString("accent", accent.ifBlank { preferences.getString("accent", "#7C3AED") })
            .commit()
    }

    private fun startPickerActivity(intent: Intent) {
        val activity = reactContext.currentActivity
        if (activity != null) {
            activity.startActivity(intent)
        } else {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
        }
    }

    /**
     * Extract duration from a video file. Returns 30f on failure.
     */
    private fun extractVideoDuration(videoFile: File): Float {
        var retriever: MediaMetadataRetriever? = null
        return try {
            retriever = MediaMetadataRetriever()
            retriever.setDataSource(videoFile.absolutePath)
            val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 1000L
            (durationMs / 1000f).coerceAtLeast(1f)
        } catch (error: Exception) {
            Log.w(TAG, "Could not extract video duration, defaulting to 30s", error)
            30f
        } finally {
            try {
                retriever?.release()
            } catch (_: Exception) {
                // release() can throw on some devices
            }
        }
    }
}
