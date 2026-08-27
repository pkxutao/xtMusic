package com.pkxutao.xtmusic.android

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.Base64
import java.util.UUID
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class FnosClient(private var session: MusicSession) {
    fun session(): MusicSession = session

    fun login(username: String, password: String): MusicSession {
        val payload = requestJson(
            path = "/user/password-login",
            method = "POST",
            authenticated = false,
            body = JSONObject()
                .put("username", username.trim())
                .put("password", FnosProtocol.hashPassword(password))
                .put("deviceId", session.deviceId)
        )
        val data = assertSuccess(payload, "登录失败")
        val token = data.optString("userToken")
        if (token.isBlank()) {
            throw FnosException("LOGIN_INVALID_RESPONSE", "服务器登录响应中没有会话令牌")
        }
        val user = data.optJSONObject("user")
        session = session.copy(
            token = token,
            username = user?.optString("name")?.ifBlank { username.trim() } ?: username.trim()
        )
        return session
    }

    fun getTracks(page: Int = 1, size: Int = 100): Page<Track> =
        page("/track/list", page, size, ::parseTrack)

    fun getAlbums(page: Int = 1, size: Int = 48): Page<Album> =
        page("/album/list", page, size, ::parseAlbum)

    fun getArtists(page: Int = 1, size: Int = 48): Page<Artist> =
        page("/artist/list", page, size, ::parseArtist)

    fun getFavorites(page: Int = 1, size: Int = 100): Page<Track> =
        page("/favorite-track/list", page, size, ::parseTrack)

    fun getHistory(page: Int = 1, size: Int = 100): Page<Track> =
        page("/play-history/list", page, size, ::parseTrack)

    fun getAlbumTracks(albumGuid: String, page: Int = 1, size: Int = 200): Page<Track> =
        page(
            "/track/album-detail/list",
            page,
            size,
            ::parseTrack,
            mapOf("albumGUID" to albumGuid)
        )

    fun getArtistAlbums(artistGuid: String): List<Album> {
        val pageSize = 400
        val first = page(
            "/track/artist-detail/list",
            1,
            pageSize,
            ::parseTrack,
            mapOf("artistGUID" to artistGuid)
        )
        val tracks = first.list.toMutableList()
        val pages = ((first.total + pageSize - 1) / pageSize).coerceAtMost(30)
        for (page in 2..pages) {
            tracks += page(
                "/track/artist-detail/list",
                page,
                pageSize,
                ::parseTrack,
                mapOf("artistGUID" to artistGuid)
            ).list
        }
        return tracks
            .mapNotNull { it.album }
            .groupBy { it.guid }
            .map { (_, values) ->
                val firstAlbum = values.first()
                Album(
                    guid = firstAlbum.guid,
                    name = firstAlbum.name,
                    coverId = firstAlbum.coverId,
                    trackCount = values.size
                )
            }
            .sortedBy { it.name.lowercase() }
    }

    fun searchTracks(query: String, page: Int = 1, size: Int = 100): Page<Track> {
        val q = query.trim()
        if (q.isEmpty()) return Page(emptyList(), 0, page, size)
        return page(
            "/search/track",
            page,
            size,
            ::parseTrack,
            mapOf("q" to q, "keyword" to q)
        )
    }

    fun getLyrics(trackGuid: String): String {
        val payload = requestJson(
            path = "/lyric/list",
            query = mapOf("trackGUID" to trackGuid)
        )
        val data = assertSuccess(payload, "获取歌词失败")
        val list = data.optJSONArray("list") ?: JSONArray()
        val preferredGuid = data.optString("preferred")
        var selected: JSONObject? = null
        for (index in 0 until list.length()) {
            val item = list.optJSONObject(index) ?: continue
            if (selected == null) selected = item
            if (preferredGuid.isNotBlank() && item.optString("guid") == preferredGuid) {
                selected = item
                break
            }
        }
        return selected?.optString("content").orEmpty()
    }

    fun favorite(trackGuid: String) {
        mutation("/favorite-track/create", JSONObject().put("trackGUID", trackGuid), "收藏失败")
    }

    fun unfavorite(trackGuid: String) {
        mutation("/favorite-track/delete", JSONObject().put("trackGUID", trackGuid), "取消收藏失败")
    }

    fun reportPlay(trackGuid: String) {
        try {
            val event = JSONObject()
                .put("eventType", "track_play")
                .put("occurredAt", System.currentTimeMillis())
                .put("payload", JSONObject().put("trackGUID", trackGuid))
            requestJson(
                path = "/event/report",
                method = "POST",
                body = JSONObject().put("events", JSONArray().put(event))
            )
        } catch (_: Exception) {
            // Best effort and sent only to the user's NAS.
        }
    }

    fun streamUrl(trackGuid: String): String =
        apiUrl("/track/stream") + "?guid=" + encode(trackGuid)

    fun coverUrl(coverId: String, size: Int = 600): String =
        apiUrl("/static/cover") + "?coverId=" + encode(coverId) +
            "&size=" + size.coerceIn(48, 1600)

    fun resourceHeaders(): Map<String, String> = authHeaders()

    private fun <T> page(
        path: String,
        page: Int,
        size: Int,
        parser: (JSONObject) -> T?,
        extra: Map<String, String> = emptyMap()
    ): Page<T> {
        val query = linkedMapOf(
            "page" to page.coerceAtLeast(1).toString(),
            "size" to size.coerceIn(1, 500).toString()
        ).apply { putAll(extra) }
        val payload = requestJson(path = path, query = query)
        val data = assertSuccess(payload, "加载数据失败")
        val array = data.optJSONArray("list") ?: JSONArray()
        val list = buildList {
            for (index in 0 until array.length()) {
                parser(array.optJSONObject(index) ?: continue)?.let(::add)
            }
        }
        return Page(
            list = list,
            total = data.optInt("total", list.size),
            page = page,
            size = size
        )
    }

    private fun mutation(path: String, body: JSONObject, fallback: String) {
        assertSuccess(requestJson(path, "POST", body = body), fallback)
    }

    private fun requestJson(
        path: String,
        method: String = "GET",
        authenticated: Boolean = true,
        body: JSONObject? = null,
        query: Map<String, String> = emptyMap()
    ): JSONObject {
        val queryString = query.entries.joinToString("&") {
            "${encode(it.key)}=${encode(it.value)}"
        }
        val initial = apiUrl(path) + if (queryString.isBlank()) "" else "?$queryString"
        var current = URI(initial)
        var currentMethod = method
        var currentBody = body?.toString()?.toByteArray(Charsets.UTF_8)
        var headers = if (authenticated) authHeaders() else preAuthHeaders()

        repeat(6) { redirectDepth ->
            val connection = open(current.toURL())
            connection.instanceFollowRedirects = false
            connection.requestMethod = currentMethod
            connection.connectTimeout = 12_000
            connection.readTimeout = 25_000
            connection.setRequestProperty("Accept", "application/json, */*")
            connection.setRequestProperty("User-Agent", "XT-Music-Android/0.1.0-alpha02")
            for ((name, value) in headers) connection.setRequestProperty(name, value)
            if (currentBody != null && currentMethod != "GET") {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setFixedLengthStreamingMode(currentBody!!.size)
                BufferedOutputStream(connection.outputStream).use { it.write(currentBody) }
            }

            val status = connection.responseCode
            val location = connection.getHeaderField("Location")
            if (status in 300..399 && !location.isNullOrBlank()) {
                if (redirectDepth >= 5) {
                    connection.disconnect()
                    throw FnosException("TOO_MANY_REDIRECTS", "服务器重定向次数过多")
                }
                val next = current.resolve(location)
                if (current.scheme.equals("https", true) &&
                    next.scheme.equals("http", true) &&
                    !session.allowHttp
                ) {
                    connection.disconnect()
                    throw FnosException("INSECURE_REDIRECT", "服务器尝试把 HTTPS 降级为 HTTP，已阻止")
                }
                if (!FnosProtocol.isTrustedRedirect(current, next)) {
                    headers = headers.filterKeys {
                        it.lowercase() !in setOf(
                            "cookie",
                            "authorization",
                            "x-access-code",
                            "x-access-source"
                        )
                    }
                }
                if (status == HttpURLConnection.HTTP_SEE_OTHER) {
                    currentMethod = "GET"
                    currentBody = null
                }
                connection.inputStream?.close()
                connection.disconnect()
                current = next
                return@repeat
            }

            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val text = stream?.let { input ->
                BufferedInputStream(input).use { buffered ->
                    buffered.readBytesLimited(8 * 1024 * 1024).toString(Charsets.UTF_8)
                }
            }.orEmpty().trimStart('\uFEFF')
            connection.disconnect()

            if (status == HttpURLConnection.HTTP_UNAUTHORIZED) {
                throw FnosException("SESSION_EXPIRED", "登录状态已失效，请重新登录")
            }
            if (status >= 500) {
                throw FnosException("SERVER_ERROR", "飞牛音乐服务暂时不可用（HTTP $status）")
            }
            return if (text.isBlank()) JSONObject() else try {
                JSONObject(text)
            } catch (_: Exception) {
                throw FnosException("INVALID_JSON", "服务器返回了无法解析的数据（HTTP $status）")
            }
        }
        throw FnosException("TOO_MANY_REDIRECTS", "服务器重定向次数过多")
    }

    private fun open(url: URL): HttpURLConnection {
        val connection = url.openConnection() as HttpURLConnection
        if (connection is HttpsURLConnection && session.allowSelfSigned) {
            connection.sslSocketFactory = insecureSslContext.socketFactory
            connection.hostnameVerifier = HostnameVerifier { _, _ -> true }
        }
        return connection
    }

    private fun apiUrl(path: String): String {
        val clean = if (path.startsWith('/')) path else "/$path"
        return session.serverUrl.trimEnd('/') + FnosProtocol.API_PREFIX + clean
    }

    private fun preAuthHeaders(): Map<String, String> {
        val result = linkedMapOf<String, String>()
        if (session.relayMode) result["Cookie"] = "mode=relay"
        accessHeaders().forEach(result::put)
        return result
    }

    private fun authHeaders(): Map<String, String> {
        val cookies = mutableListOf<String>()
        if (session.token.isNotBlank()) cookies += "music-token=${session.token}"
        if (session.relayMode) cookies += "mode=relay"
        val result = linkedMapOf<String, String>()
        if (cookies.isNotEmpty()) result["Cookie"] = cookies.joinToString("; ")
        accessHeaders().forEach(result::put)
        return result
    }

    private fun accessHeaders(): Map<String, String> {
        if (session.accessCode.isBlank()) return emptyMap()
        return mapOf(
            "x-access-code" to Base64.getEncoder()
                .encodeToString(session.accessCode.toByteArray(Charsets.UTF_8)),
            "x-access-source" to "app"
        )
    }

    private fun assertSuccess(payload: JSONObject, fallback: String): JSONObject {
        val code = payload.optInt("code", -1)
        if (code == 0) return payload.optJSONObject("data") ?: JSONObject()
        val message = payload.optString("msg").ifBlank { fallback }
        when {
            code == 120001 -> throw FnosException("INVALID_CREDENTIALS", "用户名或密码错误，请重试")
            code == 401 || message.contains("invalid token", true) ->
                throw FnosException("SESSION_EXPIRED", "登录状态已失效，请重新登录")
            else -> throw FnosException("API_ERROR", message)
        }
    }

    private fun parseTrack(value: JSONObject): Track? {
        val guid = value.stringValue("guid", "trackGUID", "trackGuid") ?: return null
        val title = value.stringValue("title", "name") ?: "未知歌曲"
        val albumObject = value.optJSONObject("album")
        val albumGuid = albumObject?.stringValue("guid")
            ?: value.stringValue("albumGUID", "albumGuid")
        val albumName = albumObject?.stringValue("name")
            ?: value.stringValue("albumName")
            ?: "未知专辑"
        val album = albumGuid?.let {
            AlbumRef(
                guid = it,
                name = albumName,
                coverId = albumObject?.stringValue("coverId")
                    ?: value.stringValue("coverId")
            )
        }
        val artists = parseArtists(value)
        var duration = value.optLong("duration", 0)
        if (duration > 86_400L * 10) duration /= 1000
        val audioSpec = value.optJSONObject("audioSpec")
        return Track(
            guid = guid,
            title = title,
            artists = artists,
            album = album,
            coverId = value.stringValue("coverId") ?: album?.coverId,
            durationSeconds = duration,
            format = audioSpec?.stringValue("format", "codec")
                ?: value.stringValue("format", "codec"),
            favorite = value.optBoolean("isFavorite", value.optBoolean("favorite", false))
        )
    }

    private fun parseAlbum(value: JSONObject): Album? {
        val guid = value.stringValue("guid", "albumGUID", "albumGuid") ?: return null
        return Album(
            guid = guid,
            name = value.stringValue("name", "title") ?: "未知专辑",
            coverId = value.stringValue("coverId"),
            trackCount = value.optInt("trackCount", value.optInt("count", 0))
        )
    }

    private fun parseArtist(value: JSONObject): Artist? {
        val guid = value.stringValue("guid", "artistGUID", "artistGuid") ?: return null
        return Artist(
            guid = guid,
            name = value.stringValue("name", "title") ?: "未知歌手",
            coverId = value.stringValue("coverId"),
            trackCount = value.optInt("trackCount", 0),
            albumCount = value.optInt("albumCount", 0)
        )
    }

    private fun parseArtists(value: JSONObject): List<ArtistRef> {
        val array = value.optJSONArray("artists")
            ?: value.optJSONArray("artist")
            ?: JSONArray()
        val list = mutableListOf<ArtistRef>()
        for (index in 0 until array.length()) {
            when (val item = array.opt(index)) {
                is JSONObject -> {
                    val name = item.stringValue("name", "title") ?: continue
                    list += ArtistRef(item.stringValue("guid") ?: name, name)
                }
                is String -> list += ArtistRef(item, item)
            }
        }
        if (list.isEmpty()) {
            value.stringValue("artistName", "artist")?.let {
                list += ArtistRef(it, it)
            }
        }
        return list
    }

    companion object {
        fun createUnauthenticated(
            serverInput: String,
            accessCode: String,
            allowHttp: Boolean,
            allowSelfSigned: Boolean
        ): FnosClient {
            val (server, relayMode) = FnosProtocol.normalizeServer(serverInput, allowHttp)
            return FnosClient(
                MusicSession(
                    serverUrl = server,
                    token = "",
                    relayMode = relayMode,
                    accessCode = accessCode.trim(),
                    allowHttp = allowHttp,
                    allowSelfSigned = allowSelfSigned,
                    deviceId = UUID.randomUUID().toString().replace("-", ""),
                    username = ""
                )
            )
        }

        private val insecureSslContext: SSLContext by lazy {
            val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
                override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
                override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
            })
            SSLContext.getInstance("TLS").apply {
                init(null, trustAll, SecureRandom())
            }
        }

        private fun encode(value: String): String =
            java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    }
}

private fun JSONObject.stringValue(vararg names: String): String? {
    for (name in names) {
        val raw = opt(name)
        if (raw != null && raw != JSONObject.NULL) {
            val value = raw.toString().trim()
            if (value.isNotEmpty()) return value
        }
    }
    return null
}

private fun BufferedInputStream.readBytesLimited(maxBytes: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    var total = 0
    while (true) {
        val count = read(buffer)
        if (count < 0) break
        total += count
        if (total > maxBytes) throw FnosException("RESPONSE_TOO_LARGE", "服务器响应过大")
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}
