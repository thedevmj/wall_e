package com.wall_e.bridge

import android.app.WallpaperManager
import android.app.Activity
import android.content.ComponentName
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import java.net.HttpURLConnection
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject
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
import java.security.MessageDigest
import android.graphics.Bitmap
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
                    val bytes = playableUri.path?.let { File(it).length() } ?: 0L
                    val digest = sha1File(playableUri)
                    val posterUri = extractVideoPoster(playableUri)

                    val result: WritableMap = Arguments.createMap().apply {
                        putString("uri", playableUri.toString())
                        putDouble("durationSeconds", durationSeconds.toDouble())
                        putDouble("bytes", bytes.toDouble())
                        putString("digest", digest)
                        if (posterUri != null) putString("posterUri", posterUri.toString())
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
        private const val COMMITTED_PREFS = "wallpaper_pref"
        private const val PREVIEW_PREFS = "wallpaper_preview_pref"
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
                pushString("Animated pixel art wallpaper")
                pushString("Battery fluid wallpaper")
                pushString("Fluid animated wallpaper")
                pushString("Video rotation")
                pushString("Wallpaper picker")
            }

            val capabilities: WritableMap = Arguments.createMap().apply {
                putBoolean("supportsLiveWallpaper", supportsLive)
                putBoolean("setWallpaperAllowed", setWallpaperAllowed)
                putBoolean("liveWallpaperPickerAvailable", livePickerAvailable)
                // Direct live-wallpaper set requires the signature-level
                // SET_WALLPAPER_COMPONENT permission, which a normal install never
                // holds, so it is reported as unavailable.
                putBoolean("canSetLiveWallpaperDirectly", false)
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
                putBoolean("canSetLiveWallpaperDirectly", false)
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
    fun applyWallpaper(id: String, kind: String, destination: String, videoUri: String, loop: Boolean, playbackDuration: Int, audio: Boolean, rotation: Int, accent: String, promise: Promise) {
        try {
            Log.i(TAG, "applyWallpaper called: id=$id, kind=$kind, destination=$destination, uri=$videoUri, loop=$loop, duration=$playbackDuration, audio=$audio, rotation=$rotation, accent=$accent")

            if (kind == "static") {
                applyStaticWallpaper(id, videoUri, destination) { ok, error, errorCode ->
                    postToUi {
                        val result: WritableMap = Arguments.createMap().apply {
                            putBoolean("ok", ok)
                            putString("id", id)
                            putString("destination", destination)
                            putString("mode", "static-wallpaper-$destination")
                            if (error != null) putString("error", error)
                            if (!ok) putString("errorCode", errorCode)
                        }
                        promise.resolve(result)
                    }
                }
                return
            }

            // The battery-fluid, membrane, and fluid wallpapers are fully self-contained
            // (battery reads battery+state natively, membrane and fluid render procedurally)
            // and need no media URI, rotation, or loop config. They flow through the
            // same live-wallpaper confirmation path as video.
            if (kind == "battery" || kind == "membrane" || kind == "fluid") {
                finishLiveApply(id, kind, destination, "", true, playbackDuration, false, 0, accent, promise)
                return
            }

            val normalizedRotation = rotation.coerceIn(0, 270)
            if (normalizedRotation == 0) {
                val mediaUri = resolveMediaUri(videoUri, "bundled_video", "mp4")
                finishLiveApply(id, kind, destination, mediaUri.toString(), loop, playbackDuration, audio, 0, accent, promise)
                return
            }

            Thread {
                try {
                    val original = resolveMediaUri(videoUri, "bundled_video", "mp4")
                    // When a software frame sequence exists for the original file,
                    // play the original with W_ROTATION set: the sequence engine
                    // renders the rotated orientation natively (cheap matrix) and
                    // never stutters. Transcoding to a pre-rotated file is only
                    // worthwhile when there is no sequence to serve the rotation.
                    if (readSequenceInfo(sequenceDirFor(absFile(original) ?: File(original.path.orEmpty()))) != null) {
                        Log.i(TAG, "Sequence available for original; applying original with rotation=$normalizedRotation")
                        finishLiveApply(id, kind, destination, original.toString(), loop, playbackDuration, audio, normalizedRotation, accent, promise, original.toString())
                        return@Thread
                    }
                    val rotatedUri = rotateVideoIfPossible(original, normalizedRotation)
                    if (rotatedUri != null) {
                        Log.i(TAG, "Rotation transcode succeeded; playing pre-rotated file with rotation=0")
                        finishLiveApply(id, kind, destination, rotatedUri.toString(), loop, playbackDuration, audio, 0, accent, promise)
                    } else {
                        Log.w(TAG, "Rotation transcode failed/unavailable; falling back to original with rotation=$normalizedRotation")
                        finishLiveApply(id, kind, destination, original.toString(), loop, playbackDuration, audio, normalizedRotation, accent, promise, original.toString())
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
        accent: String,
        promise: Promise,
        sequenceUri: String? = null,
    ) {
        // Write only a *pending* config first; it becomes the committed wallpaper
        // when the user confirms in the system live wallpaper picker. The
        // currently set wallpaper is never touched on failure/cancel.
        //
        // Direct set (WallpaperManager.setWallpaperComponent) was removed: it is
        // gated by the signature-level SET_WALLPAPER_COMPONENT permission inside
        // system_server, which a normal install never holds, and it added a code
        // path that could leave wallpaper in a half-set state. The auto-targeted
        // system picker is the reliable path on every Android device.
        savePreviewConfig(id, kind, mediaUri, loop, playbackDuration, audio, accent, rotation, sequenceUri)
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
                Log.i(TAG, "Live wallpaper picker opened for $destination (flags=$flags)")
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

    /**
     * Attempts to set our live wallpaper component directly without the system
     * picker. Returns true on success.
     *
     * setWallpaperComponent(ComponentName) is a hidden @SystemApi whose access is
     * gated by the signature-level SET_WALLPAPER_COMPONENT permission *inside
     * system_server*, so reflection cannot bypass it: only installs that are
     * system/privileged apps (or signed with the platform key) can set a live
     * wallpaper directly.
     *
     * NOTE: no longer called by the apply flow, which always uses the system
     * picker. Kept only as a reference for system-app builds.
     */
    @Suppress("unused")
    private fun setLiveWallpaperComponentDirectly(component: ComponentName): Boolean {
        if (!hasSetWallpaperComponentPermission()) {
            Log.w(TAG, "SET_WALLPAPER_COMPONENT not granted; direct live-wallpaper set unavailable (system-app install required)")
            return false
        }
        return try {
            val wallpaperManager = WallpaperManager.getInstance(reactContext)
            val method = wallpaperManager.javaClass
                .getMethod("setWallpaperComponent", ComponentName::class.java)
            method.invoke(wallpaperManager, component)
            Log.i(TAG, "setWallpaperComponent succeeded: $component")
            true
        } catch (error: java.lang.reflect.InvocationTargetException) {
            Log.w(TAG, "setWallpaperComponent rejected by system_server", error.cause ?: error)
            false
        } catch (error: SecurityException) {
            Log.w(TAG, "setWallpaperComponent denied (no SET_WALLPAPER_COMPONENT permission)", error)
            false
        } catch (error: Exception) {
            Log.w(TAG, "setWallpaperComponent failed; falling back to picker", error)
            false
        }
    }

    private fun hasSetWallpaperComponentPermission(): Boolean {
        return try {
            reactContext.checkCallingOrSelfPermission("android.permission.SET_WALLPAPER_COMPONENT") ==
                PackageManager.PERMISSION_GRANTED
        } catch (_: Exception) {
            false
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

    private fun applyStaticWallpaper(
        id: String,
        imageUri: String,
        destination: String,
        onResult: (ok: Boolean, error: String?, errorCode: String) -> Unit,
    ) {
        try {
            if (imageUri.isBlank()) {
                onResult(false, "No image selected", "NO_IMAGE")
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
                onResult(false, "Could not decode the selected image", "IMAGE_DECODE_ERROR")
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
            onResult(true, null, "OK")
        } catch (error: Exception) {
            Log.e(TAG, "Failed to apply static wallpaper", error)
            onResult(false, "Unable to set the static wallpaper: ${error.message}", "STATIC_APPLY_ERROR")
        }
    }
    @ReactMethod
    fun getBatteryLevel(promise: Promise) {
        try {
            // Reading a sticky ACTION_BATTERY_CHANGED with a null receiver does not
            // register anything, so there is no leak to worry about.
            val intent = reactContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val percent = if (level >= 0 && scale > 0) (level * 100f / scale).coerceIn(0f, 100f) else 0f
            val charging =
                status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL
            val result: WritableMap = Arguments.createMap().apply {
                putDouble("level", percent.toDouble())
                putBoolean("charging", charging)
            }
            promise.resolve(result)
        } catch (error: Exception) {
            Log.e(TAG, "getBatteryLevel failed", error)
            promise.reject("BATTERY_ERROR", "Unable to read battery level", error)
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
        val preferences = reactContext.getSharedPreferences(COMMITTED_PREFS, 0)
        val finalAccent = if (accent.isNotBlank()) accent else "#7C3AED"

        Log.i(TAG, "SAVING CONFIG TO SharedPreferences: kind=$kind, path=$videoUri, rotation=$rotation")

        val editor = preferences.edit()
            .putString("W_ID", id)
            .putString("W_KIND", kind)
            .putString("W_PATH", videoUri)
            .putBoolean("W_LOOP", loop)
            .putInt("W_DURATION", playbackDuration.coerceIn(1, 30))
            .putBoolean("W_AUDIO", audio)
            .putString("W_ACCENT", finalAccent)
            .putInt("W_ROTATION", rotation.coerceIn(0, 270))
        writeSequenceKeysIfCached(editor, videoUri)
        editor.commit()

        val check = preferences.getString("W_PATH", "FAILED")
        Log.i(TAG, "VERIFY SAVED PATH: $check")
    }

    /**
     * Writes the not-yet-confirmed live wallpaper selection into the preview
     * store. The live wallpaper service only uses this while it is being shown
     * in the system wallpaper picker; the committed store is updated only after
     * the user confirms (see [resolvePendingApply]).
     */
    private fun savePreviewConfig(id: String, kind: String, videoUri: String, loop: Boolean, playbackDuration: Int, audio: Boolean, accent: String, rotation: Int = 0, sequenceUri: String? = null) {
        val preview = reactContext.getSharedPreferences(PREVIEW_PREFS, 0)
        val finalAccent = if (accent.isNotBlank()) accent else "#7C3AED"

        Log.i(TAG, "SAVING PREVIEW CONFIG: kind=$kind, path=$videoUri, rotation=$rotation")

        val editor = preview.edit()
            .putString("W_ID", id)
            .putString("W_KIND", kind)
            .putString("W_PATH", videoUri)
            .putBoolean("W_LOOP", loop)
            .putInt("W_DURATION", playbackDuration.coerceIn(1, 30))
            .putBoolean("W_AUDIO", audio)
            .putString("W_ACCENT", finalAccent)
            .putInt("W_ROTATION", rotation.coerceIn(0, 270))
        // A rotated wallpaper plays a pre-rotated copy (W_PATH), but its frame
        // sequence was extracted from the ORIGINAL file. Look the sequence keys
        // up against the original uri so the engine still engages the software
        // path; otherwise it falls back to ExoPlayer and stutters.
        writeSequenceKeysIfCached(editor, sequenceUri ?: videoUri)
        editor.commit()

        // Tag the committed store with the id of the pending live wallpaper so
        // resolvePendingApply knows there is a selection awaiting confirmation.
        reactContext.getSharedPreferences(COMMITTED_PREFS, 0)
            .edit()
            .putString("W_PREVIEW_ID", id)
            .putLong("W_PREVIEW_TIME", System.currentTimeMillis())
            .commit()
    }

    /**
     * Resolves a pending live wallpaper apply. Called when the app returns to
     * the foreground after the system wallpaper picker closes.
     *
     * - If our live wallpaper is now the active wallpaper, the pending preview
     *   is promoted to the committed wallpaper (the user confirmed).
     * - Otherwise the pending preview is discarded and the previously committed
     *   wallpaper is left exactly as it was (the user cancelled).
     *
     * This is what finally commits a live wallpaper and why cancelling the
     * picker never leaves a trace behind.
     */
    @ReactMethod
    fun resolvePendingApply(promise: Promise) {
        try {
            val committed = reactContext.getSharedPreferences(COMMITTED_PREFS, 0)
            val preview = reactContext.getSharedPreferences(PREVIEW_PREFS, 0)
            val pendingId = committed.getString("W_PREVIEW_ID", null)

            if (pendingId.isNullOrBlank()) {
                postToUi {
                    val result: WritableMap = Arguments.createMap().apply {
                        putBoolean("committed", false)
                    }
                    promise.resolve(result)
                }
                return
            }

            if (isOurLiveWallpaperActive()) {
                Log.i(TAG, "resolvePendingApply: live wallpaper confirmed, committing $pendingId")
                // Promote preview -> committed so the settled wallpaper persists.
                commitPendingToWallpaper()
                clearPendingApply()
                postToUi {
                    val result: WritableMap = Arguments.createMap().apply {
                        putBoolean("committed", true)
                        putString("id", pendingId)
                    }
                    promise.resolve(result)
                }
            } else {
                Log.i(TAG, "resolvePendingApply: picker cancelled, discarding pending $pendingId")
                // Discard the preview; the committed wallpaper stays unchanged.
                preview.edit().clear().commit()
                clearPendingApply()
                postToUi {
                    val result: WritableMap = Arguments.createMap().apply {
                        putBoolean("committed", false)
                    }
                    promise.resolve(result)
                }
            }
        } catch (error: Exception) {
            Log.e(TAG, "resolvePendingApply failed", error)
            postToUi {
                promise.resolve(Arguments.createMap().apply { putBoolean("committed", false) })
            }
        }
    }

    /**
     * True when our live wallpaper component is the currently-set live wallpaper
     * on the home/system *or* the lock screen.
     *
     * This must check both flags. getWallpaperInfo() (public API) only reports
     * the home/system wallpaper, so a live wallpaper applied only to the LOCK
     * screen would otherwise be seen as "not ours" and the apply treated as a
     * cancel. The lock-specific getWallpaperInfo(int which) is hidden, so it is
     * read reflectively when available and skipped otherwise.
     */
    private fun isOurLiveWallpaperActive(): Boolean {
        val ours = ComponentName(reactContext.packageName, "com.wall_e.wallpaper.LiveWallpaperService")
        return try {
            val wm = reactContext.getSystemService(WallpaperManager::class.java)
                ?: return false
            val systemInfo = wm.wallpaperInfo
            val lockInfo = wallInfoFor(wm, WallpaperManager.FLAG_LOCK)
            val active =
                (systemInfo != null && systemInfo.component == ours) ||
                    (lockInfo != null && lockInfo.component == ours)
            Log.i(TAG, "isOurLiveWallpaperActive: system=${systemInfo?.component} lock=${lockInfo?.component} -> $active")
            active
        } catch (_: Exception) {
            false
        }
    }

    /** Reads the (hidden) per-screen WallpaperInfo. Returns null when unavailable. */
    private fun wallInfoFor(wm: WallpaperManager, which: Int): android.app.WallpaperInfo? {
        return try {
            val method = WallpaperManager::class.java
                .getDeclaredMethod("getWallpaperInfo", Int::class.javaPrimitiveType)
            method.isAccessible = true
            method.invoke(wm, which) as? android.app.WallpaperInfo
        } catch (_: Exception) {
            null
        }
    }

    private fun commitPendingToWallpaper() {
        val committed = reactContext.getSharedPreferences(COMMITTED_PREFS, 0)
        val preview = reactContext.getSharedPreferences(PREVIEW_PREFS, 0)
        val editor = committed.edit()
        if (preview.contains("W_ID")) editor.putString("W_ID", preview.getString("W_ID", ""))
        if (preview.contains("W_KIND")) editor.putString("W_KIND", preview.getString("W_KIND", "doodle"))
        if (preview.contains("W_PATH")) editor.putString("W_PATH", preview.getString("W_PATH", ""))
        if (preview.contains("W_LOOP")) editor.putBoolean("W_LOOP", preview.getBoolean("W_LOOP", true))
        if (preview.contains("W_DURATION")) editor.putInt("W_DURATION", preview.getInt("W_DURATION", 30))
        if (preview.contains("W_AUDIO")) editor.putBoolean("W_AUDIO", preview.getBoolean("W_AUDIO", false))
        if (preview.contains("W_ACCENT")) editor.putString("W_ACCENT", preview.getString("W_ACCENT", "#7C3AED"))
        if (preview.contains("W_ROTATION")) editor.putInt("W_ROTATION", preview.getInt("W_ROTATION", 0))
        if (preview.contains("W_SEQ_DIR")) editor.putString("W_SEQ_DIR", preview.getString("W_SEQ_DIR", ""))
        if (preview.contains("W_SEQ_FPS")) editor.putInt("W_SEQ_FPS", preview.getInt("W_SEQ_FPS", 0))
        if (preview.contains("W_SEQ_FRAMES")) editor.putInt("W_SEQ_FRAMES", preview.getInt("W_SEQ_FRAMES", 0))
        editor.commit()
        preview.edit().clear().commit()
        Log.i(TAG, "Committed pending preview to wallpaper: path=${committed.getString("W_PATH", "")}")
    }

    private fun clearPendingApply() {
        reactContext.getSharedPreferences(COMMITTED_PREFS, 0)
            .edit()
            .remove("W_PREVIEW_ID")
            .remove("W_PREVIEW_TIME")
            .commit()
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

    /**
     * Deletes an app-private media file (the copied videos/images under
     * filesDir/wallpapers). Content or remote URIs are ignored so we never
     * delete user-owned document-picker files. Also removes any pre-rotated
     * variants derived from a video source. Returns the number of files deleted.
     *
     * Called by the JS layer when a user wallpaper is deleted or its video is
     * replaced, so copied videos stop accumulating in app-private storage.
     */
    @ReactMethod
    fun deleteStoredMedia(uri: String, promise: Promise) {
        Thread {
            try {
                if (uri.isBlank()) {
                    postToUi { promise.resolve(0) }
                    return@Thread
                }
                val parsed = Uri.parse(uri)
                if (parsed.scheme?.equals("file", ignoreCase = true) != true || parsed.path == null) {
                    postToUi { promise.resolve(0) }
                    return@Thread
                }
                val wallpapersDir = File(reactContext.filesDir, "wallpapers")
                val target = File(parsed.path!!)
                if (!target.absolutePath.startsWith(wallpapersDir.absolutePath)) {
                    postToUi { promise.resolve(0) }
                    return@Thread
                }

                var deleted = 0
                if (target.exists()) {
                    if (target.isDirectory) {
                        // Software playback sequences live in a directory.
                        deleted += (target.listFiles()?.size ?: 0) + 1
                        target.deleteRecursively()
                    } else if (target.delete()) {
                        deleted++
                    }
                }
                // Clean up any cached pre-rotated copies: rotated_<name>_r<deg>.mp4
                val rotatedPattern = "rotated_${target.nameWithoutExtension}_r"
                wallpapersDir.listFiles()?.forEach { sibling ->
                    if (sibling.isFile && sibling.name.startsWith(rotatedPattern) && sibling.delete()) {
                        deleted++
                    }
                }
                Log.i(TAG, "deleteStoredMedia: $uri -> deleted=$deleted")
                postToUi { promise.resolve(deleted) }
            } catch (error: Exception) {
                Log.e(TAG, "deleteStoredMedia failed", error)
                postToUi {
                    promise.reject("MEDIA_DELETE_ERROR", "Unable to delete stored media: ${error.message}", error)
                }
            }
        }.start()
    }

    /**
     * Reports the current usage of the app-private wallpapers directory
     * (copied videos, images, and cached rotated files). The `items` array lets
     * the JS layer identify orphaned files and enforce a storage quota by
     * deleting the oldest unreferenced copies.
     */
    @ReactMethod
    fun getWallpaperStorage(promise: Promise) {
        try {
            val dir = File(reactContext.filesDir, "wallpapers")
            var totalBytes = 0L
            val itemArray: WritableArray = Arguments.createArray()
            if (dir.exists()) {
                dir.listFiles()?.filter { it.isFile }?.sortedBy { it.lastModified() }?.forEach { file ->
                    totalBytes += file.length()
                    val item: WritableMap = Arguments.createMap().apply {
                        putString("path", file.absolutePath)
                        putString("name", file.name)
                        putDouble("bytes", file.length().toDouble())
                        putDouble("modified", file.lastModified().toDouble())
                    }
                    itemArray.pushMap(item)
                }
                // Software playback sequences are directories (JPEG frames +
                // manifest). Report each as one storage item so the quota keeper
                // can prune abandoned sequences exactly like orphaned files.
                dir.listFiles()?.filter { it.isDirectory && it.name.startsWith("seq_") }
                    ?.sortedBy { it.lastModified() }?.forEach { seq ->
                        val seqBytes = seq.walkTopDown().filter { it.isFile }.sumOf { it.length() }
                        totalBytes += seqBytes
                        val modified = File(seq, FrameSequenceExtractor.MANIFEST_NAME)
                            .takeIf { it.exists() }?.lastModified() ?: seq.lastModified()
                        val item: WritableMap = Arguments.createMap().apply {
                            putString("path", seq.absolutePath)
                            putString("name", seq.name)
                            putDouble("bytes", seqBytes.toDouble())
                            putDouble("modified", modified.toDouble())
                            putBoolean("directory", true)
                        }
                        itemArray.pushMap(item)
                    }
            }
            val result: WritableMap = Arguments.createMap().apply {
                putInt("files", itemArray.size())
                putDouble("totalBytes", totalBytes.toDouble())
                putArray("items", itemArray)
            }
            promise.resolve(result)
        } catch (error: Exception) {
            Log.e(TAG, "getWallpaperStorage failed", error)
            promise.reject("STORAGE_ERROR", "Unable to read wallpaper storage usage", error)
        }
    }

    /**
     * SHA-1 digest of a file. Used to de-duplicate re-imported videos: when a
     * user picks the same video again, JS compares this digest with registered
     * ones and reuses the existing app-private copy instead of keeping a new
     * duplicate on disk.
     */
    private fun sha1File(uri: Uri): String {
        val file = uri.path?.let { File(it) }
            ?: return ""
        try {
            val messageDigest = MessageDigest.getInstance("SHA-1")
            file.inputStream().use { input ->
                val buffer = ByteArray(8192)
                var read = input.read(buffer)
                while (read > 0) {
                    messageDigest.update(buffer, 0, read)
                    read = input.read(buffer)
                }
            }
            return messageDigest.digest().joinToString("") { "%02x".format(it) }
        } catch (error: Exception) {
            Log.w(TAG, "sha1File failed for ${file.absolutePath}", error)
            return ""
        }
    }

    // -------------------------------------------------------------------------
    // Software playback frame sequences
    // -------------------------------------------------------------------------

    /**
     * Cache of prepared frame sequences keyed by the video file's absolute
     * path. Populated by [prepareVideoFrameSequence]; consumed by the config
     * writers so `${W_SEQ_DIR}` etc. reach the wallpaper service.
     */
    private val frameSequenceCache = java.util.concurrent.ConcurrentHashMap<String, FrameSequenceInfo>()

    private fun writeSequenceKeysIfCached(editor: android.content.SharedPreferences.Editor, videoUri: String) {
        val file = absoluteFileFromUri(videoUri) ?: return
        // Prefer the in-memory cache, but fall back to reading the on-disk
        // manifest so W_SEQ_DIR etc. reach the wallpaper service even on the
        // first apply of a session, before prepareVideoFrameSequence has run
        // in-process. Without this the engine starts on ExoPlayer and stutters.
        val info = frameSequenceCache[file.absolutePath]
            ?: readSequenceInfo(sequenceDirFor(file))
        if (info == null) return
        editor.putString("W_SEQ_DIR", info.dirPath)
        editor.putInt("W_SEQ_FPS", info.fps)
        editor.putInt("W_SEQ_FRAMES", info.frames)
    }

    private fun absoluteFileFromUri(uri: String): File? {
        if (uri.isBlank()) return null
        val parsed = Uri.parse(uri)
        val path = if (parsed.scheme == "file") parsed.path else uri
        val file = File(path.orEmpty())
        return if (file.isFile) file else null
    }

    /** Deterministic sequence directory for a video: seq_<digest10>. */
    private fun sequenceDirFor(file: File): File {
        val digest = sha1File(Uri.fromFile(file))
        val key = if (digest.isNotBlank()) digest.take(10) else Integer.toHexString(file.name.hashCode())
        return File(File(reactContext.filesDir, "wallpapers"), "seq_$key")
    }

    private fun readSequenceInfo(dir: File): FrameSequenceInfo? {
        return try {
            val manifest = File(dir, FrameSequenceExtractor.MANIFEST_NAME)
            if (!manifest.exists() || !dir.isDirectory) return null
            val json = org.json.JSONObject(manifest.readText())
            FrameSequenceInfo(
                dir.absolutePath,
                json.optInt("frames", 0),
                json.optInt("fps", 24).coerceIn(1, 120),
                json.optInt("width", 0),
                json.optInt("height", 0),
                json.optLong("durationMs", 0),
            )
        } catch (error: Exception) {
            Log.w(TAG, "readSequenceInfo failed for ${dir.absolutePath}", error)
            null
        }
    }

    /**
     * Extracts the self-owned software playback sequence for a video (JPEG
     * frames + manifest) if it is not already cached, then records it so any
     * wallpaper using that video renders smoothly even when no hardware decoder
     * is available. The heavy decode runs off the UI thread.
     */
    @ReactMethod
    fun prepareVideoFrameSequence(videoUri: String, promise: Promise) {
        Thread {
            try {
                val parsed = Uri.parse(videoUri)
                var file = absoluteFileFromUri(videoUri)
                if (file == null) {
                    val copied = copyVideoToAppStorage(parsed)
                    file = absFile(copied)
                }
                val local = checkNotNull(file)
                val dir = sequenceDirFor(local)
                var info = readSequenceInfo(dir)
                if (info == null) {
                    info = FrameSequenceExtractor.extract(reactContext, local.absolutePath, dir.absolutePath)
                }
                frameSequenceCache[local.absolutePath] = info

                // If this video is currently the live wallpaper, make sure the
                // engine picks the sequence up on its next config reload.
                val prefs = reactContext.getSharedPreferences(COMMITTED_PREFS, 0)
                val preview = reactContext.getSharedPreferences(PREVIEW_PREFS, 0)
                val editors = ArrayList<android.content.SharedPreferences.Editor>()
                if (absoluteFileFromUri(prefs.getString("W_PATH", "") ?: "")?.absolutePath == local.absolutePath) {
                    editors.add(prefs.edit())
                }
                if (absoluteFileFromUri(preview.getString("W_PATH", "") ?: "")?.absolutePath == local.absolutePath) {
                    editors.add(preview.edit())
                }
                editors.forEach { editor ->
                    editor.putString("W_SEQ_DIR", info.dirPath)
                        .putInt("W_SEQ_FPS", info.fps)
                        .putInt("W_SEQ_FRAMES", info.frames)
                        .commit()
                }

                val result: WritableMap = Arguments.createMap().apply {
                    putString("dir", info.dirPath)
                    putInt("frames", info.frames)
                    putInt("fps", info.fps)
                    putInt("width", info.width)
                    putInt("height", info.height)
                    putDouble("durationMs", info.durationMs.toDouble())
                }
                postToUi { promise.resolve(result) }
            } catch (error: Exception) {
                Log.w(TAG, "prepareVideoFrameSequence failed for $videoUri", error)
                postToUi {
                    promise.reject(
                        "SEQUENCE_PREP_ERROR",
                        "Unable to prepare software playback: ${error.message}",
                        error,
                    )
                }
            }
        }.start()
    }

    private fun absFile(uri: Uri): File? = uri.path?.let { File(it) }

    /**
     * Extracts a poster JPEG from the first real video frame and saves it under
     * filesDir/wallpapers so the React library grid and detail preview can show
     * a thumbnail for user-imported videos. Returns null when extraction is not
     * possible (very short/corrupt videos).
     */
    private fun extractVideoPoster(uri: Uri): Uri? {
        var retriever: MediaMetadataRetriever? = null
        return try {
            retriever = MediaMetadataRetriever()
            retriever.setDataSource(reactContext, uri)
            // Seek ~1s in so the frame is not the black first frame; clamp to the
            // duration for very short clips.
            val durationMs = retriever
                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull() ?: 1000L
            val atUs = (if (durationMs >= 2000L) 1_000_000L else 100_000L)
            val frame = retriever.getFrameAtTime(atUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.getFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: return null
            val file = File(
                File(reactContext.filesDir, "wallpapers").apply { mkdirs() },
                "poster_${System.currentTimeMillis()}.jpg"
            )
            val ok = file.outputStream().use { out ->
                frame.compress(Bitmap.CompressFormat.JPEG, 82, out)
            }
            frame.recycle()
            if (!ok || file.length() <= 0L) {
                file.delete()
                return null
            }
            Log.i(TAG, "Extracted poster: ${file.absolutePath} bytes=${file.length()}")
            Uri.fromFile(file)
        } catch (error: Exception) {
            Log.w(TAG, "Could not extract video poster", error)
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
