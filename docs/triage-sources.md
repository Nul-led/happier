# Triage source protocol ownership

Triage and independently authored source plugins share one versioned, source-neutral ABI. Triage owns the feature and configured-source lifecycle; each source owns its provider-specific discovery, reads and detail rendering. Generic hosts admit, invoke and mount contributions through the plugin platform.

This page describes **0.3 development / Developer Preview source**. Exact field layouts, exported names and bounds live in [`packages/triage-protocol/src/v1/index.ts`](../packages/triage-protocol/src/v1/index.ts) and its schemas, not a copied schema in this page. Registry publication and loaded external-provider validation are separate release/runtime evidence.

## Package boundary

`@happier-dev/triage-protocol` exposes only the explicit V1 root, `/v1` and `/testing/v1` entries in its [export map](../packages/triage-protocol/package.json). Do not add floating default/current/latest/legacy aliases. The package contains portable composable schemas, authoring values, source-neutral projections and conformance fixtures. Keep host registries/runtime, provider clients, credential materialization, HTTP, UI implementations and persistence outside it.

Schemas use the public SDK `/protocol` composition algebra and `/contributions` authoring seam. The [SDK feature-protocol dependency policy](../packages/plugin-sdk/src/featureProtocolPackagePolicy.test.ts) owns admissible public imports; do not import private `@happier-dev/protocol`, Zod, host internals or a source plugin, and do not handwrite a second JSON Schema/parser. Schema evolution follows [compatibility](compatibility.md#sdk-protocol-evolution).

## Contributions and caller-bound administration

[`contribution.ts`](../packages/triage-protocol/src/v1/contribution.ts) declares `happier.triage/sources` V1 and the target-owned point, with at most one contribution per source plugin. It defines the required list/scan/get operations and detail surface plus optional PR-status/workspace roles. Operation roles reference ordinary source Actions; they are not implementation imports, convention-derived Action ids or a source-specific host registry.

[`sources/administer-v1`](../packages/triage-protocol/src/v1/sourceAdministration.ts) is the one caller-bound lifecycle mutation ABI: create, reconfigure, remove and reactivate. [`sources/read-configured-v1`](../packages/triage-protocol/src/v1/configuredInstances.ts) is its read half. Neither input accepts caller/source identity. The host stamps the caller, and the target's [`callerSource.ts`](../packages/plugins/triage/src/actions/callerSource.ts) resolves its current admitted source before either Action exposes or changes rows; a source cannot select another source's configured set.

Triage's [`administerConfiguredSourceInstance.ts`](../packages/plugins/triage/src/corpus/configuration/administerConfiguredSourceInstance.ts) owns configured-instance writes and the exact source-ownership comparison. [`readConfiguredSourceRows.ts`](../packages/plugins/triage/src/corpus/configuration/readConfiguredSourceRows.ts) supplies the shared active-row read and cursor handling. Discovery produces candidates, not automatic durable creation; mounted source Settings uses the administration Action rather than a direct Collection writer. The read ABI distinguishes complete from truncated results and refuses invalid or changed caller authority.

The source plugin retains its private configuration-token encoding and provider-specific behavior. Triage business behavior stays in `packages/plugins/triage`; shared host code stays source-neutral. Do not use this schema package as a new source service, credential store or corpus persistence owner.

## Related

[Plugin platform](plugin-platform.md), [Actions](actions.md), [Collection presentation](collection-presentation.md), [encryption](encryption.md), [compatibility](compatibility.md).
