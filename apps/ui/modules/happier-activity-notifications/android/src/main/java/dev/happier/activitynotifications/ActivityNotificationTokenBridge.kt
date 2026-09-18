package dev.happier.activitynotifications

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import expo.modules.notifications.service.delegates.FirebaseMessagingDelegate

/**
 * Keeps Firebase token refresh on the app's existing owner.
 *
 * `onNewToken` is delivered to whichever process owns the messaging service, and
 * the incumbent Expo delegate notifies only listeners registered in its own
 * process. Forwarding the token to the app process preserves today's behavior:
 * the refresh reaches the same delegate and the same listeners it always did.
 */
class ActivityNotificationTokenBridge : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val token = intent.getStringExtra(EXTRA_TOKEN)?.takeIf { it.isNotEmpty() } ?: return
    FirebaseMessagingDelegate(context.applicationContext).onNewToken(token)
  }

  companion object {
    const val ACTION = "dev.happier.activitynotifications.NEW_FCM_TOKEN"
    const val EXTRA_TOKEN = "token"

    @JvmStatic
    fun forward(context: Context, token: String) {
      val intent = Intent(ACTION)
        .setComponent(ComponentName(context, ActivityNotificationTokenBridge::class.java))
        .putExtra(EXTRA_TOKEN, token)
      context.sendBroadcast(intent)
    }
  }
}
