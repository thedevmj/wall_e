package com.wall_e.bridge

import android.app.WallpaperManager
import android.app.Activity
import android.content.ComponentName
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableArray
import java.io.File
import java.io.InputStream
import java.net.URL
import android.media.MediaMetadataRetriever
import android.util.Log
import java.io.IOException

class WallpaperModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private var videoPromise: Promise? = null
    private var imagePromise: Promise? = null

    init {
        reactContext.addActivityEventListener(object : com.facebook.react.bridge.BaseActivityEventListener() {
            override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
                when (requestCode) {
                    VIDEO_REQUEST_CODE -> handleVideoResult(resultCode, data)
                    IMAGE_REQUEST_CODE -> handleImageResult(resultCode, data)
                }
            }
        })
    }

    private fun handleVideoResult(resultCode: Int, data: Intent?) {
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

            Thread {
                try {
                    val playableUri = copyVideoToAppStorage(uri)
                    Log.i(TAG, "Playable video URI: $playableUri")
                    val durationSeconds = extractVideoDuration(playableUri)
                        ?: throw IllegalArgumentException("The selected file is not a readable video")

                    val result: WritableMap = Arguments.createMap().apply {
                        putString("uri", playableUri.toString())
                        putDouble("durationSeconds", durationSeconds.toDouble())
                    }
                    postToUi { promise.resolve(result) }
                } catch (error: Exception) {
                    Log.e(TAG, "Failed to process picked video", error)
                    postToUi {
                        promise.reject(
                            "VIDEO_READ_ERROR",
                            "Unable to read the selected video: ${error.message}",
                            error
                        )
                    }
                }
            }.start()
        } catch (error: Exception) {
            Log.e(TAG, "Failed to open picked video stream", error)
            promise.reject("VIDEO_READ_ERROR", "Unable to read the selected video: ${error.message}", error)
        }
    }

    private fun handleImageResult(resultCode: Int, data: Intent?) {
        val promise = imagePromise
        imagePromise = null

        if (promise == null) return

        if (resultCode != Activity.RESULT_OK) {
            Log.w(TAG, "Image picker canceled: resultCode=$resultCode")
            promise.resolve(null)
            return
        }

        val uri = data?.data ?: data?.clipData?.getItemAt(0)?.uri
        if (uri == null) {
            Log.e(TAG, "Image picker returned RESULT_OK without a URI")
            promise.resolve(null)
            return
        }

        try {
            Log.i(TAG, "Image picked: uri=$uri scheme=${uri.scheme} flags=${data?.flags}")
            if (uri.scheme == "content") {
                try {
                    val grantedFlags = data?.flags?.and(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    ) ?: Intent.FLAG_GRANT_READ_URI_PERMISSION
                    reactContext.contentResolver.takePersistableUriPermission(
                        uri,
                        grantedFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "Provider did not allow persistable permission for $uri", e)
                }
            }

            Thread {
                try {
                    val copiedUri = copyImageToAppStorage(uri)
                    Log.i(TAG, "Copied image URI: $copiedUri")

                    val result: WritableMap = Arguments.createMap().apply {
                        putString("uri", copiedUri.toString())
                    }
                    postToUi { promise.resolve(result) }
                } catch (error: Exception) {
                    Log.e(TAG, "Failed to process picked image", error)
                    postToUi {
                        promise.reject(
                            "IMAGE_READ_ERROR",
                            "Unable to read the selected image: ${error.message}",
                            error
                        )
                    }
                }
            }.start()
        } catch (error: Exception) {
            Log.e(TAG, "Failed to open picked image stream", error)
            promise.reject("IMAGE_READ_ERROR", "Unable to read the selected image: ${error.message}", error)
        }
    }

    private fun postToUi(action: () -> Unit) {
        try {
            reactContext.runOnUiQueueThread { action() }
        } catch (e: Exception) {
            Log.w(TAG, "React context unavailable while resolving", e)
        }
    }

    companion object {
        private const val VIDEO_REQUEST_CODE = 4107
        private const val IMAGE_REQUEST_CODE = 4108
        private const val TAG = "WallpaperModule"
    }

    override fun getName(): String = "WallpaperModule"

    @ReactMethod
    fun getCapabilities(promise: Promise) {
        try {
            val wallpaperManager = reactContext.getSystemService(WallpaperManager::class.java)
            val supportsLive = wallpaperManager?.isWallpaperSupported ?: false
            val setWallpaperAllowed = wallpaperManager?.isSetWallpaperAllowed ?: false
            val hasLiveWallpaperFeature =
                reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_LIVE_WALLPAPER)
            val livePickerAvailable = hasLiveWallpaperFeature && liveWallpaperPickerAvailable()

            val featuresArray: WritableArray = Arguments.createArray().apply {
                pushString("Doodle renderer")
                pushString("Video preview")
                pushString("Static image wallpaper")
                pushString("Video rotation")
                pushString("Wallpaper picker")
            }

            val capabilities: WritableMap = Arguments.createMap().apply {
                putBoolean("supportsLiveWallpaper", supportsLive)
                putBoolean("setWallpaperAllowed", setWallpaperAllowed)
                putBoolean("liveWallpaperPickerAvailable", livePickerAvailable)
                putString("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                putString("androidVersion", Build.VERSION.RELEASE)
                putInt("minSdk", 24)
                putInt("targetSdk", 36)
                putArray("features", featuresArray)
            }
            promise.resolve(capabilities)
        } catch (error: Exception) {
            Log.e(TAG, "Failed to get capabilities", error)
            val fallback: WritableMap = Arguments.createMap().apply {
                putBoolean("supportsLiveWallpaper", false)
                putBoolean("setWallpaperAllowed", true)
                putBoolean("liveWallpaperPickerAvailable", false)
                putString("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                putString("androidVersion", Build.VERSION.RELEASE)
                putInt("minSdk", 24)
                putInt("targetSdk", 36)
                val fallbackFeatures: WritableArray = Arguments.createArray().apply {
                    pushString("Doodle renderer")
                    pushString("Video preview")
                    pushString("Static image wallpaper")
                    pushString("Video rotation")
                    pushString("Wallpaper picker")
                }
                putArray("features", fallbackFeatures)
            }
            promise.resolve(fallback)
        }
    }

    /**
     * True when the system exposes a live wallpaper chooser that can actually
     * resolve on this device. Some OEM/enterprise ROMs and low-end devices do
     * not provide one even when the WallpaperService framework exists.
     */
    @ReactMethod
    fun copyToClipboard(text: String) {
        try {
            val clipboard = reactContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("wall_e logs", text))
        } catch (_: Exception) {
            Log.e(TAG, "copyToClipboard failed")
        }
    }

    private fun liveWallpaperPickerAvailable(): Boolean {
        return try {
            val component = ComponentName(reactContext.packageName, "com.wall_e.wallpaper.LiveWallpaperService")
            val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
                putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
            }
            reactContext.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null
        } catch (_: Exception) {
            false
        }
    }

    @ReactMethod
    fun applyWallpaper(id: String, kind: String, destination: String, videoUri: String, loop: Boolean, playbackDuration: Int, audio: Boolean, rotation: Int, promise: Promise) {
        try {
            Log.i(TAG, "applyWallpaper called: id=$id, kind=$kind, destination=$destination, uri=$videoUri, loop=$loop, duration=$playbackDuration, audio=$audio, rotation=$rotation")

            if (kind == "static") {
                applyStaticWallpaper(id, videoUri, destination, promise)
                return
            }

            val normalizedRotation = rotation.coerceIn(0, 270)
            if (normalizedRotation == 0) {
                val mediaUri = resolveMediaUri(videoUri, "bundled_video", "mp4")
                finishLiveApply(id, kind, destination, mediaUri.toString(), loop, playbackDuration, audio, 0, promise)
                return
            }

            Thread {
                try {
                    val original = resolveMediaUri(videoUri, "bundled_video", "mp4")
                    val rotatedUri = rotateVideoIfPossible(original, normalizedRotation)
                    if (rotatedUri != null) {
                        Log.i(TAG, "Rotation transcode succeeded; playing pre-rotated file with rotation=0")
                        finishLiveApply(id, kind, destination, rotatedUri.toString(), loop, playbackDuration, audio, 0, promise)
                    } else {
                        Log.w(TAG, "Rotation transcode failed/unavailable; falling back to original with rotation=$normalizedRotation")
                        finishLiveApply(id, kind, destination, original.toString(), loop, playbackDuration, audio, normalizedRotation, promise)
                    }
                } catch (error: Exception) {
                    Log.e(TAG, "Failed to apply wallpaper (rotation path)", error)
                    postToUi {
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
            }.start()
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

    private fun finishLiveApply(
        id: String,
        kind: String,
        destination: String,
        mediaUri: String,
        loop: Boolean,
        playbackDuration: Int,
        audio: Boolean,
        rotation: Int,
        promise: Promise,
    ) {
        saveWallpaperConfig(id, kind, mediaUri, loop, playbackDuration, audio, "", rotation)
        val component = ComponentName(reactContext.packageName, "com.wall_e.wallpaper.LiveWallpaperService")
        val flags = when (destination.uppercase()) {
            "HOME" -> WallpaperManager.FLAG_SYSTEM
            "LOCK" -> WallpaperManager.FLAG_LOCK
            "BOTH" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
            else -> throw IllegalArgumentException("Unknown wallpaper destination: $destination")
        }
        postToUi {
            try {
                openWallpaperConfirmation(component, flags)
                val result: WritableMap = Arguments.createMap().apply {
                    putBoolean("ok", true)
                    putString("id", id)
                    putString("destination", destination)
                    putString("mode", "system-wallpaper-confirmation-$destination")
                }
                promise.resolve(result)
            } catch (error: Exception) {
                Log.e(TAG, "Live wallpaper picker unavailable for $destination", error)
                val result: WritableMap = Arguments.createMap().apply {
                    putBoolean("ok", false)
                    putString("id", id)
                    putString("destination", destination)
                    putString("error", "This device does not support live wallpapers. Choose a static wallpaper instead.")
                    putString("errorCode", "LIVE_WALLPAPER_UNAVAILABLE")
                }
                promise.resolve(result)
            }
        }
    }

    private fun rotateVideoIfPossible(src: Uri, rotation: Int): Uri? {
        if (src.scheme != "file") return null
        val srcPath = src.path ?: return null
        val file = File(srcPath)
        if (!file.exists() || !file.isFile) return null
        val dir = File(reactContext.filesDir, "wallpapers").apply { mkdirs() }
        val dst = File(dir, "rotated_${file.nameWithoutExtension}_r${rotation}.mp4")
        if (dst.exists() && dst.length() > 0L) {
            Log.i(TAG, "Reusing cached rotated video: ${dst.absolutePath}")
            return Uri.fromFile(dst)
        }
        return if (VideoRotationProcessor.transcode(srcPath, dst.absolutePath, rotation)) {
            Log.i(TAG, "Rotation transcode done: ${dst.absolutePath} bytes=${dst.length()}")
            Uri.fromFile(dst)
        } else {
            null
        }
    }

    private fun applyStaticWallpaper(id: String, imageUri: String, destination: String, promise: Promise) {
        try {
            if (imageUri.isBlank()) {
                val result: WritableMap = Arguments.createMap().apply {
                    putBoolean("ok", false)
                    putString("id", id)
                    putString("destination", destination)
                    putString("error", "No image selected")
                    putString("errorCode", "NO_IMAGE")
                }
                promise.resolve(result)
                return
            }

            val uri = resolveMediaUri(imageUri, "bundled_image", "jpg")
            val inputStream = reactContext.contentResolver.openInputStream(uri)
                ?: if (uri.scheme?.equals("file", true) == true) {
                    uri.path?.let { File(it).inputStream() }
                } else {
                    null
                }
                ?: throw IOException("Cannot open image URI: $uri")

            val bitmap = BitmapFactory.decodeStream(inputStream)
            inputStream.close()

            if (bitmap == null) {
                val result: WritableMap = Arguments.createMap().apply {
                    putBoolean("ok", false)
                    putString("id", id)
                    putString("destination", destination)
                    putString("error", "Could not decode the selected image")
                    putString("errorCode", "IMAGE_DECODE_ERROR")
                }
                promise.resolve(result)
                return
            }

            val wallpaperManager = WallpaperManager.getInstance(reactContext)
            val flags = when (destination.uppercase()) {
                "HOME" -> WallpaperManager.FLAG_SYSTEM
                "LOCK" -> WallpaperManager.FLAG_LOCK
                "BOTH" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
                else -> WallpaperManager.FLAG_SYSTEM
            }

            // A crop hint matching the real display stops OEM skins from
            // letterboxing or mis-cropping the image on very different screens.
            val visibleCropHint: android.graphics.Rect? = try {
                val metrics = reactContext.resources.displayMetrics
                android.graphics.Rect(0, 0, metrics.widthPixels, metrics.heightPixels)
            } catch (_: Exception) {
                null
            }

            wallpaperManager.setBitmap(bitmap, visibleCropHint, true, flags)
            bitmap.recycle()

            Log.i(TAG, "Static wallpaper applied: id=$id destination=$destination")

            val result: WritableMap = Arguments.createMap().apply {
                putBoolean("ok", true)
                putString("id", id)
                putString("destination", destination)
                putString("mode", "static-wallpaper-$destination")
            }
            promise.resolve(result)
        } catch (error: Exception) {
            Log.e(TAG, "Failed to apply static wallpaper", error)
            val result: WritableMap = Arguments.createMap().apply {
                putBoolean("ok", false)
                putString("id", id)
                putString("destination", destination)
                putString("error", "Unable to set the static wallpaper: ${error.message}")
                putString("errorCode", "STATIC_APPLY_ERROR")
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

    @ReactMethod
    fun pickImage(promise: Promise) {
        if (imagePromise != null) {
            promise.reject("IMAGE_PICKER_BUSY", "An image picker is already open")
            return
        }
        imagePromise = promise
        Log.i(TAG, "Opening image picker: action=${Intent.ACTION_OPEN_DOCUMENT}")
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        try {
            reactContext.startActivityForResult(intent, IMAGE_REQUEST_CODE, null)
        } catch (error: Exception) {
            imagePromise = null
            Log.e(TAG, "Failed to open image picker", error)
            promise.reject("IMAGE_PICKER_ERROR", "Unable to open image storage: ${error.message}", error)
        }
    }

    @ReactMethod
    fun prepareBundledMedia(source: String, kind: String, promise: Promise) {
        Thread {
            try {
                if (source.isBlank()) throw IllegalArgumentException("Missing media source")
                Log.i(TAG, "prepareBundledMedia: source=$source kind=$kind")
                val prefix = if (kind == "video") "bundled_video" else "bundled_image"
                val ext = if (kind == "video") "mp4" else "jpg"
                val parsed = Uri.parse(source)
                val resolved: Uri = when (parsed.scheme?.lowercase()) {
                    "http", "https" -> copyRemoteToAppStorage(source, prefix, ext)
                    else -> resolveMediaUri(source, prefix, ext)
                }
                Log.i(TAG, "prepareBundledMedia resolved to: $resolved")
                val result: WritableMap = Arguments.createMap().apply {
                    putString("uri", resolved.toString())
                }
                postToUi { promise.resolve(result) }
            } catch (error: Exception) {
                Log.e(TAG, "prepareBundledMedia failed", error)
                postToUi {
                    promise.reject(
                        "BUNDLED_PREPARE_ERROR",
                        "Unable to prepare embedded media: ${error.message}",
                        error
                    )
                }
            }
        }.start()
    }

    private fun resolveMediaUri(rawUri: String, prefix: String, ext: String): Uri {
        if (rawUri.isBlank()) throw IllegalArgumentException("Missing media URI")
        val parsed = Uri.parse(rawUri)
        return when (parsed.scheme?.lowercase()) {
            "content", "file" -> parsed
            "http", "https" -> copyRemoteToAppStorage(rawUri, prefix, ext)
            else -> copyBundledResourceToAppStorage(rawUri, prefix, ext)
        }
    }

    private fun copyBundledResourceToAppStorage(identifier: String, prefix: String, ext: String): Uri {
        val name = identifier.substringAfterLast('/').substringBefore('?')
        if (name.isBlank()) throw IOException("Bundled asset identifier is empty: $identifier")
        var resId = reactContext.resources.getIdentifier(name, "raw", reactContext.packageName)
        if (resId == 0) {
            resId = reactContext.resources.getIdentifier(name, "drawable", reactContext.packageName)
        }
        if (resId == 0) {
            throw IOException("Bundled asset not found in app resources: $name")
        }
        val input = reactContext.resources.openRawResource(resId)
            ?: throw IOException("Unable to open bundled asset resource: $name")
        Log.i(TAG, "Bundled asset [$name] -> resId=$resId")
        return copyStreamToAppStorage(input, prefix, ext, name)
    }

    private fun copyRemoteToAppStorage(url: String, prefix: String, ext: String): Uri {
        val connection = URL(url).openConnection()
        connection.connectTimeout = 20000
        connection.readTimeout = 60000
        connection.setRequestProperty("Accept-Encoding", "identity")
        val input = connection.getInputStream()
        Log.i(TAG, "Downloading remote bundled asset: $url")
        return copyStreamToAppStorage(input, prefix, ext, url.substringAfterLast('/'))
    }

    private fun copyStreamToAppStorage(input: InputStream, prefix: String, ext: String, label: String): Uri {
        val file = File(File(reactContext.filesDir, "wallpapers").apply { mkdirs() }, "${prefix}_${System.currentTimeMillis()}.${ext.ifBlank { "mp4" }}")
        return try {
            input.use { source ->
                file.outputStream().use { destination -> source.copyTo(destination) }
            }
            Log.i(TAG, "Prepared bundled media [$label] -> ${file.absolutePath} bytes=${file.length()} readable=${file.canRead()}")
            if (file.length() <= 0L) throw IOException("Prepared bundled media file is empty")
            Uri.fromFile(file)
        } catch (error: Exception) {
            file.delete()
            throw IOException("Unable to prepare bundled media [$label]", error)
        }
    }

    private fun saveWallpaperConfig(id: String, kind: String, videoUri: String, loop: Boolean, playbackDuration: Int, audio: Boolean, accent: String, rotation: Int = 0) {
        val preferences = reactContext.getSharedPreferences("wallpaper_pref", 0)
        val finalAccent = if (accent.isNotBlank()) accent else "#7C3AED"

        Log.i(TAG, "SAVING CONFIG TO SharedPreferences: kind=$kind, path=$videoUri, rotation=$rotation")

        preferences.edit()
            .putString("W_ID", id)
            .putString("W_KIND", kind)
            .putString("W_PATH", videoUri)
            .putBoolean("W_LOOP", loop)
            .putInt("W_DURATION", playbackDuration.coerceIn(1, 30))
            .putBoolean("W_AUDIO", audio)
            .putString("W_ACCENT", finalAccent)
            .putInt("W_ROTATION", rotation.coerceIn(0, 270))
            .commit()

        val check = preferences.getString("W_PATH", "FAILED")
        Log.i(TAG, "VERIFY SAVED PATH: $check")
    }

    private fun startPickerActivity(intent: Intent) {
        try {
            val activity = reactContext.currentActivity
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (activity != null) {
                activity.startActivity(intent)
            } else {
                reactContext.startActivity(intent)
            }
        } catch (error: ActivityNotFoundException) {
            Log.e(TAG, "No activity found to handle intent: ${intent.action}", error)
            throw error
        } catch (error: Exception) {
            Log.e(TAG, "Failed to start picker activity", error)
            throw error
        }
    }

    private fun openWallpaperConfirmation(component: ComponentName, flags: Int) {
        if (!liveWallpaperPickerAvailable()) {
            throw ActivityNotFoundException(
                "This device does not provide a live wallpaper picker. " +
                    "Live wallpapers are unsupported here; static wallpapers still work."
            )
        }
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

    private fun copyImageToAppStorage(uri: Uri): Uri {
        val imageDirectory = File(reactContext.filesDir, "wallpapers").apply { mkdirs() }
        val imageFile = File(imageDirectory, "image_${System.currentTimeMillis()}.jpg")
        val input = reactContext.contentResolver.openInputStream(uri)
            ?: throw IOException("Unable to open the selected image")

        try {
            input.use { source ->
                imageFile.outputStream().use { destination -> source.copyTo(destination) }
            }
            Log.i(TAG, "Copied image to app storage: ${imageFile.absolutePath} size=${imageFile.length()}")
            return Uri.fromFile(imageFile)
        } catch (error: Exception) {
            imageFile.delete()
            throw IOException("Unable to copy the selected image into app storage", error)
        }
    }

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
