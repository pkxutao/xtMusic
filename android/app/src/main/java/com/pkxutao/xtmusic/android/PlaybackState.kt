package com.pkxutao.xtmusic.android

import java.util.concurrent.CopyOnWriteArraySet

data class PlaybackSnapshot(
    val track: Track? = null,
    val playing: Boolean = false,
    val preparing: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val error: String? = null
)

object PlaybackState {
    private val listeners = CopyOnWriteArraySet<(PlaybackSnapshot) -> Unit>()

    @Volatile
    var snapshot: PlaybackSnapshot = PlaybackSnapshot()
        private set

    fun update(value: PlaybackSnapshot) {
        snapshot = value
        listeners.forEach { listener ->
            try {
                listener(value)
            } catch (_: Exception) {
                // A destroyed activity must not break playback.
            }
        }
    }

    fun addListener(listener: (PlaybackSnapshot) -> Unit) {
        listeners += listener
        listener(snapshot)
    }

    fun removeListener(listener: (PlaybackSnapshot) -> Unit) {
        listeners -= listener
    }
}

object PlaybackQueue {
    private var tracks: List<Track> = emptyList()
    private var index: Int = -1

    @Synchronized
    fun set(items: List<Track>, selectedIndex: Int) {
        tracks = items.toList()
        index = selectedIndex.coerceIn(0, (tracks.size - 1).coerceAtLeast(0))
    }

    @Synchronized
    fun current(): Track? = tracks.getOrNull(index)

    @Synchronized
    fun next(): Track? {
        if (tracks.isEmpty()) return null
        index = (index + 1).coerceAtMost(tracks.lastIndex)
        return current()
    }

    @Synchronized
    fun previous(): Track? {
        if (tracks.isEmpty()) return null
        index = (index - 1).coerceAtLeast(0)
        return current()
    }

    @Synchronized
    fun canNext(): Boolean = index in 0 until tracks.lastIndex

    @Synchronized
    fun canPrevious(): Boolean = index > 0
}
