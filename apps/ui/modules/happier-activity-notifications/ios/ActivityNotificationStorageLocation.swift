import Foundation

enum ActivityNotificationStorageLocation {
  enum Error: Swift.Error { case appGroupUnavailable }

  /// The extension reads only the narrow prepared JSON projection. Both app
  /// processes must resolve the same App Group container; an app-private
  /// fallback would advertise a consumer that can never read its context.
  static func prepare(bundle: Bundle = .main, fileManager: FileManager = .default) throws -> URL {
    guard let sharedRoot = appGroupRoot(bundle: bundle, fileManager: fileManager) else {
      throw Error.appGroupUnavailable
    }
    try fileManager.createDirectory(at: sharedRoot, withIntermediateDirectories: true)
    return sharedRoot
  }

  static func appGroupRoot(bundle: Bundle, fileManager: FileManager) -> URL? {
    let appGroup = (bundle.object(forInfoDictionaryKey: "AppGroup") as? String)
      ?? (bundle.object(forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier") as? String)
    guard let appGroup, !appGroup.isEmpty else { return nil }
    return fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  }
}

enum ActivityNotificationServiceExtension {
  static let extensionPointIdentifier = "com.apple.usernotifications.service"

  /// Reports the alert consumer as available only when this build actually ships
  /// a notification service extension. The registration owner uses that to decide
  /// whether the device may advertise `ios_service_extension_v1`; a client claim
  /// alone must never enroll a device that has no consumer.
  static func isBundled(bundle: Bundle = .main, fileManager: FileManager = .default) -> Bool {
    guard let plugIns = bundle.builtInPlugInsURL,
          let entries = try? fileManager.contentsOfDirectory(at: plugIns, includingPropertiesForKeys: nil) else {
      return false
    }
    return entries.contains { entry in
      guard entry.pathExtension == "appex", let appex = Bundle(url: entry) else { return false }
      let extensionInfo = appex.object(forInfoDictionaryKey: "NSExtension") as? [String: Any]
      return extensionInfo?["NSExtensionPointIdentifier"] as? String == extensionPointIdentifier
    }
  }
}
