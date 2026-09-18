package dev.happier.activitynotifications

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.HandlerThread
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.delegates.FirebaseMessagingDelegate
import java.util.concurrent.Executors

/**
 * Hands one recognized Home alert to the already-loaded app process.
 *
 * The isolated FCM process cannot observe the app process's Expo foreground
 * handler, visible Session, or in-process local-alert coalescer. An ordered,
 * package-private broadcast lets the dynamically registered app-process owner
 * accept the message when that owner is actually loaded. If there is no such
 * receiver, the isolated process keeps the closed-app fallback. Process
 * liveness is deliberately not used as a proxy for handler availability.
 */
object ActivityNotificationMainProcessHandoff {
  private const val ACTION_SUFFIX = ".happier.activitynotifications.PRESENT"
  private const val EXTRA_BODY = "body"
  private const val EXTRA_TITLE = "title"
  private const val EXTRA_MESSAGE = "message"
  private const val EXTRA_SOUND = "sound"
  private const val EXTRA_CHANNEL_ID = "channelId"
  private const val EXTRA_TAG = "tag"
  private const val RESULT_PRESENTED = Activity.RESULT_FIRST_USER + 1

  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "happier-activity-notification-handoff").apply { isDaemon = true }
  }
  private val fallbackThread = HandlerThread("happier-activity-notification-fallback").apply { start() }
  private val fallbackHandler = Handler(fallbackThread.looper)
  private var registeredContext: Context? = null
  private var registeredReceiver: BroadcastReceiver? = null

  @JvmStatic
  @Synchronized
  fun register(context: Context) {
    if (ActivityNotificationProcess.isCurrent(context) || registeredReceiver != null) return
    val applicationContext = context.applicationContext
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(receiveContext: Context, intent: Intent) {
        if (intent.action != action(receiveContext)) return
        val pending = goAsync()
        executor.execute {
          try {
            val message = remoteMessage(intent) ?: return@execute
            val alert = ActivityRemoteAlert.parse(message) ?: return@execute
            val applicationContext = receiveContext.applicationContext
            val enrichedMessage = ActivityNotificationPresenter.enrichedMessage(applicationContext, message, alert)
            FirebaseMessagingDelegate(applicationContext).onMessageReceived(enrichedMessage)
            pending.setResultCode(RESULT_PRESENTED)
          } catch (_: Throwable) {
            // Keep the ordered result unclaimed so the isolated fallback owns it.
          } finally {
            pending.finish()
          }
        }
      }
    }
    val filter = IntentFilter(action(applicationContext))
    ContextCompat.registerReceiver(
      applicationContext,
      receiver,
      filter,
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    registeredContext = applicationContext
    registeredReceiver = receiver
  }

  @JvmStatic
  @Synchronized
  fun unregister() {
    val context = registeredContext
    val receiver = registeredReceiver
    registeredContext = null
    registeredReceiver = null
    if (context != null && receiver != null) {
      try {
        context.unregisterReceiver(receiver)
      } catch (_: IllegalArgumentException) {
        // The app process may already be tearing down the receiver registry.
      }
    }
  }

  @JvmStatic
  fun offer(context: Context, remoteMessage: RemoteMessage, alert: ActivityRemoteAlert) {
    val handoff = Intent(action(context)).setPackage(context.packageName)
    copy(remoteMessage.data, EXTRA_BODY, handoff)
    copy(remoteMessage.data, EXTRA_TITLE, handoff)
    copy(remoteMessage.data, EXTRA_MESSAGE, handoff)
    copy(remoteMessage.data, EXTRA_SOUND, handoff)
    copy(remoteMessage.data, EXTRA_CHANNEL_ID, handoff)
    handoff.putExtra(EXTRA_TAG, alert.replacementTag)

    val fallback = object : BroadcastReceiver() {
      override fun onReceive(receiverContext: Context, intent: Intent) {
        if (resultCode != RESULT_PRESENTED) {
          ActivityNotificationPresenter.present(context.applicationContext, remoteMessage, alert)
        }
      }
    }
    context.sendOrderedBroadcast(
      handoff,
      null,
      fallback,
      fallbackHandler,
      Activity.RESULT_CANCELED,
      null,
      null,
    )
  }

  private fun action(context: Context): String = context.packageName + ACTION_SUFFIX

  private fun copy(data: Map<String, String>, key: String, intent: Intent) {
    data[key]?.let { intent.putExtra(key, it) }
  }

  private fun remoteMessage(intent: Intent): RemoteMessage? {
    val body = intent.getStringExtra(EXTRA_BODY) ?: return null
    val tag = intent.getStringExtra(EXTRA_TAG) ?: return null
    val data = mutableMapOf(EXTRA_BODY to body, EXTRA_TAG to tag)
    for (key in listOf(EXTRA_TITLE, EXTRA_MESSAGE, EXTRA_SOUND, EXTRA_CHANNEL_ID)) {
      intent.getStringExtra(key)?.let { data[key] = it }
    }
    return RemoteMessage.Builder(intent.`package` ?: return null)
      .setMessageId(tag)
      .setData(data)
      .build()
  }
}
