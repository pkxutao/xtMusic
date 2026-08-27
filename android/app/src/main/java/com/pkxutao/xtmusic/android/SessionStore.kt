package com.pkxutao.xtmusic.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("xtmusic_secure_session", Context.MODE_PRIVATE)

    fun save(session: MusicSession) {
        val payload = JSONObject()
            .put("serverUrl", session.serverUrl)
            .put("token", session.token)
            .put("relayMode", session.relayMode)
            .put("accessCode", session.accessCode)
            .put("allowHttp", session.allowHttp)
            .put("allowSelfSigned", session.allowSelfSigned)
            .put("deviceId", session.deviceId)
            .put("username", session.username)
            .toString()
            .toByteArray(Charsets.UTF_8)

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        preferences.edit()
            .putString("ciphertext", Base64.getEncoder().encodeToString(cipher.doFinal(payload)))
            .putString("iv", Base64.getEncoder().encodeToString(cipher.iv))
            .apply()
    }

    fun load(): MusicSession? {
        val ciphertext = preferences.getString("ciphertext", null) ?: return null
        val iv = preferences.getString("iv", null) ?: return null
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(),
                GCMParameterSpec(128, Base64.getDecoder().decode(iv))
            )
            val json = JSONObject(
                String(
                    cipher.doFinal(Base64.getDecoder().decode(ciphertext)),
                    Charsets.UTF_8
                )
            )
            MusicSession(
                serverUrl = json.getString("serverUrl"),
                token = json.getString("token"),
                relayMode = json.optBoolean("relayMode"),
                accessCode = json.optString("accessCode"),
                allowHttp = json.optBoolean("allowHttp"),
                allowSelfSigned = json.optBoolean("allowSelfSigned"),
                deviceId = json.getString("deviceId"),
                username = json.optString("username")
            )
        } catch (_: Exception) {
            clear()
            null
        }
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build()
                )
            }
            .generateKey()
    }

    companion object {
        private const val KEY_ALIAS = "xtmusic_android_session_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
