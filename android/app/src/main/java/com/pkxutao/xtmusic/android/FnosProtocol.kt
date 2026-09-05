package com.pkxutao.xtmusic.android

import java.net.URI
import java.security.MessageDigest
import java.util.Locale

class FnosException(
    val code: String,
    override val message: String
) : Exception(message)

object FnosProtocol {
    const val API_PREFIX = "/music/api/v1"

    fun normalizeServer(input: String, allowHttp: Boolean): Pair<String, Boolean> {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) throw FnosException("SERVER_REQUIRED", "请输入服务器地址或 FN ID")

        val explicit = trimmed.startsWith("http://", true) || trimmed.startsWith("https://", true)
        val raw = if (!explicit && isFnId(trimmed)) {
            "https://${trimmed.lowercase(Locale.ROOT)}.fnos.net"
        } else {
            trimmed
        }

        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            throw FnosException("INVALID_URL", "服务器地址格式不正确")
        }
        val scheme = uri.scheme?.lowercase(Locale.ROOT)
        if (scheme != "http" && scheme != "https") {
            throw FnosException("INVALID_URL", "服务器地址仅支持 HTTP 或 HTTPS")
        }
        if (scheme == "http" && !allowHttp) {
            throw FnosException("HTTP_NOT_ALLOWED", "请先启用“允许 HTTP 直连”")
        }
        val host = uri.host?.lowercase(Locale.ROOT)
            ?: throw FnosException("INVALID_URL", "服务器地址缺少主机名")
        var path = uri.path.orEmpty().replace(Regex("/{2,}"), "/")
        path = path.replace(Regex("/music/api/v1(?:/.*)?$", RegexOption.IGNORE_CASE), "")
        path = path.replace(Regex("/music/?$", RegexOption.IGNORE_CASE), "")
        path = path.trimEnd('/')

        val authority = buildString {
            append(host)
            if (uri.port >= 0) append(':').append(uri.port)
        }
        val normalized = "$scheme://$authority${if (path.isBlank()) "" else path}"
        return normalized.trimEnd('/') to isOfficialRelayHost(host)
    }

    fun isFnId(value: String): Boolean {
        val id = value.trim()
        return id.length in 1..63 &&
            Regex("^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$").matches(id)
    }

    fun isOfficialRelayHost(host: String?): Boolean {
        val value = host.orEmpty().lowercase(Locale.ROOT)
        return value == "fnos.net" || value.endsWith(".fnos.net") ||
            value == "5ddd.com" || value.endsWith(".5ddd.com")
    }

    fun isTrustedRedirect(from: URI, to: URI): Boolean {
        if (from.scheme.equals(to.scheme, true) &&
            from.host.equals(to.host, true) &&
            effectivePort(from) == effectivePort(to)
        ) {
            return true
        }
        return from.scheme.equals("https", true) &&
            to.scheme.equals("https", true) &&
            isOfficialRelayHost(from.host) &&
            isOfficialRelayHost(to.host)
    }

    fun hashPassword(password: String): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(password.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    private fun effectivePort(uri: URI): Int {
        if (uri.port >= 0) return uri.port
        return if (uri.scheme.equals("https", true)) 443 else 80
    }
}
