package com.pkxutao.xtmusic.android

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.widget.SeekBar
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.abs

/** UI tests use local fixture state only; never connect to a user's music server. */
@RunWith(AndroidJUnit4::class)
class NowPlayingTurntableTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val track = Track("turntable-fixture-a", "夜航 · Nightfall", listOf(ArtistRef("fixture-artist", "XT Music")),
        AlbumRef("fixture-album", "留声机时光"), durationSeconds = 240)

    @Before fun setUp() {
        check(SessionStore(instrumentation.targetContext).load() == null) { "Run only on a fresh emulator without a music account" }
        instrumentation.runOnMainSync {
            PlaybackState.update(PlaybackSnapshot(track, playing = true, positionMs = 90_000, durationMs = 240_000))
            PlaybackQueue.set(listOf(track, track.copy(guid = "turntable-fixture-b", title = "下一段旋律")), 0)
        }
    }

    @After fun tearDown() {
        instrumentation.runOnMainSync { PlaybackState.update(PlaybackSnapshot()); PlaybackQueue.clear() }
    }

    @Test fun recordRotatesSlowlyPausesAndResumesWithoutReset() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            var start = 0f
            scenario.onActivity { start = record(it).discRotationDegrees }
            SystemClock.sleep(800)
            var pausedAngle = 0f
            scenario.onActivity {
                val disc = record(it)
                assertTrue("record should animate during playback", disc.isDiscSpinning)
                val delta = TurntableMotion.normalize(disc.discRotationDegrees - start)
                assertTrue("24-second rotation should advance slowly: $delta", delta in 2f..65f)
                PlaybackState.update(PlaybackState.snapshot.copy(playing = false))
                assertFalse(disc.isDiscSpinning)
                pausedAngle = disc.discRotationDegrees
            }
            SystemClock.sleep(400)
            scenario.onActivity {
                assertEquals(pausedAngle, record(it).discRotationDegrees, 0.01f)
                PlaybackState.update(PlaybackState.snapshot.copy(playing = true))
                assertEquals("resume must retain the angle", pausedAngle, record(it).discRotationDegrees, 1f)
            }
            SystemClock.sleep(400)
            scenario.onActivity {
                assertTrue(TurntableMotion.normalize(record(it).discRotationDegrees - pausedAngle) > 1f)
                PlaybackState.update(PlaybackState.snapshot.copy(playing = false, preparing = true))
                assertFalse("buffering must not spin", record(it).isDiscSpinning)
            }
        }
    }

    @Test fun tappingRecordOpensFullLyricsAndKeepsTransportControls() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                record(activity).performClick()
                assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.now_playing_lyrics).visibility)
                assertEquals(View.GONE, record(activity).visibility)
                assertFalse(record(activity).isDiscSpinning)
                assertEquals(375, activity.findViewById<SeekBar>(R.id.now_playing_progress).progress)
                assertTrue(activity.findViewById<View>(R.id.now_playing_play_pause).isShown)
                assertTrue(activity.findViewById<View>(R.id.now_playing_queue).hasOnClickListeners())
                activity.findViewById<View>(R.id.now_playing_lyrics_toggle).performClick()
                assertEquals(View.VISIBLE, record(activity).visibility)
                assertTrue(record(activity).isDiscSpinning)
                assertEquals(90_000L, PlaybackState.snapshot.positionMs)
            }
        }
    }

    @Test fun systemBackReturnsFromLyricsBeforeLeavingPlayer() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            scenario.onActivity { record(it).performClick() }
            SystemClock.sleep(350)
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            instrumentation.waitForIdleSync()
            scenario.onActivity {
                assertFalse(it.isFinishing)
                assertEquals(View.VISIBLE, record(it).visibility)
            }
        }
    }

    @Test fun backgroundStopsAnimationAndForegroundResumes() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            lateinit var disc: TurntableView
            scenario.onActivity { disc = record(it) }
            SystemClock.sleep(350)
            scenario.moveToState(Lifecycle.State.CREATED)
            var pausedAngle = 0f
            instrumentation.runOnMainSync { assertFalse(disc.isDiscSpinning); pausedAngle = disc.discRotationDegrees }
            SystemClock.sleep(350)
            instrumentation.runOnMainSync { assertEquals(pausedAngle, disc.discRotationDegrees, 0.01f) }
            scenario.moveToState(Lifecycle.State.RESUMED)
            scenario.onActivity { assertTrue(record(it).isDiscSpinning) }
        }
    }

    @Test fun recreationRestoresLyricsModeAndPausedAngle() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            SystemClock.sleep(500)
            var angle = 0f
            scenario.onActivity {
                PlaybackState.update(PlaybackState.snapshot.copy(playing = false))
                angle = record(it).discRotationDegrees
                record(it).performClick()
            }
            scenario.recreate()
            scenario.onActivity {
                assertEquals(View.VISIBLE, it.findViewById<View>(R.id.now_playing_lyrics).visibility)
                assertEquals(angle, record(it).discRotationDegrees, 0.01f)
                it.findViewById<View>(R.id.now_playing_lyrics_toggle).performClick()
                assertFalse(record(it).isDiscSpinning)
                assertEquals(angle, record(it).discRotationDegrees, 0.01f)
            }
        }
    }

    @Test fun clearingPlaybackRemovesOldArtworkAndDisablesTransport() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            scenario.onActivity {
                record(it).artwork.setImageBitmap(fixtureArtwork())
                PlaybackState.update(PlaybackSnapshot())
                assertNull(record(it).artwork.drawable)
                assertFalse(record(it).isDiscSpinning)
                assertFalse(it.findViewById<View>(R.id.now_playing_play_pause).isEnabled)
                assertEquals("尚未播放歌曲", it.findViewById<TextView>(R.id.now_playing_track_title).text.toString())
                PlaybackState.update(PlaybackSnapshot(track.copy(guid = "new-track", title = "新歌曲")))
                assertEquals("新歌曲", it.findViewById<TextView>(R.id.now_playing_track_title).text.toString())
                assertEquals(0f, record(it).discRotationDegrees, 0.01f)
                record(it).performClick() // missing lyrics/session is a real, usable empty state
                assertTrue(it.findViewById<View>(R.id.now_playing_lyrics).isShown)
            }
        }
    }

    @Test fun queueStillShowsCurrentTracks() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            scenario.onActivity { it.findViewById<View>(R.id.now_playing_queue).performClick() }
            SystemClock.sleep(500)
            val root = instrumentation.uiAutomation.rootInActiveWindow
            assertNotNull(root)
            assertTrue(root.findAccessibilityNodeInfosByText("播放队列").isNotEmpty())
            assertTrue(root.findAccessibilityNodeInfosByText("下一段旋律").isNotEmpty())
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        }
    }

    @Test fun recordFitsCompactAndLandscapeStages() {
        instrumentation.runOnMainSync {
            for ((width, height) in listOf(280 to 150, 360 to 480, 220 to 180, 760 to 280)) {
                val view = TurntableView(instrumentation.targetContext)
                view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
                view.layout(0, 0, width, height)
                // Re-measure after the geometry updates the platter's LayoutParams.
                view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY))
                view.layout(0, 0, width, height)
                val disc = view.getChildAt(0)
                assertTrue(disc.width > 0 && disc.height > 0)
                assertTrue(disc.left >= 0 && disc.right <= width)
                assertTrue(disc.top >= 0 && disc.bottom <= height)
            }
        }
    }

    @Test fun capturePlayerAndLyricsWithLocalArtwork() {
        ActivityScenario.launch(NowPlayingActivity::class.java).use { scenario ->
            scenario.onActivity {
                record(it).artwork.setImageBitmap(fixtureArtwork())
                assertVisibleBounds(it.findViewById(R.id.now_playing_controls))
                assertVisibleBounds(it.findViewById(R.id.now_playing_progress))
            }
            SystemClock.sleep(600)
            screenshot("01-record-playing")
            scenario.onActivity { activity ->
                PlaybackState.update(PlaybackState.snapshot.copy(playing = false))
                record(activity).performClick()
                seedLyrics(activity)
            }
            SystemClock.sleep(600)
            screenshot("02-synchronized-lyrics")
            scenario.onActivity { it.findViewById<View>(R.id.now_playing_lyrics_toggle).performClick() }
            SystemClock.sleep(400)
            screenshot("03-record-paused")
        }
    }

    private fun record(activity: NowPlayingActivity): TurntableView = activity.findViewById(R.id.now_playing_turntable)

    private fun assertVisibleBounds(view: View) {
        val rect = Rect()
        assertTrue(view.getGlobalVisibleRect(rect))
        assertEquals("control row must not be clipped vertically", view.height, rect.height())
        assertEquals("control row must not be clipped horizontally", view.width, rect.width())
    }

    private fun screenshot(name: String) {
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        assertNotNull(bitmap)
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "turntable-screenshots")
        directory.mkdirs()
        File(directory, "api${Build.VERSION.SDK_INT}-$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    private fun fixtureArtwork(): Bitmap {
        val bitmap = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = LinearGradient(0f, 0f, 640f, 640f,
            intArrayOf(Color.rgb(44, 31, 78), Color.rgb(116, 76, 150), Color.rgb(225, 150, 169)), null, Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, 640f, 640f, paint)
        paint.shader = null
        paint.color = 0x28FFFFFF
        for (index in 0..6) canvas.drawCircle(480f, 125f, 28f + index * 22f, paint.apply { style = Paint.Style.STROKE; strokeWidth = 1.5f })
        paint.style = Paint.Style.FILL
        paint.color = 0xFFF8F8FC.toInt()
        paint.textAlign = Paint.Align.CENTER
        paint.textSize = 80f
        canvas.drawText("NIGHTFALL", 320f, 305f, paint)
        paint.textSize = 22f
        canvas.drawText("X T   M U S I C", 320f, 355f, paint)
        return bitmap
    }

    private fun seedLyrics(activity: NowPlayingActivity) {
        // Test-only fixture injection: no exported intent, debug screen or production backdoor.
        val lines = (0..9).map { index -> LyricLine(index * 30_000L,
            listOf("夜色落在窗边", "让旋律慢慢转动", "把今天留在唱片里", "此刻只听见音乐", "下一段旅程，继续播放")[index % 5]) }
        NowPlayingActivity::class.java.getDeclaredField("lyrics").apply { isAccessible = true }.set(activity, lines)
        NowPlayingActivity::class.java.getDeclaredMethod("renderLyrics").apply { isAccessible = true }.invoke(activity)
    }
}
