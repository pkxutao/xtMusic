package com.pkxutao.xtmusic.android

import org.junit.Assert.assertEquals
import org.junit.Test

class LyricsParserTest {
    @Test
    fun parsesMultipleTimestampsAndOffset() {
        val lines = LyricsParser.parse(
            """
            [offset:+100]
            [00:01.00][00:03.500]第一句
            [00:05.2]第二句
            """.trimIndent()
        )
        assertEquals(3, lines.size)
        assertEquals(1100L, lines[0].timeMs)
        assertEquals(3600L, lines[1].timeMs)
        assertEquals(5300L, lines[2].timeMs)
    }

    @Test
    fun selectsOnlyCurrentWholeLine() {
        val lines = listOf(
            LyricLine(1000, "第一句"),
            LyricLine(3000, "第二句"),
            LyricLine(5000, "第三句")
        )
        assertEquals(1, LyricsParser.activeIndex(lines, 3500))
    }
}
