package dev.happier.hostedwebframe

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The only JavaScript-to-native registration seam for hosted-web Artifact
 * frames. Registration receives opaque persistent coordinates or token-owned
 * current-load bytes; the exported view resolves one registered token through
 * [HostedWebArtifactRegistryOwner] without exposing either to hosted content.
 */
class HappierHostedWebFrameModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HappierHostedWebFrame")

    OnCreate {
      // ProfileStore is UI-thread-only. A bounded prefix sweep repairs only
      // frames orphaned by a prior process death before this module can mount.
      val cleanup = Runnable { HostedWebArtifactView.cleanupOrphanedProfiles() }
      if (Looper.myLooper() == Looper.getMainLooper()) {
        cleanup.run()
      } else {
        Handler(Looper.getMainLooper()).post(cleanup)
      }
    }

    AsyncFunction("registerArtifact") { input: Map<String, Any?> ->
      val profileIsolationCapability = HostedWebArtifactView.profileIsolationUnavailableCapability()
      if (profileIsolationCapability != null) {
        return@AsyncFunction mapOf(
          "kind" to "unavailable",
          "code" to "hosted_web_profile_isolation_unavailable",
          "capability" to profileIsolationCapability
        )
      }
      val context = appContext.reactContext ?: return@AsyncFunction mapOf(
        "kind" to "unavailable",
        "code" to "native_artifact_resource_registration_failed"
      )
      if (HostedWebArtifactRegistryOwner.register(context, input)) {
        mapOf("kind" to "registered")
      } else {
        mapOf(
          "kind" to "unavailable",
          "code" to "native_artifact_resource_registration_failed"
        )
      }
    }.runOnQueue(Queues.DEFAULT)

    // This acknowledgement is intentionally synchronous. Artifact removes its
    // own token/index only after true, which means a later native read cannot
    // observe the token even if storage cleanup follows afterwards.
    Function("unregisterArtifact") { token: String ->
      val context = appContext.reactContext ?: return@Function false
      HostedWebArtifactRegistryOwner.unregister(context, token)
    }

    AsyncFunction("registerInlineDocument") { input: Map<String, Any?> ->
      val capability = HostedWebArtifactView.profileIsolationUnavailableCapability()
      if (capability != null) {
        return@AsyncFunction mapOf(
          "kind" to "unavailable",
          "code" to "hosted_web_profile_isolation_unavailable",
          "capability" to capability
        )
      }
      if (HostedInlineDocumentRegistry.register(input)) mapOf("kind" to "registered") else mapOf(
        "kind" to "unavailable",
        "code" to "native_inline_document_registration_failed"
      )
    }.runOnQueue(Queues.DEFAULT)

    Function("unregisterInlineDocument") { token: String ->
      HostedInlineDocumentRegistry.unregister(token)
    }

    View(HostedWebArtifactView::class) {
      Events("onMessage", "onLoadStart", "onLoadEnd", "onLoadError", "onExternalNavigation", "onBlockedNavigation", "onHistoryStateChange")

      Prop<String?>("title") { view, title ->
        view.setTitle(title)
      }
      Prop<String?>("artifactHandleToken") { view, token ->
        view.setArtifactHandleToken(token)
      }
      Prop<String?>("inlineDocumentHandleToken") { view, token ->
        view.setInlineDocumentHandleToken(token)
      }
      Prop<String?>("initialPathAndQuery") { view, pathAndQuery ->
        view.setInitialPathAndQuery(pathAndQuery)
      }
      Prop<List<String>>("allowedNavigationOrigins") { view, origins ->
        view.setAllowedNavigationOrigins(origins)
      }
      Prop<Boolean>("externalHttpLinks") { view, enabled ->
        view.setExternalHttpLinks(enabled)
      }

      AsyncFunction("postHostMessage") { view: HostedWebArtifactView, serializedMessage: String ->
        view.postHostMessage(serializedMessage)
      }
      AsyncFunction("goBack") { view: HostedWebArtifactView ->
        view.goBack()
      }

      OnViewDestroys { view ->
        view.dispose()
      }
    }

    OnDestroy {
      HostedWebArtifactRegistryOwner.clear()
      HostedInlineDocumentRegistry.clear()
    }
  }
}
