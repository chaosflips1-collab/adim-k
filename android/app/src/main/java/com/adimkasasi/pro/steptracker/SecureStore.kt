package com.adimkasasi.pro.steptracker

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted, process-wide store for the cached auth token, the service "running" flag,
 * and the per-user cumulative/pending step counters used by [StepTrackerService].
 *
 * Backed by [EncryptedSharedPreferences] so the JWT never sits in plaintext on disk.
 * The underlying [SharedPreferences] instance is built once (Keystore init isn't free)
 * and reused for the lifetime of the process by both the Capacitor plugin and the service.
 */
object SecureStore {

    private const val PREFS_NAME = "step_tracker_secure_prefs"
    private const val KEY_TOKEN = "auth_token"
    private const val KEY_RUNNING = "service_running"
    private const val LAST_CUMULATIVE_PREFIX = "last_cumulative_"
    private const val PENDING_DELTA_PREFIX = "pending_delta_"

    /** Sentinel meaning "no baseline recorded yet for this user". */
    const val NO_BASELINE = -1L

    @Volatile
    private var prefs: SharedPreferences? = null

    private fun get(context: Context): SharedPreferences {
        return prefs ?: synchronized(this) {
            prefs ?: build(context.applicationContext).also { prefs = it }
        }
    }

    private fun build(context: Context): SharedPreferences {
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

    fun getLastCumulative(context: Context, userId: String): Long =
        get(context).getLong(LAST_CUMULATIVE_PREFIX + userId, NO_BASELINE)

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
     * Atomically folds one sensor reading into the persisted state: updates the
     * cumulative baseline and adds the resulting delta (handling the device-reboot
     * case, where the raw sensor value resets to 0) to pendingDelta in a single
     * locked read-modify-write. Returns the new pendingDelta.
     */
    fun applySensorReading(context: Context, userId: String, newCumulative: Long): Long {
        synchronized(pendingDeltaLock) {
            val prefs = get(context)
            val lastCumulative = prefs.getLong(LAST_CUMULATIVE_PREFIX + userId, NO_BASELINE)
            val currentPending = prefs.getLong(PENDING_DELTA_PREFIX + userId, 0L)

            if (lastCumulative == NO_BASELINE) {
                // First-ever reading for this user: establish baseline only, don't
                // credit "all steps since last reboot" retroactively.
                //
                // Bug-fix (ANR risk): these writes used .commit() (synchronous, blocks
                // until the encrypted value hits disk) while HOLDING pendingDeltaLock.
                // That lock is also taken from onSensorChanged on the MAIN thread - so
                // a sensor event landing while the background sync coroutine was
                // mid-commit() blocked the main thread on disk I/O it doesn't own, on
                // every single step. .apply() updates the in-memory SharedPreferences
                // map synchronously (so the very next getLong() inside this same lock,
                // from either thread, still sees the new value - the atomicity this
                // lock exists for is unaffected) and only defers the disk fsync.
                prefs.edit().putLong(LAST_CUMULATIVE_PREFIX + userId, newCumulative).apply()
                return currentPending
            }

            val delta = if (newCumulative < lastCumulative) newCumulative else (newCumulative - lastCumulative)
            val updatedPending = currentPending + delta
            prefs.edit()
                .putLong(LAST_CUMULATIVE_PREFIX + userId, newCumulative)
                .putLong(PENDING_DELTA_PREFIX + userId, updatedPending)
                .apply()
            return updatedPending
        }
    }

    /**
     * Atomically subtracts [amount] from pendingDelta (called right after a chunk
     * sync succeeds) - re-reads the current persisted value under the same lock as
     * [applySensorReading] rather than trusting a caller-supplied snapshot. Returns
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
