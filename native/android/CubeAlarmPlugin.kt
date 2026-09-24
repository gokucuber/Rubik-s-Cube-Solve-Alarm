package dev.dos.cubealarm

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Schedules the one thing a web page cannot do for itself: wake the device at
 * a given moment and put this app in front of the user.
 *
 * Everything else — the cube, the scramble, the rules, the sound — stays in
 * the web layer, which is shared with the browser build.
 */
@CapacitorPlugin(name = "CubeAlarm")
class CubeAlarmPlugin : Plugin() {

    private val alarmManager: AlarmManager
        get() = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun pendingIntent(): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).setAction(ACTION_FIRE)
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    @PluginMethod
    fun schedule(call: PluginCall) {
        val at = call.getLong("at")
        if (at == null || at <= 0) {
            call.reject("a time is required")
            return
        }
        try {
            // setAlarmClock is the strongest guarantee Android offers: it
            // survives doze, and the system shows it as a real alarm.
            val show = PendingIntent.getActivity(
                context,
                REQUEST_CODE + 1,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pendingIntent())
            call.resolve()
        } catch (e: SecurityException) {
            call.reject("exact alarms are not permitted", e)
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        alarmManager.cancel(pendingIntent())
        call.resolve()
    }

    @PluginMethod
    fun canScheduleExact(call: PluginCall) {
        val granted =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
        call.resolve(com.getcapacitor.JSObject().put("granted", granted))
    }

    @PluginMethod
    fun requestExactPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.startActivity(
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                    .setData(Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
        call.resolve()
    }

    @PluginMethod
    fun canUseFullScreen(call: PluginCall) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val granted =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
                manager.canUseFullScreenIntent()
        call.resolve(com.getcapacitor.JSObject().put("granted", granted))
    }

    @PluginMethod
    fun requestFullScreenPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                    .setData(Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
        call.resolve()
    }

    companion object {
        const val ACTION_FIRE = "dev.dos.cubealarm.FIRE"
        private const val REQUEST_CODE = 4711
    }
}
