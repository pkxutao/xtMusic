package com.pkxutao.xtmusic.android

import org.junit.Assert.*
import org.junit.Test

class TurntableMotionTest {
    @Test fun slowRotationPeriodIsTwentyFourSeconds() { assertEquals(24_000L, TurntableMotion.REVOLUTION_MS) }

    @Test fun anglesWrapContinuouslyInBothDirections() {
        assertEquals(0f, TurntableMotion.normalize(360f), 0f)
        assertEquals(15f, TurntableMotion.normalize(735f), 0f)
        assertEquals(345f, TurntableMotion.normalize(-15f), 0f)
        assertEquals(0f, TurntableMotion.normalize(Float.NaN), 0f)
        assertEquals(0f, TurntableMotion.normalize(Float.POSITIVE_INFINITY), 0f)
    }

    @Test fun everyLifecycleConditionIsRequiredToAnimate() {
        for (mask in 0..31) {
            val flags = (0..4).map { mask and (1 shl it) != 0 }
            assertEquals("flags=$flags", mask == 31,
                TurntableMotion.shouldSpin(flags[0], flags[1], flags[2], flags[3], flags[4]))
        }
    }

    @Test fun diameterReservesSpaceForTonearmAndFitsBothAxes() {
        for (width in listOf(220, 280, 320, 360, 640, 1080)) {
            for (height in listOf(100, 160, 260, 480, 720)) {
                val diameter = TurntableMotion.diameter(width, height, 460)
                assertTrue(diameter > 0)
                assertTrue(diameter <= width * 0.92f)
                assertTrue(diameter * 1.18f <= height + 1)
                assertTrue(diameter <= 460)
            }
        }
    }

    @Test fun emptyOrInvalidBoundsNeverProduceNegativeSizes() {
        assertEquals(0, TurntableMotion.diameter(0, 400, 460))
        assertEquals(0, TurntableMotion.diameter(400, -10, 460))
        assertEquals(0, TurntableMotion.diameter(-1, 400, 460))
        assertEquals(0, TurntableMotion.diameter(400, 400, -2))
    }
}
