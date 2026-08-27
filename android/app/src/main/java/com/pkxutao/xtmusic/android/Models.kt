package com.pkxutao.xtmusic.android

data class ArtistRef(
    val guid: String,
    val name: String
)

data class AlbumRef(
    val guid: String,
    val name: String,
    val coverId: String? = null
)

data class Track(
    val guid: String,
    val title: String,
    val artists: List<ArtistRef> = emptyList(),
    val album: AlbumRef? = null,
    val coverId: String? = null,
    val durationSeconds: Long = 0,
    val format: String? = null,
    val favorite: Boolean = false
) {
    val artistText: String
        get() = artists.map { it.name }.filter { it.isNotBlank() }.joinToString("、")
            .ifBlank { "未知歌手" }

    val albumText: String
        get() = album?.name?.takeIf { it.isNotBlank() } ?: "未知专辑"
}

data class Album(
    val guid: String,
    val name: String,
    val coverId: String? = null,
    val trackCount: Int = 0
)

data class Artist(
    val guid: String,
    val name: String,
    val coverId: String? = null,
    val trackCount: Int = 0,
    val albumCount: Int = 0
)

data class Page<T>(
    val list: List<T>,
    val total: Int,
    val page: Int,
    val size: Int
)

data class MusicSession(
    val serverUrl: String,
    val token: String,
    val relayMode: Boolean,
    val accessCode: String,
    val allowHttp: Boolean,
    val allowSelfSigned: Boolean,
    val deviceId: String,
    val username: String
)
