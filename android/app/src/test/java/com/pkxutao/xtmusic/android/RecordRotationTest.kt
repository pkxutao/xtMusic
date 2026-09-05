package com.pkxutao.xtmusic.android

import org.junit.Assert.assertEquals
import org.junit.Test

class RecordRotationTest {
    @Test fun oneRevolutionTakes24Seconds() {
        val motion = RecordRotation()
        motion.advance(0)
        assertEquals(90f, motion.advance(6_000_000_000), 0.001f)
        assertEquals(180f, motion.advance(12_000_000_000), 0.001f)
        assertEquals(0f, motion.advance(24_000_000_000), 0.001f)
    }
    @Test fun pausePreservesAngleAndDoesNotCatchUpBackgroundTime() {
        val motion = RecordRotation()
        motion.advance(0)
        motion.advance(6_000_000_000)
        motion.pause()
        assertEquals(90f, motion.advance(900_000_000_000), 0.001f)
        assertEquals(105f, motion.advance(901_000_000_000), 0.001f)
    }
    @Test fun restoreSurvivesActivityRecreation() {
        val motion = RecordRotation()
        motion.restore(217f)
        assertEquals(217f, motion.advance(9_000_000_000), 0.001f)
        assertEquals(232f, motion.advance(10_000_000_000), 0.001f)
    }
    @Test fun normalizesAngles() {
        val motion = RecordRotation()
        motion.restore(-30f)
        assertEquals(330f, motion.angle, 0.001f)
        motion.restore(725f)
        assertEquals(5f, motion.angle, 0.001f)
    }
    @Test fun invalidSavedValueIsSafe() {
        val motion = RecordRotation()
        motion.restore(Float.NaN)
        assertEquals(0f, motion.angle, 0.001f)
        motion.restore(Float.POSITIVE_INFINITY)
        assertEquals(0f, motion.angle, 0.001f)
    }
    @Test fun nonMonotonicFrameDoesNotReverseRecord() {
        val motion = RecordRotation()
        motion.advance(1_000_000_000)
        motion.advance(2_000_000_000)
        assertEquals(15f, motion.advance(1_500_000_000), 0.001f)
        assertEquals(30f, motion.advance(3_000_000_000), 0.001f)
    }
    @Test(expected = IllegalArgumentException::class) fun rejectsInvalidPeriod() {
        RecordRotation(0)
    }
}
