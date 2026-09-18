import Foundation
import CoreFoundation

struct ActivityPreparedHomeContext: Equatable {
  let serverId: String
  let apiEndpoint: URL
  let accountId: String
  let token: String
  let encryptionMode: String
  let machineKey: String?
  let settingsVersion: Int
  let accountEncryptionVersion: Int
  let registrationId: String
  let pushToken: String
  let previewCeiling: String
}

enum ActivityPreparedContext {
  static let fileName = "happier-activity-alert-context-v1.json"

  static func parse(_ data: Data) -> [ActivityPreparedHomeContext]? {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          exactKeys(root, ["v", "homes"]), exactInteger(root["v"]) == 1,
          let rows = root["homes"] as? [[String: Any]], !rows.isEmpty else { return nil }
    var seen = Set<String>()
    var homes: [ActivityPreparedHomeContext] = []
    for row in rows {
      guard exactKeys(row, ["v", "serverId", "apiEndpoint", "accountId", "credential", "settingsVersion", "accountEncryptionVersion", "registrationId", "pushToken", "previewCeiling"]),
            exactInteger(row["v"]) == 1,
            let serverId = requiredString(row["serverId"]),
            let endpointText = requiredString(row["apiEndpoint"]),
            let endpoint = URL(string: endpointText), ["http", "https"].contains(endpoint.scheme?.lowercased() ?? ""),
            let accountId = requiredString(row["accountId"]),
            let credential = row["credential"] as? [String: Any],
            let token = requiredString(credential["token"]),
            let encryptionMode = requiredString(credential["encryptionMode"]),
            let settingsVersion = exactInteger(row["settingsVersion"]), settingsVersion >= 0,
            let accountEncryptionVersion = exactInteger(row["accountEncryptionVersion"]), accountEncryptionVersion >= 0,
            let registrationId = requiredString(row["registrationId"]),
            let pushToken = requiredString(row["pushToken"]),
            let previewCeiling = requiredString(row["previewCeiling"]),
            ["status_only", "title_only", "include_preview"].contains(previewCeiling) else { return nil }
      let machineKey: String?
      if encryptionMode == "plain" {
        guard exactKeys(credential, ["token", "encryptionMode"]) else { return nil }
        machineKey = nil
      } else if encryptionMode == "legacy_e2ee" || encryptionMode == "e2ee" {
        guard exactKeys(credential, ["token", "encryptionMode", "machineKey"]),
              let preparedMachineKey = requiredString(credential["machineKey"]) else { return nil }
        machineKey = preparedMachineKey
      } else { return nil }
      let identity = serverId + "\u{0}" + accountId
      guard seen.insert(identity).inserted else { return nil }
      homes.append(ActivityPreparedHomeContext(serverId: serverId, apiEndpoint: endpoint, accountId: accountId,
        token: token, encryptionMode: encryptionMode, machineKey: machineKey, settingsVersion: settingsVersion,
        accountEncryptionVersion: accountEncryptionVersion,
        registrationId: registrationId, pushToken: pushToken, previewCeiling: previewCeiling))
    }
    return homes
  }

  static func load(root: URL) -> [ActivityPreparedHomeContext]? {
    guard let data = try? Data(contentsOf: root.appendingPathComponent(fileName), options: [.mappedIfSafe]) else { return nil }
    return parse(data)
  }

  static func home(root: URL, serverId: String, accountId: String) -> ActivityPreparedHomeContext? {
    load(root: root)?.first { $0.serverId == serverId && $0.accountId == accountId }
  }

  static func write(_ serialized: String, root: URL) throws -> Bool {
    guard let data = serialized.data(using: .utf8), let incoming = parse(data), incoming.count == 1,
          let prepared = incoming.first else { return false }
    var homes = load(root: root) ?? []
    homes.removeAll { $0.serverId == prepared.serverId && $0.accountId == prepared.accountId }
    homes.append(prepared)
    homes.sort { ($0.serverId, $0.accountId) < ($1.serverId, $1.accountId) }
    let encoded = try JSONSerialization.data(withJSONObject: ["v": 1, "homes": homes.map(jsonObject)])
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try encoded.write(to: root.appendingPathComponent(fileName), options: [.atomic, .completeFileProtectionUnlessOpen])
    return true
  }

  static func remove(root: URL, serverId: String, accountId: String?, registrationId: String?) throws -> Bool {
    let destination = root.appendingPathComponent(fileName)
    guard var homes = load(root: root) else {
      if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
      return true
    }
    homes.removeAll { home in
      guard home.serverId == serverId else { return false }
      if let accountId, home.accountId != accountId { return false }
      if let registrationId, home.registrationId != registrationId { return false }
      return true
    }
    if homes.isEmpty {
      if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
      return true
    }
    let encoded = try JSONSerialization.data(withJSONObject: ["v": 1, "homes": homes.map(jsonObject)])
    try encoded.write(to: destination, options: [.atomic, .completeFileProtectionUnlessOpen])
    return true
  }

  static func remove(root: URL) throws {
    let url = root.appendingPathComponent(fileName)
    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
  }

  private static func jsonObject(_ home: ActivityPreparedHomeContext) -> [String: Any] {
    [
      "v": 1,
      "serverId": home.serverId,
      "apiEndpoint": home.apiEndpoint.absoluteString,
      "accountId": home.accountId,
      "credential": credentialObject(home),
      "settingsVersion": home.settingsVersion,
      "accountEncryptionVersion": home.accountEncryptionVersion,
      "registrationId": home.registrationId,
      "pushToken": home.pushToken,
      "previewCeiling": home.previewCeiling,
  ]
  }

  private static func credentialObject(_ home: ActivityPreparedHomeContext) -> [String: Any] {
    var credential: [String: Any] = ["token": home.token, "encryptionMode": home.encryptionMode]
    if let machineKey = home.machineKey { credential["machineKey"] = machineKey }
    return credential
  }

  private static func requiredString(_ value: Any?) -> String? {
    guard let value = value as? String, !value.isEmpty,
          value.trimmingCharacters(in: .whitespacesAndNewlines) == value else { return nil }
    return value
  }

  private static func exactInteger(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let value = number.doubleValue
    guard value.isFinite, value.rounded() == value, value >= 0, value <= Double(Int.max) else { return nil }
    return Int(value)
  }

  private static func exactKeys(_ value: [String: Any], _ keys: Set<String>) -> Bool {
    Set(value.keys) == keys
  }
}
