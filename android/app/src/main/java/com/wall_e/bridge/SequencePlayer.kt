package com.wall_e.bridge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.util.LinkedHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * Self-owned software playback of a pre-extracted JPEG frame sequence. The
 * wallpaper engine drives the timeline (display vsync), and this player just
 * answers "which frame looks right for this timestamp".
 *
 * Frames are decoded on a small parallel pool (a few threads, bounded) with a
 * moving lookahead so playback (sequences are extracted at up to 30 fps) never
 * hiccups on decode latency. The render thread never blocks on JPEG I/O: it
 * only reads the LRU cache and the most recent decode results, so a slow disk
 * or a momentarily busy core can never stall the wallpaper's vsync loop.
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
        // Tight budget: 8 decoded frames at 720×720 ARGB_8888 ≈ 15 MB. This
        // keeps the total wallpaper-service RAM (old + new player during a
        // switch) under 30 MB of bitmap memory, well within the 200 MB target.
        private const val MAX_CACHED_FRAMES = 8
        // Short lookahead: 4 frames is enough to smooth decode jitter at 30 fps
        // without hoarding frames the render loop will not reach for a while.
        private const val LOOKAHEAD_FRAMES = 4
        // Two decode workers: enough to keep the pipeline fed on mid-range SoCs
        // while leaving one CPU core free for the render/Choreographer loop on
        // quad-core low-end devices.
        private const val DECODE_THREADS = 2
        // Hard memory cap for decoded bitmaps in this player instance. When the
        // cache exceeds this, the least-recently-used frames are recycled even if
        // they are within the lookahead window. Keeps total wallpaper-service
        // RAM bounded during transitions (old + new player alive simultaneously).
        private const val MAX_BITMAP_BYTES = 120L * 1024 * 1024 // 120 MB
    }

    private val baseDir = File(dirPath)

    /** Decoded frames currently in memory. Insertion access-order LRU. */
    private val cache = object : LinkedHashMap<Int, Bitmap>(MAX_CACHED_FRAMES, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Bitmap>): Boolean {
            if (size > MAX_CACHED_FRAMES) {
                // Eviction always happens on a decode worker, never the render
                // thread, so recycling here is safe.
                eldest.value.recycle()
                totalBitmapBytes -= eldest.value.byteCount
                return true
            }
            return false
        }
    }

    /** Running total of decoded bitmap bytes currently held in [cache]. */
    @Volatile
    private var totalBitmapBytes = 0L

    /** Indices currently queued or in-flight, so redundant decode requests for
     *  the same frame collapse instead of piling up work. */
    private val pendingDecodes = HashSet<Int>()

    private val decodePool: ExecutorService by lazy {
        val threadId = AtomicInteger(0)
        Executors.newFixedThreadPool(
            DECODE_THREADS,
            ThreadFactory { runnable ->
                val t = Thread(runnable, "seq-decode-${threadId.incrementAndGet()}")
                t.priority = Thread.NORM_PRIORITY
                t.isDaemon = true
                t
            },
        )
    }

    private val submissionLock = Any()
    private val lock = Any()

    private var frames = 0
    private var fps = 24
    private var width = 0
    private var height = 0
    private var ready = false
    private var loadError: String? = null
    @Volatile
    private var released = false

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
        if (!ready || frames == 0 || released) return null
        val target = index.mod(frames)
        val found = synchronized(lock) { cache[target] }
        // Frames further behind the cursor than a small lookback are now
        // unreachable during forward playback; evict them so memory does not
        // grow during long sessions.
        synchronized(lock) {
            evictBehindLocked(index)
        }
        requestDecode(target)
        for (i in 1..LOOKAHEAD_FRAMES) {
            requestDecode((index + i).mod(frames))
        }
        return found
    }

    /** Drops decoded frames strictly behind [index] by more than the lookahead
     *  window (allowing loop wrap). Caller must hold [lock]. */
    private fun evictBehindLocked(index: Int) {
        if (cache.isEmpty()) return
        val it = cache.entries.iterator()
        while (it.hasNext()) {
            val entry = it.next()
            if (distanceBehind(index, entry.key) > LOOKAHEAD_FRAMES) {
                totalBitmapBytes -= entry.value.byteCount
                try { entry.value.recycle() } catch (_: Throwable) {}
                it.remove()
            }
        }
    }

    /**
     * Aggressively prunes the oldest entries (lowest frame indices) until the
     * total bitmap memory is at or below [targetBytes]. Called when the memory
     * budget is exceeded. Caller must hold [lock].
     */
    private fun pruneOldestLocked(targetBytes: Long) {
        if (cache.isEmpty()) return
        // Sort entries by frame index (oldest first) and recycle until under budget.
        val sorted = cache.entries.sortedBy { it.key }
        for (entry in sorted) {
            if (totalBitmapBytes <= targetBytes) break
            totalBitmapBytes -= entry.value.byteCount
            try { entry.value.recycle() } catch (_: Throwable) {}
            cache.remove(entry.key)
            // Also drop from pending decodes so we do not re-decode frames we just evicted.
            synchronized(submissionLock) { pendingDecodes.remove(entry.key) }
        }
    }

    /** How far [frame] sits behind [current] with wrap-around handling. */
    private fun distanceBehind(current: Int, frame: Int): Int {
        val wrapped = ((frame - current) % frames + frames) % frames
        return wrapped
    }

    private fun requestDecode(index: Int) {
        if (released) return
        val shouldSubmit = synchronized(submissionLock) {
            val inCache = synchronized(lock) { cache.containsKey(index) }
            if (inCache || pendingDecodes.contains(index)) {
                false
            } else {
                pendingDecodes.add(index)
                true
            }
        }
        if (!shouldSubmit) return
        decodePool.execute {
            if (released) {
                synchronized(submissionLock) { pendingDecodes.remove(index) }
                return@execute
            }
            val bitmap = decodeFrame(index)
            if (bitmap == null) {
                synchronized(submissionLock) { pendingDecodes.remove(index) }
                return@execute
            }
            synchronized(submissionLock) {
                // A release can tear down the cache while this frame was
                // decoding. Never insert after release: re-inserting into the
                // cleared cache would orphan a full decoded frame (and leak a
                // few MB every wallpaper switch, which grows into persistent
                // wallpaper stutter). Recycle instead so the memory returns
                // immediately.
                if (released) {
                    pendingDecodes.remove(index)
                    try { bitmap.recycle() } catch (_: Throwable) {}
                    return@execute
                }
                synchronized(lock) {
                    if (cache.containsKey(index)) {
                        pendingDecodes.remove(index)
                        try { bitmap.recycle() } catch (_: Throwable) {}
                    } else {
                        cache[index] = bitmap
                        totalBitmapBytes += bitmap.byteCount
                        pendingDecodes.remove(index)
                        // Hard memory budget: when total decoded bitmap memory
                        // exceeds the cap, aggressively prune the oldest entries
                        // (lowest frame indices) so the wallpaper-service RAM
                        // stays bounded even during transitions where two
                        // SequencePlayer instances are briefly alive.
                        if (totalBitmapBytes > MAX_BITMAP_BYTES) {
                            pruneOldestLocked(MAX_BITMAP_BYTES / 2)
                        }
                    }
                }
            }
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
        if (!ready || frames == 0 || released) return null
        val target = index.mod(frames)
        var bestDistance = -1
        var best: Bitmap? = null
        synchronized(lock) {
            for ((key, bmp) in cache) {
                val distance = distanceBehind(target, key)
                if (distance <= LOOKAHEAD_FRAMES && distance > bestDistance) {
                    bestDistance = distance
                    best = bmp
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
        if (!ready || released) return
        requestDecode(startIndex.mod(frames))
        for (i in 1..LOOKAHEAD_FRAMES) {
            requestDecode((startIndex + i).mod(frames))
        }
    }

    /** Flushes decode-ahead and recycles everything. */
    fun release() {
        if (released) return
        released = true
        synchronized(submissionLock) {
            pendingDecodes.clear()
        }
        synchronized(lock) {
            cache.values.forEach { bmp ->
                try { bmp.recycle() } catch (_: Throwable) {}
            }
            cache.clear()
            totalBitmapBytes = 0L
        }
        try {
            decodePool.shutdownNow()
        } catch (_: Throwable) {
        }
    }
}
