import { asRecord, normalizeString, readNonBlankOpaqueIdentifier } from './openCodeParsing.js';
import { normalizeOpenCodeV2PermissionRequest } from './openCodeV2Wire.js';
import { OPENCODE_CONNECTED_SERVICE_SELECTION_IDENTITY_ENV } from './managedServerState.js';
import { OPEN_CODE_REQUEST_AUTH_CAPABILITY_PATH_ENV } from '../../auth/services/requestAuth/env.js';
import type { OpenCodeGlobalEvent, OpenCodeRuntimeFetch } from './openCodeServerClient.js';

/**
 * Which OpenCode HTTP surface a reachable server speaks.
 *
 * `v1` is the long-standing root route space (`/session`, `/event`, `/mcp`,
 * `/global/*`). `v2` is the official V2 beta, distributed as the separate
 * `opencode2` executable and serving the `/api/*` surface.
 *
 * Pinned evidence (`comparators/opencode` at
 * `10765ff2a9da8c3b88e4de873aa383a49c318912`):
 *
 * - `packages/app/src/utils/server-protocol.ts` is OpenCode's own discriminator
 *   and the probe order mirrored by `detectOpenCodeServerDialect` below;
 * - the current stable binary mounts **both** generations. `OpenCodeHttpApi`
 *   (`packages/opencode/src/server/routes/instance/httpapi/api.ts`) composes its
 *   root/`/global/*`/`/event` groups *and* `ServerApi`, and the serving side
 *   (`.../httpapi/server.ts`) imports `Api` and `handlers` from
 *   `@opencode-ai/server`, so the `/api/*` routes are answered, not merely
 *   declared. A stable build older than this pin need not answer them at all;
 * - the V2 server does not reciprocate. `packages/server/src/api.ts` is
 *   `makeDefaultApi(...)` from `packages/protocol/src/api.ts`, whose entire
 *   route inventory is `/api/*` plus `/experimental/project/:projectID/copy`.
 *   There is no `/global` group and no root `/session` or `/event`;
 * - `packages/opencode/src/config/v2-compat.ts:111` names `opencode2` as the
 *   executable that owns the V2 configuration dialect.
 *
 * That asymmetry is the whole discriminator: `/global/health` is answered only
 * by a V1 server, and it is answered by every V1 server.
 *
 * Selecting `v2` moves the whole surface — request routes, payload shapes,
 * response envelopes and the event stream — onto the standalone V2 contract
 * (`openCodeV2Wire.ts`). The handful of operations the V2 protocol simply does
 * not declare (dynamic MCP registration, fork, todo reads, `/global/config`)
 * fail as typed, operation-scoped `unsupported` rather than as an invented
 * route; see `OpenCodeServerUnsupportedOperationError`.
 */
export type OpenCodeServerDialect = 'v1' | 'v2';

/**
 * The legacy liveness route, mounted only by the V1 instance server
 * (`packages/opencode/src/server/routes/instance/httpapi/groups/global.ts`).
 * The V2 server package declares no `/global/*` group, so a healthy answer here
 * is decisive for V1 — decisive enough that it wins even when an `/api` surface
 * also answers.
 */
export const OPEN_CODE_V1_HEALTH_PATH = '/global/health';

/**
 * The `/api` liveness route: the V2 server's only one, and one the current
 * stable binary answers too. Its pinned success schema is literally
 * `{ healthy: Schema.Literal(true) }`
 * (`packages/protocol/src/groups/health.ts`), and its handler
 * (`packages/server/src/handlers/health.ts`) returns exactly that.
 *
 * Nothing in `packages/server/src` emits a `pid`, so the `typeof pid ===
 * 'number'` branch in OpenCode's own client is unreachable against every pinned
 * server. Mirroring it made `v2` unselectable; the healthy marker plus the
 * absence of the legacy route is what actually separates the two.
 */
export const OPEN_CODE_V2_HEALTH_PATH = '/api/health';

/**
 * Each dialect probe gets its own short deadline. The managed-service request
 * owner otherwise permits a request to remain open for its general five-minute
 * ceiling, so a stalled legacy route could prevent the V2 fallback probe from
 * ever running during session admission.
 */
const OPEN_CODE_DIALECT_PROBE_TIMEOUT_MS = 2_000;

/**
 * The liveness route a server of this generation actually mounts.
 *
 * One owner for "which health path belongs to which dialect", shared by the
 * reachable-server probe below and the managed-service readiness declaration in
 * `spawnSpec.ts`, so the two can never disagree.
 */
export function openCodeServerHealthPath(dialect: OpenCodeServerDialect): string {
  return dialect === 'v2' ? OPEN_CODE_V2_HEALTH_PATH : OPEN_CODE_V1_HEALTH_PATH;
}

/**
 * The official name of the V2 beta executable, and the alternate lookup name of
 * the OpenCode system tool (`manifest.ts`). The pinned V1 repository names it
 * only in a diagnostic — `'... or run opencode2'`
 * (`packages/opencode/src/config/v2-compat.ts:111`) — because the beta ships on
 * its own distribution channel.
 */
export const OPEN_CODE_V2_EXECUTABLE_NAME = 'opencode2';

/**
 * Which liveness route an *owned* server will answer, read from the executable
 * the host actually resolved for it.
 *
 * The binary, not the requested transport, decides which routes the child
 * mounts: an `opencode2` child mounts no `/global/*` at all, so probing the
 * legacy route would leave a beta-only install permanently unhealthy and its
 * sessions unopenable. Conversely `HAPPIER_OPENCODE_SERVER_DIALECT=v2` must not
 * move readiness onto `/api/health`, because a stable server older than the
 * pinned 1.18.25 mounts no `/api` surface to answer it.
 *
 * Matching is on the exact resolved file name, extension-insensitive so a
 * Windows `PATHEXT` shim (`opencode2.cmd`) reads the same as a POSIX symlink.
 * A name that merely contains `opencode2` is not the beta.
 */
export function readOpenCodeManagedServerDialect(
  executablePath: string | null | undefined,
): OpenCodeServerDialect {
  const resolvedPath = normalizeString(executablePath);
  if (!resolvedPath) return 'v1';
  const fileName = resolvedPath.split(/[/\\]/u).pop() ?? '';
  const baseName = fileName.replace(/\.[^.]+$/u, '').toLowerCase();
  return baseName === OPEN_CODE_V2_EXECUTABLE_NAME ? 'v2' : 'v1';
}

/**
 * The V2 event stream. Unlike the V1 `/event` route it is not directory-scoped
 * (events carry `location` instead).
 *
 * It is a **live** stream with no resume contract. The pinned handler
 * (`packages/server/src/handlers/event.ts`) encodes every frame with
 * `id: undefined`, reads no request header, and subscribes a bounded live queue
 * (`EventV2.allBounded(events, 256)`) prefixed with one `server.connected`
 * frame. Events produced while no connection is open are not recoverable, so
 * Happier must not send `Last-Event-ID` or present a reconnect as replay.
 */
export const OPEN_CODE_V2_EVENT_PATH = '/api/event';

/**
 * The launch-environment key that opts a session into the V2 beta transport.
 *
 * `auto` (the default, and any unrecognised value) means V1. That is
 * deliberate and not a placeholder for later auto-detection: the `/api/*`
 * surface also ships on current stable OpenCode servers, so its mere presence
 * does not prove the V2 session engine is the one behind it. Selecting V2 from
 * surface presence alone would move every existing user onto a contract Happier
 * has no evidence their server implements.
 */
export const HAPPIER_OPENCODE_SERVER_DIALECT_ENV_KEY = 'HAPPIER_OPENCODE_SERVER_DIALECT';

export type OpenCodeRequestedServerDialect = 'auto' | 'v2';

export function readRequestedOpenCodeServerDialect(
  values: Readonly<Record<string, unknown>> | undefined,
): OpenCodeRequestedServerDialect {
  return normalizeString(values?.[HAPPIER_OPENCODE_SERVER_DIALECT_ENV_KEY]).toLowerCase() === 'v2'
    ? 'v2'
    : 'auto';
}

/**
 * Which dialect this session should ask for, from everything the host already
 * knows before the first request.
 *
 * `managedServerDialect` is the generation of the executable Happier itself is
 * about to run, read by `readOpenCodeManagedServerDialect` from the resolved
 * system tool. When Happier owns an `opencode2` child it is not guessing: that
 * binary mounts `/api/*` and nothing else, so its readiness route and its
 * request routes must come from the same fact. Leaving such a session at `auto`
 * is what previously gave a managed beta server V2 readiness and V1 requests.
 *
 * A server Happier did not spawn (`null`) keeps the explicit launch-environment
 * opt-in, because there the binary is unknown and only the probe can decide.
 */
export function resolveRequestedOpenCodeServerDialect(params: Readonly<{
  values: Readonly<Record<string, unknown>> | undefined;
  managedServerDialect: OpenCodeServerDialect | null;
}>): OpenCodeRequestedServerDialect {
  if (params.managedServerDialect === 'v2') return 'v2';
  return readRequestedOpenCodeServerDialect(params.values);
}

/**
 * Whether this launch carries Happier's connected-service request-auth
 * materialization — the generated `happier-request-auth-<provider>.js` plugin
 * Happier writes into the session's isolated OpenCode config home.
 *
 * That plugin is written against OpenCode's V1 plugin contract: a default-export
 * factory returning an `auth` hook whose `loader` supplies the provider `fetch`
 * (`agent/auth/services/requestAuth/source.ts`). OpenCode's V2 plugin contract
 * is a different shape — `{ id, setup(context) }` with a `PluginContext` of
 * `agent`, `aisdk`, `catalog`, `command`, `integration`, `plugin`, `reference`
 * and `skill` hooks and **no `auth` hook**
 * (`comparators/opencode/packages/plugin/src/v2/promise/context.ts`). V2 moves
 * provider credentials to its `integration`/`credential` model instead.
 *
 * Whether an `opencode2` server still loads V1-shaped plugins from
 * `$XDG_CONFIG_HOME/opencode/plugin` is not determinable from the pinned
 * comparator, which is the V1 binary's repository. So this combination is
 * *unproven*, not known-broken — and Happier says so on a default-on signal
 * rather than inventing a V2 auth-plugin lifecycle it cannot verify.
 */
export function usesOpenCodeConnectedServiceRequestAuth(
  values: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return normalizeString(values?.[OPENCODE_CONNECTED_SERVICE_SELECTION_IDENTITY_ENV]).length > 0
    || normalizeString(values?.[OPEN_CODE_REQUEST_AUTH_CAPABILITY_PATH_ENV]).length > 0;
}

export type OpenCodeServerDialectDetection = Readonly<{
  dialect: OpenCodeServerDialect;
  requested: OpenCodeRequestedServerDialect;
  /**
   * The observed probe outcome, or `null` when no probe was needed. Carried out
   * of the detector rather than logged inside it so the one caller can report
   * the decision on a default-on signal.
   */
  probe: Readonly<{
    path: string;
    status: number | null;
    error?: unknown;
  }> | null;
}>;

function readsHealthyMarker(body: unknown): boolean {
  return asRecord(body)?.healthy === true;
}

type OpenCodeHealthProbe = Readonly<{
  probe: NonNullable<OpenCodeServerDialectDetection['probe']>;
  body: unknown;
}>;

async function probeOpenCodeHealth(
  fetch: OpenCodeRuntimeFetch,
  path: string,
): Promise<OpenCodeHealthProbe> {
  try {
    const response = await fetch({
      url: path,
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      timeoutMs: OPEN_CODE_DIALECT_PROBE_TIMEOUT_MS,
    });
    if (!response.ok) return { probe: { path, status: response.status }, body: null };
    // A body that is not JSON — a proxy error page, say — is simply not an
    // answer to this question, and reaches the same safe result as a refusal.
    return { probe: { path, status: response.status }, body: await response.json().catch(() => null) };
  } catch (error) {
    return { probe: { path, status: null, error }, body: null };
  }
}

/**
 * Decide which dialect this session speaks to its OpenCode server.
 *
 * A session that did not ask for the beta transport takes the proven V1 path
 * with no probe at all.
 *
 * A session that did ask is answered by probing in the official
 * discriminator's order (`packages/app/src/utils/server-protocol.ts`, pinned at
 * `10765ff2a9da8c3b88e4de873aa383a49c318912`), on the route asymmetry the
 * pinned servers actually exhibit:
 *
 * 1. a healthy `/global/health` means V1, even if an `/api` surface also
 *    answers — only the stable binary mounts the legacy group, and it mounts
 *    the `/api/*` groups alongside it, so this correctly claims both the
 *    legacy-only and the both-generations server;
 * 2. otherwise a healthy `/api/health` means V2 — with the legacy route absent,
 *    `makeDefaultApi` is the only pinned server that shape can belong to;
 * 3. anything else is V1.
 *
 * No `pid` is required, because no pinned server emits one (see
 * `OPEN_CODE_V2_HEALTH_PATH`). Requiring it made step 2 unreachable and left
 * `v2` permanently unselectable.
 *
 * One deliberate deviation from the official client: where it defaults an
 * undecided server to V2, Happier falls back to V1. Happier's request routes
 * are the V1 ones, so an unreachable or ambiguous probe must not move a session
 * off the transport that is proven against it. The caller reports which way it
 * went, including the deciding probe.
 */
export async function detectOpenCodeServerDialect(params: Readonly<{
  fetch: OpenCodeRuntimeFetch;
  requested: OpenCodeRequestedServerDialect;
}>): Promise<OpenCodeServerDialectDetection> {
  if (params.requested !== 'v2') {
    return { dialect: 'v1', requested: params.requested, probe: null };
  }
  const legacy = await probeOpenCodeHealth(params.fetch, OPEN_CODE_V1_HEALTH_PATH);
  if (readsHealthyMarker(legacy.body)) {
    return { dialect: 'v1', requested: params.requested, probe: legacy.probe };
  }
  const current = await probeOpenCodeHealth(params.fetch, OPEN_CODE_V2_HEALTH_PATH);
  return {
    dialect: readsHealthyMarker(current.body) ? 'v2' : 'v1',
    requested: params.requested,
    probe: current.probe,
  };
}

/**
 * The V2 event types the current runtime domain would otherwise lose.
 *
 * The standalone server publishes `EventManifest.ServerDefinitions`
 * (`packages/schema/src/event-manifest.ts`), which is narrower than the full
 * `Definitions` inventory the stable binary carries. Against the domain's
 * consumed vocabulary that means:
 *
 * - carried unchanged: the *durable* V1 session events — `session.created`,
 *   `session.updated`, `message.updated`, `message.part.updated` — plus
 *   `todo.updated` and the handler's own `server.connected` frame;
 * - renamed, and normalized below: `message.part.delta` →
 *   `session.next.text.delta`, `permission.asked` → `permission.v2.asked`,
 *   `question.asked` → `question.v2.asked`;
 * - absent: `session.idle`, `session.status` and `session.error`, whose
 *   definitions are in `Definitions` only. Turn settlement therefore rests on
 *   the authoritative `/api/session/active` poll and the message inventory,
 *   both of which the runtime already treats as the deciding evidence. No
 *   substitute event is invented for them.
 *
 * `message.part.created` is not in either manifest; the domain accepts it
 * defensively and nothing is lost by its absence here.
 */
const OPEN_CODE_V2_TEXT_DELTA_TYPE = 'session.next.text.delta';
const OPEN_CODE_V1_PART_DELTA_TYPE = 'message.part.delta';

/**
 * The two request events V2 renamed rather than dropped.
 *
 * `packages/schema/src/permission.ts` and `.../question.ts` define the V2 asks
 * as `permission.v2.asked` and `question.v2.asked`, and both are in the
 * standalone server's manifest (`EventManifest.ServerDefinitions`), while the
 * V1-named events are not. The domain's handlers are keyed on the V1 names, so
 * an unrenamed frame is silently ignored and the request is never answered.
 *
 * Only the permission payload needs field work: V2 moved the permission name
 * into a string `action` and renamed `patterns` to `resources`. `Question.Request`
 * already carries `id`, `sessionID` and `questions[]` exactly as the domain
 * reads them.
 */
const OPEN_CODE_V2_PERMISSION_ASKED_TYPE = 'permission.v2.asked';
const OPEN_CODE_V2_QUESTION_ASKED_TYPE = 'question.v2.asked';
const OPEN_CODE_V1_PERMISSION_ASKED_TYPE = 'permission.asked';
const OPEN_CODE_V1_QUESTION_ASKED_TYPE = 'question.asked';

/**
 * Normalize one V2 instance event into the runtime domain the OpenCode
 * projection already consumes.
 *
 * The V2 envelope is `{ id, type, data, location?, durable? }` while the V1
 * instance stream emits `{ type, properties }`. So normalization is the
 * envelope rename, the directory scoping V1 got from its query parameter, and
 * the one renamed event type above.
 *
 * Returns `null` for an event that is not addressed to this session's
 * directory, or that carries no usable type.
 */
export function normalizeOpenCodeV2InstanceEvent(
  rawEvent: unknown,
  directory: string | null,
): OpenCodeGlobalEvent | null {
  const record = asRecord(rawEvent);
  const type = normalizeString(record?.type);
  if (!type) return null;

  // The V2 stream is server-wide. `location.directory` is the only scoping the
  // server offers, so an event that names a different directory is not ours.
  // An event without a location (the `server.connected` boundary, and any
  // instance-wide notice) stays addressed to every subscriber, exactly as the
  // V1 directory-scoped stream delivered it.
  const eventDirectory = normalizeString(asRecord(record?.location)?.directory);
  if (directory && eventDirectory && eventDirectory !== directory) return null;

  if (type === OPEN_CODE_V2_TEXT_DELTA_TYPE) {
    const data = asRecord(record?.data);
    // OpenCode minted this assistant message id; the running turn is attributed to it.
    const messageId = readNonBlankOpaqueIdentifier(data?.assistantMessageID);
    if (!messageId) return null;
    return {
      type: OPEN_CODE_V1_PART_DELTA_TYPE,
      properties: {
        ...data,
        messageID: messageId,
      },
    };
  }

  if (type === OPEN_CODE_V2_PERMISSION_ASKED_TYPE) {
    const properties = normalizeOpenCodeV2PermissionRequest(record?.data);
    if (!properties) return null;
    return { type: OPEN_CODE_V1_PERMISSION_ASKED_TYPE, properties };
  }

  if (type === OPEN_CODE_V2_QUESTION_ASKED_TYPE) {
    return { type: OPEN_CODE_V1_QUESTION_ASKED_TYPE, properties: record?.data };
  }

  return { type, properties: record?.data };
}
