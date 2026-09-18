import ExpoModulesCore
import Foundation

public class HappierActivityNotificationsModule: Module {
  private var preparedRoot: URL?

  public func definition() -> ModuleDefinition {
    Name("HappierActivityNotifications")

    Function("prepareStorage") { () -> String in
      let root = try ActivityNotificationStorageLocation.prepare()
      self.preparedRoot = root
      return root.path
    }

    Function("prepareContext") { (serializedContext: String) -> Bool in
      guard let root = self.preparedRoot else { return false }
      return try ActivityPreparedContext.write(serializedContext, root: root)
    }

    Function("removeContext") { (serverId: String, accountId: String?, registrationId: String?) -> Bool in
      guard let root = self.preparedRoot else { return false }
      return try ActivityPreparedContext.remove(
        root: root, serverId: serverId, accountId: accountId, registrationId: registrationId
      )
    }

    Function("clearContext") { () in
      guard let root = self.preparedRoot else { return }
      try ActivityPreparedContext.remove(root: root)
    }

    Function("getCapabilities") { () -> [String: Any]? in
      guard let root = self.preparedRoot,
            ActivityPreparedContext.load(root: root) != nil,
            ActivityNotificationServiceExtension.isBundled() else { return nil }
      return ["v": 1, "platform": "ios", "events": ActivityNotificationEvents.supported]
    }
  }
}
