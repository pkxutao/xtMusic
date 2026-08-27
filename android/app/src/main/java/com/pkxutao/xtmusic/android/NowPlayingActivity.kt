package com.pkxutao.xtmusic.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

class NowPlayingActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var title: TextView
    private lateinit var artist: TextView
    private lateinit var album: Button
    private lateinit var currentTime: TextView
    private lateinit var totalTime: TextView
    private lateinit var seekBar: SeekBar
    private lateinit var toggle: Button
    private lateinit var lyricsScroll: ScrollView
    private lateinit var lyricsContainer: LinearLayout
    private var lyrics: List<LyricLine> = emptyList()
    private var lyricViews: List<TextView> = emptyList()
    private var loadedTrackGuid: String? = null
    private var activeLyric = -1
    private var dragging = false

    private val playbackListener: (PlaybackSnapshot) -> Unit = { snapshot ->
        runOnUiThread { render(snapshot) }
    }

    private val ticker = object : Runnable {
        override fun run() {
            val snapshot = PlaybackState.snapshot
            if (!dragging) updatePosition(snapshot)
            updateActiveLyric(snapshot.positionMs)
            handler.postDelayed(this, 250)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = XtColors.background
        window.navigationBarColor = XtColors.background
        setContentView(buildUi())
        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(seekBar: SeekBar?) {
                dragging = true
            }

            override fun onStopTrackingTouch(seekBar: SeekBar?) {
                dragging = false
                val duration = PlaybackState.snapshot.durationMs
                val position = if (duration > 0) {
                    duration * (seekBar?.progress ?: 0) / 1000
                } else {
                    0
                }
                PlaybackService.command(
                    this@NowPlayingActivity,
                    PlaybackService.ACTION_SEEK,
                    position
                )
            }

            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) = Unit
        })
    }

    override fun onResume() {
        super.onResume()
        PlaybackState.addListener(playbackListener)
        handler.post(ticker)
    }

    override fun onPause() {
        PlaybackState.removeListener(playbackListener)
        handler.removeCallbacks(ticker)
        super.onPause()
    }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(10), dp(18), dp(14))
            setBackgroundColor(XtColors.background)
        }

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val back = button("‹").apply { setOnClickListener { finish() } }
        val label = TextView(this).apply {
            text = "正在播放"
            styleText(17f, XtColors.text, true)
            gravity = Gravity.CENTER
        }
        top.addView(back, LinearLayout.LayoutParams(dp(48), dp(44)))
        top.addView(label, LinearLayout.LayoutParams(0, dp(44), 1f))
        top.addView(View(this), LinearLayout.LayoutParams(dp(48), dp(44)))

        val cover = TextView(this).apply {
            text = "♫"
            styleText(88f, XtColors.primary, true)
            gravity = Gravity.CENTER
            background = roundedBackground(XtColors.surfaceRaised, dp(28).toFloat())
        }
        title = TextView(this).apply {
            styleText(26f, XtColors.text, true)
            gravity = Gravity.CENTER
            maxLines = 2
            setPadding(0, dp(18), 0, dp(4))
        }
        artist = TextView(this).apply {
            styleText(15f, XtColors.muted)
            gravity = Gravity.CENTER
        }
        album = button("未知专辑").apply {
            setOnClickListener {
                val track = PlaybackState.snapshot.track ?: return@setOnClickListener
                val albumRef = track.album ?: return@setOnClickListener
                startActivity(
                    Intent(this@NowPlayingActivity, MainActivity::class.java)
                        .putExtra(MainActivity.EXTRA_OPEN_ALBUM_GUID, albumRef.guid)
                        .putExtra(MainActivity.EXTRA_OPEN_ALBUM_NAME, albumRef.name)
                        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                )
            }
        }

        val timeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(12), 0, 0)
        }
        currentTime = TextView(this).apply {
            styleText(12f, XtColors.muted)
            text = "0:00"
        }
        totalTime = TextView(this).apply {
            styleText(12f, XtColors.muted)
            text = "0:00"
            gravity = Gravity.END
        }
        seekBar = SeekBar(this).apply {
            max = 1000
            progressTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
            thumbTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
        }
        timeRow.addView(currentTime, LinearLayout.LayoutParams(dp(48), dp(34)))
        timeRow.addView(seekBar, LinearLayout.LayoutParams(0, dp(34), 1f))
        timeRow.addView(totalTime, LinearLayout.LayoutParams(dp(48), dp(34)))

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, dp(12))
        }
        val previous = button("◀").apply {
            setOnClickListener {
                PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_PREVIOUS)
            }
        }
        toggle = button("▶", primary = true).apply {
            setOnClickListener {
                PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_TOGGLE)
            }
        }
        val next = button("▶|").apply {
            setOnClickListener {
                PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_NEXT)
            }
        }
        controls.addView(previous, LinearLayout.LayoutParams(dp(62), dp(52)).apply { marginEnd = dp(18) })
        controls.addView(toggle, LinearLayout.LayoutParams(dp(70), dp(58)))
        controls.addView(next, LinearLayout.LayoutParams(dp(62), dp(52)).apply { marginStart = dp(18) })

        val lyricsTitle = TextView(this).apply {
            text = "同步歌词"
            styleText(18f, XtColors.text, true)
            setPadding(0, dp(6), 0, dp(8))
        }
        lyricsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(100), 0, dp(140))
        }
        lyricsScroll = ScrollView(this).apply {
            isFillViewport = true
            addView(
                lyricsContainer,
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        root.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        root.addView(cover, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(220)).apply {
            topMargin = dp(8)
        })
        root.addView(title, matchWrap())
        root.addView(artist, matchWrap())
        root.addView(album, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)).apply {
            topMargin = dp(6)
        })
        root.addView(timeRow, matchWrap())
        root.addView(controls, matchWrap())
        root.addView(lyricsTitle, matchWrap())
        root.addView(lyricsScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        return root
    }

    private fun render(snapshot: PlaybackSnapshot) {
        val track = snapshot.track
        if (track == null) {
            title.text = "尚未播放歌曲"
            artist.text = "请返回音乐库选择歌曲"
            album.text = "未知专辑"
            album.isEnabled = false
            toggle.text = "▶"
            lyricsContainer.removeAllViews()
            lyricsContainer.addView(emptyLyrics("暂无播放内容"))
            return
        }
        title.text = track.title
        artist.text = track.artistText
        album.text = track.albumText
        album.isEnabled = track.album != null
        toggle.text = if (snapshot.playing) "Ⅱ" else "▶"
        snapshot.error?.let {
            Toast.makeText(this, it, Toast.LENGTH_LONG).show()
        }
        updatePosition(snapshot)
        if (loadedTrackGuid != track.guid) {
            loadedTrackGuid = track.guid
            loadLyrics(track)
        }
    }

    private fun loadLyrics(track: Track) {
        lyrics = emptyList()
        activeLyric = -1
        lyricsContainer.removeAllViews()
        lyricsContainer.addView(emptyLyrics("正在加载歌词…"))
        val session = SessionStore(this).load() ?: return
        thread(name = "xtmusic-lyrics") {
            try {
                val parsed = LyricsParser.parse(FnosClient(session).getLyrics(track.guid))
                runOnUiThread {
                    if (PlaybackState.snapshot.track?.guid != track.guid) return@runOnUiThread
                    lyrics = parsed
                    renderLyrics()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    lyricsContainer.removeAllViews()
                    lyricsContainer.addView(emptyLyrics(error.message ?: "歌词加载失败"))
                }
            }
        }
    }

    private fun renderLyrics() {
        lyricsContainer.removeAllViews()
        if (lyrics.isEmpty()) {
            lyricsContainer.addView(emptyLyrics("这首歌没有同步歌词"))
            lyricViews = emptyList()
            return
        }
        lyricViews = lyrics.mapIndexed { index, line ->
            TextView(this).apply {
                text = line.text
                styleText(17f, XtColors.muted, false)
                gravity = Gravity.CENTER
                setPadding(dp(14), dp(14), dp(14), dp(14))
                setOnClickListener {
                    PlaybackService.command(
                        this@NowPlayingActivity,
                        PlaybackService.ACTION_SEEK,
                        line.timeMs
                    )
                    updateActiveLyric(line.timeMs)
                }
                lyricsContainer.addView(
                    this,
                    LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    )
                )
            }
        }
        updateActiveLyric(PlaybackState.snapshot.positionMs, force = true)
    }

    private fun updatePosition(snapshot: PlaybackSnapshot) {
        val duration = snapshot.durationMs.coerceAtLeast(0)
        val position = snapshot.positionMs.coerceIn(0, duration.coerceAtLeast(0))
        currentTime.text = formatTime(position)
        totalTime.text = formatTime(duration)
        if (!dragging) {
            seekBar.progress = if (duration > 0) ((position * 1000) / duration).toInt() else 0
        }
    }

    private fun updateActiveLyric(positionMs: Long, force: Boolean = false) {
        val index = LyricsParser.activeIndex(lyrics, positionMs)
        if (!force && index == activeLyric) return
        activeLyric = index
        lyricViews.forEachIndexed { current, view ->
            val active = current == index
            view.setTextColor(if (active) XtColors.primary else XtColors.muted)
            view.textSize = if (active) 19f else 17f
            view.background = if (active) {
                roundedBackground(XtColors.surfaceRaised, dp(12).toFloat())
            } else {
                null
            }
        }
        if (index in lyricViews.indices) {
            val target = lyricViews[index]
            lyricsScroll.post {
                lyricsScroll.smoothScrollTo(
                    0,
                    (target.top - lyricsScroll.height / 2 + target.height / 2).coerceAtLeast(0)
                )
            }
        }
    }

    private fun emptyLyrics(message: String): TextView {
        return TextView(this).apply {
            text = message
            styleText(15f, XtColors.muted)
            gravity = Gravity.CENTER
            setPadding(0, dp(70), 0, dp(70))
        }
    }

    private fun button(label: String, primary: Boolean = false): Button {
        return Button(this).apply {
            text = label
            isAllCaps = false
            textSize = 15f
            setTextColor(if (primary) XtColors.background else XtColors.text)
            background = roundedBackground(
                if (primary) XtColors.primary else XtColors.surfaceRaised,
                dp(12).toFloat()
            )
            minHeight = 0
            minWidth = 0
        }
    }

    private fun matchWrap(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        )

    private fun formatTime(milliseconds: Long): String {
        val seconds = milliseconds.coerceAtLeast(0) / 1000
        return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    }
}
