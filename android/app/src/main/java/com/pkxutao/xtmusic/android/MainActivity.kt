package com.pkxutao.xtmusic.android

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridView
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread
import kotlin.math.ceil

class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private val store by lazy { SessionStore(this) }
    private val artworkLoader by lazy { ArtworkLoader(this) }
    private var client: FnosClient? = null

    private lateinit var contentHost: FrameLayout
    private lateinit var headerBack: TextView
    private lateinit var headerTitle: TextView
    private lateinit var miniPlayer: LinearLayout
    private lateinit var miniArtwork: ImageView
    private lateinit var miniTitle: TextView
    private lateinit var miniSubtitle: TextView
    private lateinit var miniToggle: TextView
    private val navigationItems = linkedMapOf<Destination, LinearLayout>()

    private var currentDestination = Destination.HOME
    private var currentMode = Mode.TRACKS
    private var currentPage = 1
    private var currentTotal = 0
    private var currentRows: List<LibraryRow> = emptyList()
    private var requestGeneration = 0
    private var headerBackAction: (() -> Unit)? = null

    private val playbackListener: (PlaybackSnapshot) -> Unit = { snapshot ->
        runOnUiThread { renderMiniPlayer(snapshot) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = XtColors.background
        window.navigationBarColor = XtColors.background
        root = FrameLayout(this).apply {
            setBackgroundColor(XtColors.background)
            applySystemBarInsets()
        }
        setContentView(root)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 402)
        }

        val session = store.load()
        if (session == null) {
            showLogin()
        } else {
            client = FnosClient(session)
            showAppShell()
            showHome()
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        PlaybackState.addListener(playbackListener)
    }

    override fun onPause() {
        PlaybackState.removeListener(playbackListener)
        super.onPause()
    }

    override fun onBackPressed() {
        val action = headerBackAction
        if (action != null) action() else super.onBackPressed()
    }

    private fun handleIntent(intent: Intent?) {
        val albumGuid = intent?.getStringExtra(EXTRA_OPEN_ALBUM_GUID).orEmpty()
        if (albumGuid.isBlank() || client == null || !::contentHost.isInitialized) return
        val albumName = intent?.getStringExtra(EXTRA_OPEN_ALBUM_NAME).orEmpty().ifBlank { "专辑详情" }
        intent?.removeExtra(EXTRA_OPEN_ALBUM_GUID)
        showAlbumDetail(Album(albumGuid, albumName)) { showHome() }
    }

    private fun showLogin(message: String? = null) {
        requestGeneration += 1
        root.removeAllViews()
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            setBackgroundColor(XtColors.background)
        }
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(26), dp(44), dp(26), dp(44))
        }

        val glow = FrameLayout(this).apply {
            background = gradientBackground(
                colorWithAlpha(XtColors.primaryStrong, 230),
                colorWithAlpha(XtColors.pink, 190),
                dp(34).toFloat()
            )
            roundedOutline(dp(34).toFloat())
        }
        val logo = TextView(this).apply {
            text = "XT"
            styleText(38f, Color.WHITE, true)
            gravity = Gravity.CENTER
        }
        glow.addView(logo, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))

        val title = TextView(this).apply {
            text = "XT Music"
            styleText(30f, XtColors.text, true)
            gravity = Gravity.CENTER
            setPadding(0, dp(22), 0, dp(5))
        }
        val subtitle = TextView(this).apply {
            text = "连接你的飞牛音乐库"
            styleText(14f, XtColors.muted)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(26))
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(18))
            background = roundedBackground(
                XtColors.surface,
                dp(24).toFloat(),
                XtColors.divider,
                dp(1)
            )
        }
        val server = field("服务器地址或 FN ID", InputType.TYPE_CLASS_TEXT).apply {
            setText("https://pkxutao.fnos.net")
        }
        val username = field("飞牛音乐账号", InputType.TYPE_CLASS_TEXT)
        val password = field(
            "飞牛音乐账号密码",
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        )
        val accessCode = field(
            "访问安全码（未启用可留空）",
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        )
        val allowHttp = CheckBox(this).apply {
            text = "允许 HTTP 直连（仅可信局域网）"
            styleText(13f, XtColors.muted)
            buttonTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
        }
        val allowSelfSigned = CheckBox(this).apply {
            text = "信任当前服务器的自签名证书"
            styleText(13f, XtColors.muted)
            buttonTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
        }
        val status = TextView(this).apply {
            styleText(13f, if (message == null) XtColors.muted else XtColors.danger)
            text = message ?: "密码不会写入磁盘；会话使用 Android Keystore 加密保存。"
            setPadding(dp(2), dp(12), dp(2), dp(12))
        }
        val login = actionButton("登录", primary = true).apply {
            gravity = Gravity.CENTER
            setOnClickListener {
                val rawUsername = username.text.toString().trim()
                val rawPassword = password.text.toString()
                if (rawUsername.isBlank() || rawPassword.isBlank()) {
                    status.setTextColor(XtColors.danger)
                    status.text = "请输入飞牛音乐账号和密码"
                    return@setOnClickListener
                }
                isEnabled = false
                alpha = 0.65f
                status.setTextColor(XtColors.muted)
                status.text = "正在连接飞牛音乐服务…"
                thread(name = "xtmusic-login") {
                    try {
                        val nextClient = FnosClient.createUnauthenticated(
                            serverInput = server.text.toString(),
                            accessCode = accessCode.text.toString(),
                            allowHttp = allowHttp.isChecked,
                            allowSelfSigned = allowSelfSigned.isChecked
                        )
                        val session = nextClient.login(rawUsername, rawPassword)
                        store.save(session)
                        client = nextClient
                        password.text.clear()
                        runOnUiThread {
                            showAppShell()
                            showHome()
                        }
                    } catch (error: Exception) {
                        runOnUiThread {
                            isEnabled = true
                            alpha = 1f
                            status.setTextColor(XtColors.danger)
                            status.text = error.message ?: "登录失败"
                        }
                    }
                }
            }
        }

        listOf(server, username, password, accessCode).forEach { view ->
            card.addView(view, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(54)
            ).apply { topMargin = dp(10) })
        }
        card.addView(allowHttp, matchWrap(top = 8))
        card.addView(allowSelfSigned, matchWrap(top = 2))
        card.addView(status, matchWrap())
        card.addView(login, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(54)
        ))

        form.addView(glow, LinearLayout.LayoutParams(dp(94), dp(94)))
        form.addView(title, matchWrap())
        form.addView(subtitle, matchWrap())
        form.addView(card, matchWrap())
        scroll.addView(form, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        root.addView(scroll, matchMatch())
    }

    private fun showAppShell() {
        root.removeAllViews()
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(XtColors.background)
        }

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(12), dp(6))
        }
        headerBack = actionButton("‹", compact = true).apply {
            textSize = 31f
            gravity = Gravity.CENTER
            visibility = View.GONE
            setOnClickListener { headerBackAction?.invoke() }
        }
        headerTitle = TextView(this).apply {
            text = "XT Music"
            styleText(24f, XtColors.text, true)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(10), 0, dp(8), 0)
        }
        val account = actionButton("退出", compact = true).apply {
            setOnClickListener {
                store.clear()
                client = null
                PlaybackService.command(this@MainActivity, PlaybackService.ACTION_STOP)
                showLogin("已退出账号")
            }
        }
        top.addView(headerBack, LinearLayout.LayoutParams(dp(48), dp(46)))
        top.addView(headerTitle, LinearLayout.LayoutParams(0, dp(46), 1f))
        top.addView(account, LinearLayout.LayoutParams(dp(64), dp(42)))

        contentHost = FrameLayout(this).apply {
            setBackgroundColor(XtColors.background)
        }

        miniPlayer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(7), dp(8), dp(7))
            background = gradientBackground(
                XtColors.surfaceRaised,
                Color.rgb(35, 30, 54),
                dp(18).toFloat(),
                GradientDrawable.Orientation.LEFT_RIGHT
            )
            visibility = View.GONE
            setOnClickListener { openNowPlaying() }
        }
        val artworkFrame = FrameLayout(this).apply {
            background = roundedBackground(XtColors.surfaceSoft, dp(12).toFloat())
            roundedOutline(dp(12).toFloat())
        }
        miniArtwork = ImageView(this)
        val fallback = TextView(this).apply {
            text = "♫"
            styleText(22f, XtColors.primarySoft, true)
            gravity = Gravity.CENTER
        }
        artworkFrame.addView(fallback, matchMatch())
        artworkFrame.addView(miniArtwork, matchMatch())
        val copy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
        }
        miniTitle = TextView(this).apply {
            styleText(15f, XtColors.text, true)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        miniSubtitle = TextView(this).apply {
            styleText(12f, XtColors.muted)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(3), 0, 0)
        }
        copy.addView(miniTitle)
        copy.addView(miniSubtitle)
        miniToggle = actionButton("▶", compact = true).apply {
            textSize = 19f
            gravity = Gravity.CENTER
            setOnClickListener {
                PlaybackService.command(this@MainActivity, PlaybackService.ACTION_TOGGLE)
            }
        }
        miniPlayer.addView(artworkFrame, LinearLayout.LayoutParams(dp(54), dp(54)))
        miniPlayer.addView(copy, LinearLayout.LayoutParams(0, dp(54), 1f))
        miniPlayer.addView(miniToggle, LinearLayout.LayoutParams(dp(50), dp(48)))

        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(4), dp(4), dp(6))
            background = roundedBackground(XtColors.backgroundElevated, dp(22).toFloat())
        }
        navigationItems.clear()
        val destinations = listOf(
            Triple(Destination.HOME, "⌂", "首页"),
            Triple(Destination.LIBRARY, "♫", "音乐库"),
            Triple(Destination.SEARCH, "⌕", "搜索"),
            Triple(Destination.NOW_PLAYING, "▶", "正在播放")
        )
        destinations.forEach { (destination, icon, label) ->
            val item = navigationItem(icon, label).apply {
                setOnClickListener {
                    when (destination) {
                        Destination.HOME -> showHome()
                        Destination.LIBRARY -> showLibrary(currentMode, 1)
                        Destination.SEARCH -> showSearch()
                        Destination.NOW_PLAYING -> openNowPlaying()
                    }
                }
            }
            navigationItems[destination] = item
            bottom.addView(item, LinearLayout.LayoutParams(0, dp(64), 1f))
        }

        shell.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))
        shell.addView(contentHost, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        shell.addView(miniPlayer, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            marginStart = dp(10)
            marginEnd = dp(10)
            topMargin = dp(4)
            bottomMargin = dp(5)
        })
        shell.addView(bottom, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(70)
        ).apply {
            marginStart = dp(8)
            marginEnd = dp(8)
            bottomMargin = dp(4)
        })
        root.addView(shell, matchMatch())
        renderMiniPlayer(PlaybackState.snapshot)
    }

    private fun showHome() {
        currentDestination = Destination.HOME
        updateNavigation()
        setHeader("XT Music")
        val generation = nextGeneration()
        showLoading("正在整理你的音乐…")
        val activeClient = client ?: return
        thread(name = "xtmusic-home") {
            try {
                val data = activeClient.getHome()
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    renderHome(data)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    showError(error, "首页加载失败") { showHome() }
                }
            }
        }
    }

    private fun renderHome(data: HomeData) {
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            setBackgroundColor(XtColors.background)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(8), dp(14), dp(26))
        }
        val heroTrack = data.history.firstOrNull() ?: data.favorites.firstOrNull()
        val heroAlbum = heroTrack?.album?.let {
            Album(it.guid, it.name, it.coverId ?: heroTrack.artworkId)
        } ?: data.albums.firstOrNull()
        content.addView(heroCard(heroTrack, heroAlbum), LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(220)
        ))

        if (data.artists.isNotEmpty()) {
            content.addView(sectionHeader("为你推荐", "查看歌手") { showLibrary(Mode.ARTISTS, 1) }, matchWrap(top = 24))
            content.addView(horizontalStrip(data.artists.map { artistCircle(it) }), matchWrap(top = 12))
        }
        if (data.history.isNotEmpty()) {
            content.addView(sectionHeader("最近播放", "查看全部") { showLibrary(Mode.HISTORY, 1) }, matchWrap(top = 26))
            content.addView(horizontalStrip(data.history.take(12).map { trackCard(it) }), matchWrap(top = 12))
        }
        if (data.albums.isNotEmpty()) {
            content.addView(sectionHeader("热门专辑", "全部专辑") { showLibrary(Mode.ALBUMS, 1) }, matchWrap(top = 26))
            content.addView(horizontalStrip(data.albums.take(14).map { albumCard(it) { showAlbumDetail(it) { showHome() } } }), matchWrap(top = 12))
        }
        if (data.favorites.isNotEmpty()) {
            content.addView(sectionHeader("我的收藏", "查看全部") { showLibrary(Mode.FAVORITES, 1) }, matchWrap(top = 26))
            content.addView(horizontalStrip(data.favorites.take(10).map { trackCard(it) }), matchWrap(top = 12))
        }
        scroll.addView(content, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        setContent(scroll)
    }

    private fun showLibrary(mode: Mode = currentMode, page: Int = 1) {
        currentDestination = Destination.LIBRARY
        currentMode = mode
        currentPage = page.coerceAtLeast(1)
        updateNavigation()
        setHeader("音乐库")
        val generation = nextGeneration()
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(XtColors.background)
        }
        container.addView(libraryTabs(mode), matchWrap())
        val body = FrameLayout(this).apply {
            addView(loadingView("正在加载${mode.label}…"), matchMatch())
        }
        container.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContent(container)

        val activeClient = client ?: return
        thread(name = "xtmusic-library-${mode.name.lowercase()}") {
            try {
                val result = when (mode) {
                    Mode.TRACKS -> activeClient.getTracks(currentPage, mode.pageSize).let {
                        it.list.map(::trackRow) to it.total
                    }
                    Mode.ALBUMS -> activeClient.getAlbums(currentPage, mode.pageSize).let {
                        it.list.map(::albumRow) to it.total
                    }
                    Mode.ARTISTS -> activeClient.getArtists(currentPage, mode.pageSize).let {
                        it.list.map(::artistRow) to it.total
                    }
                    Mode.FAVORITES -> activeClient.getFavorites(currentPage, mode.pageSize).let {
                        it.list.map(::trackRow) to it.total
                    }
                    Mode.HISTORY -> activeClient.getHistory(currentPage, mode.pageSize).let {
                        it.list.map(::trackRow) to it.total
                    }
                }
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    currentRows = result.first
                    currentTotal = result.second
                    renderLibraryBody(container, body, mode, result.first, result.second)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    body.removeAllViews()
                    body.addView(errorView(error.message ?: "加载失败") { showLibrary(mode, currentPage) }, matchMatch())
                }
            }
        }
    }

    private fun renderLibraryBody(
        container: LinearLayout,
        body: FrameLayout,
        mode: Mode,
        rows: List<LibraryRow>,
        total: Int
    ) {
        body.removeAllViews()
        val presentation = if (mode in setOf(Mode.ALBUMS, Mode.ARTISTS)) {
            LibraryPresentation.MEDIA_GRID
        } else {
            LibraryPresentation.TRACK_LIST
        }
        val adapter = LibraryAdapter(this, artworkLoader, { client }, presentation, rows)
        if (presentation == LibraryPresentation.MEDIA_GRID) {
            val grid = GridView(this).apply {
                numColumns = 2
                horizontalSpacing = dp(6)
                verticalSpacing = dp(4)
                stretchMode = GridView.STRETCH_COLUMN_WIDTH
                setPadding(dp(8), dp(5), dp(8), dp(12))
                clipToPadding = false
                isVerticalScrollBarEnabled = false
                this.adapter = adapter
                onItemClickListener = android.widget.AdapterView.OnItemClickListener { _, _, position, _ ->
                    when (val row = adapter.itemAt(position)) {
                        is LibraryRow.AlbumRow -> showAlbumDetail(row.album) { showLibrary(Mode.ALBUMS, currentPage) }
                        is LibraryRow.ArtistRow -> showArtistDetail(row.artist)
                        else -> Unit
                    }
                }
            }
            body.addView(grid, matchMatch())
        } else {
            val list = ListView(this).apply {
                divider = android.graphics.drawable.ColorDrawable(XtColors.divider)
                dividerHeight = dp(1)
                setPadding(dp(8), dp(4), dp(8), dp(10))
                clipToPadding = false
                isVerticalScrollBarEnabled = false
                this.adapter = adapter
                onItemClickListener = android.widget.AdapterView.OnItemClickListener { _, _, position, _ ->
                    val selected = adapter.itemAt(position) as? LibraryRow.TrackRow
                    if (selected != null) {
                        val tracks = rows.mapNotNull { (it as? LibraryRow.TrackRow)?.track }
                        playTracks(tracks, tracks.indexOfFirst { it.guid == selected.track.guid }.coerceAtLeast(0))
                    }
                }
            }
            body.addView(list, matchMatch())
        }

        if (container.childCount > 2) container.removeViewAt(container.childCount - 1)
        container.addView(pager(mode, total), matchWrap())
    }

    private fun showArtistDetail(artist: Artist) {
        currentDestination = Destination.LIBRARY
        updateNavigation()
        setHeader(artist.name, true) { showLibrary(Mode.ARTISTS, 1) }
        val generation = nextGeneration()
        showLoading("正在加载歌手专辑…")
        val activeClient = client ?: return
        thread(name = "xtmusic-artist") {
            try {
                val albums = activeClient.getArtistAlbums(artist.guid)
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    renderArtistDetail(artist, albums)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    showError(error, "歌手专辑加载失败") { showArtistDetail(artist) }
                }
            }
        }
    }

    private fun renderArtistDetail(artist: Artist, albums: List<Album>) {
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            setBackgroundColor(XtColors.background)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), 0, dp(14), dp(30))
        }
        val hero = FrameLayout(this).apply {
            background = roundedBackground(XtColors.surface, dp(26).toFloat())
            roundedOutline(dp(26).toFloat())
        }
        val image = ImageView(this)
        artworkLoader.load(
            image,
            client,
            artist.coverId ?: albums.firstOrNull()?.coverId,
            dp(900),
            artist.guid
        )
        val shade = View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.BOTTOM_TOP,
                intArrayOf(colorWithAlpha(Color.BLACK, 238), colorWithAlpha(Color.BLACK, 20))
            )
        }
        val copy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }
        val eyebrow = TextView(this).apply {
            text = "艺人"
            styleText(12f, XtColors.primarySoft, true)
        }
        val name = TextView(this).apply {
            text = artist.name
            styleText(32f, Color.WHITE, true)
            setPadding(0, dp(6), 0, dp(6))
        }
        val metrics = TextView(this).apply {
            text = buildString {
                append(if (albums.isNotEmpty()) "${albums.size} 张专辑" else "专辑")
                if (artist.trackCount > 0) append(" · ${artist.trackCount} 首歌曲")
            }
            styleText(13f, colorWithAlpha(Color.WHITE, 205))
        }
        val follow = actionButton("＋ 关注", primary = true, compact = true).apply {
            gravity = Gravity.CENTER
        }
        copy.addView(eyebrow)
        copy.addView(name)
        copy.addView(metrics)
        copy.addView(follow, LinearLayout.LayoutParams(dp(96), dp(40)).apply { topMargin = dp(14) })
        hero.addView(image, matchMatch())
        hero.addView(shade, matchMatch())
        hero.addView(copy, matchMatch())
        content.addView(hero, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(300)))
        content.addView(sectionHeader("专辑", "${albums.size} 张", null), matchWrap(top = 24))
        content.addView(twoColumnAlbumGrid(albums, artist), matchWrap(top = 12))
        scroll.addView(content, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        setContent(scroll)
    }

    private fun showAlbumDetail(album: Album, onBack: (() -> Unit)? = null) {
        currentDestination = Destination.LIBRARY
        updateNavigation()
        setHeader(album.name, true, onBack ?: { showLibrary(Mode.ALBUMS, 1) })
        val generation = nextGeneration()
        showLoading("正在加载专辑…")
        val activeClient = client ?: return
        thread(name = "xtmusic-album") {
            try {
                val page = activeClient.getAlbumTracks(album.guid)
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    renderAlbumDetail(album, page.list)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    showError(error, "专辑加载失败") { showAlbumDetail(album, onBack) }
                }
            }
        }
    }

    private fun renderAlbumDetail(album: Album, tracks: List<Track>) {
        val scroll = ScrollView(this).apply {
            isVerticalScrollBarEnabled = false
            setBackgroundColor(XtColors.background)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(4), dp(16), dp(30))
        }
        val cover = ImageView(this).apply {
            background = roundedBackground(XtColors.surfaceRaised, dp(24).toFloat())
            roundedOutline(dp(24).toFloat())
        }
        artworkLoader.load(cover, client, album.coverId ?: tracks.firstOrNull()?.artworkId, dp(900), album.guid)
        val coverWrap = FrameLayout(this).apply {
            addView(cover, FrameLayout.LayoutParams(dp(254), dp(254), Gravity.CENTER))
        }
        content.addView(coverWrap, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(270)))

        val title = TextView(this).apply {
            text = album.name
            styleText(28f, XtColors.text, true)
            gravity = Gravity.CENTER
            maxLines = 2
        }
        val artistText = tracks.firstOrNull()?.artistText?.takeIf { it != "未知歌手" }
            ?: album.artistText
        val artist = TextView(this).apply {
            text = artistText
            styleText(15f, XtColors.primarySoft, true)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }
        val meta = TextView(this).apply {
            text = buildString {
                album.releaseYear?.let { append(it).append(" · ") }
                append("${tracks.size} 首歌曲")
                val duration = tracks.sumOf { it.durationSeconds }
                if (duration > 0) append(" · ${duration / 60} 分钟")
            }
            styleText(13f, XtColors.muted)
            gravity = Gravity.CENTER
            setPadding(0, dp(7), 0, dp(16))
        }
        content.addView(title, matchWrap())
        content.addView(artist, matchWrap())
        content.addView(meta, matchWrap())

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        val play = actionButton("▶  播放", primary = true).apply {
            gravity = Gravity.CENTER
            setOnClickListener { if (tracks.isNotEmpty()) playTracks(tracks, 0) }
        }
        val shuffle = actionButton("随机播放").apply {
            gravity = Gravity.CENTER
            setOnClickListener {
                if (tracks.isNotEmpty()) playTracks(tracks.shuffled(), 0)
            }
        }
        actions.addView(play, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(6) })
        actions.addView(shuffle, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(6) })
        content.addView(actions, matchWrap())
        content.addView(sectionHeader("歌曲", "${tracks.size} 首", null), matchWrap(top = 26))

        tracks.forEachIndexed { index, track ->
            content.addView(detailTrackRow(index, track, tracks), LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(74)
            ).apply { topMargin = dp(2) })
        }
        scroll.addView(content, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        setContent(scroll)
    }

    private fun showSearch() {
        currentDestination = Destination.SEARCH
        updateNavigation()
        setHeader("搜索")
        nextGeneration()
        val rootView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(8), dp(14), dp(18))
        }
        val searchCard = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(6), dp(6), dp(6))
            background = roundedBackground(XtColors.surface, dp(18).toFloat())
        }
        val input = field("搜索歌曲、歌手或专辑", InputType.TYPE_CLASS_TEXT).apply {
            background = null
            setSingleLine(true)
        }
        val submit = actionButton("搜索", primary = true, compact = true).apply { gravity = Gravity.CENTER }
        searchCard.addView(input, LinearLayout.LayoutParams(0, dp(48), 1f))
        searchCard.addView(submit, LinearLayout.LayoutParams(dp(74), dp(44)))
        val resultHost = FrameLayout(this).apply {
            val hint = TextView(this@MainActivity).apply {
                text = "搜索你的飞牛音乐库\n支持歌曲标题与歌手名称"
                styleText(15f, XtColors.muted)
                gravity = Gravity.CENTER
            }
            addView(hint, matchMatch())
        }
        rootView.addView(searchCard, matchWrap())
        rootView.addView(resultHost, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply {
            topMargin = dp(10)
        })
        setContent(rootView)

        val doSearch = {
            val query = input.text.toString().trim()
            if (query.isNotEmpty()) {
                hideKeyboard(input)
                searchTracks(query, resultHost)
            }
        }
        submit.setOnClickListener { doSearch() }
        input.setOnEditorActionListener { _, _, _ ->
            doSearch()
            true
        }
    }

    private fun searchTracks(query: String, host: FrameLayout) {
        val generation = nextGeneration()
        host.removeAllViews()
        host.addView(loadingView("正在搜索“$query”…"), matchMatch())
        val activeClient = client ?: return
        thread(name = "xtmusic-search") {
            try {
                val page = activeClient.searchTracks(query)
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    host.removeAllViews()
                    val rows = page.list.map(::trackRow)
                    if (rows.isEmpty()) {
                        host.addView(emptyView("没有找到相关歌曲"), matchMatch())
                        return@runOnUiThread
                    }
                    val adapter = LibraryAdapter(
                        this,
                        artworkLoader,
                        { client },
                        LibraryPresentation.TRACK_LIST,
                        rows
                    )
                    val list = ListView(this).apply {
                        divider = android.graphics.drawable.ColorDrawable(XtColors.divider)
                        dividerHeight = dp(1)
                        setPadding(0, dp(4), 0, dp(8))
                        clipToPadding = false
                        this.adapter = adapter
                        onItemClickListener = android.widget.AdapterView.OnItemClickListener { _, _, position, _ ->
                            playTracks(page.list, position)
                        }
                    }
                    host.addView(list, matchMatch())
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    host.removeAllViews()
                    host.addView(errorView(error.message ?: "搜索失败") { searchTracks(query, host) }, matchMatch())
                }
            }
        }
    }

    private fun heroCard(track: Track?, album: Album?): FrameLayout {
        val frame = FrameLayout(this).apply {
            background = roundedBackground(XtColors.surface, dp(24).toFloat())
            roundedOutline(dp(24).toFloat())
            isClickable = true
        }
        val image = ImageView(this)
        val coverId = track?.artworkId ?: album?.coverId
        artworkLoader.load(image, client, coverId, dp(1000), track?.guid ?: album?.guid.orEmpty())
        val shade = View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.BOTTOM_TOP,
                intArrayOf(colorWithAlpha(Color.BLACK, 235), colorWithAlpha(Color.BLACK, 18))
            )
        }
        val copy = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM
            setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        val tag = TextView(this).apply {
            text = "今日推荐"
            styleText(11f, Color.WHITE, true)
            gravity = Gravity.CENTER
            background = roundedBackground(colorWithAlpha(XtColors.primaryStrong, 220), dp(12).toFloat())
            setPadding(dp(10), dp(5), dp(10), dp(5))
        }
        val title = TextView(this).apply {
            text = track?.title ?: album?.name ?: "欢迎回来"
            styleText(27f, Color.WHITE, true)
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(10), 0, dp(5))
        }
        val subtitle = TextView(this).apply {
            text = track?.let { "${it.artistText} · ${it.albumText}" }
                ?: album?.let { "${it.artistText} · ${it.trackCount} 首歌曲" }
                ?: "从你的飞牛音乐库继续聆听"
            styleText(13f, colorWithAlpha(Color.WHITE, 210))
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        copy.addView(tag, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        copy.addView(title, matchWrap())
        copy.addView(subtitle, matchWrap())
        val play = TextView(this).apply {
            text = "▶"
            styleText(20f, Color.WHITE, true)
            gravity = Gravity.CENTER
            background = roundedBackground(colorWithAlpha(XtColors.primaryStrong, 235), dp(27).toFloat())
        }
        frame.addView(image, matchMatch())
        frame.addView(shade, matchMatch())
        frame.addView(copy, matchMatch())
        frame.addView(play, FrameLayout.LayoutParams(dp(54), dp(54), Gravity.END or Gravity.BOTTOM).apply {
            marginEnd = dp(16)
            bottomMargin = dp(16)
        })
        frame.setOnClickListener {
            when {
                track != null -> playTracks(listOf(track), 0)
                album != null -> showAlbumDetail(album) { showHome() }
            }
        }
        return frame
    }

    private fun artistCircle(artist: Artist): View {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(4), dp(2), dp(4), dp(4))
            setOnClickListener { showArtistDetail(artist) }
        }
        val image = ImageView(this).apply {
            background = roundedBackground(XtColors.surfaceRaised, dp(42).toFloat())
            circleOutline()
        }
        artworkLoader.load(image, client, artist.coverId, dp(260), artist.guid)
        val name = TextView(this).apply {
            text = artist.name
            styleText(12f, XtColors.textSecondary, true)
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(8), 0, 0)
        }
        card.addView(image, LinearLayout.LayoutParams(dp(82), dp(82)))
        card.addView(name, LinearLayout.LayoutParams(dp(92), ViewGroup.LayoutParams.WRAP_CONTENT))
        card.layoutParams = LinearLayout.LayoutParams(dp(100), dp(118)).apply { marginEnd = dp(7) }
        return card
    }

    private fun trackCard(track: Track): View {
        val card = mediaCardBase(track.title, track.artistText, track.artworkId, track.guid)
        card.setOnClickListener { playTracks(listOf(track), 0) }
        return card
    }

    private fun albumCard(album: Album, onClick: () -> Unit): View {
        val subtitle = buildString {
            album.releaseYear?.let { append(it).append(" · ") }
            append(if (album.artistText != "未知歌手") album.artistText else "专辑")
        }
        return mediaCardBase(album.name, subtitle, album.coverId, album.guid).apply {
            setOnClickListener { onClick() }
        }
    }

    private fun mediaCardBase(
        titleValue: String,
        subtitleValue: String,
        coverId: String?,
        seed: String
    ): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(3), dp(3), dp(3), dp(5))
            layoutParams = LinearLayout.LayoutParams(dp(150), dp(210)).apply { marginEnd = dp(10) }
        }
        val imageFrame = FrameLayout(this).apply {
            background = roundedBackground(XtColors.surfaceRaised, dp(18).toFloat())
            roundedOutline(dp(18).toFloat())
        }
        val image = ImageView(this)
        val play = TextView(this).apply {
            text = "▶"
            styleText(14f, Color.WHITE, true)
            gravity = Gravity.CENTER
            background = roundedBackground(colorWithAlpha(Color.BLACK, 170), dp(20).toFloat())
        }
        imageFrame.addView(image, matchMatch())
        imageFrame.addView(play, FrameLayout.LayoutParams(dp(40), dp(40), Gravity.END or Gravity.BOTTOM).apply {
            marginEnd = dp(8)
            bottomMargin = dp(8)
        })
        artworkLoader.load(image, client, coverId, dp(480), seed)
        val title = TextView(this).apply {
            text = titleValue
            styleText(14f, XtColors.text, true)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(2), dp(9), dp(2), 0)
        }
        val subtitle = TextView(this).apply {
            text = subtitleValue
            styleText(12f, XtColors.muted)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(2), dp(4), dp(2), 0)
        }
        card.addView(imageFrame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(150)))
        card.addView(title, matchWrap())
        card.addView(subtitle, matchWrap())
        return card
    }

    private fun twoColumnAlbumGrid(albums: List<Album>, artist: Artist): LinearLayout {
        val grid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        albums.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            pair.forEachIndexed { index, album ->
                val card = albumGridCard(album) {
                    showAlbumDetail(album) { showArtistDetail(artist) }
                }
                row.addView(card, LinearLayout.LayoutParams(0, dp(248), 1f).apply {
                    if (index == 0) marginEnd = dp(6) else marginStart = dp(6)
                })
            }
            if (pair.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, dp(248), 1f).apply { marginStart = dp(6) })
            grid.addView(row, matchWrap(top = 4))
        }
        if (albums.isEmpty()) grid.addView(emptyView("这个歌手暂时没有可浏览的专辑"), LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(180)
        ))
        return grid
    }

    private fun albumGridCard(album: Album, onClick: () -> Unit): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(4), dp(4), dp(4), dp(8))
            setOnClickListener { onClick() }
            val image = ImageView(this@MainActivity).apply {
                background = roundedBackground(XtColors.surfaceRaised, dp(18).toFloat())
                roundedOutline(dp(18).toFloat())
            }
            artworkLoader.load(image, client, album.coverId, dp(520), album.guid)
            val title = TextView(this@MainActivity).apply {
                text = album.name
                styleText(15f, XtColors.text, true)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(dp(2), dp(10), dp(2), 0)
            }
            val subtitle = TextView(this@MainActivity).apply {
                text = buildString {
                    album.releaseYear?.let { append(it).append(" · ") }
                    append(if (album.trackCount > 0) "${album.trackCount} 首歌曲" else "专辑")
                }
                styleText(12f, XtColors.muted)
                setPadding(dp(2), dp(4), dp(2), 0)
            }
            addView(image, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(188)))
            addView(title, matchWrap())
            addView(subtitle, matchWrap())
        }
    }

    private fun detailTrackRow(index: Int, track: Track, queue: List<Track>): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(5), dp(5), dp(5))
            background = roundedBackground(XtColors.background, dp(13).toFloat())
            val number = TextView(this@MainActivity).apply {
                text = (index + 1).toString()
                styleText(13f, XtColors.muted)
                gravity = Gravity.CENTER
            }
            val copy = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(8), 0, dp(8), 0)
            }
            val title = TextView(this@MainActivity).apply {
                text = track.title
                styleText(15f, XtColors.text, true)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            }
            val artist = TextView(this@MainActivity).apply {
                text = track.artistText
                styleText(12f, XtColors.muted)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, dp(4), 0, 0)
            }
            copy.addView(title)
            copy.addView(artist)
            val duration = TextView(this@MainActivity).apply {
                text = formatDuration(track.durationSeconds)
                styleText(12f, XtColors.muted)
                gravity = Gravity.CENTER
            }
            addView(number, LinearLayout.LayoutParams(dp(34), ViewGroup.LayoutParams.MATCH_PARENT))
            addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
            addView(duration, LinearLayout.LayoutParams(dp(48), ViewGroup.LayoutParams.MATCH_PARENT))
            setOnClickListener { playTracks(queue, index) }
        }
    }

    private fun libraryTabs(selected: Mode): HorizontalScrollView {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(10), dp(4), dp(10), dp(8))
        }
        Mode.entries.forEach { mode ->
            val active = mode == selected
            val tab = TextView(this).apply {
                text = mode.label
                styleText(14f, if (active) Color.WHITE else XtColors.muted, active)
                gravity = Gravity.CENTER
                background = roundedBackground(
                    if (active) XtColors.primaryStrong else XtColors.surface,
                    dp(18).toFloat()
                )
                setOnClickListener { showLibrary(mode, 1) }
            }
            row.addView(tab, LinearLayout.LayoutParams(dp(84), dp(40)).apply {
                marginEnd = dp(8)
            })
        }
        return HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(row)
        }
    }

    private fun pager(mode: Mode, total: Int): LinearLayout {
        val totalPages = ceil(total.toDouble() / mode.pageSize.toDouble()).toInt().coerceAtLeast(1)
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(6), dp(14), dp(8))
            val previous = actionButton("上一页", compact = true).apply {
                isEnabled = currentPage > 1
                alpha = if (isEnabled) 1f else 0.4f
                setOnClickListener { if (currentPage > 1) showLibrary(mode, currentPage - 1) }
            }
            val label = TextView(this@MainActivity).apply {
                text = "第 $currentPage / $totalPages 页 · $total 项"
                styleText(12f, XtColors.muted)
                gravity = Gravity.CENTER
            }
            val next = actionButton("下一页", compact = true).apply {
                isEnabled = currentPage < totalPages
                alpha = if (isEnabled) 1f else 0.4f
                setOnClickListener { if (currentPage < totalPages) showLibrary(mode, currentPage + 1) }
            }
            addView(previous, LinearLayout.LayoutParams(dp(82), dp(40)))
            addView(label, LinearLayout.LayoutParams(0, dp(40), 1f))
            addView(next, LinearLayout.LayoutParams(dp(82), dp(40)))
        }
    }

    private fun sectionHeader(title: String, action: String?, onAction: (() -> Unit)?): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val heading = TextView(this@MainActivity).apply {
                text = title
                styleText(20f, XtColors.text, true)
            }
            addView(heading, LinearLayout.LayoutParams(0, dp(36), 1f))
            if (!action.isNullOrBlank()) {
                val more = TextView(this@MainActivity).apply {
                    text = "$action  ›"
                    styleText(12f, XtColors.muted, true)
                    gravity = Gravity.CENTER_VERTICAL or Gravity.END
                    setPadding(dp(10), 0, 0, 0)
                    if (onAction != null) setOnClickListener { onAction() }
                }
                addView(more, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36)))
            }
        }
    }

    private fun horizontalStrip(views: List<View>): HorizontalScrollView {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            views.forEach { addView(it) }
        }
        return HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(row)
        }
    }

    private fun navigationItem(iconText: String, labelText: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val icon = TextView(this@MainActivity).apply {
                text = iconText
                styleText(22f, XtColors.muted, true)
                gravity = Gravity.CENTER
                tag = "icon"
            }
            val label = TextView(this@MainActivity).apply {
                text = labelText
                styleText(11f, XtColors.muted, true)
                gravity = Gravity.CENTER
                setPadding(0, dp(2), 0, 0)
                tag = "label"
            }
            addView(icon, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(31)))
            addView(label, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(22)))
        }
    }

    private fun updateNavigation() {
        navigationItems.forEach { (destination, item) ->
            val selected = destination == currentDestination
            for (index in 0 until item.childCount) {
                (item.getChildAt(index) as? TextView)?.setTextColor(
                    if (selected) XtColors.primarySoft else XtColors.muted
                )
            }
            item.background = if (selected) {
                roundedBackground(colorWithAlpha(XtColors.primaryStrong, 34), dp(18).toFloat())
            } else null
        }
    }

    private fun setHeader(title: String, canGoBack: Boolean = false, action: (() -> Unit)? = null) {
        if (!::headerTitle.isInitialized) return
        headerTitle.text = title
        headerBackAction = if (canGoBack) action else null
        headerBack.visibility = if (canGoBack) View.VISIBLE else View.INVISIBLE
    }

    private fun renderMiniPlayer(snapshot: PlaybackSnapshot) {
        if (!::miniPlayer.isInitialized) return
        val track = snapshot.track
        miniPlayer.visibility = if (track == null) View.GONE else View.VISIBLE
        if (track == null) return
        miniTitle.text = track.title
        miniSubtitle.text = buildString {
            append(track.artistText).append(" · ").append(track.albumText)
            snapshot.error?.let { append(" · ").append(it) }
        }
        miniToggle.text = if (snapshot.playing) "Ⅱ" else if (snapshot.preparing) "…" else "▶"
        artworkLoader.load(miniArtwork, client, track.artworkId, dp(180), track.guid)
    }

    private fun playTracks(tracks: List<Track>, selectedIndex: Int) {
        if (tracks.isEmpty()) return
        PlaybackQueue.set(tracks, selectedIndex)
        PlaybackService.start(this)
    }

    private fun openNowPlaying() {
        if (PlaybackState.snapshot.track == null) {
            toast("请先选择一首歌曲")
            return
        }
        startActivity(Intent(this, NowPlayingActivity::class.java))
    }

    private fun showLoading(message: String) {
        setContent(loadingView(message))
    }

    private fun loadingView(message: String): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val progress = ProgressBar(this@MainActivity).apply {
                indeterminateTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
            }
            val label = TextView(this@MainActivity).apply {
                text = message
                styleText(14f, XtColors.muted)
                gravity = Gravity.CENTER
                setPadding(0, dp(14), 0, 0)
            }
            addView(progress, LinearLayout.LayoutParams(dp(48), dp(48)))
            addView(label, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
    }

    private fun emptyView(message: String): TextView = TextView(this).apply {
        text = message
        styleText(15f, XtColors.muted)
        gravity = Gravity.CENTER
        setPadding(dp(24), dp(40), dp(24), dp(40))
    }

    private fun errorView(message: String, retry: () -> Unit): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(28))
            val label = TextView(this@MainActivity).apply {
                text = message
                styleText(15f, XtColors.danger)
                gravity = Gravity.CENTER
            }
            val button = actionButton("重新加载", primary = true).apply {
                gravity = Gravity.CENTER
                setOnClickListener { retry() }
            }
            addView(label, matchWrap())
            addView(button, LinearLayout.LayoutParams(dp(120), dp(46)).apply { topMargin = dp(16) })
        }
    }

    private fun showError(error: Exception, fallback: String, retry: () -> Unit) {
        if (error is FnosException && error.code == "SESSION_EXPIRED") {
            store.clear()
            client = null
            showLogin(error.message)
        } else {
            setContent(errorView(error.message ?: fallback, retry))
        }
    }

    private fun setContent(view: View) {
        contentHost.removeAllViews()
        contentHost.addView(view, matchMatch())
    }

    private fun nextGeneration(): Int {
        requestGeneration += 1
        return requestGeneration
    }

    private fun field(hintText: String, inputTypeValue: Int): EditText {
        return EditText(this).apply {
            hint = hintText
            setHintTextColor(XtColors.muted)
            setTextColor(XtColors.text)
            textSize = 15f
            inputType = inputTypeValue
            setSingleLine(true)
            background = roundedBackground(
                XtColors.surfaceRaised,
                dp(14).toFloat(),
                XtColors.divider,
                dp(1)
            )
            setPadding(dp(14), 0, dp(14), 0)
            minimumHeight = dp(52)
        }
    }

    private fun actionButton(
        label: String,
        primary: Boolean = false,
        compact: Boolean = false
    ): TextView {
        return TextView(this).apply {
            text = label
            styleText(if (compact) 13f else 15f, if (primary) Color.WHITE else XtColors.text, true)
            gravity = Gravity.CENTER
            background = if (primary) {
                gradientBackground(
                    XtColors.primaryStrong,
                    XtColors.primary,
                    dp(if (compact) 13 else 16).toFloat(),
                    GradientDrawable.Orientation.LEFT_RIGHT
                )
            } else {
                roundedBackground(XtColors.surfaceRaised, dp(if (compact) 13 else 16).toFloat())
            }
            setPadding(dp(10), 0, dp(10), 0)
            isClickable = true
            isFocusable = true
        }
    }

    private fun hideKeyboard(view: View) {
        (getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager)
            ?.hideSoftInputFromWindow(view.windowToken, 0)
    }

    private fun formatDuration(seconds: Long): String {
        if (seconds <= 0) return ""
        return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    }

    private fun matchWrap(top: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(top) }

    private fun matchMatch(): FrameLayout.LayoutParams =
        FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun trackRow(track: Track): LibraryRow = LibraryRow.TrackRow(track)
    private fun albumRow(album: Album): LibraryRow = LibraryRow.AlbumRow(album)
    private fun artistRow(artist: Artist): LibraryRow = LibraryRow.ArtistRow(artist)

    private enum class Destination {
        HOME,
        LIBRARY,
        SEARCH,
        NOW_PLAYING
    }

    private enum class Mode(val label: String, val pageSize: Int) {
        TRACKS("歌曲", 100),
        ALBUMS("专辑", 48),
        ARTISTS("歌手", 48),
        FAVORITES("收藏", 100),
        HISTORY("历史", 100)
    }

    companion object {
        const val EXTRA_OPEN_ALBUM_GUID = "open_album_guid"
        const val EXTRA_OPEN_ALBUM_NAME = "open_album_name"
    }
}
