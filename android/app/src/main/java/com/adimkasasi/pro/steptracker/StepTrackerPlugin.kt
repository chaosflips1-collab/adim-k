package com.adimkasasi.pro.steptracker

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

// Top-level (not companion-object) consts: annotation arguments must be resolvable at the
// point the @CapacitorPlugin annotation on this same file's class is processed, and a
// companion-object const on the class being annotated is a same-class forward reference
// that isn't guaranteed safe here - a top-level const in the same file has no such risk.
private const val ALIAS_ACTIVITY = "activityRecognition"
private const val ALIAS_NOTIF = "notifications"

/**
 * JS-facing surface for the background step tracking foreground service.
 * Exposed to the web layer as `Capacitor.Plugins.StepTracker`.
 *
 * Declares both dangerous runtime permissions the service needs: without ACTIVITY_RECOGNITION
 * (API 29+) the step-counter sensor delivers no events at all, and without POST_NOTIFICATIONS
 * (API 33+) the required persistent foreground-service notification can't be shown - both are
 * silent failures if not requested, not exceptions, so `start()` checks state explicitly rather
 * than assuming the manifest declaration alone is enough (it isn't, for dangerous permissions).
 * `checkPermissions()`/base `requestPermissions()` are provided for free by the Capacitor `Plugin`
 * base class from this declaration; JS is expected to call `requestPermissions()` and get a
 * granted result before calling `start()` (see `start()`'s own guard below for what happens if
 * it's called without that).
 */
@CapacitorPlugin(
    name = "StepTracker",
    permissions = [
        Permission(strings = [Manifest.permission.ACTIVITY_RECOGNITION], alias = ALIAS_ACTIVITY),
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = ALIAS_NOTIF)
    ]
)
class StepTrackerPlugin : Plugin() {

    @PluginMethod
    fun start(call: PluginCall) {
        val token = call.getString("token")
        if (token.isNullOrBlank()) {
            call.reject("token is required")
            return
        }

        // Bug-fix: previously the service would still start foreground (persistent
        // "counting your steps" notification + "active" UI) on a device with no
        // TYPE_STEP_COUNTER hardware, register no listener, and silently record zero
        // steps forever with nothing anywhere distinguishing that from working
        // correctly. Reject explicitly instead so JS can show an honest message.
        if (!hasStepSensor(context)) {
            call.reject("Bu cihazda adım sayar donanımı bulunmuyor.")
            return
        }

        if (!hasAllRequiredPermissions()) {
            // Ask, then resume start() from the callback below rather than silently
            // starting a service that would get no sensor events / no notification.
            call.setKeepAlive(true)
            saveCall(call)
            requestPermissionForAliases(requiredAliases(), call, "permissionCallback")
            return
        }

        beginTracking(call, token)
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        if (!hasAllRequiredPermissions()) {
            call.reject("İzin verilmedi - adım sayar başlatılamaz.")
            return
        }
        val token = call.getString("token")
        if (token.isNullOrBlank()) {
            call.reject("token is required")
            return
        }
        beginTracking(call, token)
    }

    private fun beginTracking(call: PluginCall, token: String) {
        val ctx = context
        SecureStore.saveToken(ctx, token)

        val intent = Intent(ctx, StepTrackerService::class.java).apply {
            action = StepTrackerService.ACTION_START
        }
        ContextCompat.startForegroundService(ctx, intent)

        // Correct foreground-service usage + TYPE_STEP_COUNTER is already Doze-exempt on
        // stock Android, but Xiaomi/HyperOS layers its own, much more aggressive battery
        // manager on top that kills foreground services anyway unless the app is
        // explicitly whitelisted. This is the standard (if HyperOS-incomplete) mitigation:
        // ask the user, once, right when they turn tracking on.
        maybeRequestBatteryOptimizationExemption(ctx)

        val ret = JSObject()
        ret.put("started", true)
        call.resolve(ret)
    }

    /**
     * Fires the system "ignore battery optimizations" dialog for this app, at most once
     * ever (tracked in SecureStore) - not on every start()/app launch, so dismissing it
     * once doesn't turn into a nag. Does NOT gate/block step tracking on the outcome:
     * this is best-effort hardening, not a requirement, and start() has already succeeded
     * by the time this runs.
     *
     * Note: this only reduces (does not eliminate) the odds of HyperOS killing the
     * service - MIUI/HyperOS's separate "Autostart" toggle is a distinct, vendor-specific
     * setting with no reliable public API/intent across HyperOS versions, and is
     * intentionally NOT handled here (see StepTrackerService docs / launch checklist).
     */
    private fun maybeRequestBatteryOptimizationExemption(ctx: Context) {
        if (SecureStore.hasAskedBatteryOptimization(ctx)) return

        val powerManager = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (powerManager.isIgnoringBatteryOptimizations(ctx.packageName)) return

        SecureStore.setAskedBatteryOptimization(ctx, true)
        try {
            val exemptionIntent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${ctx.packageName}")
                if (activity == null) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            (activity ?: ctx).startActivity(exemptionIntent)
        } catch (e: Exception) {
            // A handful of OEM/custom ROMs don't ship the settings screen this action
            // targets, or reject it outright - swallow rather than crash a start() call
            // that has already genuinely succeeded (foreground service + sensor are up).
        }
    }

    /**
     * ACTIVITY_RECOGNITION only exists as a concept from API 29 on (older platforms grant
     * sensor access without it); POST_NOTIFICATIONS is API 33+. Below those levels the
     * corresponding check is vacuously true - nothing to request, nothing to block on.
     */
    private fun hasAllRequiredPermissions(): Boolean {
        val activityOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            getPermissionState(ALIAS_ACTIVITY) == com.getcapacitor.PermissionState.GRANTED
        val notifOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            getPermissionState(ALIAS_NOTIF) == com.getcapacitor.PermissionState.GRANTED
        return activityOk && notifOk
    }

    private fun requiredAliases(): Array<String> {
        val aliases = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) aliases.add(ALIAS_ACTIVITY)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) aliases.add(ALIAS_NOTIF)
        return aliases.toTypedArray()
    }

    @PluginMethod
    fun refreshToken(call: PluginCall) {
        val token = call.getString("token")
        if (token.isNullOrBlank()) {
            call.reject("token is required")
            return
        }

        val ctx = context
        // Cheap no-op if unchanged; the service itself compares against its cached copy.
        SecureStore.saveToken(ctx, token)

        if (isServiceRunning(ctx)) {
            val intent = Intent(ctx, StepTrackerService::class.java).apply {
                action = StepTrackerService.ACTION_REFRESH_TOKEN
            }
            ctx.startService(intent)
        }

        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        val ctx = context
        if (isServiceRunning(ctx)) {
            val intent = Intent(ctx, StepTrackerService::class.java).apply {
                action = StepTrackerService.ACTION_STOP
            }
            ctx.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        ret.put("running", isServiceRunning(context))
        ret.put("hasSensor", hasStepSensor(context))
        call.resolve(ret)
    }

    /** True if this device has TYPE_STEP_COUNTER hardware at all - independent of permissions. */
    private fun hasStepSensor(ctx: Context): Boolean {
        val manager = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return false
        return manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
    }

    /**
     * Queries the OS directly for whether our own service is alive, rather than trusting a
     * persisted flag that could go stale if the process was killed without a clean onDestroy.
     * Querying an app's own running services (not other apps') remains supported.
     */
    @Suppress("DEPRECATION")
    private fun isServiceRunning(ctx: Context): Boolean {
        val manager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        return try {
            manager.getRunningServices(Int.MAX_VALUE).any { info ->
                StepTrackerService::class.java.name == info.service.className
            }
        } catch (e: Exception) {
            SecureStore.isRunning(ctx)
        }
    }
}
