/// The alert categories this platform's consumer admits, mirroring
/// `ActivityRemoteAlertEventV1` in `packages/protocol/src/push/activityRemoteAlert.ts`.
///
/// Compiled into both the app module and the notification service extension so the
/// capability the device advertises and the payloads the extension accepts cannot
/// drift apart. The extension links no pods, so this file is shared by source.
enum ActivityNotificationEvents {
  static let supported = ["ready", "permission_request", "user_action_request", "assigned", "failed", "cancelled", "human_message", "message", "discussion_mention", "source_unavailable"]
}
