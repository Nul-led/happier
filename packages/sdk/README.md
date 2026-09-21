# `@happier-dev/sdk`

Typed Node.js client for Happier's authenticated Action API.

The current Developer Preview requires Node.js 18.17 or newer and supports
server-side Node.js use through the package's ESM root export. Use NodeNext (or
an equivalent ESM-aware configuration); CommonJS `require()` and package deep
imports are not public entry points. Public Action routes do not enable CORS, so this is not
a browser client for arbitrary web origins; same-origin browser delivery has
not been proven as a supported environment. Do not put an API Token in browser
code.

## Choose the interface

Happier exposes one Action contract through several clients:

| Interface | Use it for |
| --- | --- |
| Human CLI | Interactive terminal work with compact output |
| CLI JSON/JSONL | Shell and agent automation |
| Fluent SDK | Node.js Session creation, messaging, history, and stream lifecycles |
| Raw SDK | Typed or dynamic access to the complete public Action catalog |
| HTTP | Non-Node.js clients and infrastructure tools |

All five use the same Action registry, schemas, settings and approval system,
placement rules, and results; Happier still applies the setting for the surface
that made the call. The daemon-local endpoint uses its current Machine when no
target is provided. The configured server reaches an exact connected
Machine—including one behind NAT—after the caller selects it through
`machines.list()` or `GET /v1/machines`.

### Daemon-local onboarding

For a daemon-local endpoint, use the root client. Its Action requests omit a
target, so the daemon executes on its current Machine.

```ts
import {
  connect,
  isHappierActionApprovalRequestCreated,
  HappierSessionInitialInputError,
  type HappierSession,
} from '@happier-dev/sdk';

const apiToken = process.env.HAPPIER_TOKEN;
if (!apiToken) throw new Error('Set HAPPIER_TOKEN to an API Token.');
const endpoint = process.env.HAPPIER_API_ENDPOINT;
if (!endpoint) throw new Error('Set HAPPIER_API_ENDPOINT.');

const happier = connect({
  endpoint,
  token: apiToken,
});

try {
  let session: HappierSession;
  try {
    session = await happier.sessions.spawn({
      directory: process.cwd(),
      agent: 'codex',
      initialMessage: 'Inspect the failing tests.',
    });
  } catch (error) {
    if (error instanceof HappierSessionInitialInputError) {
      await error.session.stop();
    }
    throw error;
  }

  try {
    await session.sendAndWait('Please fix the smallest owning cause.', {
      localId: 'fix-owning-cause',
      timeoutSeconds: 300,
    });
  } finally {
    await session.stop();
  }
} finally {
  await happier.close();
}
```

For daemon-local use, obtain the current port from the daemon status contract;
the port is not fixed:

```sh
DAEMON_PORT="$(happier daemon status --json | jq -er '.daemon.httpPort')"
export HAPPIER_API_ENDPOINT="http://127.0.0.1:$DAEMON_PORT"
```

### Account-server onboarding

`agent` is an exact Agent routing id such as `'codex'`; it is resolved from
the target daemon's current inventory. If it is not installed, disabled, or
does not expose a Session-capable identity, `sessions.spawn()` rejects with
`HappierAgentUnavailableError` and its typed `reason`.

Discover that inventory instead of guessing an id. `sessions.spawn()` resolves
your `agent` value against the same read-only catalog Action. After selecting a
machine below, use that machine-bound client for discovery and spawning.
Missing, disabled, or identity-less Agents fail typed at spawn time even when
this discovery step is skipped.

At a daemon-local endpoint, root `happier.sessions.spawn()` deliberately omits
the routing target, so the daemon uses its current Machine. It does not perform
Machine discovery or choose a server-side default. At a server endpoint, that
same unbound call rejects with `HappierActionError` whose `code` is
`target_required`. Discover and select an exact server target before creating a
Session:

```ts
const serverAccount = connect({ endpoint, token: apiToken });
const eligibleMachines = (await serverAccount.machines.list()).filter((candidate) => (
  candidate.kind === 'persistent'
  && candidate.active && candidate.revokedAt === null && candidate.replacedByMachineId === null
));
const [machine] = eligibleMachines;
if (!machine) {
  throw new Error('No eligible active machine is available.');
}
if (eligibleMachines.length > 1) {
  const candidateIds = eligibleMachines.map((candidate) => candidate.id).join(', ');
  throw new Error(`Select one machine explicitly: ${candidateIds}`);
}
const serverClient = serverAccount.machine(machine.id);
const inventory = await serverClient.actions.agents.backends.list({ includeDisabled: true });
const usableAgentIds = inventory.items
  .filter((item) => item.enabled)
  .map((item) => item.agentId);
if (!usableAgentIds.includes('codex')) {
  throw new Error('The selected machine does not have an enabled Codex Agent.');
}
const session = await serverClient.sessions.spawn({ directory: process.cwd(), agent: 'codex' });
```

The machine-bound client keeps that target fixed for its inventory lookup and
Session creation. The checked-in comprehensive example makes this endpoint choice
explicit: `HAPPIER_ENDPOINT_MODE=daemon` omits a target, while
`HAPPIER_ENDPOINT_MODE=server` auto-selects only when exactly one eligible
machine exists and otherwise requires `HAPPIER_MACHINE_ID`.
Its console output is deliberately a compact summary, not a raw transcript
dump.

Start with the finite daemon-local [basic example](examples/basic/README.md).
Use the [comprehensive recipe](examples/comprehensive/README.md) for dual-origin
routing, explicit machine selection, Session lifecycle, and cleanup.
The [external integration example](examples/external-plugin/README.md) shows the
shape an external service or CI integration uses: the published SDK only,
either credential kind, a Discussion, and a bound Execution Run. Installed
external plugins use the public Plugin SDK and retain the same trusted host
capabilities as built-in plugins; they are not narrowed to the PAT/API surface.
Contributed Action discovery requires a known installed plugin and is shown
separately below rather than making either first-run example depend on one.

`machine(id)` returns a target-bound view that shares the root client's
lifecycle. Calling `await close()` on either view aborts outstanding work for both.
For an existing Session, `sessions.get(sessionId)` binds its operations to that
Session automatically. The same handle therefore works at daemon-local and
server endpoints without duplicating `sessionId` in an execution target. An
explicit target remains available when deliberate machine pinning is needed.

For a correlated send that settles only after the target Session becomes idle,
use `session.sendAndWait(message, input?, executionOptions?)`. It calls the
canonical `session.message.send` Action with `wait: true`; `input` can include
the retry-safe `localId` and `timeoutSeconds`. It does not start a second wait.

`HappierActionError` means the Action API admitted the request but could not
produce its typed Action result, either because the Action failed or because
it requires approval. `HappierTransportError` instead means the SDK could not
complete or validate the HTTP exchange, such as a network failure, a
non-success HTTP status, invalid JSON, or an invalid response envelope. A
successful response whose result does not satisfy that Action's declared output
schema is the same kind of failure: the SDK rejects with `code`
`invalid_action_output` rather than presenting an unchecked value as the typed
result.

When policy defers an Action for user approval, raw and generated Action methods
resolve with the canonical admitted result
`{ kind: 'approval_request_created', artifactId, actionId }`; generic results are
never reinterpreted by the transport. Curated Session helpers retain their explicit
ergonomics and reject with `HappierActionError` whose code is `approval_required`
and whose details preserve that result. The SDK neither waits for nor decides the
approval; for `sessions.spawn()`, no Session has been created yet. Use
`isHappierActionApprovalRequestCreated(result)` before reading an Action-specific
result from a raw or generated method that may be deferred.

Both the daemon-local and server origins cap the decoded Action response
envelope—not only the Action result—at 24,000,000 UTF-8 bytes. If execution
finishes but that decoded envelope would exceed the limit, the SDK rejects with
`HappierActionError`: `code` is `result_too_large` and `details` contains
`{ executionCompleted: true, maxSerializedBytes: 24000000 }`. The Action may
already have committed a mutation, so do not blindly retry it. Inspect current
state or use the Action owner's idempotency contract. For large data, return
Artifact references, use an existing stream Action, or expose bounded or
paginated reads instead of one oversized inline result. The decoded V1 request
body limit is 32 MiB (33,554,432 bytes), and its server-to-daemon relay reserves
a 33 MiB (34,603,008-byte) carrier, leaving one MiB for framing. Protected V2
preserves those decoded request/result budgets and derives larger outer HTTP and
socket ceilings only for authenticated-encryption and JSON framing overhead;
the exported Protocol constants own those outer carrier limits.

When you request `initialMessage`, `sessions.spawn()` resolves only after the
canonical initial-input disposition is `accepted` or `alreadyAccepted`. If the
Session was committed but that message is `rejected`, `outcomeUnknown`, or
`notRequested`, it rejects with `HappierSessionInitialInputError`. Its
`session` is the committed Session handle and `result.initialInput` preserves
the canonical disposition; no retry or Session deletion is performed. Recover
explicitly, for example with `error.session.send(...)`. The basic example
instead stops `error.session` before rethrowing because it cannot continue a
demonstration Session after a rejected initial message.

If Session creation itself does not commit a Session, `sessions.spawn()`
rejects with `HappierSessionSpawnError`. Its `result` preserves the canonical
creation outcome, including a typed code and retryability when supplied; there
is no Session handle to stop or clean up in that case.

`actions.execute(actionId, input, options)` is the raw Action call. Each
namespaced Action method offers the same call with typed input and output. Use
`actions.search(...)` to discover a contributed Action's qualified id,
`actions.get(...)` to read its declared input schema, and
`actions.invoke(...)` with the qualified id returned by discovery to invoke it:

For a server endpoint, call these methods on the machine-bound `serverClient`
created above, not on the unbound `serverAccount`: every external Action needs
an exact daemon target. A daemon-local endpoint uses its root client because
the daemon supplies its current Machine when the target is omitted.

```ts
const discovered = await happier.actions.search({ query: 'save note' });
if (isHappierActionApprovalRequestCreated(discovered)) {
  throw new Error(`Approval required: ${discovered.artifactId}`);
}
const qualifiedId = discovered.actionSpecs.find(
  (action) => action.id === 'acme.notes/actions/save-note',
)?.id;
if (!qualifiedId) throw new Error('The expected contributed Action is not available.');
const definition = await happier.actions.get({ id: qualifiedId });
if (isHappierActionApprovalRequestCreated(definition)) {
  throw new Error(`Approval required: ${definition.artifactId}`);
}
const { actionSpec } = definition;
console.log(actionSpec.inputSchema);

// Construct input that satisfies actionSpec.inputSchema before invoking.
// Required fields may be expressed inside oneOf/anyOf branches, not only in
// the schema's top-level `required` array.
const input = { /* fields declared by this Action */ };
const invocation = await happier.actions.invoke(qualifiedId, input);
if (isHappierActionApprovalRequestCreated(invocation)) {
  throw new Error(`Approval required: ${invocation.artifactId}`);
}
console.log(invocation);
```

The convenience method also accepts the canonical structured
`{ pluginId, localId }` identity. A string must use the exact
`<pluginId>/actions/<localId>` discovery spelling; malformed strings reject
locally with `TypeError` before any HTTP request. The generated raw
`actions.action.spec.search(...)`, `actions.action.spec.get(...)`, and
`actions.action.invoke(...)` methods retain the Protocol Action input shapes.

The **External API & SDK** setting starts Allowed for API-eligible built-in and
contributed Actions, so Action Settings add no approval prompt by default. A
non-safe contributed Action still requires the host's live current-intent
confirmation; Allowed does not suppress that independent safety contract. A
present user can also change an Action's **External API & SDK** setting to
require approval or turn it off. That setting does not raise an API Token above
`account_automation`: token management, approval decisions, and other
present-user controls reject with `present_user_required`.

When connected to the Account server, `machines.list()` reads its existing
authenticated `/v1/machines` bootstrap and returns the target-selection fields
plus each machine's `kind` (`persistent`, or `ephemeral_session_runner` for a
Temporary computer). Use the selected id with `machine(id).sessions.spawn(...)`.
This bootstrap is separate from the `actions.machines.list(...)` operation and
does not select a default machine for a server Action request.

An encryption-capable credential also uses that same bootstrap to decide what a
protected Action seals against. A Temporary computer holds no Account material,
so a request targeting one is sealed with that machine's own published content
key after its creator-signed binding verifies; anything that does not verify
fails with `invalid_encrypted_envelope` rather than falling back.

## API reference

Use the package's exported types as the canonical static contract for SDK
methods, inputs, and results. The generated [API inventory](./API.md) lists the
public exports, and its companion `api-declarations.md` records their
signatures. At runtime, use `actions.search(...)` and `actions.get(...)` for
discovery, then call `actions.execute(...)` when the Action id is selected
dynamically. At a server endpoint, do that through a machine-bound client. The
generated raw `actions.action.spec.search(...)` and
`actions.action.spec.get(...)` methods remain available. Do not replace those
sources with a hand-maintained method list.

The client accepts an API Token, including the development-only encryption-capable
`hapc_v1` credential issued by a trusted device. It never reads CLI profiles,
persists credentials, accepts an Account recovery/signing secret, retries a
mutation, or fails a mutation over to another endpoint. Abort individual calls
with `AbortSignal`; `await close()` aborts outstanding calls. During shutdown it
gives active transcript and execution-run cleanup requests up to one second to
settle before destroying its transport. Ordinary bearer-only server-mediated
requests are readable by that server. The public endpoint is
`POST /v1/actions/:actionId`: use either a daemon-local
`http://127.0.0.1:<daemon-port>` endpoint or a configured server origin. The
server origin relays to the exact selected machine, so it works with a
NAT-hidden daemon but needs an explicit target. Select the daemon-local endpoint
when direct local transport is required. Server revocation takes effect on the
next verification; a daemon that has a positive validation result may accept a
revoked token for at most 60 seconds and returns `auth_unavailable` after that
cache expires if it cannot reach the server.

The encryption-capable implementation and focused HTTP lifecycle tests are
present in development source. A loaded end-to-end SDK journey through both the
direct-daemon and server-relay origins has not yet been certified, and this
contract has not shipped in a public release.

Protected delivery to a restricted Runner is not available. That route remains
fail-closed until the Runner Machine envelope can be authenticated independently
of the configured Home; the SDK does not accept a key supplied by that same Home
as proof of its own Machine claim. Use an ordinary authorized Account daemon for
protected calls in this preview.

With `hapc_v1`, the SDK sends only the embedded bearer in Authorization. It
retrieves that token's wrapped content key, checks the locally pinned Home,
Account, token and public key, then opens it locally. Action inputs and complete
results use the shared protected transport; an unsupported peer, stale binding
or invalid envelope fails the call without falling back to plaintext. Bind an
explicit target for encrypted calls, including calls to a direct daemon. Opened
material is shared by the client and its child handles until `close()` completes
cleanup and clears it. Authorization remains subject to token expiry and revocation.

This credential grants Account-wide content-key access. Revocation cannot recall
keys or data already obtained, and the content key alone does not open historical
recovery-secret-only ciphertext. The protected relay transport retains Happier's
active-Home trust boundary: a malicious configured Home can still issue a separate
permitted raw Action. Keep the compound credential out of logs and child
environments. The CLI retains it only for in-process SDK use; it refuses the
compound credential before any tmux or child continuation rather than
downgrading it to the embedded bearer.

For a mutating Action, the SDK generates a request ID when the caller does not
supply one, but that generated value is not returned. If you may need to
reconcile an uncertain mutation outcome, generate and retain the ID in your own
code and pass it as `options.requestId`. Request IDs are correlation unless the
Action's own contract gives them idempotency semantics; the SDK provides no
receipt store or automatic retry subsystem.

The environment lookup in the example is caller code. `connect()` requires its
`token` option and never reads `HAPPIER_TOKEN`, a CLI profile, or any credential
store implicitly.

`session.followTranscript()` is a finite, demand-driven async iterator: it does
not keep fetching while its consumer is not awaiting the next item, and an
early loop exit or `await close()` releases its `transcript.unfollow` lease. Use
`runs.startStream({ runId, ... })` for a genuine execution-run stream. Its
handle exposes `runId`, `streamId`, `cancel()`, and an async iterator; normal
completion, early iterator return, an abort signal, and `await close()` all cancel
the canonical stream. A machine-bound client's stream start, reads, and cancel
stay on that same target. On a root client, a run input with `sessionId`
automatically binds start, reads, and cancel to that Session; a detached run still
needs an explicit machine target at a server endpoint. Snapshot Actions remain
ordinary methods.

## Session-owned execution runs

Input addressed to a run inside a Session is ordinary Session input with one
optional logical recipient, so it uses the same admission, idempotency and result
contract as a main-Session send:

```ts
await client.actions.session.message.send({
  sessionId,
  message: 'Focus on the parser failure.',
  recipient: { kind: 'execution_run', runId },
});
```

For a runtime that supports retained interactive runs, start through the generated
Action and bind its returned ID with `session.runs.get(runId)`. This development
flow requires the target-aware Session admission and interactive runtime support
on the selected components:

```ts
const started = await client.actions.execution.run.start({
  sessionId,
  backendTarget,
  permissionMode,
  intent: 'delegate',
  runClass: 'long_lived',
  retentionPolicy: 'resumable',
  ioMode: 'streaming',
});
if (isHappierActionApprovalRequestCreated(started)) {
  throw new Error(`Approval required: ${started.artifactId}`);
}
const run = client.sessions.get(sessionId).runs.get(started.runId);

await run.send('Focus on the parser failure.');
await run.sendAndWait('Finish this turn and summarize.', { timeoutSeconds: 300 });
const transcript = await run.history({ limit: 50 });
await run.stop();
const terminal = await run.wait({ timeoutSeconds: 300 });
```

Choose `backendTarget` and `permissionMode` for your runtime, and import
`isHappierActionApprovalRequestCreated` from `@happier-dev/sdk` to handle the raw
Action's approval result. Physical `options.target` selects the executing Machine
or Session route; logical `input.recipient` selects the run inside that Session.

The bound handle preserves the canonical Action behavior:

- `send`/`sendAndWait` perform exactly one `session.message.send`. `sendAndWait`
  settles on the exact admitted target turn; it never substitutes parent-Session
  idle, a run status read, polling, or a retry. A lost correlation returns the
  canonical `outcomeUnknown` result rather than a guess.
- `wait()` observes a **terminal** run status, not conversational idle. Its typed
  observation timeout leaves the run running.
- `history()` reads `execution.run.get` for the canonical sidechain
  correspondence and then reads that exact sidechain through
  `session.transcript.get`. It caches nothing and never falls back to the main
  transcript scope; if the run read fails, no transcript request is sent. A
  response that names no sidechain correspondence is not a result
  `execution.run.get` can return, so it rejects as `invalid_action_output`
  before any transcript request is sent. A caller-supplied
  `requestId` applies only to the transcript request. The handle reads its own
  sidechain, so it refuses a `projection` rather than quietly ignoring one.
- The handle's bound `sessionId`, recipient and wait mode are written after your
  input, so an untyped caller cannot redirect them.
- Type-level omission cannot constrain plain JavaScript, so every bound method
  validates its finished body against the canonical public Action schema before
  transport. A host-only or unknown field — plugin `source`, attachments, a
  structured launch — rejects locally as `HappierActionError` with the daemon's
  own `invalid_parameters` code instead of travelling inside a sealed request.
- `session.send(message, options?)` is unchanged: its second argument is still
  transport options, and an ordinary Session send serializes no `recipient`.

`actions.execution.run.send` remains available for a genuinely **detached** run
(`sessionId: null`), which has no parent Session admission owner. The bound
Session handle never calls it.

## Release posture

This package is a Developer Preview. The repository source remains private at
version `0.0.0` until the first-publication gates pass and release work is
explicitly authorized. Preview APIs can change before a stable release.
