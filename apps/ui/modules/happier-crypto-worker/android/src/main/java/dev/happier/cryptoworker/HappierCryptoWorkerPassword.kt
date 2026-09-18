package dev.happier.cryptoworker

import android.util.Base64
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

internal class PasswordEnvelopeKeyRequest : Record {
  @Field var passwordBase64: String = ""
  @Field var saltBase64: String = ""
  @Field var opsLimit: Double = 0.0
  @Field var memLimitBytes: Double = 0.0
  @Field var outputBytes: Double = 0.0
}

internal object HappierCryptoWorkerPassword {
  fun derivePasswordEnvelopeKey(request: PasswordEnvelopeKeyRequest): String {
    // Mirror PasswordEnvelopeKdfV1Schema at the native allocation boundary.
    require(request.opsLimit == 3.0)
    require(request.memLimitBytes == 67108864.0)
    require(request.outputBytes == 32.0 && request.passwordBase64.length <= 1368 && request.saltBase64.length == 24)
    val password = Base64.decode(request.passwordBase64, Base64.NO_WRAP)
    try {
      require(password.size in 15..1024 && Base64.encodeToString(password, Base64.NO_WRAP) == request.passwordBase64)
      val salt = Base64.decode(request.saltBase64, Base64.NO_WRAP)
      require(salt.size == 16 && Base64.encodeToString(salt, Base64.NO_WRAP) == request.saltBase64)
      val output = HappierCryptoWorkerNative.derivePasswordEnvelopeKey(password, salt, request.opsLimit.toLong(), request.memLimitBytes.toLong(), 32)
        ?: throw IllegalStateException("Password key derivation failed")
      try {
        check(output.size == 32)
        return Base64.encodeToString(output, Base64.NO_WRAP)
      } finally { output.fill(0) }
    } finally { password.fill(0) }
  }
}
