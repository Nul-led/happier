package dev.happier.activitynotifications

import android.content.Context
import android.system.Os
import org.json.JSONObject
import java.io.File

data class ActivityPreparedHomeContext(
  val serverId: String,
  val apiEndpoint: String,
  val accountId: String,
  val token: String,
  val encryptionMode: String,
  val machineKey: String?,
  val settingsVersion: Long,
  val accountEncryptionVersion: Long,
  val registrationId: String,
  val pushToken: String,
  val previewCeiling: String,
)

object ActivityPreparedContext {
  private const val FILE_NAME = "happier-activity-alert-context-v1.json"

  @JvmStatic fun parse(serialized: String): List<ActivityPreparedHomeContext>? {
    val root = try { JSONObject(serialized) } catch (_: Throwable) { return null }
    if (!root.hasExactly("v", "homes") || root.exactLong("v") != 1L) return null
    val rows = root.optJSONArray("homes") ?: return null
    if (rows.length() == 0) return null
    val seen = mutableSetOf<String>()
    val homes = mutableListOf<ActivityPreparedHomeContext>()
    for (index in 0 until rows.length()) {
      val row = rows.opt(index) as? JSONObject ?: return null
      if (!row.hasExactly("v", "serverId", "apiEndpoint", "accountId", "credential", "settingsVersion", "accountEncryptionVersion", "registrationId", "pushToken", "previewCeiling") || row.exactLong("v") != 1L) return null
      val serverId = row.requiredString("serverId") ?: return null
      val endpoint = row.requiredString("apiEndpoint") ?: return null
      if (!endpoint.startsWith("https://") && !endpoint.startsWith("http://")) return null
      val accountId = row.requiredString("accountId") ?: return null
      val credential = row.opt("credential") as? JSONObject ?: return null
      val token = credential.requiredString("token") ?: return null
      val mode = credential.requiredString("encryptionMode") ?: return null
      val machineKey = when (mode) {
        "plain" -> {
          if (!credential.hasExactly("token", "encryptionMode")) return null
          null
        }
        "legacy_e2ee", "e2ee" -> {
          if (!credential.hasExactly("token", "encryptionMode", "machineKey")) return null
          credential.requiredString("machineKey") ?: return null
        }
        else -> return null
      }
      val settingsVersion = row.exactLong("settingsVersion") ?: return null
      if (settingsVersion < 0) return null
      val accountEncryptionVersion = row.exactLong("accountEncryptionVersion") ?: return null
      if (accountEncryptionVersion < 0) return null
      val registrationId = row.requiredString("registrationId") ?: return null
      val pushToken = row.requiredString("pushToken") ?: return null
      val ceiling = row.requiredString("previewCeiling") ?: return null
      if (ceiling !in setOf("status_only", "title_only", "include_preview")) return null
      if (!seen.add("$serverId\u0000$accountId")) return null
      homes.add(ActivityPreparedHomeContext(serverId, endpoint, accountId, token, mode, machineKey,
        settingsVersion, accountEncryptionVersion, registrationId, pushToken, ceiling))
    }
    return homes
  }

  @JvmStatic fun load(context: Context): List<ActivityPreparedHomeContext>? {
    val file = File(context.filesDir, FILE_NAME)
    return try { parse(file.readText(Charsets.UTF_8)) } catch (_: Throwable) { null }
  }

  @JvmStatic fun home(context: Context, serverId: String, accountId: String): ActivityPreparedHomeContext? =
    load(context)?.firstOrNull { it.serverId == serverId && it.accountId == accountId }

  @JvmStatic fun write(context: Context, serialized: String): Boolean {
    val incoming = parse(serialized) ?: return false
    if (incoming.size != 1) return false
    val prepared = incoming.single()
    val homes = (load(context) ?: emptyList())
      .filterNot { it.serverId == prepared.serverId && it.accountId == prepared.accountId }
      .plus(prepared)
      .sortedWith(compareBy({ it.serverId }, { it.accountId }))
    val encoded = JSONObject().put("v", 1).put("homes", org.json.JSONArray(homes.map(::jsonObject))).toString()
    val destination = File(context.filesDir, FILE_NAME)
    val staging = File(context.filesDir, "$FILE_NAME.staging")
    return try {
      staging.writeText(encoded, Charsets.UTF_8)
      Os.rename(staging.absolutePath, destination.absolutePath)
      true
    } catch (_: Throwable) {
      staging.delete()
      false
    }
  }

  @JvmStatic fun remove(context: Context, serverId: String, accountId: String?, registrationId: String?): Boolean {
    val destination = File(context.filesDir, FILE_NAME)
    val loaded = load(context)
    if (loaded == null) return !destination.exists() || destination.delete()
    val homes = loaded.filterNot { home ->
      home.serverId == serverId && (accountId == null || home.accountId == accountId) &&
        (registrationId == null || home.registrationId == registrationId)
    }
    if (homes.isEmpty()) return !destination.exists() || destination.delete()
    val encoded = JSONObject().put("v", 1).put("homes", org.json.JSONArray(homes.map(::jsonObject))).toString()
    val staging = File(context.filesDir, "$FILE_NAME.staging")
    return try {
      staging.writeText(encoded, Charsets.UTF_8)
      Os.rename(staging.absolutePath, destination.absolutePath)
      true
    } catch (_: Throwable) {
      staging.delete()
      false
    }
  }

  @JvmStatic fun remove(context: Context) { File(context.filesDir, FILE_NAME).delete() }

  private fun jsonObject(home: ActivityPreparedHomeContext): JSONObject = JSONObject()
    .put("v", 1)
    .put("serverId", home.serverId)
    .put("apiEndpoint", home.apiEndpoint)
    .put("accountId", home.accountId)
    .put("credential", JSONObject().put("token", home.token).put("encryptionMode", home.encryptionMode).apply {
      if (home.machineKey != null) put("machineKey", home.machineKey)
    })
    .put("settingsVersion", home.settingsVersion)
    .put("accountEncryptionVersion", home.accountEncryptionVersion)
    .put("registrationId", home.registrationId)
    .put("pushToken", home.pushToken)
    .put("previewCeiling", home.previewCeiling)

  private fun JSONObject.requiredString(key: String): String? =
    (opt(key) as? String)?.takeIf { it.isNotEmpty() && it.trim() == it }

  private fun JSONObject.exactLong(key: String): Long? {
    val number = opt(key) as? Number ?: return null
    val value = number.toDouble()
    if (!value.isFinite() || value % 1.0 != 0.0 || value < 0 || value > Long.MAX_VALUE.toDouble()) return null
    return value.toLong()
  }

  private fun JSONObject.hasExactly(vararg keys: String): Boolean =
    keys().asSequence().toSet() == keys.toSet()
}
