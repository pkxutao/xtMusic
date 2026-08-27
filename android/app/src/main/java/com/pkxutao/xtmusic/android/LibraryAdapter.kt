package com.pkxutao.xtmusic.android

import android.content.Context
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
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

class LibraryAdapter(
    private val context: Context,
    private var rows: List<LibraryRow> = emptyList()
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
        val holder: Holder
        val rowView: LinearLayout
        if (convertView is LinearLayout && convertView.tag is Holder) {
            rowView = convertView
            holder = convertView.tag as Holder
        } else {
            rowView = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = context.dp(72)
                setPadding(
                    context.dp(16),
                    context.dp(9),
                    context.dp(12),
                    context.dp(9)
                )
                background = roundedBackground(XtColors.background, context.dp(12).toFloat())
            }
            val index = TextView(context).apply {
                styleText(13f, XtColors.muted)
                gravity = Gravity.CENTER
            }
            val copy = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(context.dp(10), 0, context.dp(8), 0)
            }
            val title = TextView(context).apply {
                styleText(16f, XtColors.text, true)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val subtitle = TextView(context).apply {
                styleText(13f, XtColors.muted)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val trailing = TextView(context).apply {
                styleText(13f, XtColors.muted)
                gravity = Gravity.CENTER_VERTICAL or Gravity.END
            }
            copy.addView(title)
            copy.addView(subtitle)
            rowView.addView(index, LinearLayout.LayoutParams(context.dp(38), context.dp(52)))
            rowView.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            rowView.addView(trailing, LinearLayout.LayoutParams(context.dp(58), ViewGroup.LayoutParams.MATCH_PARENT))
            holder = Holder(index, title, subtitle, trailing)
            rowView.tag = holder
        }

        holder.index.text = (position + 1).toString().padStart(2, '0')
        when (val row = rows[position]) {
            is LibraryRow.TrackRow -> {
                holder.title.text = row.track.title
                holder.subtitle.text = "${row.track.artistText} · ${row.track.albumText}"
                holder.trailing.text = formatDuration(row.track.durationSeconds)
            }
            is LibraryRow.AlbumRow -> {
                holder.title.text = row.album.name
                holder.subtitle.text = if (row.album.trackCount > 0) {
                    "${row.album.trackCount} 首歌曲"
                } else {
                    "专辑"
                }
                holder.trailing.text = "›"
            }
            is LibraryRow.ArtistRow -> {
                holder.title.text = row.artist.name
                holder.subtitle.text = buildString {
                    if (row.artist.albumCount > 0) append("${row.artist.albumCount} 张专辑")
                    if (row.artist.albumCount > 0 && row.artist.trackCount > 0) append(" · ")
                    if (row.artist.trackCount > 0) append("${row.artist.trackCount} 首歌曲")
                    if (isEmpty()) append("歌手")
                }
                holder.trailing.text = "›"
            }
        }
        return rowView
    }

    private data class Holder(
        val index: TextView,
        val title: TextView,
        val subtitle: TextView,
        val trailing: TextView
    )

    private fun formatDuration(seconds: Long): String {
        if (seconds <= 0) return ""
        return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
    }
}
