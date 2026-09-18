import Clibsodium
import ExpoModulesCore
import Foundation

struct PasswordEnvelopeKeyRequest: Record {
  @Field var passwordBase64: String = ""
  @Field var saltBase64: String = ""
  @Field var opsLimit: Double = 0
  @Field var memLimitBytes: Double = 0
  @Field var outputBytes: Double = 0
}

enum HappierCryptoWorkerPassword {
  enum DerivationError: Error {
    case invalidInput
    case derivationFailed
  }

  static func derivePasswordEnvelopeKey(_ request: PasswordEnvelopeKeyRequest) throws -> String {
    // Mirror PasswordEnvelopeKdfV1Schema at the native allocation boundary.
    guard request.opsLimit == 3, request.memLimitBytes == 67108864,
      request.outputBytes == 32, request.passwordBase64.utf8.count <= 1368,
      request.saltBase64.utf8.count == 24
    else { throw DerivationError.invalidInput }

    guard var password = Data(base64Encoded: request.passwordBase64) else {
      throw DerivationError.invalidInput
    }
    defer { password.withUnsafeMutableBytes { if let pointer = $0.baseAddress { sodium_memzero(pointer, $0.count) } } }
    guard (15...1024).contains(password.count), password.base64EncodedString() == request.passwordBase64,
      let salt = Data(base64Encoded: request.saltBase64), salt.count == 16,
      salt.base64EncodedString() == request.saltBase64
    else { throw DerivationError.invalidInput }
    guard sodium_init() >= 0 else { throw DerivationError.derivationFailed }

    var output = Data(count: 32)
    defer { output.withUnsafeMutableBytes { if let pointer = $0.baseAddress { sodium_memzero(pointer, $0.count) } } }
    let passwordCount = password.count
    let status = output.withUnsafeMutableBytes { outputBuffer in
      password.withUnsafeBytes { passwordBuffer in
        salt.withUnsafeBytes { saltBuffer in
          crypto_pwhash(
            outputBuffer.bindMemory(to: UInt8.self).baseAddress!, 32,
            passwordBuffer.bindMemory(to: CChar.self).baseAddress!, UInt64(passwordCount),
            saltBuffer.bindMemory(to: UInt8.self).baseAddress!,
            UInt64(request.opsLimit), Int(request.memLimitBytes), crypto_pwhash_ALG_ARGON2ID13
          )
        }
      }
    }
    guard status == 0 else { throw DerivationError.derivationFailed }
    return output.base64EncodedString()
  }
}
