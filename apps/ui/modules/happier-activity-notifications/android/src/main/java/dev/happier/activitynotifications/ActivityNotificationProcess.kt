package dev.happier.activitynotifications

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.content.ComponentName
import android.os.Build
import android.os.Process

/**
 * The isolated process that owns closed-app Activity alert presentation.
 *
 * The generated `MainApplication` asks this owner whether it is running inside
 * that process and skips React initialization when it is, so an alert never
 * starts the app runtime. Every other process keeps its current startup.
 */
object ActivityNotificationProcess {
  const val SUFFIX = ":happier_activity_notifications"

  @JvmStatic
  fun isCurrent(context: Context): Boolean {
    val current = currentProcessName(context) ?: return false
    return current == context.packageName + SUFFIX
  }

  private fun currentProcessName(context: Context): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Application.getProcessName()?.let { return it }
    }
    val pid = Process.myPid()
    val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return null
    return manager.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName
  }
}

/** Runtime proof that this installed build has the isolated Firebase consumer. */
object ActivityNotificationConsumer {
  @JvmStatic
  fun isInstalled(context: Context): Boolean {
    val info = try {
      @Suppress("DEPRECATION")
      context.packageManager.getServiceInfo(
        ComponentName(context, ActivityFirebaseMessagingService::class.java),
        0,
      )
    } catch (_: Throwable) {
      return false
    }
    return info.enabled && info.processName == context.packageName + ActivityNotificationProcess.SUFFIX
  }
}
