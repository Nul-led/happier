package dev.happier.activitynotifications

import android.content.Intent
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * The single Firebase messaging entry point for this app.
 *
 * It runs in the isolated `:happier_activity_notifications` process so a closed
 * app can present an Activity remote alert without starting the app runtime. It
 * is not a second sender: exactly one path handles each message.
 *
 * - A recognized Activity remote alert is offered to an already-loaded app
 *   process so its foreground/privacy handler remains authoritative, otherwise
 *   it is presented here through the same presenter after exact-Home admission.
 * - Everything else is delegated to the incumbent Expo delegate.
 *
 * The delegate also runs `remote-notification` task-manager consumers, whose
 * registry is per-process. This app registers that task only on iOS
 * (`sources/activity/adapters/ios/backgroundWake`), so no Android consumer is
 * lost here. Registering an Android background remote-notification task would
 * invalidate that assumption and require moving the delegation hop back into the
 * app process.
 */
class ActivityFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onCreate() {
    super.onCreate()
    // `FirebaseInitProvider` only runs in the app process, so this process must
    // initialize Firebase itself before handling a message.
    FirebaseApp.initializeApp(applicationContext)
  }

  override fun onNewToken(token: String) {
    ActivityNotificationTokenBridge.forward(applicationContext, token)
  }

  override fun handleIntent(intent: Intent) {
    // Adapt every recognized notification message before Firebase decides
    // whether the app is foregrounded. Process liveness is not foreground
    // state: a backgrounded app process must still reach onMessageReceived and
    // the incumbent Expo handling owner rather than Firebase auto-display.
    val activityIntent = ActivityRemoteAlertIntent.prepareForNativePresentation(intent)
    if (activityIntent != null) {
      super.handleIntent(activityIntent)
      return
    }
    super.handleIntent(intent)
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val alert = ActivityRemoteAlert.parse(remoteMessage)
    if (alert != null) {
      ActivityNotificationMainProcessHandoff.offer(applicationContext, remoteMessage, alert)
      return
    }
    super.onMessageReceived(remoteMessage)
  }
}
