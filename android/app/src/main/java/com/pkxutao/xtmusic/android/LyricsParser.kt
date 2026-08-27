package com.pkxutao.xtmusic.android

data class LyricLine(
    val timeMs: Long,
    val text: String
)

object LyricsParser {
    private val timestamp = Regex("""\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?]""")
    private val offsetTag = Regex("""\[offset:([+-]?\d+)]""", RegexOption.IGNORE_CASE)

    fun parse(input: String): List<LyricLine> {
        val clean = input.removePrefix("\uFEFF")
        val offset = offsetTag.find(clean)?.groupValues?.getOrNull(1)?.toLongOrNull() ?: 0L
        val result = mutableListOf<LyricLine>()
        for (raw in clean.lineSequence()) {
            val matches = timestamp.findAll(raw).toList()
            if (matches.isEmpty()) continue
            val text = raw.substring(matches.last().range.last + 1)
                .replace(Regex("""<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>"""), "")
                .trim()
            for (match in matches) {
                val minute = match.groupValues[1].toLongOrNull() ?: continue
                val second = match.groupValues[2].toLongOrNull() ?: continue
                if (second >= 60) continue
                val fraction = match.groupValues[3]
                val millis = when (fraction.length) {
                    1 -> fraction.toLongOrNull()?.times(100) ?: 0
                    2 -> fraction.toLongOrNull()?.times(10) ?: 0
                    3 -> fraction.toLongOrNull() ?: 0
                    else -> 0
                }
                result += LyricLine(
                    timeMs = (minute * 60_000 + second * 1_000 + millis + offset).coerceAtLeast(0),
                    text = text.ifBlank { "♪" }
                )
            }
        }
        return result
            .sortedBy { it.timeMs }
            .distinctBy { it.timeMs to it.text }
    }

    fun activeIndex(lines: List<LyricLine>, positionMs: Long): Int {
        if (lines.isEmpty()) return -1
        var low = 0
        var high = lines.lastIndex
        var result = -1
        while (low <= high) {
            val middle = (low + high) ushr 1
            if (lines[middle].timeMs <= positionMs + 40) {
                result = middle
                low = middle + 1
            } else {
                high = middle - 1
            }
        }
        return result
    }
}
