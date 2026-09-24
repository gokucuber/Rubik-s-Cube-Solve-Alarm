package dev.dos.cubealarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager

/**
 * Runs at the alarm time. Android forbids starting an activity straight from a
 * receiver, so this posts a high-priority notification with a full-screen
 * intent, which is the supported way for an alarm to take over a locked
 * screen. The web layer takes it from there.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != CubeAlarmPlugin.ACTION_FIRE) return

        // Hold the CPU just long enough to get the activity on screen.
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = power.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "cubealarm:fire"
        )
        wakeLock.acquire(30_000)

        try {
            ensureChannel(context)

            val open = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("キューブをそろえて")
                .setContentText("そろえるまでアラームは止まりません")
                .setCategory(Notification.CATEGORY_ALARM)
                .setPriority(Notification.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .build()

            context.getSystemService(NotificationManager::class.java)
                .notify(NOTIFICATION_ID, notification)
        } finally {
            wakeLock.release()
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL,
            "アラーム",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "キューブを解くまで止まらないアラーム"
            setBypassDnd(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            // The web layer plays the sound, so the notification itself is silent.
            setSound(null, null)
            enableVibration(true)
        }
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL = "cube-alarm"
        const val NOTIFICATION_ID = 1
    }
}
