package dev.happier.activitynotifications

import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * The Home's content-free closed-app wake.
 *
 * Mirrors `SessionChangedWakeV1Schema` in `packages/protocol/src/push/sessionChangedWake.ts`,
 * the single owner of this wire shape. It names a Session and, when the Home
 * knows its own identity, that Home, plus the optional mute qualifier. Admission is strict so a
 * remote alert, a badge refresh or any payload carrying content can never be
 * handed to the app process as a wake, and no title or body
 * can ride along inside one.
 *
 * This consumer never presents, enriches or decides anything: the app process's
 * registered wake task synchronizes that exact Home, and the incumbent local
 * notification path then applies the recipient's own policy and content builder.
 */
data class SessionChangedWake(
  val serverId: String?,
  val sessionId: String,
) {
  companion object {
    private const val TYPE = "session_changed"

    @JvmStatic
    fun parse(remoteMessage: RemoteMessage): SessionChangedWake? {
      val raw = remoteMessage.data["body"] ?: return null
      val payload = try {
        JSONObject(raw)
      } catch (_: Throwable) {
        return null
      }
      val keys = buildList {
        val iterator = payload.keys()
        while (iterator.hasNext()) add(iterator.next())
      }.toSet()
      if (!keys.contains("type") || !keys.contains("sessionId")) return null
      if (!setOf("type", "serverId", "sessionId", "alert").containsAll(keys)) return null
      if (keys.contains("alert") && payload.opt("alert") != "muted") return null
      if (payload.requiredString("type") != TYPE) return null
      val sessionId = payload.requiredString("sessionId") ?: return null
      val serverId = if (keys.contains("serverId")) payload.requiredString("serverId") ?: return null else null
      return SessionChangedWake(serverId, sessionId)
    }

    private fun JSONObject.requiredString(key: String): String? {
      val value = (opt(key) as? String)?.trim() ?: return null
      return value.ifEmpty { null }
    }
  }
}
