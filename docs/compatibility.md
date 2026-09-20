# Compatibility and version skew

This document defines when Happier preserves old behavior across UI, CLI, daemon, server, installers, and persisted state. The goal is safe upgrades and mixed-version operation without turning undeployed implementation history into permanent compatibility debt.

## Trigger

Apply this policy when a change affects a cross-component wire shape or semantic, persisted/session/settings data, schema or migration, feature/capability negotiation, installer or service state, upgrade/coexistence, or rollback. Routine internal refactors that leave these seams unchanged do not need a compatibility matrix or shim.

## Baseline classes

### Hard released obligations

- Active stable and preview releases count because both can exist on user machines or deployed infrastructure.
- Resolve each component independently. UI, CLI/daemon, server, desktop/mobile, and stack tags may point to different commits.
- Discover the current channel through rolling tags such as `cli-preview`, then record the immutable component version tag, commit, and relevant artifact/deploy evidence used by the check.
- Older releases count only when explicitly supported by policy or task scope; tag existence alone does not imply indefinite support.

### Moving `../0.2` predecessor frontier

- `../0.2` is expected to ship before this repository. Its real current on-disk code is a prospective compatibility input even when it is uncommitted or not yet released.
- Inspect committed, staged, and unstaged code in the relevant paths. Record `HEAD`, working-tree status, the relevant diff/basis, and what was directly observed versus inferred.
- Never modify or clean the sibling worktree. Dirty changes may be incomplete or concurrently owned; if the externally observable contract is contradictory or unknowable, report that uncertainty rather than inventing multiple speculative adapters.
- Track the latest observable prospective shape, not every superseded internal implementation. When the sibling evolves before deployment, refresh the comparison and remove support that existed only for a replaced, never-released intermediary shape.
- Recheck relevant sibling paths before handoff when they were dirty or advanced during the task. Released stable/preview shapes remain hard obligations regardless of later sibling changes.

### Non-obligations

- `dev`/`*-dev.*` builds, untagged history outside the live predecessor frontier, abandoned experiments, and undeployed internal module paths are not lasting compatibility contracts.
- Do not keep aliases or adapters solely for an atomic internal rename/move whose old path never shipped.
- The predecessor rule preserves observable wire/data/state behavior, not `../0.2`'s internal architecture.

## Map the seam

For the changed concept, identify:

- the canonical domain owner;
- every producer, consumer, reader, writer, serializer, parser, and persisted artifact;
- the old/new component versions that can actually meet during rollout or rollback;
- the wire, semantic, persistence, and operational expectations at that seam;
- any existing split-brain, duplicate decision path, fallback, or compatibility adapter in the touched corridor.

An existing same-concept split-brain in the touched corridor must be consolidated at the canonical owner. A compatibility adapter may translate released or predecessor shapes, but it must not independently decide domain behavior.

## Direction and rollout

- New readers accept supported old shapes; new writes use the canonical current shape.
- Old readers need to accept new writes only when coexistence, independent component rollout, or rollback makes that direction reachable.
- New clients talking to old servers must capability-negotiate or degrade safely instead of assuming the new contract.
- Old clients talking to new servers retain released behavior for ordinary compatible changes and for every operation the new server can still execute safely. A major incompatible server change may require a newer client for the affected operation, but that support boundary is an explicit developer/product decision—not an agent-selected default.
- Persisted-state changes consider both old-writer → new-reader and, when rollback/coexistence is supported, new-writer → old-reader.
- Prefer operation-scoped graceful degradation over connection-wide rejection: admit the old client, keep unaffected reads and writes available, and return a typed upgrade requirement only when the requested operation cannot be performed safely. Reject the whole connection only when no authenticated operation can be made safe. `agent-transition.md` is the current worked example: an old daemon answers `session.agentTransition` with `RPC_METHOD_NOT_AVAILABLE`, the client maps that one code to a no-effect operation-scoped rejection, every other transport failure maps to an indeterminate outcome rather than a false "nothing happened", and Machine presence — not the error — decides whether the reader is told to update the CLI or that the machine is offline.
- For an incompatible transition, prefer prepare/expand → activate/migrate → contract when mixed-version coexistence or rollback is an approved requirement. Do not assume that old clients must read new writes merely because the server is self-hosted.

Before adding dual writers, parallel persisted formats, rollout modes, operator flags, socket-drain protocols, or a mandatory client floor, compare their lifetime cost with the actual user behavior required. If preserving old-client/new-server behavior for a major change would require substantial machinery, stop and obtain an explicit developer/product decision among: operation-scoped degradation, a documented client update requirement, or the heavier compatibility transition. An agent must not silently choose either forced upgrades or heavy compatibility machinery. This exception is for genuinely incompatible, high-cost transitions; routine server changes must remain compatible and must not manufacture client-update requirements.

### Current-Session presentation custody (development)

Current-Session presentation bind, acknowledgement, and retirement are
Session-owner-only RPCs. The Home stamps the authenticated Account and exact
socket connection onto the private forwarded authorization context; public
`clientId`, focus, and acknowledgement fields never establish custody. The
UI issues these connection-affine RPCs only through the active Home's persistent
socket: an active-socket pre-issuance failure is preserved, and an explicit
non-active Home fails closed instead of creating an ephemeral scoped socket. The
daemon accepts an acknowledgement or retirement only from the exact origin that
won the current process-local binding, and the Home retires that origin when its
socket disconnects. A mounted UI also retires the exact binding on unmount or
Account/Session-scope retirement. Rejected binds are read-only and do not clear
an incumbent command.

This contract is development-only and ephemeral: it adds no persisted binding,
lease, timer, generation, or compatibility registry. The inspected prospective
`../0.2` predecessor has no Current-Session presentation RPC, so there is no
older wire shape to retain; new callers fail closed when the method is absent.

### Browser request headers and CORS

A new browser request header changes both the endpoint contract and its CORS preflight contract. Before shipping one, test the new client against the exact supported predecessor relay and verify that every value in `Access-Control-Request-Headers` is already accepted by that relay's `Access-Control-Allow-Headers`. Adding the header to only the current relay's allowlist does not preserve new-client/old-relay compatibility: the browser rejects the request before the endpoint can negotiate or degrade it.

Prefer an existing CORS-safelisted header, a query parameter, or the request body for non-sensitive capability negotiation. Use a custom request header only when its semantics require one and supported predecessor relays already allow it or explicitly negotiate that support. Validate the real `OPTIONS` request for every reachable browser-origin/relay direction rather than relying only on same-process route tests. When browser code needs to read a new response header, include and verify the corresponding `Access-Control-Expose-Headers` contract as well.

### Self-hosted relay release checks

The public release profiles treat self-hosted relay upgrades as independent
component upgrades, not as a fleet migration protocol. For a stable release,
prioritize these directions:

- current UI, CLI, and daemon core flows against a supported older
  self-hosted relay;
- bounded core flows from a supported older client or daemon to the current
  relay, preserving unaffected operations and returning a typed update
  requirement only for an unsafe operation;
- persisted state written by the supported prior release read by current
  readers; and
- current-writer to supported old-reader only when rollback or coexistence
  can actually make that direction reachable.

The release agent derives the affected, reachable directions from the actual
diff and supported released baselines while it performs the initial release
inspection, before release-note/version materialization or a release commit.
That single inspection also owns the public-note proposal and validation
selection. After materialization, the agent only confirms that the final delta
contains the approved release inputs and no unexpected runtime-reachable
change; a full second analysis is required only when the source contract
changed. Exact scripts can prove named behaviors
against named artifacts—for example the published-server-v0.2.1 pending-queue
regressions or a `docker-release-assets` published-channel → local-build
upgrade—but none of them issues a general compatibility verdict. The Docker
upgrade suite runs in a normal profile only when the diff affects relay
storage/schema, startup/runtime dependencies, authentication persistence,
encryption storage, or upgrade behavior, the release changes the server, and a
supported published relay predecessor exists. A server version change alone is
insufficient. Broader installer, platform, and
historical-version exploration remains risk-selected deep certification.
Release orchestration does not wait for every
self-hosted process, impose a mandatory client floor, orchestrate a database
migration, or coordinate a global cutover.
If a concrete migration has a writer-drain or maintenance-window requirement,
its dedicated migration procedure owns that external operation.

### Automatic pool quota-reset opt-in (development)

The shared V1 pool policy accepts optional `autoUseQuotaResetsWhenExhausted`;
absence means false and is not materialized on reads. Current qualified V4 pool
routes mask this field while `connectedServices.autoQuotaReset` or a dependency
is disabled. They preserve the saved choice, and policy edits merge against stored
policy so an edit from a masked reader cannot erase that choice. Re-enabling the
feature makes the stored choice effective on subsequent recovery reads.

The UI offers the opt-in only with the server feature bit and an applied Connected
Account descriptor declaring `recoveryCredits: { supported: true }`. The descriptor
fact is projected with the service; the runtime additionally requires the matching
recovery-credit facet. Missing facts fail closed.

The 0.2 source-line Accept-header adapter protects strict released V3 group readers.
It is not revived on this development line: pools use qualified V4 identities and
the retired V3 group endpoints are not a current transport. This change does not
establish rollback from development V4 storage or plugin descriptors to 0.2.
The locally available stable and preview predecessors `server-v0.2.11`,
`server-v0.2.11-preview.2`, `cli-v0.2.11`, and `cli-v0.2.11-preview.2` all
resolve to `98ea8fb76733b1dd785d38c31360179cafa84824`; their route, API, and
Connected Account schema trees have no qualified V4 group transport.

### Pool quota-limit selection (development)

`quotaLimitSelection` is optional in the shared V1 pool policy; absence and
`mode: 'all'` retain predecessor behavior. Qualified V4 readers and writers use
the same policy owner, and older 0.2 readers reach their released compatibility
projection rather than the V4 transport.

`windowDurationMs` is an optional additive quota-meter fact. Updated readers use
it only for presentation; absence preserves existing meter semantics and older
readers ignore it. Pool-selected display projection filters only meters and
preserves account-, subscription-, freshness-, and recovery-credit fields.

### Model-entitlement pool disable opt-in (development)

`autoDisablePlanInvalidAccounts` is another optional V1 policy field whose
absence means false. Qualified V4 routes expose and accept it only while
`connectedServices.autoDisablePlanInvalid` and its fallback dependency are
enabled; masked policy edits preserve any stored choice. No 0.2 Accept-header
adapter is revived on this line.

The Codex plugin emits model-scoped `plan_invalid` evidence only for the exact
ChatGPT-account unsupported-model response. The daemon records a 24-hour
per-model exclusion. When the pool opt-in is true it also disables that member;
manual re-enable clears the automatic-disable marker and runtime blockers.
Generic or provider-scoped `plan_invalid` evidence never triggers persistent
disable. Qualified V4 persists the marker, model cooldown, and disabled flag in
one member mutation guarded by both group generation and runtime-state revision.
The projected `ConnectedAccountUiProjectionEntryV1` contract is also absent from
that predecessor; its current strict development schema adds the optional
recovery-credit declaration together with its producer and UI consumer.

### Direct sharing and Account erasure (development)

The development Account-erasure transaction preserves direct grants that the erased
Account authored on somebody else's Session. The canonical grant service reassigns
their non-null `SessionShare.sharedByUserId` to that Session's owner, preserving the
grant identity, access level, permission delegation, key envelope, and creation time.
This field is current compatibility provenance, not immutable audit history or access
authority. Existing direct-share readers continue to receive a real Account profile.
Received grants are removed, and owned Sessions use the ordinary recipient-aware
deletion lifecycle. Direct and public access logs retain their existing policies:
erasure removes logs identifying the erased Account, and deleting a share cascades
its logs; logs for surviving shares and other Accounts remain subject to normal
retention.

### Session access projection normalization (development)

Current Session readers treat a valid strict `effectiveAccess.v = 1` projection as
the sole access presentation authority. A present but malformed current projection
is unavailable and cannot fall through to released owner/direct inference. Only
true absence of `effectiveAccess` permits the released `share` translation; that
translation never represents Team- or Group-only access.

That rule has one implementation: `readSessionAccessProjectionRoleV1` in
`packages/protocol/src/sessions/access/sessionEffectiveAccessV1.ts`, which maps a Session
record to `owner`, `recipient`, or `unavailable`. It is representation normalization only
and never decides authorization. A record with neither field is treated as released owner
content when `metadataLayoutVersion` is absent or `0`, and as unavailable otherwise, so a
newer layout a reader does not understand fails closed instead of being read as ownership.
Persistence keeps the same separation the projection does: `SessionShare` is the direct
grant table only, while `SessionTeamGrant` and `SessionGroupGrant` hold collective grants
that a released reader never sees — see
[session-collaboration.md](session-collaboration.md).

The UI preserves the same distinction through hydration, access events, Voice,
encryption migration/key resolution, and reconnect state. Its additive warm-cache
field stores the current effective projection, or `null` for malformed-current
unavailability. Older cache entries without that field remain readable through the
released flattened fallback. Released direct-share events may refresh a normalized
legacy projection only when it has no current `sources`; they never replace a
sourced current projection or the fail-closed `null` marker.

Server-side, the released owner/direct seam and the version-qualified current seam
are two presentations of one access decision, not two admissions. Released
unqualified V2 lists and unqualified by-ID detail leave Team and Group grants out
of the answer, but they resolve through the same
`resolveSessionAccessForOperation` owner, so omitting `accessProjectionVersion`
cannot widen a credential: a verified Session-scoped Runner principal stays a
capped `edit` recipient with no owner metadata on both projections, and its
persisted activation/Machine/AccessKey binding is revalidated on both. The
released branch passes the row it already loaded to that owner rather than
projecting access itself.

The prospective `../0.2` predecessor inspected at
`ac30c50856abd2265c14459e77ee3384da1698ad` (branch `dev`, clean) in the relevant CLI/UI
Session-detail consumers:
`apps/cli/src/session/transport/http/sessionsHttp.ts`,
`apps/ui/sources/sync/engine/sessions/sessionById.ts`, and
`apps/ui/sources/sync/runtime/orchestration/serverScopedRpc/fetchSessionByIdWithServerScope.ts`.
The committed Account/client encryption requirements do not change listing
or access-projection behavior. The predecessor still has no `effectiveAccess`
producer or consumer and no ephemeral Runner. Its `V2SessionRecordSchema` and
`SessionSummarySchema` remain `.passthrough()`, so current additive projection
fields are accepted, and new clients fail closed against it through the
`sessions.collaboration` decision rather than negotiating a parallel shape.

### Session draft rollout

The current development UI stores browser draft repositories and pending-message outboxes in
IndexedDB, outside Web Storage's small synchronous quota. Native clients retain MMKV. Browser
startup prepares drafts before restoring Sync or rendering draft consumers; a failed preparation
uses the existing app recovery boundary rather than treating saved drafts as absent.

The draft repository writes a compact local v2 envelope and reads both v1 and v2. Equal base/local
documents and pending fields are stored once and reconstructed on read; independent conflict
values are retained. This does not change the synchronized draft document or server wire format.
Older UI binaries cannot read this local v2 representation.

Legacy browser values are removed only after their IndexedDB transaction commits. Migration
preserves conflicting copies and reports a failure instead of silently choosing one. Reload older
open tabs when updating the UI so they stop writing the retired Web Storage records. Concurrent
editing from an unupgraded tab during migration is not supported: old Web Storage writers cannot
participate in IndexedDB transactions. Browser
outbox operations await local transaction completion before reporting local custody; enqueue
acknowledgements cannot retire a concurrently recorded cancellation.

Draft autosaves retain failed writes in memory, expose the existing error status, and retry through
the repository's flush owner. Browser draft updates preserve unrelated replicas written by another
tab and reject conflicting changes to the same replica. IndexedDB still has browser/disk limits:
an error is not permission to discard drafts or pending messages, and unsaved in-memory edits must
be preserved before reloading. These device-local stores are not substitutes for server acknowledgement.

Synchronized Session drafts are negotiated through the `sessions.drafts` server feature bit. A new
client fails closed when that bit or the typed routes are unavailable and retains the incumbent
local-only behavior; it does not send draft records through generic Account KV routes. A capable
server reserves the draft KV prefix so old generic-KV clients cannot read or overwrite typed draft
rows.

Development V2 draft operations use the same repository, physical rows and CAS while preserving
strict V1 reads, writes, conflicts, cursors and events. V2-only Run/discussion addresses and
successor new-Session content use the distinct V2 socket and AccountChange hint schemas. Current
clients materialize their exact addresses before advancing the change cursor. Account encryption
transitions opt into the V2 draft directive only when the captured new-Session content needs it;
older strict servers reject that directive before mutation. The
[Account transition contract](./encryption.md#account-mode-transition-status) owns resealing and
replay; Session-bound drafts never participate solely because their address uses V2.

### Released V2 manual Automation compatibility

Released V2 clients represent a manually invoked Automation as `schedule.kind: 'manual'`.
The current trigger-set model represents the same user behavior as an Automation with zero
automatic triggers. The V2 API adapter is the only translation owner: V2 create/update accepts
`manual` and writes zero canonical trigger rows, while a current zero-trigger definition projects
back to V2 as `manual`. It does not recreate a manual trigger, scheduler, or V2 runtime.

A current definition with exactly one enabled cron or interval trigger retains the corresponding
released V2 schedule projection. Definitions with multiple, disabled, or non-schedule automatic
triggers are not representable by V2 and remain unavailable through that compatibility surface;
the adapter never hides one trigger or invents a misleading schedule.

Current servers advertise the additive `capabilities.automations.apiEpoch: 3` family independently
of the Automation feature bit. Its absence means the released V2-only contract. Current UI and CLI
clients keep representable one-shot definition reads, lifecycle mutations, assignment replacement,
deletion, and manual run-now usable through the narrow V2 translation adapter. Operations that
need current-only semantics—including managed Workflow admission—never downgrade or infer missing
Run cause/private state; they fail only that operation with typed `update_required` details and
leave unrelated Automation and Home operations usable. This negotiation adds neither a second
feature gate nor a client-wide server-version floor.

### Workflow Session input admission (development)

Workflow child prompts and direct final-result delivery use Session input admission
protocol V2. The two purposes carry workflow Run provenance directly; they do not
invent an Automation id or use Automation reply handoff. Updated Session readers
accept both V1 and V2 request, provenance and settled-authority records, while
Automation and other incumbent V1 writers retain their existing shape.

Automation workflow definitions use the strict stored recipe epoch `v: 2` in
the existing private Automation definition body. They have no synthetic legacy
target projection (`targetType` is `null`). At occurrence admission, the
incumbent Automation transaction creates the parent Run and attaches its opaque
definition envelope; occurrence evidence remains a separate frozen Automation
envelope. Before root coordination, the assigned daemon binds its canonical
payload to declared inputs exactly once and seals the immutable accepted
workflow snapshot used by origin-neutral Runs. Released V1 recipe and predecessor one-shot Runs
retain their existing claim and execution paths. Released V2 workers remain
restricted to their predecessor byte discriminator and therefore fail closed
for workflow Runs.

The internal Workflow storage admission operation accepts only a direct origin,
and its authenticated publisher Machine must equal the target Machine. An
Automation occurrence never enters through that route: its canonical Automation
transaction creates the parent and attaches the Workflow body there.

The workflow caller requires the exact target Machine capability
`sessionInputAdmission.protocolVersions: [1, 2]` before creating or mutating a
Session. Missing or malformed capability data returns the operation-scoped
`workflow_input_admission_update_required` result. It never downgrades the input
to V1, and unrelated Session operations remain available.

Each workflow input has one protocol-derived stable Pending identity. Invocation
identity includes the exact invocation record; final delivery uses the Run plus
the distinct `result_delivery` purpose. The existing Session Pending queue,
permission settlement and transcript observer remain authoritative. An omitted
workflow timeout selects explicit no-deadline observation; a supplied timeout is
carried as one absolute deadline and is not restarted when observation rejoins.

An attached Workflow Agent Run with host-stamped Workflow provenance uses the explicit
`initialInput.kind: 'deferred_session_pending'` start arm. That arm is valid only
for an attached, resumable, long-lived Agent Run and contains no instructions,
input id, or result contract: it creates the Run target, the Workflow store then
commits the exact Run/input correspondence, and only afterward does the owning
Session Pending queue admit the prompt. Detached starts continue to require the
real initial prompt. The daemon derives the Run identity from the existing
host-stamped Action request id for the exact Workflow input, so a response loss
or failed correspondence write rejoins the already-started Run instead of
starting or sending it again. This is Run-manager idempotency over the existing
Workflow input identity and Run registry, not a second Workflow receipt store.

Workspace restoration is an explicit development-only `workflow.run.resume`
recovery choice. The server projects only coarse eligibility from public Run
state and the existence of an execution row; the authorized client opens the
selected private progress row and requires its recorded creation intent and Git
worktree descriptor before offering Restore workspace. Execution is routed to
the exact Machine frozen in the accepted snapshot, restores only the recorded
checkout path through the incumbent SCM materializer, and publishes the new
attempt under the same expected-Run-revision check before any retry work starts.
It never falls back to a suffixed or newly selected checkout. Because managed
Workflow Runs remain development-only, this closed Action/availability addition
updates the current protocol in place and establishes no released mixed-version
compatibility adapter.

Managed Workflow Runs are origin-neutral `WorkflowRun` rows driven from the frozen accepted snapshot; observed Claude activity snapshots remain presentation-only and never drive the coordinator. Schedule and occurrence admission freeze the reviewed definition plus applicable Artifact revision: later library or Automation edits affect only future admissions, never admitted Runs. Deploy the current server before current clients create Workflow rows. Once a Workflow parent or invocation row exists, rolling that database back to an old server is unsupported: current servers exclude Workflow recipes from old workers while an old server would not. Recovery is forward migration only; there is no reverse migration, dual write, Workflow compatibility mode, or rollback-only writer. Released clients remain supported against the current server through the incumbent V2 Automation projection for ordinary representable Automations.

### Workspace-sync handoff rollout

Workspace handoff is operation-scoped across UI, daemon, and Machine RPC versions. A current
client may send the canonical `none`, `copy_once`, `create_relationship`, or existing
`relationship` action only to a daemon that understands that exact action. A predecessor daemon
that cannot execute the requested workspace action returns
`workspace_sync_update_required`; the client keeps the connection and unrelated Machine/session
operations usable and asks for that daemon to be updated. It must not reinterpret the request as a
legacy file-transfer job or report a successful handoff without the workspace result.

The current daemon remains the sole relationship-settings writer and uses the external Mutagen
sidecar as the sole reconciliation engine. Mutagen session identifiers and private broker details
are daemon-local implementation state, not wire or persistence compatibility contracts. A missing
verified external engine artifact is an `engine_unavailable` failure for the requested workspace
operation; it does not authorize a fallback to the retired replication engine.

The first capable client imports the retired local existing-Session text/semantic stores and the
singleton new-Session draft into the canonical draft repository. It removes each legacy value only
after the corresponding canonical record is durably acknowledged, so an interrupted import remains
recoverable. The legacy readers are migration adapters, not parallel writers, and may be removed
when supported persisted local state no longer requires them.

During supported 0.2/0.3 coexistence, the draft authoring map remains closed except for explicitly
enumerated compatibility keys. The 0.2 reader accepts and preserves the 0.3 `executionTarget`,
`organizationPlacement`, `agentTarget`, `modelSelection`, and `runtimeDescriptorV1` fields but does
not treat them as 0.2 execution authority. The 0.3 reader validates and preserves the published 0.2
`machineId`, `serverId`, `agentId`, `backendTarget`, `modelId`, and `codexBackendMode` fields; its UI
projects only exact safe equivalents into canonical execution, Agent, and native-model selections.
Canonical 0.3 fields, including explicit clears, win over predecessor values, and each version's
writers continue to emit only their native catalog. Remove these reader bridges only after
0.2/0.3 coexistence and persisted drafts from the other catalog are no longer supported inputs.

Draft documents preserve bounded unknown extension fields as JSON. This lets a client without a
newer composer contribution edit fields it understands without deleting newer semantic data; it
does not authorize that client to execute the unknown contribution. Raw generic-file bytes, local
file handles and URIs, credentials, secret values, and local presentation state remain outside the
compatibility shape. Plugin semantic attachments, mentions, fallback presentation, and opaque
execution-target-bound staged-media handles may round-trip; execution still fails closed when the
owning plugin or target is unavailable.

### Session-owned run input convergence (development)

The development Action contract sends Session-owned run input through
`session.message.send` with an optional strict participant recipient. Main
Session input omits the recipient. `execution.run.send` requires explicit
`sessionId: null` and retains direct delivery only for detached runs; its
`prompt`, `steer_if_supported`, and `interrupt` modes do not become Session
pending actions.

Attached `execution.run.send` calls receive
`session_input_target_update_required` before a direct send. The approved 0.2
compatibility adapter keeps the released request parser for this refusal; it
must not approximate the old delivery modes or retry against the main Session.
Remove that adapter only when the last supported 0.2 UI/CLI-to-current-daemon
attached-send direction closes. Existing run and transcript records remain
readable. Attached chat follows `session.message.send` Action settings, while
detached chat follows `execution.run.send`; settings are not copied between IDs.

Targeted admission requires the exact target Machine's `sessionInputAdmission`
revision 2 and the nested execution-run pending resource
`POST /v2/sessions/:sessionId/execution-runs/:runId/pending`. Released servers do
not match that nested route, so they cannot strip the target and report a
main-Session success. Missing support must fail before relay or mutation, without
dropping the recipient; a target send never becomes a main-Session send, and an
unavailable capability snapshot is withheld rather than published as a false
negative.

The reachable directions are:

| Direction | Required behavior |
|---|---|
| Released client main send → current stack | `required` — unchanged. Main input carries no recipient, takes no target query, and pays for no capability check. |
| Current client main send → supported released server/daemon | `required` — unchanged. The existing no-target path stays usable. |
| Current client targeted send → released or partial stack | `required` — fail closed before mutation with the operation-scoped `session_input_target_update_required`; no row, no relay, no recipient-dropping retry, and unrelated operations stay usable. |
| Released client attached `execution.run.send` → current daemon | `required` — the same operation-scoped refusal through the retained released request parser. Detached `sessionId: null` sends keep working. |
| Current target rows → released-server rollback | `unsupported` after activation. No dual writer, mirror, or rollback-only path exists for target rows; recovery is ordinary Pending state. |
| Released persisted rows → current readers | `required` — old pending rows read as the implicit main target (`targetExecutionRunId IS NULL`); transcripts, sidechains, and markers stay readable. Old terminal transcript rows have no server-private Run binding, so main-message retry remains compatible while a targeted terminal retry that cannot prove its exact target fails closed rather than inventing a match. |

The nested target resource, its strict body, and the plugin-facing recipient
projection are undeployed 0.3 development shapes: refine them in place at the
Action and admission owners rather than adding a reader for a superseded
intermediate. These are operation-specific development contracts; the composed
live target-send and mixed-version gates must pass before the feature is
described as available. The delivery semantics themselves live in
[Pending delivery architecture](pending-delivery.md#execution-run-targets).

### Deferred Action approvals (development)

Released `ApprovalRequestV1` Artifacts remain readable as history using their
released closed status vocabulary. They carry no current replay authority: a
current attempt to execute one fails safely as `approval_stale`. Current
effect-bearing approvals use strict `ApprovalRequestV2`, including the immutable
execution origin admitted before the user is asked to decide.

Approval is not an execution lock by itself. After an approval decision, the
existing Artifact is the durable effect-custody owner:

```text
open -> approved -> executing -> executed | failed
```

The executor must win the Artifact compare-and-set from `approved` to
`executing` before performing the effect. A duplicate caller reads the winner's
state instead of running the Action again. Current policy, credential, Home,
runtime, target, and resource authorization are revalidated against the stored
origin; the approving caller does not become the execution principal. If the
effect may have happened but terminal persistence cannot be proven, the
Artifact remains `executing` and later callers receive
`approval_execution_outcome_unknown`; they do not replay blindly.

The Artifact header is an index, not authority. Current readers hydrate the
body, validate its strict approval-family schema, and require every duplicated
header field to agree before presenting or acting on it. A contradictory or
unknown body/header combination fails closed.

This is an in-place development evolution, not a second approval store or a
backfill requirement. Undeployed target/plugin approval schemas may be refined
in place through the same Artifact owner. Released V1 bytes and readers remain
the historical compatibility boundary.

## Ephemeral Runner release compatibility (development)

`happier-runner` is a 0.3-only release product. Its strict V1 release manifest is
owned by `@happier-dev/release-runtime/releaseManifest`; the publisher validates
what it emits and the server is the only public-release acquisition adapter.
Activations pin product, version, target, and lowercase SHA-256, so an existing
activation never follows a rolling tag. The creator downloads the exact archive,
checksums, and Minisign signature named by that verified projection and applies
the same release-runtime verifier before local package assembly. It also requires
the archive basename to encode that exact product, version, and target before it
performs any network acquisition. An exhausted immutable release-tag `404` means
the version is not published; transport failures, other HTTP statuses, and
malformed publication metadata remain a retryable publication-unavailable result
rather than being reported as positive absence. The signed
checksum envelope carries the Runner archive's exact compressed byte size and
closed entry list (path, kind, expanded size, mode, and link target when
applicable); the release manifest and Home-safe projection must agree with that
signed metadata. Acquisition rejects compressed-byte overrun or underrun, and
assembly rejects any missing, extra, colliding, unsafe, or size-mismatched entry
before the package is usable.

Current 0.2 clients and servers have no Runner activation or runtime contract.
New clients hide Temporary computer against an old server; old clients continue
ordinary Session and persistent-Machine operations against a new server, and a
materialized Runner Session remains readable as an ordinary Session. No dual
Runner manifest, token, activation, or socket shape is retained solely for
unreleased 0.3 work. Existing Machines retain effective `persistent` kind.
Shared V1 manifests for released non-Runner products remain readable without
Runner archive metadata; those products neither emit nor interpret these fields.

The `EphemeralRunnerActivation` table is a 0.3-only Home-owned record with no
predecessor shape to read or write. Its strict V1 lifecycle advances one way —
`pending → claimed → consented → materialized` — and every pre-materialization
state can instead reach `closed` carrying one of `canceled`, `declined`,
`expired`, `revoked`, or `failed`; each closing transition is conditioned on that
pre-materialization set, so a materialized activation is never retroactively
closed. `apps/server/sources/app/ephemeralRunner/activationLifecycle.ts` owns
closure and erasure. Deleting the creator's draft closes that draft's
pre-materialization activations in the same transaction as the draft tombstone,
and Account erasure closes every remaining pre-materialization activation as
`revoked` and then deletes only `closed` rows. A materialized activation is
deliberately left to the Session deletion owner, which removes the row with its
Session (`apps/server/sources/app/session/delete/deleteSessionTree.ts`), so an
orphaned materialized row keeps blocking Account deletion instead of being
hidden by a cascade. Nothing outside 0.3 reads this table, so rolling back to a
build without the Runner contract leaves these rows unread rather than
reinterpreted.

The strict V1 activation-create request may carry the optional literal
`authorizeUnattendedTeamAccess: true`. Omission is the safe compatibility shape:
the activation remains usable for independently authorized personal/direct work
but cannot satisfy a restricted Team's authentication policy. When present, the
Home copies only current evidence from the verified creator credential into the
activation's server-owned snapshot. That intent and snapshot are never written
to the exported activation package or endpoint projection. The exact materialized
Runner token carries the currently valid evidence in signed V2 provenance; every
restricted Team selection, readiness, Session creation, broker open, and broker
effect re-enters the canonical Team-authentication qualifier.

The published payload is never the bare Bun executable. The pinned Bun 1.3.5
standalone runtime still exposes its embedded CLI dispatcher when `BUN_BE_BUN` is
inherited (`scripts/pipeline/release/bun-runner-hardening.test.mjs`), so the
shipped product is the Rust shell in `apps/cli/runner-native-shell`, which refuses
unknown arguments and clears the environment before spawning the Bun core as a
nested sidecar. Release admission rejects any candidate that reaches the embedded
dispatcher. Per target the archive contains exactly one payload root beside the
adjacent `happier-runner.activation.json` the creator client adds: Linux ships one
AppImage named `happier-runner` that contains the core as a bundled sidecar;
Darwin ships `Happier Runner.app` with the core at
`Contents/MacOS/happier-runner-core`, which the builder asserts before archiving.
`packages/protocol/src/ephemeralRunner/runnerPackageLayout.ts`
owns that layout and the publication-eligibility list;
`scripts/pipeline/release/lib/runner-packaging.mjs` is the release-side mirror the
builder, asset preparer, and admission all consume, pinned to the Protocol source
by `scripts/pipeline/release/runner-native-shell.test.mjs`.

Linux x64 is the first publication-eligible build/publish/smoke target. This
eligibility lets the release owner produce and validate an immutable candidate;
it is not a Home availability claim. The Home projects only exact records from a
verified immutable publication. The `sessions.ephemeralRunner` Home feature is on
by default, with `HAPPIER_FEATURE_SESSIONS_EPHEMERAL_RUNNER__ENABLED=0` as the
operator opt-out; publication eligibility and release checks are separate from
that feature decision. Linux arm64, Darwin x64/arm64, and Windows x64 retain the
same product/manifest target identities, but must not be projected as available
until their immutable native artifact and applicable platform-signing evidence
are published. Building a target does not make it available: the builder can
compose the Darwin shell, but only with a real Developer ID
identity and notarization output, and it fails closed rather than emitting an
unsigned or ad-hoc signed Runner. Darwin trust is owned by
`notarize-standalone-binary.mjs`, which signs the JIT-entitled nested core before
sealing the app, notarizes, staples, and records schema-3 `app-bundle` evidence —
the released schema-2 standalone-payload evidence keeps its own online-ticket
contract and is not reused for a bundle. Windows remains declared but unadvertised
and typed-unavailable: the approved one-shot, no-installer contract has no
timestamped Authenticode owner, and changing that requires a plan amendment rather
than a build flag.

The Home feature decision is on by default;
`HAPPIER_FEATURE_SESSIONS_EPHEMERAL_RUNNER__ENABLED=0` is the operator opt-out.
Current source contains the authenticated pre-Session credential selection, Pool
source-eligibility and exact-Machine binding, signed broker-readiness
authorization, and production Runner consumer. Those source paths continue to
fail closed on missing or stale readiness. The composed creator-to-endpoint-to-Session
journey on a loaded runtime and the platform-trust evidence above are release
checks owned by release automation and human QA, separate from the feature
decision and from an availability projection that still requires an exact
artifact in a verified immutable publication.

Runner Follow consumes the ordinary Session Follow preparation contract rather
than defining a Runner protocol. The exact method is
`daemon.sessionFollow.sourceKey.prepare.v1`, with strict Protocol request,
authorization, and `installed` response schemas. Lane 09 owns that contract,
hydration, current-edge reconciliation, and accepted-effect acknowledgement.
The Runner composition owns one exact-Machine receiver, one process-local source
material resolver, edge-removal pruning, reconnect registration, and terminal
disposal. It has no Runner engine, Runner store, durable source-key cache, or
second Follow loop. The prospective `../0.2` source inspected at
`7e1ce993c408c0f634b81267aac2bcd8e7859975` has no observed Runner or preparation
method; new clients therefore fail closed against it instead of negotiating a
parallel format. Refresh that dirty sibling's relevant bytes before activation.

## SDK protocol evolution

A wire epoch describes compatible semantics, not an exact property census. Every
material object boundary, including nested objects, is classified explicitly as
`closed`, `additive-open/drop`, or `additive-open/preserve`; a parent policy
never silently classifies its children.

- **`closed`** rejects unknown properties. It is mandatory for identities,
  qualified references, Account or credential selection, permissions, routing,
  mutation inputs/outcomes, authoritative lifecycle facts, executable
  declarations, and runtime unions. Stable Host Events are always closed.
- **`additive-open/drop`** may accept bounded optional unknown properties only
  for transient, presentation, or read projections where an older consumer can
  safely ignore them. Normalization removes those properties.
- **`additive-open/preserve`** may retain bounded unknown properties only when
  the component is an explicit round-trip custodian for a persisted document or
  opaque provider configuration. Preserving data never grants identity,
  authority, routing, credential selection, persistence-policy, or trusted
  prompt/transcript/UI power.

Known fields remain strict under every policy: required fields stay required;
invalid values do not coerce; and owner-justified encoded-byte or semantic
cardinality bounds still apply where the actual wire, storage, or operation
contract requires them. Implementation safety guards such as serializer/parser
recursion depth are private fail-safe details, not public semantic JSON quotas.
An accepted unknown is data, not authority.

An optional input is compatible only when an older implementation can ignore it
without falsely reporting success. Otherwise advertise an optional
operation/capability or introduce a new wire epoch. Likewise, a new union member
is compatible only in an explicitly skippable, bounded presentation list.
Identity, presence, permission, pagination, retry, and mutation-outcome unions
need an existing safe `unknown` arm or a new epoch; they are not skippable by
default.

npm package versions and exported wire epochs evolve independently: a later npm
major may still export V1, and a later npm minor may make only V1-compatible
additions. A public cross-plugin business protocol is a separately publishable
package with any valid scoped or unscoped npm name ending in `-protocol` and
explicit `/v1` and `/testing/v1` exports. Its npm scope identifies its author
and grants no additional protocol authority. It contains schemas, types,
helpers, and conformance fixtures only—not host runtime, persistence, provider
implementation, credential materialization, polling, or a private
`@happier-dev/protocol` dependency—and it has no `latest`, `current`, or
`default` aliases. Compatible
package copies interoperate through serialized protocol identity/version and
runtime validation, never JavaScript object identity.

The package README and nearest `AGENTS.md` must name the feature's domain owner
and link here rather than copy this doctrine. New feature-protocol code must use
one synchronous executable validator/normalizer that derives its bounded public
JSON Schema; independently handwritten parser/schema pairs are not allowed.

The approved SDK r0.31 direct cut does not make current `dev` → `../0.2`
rollback a supported direction. Do not add predecessor readers, dual writers,
aliases, writer-floor waits, or rollback-only gates for unpublished author
contracts; forward migration and current-version integrity still apply.

### Detached Execution Run plugin context (development)

Real Agent Sessions keep the existing Session V1 request, event, context, and
host-service contract. A Session-primary Agent may additionally declare the
versioned `executionRunContext: { versions: [1] }` capability and return the
matching `sessions.executionRunContextV1` runtime facet. Only that facet receives
the host-stamped `execution_run` scope; it has no `context.session` and exposes
only host services whose authority is meaningful without a Happier Session.

The declaration and runtime facet are inseparable. A detached Run fails with the
existing operation-scoped `execution_run_protocol_unsupported` result before a
provider effect when either side is absent. Genuine Session operations remain
available, so older plugins do not need a compatibility adapter and the host must
never substitute the Run id into a Session V1 field. Composer attachment V1 also
remains Session-only; the additive V2 resolve callback carries the same truthful
scope, while SessionMedia continues to reject outside a Session.

The prospective `../0.2` checkout inspected at
`c4deb153e7d4740f06bfeee94b70cfda95d47068` has no observed execution-run context
facet or Composer V2 callback in the relevant SDK, Protocol, and CLI runtime
paths. Those unpublished author contracts therefore create no reverse adapter or
rollback obligation.

## Proportionate matrix

List all affected reachable directions and mark each `required`, `unreachable`, or `unsupported` with a reason. Direct seam tests cover each required direction. End-to-end rows are selected by risk and real deployment order.

Do not run a full Cartesian UI × CLI × daemon × server matrix for an internal or unrelated change. Require broader combinations when a shared protocol, persistence shape, installer/service state, or rollout ordering actually couples those roles.

## Evidence and tests

- Prefer real released/predecessor artifacts, serializers, clients, or provenance-pinned golden vectors.
- A fixture reconstructed from current types is not evidence that the released or predecessor reader/writer behaves that way.
- Use the smallest discriminating test for each material direction, then add risk-selected upgrade, coexistence, rollback, and state-continuity flows.
- Do not multiply shallow permutations. A new test must distinguish a plausible incompatibility, reader/writer mismatch, semantic change, or rollout failure.
- Record the exact tag/commit/artifact or sibling worktree basis, component roles, direction, command, and result.

## Compatibility path lifecycle

Every retained compatibility path records:

- the released or prospective source shape it supports;
- its producer and consumer;
- whether it exists for upgrade, coexistence, rollback, or persisted historical data;
- the canonical owner it delegates to;
- its removal condition.

Remove the path when its support window has ended and evidence shows no supported reader, writer, or stored shape still requires it. Do not remove a released-data reader merely because current writers stopped producing that shape.

### Home profile descriptors (0.3 development)

The UI's existing `server-state-v1` profile owner retains one exact
`homeConnectionDescriptor` for descriptor-backed Homes. Endpoint and revision
decisions read that snapshot; duplicate-profile merges keep its canonical URL and
public ingress together. The active runtime snapshot's revision is a derived,
non-persisted projection. The development-only `irohEndpoint` and
`connectionDescriptorRevision` profile fields are ignored and are not written.

Ordinary URL-only profiles remain readable and usable over standard networking.
Their source shape is present in `ui-web-v0.2.11` and
`ui-web-v0.2.11-preview.186` at
`98ea8fb76733b1dd785d38c31360179cafa84824`, and in the clean prospective profile
owner at `../0.2` commit `9dd9c2580be619b4907257f94174e45ba5517976`.
Those profile shapes contain no Iroh endpoint or descriptor revision fields.
Once a Home has an exact descriptor, a revision-less manual update cannot replace
its connection destination; an exact current Home descriptor is required.
Public privacy-reduced observations do not allocate a revision or erase private
facts from the retained authenticated descriptor.

The separate device-local Account Service endpoint accepts only `source: 'default'`
or `source: 'user'` on both reads and writes. The abandoned `configured` source
is not normalized into a policy choice. It has no endpoint-record producer in
the above stable/preview profile owners or the clean prospective profile owner
at `08e278be495e8f3a1b744bd1d069fc48d2d3276f`; an invalid persisted endpoint is
discarded without changing Home profiles or focus.

### Finite-transfer predecessor admission (0.3 development)

The observed 0.2 daemon at `21977798f704992bc2db3a48cc98c43aeae220c5`
registers the `daemon.bulkTransfer.upload.*` and `daemon.bulkTransfer.download.*`
RPCs through `apiMachine` and the shared Session handler registrar, but its
`DaemonStateSchema` has no `transfer` declaration. The current UI therefore
permits the existing RPC viability probe for that absent declaration. It does
not fabricate listener or import/export capability state. An explicit malformed
or disabled declaration still fails closed, and unknown route viability does
not make transfers available.

The same transfer-state reader supplies presentation and execution. An eligible
Iroh endpoint wins preselection only when the current daemon declaration also
supports finite import and export. Endpoint publication alone is not a transfer
capability because that endpoint also carries workspace, provider, and Runner
traffic. A current Runner instead uses its strict `finiteTransferRpc` operation
declaration because it has no daemon transfer state. No failure after selecting
Iroh switches to the retained RPC carrier. Remove the absence reader bridge only
when daemons without the declaration cease to be supported predecessors. Composer
media's new capability remains independently negotiated and is not implied by
this bridge.

### Request notification previews (development)

Request previews use the existing `attentionDeliveryPolicyV1` channel/event privacy
owner. Remote push and Live Activity permission and user-action events default to
`include_preview` unless an explicit event preview policy restricts details; legacy
`requestIncludeMessageText` preferences are translated at the existing settings
adapter. Webhook request content defaults on unless the destination sets
`requestIncludeMessageText: false`. Disabling either disclosure decision omits
request details from the body and `request.toolDetails`.

Device-local ready and request preview overrides are separate fields under the
existing `attentionDeviceOverridesV1.localNotifications` owner. The request
override defaults to `account`, delegating to the shared policy. Notification
routing and permission-response schemas are unchanged; richer content uses the
existing text fields, with no new server operation or migration.

The released 0.2 notification editor at `98ea8fb76733b1dd785d38c31360179cafa84824`
(`ui-mobile-v0.2.11`, `ui-web-v0.2.11-preview.186`) rebuilds nested legacy
notification settings and strips unknown fields. A missing remote request flag
therefore restores previews, following the user-selected default. An older editor
can erase an explicit opt-out; users can disable previews again from an updated client.
Older CLI senders ignore this preference and retain their reduced hints.

### Changed Files attribution (development)

The unreleased Changed Files projection separates content confidence from Session/turn
attribution in the canonical Protocol merger, `sessions/changes/mergeTurnChangeSets.ts`.
An exact checkpoint delta can have only possible attribution when another checkpoint
interval overlapped. Correlated Agent/tool evidence remains independently attributable,
while workspace touched paths supply only best-effort content and possible attribution.
The derived per-file and summary axes do not introduce another persisted change-set document.

Checkpoint overlap is historical, process-local capture evidence. The CLI registry uses
the resolved SCM root, remembers overlap for each interval after peers finish, and closes
the interval when final capture completes, before asynchronous diff projection. An interval
without observed overlap says nothing about writers in other CLI processes, daemons,
editors or shells. Project membership does not establish filesystem authorship or isolation.

Current checkpoint writers use `shared_worktree` when overlap was observed,
`no_happier_checkpoint_overlap_observed` when the process-local registry observed none,
and `unknown` when the observation is unavailable. The former development-only
`exclusive_worktree` value was removed from the strict reader after the inspected 0.2.11
stable/preview CLI and UI tags and the current predecessor corridor showed no producer.
No compatibility adapter reinterprets that unshipped exclusivity claim.

The clean prospective predecessor corridor at
`b23f95ed354e8d49183017e487bdb75f217017de`,
`packages/protocol/src/sessionChanges`, names Agent turn correlation `providerTurnId`.
The current evidence schema normalizes that field to `agentTurnId`, preserving an explicit
current field when both are present. Invalid aliases and unrelated unknown fields remain
rejected. Current writers use `agentTurnId`; remove the reader translation only when
predecessor-produced change sets cease to be supported inputs. These reader provisions
are not certification of mixed-version deployed clients or completed live UI validation.

### Session message authorship in development

The current authenticated transcript adds an optional nullable `accountActor` presentation field. Its Account identity and minimal profile are strict nested schemas; older message envelopes may ignore the additional field. An omitted field preserves previously projected actor metadata during an update, while explicit null clears it. New clients render no inferred author when an older server omits the field. Public/external transcript projection remains separate and omits the Account actor.

The nullable `SessionMessage.authorAccountId` relation is derived from the immutable admission receipt and uses `ON DELETE SET NULL`. Historical rows without a valid human receipt remain unattributed. Deploy current receipt-derived writers, run the [provider-neutral backfill and disagreement audit](pending-delivery.md#human-authorship-in-development), and verify its result before author-based personal Session scopes activate. Additive DDL alone does not establish old-server restart or overlapping-writer support. No JSON-query fallback, repair worker, or second author store participates in this transition.

The Session record also carries an optional `hasOtherNamedCollaborator` audience-existence signal: true when the current authorized human audience contains another Account besides the requesting viewer. It is presentation-only (the transcript self-byline "You" suppression), independent of live presence, and never a roster, authorization input, or grant source. Omitted means the producer did not project it; consumers preserve the last known value instead of asserting a solo Session, and an explicit boolean always replaces it.

### Enterprise identity and directory provisioning (0.3 development)

Managed identity providers, Team identity connections, and directory sources are new
additive tables in 0.3 development source. Nothing about them is released, so the only hard
obligations here are the released `AccountIdentity` and `LinkedProvider` shapes they extend.
The domain itself is described in [enterprise-identity.md](enterprise-identity.md).

| Direction | Required behavior |
|---|---|
| Released UI → new server | Ordinary built-in and deployment authentication remains usable and strict `LinkedProvider` remains parseable. Managed administration is simply absent from an older client, never malformed. |
| New UI → released server | Ordinary Home authentication falls back to the released `/v1/features` projection **only** when `/v1/auth/entry` answers 404, 405, or 501. Team-managed operations are unavailable rather than sent to a permissive generic route. |
| Released database → new server | Migrations are additive and preserve every existing `AccountIdentity.provider` value and profile byte. No environment-provider row is backfilled, and there is no foreign key from `AccountIdentity.provider` to the managed provider table, because built-in and deployment providers intentionally have no row. |
| New schema → old server | Not a supported direction. Additive tables alone do not establish safe old-binary startup. |
| Mixed fleet after activation | Not supported. Every authorize, callback, and finalize handler must resolve managed providers before managed configuration is activated. |
| Old-server rollback after activation | Not supported, and no rollback-only writer or persistence path exists. This does not remove released-client support against a new server. |

The activation sequence is therefore prepare, then all-capable activation: add the tables,
codecs, readers, and catalog with managed providers disabled; replace every server process
that can receive an OAuth start, callback, or finalize; then activate managed configuration
and writes.

One compatibility reader is retained deliberately. `securityBinding` is optional in the
persisted OAuth attempt and pending schemas
(`app/api/routes/connect/oauthExternal/oauthExternalSchemas.ts`), because a server process can
be replaced while attempt rows it authored earlier are still inside their TTL. That reader
carries no managed or Team authority. `hasInvalidOAuthSecurityBinding` exists so a
**malformed** new binding can never be misread as a legitimately absent one. Its removal
condition is the drain of every legacy-writing server process plus the maximum attempt and
pending TTL — a server-authored ephemeral lifetime, which client support windows do not
extend.

Because none of this has shipped, an unreleased intermediate shape carries no obligation:
correct it in place rather than adding a reader for it. Persisted directory projections are
reconstructible from their upstream source, but native memberships and Group contributions
written from them are not — they are ordinary native facts owned by
[teams-membership-and-groups.md](teams-membership-and-groups.md) and follow that owner's
rules.

### Native email/password authentication (0.3 development)

The following is the implemented development compatibility contract, not an
activation claim. The method is default-on, with
`HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED` and its provisioning key as the
operator opt-out — the ordinary shipped-bit shape described in
[feature-gating.md](feature-gating.md). What it is not is released: the loaded
old/new-client directions, real SMTP, and web/native journeys are release checks
that have not been run against the current source.

The latest immutable stable server frontier was resolved on 2026-09-11 as
`server-v0.2.12` at `a357c65536ba89669422977d6f7daf9aa0d17e73`.
The client-side behavior below remains pinned to the named released client
artifacts; advancing the server frontier does not manufacture a newer-client
compatibility claim.

`AccountEmail`, `AccountPasswordCredential`, and the native email identity are additive
tables and rows in 0.3 development source; the nullable password-mutation purpose/digest
fields extend the unreleased `KeyChallengeV2` migration in place rather than shipping an
add-then-alter history. Nothing here is released, so the released obligations are the
existing Account, identity, and credential shapes the new tables extend.

The incumbent Account-encryption migration request likewise gains only an optional strict
prepared `passwordCredential` participant. Released clients cannot have the unreleased
password row and retain their passwordless transition behavior; current clients with an
enrolled password must supply the participant, and the server fails closed instead of
flipping the mode beside a source-mode credential. No reader or dual writer is retained for
superseded, undeployed development request drafts, and the staged V5 route stays disabled.

The observed released-client defect drives the wire rule: supported `0.2.11`
stable/preview web, mobile, and desktop clients classify any unknown auth method id as an
external OAuth provider and would route `email_password` to `/v1/auth/external/<id>/params`.
Therefore:

| Direction | Required behavior |
|---|---|
| Released client → new server | The static `/v1/features` auth projection stays an old-client-safe subset: the one effective Home method decision feeds it, and it only omits `email_password` (the pinned `OLD_CLIENT_UNSAFE_AUTH_METHOD_IDS` set). It never decides availability independently, and it is removed only when no supported released artifact misclassifies unknown methods. |
| New client → new server | `POST /v1/auth/entry` projects the complete contextual method/action list, including `email_password`; the `/v1/features` subset is a translation-only compatibility adapter, not a competing authority. |
| New client → released server | `/v1/auth/entry` is absent (404/405/501) and the client falls back to the released features projection; native password surfaces simply do not appear. Any other failure fails closed rather than downgrading. |
| Released database → new server | Migrations are additive and preserve every existing `AccountIdentity` value and uniqueness rule; the native-identity widening is applied forward through the owning unreleased migration, not by a second lookup or digest alias. |
| New schema → old server | Not a supported direction. Additive tables alone do not establish safe old-binary startup. |

A Home whose enabled methods leave no 0.2-compatible login/recovery route (a
password-only Home) is not behaviorally usable by those clients. Until the released-client
support frontier ends, activation must keep at least one compatible method enabled or
obtain an explicit minimum-client/update-required product decision; the startup lockout
check reads the unfiltered effective decision so a fully hidden method set is detected
rather than mistaken for an unlocked Home. No compatibility writer, second auth stack, or
client-update simulation is authorized for this boundary. Existing credentials,
recovery-key bytes, and provider identities are never rewritten by the native-auth
migrations.

## Migration history

Migration source has a stricter authoring boundary than ordinary internal code:

- A migration is **local-only** while it has not shipped in a supported stable or preview artifact. Local-only migrations may be edited, renamed, consolidated, or removed before publication.
- Once a migration ships in a supported stable or preview artifact, its name and bytes are immutable. Correct later behavior with a new append-only migration; do not rewrite, rename, or delete the released migration.
- Shared development branches and `*-dev.*` artifacts are evidence that a development database may need explicit reconciliation, but they do not create a lasting product compatibility obligation. Before the next supported release, their migration source may be corrected or consolidated in place when the final transition is still unreleased.

Before publishing a feature, consolidate local-only migration churn into the smallest clear transition from the published schema to the intended final schema. Do not retain add-then-drop columns, temporary tables, renamed draft identities, checksum aliases, or corrective migrations solely because a developer database applied an earlier draft. Retain multiple migrations only when each step serves a real rollout, backfill, transaction, provider, or mixed-version requirement.

If the deterministic repo-local development stack bound to the current checkout applied a local-only or development-exposed draft that is later rewritten, the database must be reconciled in place as part of the same implementation task:

1. resolve the current checkout's deterministic repo-local stack and verify its repository path and managed database ownership;
2. treat its database as retained, non-disposable development data—never delete, reset, recreate, replace, truncate, clean, or discard it;
3. do not ask for separate confirmation and do not create a backup, snapshot, or clone for this narrowly scoped repo-local reconciliation;
4. compare its actual data, complete physical schema, and migration ledger with the intended final schema;
5. quiesce only stack-owned writers when required, apply the exact provider-specific schema/data delta or canonical backfill transactionally, and update only the matching ledger record after the transition succeeds;
6. run the canonical migration deploy twice, then verify current source checksums, the ledger, provider integrity, and foreign keys;
7. restore the stack's prior running state when it was quiesced.

The migration edit and its repo-local reconciliation are one work unit owned by the last editor. Any later edit to the migration invalidates earlier checksum/ledger reconciliation evidence and requires the later editor to repeat reconciliation before handoff.

For `main`, shared, staging, production, external, another checkout's/named QA stack, or otherwise user-owned databases, prepare the provider-specific procedure, back up or snapshot when required, and obtain explicit approval before mutation. If stack identity or database ownership is ambiguous, fail closed without mutating any candidate.

That reconciliation is an operator/development action, not a shipped compatibility path. Do not add runtime checksum exceptions, migration-name aliases, duplicate no-op migrations, or automatic ledger repair merely to preserve unpublished development history.

Keep PostgreSQL, SQLite, and MySQL migrations aligned by intent. Before publication, validate both a clean migration from the published baseline and the executed repo-local reconciliation path when affected; use the approved reconciliation path for other retained databases. After publication, preserve the exact migration history and test upgrades append-only.
