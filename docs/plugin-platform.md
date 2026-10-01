# Plugin platform and SDK ownership

Bundled and installed plugins contribute through the same manifest, registration and projection contracts. The host owns installation, admission, currentness, invocation and cleanup; a plugin owns its integration's declarations and executable leaves. The SDK exposes that boundary without becoming another runtime or persistence owner.

This is the standing reference for **0.3 development source / Developer Preview authoring**. Source availability is distinct from registry publication and loaded-platform verification. Exact public exports and capability facts come from the package-owned generated API and capability reports, not a hand-maintained list in this page.

## Declaration, activation and projection

[`definePlugin`](../packages/plugin-sdk/src/definePlugin.ts) is the code-defined author path. It projects a portable manifest and compiles registration callbacks into the named `activate(api)` ABI declared in [`activation.ts`](../packages/plugin-sdk/src/activation.ts). Raw host-generated `contributes` is not an additional `definePlugin` author input.

The canonical manifest schema and normalizer remain Protocol/platform-owned. [`manifest/v2.ts`](../packages/protocol/src/plugins/manifest/v2.ts) admits runtime API version 1 and an **optional** non-wildcard `engines.happier` range. Host/runtime ABI admission and package SemVer are separate contracts; do not infer a host compatibility range from a package version or source build identity. See [protocol evolution](compatibility.md#sdk-protocol-evolution).

The host derives registration rights from the admitted manifest. [`registrationRightsHost.ts`](../apps/cli/src/plugins/runtime/api/registrationRightsHost.ts) wraps the SDK registration scope with occurrence currentness and diagnostics; a retired occurrence cannot register. The reload lifecycle owns the serving occurrence in [`runtimeSlots.ts`](../apps/cli/src/plugins/runtime/runtimeSlots.ts). A consumer does not reconstruct currentness from an id, callback or manifest snapshot.

Contribution-family membership and normalization are Protocol-owned. The CLI's [`projection/families.ts`](../apps/cli/src/plugins/projection/families.ts) asserts its descriptors against that catalog and adds current occurrence facts. Agent catalog and UI registries consume that projection; a feature must not scan Actions, invent conventional ids or install a second registry to discover its contributors.

## Public seam and authority

- Plugin leaves import public SDK entry points and their owning public feature protocol. They do not import host internals or private Protocol validators. SDK `*.public.ts` files and package `exports` maps own the exact public surface; generated reports are never hand-edited.
- Host services bind the invocation's admitted plugin, generation, scope and authority. Caller identity, selected credentials, Session ownership and machine routing cannot be supplied as renderer or Action input.
- Actions own request/response and effects; Resources own reads and invalidation; Events carry facts. Keep their different cancellation and lifecycle semantics. [Actions](actions.md) owns invocation surfaces, placement and confirmation rules.
- The [runtime core](runtime-core.md) owns Session/turn admission and transcript/lifecycle state. [Providers](providers.md) owns model sources, connections and materialization. SDK projections do not transfer those domains to plugins.
- Trusted daemon and native plugin code is executable code. Managed services provide portable APIs, resource custody, cancellation and diagnostics; they are not a malicious-code sandbox. Real network, credential, present-user and OS permission boundaries still apply.
- Capability declarations, runtime registration and lifecycle must exist in the applicable realm. A daemon declaration does not establish browser or native support. Registry publication and a loaded invocation are separate evidence, not substitute availability authorities.

Targeted feature composition uses public `defineContributionProtocol` / `defineContributionPoint` values and typed handles. A feature protocol keeps explicit versioned exports, validator-neutral schemas and source-neutral DTOs; it excludes host runtime, provider clients, credentials and persistence. The SDK's [`featureProtocolPackagePolicy.test.ts`](../packages/plugin-sdk/src/featureProtocolPackagePolicy.test.ts) owns the allowed dependency classification. [Triage sources](triage-sources.md) is one current consumer.

Notification channel authors must account for the development sender signature's
[optional-category migration](compatibility.md#notification-channel-sender-source-migration-development)
when upgrading a category-dependent sender; the plugin send service and host
Activity path have distinct category contracts.

## Generated ownership

The CLI publisher [`generateBundledPluginEntries.ts`](../apps/cli/scripts/build-owned/generateBundledPluginEntries.ts) owns bundled semantic/catalog/daemon projections. The UI publisher [`generateBundledPluginUiArtifacts.mjs`](../apps/ui/scripts/generateBundledPluginUiArtifacts.mjs) owns app-preseed UI byte inventories. They are different products, not competing publishers. Change their inputs or producer, never an emitted projection; do not add handwritten Agent/Provider lists beside generated facts.

Public author toolchain facts have one strict carrier, [`PublicToolchainCompatibilityV1`](../packages/protocol/src/plugins/publicToolchainCompatibilityV1.ts). Authoring/scaffold consumers use its package and runtime facts rather than inventing a second compatibility table. Feature validation uses current source, ordinary package checks and the loaded development runtime. Packaging, registry publication and exact release-byte checks remain release-owned.

## Related

[Runtime core](runtime-core.md), [Agent catalog](agents-catalog.md), [Providers](providers.md), [Actions](actions.md), [feature gating](feature-gating.md), [encryption](encryption.md), [binary runtime](binary-runtime.md), [Collection presentation](collection-presentation.md), [surface states](surface-states.md).
