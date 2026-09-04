package dev.happier.iroh

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Lifecycle/status only; native Rust owns all stream bytes. */
class HappierIrohNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HappierIrohNative")
    Function("getAvailability") { HappierIrohNativeBridge.availability() }
    AsyncFunction("getTunnelStatus") { tunnelId: String -> HappierIrohNativeBridge.tunnelStatus(tunnelId) }
    AsyncFunction("createEndpoint") { request: Map<String, Any?> ->
      val context = appContext.reactContext?.applicationContext
        ?: throw CodedException("endpoint_key_unavailable", "Android application storage is unavailable.", null)
      HappierIrohNativeBridge.createEndpoint(request, context)
    }
    AsyncFunction("ensureHomeTunnel") { request: Map<String, Any?> ->
      HappierIrohNativeBridge.ensureHomeTunnel(request)
    }
    AsyncFunction("releaseHomeTunnel") { tunnelId: String ->
      HappierIrohNativeBridge.releaseHomeTunnel(tunnelId)
    }
    AsyncFunction("shutdownEndpoint") { request: Map<String, Any?> ->
      HappierIrohNativeBridge.shutdownEndpoint(request)
    }
    AsyncFunction("startMachineHttpTunnel") { request: Map<String, Any?> ->
      HappierIrohNativeBridge.startMachineHttpTunnel(request)
    }
    AsyncFunction("stopMachineTunnel") { machineTunnelId: String ->
      HappierIrohNativeBridge.stopMachineTunnel(machineTunnelId)
    }
  }
}

private object HappierIrohNativeBridge {
  private const val MODULE_VERSION = "0.0.0"
  private val loaded: Boolean by lazy { runCatching { System.loadLibrary("happier_iroh_native") }.isSuccess }

  fun availability(): Map<String, Any> = if (loaded) mapOf(
    "available" to true, "platform" to "android", "engine" to "iroh", "moduleVersion" to MODULE_VERSION, "supportsHomeTunnel" to true
  ) else mapOf(
    "available" to false, "platform" to "android", "engine" to "iroh", "supportsHomeTunnel" to false, "reason" to "engine-unavailable"
  )

  fun createEndpoint(request: Map<String, Any?>, context: Context): Map<String, Any?> {
    ensureLoaded()
    IrohAndroidContext.install(context)
    val seed = IrohEndpointIdentityStore.loadOrCreate(context)
    return try {
      val nativeRequest = request.toMutableMap()
      nativeRequest["endpointSeedBase64"] = Base64.encodeToString(seed, Base64.NO_WRAP)
      unwrap(HappierIrohNativeRust.createEndpointJson(JSONObject(nativeRequest).toString()))
    } finally {
      seed.fill(0)
    }
  }

  fun startMachineHttpTunnel(request: Map<String, Any?>): Map<String, Any?> {
    ensureLoaded()
    return unwrap(HappierIrohNativeRust.startMachineHttpTunnelJson(JSONObject(request).toString()))
  }

  fun ensureHomeTunnel(request: Map<String, Any?>): Map<String, Any?> {
    ensureLoaded()
    return unwrap(HappierIrohNativeRust.ensureHomeTunnelJson(JSONObject(request).toString()))
  }

  fun releaseHomeTunnel(tunnelId: String) {
    if (!loaded) return
    unwrap(HappierIrohNativeRust.releaseHomeTunnelJson(JSONObject(mapOf("tunnelId" to tunnelId)).toString()))
  }

  fun shutdownEndpoint(request: Map<String, Any?>) {
    if (!loaded) return
    unwrap(HappierIrohNativeRust.shutdownEndpointJson(JSONObject(request).toString()))
  }

  fun stopMachineTunnel(machineTunnelId: String) {
    if (!loaded) return
    unwrap(HappierIrohNativeRust.stopMachineTunnelJson(JSONObject(mapOf("machineTunnelId" to machineTunnelId)).toString()))
  }

  fun tunnelStatus(tunnelId: String): Map<String, Any?>? {
    if (!loaded) return null
    val response = JSONObject(HappierIrohNativeRust.getTunnelStatusJson(JSONObject(mapOf("tunnelId" to tunnelId)).toString()))
    if (!response.optBoolean("ok", false)) {
      val error = response.optJSONObject("error")
      throw CodedException(
        error?.optString("code", "engine-internal") ?: "engine-internal",
        error?.optString("message", "Iroh native status failed.") ?: "Iroh native status failed.",
        null,
      )
    }
    if (response.isNull("result")) return null
    return response.optJSONObject("result")?.toMap()
  }

  private fun ensureLoaded() { if (!loaded) throw CodedException("engine-unavailable", "Iroh native engine is not linked in this build.", null) }
  private fun unwrap(raw: String): Map<String, Any?> {
    val response = JSONObject(raw)
    if (response.optBoolean("ok", false)) return response.optJSONObject("result")?.toMap() ?: emptyMap()
    val error = response.optJSONObject("error")
    throw CodedException(error?.optString("code", "engine-internal") ?: "engine-internal", error?.optString("message", "Iroh native engine failed.") ?: "Iroh native engine failed.", null)
  }
  private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { key -> when (val value = get(key)) { JSONObject.NULL -> null; is JSONObject -> value.toMap(); is JSONArray -> value.toList(); else -> value } }
  private fun JSONArray.toList(): List<Any?> = (0 until length()).map { index -> when (val value = get(index)) { JSONObject.NULL -> null; is JSONObject -> value.toMap(); is JSONArray -> value.toList(); else -> value } }
}

private object IrohAndroidContext {
  private var installed = false

  @Synchronized
  fun install(context: Context) {
    if (installed) return
    HappierIrohNativeRust.installAndroidContext(context.applicationContext)
    installed = true
  }
}

private object IrohEndpointIdentityStore {
  private const val ALIAS = "dev.happier.iroh.endpoint-identity.v1"
  private const val PREFERENCES = "dev.happier.iroh.endpoint-identity.v1.wrapped"
  private const val CIPHERTEXT = "ciphertext"
  private const val IV = "iv"

  @Synchronized
  fun loadOrCreate(context: Context): ByteArray {
    return try {
      loadOrCreateInternal(context)
    } catch (error: EndpointIdentityException) {
      throw error
    } catch (_: Exception) {
      throw EndpointIdentityException("Iroh endpoint identity is unavailable.")
    }
  }

  private fun loadOrCreateInternal(context: Context): ByteArray {
    val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    val encodedCiphertext = preferences.getString(CIPHERTEXT, null)
    val encodedIv = preferences.getString(IV, null)
    if (encodedCiphertext != null || encodedIv != null) {
      if (encodedCiphertext.isNullOrEmpty() || encodedIv.isNullOrEmpty()) corrupt()
      val key = existingKey() ?: corrupt()
      val ciphertext = decode(encodedCiphertext)
      val iv = decode(encodedIv)
      if (ciphertext.isEmpty() || iv.isEmpty()) corrupt()
      val seed = try {
        Cipher.getInstance("AES/GCM/NoPadding").run {
          init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
          doFinal(ciphertext)
        }
      } catch (_: Exception) {
        corrupt()
      } finally {
        ciphertext.fill(0)
        iv.fill(0)
      }
      if (seed.size != 32) {
        seed.fill(0)
        corrupt()
      }
      return seed
    }

    val key = existingKey() ?: provisionKey()
    val seed = ByteArray(32).also { SecureRandom().nextBytes(it) }
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key)
      val ciphertext = cipher.doFinal(seed)
      val iv = cipher.iv
      val committed = try {
        preferences.edit()
          .putString(CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
          .putString(IV, Base64.encodeToString(iv, Base64.NO_WRAP))
          .commit()
      } finally {
        ciphertext.fill(0)
        iv.fill(0)
      }
      if (!committed) {
        throw EndpointIdentityException("Iroh endpoint identity could not be provisioned.")
      }
      return seed
    } catch (error: Exception) {
      seed.fill(0)
      throw error
    }
  }

  private fun existingKey(): SecretKey? {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    return (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
  }

  private fun provisionKey(): SecretKey {
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  private fun decode(value: String): ByteArray = runCatching {
    Base64.decode(value, Base64.NO_WRAP)
  }.getOrElse { corrupt() }

  private fun corrupt(): Nothing = throw EndpointIdentityException(
    "Iroh endpoint identity is corrupt; explicit re-pair is required."
  )
}

private class EndpointIdentityException(message: String) :
  CodedException("endpoint_key_unavailable", message, null)

private object HappierIrohNativeRust {
  external fun installAndroidContext(context: Context)
  external fun getTunnelStatusJson(requestJson: String): String
  external fun createEndpointJson(requestJson: String): String
  external fun ensureHomeTunnelJson(requestJson: String): String
  external fun releaseHomeTunnelJson(requestJson: String): String
  external fun shutdownEndpointJson(requestJson: String): String
  external fun startMachineHttpTunnelJson(requestJson: String): String
  external fun stopMachineTunnelJson(requestJson: String): String
}
