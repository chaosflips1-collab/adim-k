package com.adimkasasi.pro.steptracker

import android.util.Base64
import org.json.JSONObject

/**
 * Minimal JWT payload reader — no signature verification (the server is the source of
 * truth for validity; here we only need the `id` claim to namespace per-user step counters
 * so steps never get mixed across accounts on the same device).
 */
object JwtUtils {

    fun getUserId(token: String): String? {
        return try {
            val parts = token.split(".")
            if (parts.size < 2) return null
            val payloadBytes = Base64.decode(
                parts[1],
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
            )
            val json = JSONObject(String(payloadBytes, Charsets.UTF_8))
            when {
                json.has("id") -> json.get("id").toString()
                json.has("_id") -> json.get("_id").toString()
                json.has("userId") -> json.get("userId").toString()
                else -> null
            }
        } catch (e: Exception) {
            null
        }
    }
}
