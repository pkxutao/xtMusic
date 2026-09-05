package com.pkxutao.xtmusic.android

/** Frame-time based motion; pausing never resets the visible angle or catches up hidden time. */
internal class RecordRotation(private val revolutionMillis: Long = 24_000L) {
    init { require(revolutionMillis > 0) }

    private var degrees = 0.0
    private var previousFrame: Long? = null
    val angle: Float get() = degrees.toFloat()

    fun advance(frameTimeNanos: Long): Float {
        val previous = previousFrame
        if (previous != null && frameTimeNanos < previous) return angle
        previousFrame = frameTimeNanos
        if (previous != null) {
            degrees = (degrees + (frameTimeNanos - previous).toDouble() /
                (revolutionMillis * 1_000_000.0) * 360.0) % 360.0
        }
        return angle
    }

    fun pause() { previousFrame = null }

    fun restore(angle: Float) {
        degrees = if (angle.isFinite()) ((angle.toDouble() % 360.0) + 360.0) % 360.0 else 0.0
        pause()
    }
}
