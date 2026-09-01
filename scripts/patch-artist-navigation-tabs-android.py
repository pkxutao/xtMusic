#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MARKER = "XT_ANDROID_ARTIST_TABS_QUEUE_20260901"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, value):
    (ROOT / path).write_text(value, encoding="utf-8")


def once(value, old, new, label):
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {count}")
    return value.replace(old, new, 1)


def regex_once(value, pattern, replacement, label):
    next_value, count = re.subn(pattern, replacement, value, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one regex anchor, found {count}")
    return next_value


# Domain model returned by a single artist-detail request.
path = "android/app/src/main/java/com/pkxutao/xtmusic/android/Models.kt"
value = read(path)
if MARKER not in value:
    anchor = """data class Page<T>(
    val list: List<T>,
    val total: Int,
    val page: Int,
    val size: Int
)
"""
    replacement = anchor + """

data class ArtistDetail(
    val tracks: List<Track>,
    val albums: List<Album>
)
"""
    value = once(value, anchor, replacement, "artist detail model")
    value += f"\n// {MARKER}\n"
    write(path, value)


# Fetch artist tracks once, then derive albums from the same bounded collection.
path = "android/app/src/main/java/com/pkxutao/xtmusic/android/FnosClient.kt"
value = read(path)
if MARKER not in value:
    replacement = r'''    fun getArtistTracks(
        artistGuid: String,
        page: Int = 1,
        size: Int = 400
    ): Page<Track> = page(
        "/track/artist-detail/list",
        page,
        size,
        ::parseTrack,
        mapOf("artistGUID" to artistGuid)
    )

    fun getArtistDetail(artistGuid: String): ArtistDetail {
        val pageSize = 400
        val first = getArtistTracks(artistGuid, 1, pageSize)
        val tracks = first.list.toMutableList()
        val pages = ((first.total + pageSize - 1) / pageSize).coerceIn(1, 30)
        for (pageNumber in 2..pages) {
            tracks += getArtistTracks(artistGuid, pageNumber, pageSize).list
        }
        val albums = tracks
            .mapNotNull { it.album }
            .groupBy { it.guid }
            .map { (_, values) ->
                val firstAlbum = values.first()
                Album(
                    guid = firstAlbum.guid,
                    name = firstAlbum.name,
                    coverId = firstAlbum.coverId,
                    trackCount = values.size,
                    artists = tracks
                        .asSequence()
                        .filter { it.album?.guid == firstAlbum.guid }
                        .flatMap { it.artists.asSequence() }
                        .distinctBy { it.guid }
                        .toList()
                )
            }
            .sortedBy { it.name.lowercase() }
        return ArtistDetail(tracks = tracks, albums = albums)
    }

    fun getArtistAlbums(artistGuid: String): List<Album> =
        getArtistDetail(artistGuid).albums
'''
    value = regex_once(
        value,
        r"    fun getArtistAlbums\(artistGuid: String\): List<Album> \{.*?\n    \}\n\n    fun searchTracks",
        replacement + "\n    fun searchTracks",
        "artist detail client"
    )
    value += f"\n// {MARKER}\n"
    write(path, value)


# Reusable rich artist labels for lists, cards, album detail, mini player and now playing.
path = "android/app/src/main/java/com/pkxutao/xtmusic/android/Ui.kt"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """import android.graphics.drawable.GradientDrawable
import android.os.Build
""",
        """import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
""",
        "ui artist link imports"
    )
    anchor = """fun TextView.styleText(
    sizeSp: Float,
    color: Int = XtColors.text,
    bold: Boolean = false
) {
    textSize = sizeSp
    setTextColor(color)
    includeFontPadding = false
    if (bold) setTypeface(typeface, Typeface.BOLD)
}
"""
    replacement = anchor + r'''

fun TextView.bindArtistLinks(
    artists: List<ArtistRef>,
    fallback: String = "未知歌手",
    prefix: String = "",
    suffix: String = "",
    onArtistClick: ((ArtistRef) -> Unit)? = null
) {
    val visible = artists.filter { it.name.isNotBlank() }
    highlightColor = Color.TRANSPARENT
    if (visible.isEmpty()) {
        text = prefix + fallback + suffix
        movementMethod = null
        linksClickable = false
        isClickable = false
        return
    }

    val builder = SpannableStringBuilder(prefix)
    visible.forEachIndexed { index, artist ->
        if (index > 0) builder.append("、")
        val start = builder.length
        builder.append(artist.name)
        val end = builder.length
        if (artist.guid.isNotBlank() && onArtistClick != null) {
            builder.setSpan(
                object : ClickableSpan() {
                    override fun onClick(widget: View) = onArtistClick(artist)

                    override fun updateDrawState(drawState: TextPaint) {
                        drawState.color = XtColors.primarySoft
                        drawState.isUnderlineText = false
                        drawState.typeface = Typeface.create(drawState.typeface, Typeface.BOLD)
                    }
                },
                start,
                end,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
            )
        }
    }
    builder.append(suffix)
    text = builder
    movementMethod = if (onArtistClick == null) null else LinkMovementMethod.getInstance()
    linksClickable = onArtistClick != null
    isClickable = onArtistClick != null
    isFocusable = false
}
'''
    value = once(value, anchor, replacement, "ui artist links helper")
    value += f"\n// {MARKER}\n"
    write(path, value)


# Track lists and album grids expose the artist span independently of row playback.
path = "android/app/src/main/java/com/pkxutao/xtmusic/android/LibraryAdapter.kt"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """    private val presentation: LibraryPresentation,
    private var rows: List<LibraryRow> = emptyList()
) : BaseAdapter() {
""",
        """    private val presentation: LibraryPresentation,
    private var rows: List<LibraryRow> = emptyList(),
    private val onArtistClick: ((ArtistRef) -> Unit)? = null
) : BaseAdapter() {
""",
        "library adapter artist callback"
    )
    value = once(
        value,
        """        holder.artist.text = track.artistText
        holder.album.text = track.albumText
""",
        """        holder.artist.bindArtistLinks(
            track.artists,
            fallback = track.artistText,
            onArtistClick = onArtistClick
        )
        holder.album.text = track.albumText
""",
        "track row artist links"
    )
    value = once(
        value,
        """                holder.subtitle.text = buildString {
                    row.album.releaseYear?.let { append(it).append(" · ") }
                    if (row.album.artistText != "未知歌手") append(row.album.artistText)
                    else if (row.album.trackCount > 0) append("${row.album.trackCount} 首歌曲")
                    else append("专辑")
                }
""",
        """                val prefix = row.album.releaseYear?.let { "$it · " }.orEmpty()
                val fallback = if (row.album.trackCount > 0) "${row.album.trackCount} 首歌曲" else "专辑"
                holder.subtitle.bindArtistLinks(
                    row.album.artists,
                    fallback = fallback,
                    prefix = prefix,
                    onArtistClick = onArtistClick
                )
""",
        "album grid artist links"
    )
    value += f"\n// {MARKER}\n"
    write(path, value)


# Playback queue exposes immutable contents and a selected-index operation.
path = "android/app/src/main/java/com/pkxutao/xtmusic/android/PlaybackState.kt"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """object PlaybackQueue {
""",
        """data class QueueSnapshot(
    val tracks: List<Track>,
    val index: Int
)

object PlaybackQueue {
""",
        "queue snapshot model"
    )
    value = once(
        value,
        """    fun set(items: List<Track>, selectedIndex: Int) {
        tracks = items.toList()
        index = selectedIndex.coerceIn(0, (tracks.size - 1).coerceAtLeast(0))
    }
""",
        """    fun set(items: List<Track>, selectedIndex: Int) {
        tracks = items.toList()
        index = if (tracks.isEmpty()) -1 else selectedIndex.coerceIn(0, tracks.lastIndex)
    }

    @Synchronized
    fun snapshot(): QueueSnapshot = QueueSnapshot(tracks.toList(), index)

    @Synchronized
    fun select(selectedIndex: Int): Track? {
        if (tracks.isEmpty() || selectedIndex !in tracks.indices) return null
        index = selectedIndex
        return current()
    }

    @Synchronized
    fun clear() {
        tracks = emptyList()
        index = -1
    }
""",
        "queue snapshot and select"
    )
    value += f"\n// {MARKER}\n"
    write(path, value)


# Playback service can jump to the queue item chosen in the queue sheet.
path = "android/app/src/main/java/com/pkxutao/xtmusic/android/PlaybackService.kt"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """            ACTION_SEEK -> seek(intent.getLongExtra(EXTRA_POSITION_MS, 0))
            ACTION_STOP -> stopPlayback()
""",
        """            ACTION_SEEK -> seek(intent.getLongExtra(EXTRA_POSITION_MS, 0))
            ACTION_PLAY_INDEX -> playIndex(intent.getIntExtra(EXTRA_QUEUE_INDEX, -1))
            ACTION_STOP -> stopPlayback()
""",
        "playback play index action"
    )
    value = once(
        value,
        """    private fun next() {
""",
        """    private fun playIndex(index: Int) {
        if (PlaybackQueue.select(index) != null) playCurrent()
    }

    private fun next() {
""",
        "playback play index method"
    )
    value = once(
        value,
        """        const val ACTION_SEEK = "com.pkxutao.xtmusic.android.SEEK"
        const val ACTION_STOP = "com.pkxutao.xtmusic.android.STOP"
        const val EXTRA_POSITION_MS = "position_ms"
""",
        """        const val ACTION_SEEK = "com.pkxutao.xtmusic.android.SEEK"
        const val ACTION_PLAY_INDEX = "com.pkxutao.xtmusic.android.PLAY_INDEX"
        const val ACTION_STOP = "com.pkxutao.xtmusic.android.STOP"
        const val EXTRA_POSITION_MS = "position_ms"
        const val EXTRA_QUEUE_INDEX = "queue_index"
""",
        "playback action constants"
    )
    value = once(
        value,
        """        fun command(context: Context, action: String, positionMs: Long? = null) {
            val intent = Intent(context, PlaybackService::class.java).setAction(action)
            if (positionMs != null) intent.putExtra(EXTRA_POSITION_MS, positionMs)
            context.startService(intent)
        }
""",
        """        fun command(context: Context, action: String, positionMs: Long? = null) {
            val intent = Intent(context, PlaybackService::class.java).setAction(action)
            if (positionMs != null) intent.putExtra(EXTRA_POSITION_MS, positionMs)
            context.startService(intent)
        }

        fun playIndex(context: Context, queueIndex: Int) {
            context.startService(
                Intent(context, PlaybackService::class.java)
                    .setAction(ACTION_PLAY_INDEX)
                    .putExtra(EXTRA_QUEUE_INDEX, queueIndex)
            )
        }
""",
        "playback public play index helper"
    )
    value += f"\n// {MARKER}\n"
    write(path, value)


# Main application: intents, all list callbacks, artist detail tabs, and clickable labels.
path = "android/app/src/main/java/com/pkxutao/xtmusic/android/MainActivity.kt"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """    private fun handleIntent(intent: Intent?) {
        val albumGuid = intent?.getStringExtra(EXTRA_OPEN_ALBUM_GUID).orEmpty()
        if (albumGuid.isBlank() || client == null || !::contentHost.isInitialized) return
        val albumName = intent?.getStringExtra(EXTRA_OPEN_ALBUM_NAME).orEmpty().ifBlank { "专辑详情" }
        intent?.removeExtra(EXTRA_OPEN_ALBUM_GUID)
        showAlbumDetail(Album(albumGuid, albumName)) { showHome() }
    }
""",
        """    private fun handleIntent(intent: Intent?) {
        if (client == null || !::contentHost.isInitialized) return
        val artistGuid = intent?.getStringExtra(EXTRA_OPEN_ARTIST_GUID).orEmpty()
        if (artistGuid.isNotBlank()) {
            val artistName = intent?.getStringExtra(EXTRA_OPEN_ARTIST_NAME).orEmpty().ifBlank { "歌手详情" }
            intent?.removeExtra(EXTRA_OPEN_ARTIST_GUID)
            intent?.removeExtra(EXTRA_OPEN_ARTIST_NAME)
            showArtistDetail(Artist(artistGuid, artistName))
            return
        }
        val albumGuid = intent?.getStringExtra(EXTRA_OPEN_ALBUM_GUID).orEmpty()
        if (albumGuid.isBlank()) return
        val albumName = intent?.getStringExtra(EXTRA_OPEN_ALBUM_NAME).orEmpty().ifBlank { "专辑详情" }
        intent?.removeExtra(EXTRA_OPEN_ALBUM_GUID)
        intent?.removeExtra(EXTRA_OPEN_ALBUM_NAME)
        showAlbumDetail(Album(albumGuid, albumName)) { showHome() }
    }
""",
        "main artist intent"
    )

    value = value.replace(
        "LibraryAdapter(this, artworkLoader, { client }, presentation, rows)",
        "LibraryAdapter(this, artworkLoader, { client }, presentation, rows, ::openArtist)",
        1
    )
    value = once(
        value,
        """                        LibraryPresentation.TRACK_LIST,
                        rows
                    )
""",
        """                        LibraryPresentation.TRACK_LIST,
                        rows,
                        ::openArtist
                    )
""",
        "search artist callback"
    )

    replacement = r'''    private fun openArtist(artist: ArtistRef) {
        if (artist.guid.isBlank()) return
        showArtistDetail(Artist(guid = artist.guid, name = artist.name))
    }

    private fun showArtistDetail(artist: Artist) {
        currentDestination = Destination.LIBRARY
        updateNavigation()
        setHeader(artist.name, true) { showLibrary(Mode.ARTISTS, 1) }
        val generation = nextGeneration()
        showLoading("正在加载歌手歌曲与专辑…")
        val activeClient = client ?: return
        thread(name = "xtmusic-artist") {
            try {
                val detail = activeClient.getArtistDetail(artist.guid)
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    renderArtistDetail(artist, detail, ArtistDetailTab.TRACKS)
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (generation != requestGeneration) return@runOnUiThread
                    showError(error, "歌手详情加载失败") { showArtistDetail(artist) }
                }
            }
        }
    }

    private fun renderArtistDetail(
        artist: Artist,
        detail: ArtistDetail,
        selectedTab: ArtistDetailTab
    ) {
        val tracks = detail.tracks
        val albums = detail.albums
        val screen = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), 0, dp(14), dp(8))
            setBackgroundColor(XtColors.background)
        }

        val hero = FrameLayout(this).apply {
            background = roundedBackground(XtColors.surface, dp(24).toFloat())
            roundedOutline(dp(24).toFloat())
        }
        val image = ImageView(this)
        artworkLoader.load(
            image,
            client,
            artist.coverId ?: tracks.firstOrNull()?.artworkId ?: albums.firstOrNull()?.coverId,
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
            setPadding(dp(18), dp(18), dp(18), dp(17))
        }
        val eyebrow = TextView(this).apply {
            text = "艺人"
            styleText(12f, XtColors.primarySoft, true)
        }
        val name = TextView(this).apply {
            text = artist.name
            styleText(29f, Color.WHITE, true)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(5), 0, dp(5))
        }
        val metrics = TextView(this).apply {
            text = "${tracks.size} 首歌曲 · ${albums.size} 张专辑"
            styleText(13f, colorWithAlpha(Color.WHITE, 205))
        }
        val playAll = actionButton("▶  播放全部", primary = true, compact = true).apply {
            gravity = Gravity.CENTER
            isEnabled = tracks.isNotEmpty()
            alpha = if (isEnabled) 1f else 0.45f
            setOnClickListener { if (tracks.isNotEmpty()) playTracks(tracks, 0) }
        }
        copy.addView(eyebrow)
        copy.addView(name)
        copy.addView(metrics)
        copy.addView(playAll, LinearLayout.LayoutParams(dp(120), dp(40)).apply { topMargin = dp(12) })
        hero.addView(image, matchMatch())
        hero.addView(shade, matchMatch())
        hero.addView(copy, matchMatch())
        screen.addView(hero, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(232)))

        screen.addView(
            artistDetailTabs(selectedTab, tracks.size, albums.size) { nextTab ->
                if (nextTab != selectedTab) renderArtistDetail(artist, detail, nextTab)
            },
            matchWrap(top = 12)
        )

        val body = FrameLayout(this)
        if (selectedTab == ArtistDetailTab.TRACKS) {
            val songs = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
            }
            val actions = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(2), dp(6), dp(2), dp(8))
            }
            val count = TextView(this).apply {
                text = "歌曲 · ${tracks.size} 首"
                styleText(17f, XtColors.text, true)
            }
            val playList = actionButton("▶ 播放列表歌曲", primary = true, compact = true).apply {
                gravity = Gravity.CENTER
                isEnabled = tracks.isNotEmpty()
                alpha = if (isEnabled) 1f else 0.45f
                setOnClickListener { if (tracks.isNotEmpty()) playTracks(tracks, 0) }
            }
            val shuffle = actionButton("随机", compact = true).apply {
                gravity = Gravity.CENTER
                isEnabled = tracks.isNotEmpty()
                alpha = if (isEnabled) 1f else 0.45f
                setOnClickListener { if (tracks.isNotEmpty()) playTracks(tracks.shuffled(), 0) }
            }
            actions.addView(count, LinearLayout.LayoutParams(0, dp(42), 1f))
            actions.addView(playList, LinearLayout.LayoutParams(dp(126), dp(40)).apply { marginEnd = dp(6) })
            actions.addView(shuffle, LinearLayout.LayoutParams(dp(58), dp(40)))
            songs.addView(actions, matchWrap())

            if (tracks.isEmpty()) {
                songs.addView(emptyView("这个歌手暂时没有可播放的歌曲"), LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    0,
                    1f
                ))
            } else {
                val rows = tracks.map(::trackRow)
                val adapter = LibraryAdapter(
                    this,
                    artworkLoader,
                    { client },
                    LibraryPresentation.TRACK_LIST,
                    rows,
                    ::openArtist
                )
                val list = ListView(this).apply {
                    divider = android.graphics.drawable.ColorDrawable(XtColors.divider)
                    dividerHeight = dp(1)
                    setPadding(0, 0, 0, dp(8))
                    clipToPadding = false
                    isVerticalScrollBarEnabled = false
                    this.adapter = adapter
                    onItemClickListener = android.widget.AdapterView.OnItemClickListener { _, _, position, _ ->
                        playTracks(tracks, position)
                    }
                }
                songs.addView(list, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    0,
                    1f
                ))
            }
            body.addView(songs, matchMatch())
        } else {
            val scroll = ScrollView(this).apply {
                isVerticalScrollBarEnabled = false
                setBackgroundColor(XtColors.background)
            }
            val albumContent = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(0, dp(7), 0, dp(28))
            }
            albumContent.addView(sectionHeader("专辑", "${albums.size} 张", null), matchWrap())
            albumContent.addView(
                twoColumnAlbumGrid(albums) { album ->
                    showAlbumDetail(album) {
                        renderArtistDetail(artist, detail, ArtistDetailTab.ALBUMS)
                    }
                },
                matchWrap(top = 8)
            )
            scroll.addView(albumContent, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            body.addView(scroll, matchMatch())
        }
        screen.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContent(screen)
    }

    private fun artistDetailTabs(
        selected: ArtistDetailTab,
        trackCount: Int,
        albumCount: Int,
        onSelect: (ArtistDetailTab) -> Unit
    ): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            ArtistDetailTab.entries.forEach { tab ->
                val active = tab == selected
                val label = when (tab) {
                    ArtistDetailTab.TRACKS -> "歌曲  $trackCount"
                    ArtistDetailTab.ALBUMS -> "专辑  $albumCount"
                }
                val button = TextView(this@MainActivity).apply {
                    text = label
                    styleText(14f, if (active) Color.WHITE else XtColors.muted, active)
                    gravity = Gravity.CENTER
                    background = roundedBackground(
                        if (active) XtColors.primaryStrong else XtColors.surface,
                        dp(17).toFloat()
                    )
                    setOnClickListener { onSelect(tab) }
                }
                addView(button, LinearLayout.LayoutParams(0, dp(42), 1f).apply {
                    if (tab == ArtistDetailTab.TRACKS) marginEnd = dp(5) else marginStart = dp(5)
                })
            }
        }
    }
'''
    value = regex_once(
        value,
        r"    private fun showArtistDetail\(artist: Artist\) \{.*?\n    \}\n\n    private fun showAlbumDetail",
        replacement + "\n    private fun showAlbumDetail",
        "main artist detail tabs"
    )

    value = once(
        value,
        """        val artist = TextView(this).apply {
            text = artistText
            styleText(15f, XtColors.primarySoft, true)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }
""",
        """        val artist = TextView(this).apply {
            styleText(15f, XtColors.primarySoft, true)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
            bindArtistLinks(
                tracks.firstOrNull()?.artists ?: album.artists,
                fallback = artistText,
                onArtistClick = ::openArtist
            )
        }
""",
        "album detail artist links"
    )

    value = once(
        value,
        """    private fun trackCard(track: Track): View {
        val card = mediaCardBase(track.title, track.artistText, track.artworkId, track.guid)
""",
        """    private fun trackCard(track: Track): View {
        val card = mediaCardBase(
            track.title,
            track.artistText,
            track.artworkId,
            track.guid,
            track.artists
        )
""",
        "home track card artists"
    )
    value = once(
        value,
        """        return mediaCardBase(album.name, subtitle, album.coverId, album.guid).apply {
""",
        """        return mediaCardBase(album.name, subtitle, album.coverId, album.guid, album.artists).apply {
""",
        "home album card artists"
    )
    value = once(
        value,
        """        subtitleValue: String,
        coverId: String?,
        seed: String
    ): LinearLayout {
""",
        """        subtitleValue: String,
        coverId: String?,
        seed: String,
        artists: List<ArtistRef> = emptyList()
    ): LinearLayout {
""",
        "media card artists parameter"
    )
    value = once(
        value,
        """        val subtitle = TextView(this).apply {
            text = subtitleValue
            styleText(12f, XtColors.muted)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(2), dp(4), dp(2), 0)
        }
""",
        """        val subtitle = TextView(this).apply {
            styleText(12f, XtColors.muted)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(2), dp(4), dp(2), 0)
            bindArtistLinks(
                artists,
                fallback = subtitleValue,
                onArtistClick = ::openArtist
            )
        }
""",
        "media card artist links"
    )

    value = once(
        value,
        """    private fun twoColumnAlbumGrid(albums: List<Album>, artist: Artist): LinearLayout {
""",
        """    private fun twoColumnAlbumGrid(
        albums: List<Album>,
        onAlbumClick: (Album) -> Unit
    ): LinearLayout {
""",
        "album grid callback signature"
    )
    value = once(
        value,
        """                val card = albumGridCard(album) {
                    showAlbumDetail(album) { showArtistDetail(artist) }
                }
""",
        """                val card = albumGridCard(album) { onAlbumClick(album) }
""",
        "album grid callback body"
    )

    value = once(
        value,
        """            val artist = TextView(this@MainActivity).apply {
                text = track.artistText
                styleText(12f, XtColors.muted)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, dp(4), 0, 0)
            }
""",
        """            val artist = TextView(this@MainActivity).apply {
                styleText(12f, XtColors.muted)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, dp(4), 0, 0)
                bindArtistLinks(
                    track.artists,
                    fallback = track.artistText,
                    onArtistClick = ::openArtist
                )
            }
""",
        "album track row artist links"
    )

    value = once(
        value,
        """        miniSubtitle.text = buildString {
            append(track.artistText).append(" · ").append(track.albumText)
            snapshot.error?.let { append(" · ").append(it) }
        }
""",
        """        miniSubtitle.bindArtistLinks(
            track.artists,
            fallback = track.artistText,
            suffix = buildString {
                append(" · ").append(track.albumText)
                snapshot.error?.let { append(" · ").append(it) }
            },
            onArtistClick = ::openArtist
        )
""",
        "mini player artist links"
    )

    value = once(
        value,
        """    private enum class Destination {
""",
        """    private enum class ArtistDetailTab {
        TRACKS,
        ALBUMS
    }

    private enum class Destination {
""",
        "artist tab enum"
    )
    value = once(
        value,
        """        const val EXTRA_OPEN_ALBUM_GUID = "open_album_guid"
        const val EXTRA_OPEN_ALBUM_NAME = "open_album_name"
""",
        """        const val EXTRA_OPEN_ALBUM_GUID = "open_album_guid"
        const val EXTRA_OPEN_ALBUM_NAME = "open_album_name"
        const val EXTRA_OPEN_ARTIST_GUID = "open_artist_guid"
        const val EXTRA_OPEN_ARTIST_NAME = "open_artist_name"
""",
        "artist intent extras"
    )
    value += f"\n// {MARKER}\n"
    write(path, value)


# Now-playing page: artist link plus a functional queue sheet with item jump playback.
path = "android/app/src/main/java/com/pkxutao/xtmusic/android/NowPlayingActivity.kt"
value = read(path)
if MARKER not in value:
    value = once(
        value,
        """import android.app.Activity
import android.content.Intent
""",
        """import android.app.Activity
import android.app.Dialog
import android.content.Intent
""",
        "now playing dialog import"
    )
    value = once(
        value,
        """import android.graphics.drawable.GradientDrawable
""",
        """import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
""",
        "now playing color drawable import"
    )
    value = once(
        value,
        """import android.widget.LinearLayout
import android.widget.ScrollView
""",
        """import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ScrollView
""",
        "now playing list import"
    )
    value = once(
        value,
        """        val queue = actionButton("≡", compact = true).apply {
            textSize = 22f
            setTextColor(XtColors.muted)
        }
""",
        """        val queue = actionButton("≡", compact = true).apply {
            textSize = 22f
            setTextColor(XtColors.muted)
            contentDescription = "打开播放队列"
            setOnClickListener { showPlaybackQueue() }
        }
""",
        "queue button listener"
    )
    value = once(
        value,
        """        artist.text = track.artistText
        album.text = "${track.albumText}  ›"
""",
        """        artist.bindArtistLinks(
            track.artists,
            fallback = track.artistText,
            onArtistClick = ::openArtist
        )
        album.text = "${track.albumText}  ›"
""",
        "now playing artist links"
    )
    anchor = """    private fun openAlbum() {
"""
    addition = r'''    private fun openArtist(artist: ArtistRef) {
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

''' + anchor
    value = once(value, anchor, addition, "now playing queue sheet")
    value += f"\n// {MARKER}\n"
    write(path, value)


# Unit coverage for queue contents and queue-index jumping.
test_path = ROOT / "android/app/src/test/java/com/pkxutao/xtmusic/android/PlaybackQueueTest.kt"
test_path.parent.mkdir(parents=True, exist_ok=True)
test_path.write_text(r'''package com.pkxutao.xtmusic.android

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackQueueTest {
    private val tracks = listOf(
        Track(guid = "t1", title = "第一首"),
        Track(guid = "t2", title = "第二首"),
        Track(guid = "t3", title = "第三首")
    )

    @After
    fun tearDown() {
        PlaybackQueue.clear()
    }

    @Test
    fun snapshotReturnsQueueAndSelectedIndex() {
        PlaybackQueue.set(tracks, 1)
        val snapshot = PlaybackQueue.snapshot()
        assertEquals(tracks.map { it.guid }, snapshot.tracks.map { it.guid })
        assertEquals(1, snapshot.index)
        assertEquals("t2", PlaybackQueue.current()?.guid)
    }

    @Test
    fun selectJumpsToValidQueueItemAndRejectsInvalidIndex() {
        PlaybackQueue.set(tracks, 0)
        assertEquals("t3", PlaybackQueue.select(2)?.guid)
        assertEquals(2, PlaybackQueue.snapshot().index)
        assertNull(PlaybackQueue.select(9))
        assertEquals(2, PlaybackQueue.snapshot().index)
    }

    @Test
    fun emptyQueueUsesMinusOneIndex() {
        PlaybackQueue.set(emptyList(), 0)
        assertEquals(-1, PlaybackQueue.snapshot().index)
        assertNull(PlaybackQueue.current())
    }
}
''', encoding="utf-8")

print("Applied Android artist navigation, tabs, list playback, and queue fix")
