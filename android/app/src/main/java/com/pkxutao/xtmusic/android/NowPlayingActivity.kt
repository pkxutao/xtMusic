package com.pkxutao.xtmusic.android

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

class NowPlayingActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val artworkLoader by lazy { ArtworkLoader(this) }
    private var client: FnosClient? = null

    private lateinit var backgroundArtwork: ImageView
    private lateinit var coverArtwork: ImageView
    private lateinit var sourceAlbum: TextView
    private lateinit var title: TextView
    private lateinit var artist: TextView
    private lateinit var album: TextView
    private lateinit var favorite: TextView
    private lateinit var currentTime: TextView
    private lateinit var totalTime: TextView
    private lateinit var seekBar: SeekBar
    private lateinit var toggle: TextView
    private lateinit var lyricsScroll: ScrollView
    private lateinit var lyricsContainer: LinearLayout
    private var lyrics: List<LyricLine> = emptyList()
    private var lyricViews: List<TextView> = emptyList()
    private var loadedTrackGuid: String? = null
    private var activeLyric = -1
    private var dragging = false
    private var lastToastError: String? = null

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
        client = SessionStore(this).load()?.let(::FnosClient)
        setContentView(buildUi())
        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(seekBar: SeekBar?) {
                dragging = true
            }

            override fun onStopTrackingTouch(seekBar: SeekBar?) {
                dragging = false
                val duration = PlaybackState.snapshot.durationMs
                val position = if (duration > 0) duration * (seekBar?.progress ?: 0) / 1000 else 0
                PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_SEEK, position)
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
        val root = FrameLayout(this).apply { setBackgroundColor(XtColors.background) }
        backgroundArtwork = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = 0.25f
            if (Build.VERSION.SDK_INT >= 31) {
                setRenderEffect(RenderEffect.createBlurEffect(48f, 48f, Shader.TileMode.CLAMP))
            }
        }
        val backgroundShade = View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(
                    colorWithAlpha(XtColors.background, 95),
                    colorWithAlpha(XtColors.background, 225),
                    XtColors.background
                )
            )
        }
        root.addView(backgroundArtwork, matchMatch())
        root.addView(backgroundShade, matchMatch())

        val screen = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(6), dp(18), dp(12))
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val close = actionButton("⌄", compact = true).apply {
            textSize = 25f
            setOnClickListener { finish() }
        }
        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        val label = TextView(this).apply {
            text = "正在播放"
            styleText(15f, XtColors.text, true)
            gravity = Gravity.CENTER
        }
        sourceAlbum = TextView(this).apply {
            text = "来自你的音乐库"
            styleText(11f, XtColors.muted)
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(6), dp(3), dp(6), 0)
        }
        heading.addView(label)
        heading.addView(sourceAlbum)
        val more = actionButton("⋮", compact = true).apply { textSize = 25f }
        top.addView(close, LinearLayout.LayoutParams(dp(46), dp(44)))
        top.addView(heading, LinearLayout.LayoutParams(0, dp(48), 1f))
        top.addView(more, LinearLayout.LayoutParams(dp(46), dp(44)))

        val coverStage = FrameLayout(this).apply {
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        val coverShadow = View(this).apply {
            background = roundedBackground(colorWithAlpha(Color.BLACK, 100), dp(30).toFloat())
            elevation = dp(18).toFloat()
        }
        coverArtwork = ImageView(this).apply {
            background = gradientBackground(
                colorWithAlpha(XtColors.primaryStrong, 160),
                XtColors.surfaceRaised,
                dp(28).toFloat()
            )
            roundedOutline(dp(28).toFloat())
            elevation = dp(16).toFloat()
        }
        coverStage.addView(coverShadow, FrameLayout.LayoutParams(dp(286), dp(286), Gravity.CENTER).apply {
            topMargin = dp(10)
        })
        coverStage.addView(coverArtwork, FrameLayout.LayoutParams(dp(280), dp(280), Gravity.CENTER))

        val infoRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(4), dp(4), 0)
        }
        val copy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
        }
        title = TextView(this).apply {
            styleText(22f, XtColors.text, true)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        artist = TextView(this).apply {
            styleText(14f, XtColors.textSecondary)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(5), 0, 0)
        }
        album = TextView(this).apply {
            styleText(13f, XtColors.primarySoft, true)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(7), 0, dp(2))
            isClickable = true
            setOnClickListener { openAlbum() }
        }
        copy.addView(title)
        copy.addView(artist)
        copy.addView(album)
        favorite = actionButton("♡", compact = true).apply {
            textSize = 28f
            setTextColor(XtColors.pink)
            setOnClickListener { toggleFavorite() }
        }
        infoRow.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        infoRow.addView(favorite, LinearLayout.LayoutParams(dp(52), dp(48)))

        val timeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        currentTime = TextView(this).apply {
            styleText(11f, XtColors.muted)
            text = "0:00"
        }
        totalTime = TextView(this).apply {
            styleText(11f, XtColors.muted)
            text = "0:00"
            gravity = Gravity.END
        }
        seekBar = SeekBar(this).apply {
            max = 1000
            progressTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(colorWithAlpha(Color.WHITE, 55))
            thumbTintList = android.content.res.ColorStateList.valueOf(XtColors.primarySoft)
        }
        timeRow.addView(currentTime, LinearLayout.LayoutParams(dp(46), dp(38)))
        timeRow.addView(seekBar, LinearLayout.LayoutParams(0, dp(38), 1f))
        timeRow.addView(totalTime, LinearLayout.LayoutParams(dp(46), dp(38)))

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(1), 0, dp(10))
        }
        val shuffle = actionButton("⌘", compact = true).apply {
            textSize = 20f
            setTextColor(XtColors.muted)
        }
        val previous = actionButton("|◀", compact = true).apply {
            textSize = 20f
            setOnClickListener {
                PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_PREVIOUS)
            }
        }
        toggle = actionButton("▶", primary = true).apply {
            textSize = 25f
            setOnClickListener {
                PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_TOGGLE)
            }
        }
        val next = actionButton("▶|", compact = true).apply {
            textSize = 20f
            setOnClickListener {
                PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_NEXT)
            }
        }
        val queue = actionButton("≡", compact = true).apply {
            textSize = 22f
            setTextColor(XtColors.muted)
        }
        controls.addView(shuffle, LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginEnd = dp(6) })
        controls.addView(previous, LinearLayout.LayoutParams(dp(58), dp(52)).apply { marginEnd = dp(12) })
        controls.addView(toggle, LinearLayout.LayoutParams(dp(68), dp(60)))
        controls.addView(next, LinearLayout.LayoutParams(dp(58), dp(52)).apply { marginStart = dp(12) })
        controls.addView(queue, LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginStart = dp(6) })

        val lyricsCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(8))
            background = roundedBackground(colorWithAlpha(XtColors.surfaceRaised, 235), dp(22).toFloat())
        }
        val lyricsHeading = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val lyricsTitle = TextView(this).apply {
            text = "歌词"
            styleText(16f, XtColors.text, true)
        }
        val hint = TextView(this).apply {
            text = "点击歌词可跳转"
            styleText(11f, XtColors.muted)
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        lyricsHeading.addView(lyricsTitle, LinearLayout.LayoutParams(0, dp(34), 1f))
        lyricsHeading.addView(hint, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)))
        lyricsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(55), 0, dp(90))
        }
        lyricsScroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(lyricsContainer, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        lyricsCard.addView(lyricsHeading, matchWrap())
        lyricsCard.addView(lyricsScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        screen.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        screen.addView(coverStage, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(306)))
        screen.addView(infoRow, matchWrap())
        screen.addView(timeRow, matchWrap())
        screen.addView(controls, matchWrap())
        screen.addView(lyricsCard, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(screen, matchMatch())
        return root
    }

    private fun render(snapshot: PlaybackSnapshot) {
        val track = snapshot.track
        if (track == null) {
            sourceAlbum.text = "来自你的音乐库"
            title.text = "尚未播放歌曲"
            artist.text = "请返回音乐库选择歌曲"
            album.text = "未知专辑"
            album.isEnabled = false
            favorite.text = "♡"
            toggle.text = "▶"
            lyricsContainer.removeAllViews()
            lyricsContainer.addView(emptyLyrics("暂无播放内容"))
            return
        }
        sourceAlbum.text = "来自专辑：${track.albumText}"
        title.text = track.title
        artist.text = track.artistText
        album.text = "${track.albumText}  ›"
        album.isEnabled = track.album != null
        favorite.text = if (track.favorite) "♥" else "♡"
        toggle.text = if (snapshot.playing) "Ⅱ" else if (snapshot.preparing) "…" else "▶"
        artworkLoader.load(coverArtwork, client, track.artworkId, dp(900), track.guid)
        artworkLoader.load(backgroundArtwork, client, track.artworkId, dp(1200), "background:${track.guid}")

        val error = snapshot.error
        if (!error.isNullOrBlank() && error != lastToastError) {
            lastToastError = error
            Toast.makeText(this, error, Toast.LENGTH_LONG).show()
        }
        updatePosition(snapshot)
        if (loadedTrackGuid != track.guid) {
            loadedTrackGuid = track.guid
            loadLyrics(track)
        }
    }

    private fun openAlbum() {
        val track = PlaybackState.snapshot.track ?: return
        val albumRef = track.album ?: return
        startActivity(
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_ALBUM_GUID, albumRef.guid)
                .putExtra(MainActivity.EXTRA_OPEN_ALBUM_NAME, albumRef.name)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        )
    }

    private fun toggleFavorite() {
        val snapshot = PlaybackState.snapshot
        val track = snapshot.track ?: return
        val activeClient = client ?: return
        favorite.isEnabled = false
        thread(name = "xtmusic-favorite") {
            runCatching {
                if (track.favorite) activeClient.unfavorite(track.guid) else activeClient.favorite(track.guid)
            }.onSuccess {
                runOnUiThread {
                    val updated = track.copy(favorite = !track.favorite)
                    PlaybackState.update(PlaybackState.snapshot.copy(track = updated))
                    favorite.isEnabled = true
                }
            }.onFailure { error ->
                runOnUiThread {
                    favorite.isEnabled = true
                    Toast.makeText(this, error.message ?: "收藏操作失败", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun loadLyrics(track: Track) {
        lyrics = emptyList()
        activeLyric = -1
        lyricsContainer.removeAllViews()
        lyricsContainer.addView(emptyLyrics("正在加载歌词…"))
        val activeClient = client ?: return
        thread(name = "xtmusic-lyrics") {
            try {
                val parsed = LyricsParser.parse(activeClient.getLyrics(track.guid))
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
        lyricViews = lyrics.map { line ->
            TextView(this).apply {
                text = line.text
                styleText(16f, colorWithAlpha(XtColors.text, 110), false)
                gravity = Gravity.CENTER
                setPadding(dp(14), dp(12), dp(14), dp(12))
                setOnClickListener {
                    PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_SEEK, line.timeMs)
                    updateActiveLyric(line.timeMs)
                }
                lyricsContainer.addView(this, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ))
            }
        }
        updateActiveLyric(PlaybackState.snapshot.positionMs, force = true)
    }

    private fun updatePosition(snapshot: PlaybackSnapshot) {
        val duration = snapshot.durationMs.coerceAtLeast(0)
        val position = snapshot.positionMs.coerceIn(0, duration.coerceAtLeast(0))
        currentTime.text = formatTime(position)
        totalTime.text = formatTime(duration)
        if (!dragging) seekBar.progress = if (duration > 0) ((position * 1000) / duration).toInt() else 0
    }

    private fun updateActiveLyric(positionMs: Long, force: Boolean = false) {
        val index = LyricsParser.activeIndex(lyrics, positionMs)
        if (!force && index == activeLyric) return
        activeLyric = index
        lyricViews.forEachIndexed { current, view ->
            val active = current == index
            view.setTextColor(if (active) XtColors.primarySoft else colorWithAlpha(XtColors.text, 100))
            view.textSize = if (active) 18f else 16f
            view.setTypeface(view.typeface, if (active) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            view.background = if (active) {
                roundedBackground(colorWithAlpha(XtColors.primaryStrong, 34), dp(13).toFloat())
            } else null
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

    private fun emptyLyrics(message: String): TextView = TextView(this).apply {
        text = message
        styleText(14f, XtColors.muted)
        gravity = Gravity.CENTER
        setPadding(0, dp(55), 0, dp(55))
    }

    private fun actionButton(label: String, primary: Boolean = false, compact: Boolean = false): TextView {
        return TextView(this).apply {
            text = label
            styleText(if (compact) 13f else 15f, Color.WHITE, true)
            gravity = Gravity.CENTER
            background = if (primary) {
                gradientBackground(
                    XtColors.primaryStrong,
                    XtColors.primary,
                    dp(if (compact) 13 else 30).toFloat(),
                    GradientDrawable.Orientation.TL_BR
                )
            } else {
                roundedBackground(colorWithAlpha(XtColors.surfaceRaised, 220), dp(if (compact) 14 else 18).toFloat())
            }
            isClickable = true
            isFocusable = true
        }
    }

    private fun matchWrap(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    )

    private fun matchMatch(): FrameLayout.LayoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
    )

    private fun formatTime(milliseconds: Long): String {
        val seconds = milliseconds.coerceAtLeast(0) / 1000
        return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    }
}
