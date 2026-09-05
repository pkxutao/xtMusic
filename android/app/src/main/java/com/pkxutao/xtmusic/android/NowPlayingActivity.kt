package com.pkxutao.xtmusic.android

import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
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
    private lateinit var gramophone: GramophoneView
    private lateinit var recordPage: LinearLayout
    private lateinit var lyricsPage: LinearLayout
    private lateinit var pageToggle: TextView
    private lateinit var close: TextView
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
    private var artworkKey: String? = null
    private var restoredTrackGuid: String? = null
    private var lyricsVisible = false
    private var lyricsRequest = 0
    private var manualScrollUntil = 0L
    private var activeLyric = -1
    private var dragging = false
    private var favoriteBusy = false
    private var resumed = false
    private var lastToastError: String? = null
    private var backCallback: android.window.OnBackInvokedCallback? = null

    private val playbackListener: (PlaybackSnapshot) -> Unit = { snapshot ->
        runOnUiThread { if (resumed && !isDestroyed) render(snapshot) }
    }
    private val ticker = object : Runnable {
        override fun run() {
            if (!resumed) return
            val snapshot = PlaybackState.snapshot
            if (!dragging) updatePosition(snapshot)
            if (lyricsVisible) updateActiveLyric(snapshot.positionMs)
            handler.postDelayed(this, 250)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = XtColors.background
        window.navigationBarColor = XtColors.background
        client = SessionStore(this).load()?.let(::FnosClient)
        lyricsVisible = savedInstanceState?.getBoolean("lyrics_visible", false) ?: false
        restoredTrackGuid = savedInstanceState?.getString("record_track")
        setContentView(buildUi())
        if (restoredTrackGuid == PlaybackState.snapshot.track?.guid) {
            gramophone.restoreAngle(savedInstanceState?.getFloat("record_angle", 0f) ?: 0f)
        }
        showPage(lyricsVisible)
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = android.window.OnBackInvokedCallback { navigateBack() }.also {
                onBackInvokedDispatcher.registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, it)
            }
        }
        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(seekBar: SeekBar?) { dragging = true }
            override fun onStopTrackingTouch(seekBar: SeekBar?) {
                dragging = false
                val duration = PlaybackState.snapshot.durationMs
                if (duration > 0) {
                    val position = duration * (seekBar?.progress ?: 0) / 1000
                    PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_SEEK, position)
                }
            }
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) currentTime.text = formatTime(
                    PlaybackState.snapshot.durationMs.coerceAtLeast(0) * progress / 1000)
            }
        })
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        PlaybackState.addListener(playbackListener)
        gramophone.setForeground(true)
        handler.removeCallbacks(ticker)
        handler.post(ticker)
    }

    override fun onPause() {
        resumed = false
        gramophone.setForeground(false)
        PlaybackState.removeListener(playbackListener)
        handler.removeCallbacks(ticker)
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("lyrics_visible", lyricsVisible)
        outState.putString("record_track", loadedTrackGuid)
        outState.putFloat("record_angle", gramophone.recordAngle)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        lyricsRequest++
        handler.removeCallbacksAndMessages(null)
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        }
        super.onDestroy()
    }

    @Deprecated("Legacy back dispatch for Android 8–12")
    override fun onBackPressed() { navigateBack() }

    private fun navigateBack() {
        if (lyricsVisible) showPage(false) else finish()
    }

    private fun buildUi(): View {
        val root = FrameLayout(this).apply { setBackgroundColor(XtColors.background) }
        backgroundArtwork = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            if (Build.VERSION.SDK_INT >= 31) {
                setRenderEffect(RenderEffect.createBlurEffect(48f, 48f, Shader.TileMode.CLAMP))
            }
        }
        // Keep the theme's background opacity independent of artwork-loader fade animations.
        root.addView(FrameLayout(this).apply {
            alpha = 0.25f
            addView(backgroundArtwork, matchMatch())
        }, matchMatch())
        root.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(colorWithAlpha(XtColors.background, 95),
                    colorWithAlpha(XtColors.background, 225), XtColors.background))
        }, matchMatch())

        val screen = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            minimumHeight = dp(570)
            setPadding(dp(18), dp(6), dp(18), dp(12))
            applySystemBarInsets()
        }
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        close = actionButton("⌄", compact = true).apply {
            textSize = 25f
            setOnClickListener { navigateBack() }
        }
        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        heading.addView(TextView(this).apply {
            text = "正在播放"
            styleText(15f, XtColors.text, true)
            gravity = Gravity.CENTER
        })
        sourceAlbum = TextView(this).apply {
            text = "来自你的音乐库"
            styleText(11f, XtColors.muted)
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(6), dp(3), dp(6), 0)
        }
        heading.addView(sourceAlbum)
        pageToggle = actionButton("歌词", compact = true).apply {
            tag = "player_page_toggle"
            setOnClickListener { showPage(!lyricsVisible) }
        }
        top.addView(close, LinearLayout.LayoutParams(dp(48), dp(48)))
        top.addView(heading, LinearLayout.LayoutParams(0, dp(50), 1f))
        top.addView(pageToggle, LinearLayout.LayoutParams(dp(52), dp(48)))

        val mediaStage = FrameLayout(this)
        recordPage = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        gramophone = GramophoneView(this).apply {
            tag = "player_gramophone"
            setOnClickListener { showPage(true) }
        }
        recordPage.addView(gramophone, LinearLayout.LayoutParams(-1, 0, 1f))
        recordPage.addView(TextView(this).apply {
            text = "点击唱片 · 查看歌词"
            styleText(12f, XtColors.muted)
            gravity = Gravity.CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(-1, dp(28)))
        lyricsPage = LinearLayout(this).apply {
            tag = "player_lyrics_page"
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(8), dp(14), dp(8))
            background = roundedBackground(colorWithAlpha(XtColors.surfaceRaised, 235), dp(22).toFloat())
        }
        val lyricsHeading = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        lyricsHeading.addView(TextView(this).apply {
            text = "歌词"
            styleText(16f, XtColors.text, true)
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        lyricsHeading.addView(actionButton("返回唱片 ›", compact = true).apply {
            setTextColor(XtColors.primarySoft)
            contentDescription = "返回唱片页面"
            setOnClickListener { showPage(false) }
        }, LinearLayout.LayoutParams(dp(104), dp(48)))
        lyricsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(55), 0, dp(90))
        }
        lyricsScroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(lyricsContainer, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            setOnTouchListener { view, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                        manualScrollUntil = SystemClock.uptimeMillis() + 4_000L
                        view.parent.requestDisallowInterceptTouchEvent(true)
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        manualScrollUntil = SystemClock.uptimeMillis() + 4_000L
                        view.parent.requestDisallowInterceptTouchEvent(false)
                    }
                }
                false
            }
        }
        lyricsPage.addView(lyricsHeading, matchWrap())
        lyricsPage.addView(lyricsScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        mediaStage.addView(recordPage, matchMatch())
        mediaStage.addView(lyricsPage, matchMatch())

        val infoRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(4), dp(4), 0)
        }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
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
            setOnClickListener { openAlbum() }
        }
        copy.addView(title)
        copy.addView(artist)
        copy.addView(album)
        favorite = actionButton("♡", compact = true).apply {
            textSize = 28f
            setTextColor(XtColors.pink)
            contentDescription = "收藏歌曲"
            setOnClickListener { toggleFavorite() }
        }
        infoRow.addView(copy, LinearLayout.LayoutParams(0, -2, 1f))
        infoRow.addView(favorite, LinearLayout.LayoutParams(dp(52), dp(48)))

        val timeRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        currentTime = TextView(this).apply {
            styleText(11f, XtColors.muted)
            gravity = Gravity.CENTER_VERTICAL
            text = "0:00"
        }
        totalTime = TextView(this).apply {
            styleText(11f, XtColors.muted)
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            text = "0:00"
        }
        seekBar = SeekBar(this).apply {
            max = 1000
            contentDescription = "播放进度"
            progressTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(colorWithAlpha(Color.WHITE, 55))
            thumbTintList = android.content.res.ColorStateList.valueOf(XtColors.primarySoft)
        }
        timeRow.addView(currentTime, LinearLayout.LayoutParams(dp(46), dp(48)))
        timeRow.addView(seekBar, LinearLayout.LayoutParams(0, dp(48), 1f))
        timeRow.addView(totalTime, LinearLayout.LayoutParams(dp(46), dp(48)))

        val controls = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(2), 0, dp(10))
        }
        val previous = actionButton("|◀", compact = true).apply {
            textSize = 20f
            contentDescription = "上一首"
            setOnClickListener { PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_PREVIOUS) }
        }
        toggle = actionButton("▶", primary = true).apply {
            tag = "player_play_pause"
            textSize = 25f
            setOnClickListener { PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_TOGGLE) }
        }
        val next = actionButton("▶|", compact = true).apply {
            textSize = 20f
            contentDescription = "下一首"
            setOnClickListener { PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_NEXT) }
        }
        val queue = actionButton("≡", compact = true).apply {
            textSize = 22f
            setTextColor(XtColors.muted)
            contentDescription = "打开播放队列"
            setOnClickListener { showPlaybackQueue() }
        }
        val lyricButton = actionButton("词", compact = true).apply {
            setTextColor(XtColors.primarySoft)
            contentDescription = "切换唱片和歌词"
            setOnClickListener { showPage(!lyricsVisible) }
        }
        // Flexible widths retain the existing controls without clipping on narrow phones.
        listOf(lyricButton, previous, toggle, next, queue).forEach { control ->
            controls.addView(control, LinearLayout.LayoutParams(0, dp(if (control === toggle) 60 else 48),
                if (control === toggle) 1.25f else 1f).apply {
                marginStart = dp(3)
                marginEnd = dp(3)
            })
        }
        screen.addView(top, LinearLayout.LayoutParams(-1, dp(52)))
        screen.addView(mediaStage, LinearLayout.LayoutParams(-1, 0, 1f).apply {
            topMargin = dp(8)
            bottomMargin = dp(12)
        })
        screen.addView(infoRow, matchWrap())
        screen.addView(timeRow, matchWrap())
        screen.addView(controls, matchWrap())
        // Bound the weighted page to the viewport. A normal ScrollView first measures its child
        // with UNSPECIFIED height, letting the media stage grow and push controls off-screen.
        // Keep the 570dp minimum page scrollable for short windows and enlarged fonts.
        root.addView(object : ScrollView(this) {
            override fun measureChildWithMargins(child: View, parentWidthMeasureSpec: Int,
                widthUsed: Int, parentHeightMeasureSpec: Int, heightUsed: Int) {
                val margins = child.layoutParams as ViewGroup.MarginLayoutParams
                val widthSpec = ViewGroup.getChildMeasureSpec(parentWidthMeasureSpec,
                    paddingLeft + paddingRight + margins.leftMargin + margins.rightMargin + widthUsed,
                    margins.width)
                val availableHeight = View.MeasureSpec.getSize(parentHeightMeasureSpec) -
                    paddingTop - paddingBottom - margins.topMargin - margins.bottomMargin - heightUsed
                val heightSpec = View.MeasureSpec.makeMeasureSpec(
                    maxOf(child.minimumHeight, availableHeight, 0), View.MeasureSpec.EXACTLY)
                child.measure(widthSpec, heightSpec)
            }
        }.apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(screen, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }, matchMatch())
        return root
    }

    private fun showPage(showLyrics: Boolean) {
        lyricsVisible = showLyrics
        recordPage.visibility = if (showLyrics) View.GONE else View.VISIBLE
        lyricsPage.visibility = if (showLyrics) View.VISIBLE else View.GONE
        pageToggle.text = if (showLyrics) "唱片" else "歌词"
        pageToggle.contentDescription = if (showLyrics) "返回唱片页面" else "查看歌词页面"
        close.contentDescription = if (showLyrics) "返回唱片页面" else "收起播放页面"
        if (showLyrics) {
            manualScrollUntil = 0L
            lyricsScroll.post { if (!isDestroyed && lyricsVisible) updateActiveLyric(PlaybackState.snapshot.positionMs, true) }
        }
    }

    private fun render(snapshot: PlaybackSnapshot) {
        val track = snapshot.track
        gramophone.setPlaying(track != null && snapshot.playing && !snapshot.preparing)
        toggle.isEnabled = track != null
        seekBar.isEnabled = track != null && snapshot.durationMs > 0
        favorite.isEnabled = track != null && client != null && !favoriteBusy
        if (track == null) {
            sourceAlbum.text = "来自你的音乐库"
            title.text = "尚未播放歌曲"
            artist.bindArtistLinks(emptyList(), fallback = "请返回音乐库选择歌曲")
            album.text = "未知专辑"
            album.isEnabled = false
            favorite.text = "♡"
            toggle.text = "▶"
            toggle.contentDescription = "播放"
            loadedTrackGuid = null
            artworkKey = null
            restoredTrackGuid = null
            lyricsRequest++
            gramophone.restoreAngle(0f)
            artworkLoader.load(gramophone.artwork, null, null, dp(600), "xtmusic")
            artworkLoader.load(backgroundArtwork, null, null, dp(800), "xtmusic")
            showLyricsMessage("暂无播放内容")
            updatePosition(snapshot)
            return
        }
        sourceAlbum.text = "来自专辑：${track.albumText}"
        title.text = track.title
        artist.bindArtistLinks(track.artists, fallback = track.artistText, onArtistClick = ::openArtist)
        album.text = "${track.albumText}  ›"
        album.isEnabled = track.album != null
        favorite.text = if (track.favorite) "♥" else "♡"
        favorite.contentDescription = if (track.favorite) "取消收藏" else "收藏歌曲"
        toggle.text = if (snapshot.playing) "Ⅱ" else if (snapshot.preparing) "…" else "▶"
        toggle.contentDescription = if (snapshot.playing) "暂停" else "播放"
        val key = "${track.guid}|${track.artworkId}"
        if (artworkKey != key) {
            artworkKey = key
            artworkLoader.load(gramophone.artwork, client, track.artworkId, dp(600), track.guid)
            artworkLoader.load(backgroundArtwork, client, track.artworkId, dp(900), "background:${track.guid}")
        }
        val error = snapshot.error
        if (!error.isNullOrBlank() && error != lastToastError) {
            lastToastError = error
            Toast.makeText(this, error, Toast.LENGTH_LONG).show()
        }
        if (!dragging) updatePosition(snapshot)
        if (loadedTrackGuid != track.guid) {
            if (restoredTrackGuid != track.guid) gramophone.restoreAngle(0f)
            restoredTrackGuid = null
            loadedTrackGuid = track.guid
            manualScrollUntil = 0L
            lastToastError = null
            loadLyrics(track)
        }
    }

    private fun openArtist(artist: ArtistRef) {
        if (artist.guid.isBlank()) return
        startActivity(Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_OPEN_ARTIST_GUID, artist.guid)
            .putExtra(MainActivity.EXTRA_OPEN_ARTIST_NAME, artist.name)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }

    private fun openAlbum() {
        val albumRef = PlaybackState.snapshot.track?.album ?: return
        startActivity(Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_OPEN_ALBUM_GUID, albumRef.guid)
            .putExtra(MainActivity.EXTRA_OPEN_ALBUM_NAME, albumRef.name)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }

    private fun showPlaybackQueue() {
        val queueState = PlaybackQueue.snapshot()
        val dialog = Dialog(this)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = roundedBackground(XtColors.backgroundElevated, dp(24).toFloat())
        }
        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        header.addView(TextView(this).apply {
            text = "播放队列"
            styleText(20f, XtColors.text, true)
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        header.addView(TextView(this).apply {
            text = "${queueState.tracks.size} 首"
            styleText(12f, XtColors.muted)
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }, LinearLayout.LayoutParams(dp(62), dp(48)))
        header.addView(actionButton("×", compact = true).apply {
            textSize = 23f
            contentDescription = "关闭播放队列"
            setOnClickListener { dialog.dismiss() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        panel.addView(header, matchWrap())
        if (queueState.tracks.isEmpty()) {
            panel.addView(TextView(this).apply {
                text = "播放队列为空\n从歌曲列表选择一首歌曲开始播放"
                styleText(14f, XtColors.muted)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(-1, dp(220)))
        } else {
            val rows = queueState.tracks.map { LibraryRow.TrackRow(it) }
            val adapter = LibraryAdapter(this, artworkLoader, { client }, LibraryPresentation.TRACK_LIST, rows) {
                selectedArtist -> dialog.dismiss(); openArtist(selectedArtist)
            }
            panel.addView(ListView(this).apply {
                divider = ColorDrawable(XtColors.divider)
                dividerHeight = dp(1)
                clipToPadding = false
                setPadding(0, dp(4), 0, dp(8))
                this.adapter = adapter
                onItemClickListener = android.widget.AdapterView.OnItemClickListener { _, _, position, _ ->
                    PlaybackService.playIndex(this@NowPlayingActivity, position)
                    dialog.dismiss()
                }
                if (queueState.index >= 0) setSelection(queueState.index)
            }, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        dialog.setContentView(panel)
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setGravity(Gravity.BOTTOM)
            setLayout(-1, (resources.displayMetrics.heightPixels * 0.72f).toInt())
            decorView.setPadding(dp(10), 0, dp(10), dp(10))
        }
    }

    private fun toggleFavorite() {
        val track = PlaybackState.snapshot.track ?: return
        val activeClient = client ?: return
        if (favoriteBusy) return
        favoriteBusy = true
        favorite.isEnabled = false
        thread(name = "xtmusic-favorite") {
            val result = runCatching {
                if (track.favorite) activeClient.unfavorite(track.guid) else activeClient.favorite(track.guid)
            }
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                favoriteBusy = false
                favorite.isEnabled = PlaybackState.snapshot.track != null
                result.onSuccess {
                    // A late response for the previous song must never replace the current song.
                    val current = PlaybackState.snapshot
                    if (current.track?.guid == track.guid) {
                        PlaybackState.update(current.copy(track = current.track.copy(favorite = !track.favorite)))
                    }
                }.onFailure {
                    Toast.makeText(this, it.message ?: "收藏操作失败", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun loadLyrics(track: Track) {
        val request = ++lyricsRequest
        showLyricsMessage("正在加载歌词…")
        val activeClient = client
        if (activeClient == null) {
            showLyricsMessage("登录音乐库后查看歌词")
            return
        }
        thread(name = "xtmusic-lyrics") {
            val result = runCatching { LyricsParser.parse(activeClient.getLyrics(track.guid)) }
            runOnUiThread {
                // Check both success and failure, including A → B → A and activity recreation.
                if (isDestroyed || isFinishing || request != lyricsRequest ||
                    PlaybackState.snapshot.track?.guid != track.guid) return@runOnUiThread
                result.onSuccess {
                    lyrics = it
                    renderLyrics()
                }.onFailure { showLyricsMessage(it.message ?: "歌词加载失败") }
            }
        }
    }

    private fun showLyricsMessage(message: String) {
        lyrics = emptyList()
        lyricViews = emptyList()
        activeLyric = -1
        lyricsContainer.removeAllViews()
        lyricsContainer.addView(TextView(this).apply {
            text = message
            styleText(14f, XtColors.muted)
            gravity = Gravity.CENTER
            setPadding(0, dp(55), 0, dp(55))
        }, matchWrap())
    }

    private fun renderLyrics() {
        lyricsContainer.removeAllViews()
        if (lyrics.isEmpty()) {
            showLyricsMessage("这首歌没有同步歌词")
            return
        }
        activeLyric = -1
        lyricViews = lyrics.map { line ->
            TextView(this).apply {
                text = line.text
                styleText(16f, colorWithAlpha(XtColors.text, 110))
                gravity = Gravity.CENTER
                setPadding(dp(14), dp(14), dp(14), dp(14))
                minHeight = dp(48)
                setOnClickListener {
                    manualScrollUntil = 0L
                    PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_SEEK, line.timeMs)
                    updateActiveLyric(line.timeMs, true)
                }
                lyricsContainer.addView(this, matchWrap())
            }
        }
        if (lyricsVisible) updateActiveLyric(PlaybackState.snapshot.positionMs, true)
    }

    private fun updatePosition(snapshot: PlaybackSnapshot) {
        val duration = snapshot.durationMs.coerceAtLeast(0)
        val position = snapshot.positionMs.coerceIn(0, duration)
        currentTime.text = formatTime(position)
        totalTime.text = formatTime(duration)
        if (!dragging) seekBar.progress = if (duration > 0) ((position * 1000) / duration).toInt() else 0
    }

    private fun updateActiveLyric(positionMs: Long, force: Boolean = false) {
        if (!lyricsVisible) return
        val index = LyricsParser.activeIndex(lyrics, positionMs)
        if (!force && index == activeLyric) return
        activeLyric = index
        lyricViews.forEachIndexed { current, view ->
            val active = current == index
            view.setTextColor(if (active) XtColors.primarySoft else colorWithAlpha(XtColors.text, 100))
            view.textSize = if (active) 18f else 16f
            view.setTypeface(view.typeface, if (active) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            view.background = if (active) roundedBackground(colorWithAlpha(XtColors.primaryStrong, 34), dp(13).toFloat()) else null
        }
        if (index in lyricViews.indices && SystemClock.uptimeMillis() >= manualScrollUntil) {
            val target = lyricViews[index]
            lyricsScroll.post {
                if (!isDestroyed && lyricsVisible && target.parent === lyricsContainer &&
                    activeLyric == index && SystemClock.uptimeMillis() >= manualScrollUntil) {
                    lyricsScroll.smoothScrollTo(0,
                        (target.top - lyricsScroll.height / 2 + target.height / 2).coerceAtLeast(0))
                }
            }
        }
    }

    private fun actionButton(label: String, primary: Boolean = false, compact: Boolean = false): TextView =
        TextView(this).apply {
            text = label
            styleText(if (compact) 13f else 15f, Color.WHITE, true)
            gravity = Gravity.CENTER
            background = if (primary) gradientBackground(XtColors.primaryStrong, XtColors.primary,
                dp(if (compact) 13 else 30).toFloat(), GradientDrawable.Orientation.TL_BR)
            else roundedBackground(colorWithAlpha(XtColors.surfaceRaised, 220), dp(if (compact) 14 else 18).toFloat())
            isClickable = true
            isFocusable = true
        }

    private fun matchWrap() = LinearLayout.LayoutParams(-1, -2)
    private fun matchMatch() = FrameLayout.LayoutParams(-1, -1)
    private fun formatTime(milliseconds: Long): String {
        val seconds = milliseconds.coerceAtLeast(0) / 1000
        return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    }
}
