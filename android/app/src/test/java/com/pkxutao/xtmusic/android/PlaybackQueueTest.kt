package com.pkxutao.xtmusic.android

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackQueueTest {
    private val tracks = listOf(
        Track(guid = "t1", title = "第一首"),
        Track(guid = "t2", title = "第二首"),
        Track(guid = "t3", title = "第三首")
    )

    @After
    fun tearDown() {
        PlaybackQueue.clear()
    }

    @Test
    fun snapshotReturnsQueueAndSelectedIndex() {
        PlaybackQueue.set(tracks, 1)
        val snapshot = PlaybackQueue.snapshot()
        assertEquals(tracks.map { it.guid }, snapshot.tracks.map { it.guid })
        assertEquals(1, snapshot.index)
        assertEquals("t2", PlaybackQueue.current()?.guid)
    }

    @Test
    fun selectJumpsToValidQueueItemAndRejectsInvalidIndex() {
        PlaybackQueue.set(tracks, 0)
        assertEquals("t3", PlaybackQueue.select(2)?.guid)
        assertEquals(2, PlaybackQueue.snapshot().index)
        assertNull(PlaybackQueue.select(9))
        assertEquals(2, PlaybackQueue.snapshot().index)
    }

    @Test
    fun emptyQueueUsesMinusOneIndex() {
        PlaybackQueue.set(emptyList(), 0)
        assertEquals(-1, PlaybackQueue.snapshot().index)
        assertNull(PlaybackQueue.current())
    }
}
