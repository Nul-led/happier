package dev.happier.activitynotifications

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HappierActivityNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HappierActivityNotifications")

    OnCreate {
      appContext.reactContext?.let(ActivityNotificationMainProcessHandoff::register)
    }

    // Android processes share the app files directory. The native consumer
    // reads only the narrow prepared JSON projection from this directory.
    Function("prepareStorage") {
      requireContext().filesDir.absolutePath
    }

    Function("prepareContext") { serializedContext: String ->
      ActivityPreparedContext.write(requireContext(), serializedContext)
    }

    Function("removeContext") { serverId: String, accountId: String?, registrationId: String? ->
      ActivityPreparedContext.remove(requireContext(), serverId, accountId, registrationId)
    }

    Function("clearContext") {
      ActivityPreparedContext.remove(requireContext())
    }

    Function("getCapabilities") {
      val context = requireContext()
      if (ActivityPreparedContext.load(context) == null || !ActivityNotificationConsumer.isInstalled(context)) null else mapOf(
        "v" to 1,
        "platform" to "android",
        "events" to ActivityRemoteAlert.SUPPORTED_EVENT_TYPES.toList(),
      )
    }

    OnDestroy {
      ActivityNotificationMainProcessHandoff.unregister()
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw IllegalStateException("Activity notifications require an Android context")
}
