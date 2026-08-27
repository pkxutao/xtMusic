package com.pkxutao.xtmusic.android

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private val store by lazy { SessionStore(this) }
    private var client: FnosClient? = null
    private var currentMode = Mode.TRACKS
    private var currentPage = 1
    private var currentTotal = 0
    private var currentRows: List<LibraryRow> = emptyList()
    private var currentTracks: List<Track> = emptyList()
    private var titleOverride: String? = null
    private var backAction: (() -> Unit)? = null

    private lateinit var listView: ListView
    private lateinit var adapter: LibraryAdapter
    private lateinit var titleView: TextView
    private lateinit var backButton: Button
    private lateinit var progress: ProgressBar
    private lateinit var pageLabel: TextView
    private lateinit var previousPageButton: Button
    private lateinit var nextPageButton: Button
    private lateinit var miniPlayer: LinearLayout
    private lateinit var miniTitle: TextView
    private lateinit var miniSubtitle: TextView
    private lateinit var miniToggle: Button

    private val playbackListener: (PlaybackSnapshot) -> Unit = { snapshot ->
        runOnUiThread { renderMiniPlayer(snapshot) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = XtColors.background
        window.navigationBarColor = XtColors.background
        root = FrameLayout(this).apply { setBackgroundColor(XtColors.background) }
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
            showLibrary()
            loadMode(Mode.TRACKS, 1)
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

    private fun handleIntent(intent: Intent?) {
        val albumGuid = intent?.getStringExtra(EXTRA_OPEN_ALBUM_GUID).orEmpty()
        if (albumGuid.isBlank() || client == null || !::listView.isInitialized) return
        val albumName = intent?.getStringExtra(EXTRA_OPEN_ALBUM_NAME).orEmpty().ifBlank { "专辑详情" }
        intent?.removeExtra(EXTRA_OPEN_ALBUM_GUID)
        loadAlbumTracks(Album(albumGuid, albumName))
    }

    private fun showLogin(message: String? = null) {
        root.removeAllViews()
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(XtColors.background)
        }
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(40), dp(28), dp(40))
        }
        val logo = TextView(this).apply {
            text = "XT"
            styleText(42f, XtColors.primary, true)
            gravity = Gravity.CENTER
            background = roundedBackground(XtColors.surface, dp(24).toFloat())
            setPadding(dp(24), dp(16), dp(24), dp(16))
        }
        val title = TextView(this).apply {
            text = "XT Music Android"
            styleText(28f, XtColors.text, true)
            gravity = Gravity.CENTER
            setPadding(0, dp(22), 0, dp(4))
        }
        val subtitle = TextView(this).apply {
            text = "原生 Android Alpha · 飞牛音乐账号登录"
            styleText(14f, XtColors.muted)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(24))
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
            setTextColor(XtColors.muted)
            buttonTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
        }
        val allowSelfSigned = CheckBox(this).apply {
            text = "信任当前服务器的自签名证书"
            setTextColor(XtColors.muted)
            buttonTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
        }
        val status = TextView(this).apply {
            styleText(13f, if (message == null) XtColors.muted else XtColors.danger)
            text = message ?: "原始密码不会写入磁盘；登录会话使用 Android Keystore 加密保存。"
            setPadding(0, dp(10), 0, dp(12))
        }
        val login = button("登录", primary = true).apply {
            setOnClickListener {
                val rawServer = server.text.toString()
                val rawUsername = username.text.toString().trim()
                val rawPassword = password.text.toString()
                if (rawUsername.isBlank() || rawPassword.isBlank()) {
                    status.setTextColor(XtColors.danger)
                    status.text = "请输入飞牛音乐账号和密码"
                    return@setOnClickListener
                }
                isEnabled = false
                status.setTextColor(XtColors.muted)
                status.text = "正在连接飞牛音乐服务…"
                thread(name = "xtmusic-login") {
                    try {
                        val nextClient = FnosClient.createUnauthenticated(
                            serverInput = rawServer,
                            accessCode = accessCode.text.toString(),
                            allowHttp = allowHttp.isChecked,
                            allowSelfSigned = allowSelfSigned.isChecked
                        )
                        val session = nextClient.login(rawUsername, rawPassword)
                        store.save(session)
                        client = nextClient
                        password.text.clear()
                        runOnUiThread {
                            showLibrary()
                            loadMode(Mode.TRACKS, 1)
                        }
                    } catch (error: Exception) {
                        runOnUiThread {
                            isEnabled = true
                            status.setTextColor(XtColors.danger)
                            status.text = error.message ?: "登录失败"
                        }
                    }
                }
            }
        }

        form.addView(logo, LinearLayout.LayoutParams(dp(92), dp(92)))
        form.addView(title, matchWrap())
        form.addView(subtitle, matchWrap())
        for (view in listOf(server, username, password, accessCode, allowHttp, allowSelfSigned, status, login)) {
            form.addView(view, matchWrap(top = if (view is EditText) 10 else 4))
        }
        scroll.addView(form, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        root.addView(scroll, matchMatch())
    }

    private fun showLibrary() {
        root.removeAllViews()
        val shell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(XtColors.background)
        }

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(8))
        }
        backButton = button("‹", compact = true).apply {
            visibility = View.GONE
            setOnClickListener { backAction?.invoke() }
        }
        titleView = TextView(this).apply {
            text = "音乐库"
            styleText(22f, XtColors.text, true)
            setPadding(dp(10), 0, dp(8), 0)
        }
        val account = button("退出", compact = true).apply {
            setOnClickListener {
                store.clear()
                client = null
                PlaybackService.command(this@MainActivity, PlaybackService.ACTION_STOP)
                showLogin("已退出账号")
            }
        }
        top.addView(backButton, LinearLayout.LayoutParams(dp(46), dp(42)))
        top.addView(titleView, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(account, LinearLayout.LayoutParams(dp(68), dp(42)))

        val searchRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(12), 0, dp(12), dp(8))
        }
        val searchInput = field("搜索歌曲", InputType.TYPE_CLASS_TEXT).apply {
            setSingleLine(true)
        }
        val searchButton = button("搜索", compact = true).apply {
            setOnClickListener {
                val query = searchInput.text.toString().trim()
                if (query.isNotEmpty()) searchTracks(query)
            }
        }
        searchRow.addView(searchInput, LinearLayout.LayoutParams(0, dp(48), 1f))
        searchRow.addView(searchButton, LinearLayout.LayoutParams(dp(76), dp(48)).apply {
            marginStart = dp(8)
        })

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(8), 0, dp(8), dp(8))
        }
        Mode.entries.forEach { mode ->
            tabs.addView(
                button(mode.label, compact = true).apply {
                    setOnClickListener { loadMode(mode, 1) }
                },
                LinearLayout.LayoutParams(dp(84), dp(42)).apply {
                    marginStart = dp(4)
                    marginEnd = dp(4)
                }
            )
        }
        val tabScroller = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(tabs)
        }

        val content = FrameLayout(this)
        adapter = LibraryAdapter(this)
        listView = ListView(this).apply {
            divider = android.graphics.drawable.ColorDrawable(XtColors.surface)
            dividerHeight = dp(1)
            setBackgroundColor(XtColors.background)
            setPadding(dp(8), 0, dp(8), 0)
            clipToPadding = false
            this.adapter = this@MainActivity.adapter
            setOnItemClickListener { _, _, position, _ ->
                when (val row = this@MainActivity.adapter.itemAt(position)) {
                    is LibraryRow.TrackRow -> {
                        val tracks = currentRows.mapNotNull { (it as? LibraryRow.TrackRow)?.track }
                        val selected = tracks.indexOfFirst { it.guid == row.track.guid }.coerceAtLeast(0)
                        PlaybackQueue.set(tracks, selected)
                        PlaybackService.start(this@MainActivity)
                        startActivity(Intent(this@MainActivity, NowPlayingActivity::class.java))
                    }
                    is LibraryRow.AlbumRow -> loadAlbumTracks(row.album)
                    is LibraryRow.ArtistRow -> loadArtistAlbums(row.artist)
                    null -> Unit
                }
            }
        }
        progress = ProgressBar(this).apply {
            indeterminateTintList = android.content.res.ColorStateList.valueOf(XtColors.primary)
            visibility = View.GONE
        }
        content.addView(listView, matchMatch())
        content.addView(
            progress,
            FrameLayout.LayoutParams(dp(54), dp(54), Gravity.CENTER)
        )

        val pager = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(6), dp(12), dp(6))
        }
        previousPageButton = button("上一页", compact = true).apply {
            setOnClickListener {
                if (currentPage > 1) loadMode(currentMode, currentPage - 1)
            }
        }
        pageLabel = TextView(this).apply {
            styleText(13f, XtColors.muted)
            gravity = Gravity.CENTER
        }
        nextPageButton = button("下一页", compact = true).apply {
            setOnClickListener {
                val pageSize = currentMode.pageSize
                if (currentPage * pageSize < currentTotal) loadMode(currentMode, currentPage + 1)
            }
        }
        pager.addView(previousPageButton, LinearLayout.LayoutParams(dp(88), dp(40)))
        pager.addView(pageLabel, LinearLayout.LayoutParams(0, dp(40), 1f))
        pager.addView(nextPageButton, LinearLayout.LayoutParams(dp(88), dp(40)))

        miniPlayer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(9), dp(10), dp(9))
            background = roundedBackground(XtColors.surfaceRaised, dp(16).toFloat())
            visibility = View.GONE
            setOnClickListener {
                startActivity(Intent(this@MainActivity, NowPlayingActivity::class.java))
            }
        }
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        miniTitle = TextView(this).apply {
            styleText(15f, XtColors.text, true)
            maxLines = 1
        }
        miniSubtitle = TextView(this).apply {
            styleText(12f, XtColors.muted)
            maxLines = 1
        }
        copy.addView(miniTitle)
        copy.addView(miniSubtitle)
        miniToggle = button("▶", compact = true).apply {
            setOnClickListener {
                PlaybackService.command(this@MainActivity, PlaybackService.ACTION_TOGGLE)
            }
        }
        miniPlayer.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        miniPlayer.addView(miniToggle, LinearLayout.LayoutParams(dp(48), dp(44)))

        shell.addView(top, matchWrap())
        shell.addView(searchRow, matchWrap())
        shell.addView(tabScroller, matchWrap())
        shell.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        shell.addView(pager, matchWrap())
        shell.addView(miniPlayer, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            marginStart = dp(10)
            marginEnd = dp(10)
            bottomMargin = dp(10)
        })
        root.addView(shell, matchMatch())
        renderMiniPlayer(PlaybackState.snapshot)
    }

    private fun loadMode(mode: Mode, page: Int) {
        val activeClient = client ?: return
        currentMode = mode
        currentPage = page.coerceAtLeast(1)
        titleOverride = null
        backAction = null
        updateHeader()
        setLoading(true)
        thread(name = "xtmusic-library") {
            try {
                val result: Pair<List<LibraryRow>, Int> = when (mode) {
                    Mode.TRACKS -> activeClient.getTracks(currentPage, mode.pageSize).let {
                        it.list.map { track -> LibraryRow.TrackRow(track) } to it.total
                    }
                    Mode.ALBUMS -> activeClient.getAlbums(currentPage, mode.pageSize).let {
                        it.list.map { album -> LibraryRow.AlbumRow(album) } to it.total
                    }
                    Mode.ARTISTS -> activeClient.getArtists(currentPage, mode.pageSize).let {
                        it.list.map { artist -> LibraryRow.ArtistRow(artist) } to it.total
                    }
                    Mode.FAVORITES -> activeClient.getFavorites(currentPage, mode.pageSize).let {
                        it.list.map { track -> LibraryRow.TrackRow(track) } to it.total
                    }
                    Mode.HISTORY -> activeClient.getHistory(currentPage, mode.pageSize).let {
                        it.list.map { track -> LibraryRow.TrackRow(track) } to it.total
                    }
                }
                runOnUiThread { applyRows(result.first, result.second) }
            } catch (error: Exception) {
                runOnUiThread {
                    setLoading(false)
                    if (error is FnosException && error.code == "SESSION_EXPIRED") {
                        store.clear()
                        client = null
                        showLogin(error.message)
                    } else {
                        toast(error.message ?: "加载失败")
                    }
                }
            }
        }
    }

    private fun searchTracks(query: String) {
        val activeClient = client ?: return
        titleOverride = "搜索：$query"
        backAction = { loadMode(Mode.TRACKS, 1) }
        updateHeader()
        setLoading(true)
        thread(name = "xtmusic-search") {
            try {
                val page = activeClient.searchTracks(query)
                runOnUiThread {
                    currentPage = 1
                    currentMode = Mode.TRACKS
                    applyRows(page.list.map { track -> LibraryRow.TrackRow(track) }, page.total)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    setLoading(false)
                    toast(error.message ?: "搜索失败")
                }
            }
        }
    }

    private fun loadAlbumTracks(album: Album) {
        val activeClient = client ?: return
        titleOverride = album.name
        backAction = { loadMode(Mode.ALBUMS, 1) }
        updateHeader()
        setLoading(true)
        thread(name = "xtmusic-album") {
            try {
                val page = activeClient.getAlbumTracks(album.guid)
                runOnUiThread {
                    currentPage = 1
                    currentMode = Mode.TRACKS
                    applyRows(page.list.map { track -> LibraryRow.TrackRow(track) }, page.total)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    setLoading(false)
                    toast(error.message ?: "专辑加载失败")
                }
            }
        }
    }

    private fun loadArtistAlbums(artist: Artist) {
        val activeClient = client ?: return
        titleOverride = artist.name
        backAction = { loadMode(Mode.ARTISTS, 1) }
        updateHeader()
        setLoading(true)
        thread(name = "xtmusic-artist") {
            try {
                val albums = activeClient.getArtistAlbums(artist.guid)
                runOnUiThread {
                    currentPage = 1
                    currentMode = Mode.ALBUMS
                    applyRows(albums.map { album -> LibraryRow.AlbumRow(album) }, albums.size)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    setLoading(false)
                    toast(error.message ?: "歌手专辑加载失败")
                }
            }
        }
    }

    private fun applyRows(rows: List<LibraryRow>, total: Int) {
        currentRows = rows
        currentTracks = rows.mapNotNull { (it as? LibraryRow.TrackRow)?.track }
        currentTotal = total
        adapter.submit(rows)
        setLoading(false)
        updatePager()
    }

    private fun updateHeader() {
        if (!::titleView.isInitialized) return
        titleView.text = titleOverride ?: currentMode.label
        backButton.visibility = if (backAction == null) View.GONE else View.VISIBLE
    }

    private fun updatePager() {
        if (!::pageLabel.isInitialized) return
        val pageSize = currentMode.pageSize
        val totalPages = ((currentTotal + pageSize - 1) / pageSize).coerceAtLeast(1)
        pageLabel.text = "第 $currentPage / $totalPages 页 · $currentTotal 项"
        previousPageButton.isEnabled = backAction == null && currentPage > 1
        nextPageButton.isEnabled = backAction == null && currentPage < totalPages
    }

    private fun setLoading(value: Boolean) {
        progress.visibility = if (value) View.VISIBLE else View.GONE
        listView.alpha = if (value) 0.35f else 1f
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
        miniToggle.text = if (snapshot.playing) "Ⅱ" else "▶"
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
                XtColors.surface,
                dp(12).toFloat(),
                Color.rgb(50, 57, 72),
                dp(1)
            )
            setPadding(dp(14), 0, dp(14), 0)
            minimumHeight = dp(50)
        }
    }

    private fun button(
        label: String,
        primary: Boolean = false,
        compact: Boolean = false
    ): Button {
        return Button(this).apply {
            text = label
            isAllCaps = false
            textSize = if (compact) 13f else 15f
            setTextColor(if (primary) XtColors.background else XtColors.text)
            background = roundedBackground(
                if (primary) XtColors.primary else XtColors.surfaceRaised,
                dp(if (compact) 10 else 13).toFloat()
            )
            setPadding(dp(8), 0, dp(8), 0)
            minHeight = 0
            minWidth = 0
        }
    }

    private fun LinearLayout.LayoutParams.withTop(value: Int): LinearLayout.LayoutParams {
        topMargin = dp(value)
        return this
    }

    private fun matchWrap(top: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).withTop(top)

    private fun matchMatch(): FrameLayout.LayoutParams =
        FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
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
