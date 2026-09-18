import Foundation

/// Public, React-free access to the same Session cryptography used by the
/// native batch worker. Native extensions can compose these primitives without
/// copying the envelope or payload algorithms into another owner.
public enum HappierCryptoWorkerSessionCrypto {
  public static func openSessionDataKey(
    envelopeBase64: String,
    recipientSecretKeyOrSeedBase64: String
  ) -> String? {
    HappierCryptoWorkerDataKeyEnvelope.decryptDataKeyEnvelopeV1Batch([[
      "envelopeBase64": envelopeBase64,
      "recipientSecretKeyOrSeedBase64": recipientSecretKeyOrSeedBase64,
    ]]).first ?? nil
  }

  public static func decryptSessionPayload(
    ciphertextBase64: String,
    sessionDataKeyBase64: String
  ) -> String? {
    HappierCryptoWorkerSecretbox.decryptSecretboxJsonBatch([[
      "ciphertextBase64": ciphertextBase64,
      "keyBase64": sessionDataKeyBase64,
    ]]).first ?? nil
  }
}
