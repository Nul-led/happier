# Peer mediation

How Happier decides whether bytes between a device and a machine travel directly or through the
server, and who owns each step. This page is the internal counterpart to the operator guide at
`apps/docs/content/docs/self-hosting/local-service-previews.mdx`.

**Status of this page.** The Iroh Home and machine-carrier contracts were refreshed against the
current 0.3 development source on 2026-09-08. The remaining peer-mediation claims below were
checked against implementing code on 2026-08-23.
Where the `PMS-1 … PMS-9` specification packets
(`.project/plans/runtime-unification-v2/stages/stage-A/`) describe behaviour the code does not
implement, this page documents the code and says so. The packets are the design authority; they are
not evidence that anything runs.

Citations name a **file and a symbol**, not a line number. This corridor is under active change and
line-anchored citations in an earlier revision of this page were stale within hours; a symbol
survives the next refactor and a wrong one is caught by a search that returns nothing.

## Home connectivity over Iroh

Native clients and daemons may reach a loopback-only Personal Home through
`happier/home-tunnel/1`. The Home process owns one persistent Iroh endpoint and a fixed loopback
HTTP/Socket.IO destination. The client-side lifecycle publishes an ephemeral `runtimeOrigin` only
after the ordinary Home identity and authenticated ping probes succeed; the canonical Home URL
continues to own credential scope, auth audience, profile identity, and reachability identity.

The public `/v1/features` projection publishes the current Home Iroh descriptor without private
direct-address hints. After Home authentication, `/v1/features/authenticated` returns the exact
descriptor, including trusted direct hints and explicit higher-revision endpoint retirement. CLI
authentication fetches that exact projection before persisting the profile, and the daemon uses the
same authenticated snapshot for refresh. The existing profile owner reconciles newer observations
and rejects an identity mismatch or equal-revision conflict instead of creating a second descriptor
authority. The server persists one outer `{ revision, contentKey }` continuity fact so an
Iroh-to-HTTPS-only transition cannot regress across restart.

Transport selection is automatic. Direct-versus-relay path facts remain native diagnostics and do
not rebuild Home HTTP/Socket.IO clients or appear in routine connection labels. Standard HTTPS
remains available where independently trusted; identity, authentication, integrity, ALPN, preamble,
and stale-target failures remain fail-closed.

The native carrier is active in the current 0.3 development source for Home and Machine traffic.
Its single applied policy is `automatic` or `disabled`: `automatic` uses only the explicitly
configured relay set while allowing Iroh to select direct or relayed reachability, and `disabled`
contacts no relay. The dialer always authenticates the remote peer as the exact EndpointId selected
from the descriptor. Relay URLs and direct-address hints only help reach that endpoint; neither can
stand in for its authenticated identity. Diagnostics may describe a proven native path as `Direct`
or `Secure relay`, while an unproven path stays `unknown`.

Browser Iroh carries **Home HTTP, Socket.IO, and finite Machine transfers in the current development
source**. Finite transfers use `happier/machine/1`, the canonical signed route grant, and no ordinary
user-socket fallback; the production direct-import/direct-export path passed in loaded Chromium
against the stock local relay and real Machine acceptor on 2026-09-03. That current-source result is
not stable/preview availability, multi-browser evidence, target certification, or Lane 09
certification. Browser Mutagen/workspace sync remains excluded. A browser cannot bind the native
loopback listener, so its carrier is *semantic* rather than URL-addressed: no
`runtimeOrigin` exists or is invented for it, and the canonical Home URL keeps describing identity,
auth audience, reachability scope, and logging. The resolved transport therefore names either a
runtime origin (independent HTTPS, or the loopback origin a native lease binds) or a Home carrier
that moves the bytes itself — never both.

Selection is automatic and narrow. The browser carrier is chosen only on a plain browser host
(never Tauri or Electron, which run the same bundle but keep the native direct-or-relay carrier),
and only when the canonical Home descriptor names an exact EndpointId plus at least one explicitly
configured relay and a Home-scoped credential exists. The canonical owners are unchanged:
`apps/ui/sources/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedTransport.ts` and the
focused-Home switch in `connectionManager.ts` resolve the carrier;
`apps/ui/sources/sync/http/client.ts` keeps auth, compatibility, credential invalidation, generation
checks, timeouts, reachability, and error classification, handing the carrier only a composed
request; Engine.IO/Socket.IO keeps lifecycle, authentication, reconnect, and event de-duplication and
merely receives a different underlying socket. An absolute cross-origin URL never uses the carrier,
so a Home bearer cannot leave its Home. The wasm/worker path is loaded lazily behind one dynamic
import, so HTTPS-only public use does not pay for it, and an architecture guard pins the exact
approved consumers.

Browser Iroh is relay-only: its UI says `Secure relay`, never `Direct`, and an unproven path stays
`unknown`. It introduces no gateway, no fake loopback origin, no JavaScript relay, no second
HTTP/Socket.IO owner, and no browser Mutagen / workspace-sync engine. Independently trusted HTTPS
ingress remains eligible before the fail-closed identity/auth boundary; after a carrier is selected
and its EndpointId proven, failure never retargets the request.

The shared managed relay is the pinned stock `iroh-relay` with forwarding and QAD enabled. It
authenticates Iroh EndpointIds and forwards opaque encrypted transport; Home authentication and V2
Machine grants remain the application authority at the endpoints. Happier does not add a shared
relay endpoint registry. A private callback is available only to a custom composition that already
owns one complete allowlist for every endpoint class it intends to carry.

Endpoint identity continuity follows the authority that depends on it. A Home endpoint is durable
first-contact descriptor authority, so lost or changed Home key material fails closed through the
canonical descriptor continuity record and requires an explicit descriptor recovery/update. A
Machine may replace wholly absent key material only by publishing its new EndpointId through its
existing authenticated Machine connection; fresh grants bind that current publication and old
grants do not migrate. A native Account client likewise receives no authority from a previous
EndpointId: every new finite-transfer grant binds its current identity. Browser identity remains
ephemeral per live SharedWorker. Corrupt, unreadable, or partially retained native key material
fails explicitly rather than being overwritten. These role-specific rules avoid a second endpoint
registry or universal pairing ledger.

## 1. The model

Every mediated session is a **flow kind** (what the bytes mean) crossed with a **route kind** (how
they physically travel).

| Axis | Members | Declared at |
| --- | --- | --- |
| Flow kind | `bounded_transfer`, `tcp_tunnel`, `live_stream`, `machine_rpc`, `voice_media` | `packages/protocol/src/machines/peer/mediation/**` |
| Route kind | `loopback_direct`, `lan_direct`, `tailscale_serve_direct`, `server_relay`, `iroh_peer` | same |

The five moving parts and their canonical owners:

| Part | Owner |
| --- | --- |
| Route decision (pure fold of feature bits, account preferences, daemon policy, grant state → a route or a typed refusal) | `packages/peer-mediation/src/route/**`, `.../flows/**` |
| Route grants (Ed25519, bound to account + machine + flow + route + destination + expiry) | `packages/protocol/src/machines/peer/mediation/**`; minted at `apps/server/sources/app/machines/peer/mediation/**` |
| `iroh_peer` machine/1 grant binding | `IrohPeerInitiatorV2Schema`, `IrohPeerTargetV2Schema`, and `SignedDirectRouteGrantV2Schema` in `packages/protocol/src/machines/peer/mediation/directRouteGrantV2.ts`; minted by `mintDirectRouteGrantV2` and verified by `verifyDirectRouteGrantV2`. Finite-transfer grants bind an authenticated Account/client or Machine initiator EndpointId to one target Machine + EndpointId and the `finite_transfer` carrier purpose for a bounded lifetime; the prepared-transfer capability remains the exact operation and byte authority. Workspace-sync grants retain the signed operation identity consumed by rooted workspace ingress. The authenticated Iroh transport EndpointId and ephemeral proof are checked before fixed-target ingress. The older V1 grant remains only for the separate negotiated legacy peer-mediation routes; it cannot authorize `happier/machine/1` |
| Direct transport (daemon loopback HTTP server, grant + nonce on every operation) | `apps/cli/src/daemon/peer/mediation/**` |
| Relay transport (framed envelopes over the existing Socket.IO connection) | `apps/server/sources/app/api/socket/peer/mediation/**` |
| Observability (sequenced ring buffer of flow lifecycle events, with metadata redaction) | **One** engine: `createPeerMediationObservabilityFlowStore` in `packages/protocol/src/machines/peer/mediation/observability/`. The daemon and server modules named `observability/store.ts` are ~50-line bindings that only adapt their own call signature to it (DEC-8) — they are not second owners. The UI keeps its own read-side store for subscriptions and selectors. |

## 2. The enablement contract

This is the part that surprises people: **on a default deployment none of the substrate is
reachable**, and the reason is configuration, not missing code.

### 2.1 Grant signing is the master switch

`resolvePeerMediationGrantSigningConfig`
(`apps/server/sources/app/machines/peer/mediation/mintDirectRouteGrantV1.ts`) reads four variables
and returns a typed refusal when they are absent:

| Variable | Absent → | Notes |
| --- | --- | --- |
| `HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID` | `missing_key_id` | any short label; travels with the grant so machines can select a trust root |
| `HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY` | `missing_private_key` | 32-byte Ed25519 seed or 64-byte secret key, strict unpadded base64url (`decodeBase64Url` / `normalizeSigningSecretKey`) |
| `HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY` | *(optional)* | cross-checked against the key derived from the seed; mismatch → `invalid_public_key` |
| `HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT` | *(optional)* | epoch **milliseconds** |

Two consequences, both observable:

- `isPeerMediationGrantSigningAdvertisedForRequest`
  (`apps/server/sources/app/features/catalog/serverFeatureGate.ts`) is
  `capabilities.machines.peerMediation.grantSigningKeys.length > 0`, and
  `readPeerMediationFeatureEnv` (`catalog/readFeatureEnv.ts`) returns an empty list when signing does
  not resolve. The grant-mint route's pre-handler
  (`createPeerMediationGrantSigningGatePreHandler` in
  `apps/server/sources/app/api/routes/machines/peer/mediation/registerPeerMediationGrantRoutes.ts`)
  therefore replies **`404 {"error":"not_found"}`**.
- The local-service preview tunnel opener throws
  `local_service_preview_tunnel_unavailable:grant_signing_unavailable`
  (`createTunnelUnavailableError` in `apps/server/sources/app/local/services/preview/tunnel.ts`).
  `proxyLocalServicePreviewHttpRequest` (`preview/httpAdapter.ts`) classifies that rejection into
  the same typed failure the routes already define for a missing transport — **503**
  `{"error":"preview_transport_unavailable","reasonCode":"pms_tunnel_unavailable"}` — and logs the
  specific prerequisite (`module: local-service-preview`, `level: error`, the tunnel's own
  `reasonCode`). The error carries its reason code as a property, so no caller parses the message.
  Until 2026-08-24 the call was unwrapped and reached the global handler
  (`apps/server/sources/app/api/utils/enableErrorHandlers.ts`) as an untyped **500**
  `An unexpected error occurred` (`F-PREVIEW-1`).
- `capabilities.localServices.preview.pmsRelayReady` **includes this switch**. Before the same fix it
  did not, so a server with the two tunnel variables set and no signing key advertised a ready relay
  whose data path returned 500 on every request. An unmet signing prerequisite now reports
  `peer_mediation_grant_signing_unavailable` on both the `preview` and `publicPreview` nodes — the
  same code `resolvePeerMediationFeature` already emits for the same fact.

Machines need no configuration: the daemon takes public keys from the authenticated, last-known-good
server feature snapshot and drops expired entries. Long-lived Machine openers and target admission
resolve those roots when each operation is verified, so feature readiness and signing-key rotation
do not require rebuilding the workspace runtime (`createWorkspaceMachineCarrierTunnelOpen` and
`maybeStartPeerMediationLoopback` in `apps/cli/src/daemon/**`).

### 2.2 The relay half adds two more gates

`readMachineTunnelFeatureEnv` (`apps/server/sources/app/features/catalog/readFeatureEnv.ts`):

- `HAPPIER_FEATURE_MACHINES_TUNNEL_SERVER_ROUTED__ENABLED` defaults **false**.
- `HAPPIER_FEATURE_MACHINES_TUNNEL_ALLOWED_PORTS` defaults **`[]`** — `parsePortList` returns an
  empty array for an unset value, i.e. a deny-all destination list.
- `HAPPIER_FEATURE_MACHINES_TUNNEL_DIRECT_PEER__ENABLED` defaults **true**, but it only feeds the
  `machines.tunnel.directPeer` gate (`resolveMachineTunnelFeature` in
  `apps/server/sources/app/features/machineTunnelFeature.ts`). **It does not affect local-service
  previews**, which always construct a relay transport
  (`apps/server/sources/app/api/routes/local/services/registerRoutes.ts` →
  `apps/server/sources/app/local/services/preview/tunnel.ts`).

Both gates are enforced when the relay authorization is minted
(`apps/server/sources/app/machines/peer/mediation/tunnel/authorization.ts`):

| Condition | Reason code |
| --- | --- |
| `serverRoutedEnabled` false | `blocked_by_server_policy` |
| destination host not loopback | `destination_host_not_allowed` |
| port not in both the scope and the server allowlist | `destination_port_not_allowed` |
| requested caps exceed server caps | `relay_cap_exceeded` |

### 2.3 Local-service preview gates

`readLocalServicesFeatureEnv` (`apps/server/sources/app/features/catalog/readFeatureEnv.ts`):
private `preview` defaults **on** (loopback only, no exposure); `publicPreview` defaults **off**
(fail-closed).

`resolveLocalServicesFeature` (`apps/server/sources/app/features/localServicesFeature.ts`) turns
unmet prerequisites into **ten** reason codes, carried on
`capabilities.localServices.preview.disabledReasons` and
`capabilities.localServices.publicPreview.disabledReasons`. The client renders them — see §4.

| Code | Node | Emitted when |
| --- | --- | --- |
| `disabled_by_server_policy` | `preview` | `…LOCAL_SERVICES_PREVIEW__ENABLED` is false |
| `disabled_by_server_policy` | `publicPreview` | `…LOCAL_SERVICES_PUBLIC_PREVIEW__ENABLED` is false — the default, and short-circuits the rest |
| `pms_server_relay_disabled` | both | `…MACHINES_TUNNEL_SERVER_ROUTED__ENABLED` is false |
| `pms_allowed_ports_empty` | both | `…MACHINES_TUNNEL_ALLOWED_PORTS` is empty |
| `peer_mediation_grant_signing_unavailable` | both | route-grant signing does not resolve (§2.1), so the relay tunnel opener would throw on every request |
| `mode_unconfigured` | `publicPreview` | no allowed exposure mode configured |
| `max_ttl_unconfigured` | `publicPreview` | no maximum link lifetime configured |
| `dns_tls_unavailable` | `publicPreview` | no host-origin base domain, or the canonical server URL is not `https:` |
| `audit_sink_unavailable` | `publicPreview` | no durable audit sink resolved |
| `rate_limit_profile_unconfigured` | `publicPreview` | no rate-limit profile ids configured |
| `rate_limit_checker_unavailable` | `publicPreview` | no rate-limit checker resolved |

`publicPreview.enabled` is `publicPreviewEnabled && publicDisabledReasons.length === 0`, so **every**
public prerequisite is hard. Two of them became hard in the 2026-08-23 hardening pass and are worth
naming because their older behaviour is still described in the packets:

- **DNS/TLS** is now unconditional. A public exposure is minted on its own isolated origin, so the
  runtime refuses with `public_origin_unavailable` without one. It is no longer conditional on the
  `dnsTlsRequired` policy bit (that bit still governs the per-exposure check in
  `apps/server/sources/app/local/services/public/policy.ts`, which is a different decision).
- **The rate-limit checker** is now unconditional. It previously failed *open* behind a helper that
  could not observe the one case that mattered; abuse control is now a prerequisite for the gate,
  matching the runtime's own refusal.

There is no operator switch for the audit requirement. A public exposure always requires a durable
audit sink; the former `auditRequired` knob had exactly one non-default value, it emitted a reason
code that disabled the feature, and it has been removed.

## 3. Reachability, measured

Counts below come from the 2026-08-18 audit
(`.project/reviews/2026-08-18-21-34-57-ru2-browser-local-services-completion-audit-e62cd7/REPORT-TUNNELS.md`)
and were spot-checked, not re-measured, on 2026-08-23.

| Configuration | What runs |
| --- | --- |
| Defaults | Nothing. The mint route 404s and the preview capability reports `peer_mediation_grant_signing_unavailable`; a request that reaches the data path anyway gets a typed 503. Observability is off (fail-closed). |
| + the four signing variables | The loopback-direct half (`directPeerEnabled` is already true), and the parent gate observability depends on. |
| + `…PEER_MEDIATION_OBSERVABILITY__ENABLED` on top of those | PMS-9 observability, readable through the socket subscription and the daemon snapshot action. |
| + `…TUNNEL_SERVER_ROUTED__ENABLED` and a non-empty `…TUNNEL_ALLOWED_PORTS` | ~16,000 LOC: voice tunnel, private preview, simulator relay, direct machine RPC. |
| Any configuration | ~5,500 LOC stays dark — see below. |

Of the three subsystems the audit recorded as permanently dark, **one has been fixed, one is being
deleted, and one is still dark**:

- **PMS-9 observability (~3,031 LOC across four codebases)** — **no longer dark.** It was
  unreachable at every configuration because its gate had no writer. `resolvePeerMediationFeature`
  (`apps/server/sources/app/features/peerMediationFeature.ts`) is now registered in
  `apps/server/sources/app/features/catalog/serverFeatureRegistry.ts` and resolves
  `machines.peerMediation.observability` from
  `HAPPIER_FEATURE_MACHINES_PEER_MEDIATION_OBSERVABILITY__ENABLED`, failing closed when the variable
  is absent or malformed (`readPeerMediationFeatureEnv` in `catalog/readFeatureEnv.ts`).

  It is a **child gate**: grant signing must resolve first, or dependency closure forces it off
  regardless of the variable. Its `disabledReasons` name which half failed —
  `peer_mediation_grant_signing_unavailable` for the parent,
  `observability_disabled_by_server_policy` for the child variable.

  The two engine copies were also consolidated into the single protocol owner under DEC-8, which
  fixed two real drifts: the daemon copy collapsed every non-machine scope into one bucket, and both
  copies summed cumulative byte gauges instead of taking the latest sample.

  **Honest limit:** the state is now reachable and readable, but **no first-party UI renders it**.
  Reaching it means the socket subscription (`peer:observability:subscribe:v1`) or the
  `peerMediation.observability.snapshot` daemon action — not a screen.
- **Managed local services (~554 LOC)** had no producer for any mutator, and `source:'managed'` is
  structurally impossible on the wire (`LocalServiceInventorySourceV1Schema` in
  `packages/protocol/src/local/services/inventory/v1.ts` is `z.enum(['detected'])`). The spine is
  being removed under DEC-6; the UI half
  (`apps/ui/sources/sync/domains/local/services/managed/**`) is gone — verified absent 2026-08-23.
- **`lan_direct`** is still declared in the route-kind enum with no producer anywhere.
  `tailscale_serve_direct`, by contrast, is live for bounded transfer
  (`apps/ui/sources/sync/domains/transfers/runtime/transferRuntime/availability/machineDaemonTransferState.ts`).

## 4. Surfacing: which prerequisite failed

`capabilities.localServices.{preview,publicPreview}.disabledReasons` had **zero** production readers
until 2026-08-23; the client showed one generic sentence for ten distinct causes (nine codes, with
`disabled_by_server_policy` meaning a different thing under each node). The reader is
now `useLocalServiceCapabilityDisabledReasons` in
`apps/ui/sources/components/sessions/localServices/useLocalServicePublicPreviewFeature.ts`, called
once by `LocalServicesSurfaceHost` and passed down to the rows; the copy owner is
`CAPABILITY_DISABLED_REASON_KEYS` in
`apps/ui/sources/sync/domains/local/services/publicPreview/presentation.ts`.

There are three separate reason vocabularies on this path, and they must not be merged:

| Vocabulary | Producer | Consumed by |
| --- | --- | --- |
| `LocalServicePreviewDiagnosticV1['code']` (closed enum) | daemon and server preview runtimes | `PUBLIC_PREVIEW_DIAGNOSTIC_REASON_KEYS` |
| `diagnostic.details.reasonCode` (free string) | e.g. `apps/server/sources/app/local/services/public/runtime.ts` | `PUBLIC_PREVIEW_POLICY_REASON_KEYS` |
| `capabilities.localServices.*.disabledReasons` (free string) | `resolveLocalServicesFeature` | `CAPABILITY_DISABLED_REASON_KEYS` |

The capability field is `z.array(z.string())` on the wire
(`packages/protocol/src/features/payload/capabilities/localServiceCapabilities.ts`), so a code from a
newer server is expected: the client drops what it does not recognise and falls back to its generic
sentence rather than rendering a raw identifier. The cost of that graceful degradation is that a
code added on the server and not mapped in the client is **silent**, which is what the
"covers every reason code the server can emit" test in `presentation.test.ts` exists to catch.

`disabled_by_server_policy` means "the private preview feature is off" under `preview` and "the
public exposure feature is off" under `publicPreview`, which is why the capability map is keyed by
node.

## 5. Team Provider broker application path (development only)

The Team credential broker reuses the exact-Machine transport substrate, but it is not a generic
peer-mediation route and must never enter the same-Account peer control plane. The Home's Team
credential admission owner first binds the current resource, accountable Account, Session or
execution run, broker Machine, request facts, and one application target. The transport carries
that typed application request to the exact Machine; the broker handler may reach only the managed
Provider endpoint access selected by the binding. It cannot select an arbitrary loopback port,
open SVC09 directly, or reinterpret the request as a peer-mediation operation.

Authority is request-scoped, not captured once when a connection factory is constructed. Each
admitted stream/request rechecks its authenticated transport context, route grant, resource and
source currentness, grant lifetime, placement, Session/run binding, policy, and accountable Account.
Reusing or multiplexing a connection must not exchange headers, identity, or usage attribution
between streams. An already admitted upstream request may finish after later revocation; a new
request must pass current admission again.

Broker readiness is a content-free, non-inference activation exchange. It can establish only that
the exact application handler for the selected target is installed and eligible; it does not grant
resource access or prove a Provider request will succeed. Current 0.3 source still requires the
composed exact-Machine request, cancellation, recovery, and live UI gates before this development
path may be described as available.

The current Temporary-computer readiness carrier is a distinct
`provider_broker_readiness` arm of the strict `happier/machine/1` admission union. Its dual-signed
request is the exact broker-open witness: it binds the Home and activation, sealed launch-manifest
commitment, resource, Agent target and protocol, Runner installation plus native initiator EndpointId,
and broker Machine plus native target EndpointId. Native Iroh supplies the authenticated remote
EndpointId independently; target admission compares that observed identity and its own current
EndpointId with the signed witness before selecting the fixed readiness application. The readiness
arm cannot be passed to the inference handler.

The application forwards only that strict signed envelope to the Home's currentness owner and
returns content-free readiness. It does not carry a prompt, model request, credential, local bearer,
or arbitrary destination. Closing it retains no tunnel or service lease for later Session use. Final
materialization consumes the same signed witness and independently rereads the current resource,
selection binding, broker endpoint, source revision, consent, and installation facts before
committing the Machine and Session. A later Provider open still performs its own current admission;
readiness is not a retained authorization for that effect.

## 6. Public exposure is gated deliberately

The public-exposure vertical sits behind `HAPPIER_FEATURE_LOCAL_SERVICES_PUBLIC_PREVIEW__ENABLED`,
which defaults off. Decision **DEC-7** of
`.project/plans/2026-08-23-ru2-surfaces-finalization/PLAN.md` keeps it off until its security work
lands **and** an independent security review confirms it.

**Where that stands as of 2026-08-23.** The security work has landed in source — access-time
authorization for authenticated exposures, a dedicated origin required before an exposure can be
minted, and abuse control promoted to a hard prerequisite. It is `IMPLEMENTED_NOT_VERIFIED`: the
independent review named in DEC-7 has **not** run. Both halves of the gate are required, so the
feature is not available and the default does not change.

Consequences for anyone writing about this surface:

- Do not describe it as available, ready, or shippable. "Complete code" is a statement about the
  diff, not about the gate, and the two are not the same claim.
- Do not enable it in any shared environment.
- Keep the reasoning for the gate at the level of *status*. The specific defects behind DEC-7 belong
  in the plan and the review, not in a page that ships.

## 7. Known spec/implementation divergences

Recorded here for lane D3, which owns the packet amendments. Each was checked against code:

| Packet claim | Code |
| --- | --- |
| PMS-6 §5.1 requires grant revocation | **Withdrawn, and the mechanism is now fully removed — re-verified at source 2026-08-23 (this row previously described code that no longer exists).** There is no revocation registry on the server: `mintDirectRouteGrantV1.ts` contains no `revoke` symbol. The daemon-side `revokedGrantIds` / `revokedGrantFamilyIds` threading through `loopback/server.ts`, `rpc/registerRoutes.ts`, `stream/registerRoutes.ts` and `tunnel/open.ts` **has been deleted** — `rg -w 'revokedGrantIds\|revokedGrantFamilyIds'` over `apps` + `packages` returns **zero hits**, tests included. `directRouteGrantRevocationV1.ts` and `DirectRouteGrantRevocationV1Schema` are **deleted from the protocol**. What remains is `grant_revoked` as an **unreachable member of the wire reason enums** (`loopbackEndpointV1.ts`, `rpc/directV1.ts`, `flows/tunnel/disabledReasons.ts`) plus its mapping branches in `verifyDirectRouteGrantV1.ts` and `validateRequest.ts`; these are retained deliberately because removing a wire enum member is a compatibility event with no benefit, and they can never fire. **Grants are TTL-only:** containment is single-use consumption, a 5–15 min TTL, account/machine/endpoint binding and a per-tunnel nonce proof. Amendment and reinstatement condition: the S-4 block in `PMS-6.md` |
| PMS-9 REQ-9-08 requires subscription gap recovery | **Resolved since the audit.** `resubscribeRequired` is gone; the only remaining mention is the docstring recording its removal (`apps/ui/sources/sync/domains/machines/peer/mediation/observability/types.ts`) |
| PMS-1 moves endpoint publication into the substrate | the substrate listener hard-codes `routeKind:'loopback_direct'`; the real Tailscale listener still lives at `apps/cli/src/machines/transfer/tailscaleTransferServeLifecycle.ts` |
| The protocol declares five flow kinds | the substrate package models four; `voice_media` is omitted from `activeFlows` |
| PMS acceptance gates | they are `test -f` / `rg` assertions, so they pass while the behaviour they name is skeletal |

## 8. Related

- `apps/docs/content/docs/self-hosting/local-service-previews.mdx` — the operator-facing guide.
- `docs/feature-gating.md` — how server gates and capabilities are resolved and consumed.
- `docs/compatibility.md` — wire and persistence compatibility rules for these seams.
