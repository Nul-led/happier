# Feature Gating

Happier uses one canonical feature gating system. New code must use it instead of ad-hoc env checks, direct payload poking, or feature-specific inference logic.

## Decide whether a gate is appropriate

Fail-closed behavior answers what happens after a gate exists; it does not justify creating the gate.

- Refactors and replacements of existing behavior are performed in place at the canonical owner. Do not add an off-by-default flag, inverted default, hard-coded admission constant, or parallel implementation merely to de-risk a requested refactor. Manage that risk with RED → GREEN, a composed live gate, and recoverable Git history.
- Gates are appropriate for genuinely new or experimental user-facing capabilities. Use the canonical Happier feature system and name the live consumer, activation/validation condition, intended default, and graduation or removal condition.
- A time-bounded prepare/expand → activate/migrate → contract sequence is appropriate only when supported released components, persisted data, independent rollout, coexistence, or rollback makes it necessary. Name the exact compatibility direction and old-path removal condition; do not preserve undeployed internal architecture.
- An emergency kill switch may select between two coherent, complete behaviors when operational risk justifies it. It must have an owner, observable state, tested fail-closed behavior, and a removal/review condition.
- A gated program must not weave dormant consumer branches into live runtime paths before every enabled producer and the activation lifecycle are proven. Live-path corrections needed during gated work land as independent consumed verticals, not as partial activation of the dormant replacement.

An off-by-default parallel implementation of existing behavior is a split-brain finding unless the user explicitly requested staged rollout or the compatibility analysis proves it necessary.

## Canonical sources

- Feature catalog: `packages/protocol/src/features/catalog.ts`.
- Feature decision primitives: `packages/protocol/src/features/featureDecisionEngine.ts`, `packages/protocol/src/features/decision.ts`.
- Server enabled-bit helpers: `packages/protocol/src/features/serverEnabledBit.ts`.
- `/v1/features` payload schema: `packages/protocol/src/features/payload/featuresResponseSchema.ts`.

## Payload contract

- `features` is the only location for gates.
- Gates are booleans under `features.<featureId path>.enabled`.
- `capabilities` may contain configuration, details, diagnostics, or explanations, but clients must not use it as a gate.
- Treat missing or malformed server enabled bits as disabled. Call-site checks must be `readServerEnabledBit(payload, featureId) === true`, never `!== false`.

## Dependencies

- Dependencies are declared only in the protocol feature catalog.
- Enforce dependencies through `applyFeatureDependencies(...)`.
- Do not duplicate dependency logic at call sites.

### External Sessions feature id

**External Sessions** is the product and UI name. Its deployed feature id remains exactly `sessions.direct`.

The feature catalog has no alias or canonicalization seam, so `sessions.external` is not a valid alias and must not be added as a second id. Doing so would create two independent gates for one capability. Use `sessions.direct` in feature decisions, local policy, test names, and dependency declarations; use External Sessions in user-facing copy.

The catalog entry is client-represented, has `defaultFailMode: 'fail_closed'`, and declares no dependencies. Consumers must resolve it through the canonical feature decision runtime rather than reading a server bit or inferring availability from an Agent registration.

Features that declare `sessions.direct` as a dependency, including the current Claude unified-terminal and Codex app-server feature rows, are disabled by `applyFeatureDependencies(...)` when External Sessions is disabled or unknown. Call sites must not reproduce or bypass that dependency closure.

### Session Agent switching feature id

`sessions.agentSwitching` gates continuing one Session with another Agent (`agent-transition.md`).
It is server-represented, `defaultFailMode: 'fail_closed'`, and depends on `sessions`.

Its server value is produced by `resolveSessionAgentSwitchingFeature`
(`apps/server/sources/app/features/sessionAgentSwitchingFeature.ts`), registered in
`apps/server/sources/app/features/catalog/serverFeatureRegistry.ts`, reading
`parseBooleanEnv(env[FEATURE_ENV_KEYS.sessionsAgentSwitchingEnabled], true)`. It is therefore
**enabled by default**, with `HAPPIER_FEATURE_SESSIONS_AGENT_SWITCHING__ENABLED` as an operator
opt-out. The registry is resolved at process start, so changing it needs a server restart.

Default-on and `fail_closed` are orthogonal and both correct: a server that answers advertises
`true`, while a missing or malformed bit resolves to the client's disabled default. `sessions.folders`
is the same combination and is the shape to copy.

### Workflows feature id

`workflows` is the single availability decision for structured Workflow authoring, execution,
inspection, storage, and Action/MCP surfaces. It is server-represented, fail-closed, and depends
on `automations` in the Protocol catalog. The dependency resolver, not callers, disables Workflow
when Automations is unavailable.

`resolveWorkflowsFeature`, registered in the one `serverFeatureRegistry`, reads
`HAPPIER_FEATURE_WORKFLOWS__ENABLED` and defaults on after the approved integrated activation.
This default means a current Home explicitly advertises support; it does not make absence truthy.
Current clients and daemons treat a missing or malformed `features.workflows.enabled` bit as
disabled, so they safely degrade against an older Home. Older clients drop the additive unknown
field and retain their representable one-shot Automation behavior.

Workflow-owned server routes use `createServerFeatureGatedRouteApp` with `workflows`. Runtime
registration, UI routes, and Action/MCP availability consume the same catalog decision through
their existing feature-policy owners. The incumbent `automations` bit is not a proxy for Workflow,
and capabilities, Action presence, route probing, or local environment checks must not replace the
canonical decision. The gate controls availability only; existing authorization, Account mode,
machine assignment, definition validation, runtime currentness, and permission checks still apply.
The shared V3 Automation API remains available for one-shot recipes; its canonical Run admission
and claim owners reject/filter Workflow-v2 recipes when `workflows` is disabled, including Run Now,
without hiding or poisoning claim pagination for ordinary Automation work.

### Connected Services pool quota-limit selection

`connectedServices.poolQuotaLimitSelection` gates authoring and projection of the optional
`quotaLimitSelection` pool policy. It depends on both `connectedServices.accountFallback` and
`connectedServices.quotas`. Servers preserve a stored selection while the feature is disabled,
but omit it from group responses and reject attempts to author it; clients therefore cannot
mistake a strict older reader for support. Absence and `{ mode: 'all', providerLimitIds: [] }`
both keep the predecessor behavior of using every provider-reported allowance.

Provider plugins remain the sole owners of allowance identity and model applicability. The pool
stores only stable `providerLimitId` values already present in quota snapshots. A selected id that
is temporarily unreported remains selected and produces unknown quota evidence rather than
silently falling back to all limits.

The gate is **enforced at the server boundary**, not only in the UI. The cutover route
(`registerSessionAgentTransitionRoute`) carries
`createServerFeatureGatePreHandler('sessions.agentSwitching')`, so a server with the opt-out set
answers `404 { error: 'not_found' }` and the lifecycle mutation never runs — a hidden surface is not
a gate. That route is the only place the switch becomes durable, so one gate at that choke point
refuses the operation for every caller, UI or not.

### Teams feature id

The development-only Teams implementation uses the single server-represented `teams`
feature id. `resolveTeamsFeature`, registered in `serverFeatureRegistry.ts`, enables it by
default; operators can opt out with `HAPPIER_FEATURE_TEAMS__ENABLED=0`, and the existing
build policy can deny it. An absent payload field defaults to disabled, so older Homes do
not advertise Teams support.

Team domain routes must use `createServerFeatureGatedRouteApp`. The bit controls availability;
current Home and Team capabilities still authorize each operation. Home Account lifecycle,
Home roles, owner protection, and Home Administration remain core behavior and do not use
a separate `home.governance` gate.

The in-progress credential-sharing implementation uses the child gate
`teams.credentialResources`, which depends on `teams` in the canonical catalog.
Its server resolver defaults to disabled and requires the operator opt-in
`HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES__ENABLED=1`. Missing child bits default
to disabled on every Home. This development gate does not establish resource
entitlement, source readiness, or completion of the administration and broker flows.

External API access uses the narrower
`teams.credentialResources.externalApi` gate and depends on
`teams.credentialResources`. It also defaults off and requires
`HAPPIER_FEATURE_TEAMS_CREDENTIAL_RESOURCES_EXTERNAL_API__ENABLED=1`. The dependency
resolver keeps it disabled unless the parent credential-resource vertical is enabled.
This bit controls route availability only; current resource, membership, key, policy,
limit, and broker admission remain mandatory for every request.

### Session collaboration feature ids

`sessions.collaboration` is the one current-component boundary for Account,
Team, and Group Session grants, responsibility, primary-Team context, and atomic
initial access. It depends on `sessions` and the released `sharing.session`
capability. `resolveSessionCollaborationFeature` is its only server producer and
defaults it off while the complete current-component vertical remains under
loaded and compatibility validation. Operators may explicitly enable it with
`HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED=1`; the dependency resolver
still forces it off when normal Session sharing is unavailable.

The current grant and responsibility routes are mounted through
`createServerFeatureGatedRouteApp`, and UI hosts consume the exact Home's same
published decision through `useSessionCollaborationAvailability`. No route or
client reconstructs a Team/Group dependency locally. The older
`sharing.session` decision remains the independent released Account-direct
sharing boundary: when collaboration is absent, the current Access editor uses
the released direct-only adapter rather than hiding direct sharing or probing a
new route by failure.

Human Session presence is not governed by `sessions.collaboration`. It is an
independently negotiated socket protocol over an already readable Session, so a
Home that supports released direct sharing can expose presence without claiming
Team/Group grants or responsibility. Session-to-Session Follow remains under
the separate `sessions.following` owner and runtime capability; neither feature
bit is a substitute for current access admission.

Default-off preserves the full collaboration feature while its mounted vertical
is completed. It is not permission to delete Account/Team/Group access,
responsibility, presence, public links, or the Access editor, and it must not be
split into mechanism-level feature bits.

### Session Conversations feature id

`sessions.conversations` gates the Session-owned human Conversation routes and mounted
Collaboration surface. It is server-represented, fail-closed, and depends exactly on
`sessions.collaboration`; the dependency is declared in the Protocol catalog and applied by
`applyFeatureDependencies(...)`.

Its server value is produced by `resolveSessionConversationsFeature`, registered in the one
`serverFeatureRegistry`, from
`HAPPIER_FEATURE_SESSIONS_CONVERSATIONS__ENABLED`. The resolver defaults off while the complete
Plain/E2EE create, post, read, realtime, draft, and attention journey remains under integration.
Explicit enablement still resolves false when Session collaboration is absent, disabled, or
malformed. The nested Discussion routes use `createServerFeatureGatedRouteApp`, while the UI
consumes the same published decision through `useFeatureEnabled`; neither side reconstructs the
dependency locally.

Default-off preserves the full feature while its mounted vertical is completed. It is an
activation boundary, not permission to delete Conversation functionality or split it into
smaller feature bits. Change the default only after the canonical plan's composed activation
evidence is complete.

### Session Board feature id

`sessions.board` is the single development-only availability decision for the shared Session
Board, its exact `surface` System Record reads, the atomic Board mutation route, Board Actions,
and every client entry point. It is server-represented, `defaultFailMode: 'fail_closed'`, and
depends only on `sessions` in the Protocol catalog.

`resolveSessionBoardFeature`, registered in the one `serverFeatureRegistry`, reads
`HAPPIER_FEATURE_SESSIONS_BOARD__ENABLED` and also consumes the existing Session System Records
v1 activation fact. The environment value defaults off; missing and malformed values remain
off. Explicit enablement therefore publishes `true` only after the current Home's System Records
contract is active. A missing or malformed payload bit is also disabled on clients. Keep this
default off until the approved Lane 08 native Board activation and loaded compatibility evidence
is complete; default-off preserves the implementation and stored records rather than removing
Board features.

The Board aggregate route and exact host `surface` reads enforce this decision before mutation or
disclosure. Generic System Record writes cannot mutate the typed-only Board kinds. UI, CLI, and
Agent/native-tool consumers resolve the same decision for the exact Session Home; they do not use
the selected Home, capabilities, plugin presence, renderer availability, or route probing as a
substitute. The bit controls availability only. Current `readTranscript` and
`editSessionRecords` capabilities, storage mode, Action policy, installed-plugin currentness, and
renderer admission remain separate decisions at their existing owners.

Hosted HTML and installed `sessionWidget` content do not add feature bits. They are source/runtime
availability within an enabled Board. Unsupported renderers and unavailable plugins preserve the
shared item and show a recoverable unavailable state.

### Temporary computer feature id

`sessions.ephemeralRunner` is the single development-only gate for the Temporary computer
creator flow and the Happier Runner activation route family. It is server-represented,
fail-closed, and depends on `sessions`, `machines`, and `sessions.drafts` in the Protocol
catalog. The dependency resolver therefore keeps it unavailable when ordinary Sessions,
Machine identity, or the synchronized waiting-draft owner is unavailable; routes and clients
must not reconstruct that dependency locally.

`resolveSessionEphemeralRunnerFeature`, registered in the one `serverFeatureRegistry`, reads
`HAPPIER_FEATURE_SESSIONS_EPHEMERAL_RUNNER__ENABLED`. The resolver defaults off. Missing or
malformed payload bits are also disabled, so a current client hides Temporary computer against
an older Home and ordinary Session creation remains usable.

The bit gates route availability only. It does not prove that a signed Runner artifact exists,
that the selected Agent and trusted external plugin generation can run on the target, that an
exact broker Machine is ready, or that the creator and restricted runtime are authorized.
Those decisions remain with their existing publication, Agent/plugin, broker, authentication,
and Session-access owners. Keep the default off until one complete creator → endpoint →
materialized ordinary Session → real turn → ordinary-feature parity → Stop journey passes for
a supported target. This activation boundary preserves the full feature; it is not permission
to remove unfinished Runner capabilities or split them into mechanism-level flags.

### Machine Pools feature id

The 0.3 development implementation uses the single server-represented
`machines.pools` feature id for personal Pool administration and resolution. It is
`defaultFailMode: 'fail_closed'`, enabled by default, with
`HAPPIER_FEATURE_MACHINES_POOLS__ENABLED` as the operator opt-out. Its only declared
dependency is `machines`, the Machine control-plane parent; there is no Teams
dependency, and dependency evaluation stays with the shared catalog owner rather
than a Pool-local check. Missing or malformed payload bits are disabled, so clients
do not expose or call Pool operations against an older Home.

The server gate covers all six `/v1/machines/pools/*` routes through the shared
`createServerFeatureGatePreHandler` owner, ahead of the route body and before any
Pool data is read. A disabled feature answers `404 { "error": "not_found" }`, the
default refusal envelope, rather than a Pool-specific disabled code. Current Account
and Machine ownership checks remain separate authorization decisions; the feature bit
never grants access. Exact Machine selection, existing session creation, picker
consolidation, and socket identity extraction are existing behavior and stay ungated.
Once a Pool resolves, the normal exact-target path is used without consulting this
feature again.

`resolveMachinePoolsFeature` is the only server producer, and it publishes a feature
bit only. The family adds no `capabilities` leaf, and consistent with the general
rule above, nothing in `capabilities` may be read as a Pool gate: only
`readServerEnabledBit(payload, 'machines.pools') === true` enables the family.

The decision is Home-specific. In a multi-Home client, one Home may expose Pool
administration and selection while another does not. Definitions never migrate or
merge across Homes, and an unsupported Home still contributes its ordinary exact
Machines. A missing bit, failed feature read, or signed-out Home must not be treated
as an empty-but-current Pool list or a zero-connected observation; clients may keep
cached rows only as unavailable context until the canonical projection refreshes.

This gate enables personal Pool administration and the Pool choices in New Session
and credential-resource editing. The credential-resource routes remain independently
gated by `teams.credentialResources`; neither bit grants Team, resource, source, or
Machine authority.

Current development source supports Pool-backed broker placement. The source-owning
daemon answers a current-only, content-free eligibility request for each generically
available candidate, the Home applies the one Pool selector, and the existing broker
path receives one exact Machine. That Machine stays pinned for the broker lifetime;
reconnect and signed-authority renewal revalidate the resource, source, request
policy, Machine, endpoint and usage admission without reranking the Pool. Resource
readers who are not the source owner never receive the personal Pool identity or
roster. Exact-Machine brokerage is unchanged and does not depend on this feature.

Advanced capacity admission, sharing, automatic failover, and Team-owned Pools remain
deferred product extensions, not additional hidden feature bits and not removed
requirements.

### Search feature id

`search` gates Personal Home plaintext transcript search: the Home derived-index lifecycle and its
authenticated query route. It is server-represented, `defaultFailMode: 'fail_closed'`, and declares
no dependencies — in particular it does **not** depend on `memory.search`, which gates only
daemon-local memory indexing/search and its settings surfaces.

Its server value is produced by `resolveSearchFeature`
(`apps/server/sources/app/features/searchFeature.ts`), registered in `serverFeatureRegistry.ts`,
reading `parseBooleanEnv(env[FEATURE_ENV_KEYS.searchEnabled], true)`. It is therefore **enabled by
default**, with `HAPPIER_FEATURE_SEARCH__ENABLED` as the operator opt-out, in the same default-on +
`fail_closed` shape as `sessions.agentSwitching`.

Admission is a lifecycle decision, not only a route check: `resolveHomeSearchRuntimeConfig`
(`apps/server/sources/app/search/homeSearchCapability.ts`) returns `null` when the feature is off,
so no derived index is opened, no reconciliation runs, `registerHomeSearchRoutes` is never called,
and `/v1/features` omits `capabilities.homeSearch` entirely. There is no `feature_disabled`
capability reason.

`capabilities.homeSearch` is diagnostic only — readiness, `indexing`, and `index_unavailable`. It
never authorizes the route or the client provider decision: the UI requires the `search` bit **and**
a ready capability before choosing the Home provider (`useMemorySearchProvider`). The universal
search shell itself is ungated; only the Home transcript section depends on this feature.

### Provider feature dependencies

The first-class model-provider program uses these canonical ids:

- `providers` — Provider settings, registry projection, connection resolution, and Provider UI/CLI surfaces;
- `providers.localDiscovery` — local process/listener candidate discovery; depends on `providers` and `localServices.inventory`;
- `providers.localModelManagement` — local model load/unload management; depends on `providers`.

`localServices.managed` gates only the Local Services product and UI surfaces for managed launch, naming, health, and lifecycle. It is not a Provider gate and must not guard or alias the public managed-Provider runtime (`/managed-services`, SVC09), whose admission stays under the Provider feature boundary. Provider discovery never implies process ownership or permission to manage an adopted process.

Provider gates are enforced before reading Provider settings, resolving Saved Secrets, probing the network, or starting processes. Missing gates and unmet dependencies fail closed; callers must not reconstruct these dependencies from capabilities or process state.

## Build policy

Global allow/deny policy lives in protocol:

- `packages/protocol/src/features/buildPolicy.ts`
- `packages/protocol/src/features/embeddedFeaturePolicy.ts`

Inputs come from:

- `HAPPIER_BUILD_FEATURES_ALLOW`
- `HAPPIER_BUILD_FEATURES_DENY`
- `HAPPIER_FEATURE_POLICY_ENV`
- `HAPPIER_EMBEDDED_POLICY_ENV`

Server assembly of `/v1/features` applies build-policy denies centrally in `apps/server/sources/app/features/catalog/resolveServerFeaturePayload.ts`. Route handlers must not re-evaluate build policy ad hoc.

## Default enablement for experimental UI toggles

For features intended to be user-opt-in via UI Experimental Features toggles:

- Server-represented gates should generally default to allow so the UI can display the toggle.
- Client/UI policy should default to disabled so users explicitly opt in.
- Prefer build-policy denies for builds where a feature must be removed or hard-disabled.
- Security/compliance-sensitive features may default fail-closed on the server; document and test that exception.

## Server rules

- A server-represented gate needs a **resolver registered in `serverFeatureRegistry.ts`**, not only a
  catalog entry. Without one, nothing ever writes `features.<id>.enabled`, so
  `readServerEnabledBit(...)` returns the schema default in every deployment, permanently, and the
  feature is dark everywhere while its client half looks complete. This shipped once
  (`sessions.agentSwitching`). When a gated surface never appears, check the producer before the
  consumer.
- `/v1/features` assembly is centralized in `resolveServerFeaturePayload.ts`.
- Route gating should use `apps/server/sources/app/features/catalog/serverFeatureGate.ts`:
  - `createServerFeatureGatePreHandler(featureId)`
  - `createServerFeatureGatedRouteApp(app, featureId)`
- Do not add per-route env-only bypasses for server-represented features.

## CLI rules

- Resolve feature decisions through `apps/cli/src/features/featureDecisionService.ts` and owned helpers.
- CLI local policy belongs in `apps/cli/src/features/featureLocalPolicy.ts`.
- For server-represented features, no server snapshot is fail-closed/unknown.

## UI rules

- Resolve feature decisions through `apps/ui/sources/sync/domains/features/featureDecisionRuntime.ts`.
- Rare direct server-bit reads must use `readServerEnabledBit(snapshot.features, featureId) === true`.
- Prefer `FeatureDecision.state` over raw booleans.
- UI design/copy for feature-gated surfaces still follows UI token, text-scaling, and translation rules in `apps/ui/AGENTS.md`.

## Feature-scoped tests

Feature-scoped tests include `.feat.<featureId>.` in the filename, for example:

```text
something.feat.connectedServices.quotas.slow.e2e.test.ts
```

Vitest excludes denied feature tests using `scripts/testing/featureTestGating.ts` with dependency closure. Use `HAPPIER_TEST_FEATURES_DENY` in addition to `HAPPIER_BUILD_FEATURES_DENY` when a feature's tests must be disabled in CI without changing embedded policy.
