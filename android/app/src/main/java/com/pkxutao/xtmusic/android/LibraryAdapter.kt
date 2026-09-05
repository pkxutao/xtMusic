package com.pkxutao.xtmusic.android

import android.content.Context
import android.graphics.Color
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

sealed interface LibraryRow {
    val stableId: String

    data class TrackRow(val track: Track) : LibraryRow {
        override val stableId: String get() = "track:${track.guid}"
    }

    data class AlbumRow(val album: Album) : LibraryRow {
        override val stableId: String get() = "album:${album.guid}"
    }

    data class ArtistRow(val artist: Artist) : LibraryRow {
        override val stableId: String get() = "artist:${artist.guid}"
    }
}

enum class LibraryPresentation {
    TRACK_LIST,
    MEDIA_GRID
}

class LibraryAdapter(
    private val context: Context,
    private val artworkLoader: ArtworkLoader,
    private val clientProvider: () -> FnosClient?,
    private val presentation: LibraryPresentation,
    private var rows: List<LibraryRow> = emptyList(),
    private val onArtistClick: ((ArtistRef) -> Unit)? = null
) : BaseAdapter() {
    fun submit(newRows: List<LibraryRow>) {
        rows = newRows
        notifyDataSetChanged()
    }

    fun itemAt(position: Int): LibraryRow? = rows.getOrNull(position)

    override fun getCount(): Int = rows.size
    override fun getItem(position: Int): LibraryRow = rows[position]
    override fun getItemId(position: Int): Long = rows[position].stableId.hashCode().toLong()
    override fun hasStableIds(): Boolean = true

    override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
        return when (presentation) {
            LibraryPresentation.TRACK_LIST -> trackView(position, convertView)
            LibraryPresentation.MEDIA_GRID -> mediaGridView(position, convertView)
        }
    }

    private fun trackView(position: Int, convertView: View?): View {
        val root: LinearLayout
        val holder: TrackHolder
        if (convertView is LinearLayout && convertView.tag is TrackHolder) {
            root = convertView
            holder = convertView.tag as TrackHolder
        } else {
            root = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = context.dp(78)
                setPadding(context.dp(8), context.dp(7), context.dp(8), context.dp(7))
                background = roundedBackground(XtColors.background, context.dp(14).toFloat())
            }
            val artworkFrame = FrameLayout(context).apply {
                background = roundedBackground(XtColors.surfaceRaised, context.dp(12).toFloat())
                roundedOutline(context.dp(12).toFloat())
            }
            val artwork = ImageView(context)
            val fallback = TextView(context).apply {
                text = "♫"
                gravity = Gravity.CENTER
                styleText(22f, colorWithAlpha(XtColors.text, 180), true)
            }
            artworkFrame.addView(fallback, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
            artworkFrame.addView(artwork, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))

            val copy = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(context.dp(12), 0, context.dp(8), 0)
            }
            val title = TextView(context).apply {
                styleText(16f, XtColors.text, true)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            }
            val artist = TextView(context).apply {
                styleText(13f, XtColors.textSecondary)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, context.dp(4), 0, 0)
            }
            val album = TextView(context).apply {
                styleText(12f, XtColors.muted)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, context.dp(2), 0, 0)
            }
            copy.addView(title)
            copy.addView(artist)
            copy.addView(album)

            val trailing = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER or Gravity.END
            }
            val duration = TextView(context).apply {
                styleText(12f, XtColors.muted)
                gravity = Gravity.END
            }
            val menu = TextView(context).apply {
                text = "⋮"
                styleText(22f, XtColors.muted)
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
            }
            trailing.addView(duration, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            ))
            trailing.addView(menu, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            ))

            root.addView(artworkFrame, LinearLayout.LayoutParams(context.dp(58), context.dp(58)))
            root.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
            root.addView(trailing, LinearLayout.LayoutParams(context.dp(42), ViewGroup.LayoutParams.MATCH_PARENT))
            holder = TrackHolder(artwork, fallback, title, artist, album, duration)
            root.tag = holder
        }

        val track = (rows[position] as? LibraryRow.TrackRow)?.track
        if (track == null) return root
        holder.title.text = track.title
        holder.artist.bindArtistLinks(
            track.artists,
            fallback = track.artistText,
            onArtistClick = onArtistClick
        )
        holder.album.text = track.albumText
        holder.duration.text = formatDuration(track.durationSeconds)
        holder.fallback.visibility = View.VISIBLE
        artworkLoader.load(
            holder.artwork,
            clientProvider(),
            track.artworkId,
            context.dp(180),
            track.guid
        )
        return root
    }

    private fun mediaGridView(position: Int, convertView: View?): View {
        val root: LinearLayout
        val holder: MediaHolder
        if (convertView is LinearLayout && convertView.tag is MediaHolder) {
            root = convertView
            holder = convertView.tag as MediaHolder
        } else {
            root = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(context.dp(5), context.dp(5), context.dp(5), context.dp(10))
                background = roundedBackground(XtColors.background, context.dp(16).toFloat())
                layoutParams = android.widget.AbsListView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    context.dp(242)
                )
            }
            val artworkFrame = FrameLayout(context).apply {
                background = roundedBackground(XtColors.surfaceRaised, context.dp(18).toFloat())
                roundedOutline(context.dp(18).toFloat())
            }
            val artwork = ImageView(context)
            val fallback = TextView(context).apply {
                text = "♫"
                gravity = Gravity.CENTER
                styleText(42f, colorWithAlpha(XtColors.text, 170), true)
            }
            val play = TextView(context).apply {
                text = "▶"
                gravity = Gravity.CENTER
                styleText(15f, Color.WHITE, true)
                background = roundedBackground(colorWithAlpha(Color.BLACK, 170), context.dp(22).toFloat())
            }
            artworkFrame.addView(fallback, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
            artworkFrame.addView(artwork, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
            artworkFrame.addView(play, FrameLayout.LayoutParams(
                context.dp(40),
                context.dp(40),
                Gravity.END or Gravity.BOTTOM
            ).apply {
                marginEnd = context.dp(8)
                bottomMargin = context.dp(8)
            })

            val title = TextView(context).apply {
                styleText(15f, XtColors.text, true)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(context.dp(2), context.dp(10), context.dp(2), 0)
            }
            val subtitle = TextView(context).apply {
                styleText(12f, XtColors.muted)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(context.dp(2), context.dp(4), context.dp(2), 0)
            }
            root.addView(artworkFrame, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                context.dp(178)
            ))
            root.addView(title, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ))
            root.addView(subtitle, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ))
            holder = MediaHolder(artworkFrame, artwork, fallback, title, subtitle)
            root.tag = holder
        }

        when (val row = rows[position]) {
            is LibraryRow.AlbumRow -> {
                holder.artworkFrame.roundedOutline(context.dp(18).toFloat())
                holder.title.text = row.album.name
                val prefix = row.album.releaseYear?.let { "$it · " }.orEmpty()
                val fallback = if (row.album.trackCount > 0) "${row.album.trackCount} 首歌曲" else "专辑"
                holder.subtitle.bindArtistLinks(
                    row.album.artists,
                    fallback = fallback,
                    prefix = prefix,
                    onArtistClick = onArtistClick
                )
                artworkLoader.load(
                    holder.artwork,
                    clientProvider(),
                    row.album.coverId,
                    context.dp(480),
                    row.album.guid
                )
            }
            is LibraryRow.ArtistRow -> {
                holder.artworkFrame.circleOutline()
                holder.title.text = row.artist.name
                holder.subtitle.text = buildString {
                    if (row.artist.albumCount > 0) append("${row.artist.albumCount} 张专辑")
                    if (row.artist.albumCount > 0 && row.artist.trackCount > 0) append(" · ")
                    if (row.artist.trackCount > 0) append("${row.artist.trackCount} 首歌曲")
                    if (isEmpty()) append("歌手")
                }
                artworkLoader.load(
                    holder.artwork,
                    clientProvider(),
                    row.artist.coverId,
                    context.dp(480),
                    row.artist.guid
                )
            }
            is LibraryRow.TrackRow -> {
                holder.artworkFrame.roundedOutline(context.dp(18).toFloat())
                holder.title.text = row.track.title
                holder.subtitle.text = row.track.artistText
                artworkLoader.load(
                    holder.artwork,
                    clientProvider(),
                    row.track.artworkId,
                    context.dp(480),
                    row.track.guid
                )
            }
        }
        return root
    }

    private data class TrackHolder(
        val artwork: ImageView,
        val fallback: TextView,
        val title: TextView,
        val artist: TextView,
        val album: TextView,
        val duration: TextView
    )

    private data class MediaHolder(
        val artworkFrame: FrameLayout,
        val artwork: ImageView,
        val fallback: TextView,
        val title: TextView,
        val subtitle: TextView
    )

    private fun formatDuration(seconds: Long): String {
        if (seconds <= 0) return ""
        return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    }
}

// XT_ANDROID_ARTIST_TABS_QUEUE_20260901
