package com.adimkasasi.pro.steptracker

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted, process-wide store for the cached auth token, the service "running" flag,
 * and the per-user pending (not-yet-synced-to-server) step count used by [StepTrackerService].
 *
 * Backed by [EncryptedSharedPreferences] so the JWT never sits in plaintext on disk.
 * The underlying [SharedPreferences] instance is built once (Keystore init isn't free)
 * and reused for the lifetime of the process by both the Capacitor plugin and the service.
 */
object SecureStore {

    private const val PREFS_NAME = "step_tracker_secure_prefs"
    private const val KEY_TOKEN = "auth_token"
    private const val KEY_RUNNING = "service_running"
    private const val KEY_BATTERY_OPT_ASKED = "battery_opt_asked"
    private const val PENDING_DELTA_PREFIX = "pending_delta_"

    @Volatile
    private var prefs: SharedPreferences? = null

    private fun get(context: Context): SharedPreferences {
        return prefs ?: synchronized(this) {
            prefs ?: build(context.applicationContext).also { prefs = it }
        }
    }

    // Bug-fix (crash on every launch after reinstall/device restore): the manifest has
    // allowBackup="true", so Android's auto backup can restore this file's raw bytes
    // (previous install, new device, etc.) while the AndroidKeystore master key that
    // encrypted it is hardware-bound and never comes along - keys and file are backed
    // up/restored independently. The restored file's Tink keyset then fails to decrypt
    // against the (new) local key with AEADBadTagException, and every SecureStore call
    // (e.g. saveToken right after login) crashes the app immediately. Recovered by
    // wiping the corrupt file and creating a fresh one on the first failure - this only
    // loses the cached token/pending step count, which the app already tolerates (it
    // just asks the user to log in again / catches up on the next sync).
    private fun build(context: Context): SharedPreferences {
        return try {
            createEncryptedPrefs(context)
        } catch (e: Exception) {
            context.deleteSharedPreferences(PREFS_NAME)
            createEncryptedPrefs(context)
        }
    }

    private fun createEncryptedPrefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun saveToken(context: Context, token: String) {
        get(context).edit().putString(KEY_TOKEN, token).apply()
    }

    fun getToken(context: Context): String? = get(context).getString(KEY_TOKEN, null)

    fun setRunning(context: Context, running: Boolean) {
        get(context).edit().putBoolean(KEY_RUNNING, running).apply()
    }

    fun isRunning(context: Context): Boolean = get(context).getBoolean(KEY_RUNNING, false)

    // Bug-fix target: HyperOS/MIUI kills the foreground service anyway unless the app is
    // whitelisted from battery optimization. We ask the user once (system dialog via
    // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) the first time tracking is enabled and
    // remember that we asked, so a dismissal doesn't turn into a nag on every app launch -
    // PowerManager.isIgnoringBatteryOptimizations() itself is checked live each time
    // (not cached here) since the user can change it from system Settings independently.
    fun hasAskedBatteryOptimization(context: Context): Boolean =
        get(context).getBoolean(KEY_BATTERY_OPT_ASKED, false)

    fun setAskedBatteryOptimization(context: Context, asked: Boolean) {
        get(context).edit().putBoolean(KEY_BATTERY_OPT_ASKED, asked).apply()
    }

    fun getPendingDelta(context: Context, userId: String): Long =
        get(context).getLong(PENDING_DELTA_PREFIX + userId, 0L)

    // Bug-fix: onSensorChanged (main thread) incrementing pendingDelta and the sync
    // loop (background coroutine) decrementing it after a successful chunk POST were
    // both doing an unsynchronized read-modify-write against the same persisted key.
    // If a sensor event landed while a chunk POST was in flight (a real window - chunk
    // POSTs are network calls, not instant), the sync loop's decrement wrote back a
    // value computed from a now-stale snapshot and silently overwrote/lost the
    // concurrent increment - a classic lost-update race. Both operations now go
    // through this single lock and always re-read the CURRENT persisted value inside
    // it, so neither can ever clobber the other's write.
    private val pendingDeltaLock = Any()

    /**
     * Atomically adds [amount] (normally 1, one per TYPE_STEP_DETECTOR event - see
     * StepTrackerService) to the persisted pendingDelta. Returns the new pendingDelta.
     *
     * Replaces the old TYPE_STEP_COUNTER-era `applySensorReading(context, userId,
     * newCumulative)`, which diffed a cumulative since-boot value against a stored
     * baseline (with reboot-reset handling). TYPE_STEP_DETECTOR has no cumulative value
     * and nothing to reset - each callback is simply "+1 step, right now" - so there is
     * no baseline left to maintain; this is a plain atomic increment under the same lock
     * [decrementPendingDelta] uses, for the same lost-update reason described above.
     */
    fun incrementPendingDelta(context: Context, userId: String, amount: Long): Long {
        synchronized(pendingDeltaLock) {
            val prefs = get(context)
            val updated = prefs.getLong(PENDING_DELTA_PREFIX + userId, 0L) + amount
            prefs.edit().putLong(PENDING_DELTA_PREFIX + userId, updated).apply()
            return updated
        }
    }

    /**
     * Atomically subtracts [amount] from pendingDelta (called right after a chunk
     * sync succeeds) - re-reads the current persisted value under the same lock as
     * [incrementPendingDelta] rather than trusting a caller-supplied snapshot. Returns
     * the new pendingDelta.
     */
    fun decrementPendingDelta(context: Context, userId: String, amount: Long): Long {
        synchronized(pendingDeltaLock) {
            val prefs = get(context)
            val updated = prefs.getLong(PENDING_DELTA_PREFIX + userId, 0L) - amount
            prefs.edit().putLong(PENDING_DELTA_PREFIX + userId, updated).apply()
            return updated
        }
    }
}
