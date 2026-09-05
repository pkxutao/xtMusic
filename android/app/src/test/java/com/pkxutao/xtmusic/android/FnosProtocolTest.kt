package com.pkxutao.xtmusic.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

class FnosProtocolTest {
    @Test
    fun normalizesFnIdToFnosDomain() {
        val (url, relay) = FnosProtocol.normalizeServer("pkxutao", allowHttp = false)
        assertEquals("https://pkxutao.fnos.net", url)
        assertTrue(relay)
    }

    @Test
    fun removesMusicPathWithoutDuplicatingApiPrefix() {
        val (url, relay) = FnosProtocol.normalizeServer(
            "https://pkxutao.fnos.net/music/",
            allowHttp = false
        )
        assertEquals("https://pkxutao.fnos.net", url)
        assertTrue(relay)
    }

    @Test
    fun rejectsHttpUnlessExplicitlyAllowed() {
        val error = runCatching {
            FnosProtocol.normalizeServer("http://192.168.1.2:5666", allowHttp = false)
        }.exceptionOrNull()
        assertTrue(error is FnosException)
        assertEquals("HTTP_NOT_ALLOWED", (error as FnosException).code)
    }

    @Test
    fun preservesCredentialsOnlyAcrossOfficialHttpsRelayHosts() {
        assertTrue(
            FnosProtocol.isTrustedRedirect(
                URI("https://pkxutao.fnos.net/music/"),
                URI("https://pkxutao.5ddd.com/music/")
            )
        )
        assertFalse(
            FnosProtocol.isTrustedRedirect(
                URI("https://pkxutao.fnos.net/music/"),
                URI("https://example.com/music/")
            )
        )
    }

    @Test
    fun hashesPasswordAsSha256() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            FnosProtocol.hashPassword("abc")
        )
    }
}
