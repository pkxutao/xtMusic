package com.pkxutao.xtmusic.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** UI/state smoke tests use synthetic tracks, not a logged-in server or simulated audio output. */
@RunWith(AndroidJUnit4::class)
class GramophonePlaybackTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val sample = PlaybackSnapshot(
        track = Track("gramophone-ui-test", "夜色与旋律", listOf(ArtistRef("test-artist", "XT Music")),
            AlbumRef("test-album", "留声机 · 播放页"), durationSeconds = 245),
        playing = true, positionMs = 73_000, durationMs = 245_000)

    @Before fun seedPlayback() {
        instrumentation.runOnMainSync { PlaybackState.update(sample) }
    }

    @After fun clearPlayback() {
        instrumentation.runOnMainSync { PlaybackState.update(PlaybackSnapshot()) }
    }

    private fun record(activity: NowPlayingActivity): GramophoneView =
        activity.window.decorView.findViewWithTag("player_gramophone")

    private fun idle() {
        instrumentation.waitForIdleSync()
        SystemClock.sleep(150)
    }

    @Test fun rotatesPausesAndResumesWithoutResetting() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            idle()
            var before = 0f
            scenario.onActivity {
                assertTrue(record(it).isRecordAnimating)
                before = record(it).recordAngle
            }
            SystemClock.sleep(600)
            scenario.onActivity {
                assertTrue(record(it).recordAngle > before + 2f)
                PlaybackState.update(sample.copy(playing = false))
            }
            idle()
            scenario.onActivity {
                assertFalse(record(it).isRecordAnimating)
                before = record(it).recordAngle
            }
            SystemClock.sleep(400)
            scenario.onActivity {
                assertEquals(before, record(it).recordAngle, 0.01f)
                PlaybackState.update(sample)
            }
            SystemClock.sleep(400)
            scenario.onActivity { assertTrue(record(it).recordAngle > before) }
        }
    }

    @Test fun tapShowsLyricsAndBackReturnsWithoutChangingPlayback() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            idle()
            scenario.onActivity { activity ->
                seedArtwork(record(activity))
                assertTrue(record(activity).width > 0 && record(activity).height > 0)
                assertTrue(record(activity).artwork.width > 0)
            }
            idle()
            screenshot("record")
            scenario.onActivity { activity ->
                record(activity).performClick()
                assertFalse(record(activity).isRecordAnimating)
                assertEquals(View.VISIBLE, activity.window.decorView.findViewWithTag<View>("player_lyrics_page").visibility)
                assertEquals(sample, PlaybackState.snapshot)
                // Test-only fixture: exercise real lyric rendering/highlight without a server login.
                val lines = listOf(LyricLine(0, "让唱片慢慢转动"), LyricLine(30_000, "听旋律轻轻流淌"),
                    LyricLine(60_000, "此刻，只听见音乐"), LyricLine(90_000, "把夜色留在歌声里"),
                    LyricLine(120_000, "下一段旋律即将响起"))
                NowPlayingActivity::class.java.getDeclaredField("lyrics").apply { isAccessible = true }.set(activity, lines)
                NowPlayingActivity::class.java.getDeclaredMethod("renderLyrics").apply { isAccessible = true }.invoke(activity)
            }
            idle()
            screenshot("lyrics")
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            idle()
            scenario.onActivity {
                assertTrue(record(it).isShown)
                assertTrue(record(it).isRecordAnimating)
                assertEquals(sample, PlaybackState.snapshot)
            }
        }
    }

    @Test fun stopsWhenActivityIsBackgrounded() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            idle()
            lateinit var view: GramophoneView
            scenario.onActivity { view = record(it) }
            scenario.moveToState(Lifecycle.State.CREATED)
            idle()
            var angle = 0f
            instrumentation.runOnMainSync { assertFalse(view.isRecordAnimating); angle = view.recordAngle }
            SystemClock.sleep(400)
            instrumentation.runOnMainSync { assertEquals(angle, view.recordAngle, 0.01f) }
            scenario.moveToState(Lifecycle.State.RESUMED)
            idle()
            scenario.onActivity { assertTrue(record(it).isRecordAnimating) }
        }
    }

    @Test fun restoresLyricsPageAcrossRecreation() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            idle()
            scenario.onActivity { record(it).performClick() }
            scenario.recreate()
            idle()
            scenario.onActivity {
                assertEquals(View.VISIBLE, it.window.decorView.findViewWithTag<View>("player_lyrics_page").visibility)
                assertFalse(record(it).isRecordAnimating)
                it.window.decorView.findViewWithTag<View>("player_page_toggle").performClick()
                assertTrue(record(it).isShown)
            }
        }
    }

    @Test fun emptyPlaybackStopsAndClearsRecord() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            idle()
            scenario.onActivity {
                PlaybackState.update(PlaybackSnapshot())
                assertFalse(record(it).isRecordAnimating)
                assertEquals(0f, record(it).recordAngle, 0.01f)
                assertFalse(it.window.decorView.findViewWithTag<View>("player_play_pause").isEnabled)
                record(it).performClick()
                assertEquals(View.VISIBLE, it.window.decorView.findViewWithTag<View>("player_lyrics_page").visibility)
            }
        }
    }

    private fun seedArtwork(view: GramophoneView) {
        val bitmap = Bitmap.createBitmap(480, 480, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawColor(XtColors.surfaceRaised)
        paint.color = XtColors.primaryStrong
        canvas.drawCircle(140f, 105f, 210f, paint)
        paint.color = XtColors.primarySoft
        canvas.drawCircle(370f, 385f, 170f, paint)
        paint.color = Color.WHITE
        paint.textSize = 55f
        paint.isFakeBoldText = true
        paint.textAlign = Paint.Align.CENTER
        canvas.drawText("XT MUSIC", 240f, 254f, paint)
        view.artwork.setImageBitmap(bitmap)
    }

    private fun screenshot(name: String) {
        val context = instrumentation.targetContext
        val config = context.resources.configuration
        val directory = File(context.getExternalFilesDir(null), "gramophone-proof").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        checkNotNull(bitmap)
        File(directory, "$name-${config.screenWidthDp}x${config.screenHeightDp}.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }
}
