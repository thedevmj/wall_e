package com.wall_e.bridge

import android.app.WallpaperManager
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.ActivityNotFoundException
import android.net.Uri
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import java.io.File
import android.media.MediaMetadataRetriever

class WallpaperModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private var videoPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(object : com.facebook.react.bridge.BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                if (requestCode != VIDEO_REQUEST_CODE) return
                val promise = videoPromise
                videoPromise = null
                val uri = data?.data ?: data?.clipData?.getItemAt(0)?.uri
                if (resultCode == android.app.Activity.RESULT_OK && uri != null) {
                        val videoFile = File(reactContext.filesDir, "selected-wallpaper-video.mp4")
                        try {
                            reactContext.contentResolver.openInputStream(uri)?.use { input ->
                                videoFile.delete()
                                videoFile.outputStream().use { output -> input.copyTo(output) }
                            } ?: throw IllegalStateException("Unable to read selected video")
                            if (!videoFile.exists() || videoFile.length() == 0L) {
                                throw IllegalStateException("The selected video is empty")
                            }
                            val durationSeconds = try {
                                val retriever = MediaMetadataRetriever()
                                try {
                                    retriever.setDataSource(videoFile.absolutePath)
                                    ((retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 1000L) / 1000f).coerceAtLeast(1f)
                                } finally {
                                    retriever.release()
                                }
                            } catch (_: Exception) {
                                30f
                            }
                            promise?.resolve(mapOf("uri" to Uri.fromFile(videoFile).toString(), "durationSeconds" to durationSeconds))
                        } catch (error: Exception) {
                            promise?.reject("VIDEO_READ_ERROR", "Unable to read the selected video", error)
                        }
                } else {
                    promise?.resolve(null)
                }
            }
        })
    }

    companion object {
        private const val VIDEO_REQUEST_CODE = 4107
    }
    override fun getName(): String = "WallpaperModule"

    @ReactMethod
    fun getCapabilities(promise: Promise) {
        val wallpaperManager = reactContext.getSystemService(WallpaperManager::class.java)
        val capabilities = mapOf(
            "supportsLiveWallpaper" to (wallpaperManager?.isWallpaperSupported == true && wallpaperManager.isSetWallpaperAllowed),
            "minSdk" to 24,
            "targetSdk" to 36,
            "features" to listOf("Doodle renderer", "Video preview", "Wallpaper picker")
        )
        promise.resolve(capabilities)
    }

    @ReactMethod
    fun applyWallpaper(id: String, kind: String, destination: String, videoUri: String, loop: Boolean, playbackDuration: Int, audio: Boolean, promise: Promise) {
        try {
            saveWallpaperConfig(id, kind, videoUri, loop, playbackDuration, audio, "")
            val component = ComponentName(reactContext.packageName, "com.wall_e.wallpaper.LiveWallpaperService")
            val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
                putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startPickerActivity(intent)
            promise.resolve(mapOf("ok" to true, "id" to id, "destination" to destination, "mode" to "native-wallpaper-service"))
        } catch (error: Exception) {
            promise.reject("WALLPAPER_ERROR", "Unable to open the wallpaper picker", error)
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
            promise.reject("VIDEO_PICKER_ERROR", "Unable to open video storage", error)
        }
    }

    @ReactMethod
    fun openWallpaperPicker(id: String, kind: String, videoUri: String, loop: Boolean, playbackDuration: Int, accent: String, audio: Boolean, promise: Promise) {
        try {
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
            promise.reject("PICKER_ERROR", "Unable to open the wallpaper picker", error)
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
}
