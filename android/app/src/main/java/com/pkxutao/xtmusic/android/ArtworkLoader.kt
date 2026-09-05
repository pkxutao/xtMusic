package com.pkxutao.xtmusic.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.math.max

class ArtworkLoader(context: Context) {
    @Volatile private var closed = false
    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newFixedThreadPool(4) { task ->
        Thread(task, "xtmusic-artwork").apply { isDaemon = true }
    }
    private val cacheDirectory = File(appContext.cacheDir, "artwork-v2").apply { mkdirs() }
    private val memoryCache = object : LruCache<String, Bitmap>(memoryLimitKb()) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    fun load(
        target: ImageView,
        client: FnosClient?,
        coverId: String?,
        requestedSizePx: Int,
        seed: String = coverId.orEmpty()
    ) {
        if (closed) return
        target.scaleType = ImageView.ScaleType.CENTER_CROP
        target.background = placeholder(seed)
        val normalized = coverId?.trim().orEmpty()
        if (client == null || normalized.isBlank()) {
            target.setImageDrawable(null)
            target.tag = null
            return
        }

        val size = requestedSizePx.coerceIn(96, 1600)
        val key = "${client.session().serverUrl}|$normalized|$size"
        target.tag = key
        memoryCache.get(key)?.let { bitmap ->
            target.setImageBitmap(bitmap)
            target.alpha = 1f
            return
        }
        target.setImageDrawable(null)

        executor.execute {
            val bitmap = runCatching {
                val diskFile = File(cacheDirectory, sha256(key) + ".img")
                val bytes = if (diskFile.isFile && diskFile.length() in 1..MAX_DISK_ARTWORK_BYTES) {
                    diskFile.readBytes()
                } else {
                    client.fetchArtwork(normalized, size).also { downloaded ->
                        if (downloaded.isNotEmpty() && downloaded.size <= MAX_DISK_ARTWORK_BYTES) {
                            val temp = File(cacheDirectory, diskFile.name + ".tmp")
                            temp.writeBytes(downloaded)
                            if (!temp.renameTo(diskFile)) {
                                diskFile.writeBytes(downloaded)
                                temp.delete()
                            }
                            trimDiskCache()
                        }
                    }
                }
                decodeSampled(bytes, size)
            }.getOrNull()

            if (closed) return@execute
            if (bitmap != null) memoryCache.put(key, bitmap)
            mainHandler.post {
                if (closed || target.tag != key) return@post
                if (bitmap == null) {
                    target.setImageDrawable(null)
                    target.alpha = 1f
                } else {
                    target.alpha = 0.35f
                    target.setImageBitmap(bitmap)
                    target.animate().alpha(1f).setDuration(220L).start()
                }
            }
        }
    }

    fun close() {
        closed = true
        executor.shutdownNow()
        mainHandler.removeCallbacksAndMessages(null)
        clearMemory()
    }

    fun clearMemory() {
        memoryCache.evictAll()
    }

    private fun decodeSampled(bytes: ByteArray, requestedSize: Int): Bitmap? {
        if (bytes.isEmpty()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        val largest = max(bounds.outWidth, bounds.outHeight)
        while (largest / (sample * 2) >= requestedSize) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample.coerceAtLeast(1)
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }

    private fun placeholder(seed: String): GradientDrawable {
        val hash = seed.hashCode()
        val hue = ((hash and 0x7fffffff) % 320).toFloat()
        val start = Color.HSVToColor(floatArrayOf(hue, 0.44f, 0.38f))
        val end = Color.HSVToColor(floatArrayOf((hue + 42f) % 360f, 0.58f, 0.17f))
        return GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(start, end))
    }

    private fun trimDiskCache() {
        val files = cacheDirectory.listFiles()?.filter { it.isFile && !it.name.endsWith(".tmp") }
            ?.sortedByDescending { it.lastModified() }
            ?: return
        var total = 0L
        files.forEach { file ->
            total += file.length()
            if (total > MAX_DISK_CACHE_BYTES) file.delete()
        }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun memoryLimitKb(): Int {
        val maxMemoryKb = (Runtime.getRuntime().maxMemory() / 1024L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        return (maxMemoryKb / 12).coerceIn(8 * 1024, 48 * 1024)
    }

    companion object {
        private const val MAX_DISK_ARTWORK_BYTES = 8L * 1024L * 1024L
        private const val MAX_DISK_CACHE_BYTES = 160L * 1024L * 1024L
    }
}
