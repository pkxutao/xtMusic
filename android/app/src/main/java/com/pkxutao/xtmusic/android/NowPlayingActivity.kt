package com.pkxutao.xtmusic.android

import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.content.res.Configuration
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
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import kotlin.concurrent.thread

class NowPlayingActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val artworkLoader by lazy { ArtworkLoader(this) }
    private var client: FnosClient? = null
    private lateinit var backgroundArtwork: ImageView
    private lateinit var turntable: TurntableView
    private lateinit var lyricsPanel: LinearLayout
    private lateinit var pageTitle: TextView
    private lateinit var modeButton: TextView
    private lateinit var pageHint: TextView
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
    private val transportButtons = mutableListOf<View>()
    private val pendingFavorites = mutableSetOf<String>()
    private var lyrics: List<LyricLine> = emptyList()
    private var lyricViews: List<TextView> = emptyList()
    private var loadedTrackGuid: String? = null
    private var artworkKey: Pair<String, String?>? = null
    private var renderedTrack: Track? = null
    private var lyricGeneration = 0L
    private var activeLyric = -1
    private var lyricsVisible = false
    private var dragging = false
    private var resumed = false
    private var followSuspendedUntil = 0L
    private var followWasSuspended = false
    private var lastToastError: String? = null
    private var backCallback: OnBackInvokedCallback? = null

    private val playbackListener: (PlaybackSnapshot) -> Unit = { snapshot ->
        runOnUiThread { if (resumed && !isDestroyed) render(snapshot) }
    }
    private val ticker = object : Runnable {
        override fun run() {
            if (!resumed) return
            val snapshot = PlaybackState.snapshot
            updatePosition(snapshot)
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
        turntable.restoreRotation(savedInstanceState?.getString("recordTrack"),
            savedInstanceState?.getFloat("recordAngle", 0f) ?: 0f)
        showLyrics(savedInstanceState?.getBoolean("lyricsVisible", false) ?: false)
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = OnBackInvokedCallback { navigateBack() }.also {
                onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, it)
            }
        }
        seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(seekBar: SeekBar?) { dragging = true }
            override fun onStopTrackingTouch(seekBar: SeekBar?) {
                val duration = PlaybackState.snapshot.durationMs
                if (duration > 0) {
                    val position = duration * (seekBar?.progress ?: 0) / 1000
                    PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_SEEK, position)
                    followSuspendedUntil = 0L
                    updateActiveLyric(position, force = true)
                }
                dragging = false
            }
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) currentTime.text = formatTime(PlaybackState.snapshot.durationMs.coerceAtLeast(0) * progress / 1000)
            }
        })
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        turntable.setHostResumed(true)
        PlaybackState.addListener(playbackListener)
        handler.removeCallbacks(ticker)
        handler.post(ticker)
    }

    override fun onPause() {
        resumed = false
        turntable.setHostResumed(false)
        PlaybackState.removeListener(playbackListener)
        handler.removeCallbacks(ticker)
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("lyricsVisible", lyricsVisible)
        outState.putString("recordTrack", PlaybackState.snapshot.track?.guid)
        outState.putFloat("recordAngle", turntable.discRotationDegrees)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        lyricGeneration++
        handler.removeCallbacksAndMessages(null)
        PlaybackState.removeListener(playbackListener)
        turntable.setHostResumed(false)
        backgroundArtwork.tag = null
        turntable.artwork.tag = null
        artworkLoader.close()
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        }
        super.onDestroy()
    }

    @Deprecated("The Android 13+ back dispatcher is registered in onCreate")
    override fun onBackPressed() { navigateBack() }

    private fun navigateBack() {
        if (lyricsVisible) showLyrics(false) else finish()
    }

    private fun showLyrics(show: Boolean) {
        lyricsVisible = show
        turntable.visibility = if (show) View.GONE else View.VISIBLE
        lyricsPanel.visibility = if (show) View.VISIBLE else View.GONE
        pageTitle.text = if (show) "歌词" else "正在播放"
        modeButton.text = if (show) "碟" else "词"
        modeButton.contentDescription = if (show) "返回唱片" else "查看歌词"
        pageHint.text = if (show) "点击歌词跳转 · 点“碟”返回唱片" else "点击唱片查看歌词"
        followSuspendedUntil = 0L
        if (show) lyricsScroll.post { updateActiveLyric(PlaybackState.snapshot.positionMs, force = true) }
    }

    private fun buildUi(): View {
        val root = FrameLayout(this).apply { setBackgroundColor(XtColors.background) }
        backgroundArtwork = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            if (Build.VERSION.SDK_INT >= 31) {
                setRenderEffect(RenderEffect.createBlurEffect(48f, 48f, Shader.TileMode.CLAMP))
            }
        }
        // Keep tint on the wrapper: artwork cross-fades must not remove the dark treatment.
        root.addView(FrameLayout(this).apply {
            alpha = 0.25f
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            addView(backgroundArtwork, matchMatch())
        }, matchMatch())
        root.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(
                colorWithAlpha(XtColors.background, 95), colorWithAlpha(XtColors.background, 225), XtColors.background))
        }, matchMatch())
        val screen = LinearLayout(this).apply {
            id = R.id.now_playing_screen
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(6), dp(18), dp(12))
            applySystemBarInsets()
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val close = actionButton("⌄", compact = true).apply {
            id = R.id.now_playing_close
            textSize = 25f
            contentDescription = "返回"
            setOnClickListener { navigateBack() }
        }
        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        pageTitle = TextView(this).apply {
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
        heading.addView(pageTitle)
        heading.addView(sourceAlbum)
        val more = actionButton("⋮", compact = true).apply {
            textSize = 25f
            contentDescription = "打开播放队列"
            setOnClickListener { showPlaybackQueue() }
        }
        top.addView(close, LinearLayout.LayoutParams(dp(48), dp(48)))
        top.addView(heading, LinearLayout.LayoutParams(0, dp(48), 1f))
        top.addView(more, LinearLayout.LayoutParams(dp(48), dp(48)))

        val stage = FrameLayout(this).apply { id = R.id.now_playing_content_stage }
        turntable = TurntableView(this).apply {
            id = R.id.now_playing_turntable
            setOnClickListener { showLyrics(true) }
        }
        stage.addView(turntable, matchMatch())
        lyricsPanel = LinearLayout(this).apply {
            id = R.id.now_playing_lyrics
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(6), dp(12), dp(6))
            background = roundedBackground(colorWithAlpha(XtColors.surfaceRaised, 200), dp(22).toFloat())
            visibility = View.GONE
        }
        lyricsContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        lyricsScroll = ScrollView(this).apply {
            id = R.id.now_playing_lyrics_scroll
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            isVerticalFadingEdgeEnabled = true
            setFadingEdgeLength(dp(28))
            addView(lyricsContainer, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            // Observe, do not consume, scrolling. Let the user read without fighting auto-follow.
            setOnTouchListener { _, event ->
                if (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_MOVE ||
                    event.actionMasked == MotionEvent.ACTION_UP) {
                    followSuspendedUntil = SystemClock.uptimeMillis() + 4_000L
                    followWasSuspended = true
                }
                false
            }
            addOnLayoutChangeListener { _, _, t, _, b, _, oldT, _, oldB ->
                if (b - t != oldB - oldT) {
                    val padding = ((b - t) / 2 - dp(24)).coerceAtLeast(dp(8))
                    lyricsContainer.setPadding(0, padding, 0, padding)
                    updateActiveLyric(PlaybackState.snapshot.positionMs, force = true)
                }
            }
        }
        lyricsPanel.addView(lyricsScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        stage.addView(lyricsPanel, matchMatch())

        val footer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val infoRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(8), dp(4), 0)
        }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        title = TextView(this).apply {
            id = R.id.now_playing_track_title
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
            id = R.id.now_playing_favorite
            textSize = 28f
            setTextColor(XtColors.pink)
            contentDescription = "收藏歌曲"
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
            gravity = Gravity.CENTER_VERTICAL
        }
        totalTime = TextView(this).apply {
            styleText(11f, XtColors.muted)
            text = "0:00"
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        seekBar = SeekBar(this).apply {
            id = R.id.now_playing_progress
            contentDescription = "播放进度"
            max = 1000
            progressTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(colorWithAlpha(Color.WHITE, 55))
            thumbTintList = android.content.res.ColorStateList.valueOf(XtColors.primarySoft)
        }
        timeRow.addView(currentTime, LinearLayout.LayoutParams(dp(46), dp(48)))
        timeRow.addView(seekBar, LinearLayout.LayoutParams(0, dp(48), 1f))
        timeRow.addView(totalTime, LinearLayout.LayoutParams(dp(46), dp(48)))

        val controls = LinearLayout(this).apply {
            id = R.id.now_playing_controls
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(6))
        }
        modeButton = actionButton("词", compact = true).apply {
            id = R.id.now_playing_lyrics_toggle
            styleText(17f, XtColors.primarySoft, true)
            contentDescription = "查看歌词"
            setOnClickListener { showLyrics(!lyricsVisible) }
        }
        val previous = actionButton("|◀", compact = true).apply {
            id = R.id.now_playing_previous
            textSize = 20f
            contentDescription = "上一首"
            setOnClickListener { PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_PREVIOUS) }
        }
        toggle = actionButton("▶", primary = true).apply {
            id = R.id.now_playing_play_pause
            textSize = 25f
            contentDescription = "播放"
            setOnClickListener { PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_TOGGLE) }
        }
        val next = actionButton("▶|", compact = true).apply {
            id = R.id.now_playing_next
            textSize = 20f
            contentDescription = "下一首"
            setOnClickListener { PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_NEXT) }
        }
        val queue = actionButton("≡", compact = true).apply {
            id = R.id.now_playing_queue
            textSize = 22f
            contentDescription = "打开播放队列"
            setOnClickListener { showPlaybackQueue() }
        }
        transportButtons.addAll(listOf(previous, toggle, next))
        controls.addView(modeButton, LinearLayout.LayoutParams(0, dp(48), 1f))
        controls.addView(previous, LinearLayout.LayoutParams(0, dp(52), 1f).apply { marginStart = dp(4) })
        controls.addView(toggle, LinearLayout.LayoutParams(dp(64), dp(64)).apply {
            marginStart = dp(8); marginEnd = dp(8)
        })
        controls.addView(next, LinearLayout.LayoutParams(0, dp(52), 1f).apply { marginEnd = dp(4) })
        controls.addView(queue, LinearLayout.LayoutParams(0, dp(48), 1f))
        pageHint = TextView(this).apply {
            text = "点击唱片查看歌词"
            styleText(11f, XtColors.muted)
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, dp(4))
        }
        footer.addView(infoRow, matchWrap())
        footer.addView(timeRow, matchWrap())
        footer.addView(controls, matchWrap())
        footer.addView(pageHint, matchWrap())

        val landscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val body = LinearLayout(this).apply {
            orientation = if (landscape) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        }
        if (landscape) {
            // Avoid a zero-height record on short screens; the controls remain scrollable.
            body.addView(stage, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
            body.addView(ScrollView(this).apply {
                isFillViewport = true
                isVerticalScrollBarEnabled = false
                setPadding(dp(12), 0, 0, 0)
                addView(footer, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        } else {
            body.addView(stage, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            body.addView(footer, matchWrap())
        }
        screen.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))
        screen.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(screen, matchMatch())
        return root
    }

    private fun render(snapshot: PlaybackSnapshot) {
        val track = snapshot.track
        turntable.bindTrack(track?.guid)
        turntable.setPlaybackActive(track != null && snapshot.playing && !snapshot.preparing && snapshot.error == null)
        transportButtons.forEach { it.isEnabled = track != null }
        seekBar.isEnabled = track != null && snapshot.durationMs > 0
        if (track == null) {
            sourceAlbum.text = "来自你的音乐库"
            title.text = "尚未播放歌曲"
            artist.text = "请返回音乐库选择歌曲"
            album.text = "未知专辑"
            album.isEnabled = false
            favorite.text = "♡"
            favorite.isEnabled = false
            toggle.text = "▶"
            toggle.contentDescription = "播放"
            if (loadedTrackGuid != null || lyricViews.isNotEmpty()) lyricGeneration++
            loadedTrackGuid = null
            renderedTrack = null
            artworkKey = null
            lyrics = emptyList()
            lyricViews = emptyList()
            activeLyric = -1
            backgroundArtwork.tag = null
            backgroundArtwork.setImageDrawable(null)
            backgroundArtwork.background = null
            turntable.artwork.tag = null
            turntable.artwork.setImageDrawable(null)
            lyricsContainer.removeAllViews()
            lyricsContainer.addView(emptyLyrics("暂无播放内容"))
            updatePosition(snapshot)
            return
        }
        if (renderedTrack != track) {
            renderedTrack = track
            sourceAlbum.text = "来自专辑：${track.albumText}"
            title.text = track.title
            artist.bindArtistLinks(track.artists, fallback = track.artistText, onArtistClick = ::openArtist)
            album.text = "${track.albumText}  ›"
            album.isEnabled = track.album != null
            favorite.text = if (track.favorite) "♥" else "♡"
            favorite.contentDescription = if (track.favorite) "取消收藏" else "收藏歌曲"
        }
        favorite.isEnabled = client != null && track.guid !in pendingFavorites
        toggle.text = if (snapshot.playing) "Ⅱ" else if (snapshot.preparing) "…" else "▶"
        toggle.contentDescription = if (snapshot.playing) "暂停" else "播放"
        val newArtworkKey = track.guid to track.artworkId
        if (artworkKey != newArtworkKey) {
            artworkKey = newArtworkKey
            artworkLoader.load(turntable.artwork, client, track.artworkId, dp(360), track.guid)
            artworkLoader.load(backgroundArtwork, client, track.artworkId, dp(600), "background:${track.guid}")
        }
        val error = snapshot.error
        if (!error.isNullOrBlank() && error != lastToastError) {
            lastToastError = error
            Toast.makeText(this, error, Toast.LENGTH_LONG).show()
        } else if (error == null) lastToastError = null
        updatePosition(snapshot)
        if (loadedTrackGuid != track.guid) {
            loadedTrackGuid = track.guid
            loadLyrics(track)
        }
    }

    private fun openArtist(artist: ArtistRef) {
        if (artist.guid.isBlank()) return
        startActivity(
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_ARTIST_GUID, artist.guid)
                .putExtra(MainActivity.EXTRA_OPEN_ARTIST_NAME, artist.name)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        )
    }

    private fun showPlaybackQueue() {
        val queueState = PlaybackQueue.snapshot()
        val dialog = Dialog(this)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = roundedBackground(XtColors.backgroundElevated, dp(24).toFloat())
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val heading = TextView(this).apply {
            text = "播放队列"
            styleText(20f, XtColors.text, true)
        }
        val count = TextView(this).apply {
            text = "${queueState.tracks.size} 首"
            styleText(12f, XtColors.muted)
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }
        val close = actionButton("×", compact = true).apply {
            textSize = 23f
            setOnClickListener { dialog.dismiss() }
        }
        header.addView(heading, LinearLayout.LayoutParams(0, dp(46), 1f))
        header.addView(count, LinearLayout.LayoutParams(dp(62), dp(46)))
        header.addView(close, LinearLayout.LayoutParams(dp(44), dp(42)))
        panel.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50)))

        if (queueState.tracks.isEmpty()) {
            panel.addView(emptyQueueView(), LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(220)
            ))
        } else {
            val rows = queueState.tracks.map { LibraryRow.TrackRow(it) }
            val adapter = LibraryAdapter(
                this,
                artworkLoader,
                { client },
                LibraryPresentation.TRACK_LIST,
                rows
            ) { selectedArtist ->
                dialog.dismiss()
                openArtist(selectedArtist)
            }
            val list = ListView(this).apply {
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
            }
            panel.addView(list, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            ))
        }

        dialog.setContentView(panel)
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setGravity(Gravity.BOTTOM)
            setLayout(
                ViewGroup.LayoutParams.MATCH_PARENT,
                (resources.displayMetrics.heightPixels * 0.72f).toInt()
            )
            decorView.setPadding(dp(10), 0, dp(10), dp(10))
        }
    }

    private fun emptyQueueView(): TextView = TextView(this).apply {
        text = "播放队列为空\n从歌曲列表选择一首歌曲开始播放"
        styleText(14f, XtColors.muted)
        gravity = Gravity.CENTER
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
        val track = PlaybackState.snapshot.track ?: return
        val activeClient = client ?: return
        if (!pendingFavorites.add(track.guid)) return
        favorite.isEnabled = false
        thread(name = "xtmusic-favorite") {
            val result = runCatching {
                if (track.favorite) activeClient.unfavorite(track.guid) else activeClient.favorite(track.guid)
            }
            runOnUiThread {
                pendingFavorites.remove(track.guid)
                if (isDestroyed || isFinishing) return@runOnUiThread
                val current = PlaybackState.snapshot
                // A late response for A must never replace B after the user skips tracks.
                if (result.isSuccess && current.track?.guid == track.guid) {
                    PlaybackState.update(current.copy(track = current.track.copy(favorite = !track.favorite)))
                }
                favorite.isEnabled = current.track != null && current.track.guid !in pendingFavorites
                if (result.isFailure) Toast.makeText(this, "收藏操作失败，请重试", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun loadLyrics(track: Track) {
        val generation = ++lyricGeneration
        lyrics = emptyList()
        lyricViews = emptyList()
        activeLyric = -1
        followSuspendedUntil = 0L
        lyricsContainer.removeAllViews()
        val activeClient = client
        if (activeClient == null) {
            lyricsContainer.addView(emptyLyrics("连接音乐库后查看歌词"))
            return
        }
        lyricsContainer.addView(emptyLyrics("正在加载歌词…"))
        thread(name = "xtmusic-lyrics") {
            val result = runCatching { LyricsParser.parse(activeClient.getLyrics(track.guid)) }
            runOnUiThread {
                if (isDestroyed || isFinishing || generation != lyricGeneration ||
                    PlaybackState.snapshot.track?.guid != track.guid) return@runOnUiThread
                result.onSuccess { parsed ->
                    lyrics = parsed
                    renderLyrics()
                }.onFailure {
                    lyricsContainer.removeAllViews()
                    lyricsContainer.addView(emptyLyrics("歌词加载失败，点击重试").apply {
                        isFocusable = true
                        setOnClickListener { loadLyrics(track) }
                    })
                }
            }
        }
    }

    private fun renderLyrics() {
        lyricsContainer.removeAllViews()
        if (lyrics.isEmpty()) {
            lyricViews = emptyList()
            lyricsContainer.addView(emptyLyrics("这首歌没有同步歌词"))
            return
        }
        lyricViews = lyrics.map { line ->
            TextView(this).apply {
                text = line.text
                styleText(16f, colorWithAlpha(XtColors.text, 110))
                gravity = Gravity.CENTER
                setPadding(dp(14), dp(12), dp(14), dp(12))
                isFocusable = true
                contentDescription = "${line.text}，跳转到 ${formatTime(line.timeMs)}"
                setOnClickListener {
                    PlaybackService.command(this@NowPlayingActivity, PlaybackService.ACTION_SEEK, line.timeMs)
                    followSuspendedUntil = 0L
                    updateActiveLyric(line.timeMs, force = true)
                }
                lyricsContainer.addView(this, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            }
        }
        lyricsScroll.post { updateActiveLyric(PlaybackState.snapshot.positionMs, force = true) }
    }

    private fun updatePosition(snapshot: PlaybackSnapshot) {
        val duration = snapshot.durationMs.coerceAtLeast(0)
        val position = snapshot.positionMs.coerceIn(0, duration)
        totalTime.text = formatTime(duration)
        if (!dragging) {
            currentTime.text = formatTime(position)
            seekBar.progress = if (duration > 0) ((position * 1000) / duration).toInt() else 0
        }
    }

    private fun updateActiveLyric(positionMs: Long, force: Boolean = false) {
        if (!lyricsVisible) return
        val index = LyricsParser.activeIndex(lyrics, positionMs)
        val follow = SystemClock.uptimeMillis() >= followSuspendedUntil
        val resumeFollow = follow && followWasSuspended
        if (!force && index == activeLyric && !resumeFollow) return
        activeLyric = index
        followWasSuspended = !follow
        lyricViews.forEachIndexed { current, view ->
            val active = current == index
            view.setTextColor(if (active) XtColors.primarySoft else colorWithAlpha(XtColors.text, 100))
            view.textSize = if (active) 18f else 16f
            view.setTypeface(view.typeface, if (active) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            view.background = if (active) roundedBackground(colorWithAlpha(XtColors.primaryStrong, 34), dp(13).toFloat()) else null
        }
        if ((follow || force) && index in lyricViews.indices) {
            val target = lyricViews[index]
            lyricsScroll.post {
                if (lyricsVisible && target.parent === lyricsContainer) {
                    lyricsScroll.smoothScrollTo(0,
                        (target.top - lyricsScroll.height / 2 + target.height / 2).coerceAtLeast(0))
                }
            }
        }
    }

    private fun emptyLyrics(message: String): TextView = TextView(this).apply {
        text = message
        styleText(14f, XtColors.muted)
        gravity = Gravity.CENTER
        setPadding(dp(8), dp(20), dp(8), dp(20))
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

// XT_ANDROID_ARTIST_TABS_QUEUE_20260901
