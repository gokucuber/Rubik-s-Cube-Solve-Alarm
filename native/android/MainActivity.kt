package dev.dos.cubealarm

import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(CubeAlarmPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Appear over the lock screen and turn the display on, so the alarm is
        // visible without the phone being unlocked first.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager)
                .requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }

        // The alarm makes noise before the user has touched anything, which
        // the WebView blocks by default.
        bridge.webView.settings.mediaPlaybackRequiresUserGesture = false
    }

    override fun onResume() {
        super.onResume()
        // The app is in front now, so the notification that brought it here
        // has done its job.
        getSystemService(NotificationManager::class.java)
            .cancel(AlarmReceiver.NOTIFICATION_ID)
    }
}
