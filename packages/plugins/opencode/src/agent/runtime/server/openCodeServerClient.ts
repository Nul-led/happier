import { formatOpenCodeServerPromptErrorMessage } from './formatOpenCodeServerPromptErrorMessage.js';
import type { HttpMethod } from '@happier-dev/plugin-sdk/http';
import {
  normalizeOpenCodeV2InstanceEvent,
  OPEN_CODE_V2_EVENT_PATH,
  type OpenCodeServerDialect,
} from './dialect.js';
import { readOpenCodeEventReconnectBackoffMs } from './openCodeEventReconnect.js';
import { asRecord, normalizeString, readNonBlankOpaqueIdentifier } from './openCodeParsing.js';
import {
  buildOpenCodeV2ModelRef,
  buildOpenCodeV2Prompt,
  combineOpenCodeV2Providers,
  normalizeOpenCodeV2Messages,
  normalizeOpenCodeV2PermissionRequest,
  openCodeV2LocationQuery,
  readOpenCodeV2Data,
  readOpenCodeV2DataArray,
  readOpenCodeV2MessagePage,
  readOpenCodeV2SessionStatus,
} from './openCodeV2Wire.js';
import { subscribeSseJson } from './openCodeSse.js';
import type { OpenCodePromptPart } from './promptParts.js';
import type {
  OpenCodeNativeFetch,
  OpenCodeServerTransport,
} from './transport.js';

export type OpenCodeRuntimeFetchResponse = Readonly<{
  ok: boolean;
  status: number;
  statusText?: string;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type OpenCodeRuntimeFetch = (request: Readonly<{
  url: string;
  method?: HttpMethod;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  metadata?: Readonly<Record<string, unknown>>;
}>) => Promise<OpenCodeRuntimeFetchResponse>;

export type OpenCodeGlobalEvent = Readonly<{
  directory?: string;
  payload?: Readonly<{
    type?: string;
    properties?: unknown;
  }>;
  type?: string;
  properties?: unknown;
}>;

export type OpenCodeGlobalEventDelivery = Readonly<{
  /**
   * Global replay events remain untrusted observations. The directory-scoped `/event` route emits
   * a connection boundary before subscribing to the instance bus, so only that route can produce
   * `accepted-live` after its boundary.
   */
  provenance: 'connection-boundary' | 'untrusted-observation' | 'accepted-live';
  connectionGeneration: number;
}>;

export type OpenCodeServerPromptModel = Readonly<{
  providerID: string;
  modelID: string;
}>;

export type OpenCodeServerPermissionReply = 'once' | 'always' | 'reject';

export type OpenCodeMcpStatus = Readonly<
  | { status: 'connected' }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'needs_auth' }
  | { status: 'needs_client_registration'; error: string }
>;

function readOpenCodeMcpStatus(response: unknown, serverName: string): OpenCodeMcpStatus {
  const statusMap = asRecord(response);
  const rawStatus = asRecord(statusMap?.[serverName]);
  if (!rawStatus) {
    throw new Error(`OpenCode MCP registration response omitted status for "${serverName}"`);
  }
  const status = normalizeString(rawStatus.status);
  if (status === 'connected' || status === 'disabled' || status === 'needs_auth') {
    return { status };
  }
  if (status === 'failed' || status === 'needs_client_registration') {
    const error = normalizeString(rawStatus.error);
    if (!error) {
      throw new Error(`OpenCode MCP registration returned status "${status}" without an error for "${serverName}"`);
    }
    return { status, error };
  }
  throw new Error(`OpenCode MCP registration returned an unknown status for "${serverName}"`);
}

export type OpenCodeServerClient = Readonly<{
  mcpAdd(input: Readonly<{
    directory: string;
    name: string;
    config: unknown;
  }>): Promise<OpenCodeMcpStatus>;
  sessionCreate(input: Readonly<{ directory: string }>): Promise<Readonly<{ id: string }>>;
  sessionFork(input: Readonly<{
    sessionId: string;
    messageId?: string;
  }>): Promise<Readonly<{ id: string }>>;
  sessionPromptAsync(input: Readonly<{
    directory?: string | null;
    sessionId: string;
    messageId?: string | null;
    text: string;
    parts?: readonly OpenCodePromptPart[];
    model?: OpenCodeServerPromptModel | null;
    variant?: string | null;
    config?: Readonly<Record<string, unknown>> | null;
  }>): Promise<unknown>;
  sessionAbort(input: Readonly<{ directory?: string | null; sessionId: string }>): Promise<void>;
  sessionSummarize(input: Readonly<{
    sessionId: string;
    model: OpenCodeServerPromptModel;
    auto: boolean;
  }>): Promise<void>;
  sessionStatus(input: Readonly<{ directory?: string | null; sessionId: string }>): Promise<unknown>;
  sessionMessages(input: Readonly<{ directory?: string | null; sessionId: string }>): Promise<readonly unknown[]>;
  sessionTodo(input: Readonly<{ directory?: string | null; sessionId: string }>): Promise<readonly unknown[]>;
  permissionList(): Promise<readonly unknown[]>;
  questionList(): Promise<readonly unknown[]>;
  /**
   * `sessionId` is the session that owns the request. V1 answered permissions
   * and questions on flat `/permission/:id/...` routes; V2 owns them under
   * `/api/session/:sessionID/...`, so the owner has to travel with the reply.
   * V1 ignores it and keeps its proven route.
   */
  permissionReply(input: Readonly<{
    sessionId?: string | null;
    requestId: string;
    reply: OpenCodeServerPermissionReply;
    message?: string | null;
  }>): Promise<void>;
  questionReply(input: Readonly<{
    sessionId?: string | null;
    requestId: string;
    answers: readonly (readonly string[])[];
  }>): Promise<void>;
  questionReject(input: Readonly<{
    sessionId?: string | null;
    requestId: string;
  }>): Promise<void>;
  appSkills(input: Readonly<{ directory: string }>): Promise<unknown>;
  subscribeGlobalEvents(input: Readonly<{
    signal: AbortSignal;
    onEvent: (event: OpenCodeGlobalEvent, delivery: OpenCodeGlobalEventDelivery) => void;
    onUnavailable?: (error: unknown) => void;
  }>): Promise<void>;
  globalConfigGet(): Promise<Readonly<Record<string, unknown>>>;
  providersList(): Promise<readonly Readonly<{
    id: string;
    env?: readonly string[];
    models?: Readonly<Record<string, unknown>>;
  }>[]>;
}>;

export type OpenCodeServerRequestOperation =
  | 'mcp_registration'
  | 'server_request'
  | 'skill_catalog';

export class OpenCodeServerHttpError extends Error {
  readonly code: 'opencode_server_auth_failed' | 'opencode_server_request_failed';
  readonly operation: OpenCodeServerRequestOperation;
  readonly status: number;
  readonly statusText: string;
  readonly responseBodyPreview: string | null;

  constructor(params: Readonly<{
    message: string;
    operation: OpenCodeServerRequestOperation;
    status: number;
    statusText?: string | null;
    responseBodyPreview?: string | null;
  }>) {
    super(params.message);
    this.name = 'OpenCodeServerHttpError';
    this.operation = params.operation;
    this.status = params.status;
    this.statusText = params.statusText ?? '';
    this.responseBodyPreview = params.responseBodyPreview ?? null;
    this.code = isAuthFailureStatus(params.status)
      ? 'opencode_server_auth_failed'
      : 'opencode_server_request_failed';
  }
}

/**
 * An operation the reachable OpenCode server's protocol does not declare.
 *
 * These are absences, not refusals: the pinned V2 protocol
 * (`comparators/opencode/packages/protocol/src/api.ts`) has no MCP group, no
 * session fork route, no todo read route and no `/global/config`, so there is
 * nothing to call and nothing to retry. Reporting that as an ordinary request
 * failure would let callers treat a missing capability as a broken server.
 *
 * Callers decide what an absence costs them: MCP registration degrades the
 * session's Happier tools while leaving prompting intact, todo reads simply
 * publish no work state, and fork surfaces the limitation to the user.
 */
export type OpenCodeServerUnsupportedOperation =
  | 'mcp_registration'
  | 'session_fork'
  | 'session_todo'
  | 'session_prompt_config'
  | 'global_config';

export class OpenCodeServerUnsupportedOperationError extends Error {
  readonly code = 'opencode_server_operation_unsupported' as const;
  readonly operation: OpenCodeServerUnsupportedOperation;
  readonly dialect: OpenCodeServerDialect;

  constructor(params: Readonly<{
    operation: OpenCodeServerUnsupportedOperation;
    dialect: OpenCodeServerDialect;
    message: string;
  }>) {
    super(params.message);
    this.name = 'OpenCodeServerUnsupportedOperationError';
    this.operation = params.operation;
    this.dialect = params.dialect;
  }
}

export function isOpenCodeServerUnsupportedOperation(
  error: unknown,
  operation?: OpenCodeServerUnsupportedOperation,
): error is OpenCodeServerUnsupportedOperationError {
  if (!(error instanceof OpenCodeServerUnsupportedOperationError)) return false;
  return operation === undefined || error.operation === operation;
}

function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export function isOpenCodeServerAuthFailure(error: unknown): boolean {
  if (error instanceof OpenCodeServerHttpError) return isAuthFailureStatus(error.status);
  if (!error || typeof error !== 'object') return false;
  const record = error as Readonly<Record<string, unknown>>;
  return record.code === 'opencode_server_auth_failed'
    || record.status === 401
    || record.status === 403;
}

function createOpenCodeServerHttpError(params: Readonly<{
  prefix: string;
  operation: OpenCodeServerRequestOperation;
  status: number;
  statusText?: string | null;
  responseBodyPreview?: string | null;
}>): OpenCodeServerHttpError {
  const bodyPreview = normalizeString(params.responseBodyPreview);
  const statusLine = `${params.prefix}: ${params.status} ${params.statusText ?? ''}`.trim();
  return new OpenCodeServerHttpError({
    operation: params.operation,
    status: params.status,
    statusText: params.statusText,
    responseBodyPreview: bodyPreview || null,
    message: bodyPreview ? `${statusLine}\n${bodyPreview}` : statusLine,
  });
}

/**
 * Serialize a query exactly as its owner decided it.
 *
 * Every value here is already the caller's final answer: Happier-owned paths
 * arrive through `resolveDirectory`, and provider-minted tokens (the opaque V2
 * message cursor) arrive through `readNonBlankOpaqueIdentifier`. The serializer
 * therefore encodes the bytes it is given and omits only an absent or empty
 * value — re-trimming here would re-mint a cursor the server issued and break
 * the continuation at its issuer.
 */
function pathWithQuery(
  path: string,
  query: Readonly<Record<string, string | null | undefined>>,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(normalizedPath, 'http://opencode.invalid');
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value.length > 0) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

async function requestJson(params: Readonly<{
  fetch: OpenCodeRuntimeFetch;
  method: HttpMethod;
  path: string;
  query?: Readonly<Record<string, string | null | undefined>>;
  body?: unknown;
  operation?: OpenCodeServerRequestOperation;
  expectJson?: boolean;
}>): Promise<unknown> {
  const response = await params.fetch({
    url: params.query
      ? pathWithQuery(params.path, params.query)
      : params.path,
    method: params.method,
    headers: { 'content-type': 'application/json' },
    ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
  });
  if (!response.ok) {
    const responseBodyPreview = await readResponseBodyPreview(response);
    throw createOpenCodeServerHttpError({
      prefix: 'OpenCode server request failed',
      operation: params.operation ?? 'server_request',
      status: response.status,
      statusText: response.statusText,
      responseBodyPreview,
    });
  }
  if (params.expectJson === false || response.status === 204) {
    return null;
  }
  return await response.json();
}

async function requestOptionalJson(params: Readonly<{
  fetch: OpenCodeRuntimeFetch;
  method: HttpMethod;
  path: string;
  query?: Readonly<Record<string, string | null | undefined>>;
  body?: unknown;
  operation?: OpenCodeServerRequestOperation;
}>): Promise<unknown> {
  const response = await params.fetch({
    url: params.query
      ? pathWithQuery(params.path, params.query)
      : params.path,
    method: params.method,
    headers: { 'content-type': 'application/json' },
    ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
  });
  if (!response.ok) {
    const responseBodyPreview = await readResponseBodyPreview(response);
    throw createOpenCodeServerHttpError({
      prefix: 'OpenCode server request failed',
      operation: params.operation ?? 'server_request',
      status: response.status,
      statusText: response.statusText,
      responseBodyPreview,
    });
  }
  if (response.status === 204) return undefined;
  const body = await response.text().catch(() => '');
  const normalized = normalizeString(body);
  if (!normalized) return undefined;
  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    throw new Error('OpenCode server request returned malformed JSON', { cause: error });
  }
}

async function readResponseBodyPreview(response: OpenCodeRuntimeFetchResponse): Promise<string | null> {
  try {
    const body = normalizeString(await response.text());
    if (!body) return null;
    return formatOpenCodeServerPromptErrorMessage(body);
  } catch {
    return null;
  }
}

/**
 * The session id OpenCode just minted. Happier hands it straight back to the
 * same server on every later call, so the reader decides presence only and the
 * accepted value keeps its exact bytes.
 */
function readSessionId(value: unknown): string {
  const record = asRecord(value);
  const id = readNonBlankOpaqueIdentifier(record?.id)
    ?? readNonBlankOpaqueIdentifier(record?.sessionID);
  if (!id) throw new Error('OpenCode server response did not include a session id');
  return id;
}

function readProviderId(value: unknown): string {
  if (typeof value === 'string') return normalizeString(value);
  return normalizeString(asRecord(value)?.id);
}

function readProviderList(raw: unknown): readonly Readonly<{
  id: string;
  env?: readonly string[];
  models?: Readonly<Record<string, unknown>>;
}>[] {
  const record = asRecord(raw);
  const all = Array.isArray(record?.all) ? record.all : [];
  const connectedRaw = Array.isArray(record?.connected) ? record.connected : null;
  const connectedIds = connectedRaw
    ? connectedRaw
      .map((value) => readProviderId(value))
      .filter((value) => value.length > 0)
    : null;
  const connected = connectedIds && connectedIds.length > 0 ? new Set(connectedIds) : null;

  return all.flatMap((provider) => {
    const providerRecord = asRecord(provider);
    const id = readProviderId(provider);
    if (!id || (connected && !connected.has(id))) return [];
    const env = Array.isArray(providerRecord?.env)
      ? providerRecord.env.map((value) => normalizeString(value)).filter((value) => value.length > 0)
      : undefined;
    const models = asRecord(providerRecord?.models) ?? undefined;
    return [{
      id,
      ...(env && env.length > 0 ? { env } : {}),
      ...(models ? { models } : {}),
    }];
  });
}

function buildPromptConfig(input: Readonly<{
  variant?: string | null;
  config?: Readonly<Record<string, unknown>> | null;
}>): Readonly<{
  variant?: string;
  config?: Readonly<Record<string, unknown>>;
}> {
  const configVariant = normalizeString(input.config?.variant);
  const variant = normalizeString(input.variant) || configVariant;
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.config ?? {})) {
    if (key === 'variant') continue;
    config[key] = value;
  }
  return {
    ...(variant ? { variant } : {}),
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
}

export async function subscribeOpenCodeGlobalEvents(params: Readonly<{
  baseUrl?: string;
  headers?: Readonly<Record<string, string>>;
  fetch: OpenCodeNativeFetch;
  signal: AbortSignal;
  onEvent: (event: OpenCodeGlobalEvent, delivery: OpenCodeGlobalEventDelivery) => void;
  onUnavailable?: (error: unknown) => void;
}>): Promise<void> {
  await subscribeOpenCodeEvents({
    ...params,
    eventPath: '/global/event',
    liveProvenance: 'untrusted-observation',
    streamEndedMessage: 'OpenCode global event stream ended',
    decodeEvent(rawEvent) {
      const eventRecord = asRecord(rawEvent);
      const payload = asRecord(eventRecord?.payload);
      const eventType = normalizeString(payload?.type ?? eventRecord?.type);
      if (!eventType) return null;
      const directory = normalizeString(eventRecord?.directory);
      return {
        ...(directory ? { directory } : {}),
        ...(payload
          ? { payload: { type: eventType, properties: payload.properties } }
          : { type: eventType, properties: eventRecord?.properties }),
      };
    },
  });
}

async function subscribeOpenCodeInstanceEvents(params: Readonly<{
  baseUrl?: string;
  headers?: Readonly<Record<string, string>>;
  directory?: string | null;
  fetch: OpenCodeNativeFetch;
  signal: AbortSignal;
  onEvent: (event: OpenCodeGlobalEvent, delivery: OpenCodeGlobalEventDelivery) => void;
  onUnavailable?: (error: unknown) => void;
}>): Promise<void> {
  await subscribeOpenCodeEvents({
    ...params,
    eventPath: pathWithQuery('/event', { directory: params.directory }),
    liveProvenance: 'accepted-live',
    streamEndedMessage: 'OpenCode instance event stream ended',
    decodeEvent(rawEvent) {
      const eventRecord = asRecord(rawEvent);
      const eventType = normalizeString(eventRecord?.type);
      if (!eventType) return null;
      return { type: eventType, properties: eventRecord?.properties };
    },
  });
}

/**
 * The OpenCode V2 beta instance stream.
 *
 * One V1 property changes: scoping moves from the `directory` query parameter
 * onto each event's `location`. Normalizing that here keeps the runtime domain
 * (`{ type, properties }`, directory-scoped, `server.connected`-gated)
 * identical for both dialects — including the reconnect contract, because the
 * V2 route is as live-only as the V1 one (see `OPEN_CODE_V2_EVENT_PATH`).
 */
async function subscribeOpenCodeV2InstanceEvents(params: Readonly<{
  baseUrl?: string;
  headers?: Readonly<Record<string, string>>;
  directory?: string | null;
  fetch: OpenCodeNativeFetch;
  signal: AbortSignal;
  onEvent: (event: OpenCodeGlobalEvent, delivery: OpenCodeGlobalEventDelivery) => void;
  onUnavailable?: (error: unknown) => void;
}>): Promise<void> {
  const directory = normalizeString(params.directory) || null;
  await subscribeOpenCodeEvents({
    ...params,
    eventPath: OPEN_CODE_V2_EVENT_PATH,
    liveProvenance: 'accepted-live',
    streamEndedMessage: 'OpenCode V2 instance event stream ended',
    decodeEvent: (rawEvent) => normalizeOpenCodeV2InstanceEvent(rawEvent, directory),
  });
}

async function subscribeOpenCodeEvents(params: Readonly<{
  baseUrl?: string;
  headers?: Readonly<Record<string, string>>;
  eventPath: string;
  liveProvenance: 'untrusted-observation' | 'accepted-live';
  streamEndedMessage: string;
  decodeEvent: (rawEvent: unknown) => OpenCodeGlobalEvent | null;
  fetch: OpenCodeNativeFetch;
  signal: AbortSignal;
  onEvent: (event: OpenCodeGlobalEvent, delivery: OpenCodeGlobalEventDelivery) => void;
  onUnavailable?: (error: unknown) => void;
}>): Promise<void> {
  let connectionGeneration = 0;
  let reconnectAttempt = 0;
  while (!params.signal.aborted) {
    let connectionBoundarySeen = false;
    let unavailableError: unknown = null;
    try {
      connectionGeneration += 1;
      const currentConnectionGeneration = connectionGeneration;
      // No resume token is sent on any dialect. Neither OpenCode event route
      // offers replay: the V1 route streams a live instance queue, and the
      // pinned V2 handler emits `id: undefined`, reads no request header, and
      // subscribes a bounded live queue. A `Last-Event-ID` here would be a
      // request the server ignores while making Happier act as though the gap
      // had been recovered.
      const headers: Record<string, string> = { ...(params.headers ?? {}) };
      const subscription = await subscribeSseJson<unknown>({
        url: params.baseUrl
          ? `${params.baseUrl.replace(/\/+$/u, '')}${params.eventPath}`
          : params.eventPath,
        headers,
        fetch: params.fetch,
        signal: params.signal,
        onMessage: (rawEvent) => {
          const event = params.decodeEvent(rawEvent);
          if (!event) return;
          const eventType = normalizeString(event.payload?.type ?? event.type);
          if (eventType === 'server.connected') {
            connectionBoundarySeen = true;
            params.onEvent(event, {
              provenance: 'connection-boundary',
              connectionGeneration: currentConnectionGeneration,
            });
            return;
          }
          if (!connectionBoundarySeen) return;
          params.onEvent(event, {
            provenance: params.liveProvenance,
            connectionGeneration: currentConnectionGeneration,
          });
        },
      });
      await subscription.done;
      unavailableError = new Error(params.streamEndedMessage);
    } catch (error) {
      if (params.signal.aborted) return;
      unavailableError = error;
    }
    if (params.signal.aborted) return;
    try {
      params.onUnavailable?.(unavailableError);
    } catch {
      // Availability notification is advisory and must not disable reconnect recovery.
    }
    // Both dialects begin every accepted connection with `server.connected`, so
    // the boundary is the one proof that this attempt progressed.
    const connectionProgressed = connectionBoundarySeen;
    const backoffAttempt = connectionProgressed ? 0 : reconnectAttempt;
    const shouldReconnect = await waitForOpenCodeEventReconnectBackoff({
      signal: params.signal,
      delayMs: readOpenCodeEventReconnectBackoffMs(backoffAttempt),
    });
    if (!shouldReconnect) return;
    reconnectAttempt = connectionProgressed
      ? 0
      : Math.min(reconnectAttempt + 1, 30);
  }
}

async function waitForOpenCodeEventReconnectBackoff(params: Readonly<{
  signal: AbortSignal;
  delayMs: number;
}>): Promise<boolean> {
  if (params.signal.aborted) return false;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (shouldReconnect: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      params.signal.removeEventListener('abort', onAbort);
      resolve(shouldReconnect);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), params.delayMs);
    timer.unref?.();
    params.signal.addEventListener('abort', onAbort, { once: true });
    if (params.signal.aborted) onAbort();
  });
}

/**
 * The one OpenCode HTTP client.
 *
 * `dialect` is the resolved answer to "which OpenCode surface is on the other
 * end", decided once per server by `detectOpenCodeServerDialect` and passed in
 * explicitly so there is exactly one decision-maker. It is deliberately not
 * re-derived here: a client that probed on its own would give every operation
 * its own opinion of the server.
 *
 * Every operation routes through this one factory on both dialects. `v1` keeps
 * the long-standing root routes, which the stable binary mounts alongside its
 * `/global/*` and `/api/*` groups
 * (`packages/opencode/src/server/routes/instance/httpapi/api.ts`). `v2` speaks
 * the standalone contract whose whole inventory is `/api/*`
 * (`packages/protocol/src/api.ts`), with its wire mapping owned by
 * `openCodeV2Wire.ts`. Operations that protocol does not declare throw
 * `OpenCodeServerUnsupportedOperationError` instead of guessing a route.
 */
export function createOpenCodeServerClient(input: Readonly<{
  transport: OpenCodeServerTransport;
  directory?: string | null;
  dialect: OpenCodeServerDialect;
}>): OpenCodeServerClient {
  const params: Readonly<{
    fetch: OpenCodeRuntimeFetch;
    streamFetch: OpenCodeNativeFetch;
    directory?: string | null;
  }> = {
    fetch: input.transport.request,
    streamFetch: input.transport.fetch,
    directory: input.directory,
  };
  const isV2 = input.dialect === 'v2';
  const resolveDirectory = (value?: string | null): string | null => (
    normalizeString(value) || normalizeString(params.directory) || null
  );
  const directoryQuery = (value?: string | null): Readonly<{ directory?: string }> => {
    const directory = resolveDirectory(value);
    return directory ? { directory } : {};
  };
  const locationQuery = (
    value?: string | null,
  ): Readonly<Record<string, string | undefined>> => (
    openCodeV2LocationQuery(resolveDirectory(value))
  );
  const unsupported = (
    operation: OpenCodeServerUnsupportedOperation,
    message: string,
  ): OpenCodeServerUnsupportedOperationError => new OpenCodeServerUnsupportedOperationError({
    operation,
    dialect: input.dialect,
    message,
  });
  /**
   * The session that owns a permission or question request. V2 routes every
   * reply under its session; without the owner there is no route to call, and
   * inventing one would answer the wrong session.
   */
  const requireReplySessionId = (value: string | null | undefined, what: string): string => {
    const sessionId = readNonBlankOpaqueIdentifier(value);
    if (!sessionId) {
      throw new Error(`OpenCode V2 ${what} replies require the owning session id`);
    }
    return sessionId;
  };

  return {
    /**
     * Dynamic MCP registration uses the legacy root route, which the stable
     * binary mounts as `McpApi`. The pinned V2 protocol declares no MCP group
     * at all (`packages/protocol/src/groups/`), so a V2 server has no dynamic
     * registration route to call — that is reported as an absent capability,
     * not as a failed request, so a V2 session loses only its Happier
     * MCP-backed tools rather than the ability to prompt.
     */
    async mcpAdd(input) {
      if (isV2) {
        throw unsupported(
          'mcp_registration',
          'OpenCode V2 servers expose no dynamic MCP registration route',
        );
      }
      const serverName = normalizeString(input.name);
      if (!serverName) throw new Error('OpenCode MCP registration requires a server name');
      const response = await params.fetch({
        url: pathWithQuery('/mcp', directoryQuery(input.directory)),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: serverName,
          config: input.config,
        }),
      });
      if (!response.ok) {
        const responseBodyPreview = await readResponseBodyPreview(response);
        throw createOpenCodeServerHttpError({
          prefix: 'OpenCode MCP registration failed',
          operation: 'mcp_registration',
          status: response.status,
          statusText: response.statusText,
          responseBodyPreview,
        });
      }
      return readOpenCodeMcpStatus(await response.json(), serverName);
    },
    async sessionCreate(input) {
      if (isV2) {
        const directory = resolveDirectory(input.directory);
        const response = await requestJson({
          fetch: params.fetch,
          method: 'POST',
          path: '/api/session',
          body: directory ? { location: { directory } } : {},
        });
        return { id: readSessionId(readOpenCodeV2Data(response)) };
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'POST',
        path: '/session',
        query: directoryQuery(input.directory),
        body: {},
      });
      return { id: readSessionId(response) };
    },
    async sessionFork(input) {
      if (isV2) {
        throw unsupported(
          'session_fork',
          'OpenCode V2 servers expose no session fork route',
        );
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'POST',
        path: `/session/${encodeURIComponent(input.sessionId)}/fork`,
        query: directoryQuery(params.directory),
        body: input.messageId ? { messageID: input.messageId } : {},
      });
      return { id: readSessionId(response) };
    },
    async sessionPromptAsync(input) {
      if (isV2) {
        // V2 splits what V1 accepted in one body: the model is its own
        // `session.switchModel` call, and `session.prompt` carries only
        // `{ id?, prompt, delivery?, resume? }`.
        const promptConfig = buildPromptConfig(input);
        if (promptConfig.config) {
          throw unsupported(
            'session_prompt_config',
            'OpenCode V2 servers accept no per-prompt configuration override',
          );
        }
        if (input.model) {
          await requestJson({
            fetch: params.fetch,
            method: 'POST',
            path: `/api/session/${encodeURIComponent(input.sessionId)}/model`,
            body: {
              model: buildOpenCodeV2ModelRef({
                providerID: input.model.providerID,
                modelID: input.model.modelID,
                variant: promptConfig.variant,
              }),
            },
            expectJson: false,
          });
        } else if (promptConfig.variant) {
          // A variant only exists as a field of `Model.Ref`, so V2 cannot carry
          // one for a session left on its default model. Dropping it silently
          // would run the turn at an effort the user did not choose, so say so
          // instead. This cannot fire on a prompt with no variant selected.
          throw unsupported(
            'session_prompt_config',
            'OpenCode V2 servers carry a model variant only with an explicit model; select a model to use this reasoning effort',
          );
        }
        const response = await requestOptionalJson({
          fetch: params.fetch,
          method: 'POST',
          path: `/api/session/${encodeURIComponent(input.sessionId)}/prompt`,
          body: {
            ...(input.messageId ? { id: input.messageId } : {}),
            prompt: buildOpenCodeV2Prompt({
              text: input.text,
              ...(input.parts ? { parts: input.parts } : {}),
            }),
          },
        });
        return readOpenCodeV2Data(response);
      }
      const promptConfig = buildPromptConfig(input);
      return await requestOptionalJson({
        fetch: params.fetch,
        method: 'POST',
        path: `/session/${encodeURIComponent(input.sessionId)}/message`,
        query: directoryQuery(input.directory),
        body: {
          ...(input.messageId ? { messageID: input.messageId } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...promptConfig,
          parts: input.parts ?? [{ type: 'text', text: input.text }],
        },
      });
    },
    async sessionAbort(input) {
      await requestJson({
        fetch: params.fetch,
        method: 'POST',
        path: isV2
          ? `/api/session/${encodeURIComponent(input.sessionId)}/interrupt`
          : `/session/${encodeURIComponent(input.sessionId)}/abort`,
        ...(isV2 ? {} : { query: directoryQuery(input.directory) }),
        expectJson: false,
      });
    },
    async sessionSummarize(input) {
      if (isV2) {
        // `session.compact` declares no payload at all: the session's own model
        // does the work, so passing one would be an invented field.
        await requestJson({
          fetch: params.fetch,
          method: 'POST',
          path: `/api/session/${encodeURIComponent(input.sessionId)}/compact`,
          expectJson: false,
        });
        return;
      }
      await requestJson({
        fetch: params.fetch,
        method: 'POST',
        path: `/session/${encodeURIComponent(input.sessionId)}/summarize`,
        query: directoryQuery(params.directory),
        body: {
          providerID: input.model.providerID,
          modelID: input.model.modelID,
          auto: input.auto,
        },
        expectJson: false,
      });
    },
    async sessionStatus(input) {
      if (isV2) {
        // V2 has no per-session status route. `session.active` lists the
        // foreground drains this process owns; absence is the idle answer.
        const response = await requestJson({
          fetch: params.fetch,
          method: 'GET',
          path: '/api/session/active',
        });
        return readOpenCodeV2SessionStatus(response, input.sessionId);
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'GET',
        path: '/session/status',
        query: directoryQuery(input.directory),
      });
      return asRecord(response)?.[input.sessionId] ?? {};
    },
    async sessionMessages(input) {
      if (isV2) {
        // The V2 timeline is paged and ordered. `order` seeds the first page and
        // the opaque cursor carries that order forward, so it must not be sent
        // alongside a cursor (`SessionMessagesQuery`).
        const path = `/api/session/${encodeURIComponent(input.sessionId)}/message`;
        const collected: unknown[] = [];
        const seenCursors = new Set<string>();
        let cursor: string | null = null;
        for (;;) {
          const page: unknown = await requestJson({
            fetch: params.fetch,
            method: 'GET',
            path,
            query: cursor === null ? { order: 'asc' } : { cursor },
          });
          const { messages, nextCursor } = readOpenCodeV2MessagePage(page);
          collected.push(...messages);
          if (nextCursor === null || messages.length === 0) break;
          if (seenCursors.has(nextCursor)) break;
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
        return normalizeOpenCodeV2Messages(collected, input.sessionId);
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'GET',
        path: `/session/${encodeURIComponent(input.sessionId)}/message`,
        query: directoryQuery(input.directory),
      });
      return Array.isArray(response) ? response : [];
    },
    async sessionTodo(input) {
      if (isV2) {
        throw unsupported(
          'session_todo',
          'OpenCode V2 servers expose no session todo route; todos arrive only as todo.updated events',
        );
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'GET',
        path: `/session/${encodeURIComponent(input.sessionId)}/todo`,
        query: directoryQuery(input.directory),
      });
      return Array.isArray(response) ? response : [];
    },
    async permissionList() {
      if (isV2) {
        const response = await requestJson({
          fetch: params.fetch,
          method: 'GET',
          path: '/api/permission/request',
          query: locationQuery(),
        });
        return readOpenCodeV2DataArray(response)
          .map((entry) => normalizeOpenCodeV2PermissionRequest(entry))
          .filter((entry): entry is Readonly<Record<string, unknown>> => entry !== null);
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'GET',
        path: '/permission',
        query: directoryQuery(params.directory),
      });
      return Array.isArray(response) ? response : [];
    },
    async questionList() {
      if (isV2) {
        const response = await requestJson({
          fetch: params.fetch,
          method: 'GET',
          path: '/api/question/request',
          query: locationQuery(),
        });
        // `Question.Request` already names `id`, `sessionID` and `questions[]`
        // the way the domain reads them; only the route moved.
        return readOpenCodeV2DataArray(response);
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'GET',
        path: '/question',
        query: directoryQuery(params.directory),
      });
      return Array.isArray(response) ? response : [];
    },
    async permissionReply(input) {
      // OpenCode minted this request id; the reply route addresses it verbatim.
      const requestId = readNonBlankOpaqueIdentifier(input.requestId);
      if (!requestId) return;
      const message = normalizeString(input.message);
      const body = {
        reply: input.reply,
        ...(message ? { message } : {}),
      };
      if (isV2) {
        const sessionId = requireReplySessionId(input.sessionId, 'permission');
        await requestJson({
          fetch: params.fetch,
          method: 'POST',
          path: `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
          expectJson: false,
          body,
        });
        return;
      }
      await requestJson({
        fetch: params.fetch,
        method: 'POST',
        path: `/permission/${encodeURIComponent(requestId)}/reply`,
        expectJson: false,
        body,
      });
    },
    async questionReply(input) {
      if (isV2) {
        const sessionId = requireReplySessionId(input.sessionId, 'question');
        await requestJson({
          fetch: params.fetch,
          method: 'POST',
          path: `/api/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(input.requestId)}/reply`,
          body: { answers: input.answers },
          expectJson: false,
        });
        return;
      }
      await requestJson({
        fetch: params.fetch,
        method: 'POST',
        path: `/question/${encodeURIComponent(input.requestId)}/reply`,
        body: { answers: input.answers },
        expectJson: false,
      });
    },
    async questionReject(input) {
      if (isV2) {
        const sessionId = requireReplySessionId(input.sessionId, 'question');
        await requestJson({
          fetch: params.fetch,
          method: 'POST',
          path: `/api/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(input.requestId)}/reject`,
          expectJson: false,
        });
        return;
      }
      await requestJson({
        fetch: params.fetch,
        method: 'POST',
        path: `/question/${encodeURIComponent(input.requestId)}/reject`,
        body: {},
        expectJson: false,
      });
    },
    async appSkills(input) {
      if (isV2) {
        const response = await requestJson({
          fetch: params.fetch,
          method: 'GET',
          path: '/api/skill',
          query: locationQuery(input.directory),
          operation: 'skill_catalog',
        });
        return readOpenCodeV2DataArray(response);
      }
      const response = await params.fetch({
        url: pathWithQuery('/skill', directoryQuery(input.directory)),
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) {
        const responseBodyPreview = await readResponseBodyPreview(response);
        throw createOpenCodeServerHttpError({
          prefix: 'OpenCode skill catalog request failed',
          operation: 'skill_catalog',
          status: response.status,
          statusText: response.statusText,
          responseBodyPreview,
        });
      }
      return await response.json();
    },
    async subscribeGlobalEvents(subscription) {
      const subscribe = input.dialect === 'v2'
        ? subscribeOpenCodeV2InstanceEvents
        : subscribeOpenCodeInstanceEvents;
      await subscribe({
        fetch: params.streamFetch,
        directory: resolveDirectory(),
        signal: subscription.signal,
        onEvent: subscription.onEvent,
        onUnavailable: subscription.onUnavailable,
      });
    },
    async globalConfigGet() {
      if (isV2) {
        // `/global/config` belongs to the V1 instance server's `/global` group,
        // which the standalone V2 protocol does not declare. Callers use it only
        // to learn a default model and already tolerate its absence.
        throw unsupported(
          'global_config',
          'OpenCode V2 servers expose no global configuration route',
        );
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'GET',
        path: '/global/config',
      });
      return asRecord(response) ?? {};
    },
    async providersList() {
      if (isV2) {
        // V2 split the single V1 `/provider` answer in two: `Provider.Info` no
        // longer carries a `models` map, so the model inventory is its own
        // location-scoped read keyed back by `providerID`.
        const providers = await requestJson({
          fetch: params.fetch,
          method: 'GET',
          path: '/api/provider',
          query: locationQuery(),
        });
        const models = await requestJson({
          fetch: params.fetch,
          method: 'GET',
          path: '/api/model',
          query: locationQuery(),
        });
        return combineOpenCodeV2Providers(
          readOpenCodeV2DataArray(providers),
          readOpenCodeV2DataArray(models),
        );
      }
      const response = await requestJson({
        fetch: params.fetch,
        method: 'GET',
        path: '/provider',
      });
      return readProviderList(response);
    },
  };
}
