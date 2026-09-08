package com.wall_e.bridge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.util.LinkedHashMap

/**
 * Self-owned software playback of a pre-extracted JPEG frame sequence. The
 * wallpaper engine drives the timeline (display vsync), and this player just
 * answers "which frame looks right for this timestamp". Frames are decoded on
 * a dedicated background thread with a small moving lookahead so playback
 * (sequences are extracted at up to 30 fps) never hiccups on decode latency.
 *
 * Because it only touches JPEG files and keeps a small decoded cache, it works
 * on any device — including ones where the hardware/Media3 decoder cannot
 * create a session for the wallpaper surface at all.
 */
class SequencePlayer(
    dirPath: String,
) {
    companion object {
        private const val TAG = "SequencePlayer"
        private const val MAX_CACHED_FRAMES = 20
        private const val LOOKAHEAD_FRAMES = 10
    }

    private val baseDir = File(dirPath)

    /** Decoded frames currently in memory. Insertion access-order LRU. */
    private val cache = object : LinkedHashMap<Int, Bitmap>(MAX_CACHED_FRAMES, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Bitmap>): Boolean {
            if (size > MAX_CACHED_FRAMES) {
                // Eviction always happens on the loader thread, never the render
                // thread, so recycling here is safe.
                eldest.value.recycle()
                return true
            }
            return false
        }
    }

    /** Indices currently queued on the loader thread, so redundant decode
     *  requests for the same frame collapse instead of piling up work. */
    private val pendingDecodes = HashSet<Int>()

    private val loadThread = HandlerThread("seq-loader").apply { start() }
    private val loadHandler = Handler(loadThread.looper)
    private val lock = Any()

    private var frames = 0
    private var fps = 24
    private var width = 0
    private var height = 0
    private var ready = false
    private var loadError: String? = null

    init {
        try {
            val manifestFile = File(baseDir, FrameSequenceExtractor.MANIFEST_NAME)
            if (!manifestFile.exists()) {
                throw IllegalStateException("No manifest in ${baseDir.absolutePath}")
            }
            val m = JSONObject(manifestFile.readText())
            frames = m.optInt("frames", 0)
            fps = m.optInt("fps", 24).coerceIn(1, 120)
            width = m.optInt("width", 0)
            height = m.optInt("height", 0)
            if (frames <= 0 || width <= 0 || height <= 0) {
                throw IllegalStateException("Empty or corrupt manifest in ${baseDir.absolutePath}")
            }
            ready = true
            Log.i(TAG, "Sequence ready: frames=$frames fps=$fps ${width}x$height")
        } catch (error: Exception) {
            loadError = error.message ?: "Corrupt frame sequence"
            Log.e(TAG, "Sequence load failed", error)
        }
    }

    fun isReady(): Boolean = ready
    fun error(): String? = loadError
    fun frameCount(): Int = frames
    fun frameRate(): Int = fps
    fun frameWidth(): Int = width
    fun frameHeight(): Int = height
    fun durationMs(): Long = if (fps > 0) (frames * 1000L) / fps else 0L

    /**
     * Returns the decoded bitmap for the absolute index [index] (wrapped into
     * the sequence range). Returns null while that frame is still decoding; the
     * caller keeps showing the previous frame. Decode-ahead is scheduled for
     * the following frames so consecutive lookups hit cache.
     */
    fun frameAt(index: Int): Bitmap? {
        if (!ready || frames == 0) return null
        val target = index.mod(frames)
        val found = synchronized(lock) { cache[target] }
        requestDecode(target)
        for (i in 1..LOOKAHEAD_FRAMES) {
            requestDecode((index + i).mod(frames))
        }
        return found
    }

    private fun requestDecode(index: Int) {
        synchronized(lock) {
            if (cache.containsKey(index) || pendingDecodes.contains(index)) return
            pendingDecodes.add(index)
        }
        loadHandler.post {
            val bitmap = decodeFrame(index)
            if (bitmap == null) {
                synchronized(lock) { pendingDecodes.remove(index) }
                return@post
            }
            val alreadyDecoded = synchronized(lock) {
                pendingDecodes.remove(index)
                if (cache.containsKey(index)) {
                    true
                } else {
                    cache[index] = bitmap
                    false
                }
            }
            if (alreadyDecoded) bitmap.recycle()
        }
    }

    /**
     * Returns the newest decoded frame whose index is at or behind [index]
     * (and within the lookahead window so wrapping can never surface a very
     * stale frame). The renderer uses this when the exact frame is not ready
     * yet — instead of holding an arbitrarily old frame and waiting, it shows
     * the latest available, then naturally skips the backlog once decode
     * catches up. Mirrors how real players drop frames under load.
     */
    fun latestReadyAtOrBefore(index: Int): Bitmap? {
        if (!ready || frames == 0) return null
        val target = index.mod(frames)
        var bestDistance = -1
        var best: Bitmap? = null
        synchronized(lock) {
            for (key in cache.keys) {
                val distance = ((target - key) % frames + frames) % frames
                if (distance <= LOOKAHEAD_FRAMES && distance > bestDistance) {
                    bestDistance = distance
                    best = cache[key]
                }
            }
        }
        return best
    }

    private fun decodeFrame(index: Int): Bitmap? {
        return try {
            val file = File(baseDir, String.format("%s%06d.jpg", FrameSequenceExtractor.FRAME_PREFIX, index))
            if (!file.exists()) return null
            BitmapFactory.decodeFile(file.absolutePath)
        } catch (error: Exception) {
            Log.w(TAG, "decodeFrame($index) failed", error)
            null
        }
    }

    /** Preloads the window around [startIndex] so the first paint is instant. */
    fun prime(startIndex: Int) {
        if (!ready) return
        requestDecode(startIndex.mod(frames))
        for (i in 1..LOOKAHEAD_FRAMES) {
            requestDecode((startIndex + i).mod(frames))
        }
    }

    /** Flushes decode-ahead and recycles everything (called from a non-render thread). */
    fun release() {
        synchronized(lock) {
            pendingDecodes.clear()
            cache.values.forEach { it.recycle() }
            cache.clear()
        }
        loadHandler.removeCallbacksAndMessages(null)
        loadThread.quitSafely()
    }
}