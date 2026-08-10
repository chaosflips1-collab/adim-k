package com.adimkasasi.pro.steptracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.adimkasasi.pro.R
import android.util.Log
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import kotlin.math.min

/**
 * Foreground service that owns the hardware step-counter sensor listener so step tracking
 * survives screen-lock and app backgrounding (the whole reason this native wrapper exists —
 * a WebView-hosted JS listener gets suspended by the OS in those states, this service is not
 * subject to that suspension).
 *
 * Only ever started explicitly via [StepTrackerPlugin.start] (a user tapping a button in the
 * web UI) — no BOOT_COMPLETED receiver, no auto-start.
 */
class StepTrackerService : Service(), SensorEventListener {

    // Bug-fix: SupervisorJob only stops a child coroutine's failure from cancelling its
    // siblings - it does NOT catch/handle the exception. A launch{}-created root coroutine
    // with no handler installed propagates an uncaught exception to the thread's default
    // handler, which on Android means the WHOLE PROCESS crashes (not just "this sync tick
    // fails" or "the loop stops"). EncryptedSharedPreferences/Keystore access (see
    // SecureStore) is a real, documented source of exceptions on some OEMs/OS states, so
    // this isn't hypothetical. This handler turns an uncaught failure anywhere in
    // serviceScope into a log line instead of a crash.
    private val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        Log.e("StepTrackerService", "Yakalanmamış hata (yut, çökme yok)", throwable)
    }
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default + exceptionHandler)
    private val syncMutex = Mutex()

    private lateinit var sensorManager: SensorManager
    private var stepSensor: Sensor? = null
    private var listenerRegistered = false
    private var periodicLoopStarted = false

    private var currentUserId: String? = null
    private var cachedToken: String? = null
    private var authPaused = false

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder().build()
    }

    override fun onCreate() {
        super.onCreate()
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Bug-fix: same rationale as onSensorChanged's try/catch - these handlers run
        // synchronously on the main thread (Service lifecycle callback) and touch
        // SecureStore's Keystore-backed storage, which is a real exception source. An
        // uncaught throw here would crash the app on every start/refresh/stop attempt.
        return try {
            when (intent?.action) {
                ACTION_STOP -> {
                    handleStop()
                    START_NOT_STICKY
                }
                ACTION_REFRESH_TOKEN -> {
                    handleRefreshToken()
                    START_STICKY
                }
                else -> {
                    handleStart()
                    START_STICKY
                }
            }
        } catch (e: Exception) {
            Log.e("StepTrackerService", "onStartCommand hatası (yut, çökme yok)", e)
            START_NOT_STICKY
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (listenerRegistered) {
            sensorManager.unregisterListener(this)
            listenerRegistered = false
        }
        SecureStore.setRunning(this, false)
        serviceScope.cancel()
        super.onDestroy()
    }

    // ---- Command handlers ----------------------------------------------------------------

    private fun handleStart() {
        val token = SecureStore.getToken(this)
        val userId = token?.let { JwtUtils.getUserId(it) }
        if (token.isNullOrBlank() || userId == null) {
            // Nothing to track without a valid cached token; bail out cleanly.
            stopSelf()
            return
        }

        cachedToken = token
        currentUserId = userId
        authPaused = false

        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(TEXT_NORMAL),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
        )
        SecureStore.setRunning(this, true)

        if (!listenerRegistered && stepSensor != null) {
            sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL)
            listenerRegistered = true
        }

        if (!periodicLoopStarted) {
            periodicLoopStarted = true
            startPeriodicSyncLoop()
        }

        triggerSync()
    }

    private fun handleRefreshToken() {
        val token = SecureStore.getToken(this) ?: return
        if (token == cachedToken) return // cheap no-op, unchanged

        cachedToken = token
        JwtUtils.getUserId(token)?.let { currentUserId = it }

        if (authPaused) {
            authPaused = false
            updateNotification(TEXT_NORMAL)
        }

        triggerSync()
    }

    private fun handleStop() {
        serviceScope.launch {
            // Best-effort final flush before tearing down.
            syncMutex.withLock { performSync() }
            withContext(Dispatchers.Main) {
                finishStop()
            }
        }
    }

    private fun finishStop() {
        if (listenerRegistered) {
            sensorManager.unregisterListener(this)
            listenerRegistered = false
        }
        SecureStore.setRunning(this, false)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ---- Sensor -----------------------------------------------------------------------

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_STEP_COUNTER) return
        val userId = currentUserId ?: return

        // Bug-fix: this runs synchronously on the main thread (registerListener was
        // called with no Handler, so callbacks land on the registering thread) and is
        // NOT inside a coroutine, so serviceScope's CoroutineExceptionHandler cannot
        // protect it. SecureStore's EncryptedSharedPreferences/Keystore access can
        // throw for real (see its own docs/known issues); an uncaught exception here
        // would crash the entire app, not just this service, on every single step.
        try {
            val newCumulative = event.values[0].toLong()
            // Baseline update + pending-delta increment (incl. reboot detection) happen
            // atomically inside SecureStore, under the same lock performSync's decrement
            // uses - see the comment on SecureStore.pendingDeltaLock for why this can't
            // just be a local read-modify-write here.
            val updatedPending = SecureStore.applySensorReading(this, userId, newCumulative)

            if (updatedPending >= EARLY_FLUSH_THRESHOLD) {
                triggerSync()
            }
        } catch (e: Exception) {
            Log.e("StepTrackerService", "onSensorChanged hatası (yut, çökme yok)", e)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // No-op: cumulative step counter accuracy changes aren't actionable here.
    }

    // ---- Sync ---------------------------------------------------------------------------

    private fun startPeriodicSyncLoop() {
        serviceScope.launch {
            while (isActive) {
                delay(SYNC_INTERVAL_MS)
                triggerSync()
            }
        }
    }

    private fun triggerSync() {
        if (authPaused) return
        serviceScope.launch {
            syncMutex.withLock { performSync() }
        }
    }

    private suspend fun performSync() {
        val userId = currentUserId ?: return
        val token = cachedToken ?: return
        if (authPaused) return

        var pending = SecureStore.getPendingDelta(this, userId)
        while (pending > 0) {
            val chunk = min(pending, MAX_CHUNK_AMOUNT)
            when (sendChunk(token, chunk)) {
                SyncResult.OK -> {
                    // Re-reads the current persisted value under the lock rather than
                    // trusting this loop's local `pending` snapshot, so a sensor event
                    // that landed while the chunk POST was in flight isn't lost.
                    pending = SecureStore.decrementPendingDelta(this, userId, chunk)
                }
                SyncResult.UNAUTHORIZED -> {
                    authPaused = true
                    updateNotification(TEXT_PAUSED)
                    return
                }
                SyncResult.FAILURE -> {
                    // Leave the remainder for the next tick; no hot retry loop.
                    return
                }
            }
        }
    }

    private enum class SyncResult { OK, UNAUTHORIZED, FAILURE }

    private suspend fun sendChunk(token: String, amount: Long): SyncResult = withContext(Dispatchers.IO) {
        try {
            val payload = JSONObject().apply {
                put("amount", amount)
                put("source", "native_sensor")
            }
            val body = payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url(SYNC_URL)
                .addHeader("Authorization", "Bearer $token")
                .post(body)
                .build()

            httpClient.newCall(request).execute().use { response ->
                when {
                    response.code == 200 -> SyncResult.OK
                    response.code == 401 -> SyncResult.UNAUTHORIZED
                    else -> SyncResult.FAILURE
                }
            }
        } catch (e: IOException) {
            SyncResult.FAILURE
        } catch (e: Exception) {
            SyncResult.FAILURE
        }
    }

    // ---- Notification -----------------------------------------------------------------

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Adım Takibi",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Arka planda adım sayımı için sürekli bildirim"
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val stopIntent = Intent(this, StepTrackerService::class.java).apply { action = ACTION_STOP }
        val stopPendingIntent = PendingIntent.getService(
            this,
            0,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AdımKasası")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_steps)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(0, "Durdur", stopPendingIntent)
            .build()
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    companion object {
        const val ACTION_START = "com.adimkasasi.pro.steptracker.action.START"
        const val ACTION_STOP = "com.adimkasasi.pro.steptracker.action.STOP"
        const val ACTION_REFRESH_TOKEN = "com.adimkasasi.pro.steptracker.action.REFRESH_TOKEN"

        private const val CHANNEL_ID = "step_tracker_channel"
        private const val NOTIFICATION_ID = 4821

        private const val SYNC_URL = "https://adim-k.onrender.com/api/v2/steps/add"
        private const val SYNC_INTERVAL_MS = 3 * 60 * 1000L
        private const val EARLY_FLUSH_THRESHOLD = 500L
        private const val MAX_CHUNK_AMOUNT = 2000L

        private const val TEXT_NORMAL = "AdımKasası adımlarınızı sayıyor 👟"
        private const val TEXT_PAUSED = "Oturum süresi doldu, senkron duraklatıldı — uygulamayı açın"
    }
}
