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
import java.io.IOException

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
                    Log.w(TAG, "Video picker canceled: resultCode=$resultCode")
                    promise.resolve(null)
                    return
                }

                val uri = data?.data ?: data?.clipData?.getItemAt(0)?.uri
                if (uri == null) {
                    Log.e(TAG, "Video picker returned RESULT_OK without a URI")
                    promise.resolve(null)
                    return
                }

                try {
                    Log.i(TAG, "Video picked: uri=$uri scheme=${uri.scheme} authority=${uri.authority} flags=${data?.flags}")
                    // Keep the provider grant when available, then copy the bytes into app storage.
                    if (uri.scheme == "content") {
                        try {
                            val grantedFlags = data?.flags?.and(
                                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                            ) ?: Intent.FLAG_GRANT_READ_URI_PERMISSION
                            reactContext.contentResolver.takePersistableUriPermission(
                                uri,
                                grantedFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION
                            )
                            Log.i(TAG, "Persistable permission taken for: $uri")
                        } catch (e: Exception) {
                            Log.w(TAG, "Provider did not allow persistable permission for $uri", e)
                        }
                    }

                    val playableUri = copyVideoToAppStorage(uri)
                    Log.i(TAG, "Playable video URI: $playableUri")
                    val durationSeconds = extractVideoDuration(playableUri)
                        ?: throw IllegalArgumentException("The selected file is not a readable video")

                    val result: WritableMap = Arguments.createMap().apply {
                        putString("uri", playableUri.toString())
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
            val supportsLive = wallpaperManager?.isWallpaperSupported == true

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
            Log.i(TAG, "applyWallpaper called: id=$id, kind=$kind, destination=$destination, uri=$videoUri, loop=$loop, duration=$playbackDuration, audio=$audio")
            
            saveWallpaperConfig(id, kind, videoUri, loop, playbackDuration, audio, "")
            val component = ComponentName(reactContext.packageName, "com.wall_e.wallpaper.LiveWallpaperService")
            val flags = when (destination.uppercase()) {
                "HOME" -> WallpaperManager.FLAG_SYSTEM
                "LOCK" -> WallpaperManager.FLAG_LOCK
                "BOTH" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
                else -> throw IllegalArgumentException("Unknown wallpaper destination: $destination")
            }
            openWallpaperConfirmation(component, flags)

            val result: WritableMap = Arguments.createMap().apply {
                putBoolean("ok", true)
                putString("id", id)
                putString("destination", destination)
                putString("mode", "system-wallpaper-confirmation-$destination")
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
        Log.i(TAG, "Opening video picker: action=${Intent.ACTION_OPEN_DOCUMENT}")
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "video/*"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        try {
            reactContext.startActivityForResult(intent, VIDEO_REQUEST_CODE, null)
        } catch (error: Exception) {
            videoPromise = null
            Log.e(TAG, "Failed to open video picker", error)
            promise.reject("VIDEO_PICKER_ERROR", "Unable to open video storage: ${error.message}", error)
        }
    }

    private fun saveWallpaperConfig(id: String, kind: String, videoUri: String, loop: Boolean, playbackDuration: Int, audio: Boolean, accent: String) {
        val preferences = reactContext.getSharedPreferences("wallpaper_pref", 0)
        val finalAccent = if (accent.isNotBlank()) accent else "#7C3AED"
        
        Log.i(TAG, "SAVING CONFIG TO SharedPreferences: kind=$kind, path=$videoUri")
        
        preferences.edit()
            .putString("W_ID", id)
            .putString("W_KIND", kind)
            .putString("W_PATH", videoUri)
            .putBoolean("W_LOOP", loop)
            .putInt("W_DURATION", playbackDuration.coerceIn(1, 30))
            .putBoolean("W_AUDIO", audio)
            .putString("W_ACCENT", finalAccent)
            .commit()

        val check = preferences.getString("W_PATH", "FAILED")
        Log.i(TAG, "VERIFY SAVED PATH: $check")
    }

    private fun startPickerActivity(intent: Intent) {
        val activity = reactContext.currentActivity
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (activity != null) {
            activity.startActivity(intent)
        } else {
            reactContext.startActivity(intent)
        }
    }

    private fun openWallpaperConfirmation(component: ComponentName, flags: Int) {
        val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
            putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
            putExtra("com.wall_e.WALLPAPER_DESTINATION", flags)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        Log.i(TAG, "Opening wallpaper confirmation: component=$component flags=$flags")
        startPickerActivity(intent)
    }

    private fun copyVideoToAppStorage(uri: Uri): Uri {
        val videoDirectory = File(reactContext.filesDir, "wallpapers").apply { mkdirs() }
        val videoFile = File(videoDirectory, "video_${System.currentTimeMillis()}.mp4")
        val input = reactContext.contentResolver.openInputStream(uri)
            ?: throw IOException("Unable to open the selected video")

        try {
            input.use { source ->
                videoFile.outputStream().use { destination -> source.copyTo(destination) }
            }
            Log.i(TAG, "Copied video details: exists=${videoFile.exists()} bytes=${videoFile.length()} readable=${videoFile.canRead()}")
            Log.i(TAG, "Copied selected video to app storage: ${videoFile.absolutePath}")
            return Uri.fromFile(videoFile)
        } catch (error: Exception) {
            videoFile.delete()
            throw IOException("Unable to copy the selected video into app storage", error)
        }
    }

    /** Return duration only when the URI exposes a real video track. */
    private fun extractVideoDuration(uri: Uri): Float? {
        var retriever: MediaMetadataRetriever? = null
        return try {
            Log.i(TAG, "Reading video metadata: uri=$uri scheme=${uri.scheme}")
            retriever = MediaMetadataRetriever()
            retriever.setDataSource(reactContext, uri)
            val durationMs = retriever
                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull()
            val hasVideoTrack = retriever
                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO)
                ?.equals("yes", ignoreCase = true) == true
            Log.i(TAG, "Video metadata: durationMs=$durationMs hasVideoTrack=$hasVideoTrack")
            if (!hasVideoTrack || durationMs == null || durationMs <= 0L) null
            else (durationMs / 1000f).coerceAtLeast(1f)
        } catch (error: Exception) {
            Log.w(TAG, "Could not read selected video metadata", error)
            null
        } finally {
            try {
                retriever?.release()
            } catch (_: Exception) {
                // release() can throw on some devices
            }
        }
    }
}
