import UserNotifications
import CoreFoundation

/// The committed canonical reference an Activity remote alert points at.
///
/// Mirrors `ActivityRemoteAlert` in `packages/protocol/src/push/activityRemoteAlert.ts`,
/// the single owner of this wire shape. Admission is strict so an unrecognized
/// payload is left exactly as the OS received it.
struct ActivityRemoteAlert {
  static let supportedEventTypes = Set(ActivityNotificationEvents.supported)

  let serverId: String
  let sessionId: String
  let accountId: String
  let eventType: String
  let previewBehavior: String
  let messageSeq: Int64?
  let sequenceDomain: String?
  let discussionId: String?
  let version: Int64

  private static let supportedPreviewBehaviors = Set(["status_only", "title_only", "include_preview"])

  /// Groups every alert for one Home, Session and category. iOS replacement of an
  /// already delivered alert needs an APNs collapse identifier on the submitting
  /// leg; a thread identifier only groups what is presented.
  var threadIdentifier: String { "activity_alert:\(serverId):\(sessionId):\(eventType)" }

  /// Exact identity for a current committed message reference. This is not a
  /// delivery receipt; it keeps equal local sequences owned by two Discussions
  /// distinct for presentation dedupe and diagnostics.
  var eventIdentity: String? {
    guard version == 2, let messageSeq else { return nil }
    if sequenceDomain == "discussion", let discussionId {
      return "message-seq:discussion:\(discussionId):\(messageSeq)"
    }
    if sequenceDomain == "session_transcript" {
      return "message-seq:session_transcript:\(messageSeq)"
    }
    return nil
  }

  /// Only current references with their complete owner identity may select a
  /// message for local preview enrichment.
  var canFetchSessionTranscriptPreview: Bool {
    version == 2
      && sequenceDomain == "session_transcript"
      && ["ready", "human_message", "message"].contains(eventType)
  }

  var canFetchDiscussionPreview: Bool {
    version == 2
      && sequenceDomain == "discussion"
      && discussionId != nil
      && ["human_message", "message", "discussion_mention"].contains(eventType)
  }

  var canFetchMessagePreview: Bool {
    canFetchSessionTranscriptPreview || canFetchDiscussionPreview
  }

  /// APNs/Expo remote delivery serializes the canonical object into `body`.
  /// Requiring that envelope here prevents a remote top-level object from being
  /// mistaken for the separate local-notification representation.
  init?(remoteUserInfo: [AnyHashable: Any]) {
    guard let serializedBody = remoteUserInfo["body"] as? String,
          let data = serializedBody.data(using: .utf8),
          let decoded = try? JSONSerialization.jsonObject(with: data),
          let decodedObject = decoded as? [String: Any] else { return nil }
    self.init(payload: decodedObject)
  }

  /// Locally scheduled notifications use the canonical object at top level.
  init?(localUserInfo: [AnyHashable: Any]) {
    self.init(payload: localUserInfo)
  }

  private init?(payload: [AnyHashable: Any]) {
    guard ActivityRemoteAlert.exactKeys(
      payload,
      allowed: ["type", "v", "serverId", "sessionId", "accountId", "event", "previewBehavior"]
    ) else { return nil }
    guard payload["type"] as? String == "activity_alert",
          let version = ActivityRemoteAlert.exactInteger(payload["v"]), [1, 2].contains(version),
          let serverId = ActivityRemoteAlert.requiredString(payload["serverId"]),
          let sessionId = ActivityRemoteAlert.requiredString(payload["sessionId"]),
          let accountId = ActivityRemoteAlert.requiredString(payload["accountId"]),
          let event = payload["event"] as? [AnyHashable: Any],
          let eventType = ActivityRemoteAlert.requiredString(event["type"]),
          ActivityRemoteAlert.supportedEventTypes.contains(eventType),
          let previewBehavior = ActivityRemoteAlert.requiredString(payload["previewBehavior"]),
          ActivityRemoteAlert.supportedPreviewBehaviors.contains(previewBehavior),
          ActivityRemoteAlert.validEventShape(event, type: eventType, version: version) else {
      return nil
    }
    self.serverId = serverId
    self.sessionId = sessionId
    self.accountId = accountId
    self.eventType = eventType
    self.previewBehavior = previewBehavior
    self.version = version
    self.messageSeq = ["ready", "human_message", "message", "discussion_mention"].contains(eventType)
      ? ActivityRemoteAlert.exactInteger(event["messageSeq"])
      : nil
    self.sequenceDomain = version == 2 && self.messageSeq != nil
      ? ActivityRemoteAlert.requiredString(event["sequenceDomain"])
      : nil
    self.discussionId = version == 2 && self.sequenceDomain == "discussion"
      ? ActivityRemoteAlert.requiredDiscussionId(event["discussionId"])
      : nil
  }

  private static func requiredString(_ value: Any?) -> String? {
    guard let text = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
      return nil
    }
    return text
  }

  private static func requiredDiscussionId(_ value: Any?) -> String? {
    guard let text = requiredString(value), text.utf16.count <= 191 else { return nil }
    return text
  }

  private static func exactInteger(_ value: Any?) -> Int64? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let double = number.doubleValue
    guard double.isFinite, double.rounded() == double,
          double >= Double(Int64.min), double <= Double(Int64.max) else { return nil }
    return number.int64Value
  }

  private static func exactKeys(_ value: [AnyHashable: Any], allowed: Set<String>) -> Bool {
    Set(value.keys.compactMap { $0 as? String }) == allowed && value.keys.allSatisfy { $0 is String }
  }

  private static func validEventShape(_ event: [AnyHashable: Any], type: String, version: Int64) -> Bool {
    if ["ready", "human_message", "message", "discussion_mention"].contains(type) {
      guard let sequence = exactInteger(event["messageSeq"]),
            sequence > 0 && sequence <= 2_147_483_647 else { return false }
      if version == 1 {
        return exactKeys(event, allowed: ["type", "messageSeq"])
      }
      guard let domain = requiredString(event["sequenceDomain"]) else { return false }
      if domain == "session_transcript" {
        return exactKeys(event, allowed: ["type", "sequenceDomain", "messageSeq"])
          && type != "discussion_mention"
      }
      return domain == "discussion"
        && type != "ready"
        && exactKeys(event, allowed: ["type", "sequenceDomain", "discussionId", "messageSeq"])
        && requiredDiscussionId(event["discussionId"]) != nil
    }
    if ["failed", "cancelled"].contains(type) {
      return exactKeys(event, allowed: ["type", "turnId"])
        && requiredString(event["turnId"]) != nil
    }
    return exactKeys(event, allowed: ["type"])
  }
}

/// The iOS consumer for the Home's Activity remote alert leg.
///
/// The submitted alert already passed the recipient's mute, quiet-hours and
/// preview decision before submission, so this extension never suppresses it and
/// never invents content: an unrecognized payload, a missing enrichment input or
/// an expiring execution interval all deliver the already-permitted content.
///
class HappierActivityNotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var deliverableContent: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    self.deliverableContent = request.content

    guard let alert = ActivityRemoteAlert(remoteUserInfo: request.content.userInfo),
          let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      finish(request.content)
      return
    }
    // Admission to enrichment is exact-Home and current-context bound. Missing,
    // locked, malformed or revoked prepared custody keeps the Home-approved
    // generic fallback; it never broadens preview locally.
    guard let root = ActivityNotificationStorageLocation.appGroupRoot(bundle: .main, fileManager: .default),
          let prepared = ActivityPreparedContext.home(
            root: root, serverId: alert.serverId, accountId: alert.accountId
          ), prepared.previewCeiling != "status_only" else {
      content.threadIdentifier = alert.threadIdentifier
      self.deliverableContent = content
      finish(content)
      return
    }
    content.threadIdentifier = alert.threadIdentifier
    self.deliverableContent = content
    ActivityNotificationEnricher.fetchEnrichment(alert: alert, prepared: prepared) { [weak self] enrichment in
      guard let self else { return }
      // Local device privacy, credentials, or enrollment may change while the
      // bounded network/decryption work is in flight. The captured generation
      // no longer authorizes rich content once its exact prepared row moved.
      guard ActivityPreparedContext.home(
        root: root, serverId: alert.serverId, accountId: alert.accountId
      ) == prepared else {
        self.finish(content)
        return
      }
      if let title = enrichment?.title { content.title = title }
      if let body = enrichment?.body { content.body = body }
      self.finish(content)
    }
  }

  override func serviceExtensionTimeWillExpire() {
    guard contentHandler != nil, let deliverableContent else { return }
    finish(deliverableContent)
  }

  private func finish(_ content: UNNotificationContent) {
    guard let handler = contentHandler else { return }
    contentHandler = nil
    handler(content)
  }
}
