import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';
import { isLoopbackHostname, redactPublicShareCapabilityUrl } from '@happier-dev/protocol';
import { runtimeFetch } from '@/utils/system/runtimeFetch';
import { createEndpointSupervisedRequest } from '@/sync/runtime/connectivity/createEndpointSupervisedRequest';
import { getEndpointSupervisorForServer } from '@/sync/runtime/connectivity/endpointSupervisorPool';
import {
    peekServerReachabilityToken,
    reportServerUnreachable,
    ServerReachabilityWaitTimeoutError,
    invalidateServerReachabilitySupervisor,
    waitForServerReachable,
} from '@/sync/runtime/connectivity/serverReachabilitySupervisorPool';
import {
    readServerFetchWriteTimeoutMs,
    readServerReachabilityWaitTimeoutMs,
} from '@/sync/runtime/connectivity/serverReachabilityTuning';
import { notifyAuthCredentialsInvalidated } from '@/sync/runtime/orchestration/authCredentialsInvalidation';
import { fireAndForget } from '@/utils/system/fireAndForget';
import {
    AccountStoredContentCompatibilityUnavailableError,
    readAccountStoredContentCompatibilityRequestDeclaration,
    resolveAccountStoredContentCompatibilityHeaders,
    stripAccountStoredContentCompatibilityHeader,
} from './accountStoredContentCompatibility';
import { resolveActiveServerRuntimeOrigin } from '@/sync/runtime/nativeLoopbackTunnels/runtimeOrigin';

export { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';

export class StaleServerGenerationError extends Error {
    constructor() {
        super('Ignored response from a stale server generation');
        this.name = 'StaleServerGenerationError';
    }
}

export class ServerFetchAbortedForServerSwitchError extends Error {
    constructor() {
        super('Aborted request due to an active server switch');
        this.name = 'ServerFetchAbortedForServerSwitchError';
    }
}

export class ServerFetchConnectivityTimeoutError extends Error {
    public readonly retryable = false;

    constructor() {
        super('Timed out waiting for server reachability');
        this.name = 'ServerFetchConnectivityTimeoutError';
    }
}

export class ServerFetchWriteTimeoutError extends Error {
    public readonly retryable = true;

    constructor() {
        super('Timed out waiting for the server to respond to a write');
        this.name = 'ServerFetchWriteTimeoutError';
    }
}

export type ExpectedActiveServerFetchBasis = Readonly<{
    serverId: string;
    generation: number;
}>;

export type ServerFetchOptions = Readonly<{
    includeAuth?: boolean;
    expectedActiveServer?: ExpectedActiveServerFetchBasis;
    /**
     * When `none`, perform a single direct `runtimeFetch` attempt and skip reachability gating and
     * endpoint supervision. This is used by higher-level sync loops that implement their own
     * orchestration/backoff and must not get stuck behind nested connectivity supervisors.
     */
    retry?: 'default' | 'none';
    /** Override the request bound. Zero disables it for this request. */
    timeoutMs?: number;
}>;

/**
 * The request function shared by focused-Home compatibility callers and explicit Home/Account
 * Service callers.  The third argument intentionally stays optional so existing call sites keep
 * their established retry/auth options while target callers can use the same lifecycle owner.
 */
export type ServerFetch = (
    path: string,
    init?: RequestInit,
    options?: ServerFetchOptions,
) => Promise<Response>;

type EndpointRequestContext = Readonly<{
    /** Stable logical URL used for identity, reachability, compatibility, and storage scope. */
    endpointUrl: string;
    /** Actual request origin. For Iroh this may be an ephemeral loopback origin. */
    runtimeOrigin: string;
    serverId: string;
    generation?: number;
    /** Active requests retain switch currentness/abort semantics; explicit requests do not. */
    active: boolean;
    /** `true` means credentials are resolved from the target's scoped storage. */
    useStoredCredentials: boolean;
    credentials?: AuthCredentials | null;
    signal?: AbortSignal;
}>;

const MUTATING_HTTP_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function resolveRequestTimeoutMs(method: string, optionTimeoutMs: number | undefined): number {
    if (typeof optionTimeoutMs === 'number' && Number.isFinite(optionTimeoutMs)) {
        return Math.max(0, Math.trunc(optionTimeoutMs));
    }
    return MUTATING_HTTP_METHODS.has(method) ? readServerFetchWriteTimeoutMs() : 0;
}

const inFlightControllers = new Set<AbortController>();
let abortSequence = 0;

// A marked first-key migration keeps the rejected credential bytes as recovery
// custody. Fence only the exact rejected bearer in memory so later HTTP calls
// cannot silently reuse it as ordinary auth. Canonical credential replacement
// or removal clears the fence when the next request observes current storage.
const rejectedFirstKeyBearerByServer = new Map<string, string>();
const classifiedAllowedBearerByServer = new Map<string, string>();

function resolveRejectedFirstKeyBearerKey(params: Readonly<{
    serverId: string;
    serverUrl: string;
}>): string {
    return JSON.stringify([
        params.serverId,
        params.serverUrl,
    ]);
}

const debugLogThrottleMs = 5_000;
const lastDebugLogMsByKey = new Map<string, number>();
let didLogActiveServerSnapshot = false;

export function abortServerFetches(reason: string = 'server-switch'): void {
    abortSequence += 1;
    for (const controller of inFlightControllers) {
        controller.abort(reason);
    }
    inFlightControllers.clear();
}

function normalizePath(path: string): string {
    const value = String(path ?? '').trim();
    if (!value) return '';
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    return value.startsWith('/') ? value : `/${value}`;
}

function tryParseUrl(raw: string): URL | null {
    try {
        return new URL(raw);
    } catch {
        return null;
    }
}

function isDebugEnabled(): boolean {
    const raw = String(process.env.EXPO_PUBLIC_DEBUG ?? '').trim();
    return raw === '1' || raw.toLowerCase() === 'true';
}

function describeUrlForHint(rawUrl: string): { hostname: string; port: string } | null {
    const parsed = tryParseUrl(rawUrl);
    if (!parsed) return null;
    return { hostname: parsed.hostname, port: parsed.port };
}

function redactUrlForLogs(raw: string): string {
    return toServerUrlDisplay(raw) || '<invalid-url>';
}

function maybeLogRuntimeFetchFailure(params: {
    method: string;
    requestUrl: string;
    activeServerUrl: string;
    activeServerId: string;
    error: unknown;
}): void {
    if (!isDebugEnabled()) return;

    const errorName = params.error instanceof Error ? params.error.name : '';
    const errorMessage = redactPublicShareCapabilityUrl(
        params.error instanceof Error ? params.error.message : String(params.error ?? ''),
    );
    const activeServerUrl = redactUrlForLogs(params.activeServerUrl);
    const requestUrl = redactUrlForLogs(params.requestUrl);
    const key = `${params.activeServerId}|${activeServerUrl}|${requestUrl}|${errorName}|${errorMessage}`;
    const now = Date.now();
    const last = lastDebugLogMsByKey.get(key) ?? 0;
    if (now - last < debugLogThrottleMs) return;
    lastDebugLogMsByKey.set(key, now);

    const msg =
        `[serverFetch] runtimeFetch failed: ${params.method} ${requestUrl} ` +
        `(activeServer=${activeServerUrl}, serverId=${params.activeServerId}) ` +
        `${errorName ? `${errorName}: ` : ''}${errorMessage}`.trim();
    // eslint-disable-next-line no-console
    console.log(msg);

    const hintUrl = describeUrlForHint(activeServerUrl);
    if (hintUrl && isLoopbackHostname(hintUrl.hostname)) {
        // eslint-disable-next-line no-console
        console.log(
            `[serverFetch] hint: active server URL is loopback (${hintUrl.hostname}${hintUrl.port ? `:${hintUrl.port}` : ''}); ` +
            `a physical device cannot reach your computer via localhost. Use a LAN/Tailscale URL.`,
        );
    }
}

async function requestAtEndpoint(
    context: EndpointRequestContext,
    path: string,
    init?: RequestInit,
    options: ServerFetchOptions = {},
): Promise<Response> {
    const localAbortSequence = context.active ? abortSequence : null;
    if (!context.active) {
        const targetOrigin = tryParseUrl(context.runtimeOrigin);
        if (
            !targetOrigin
            || (targetOrigin.protocol !== 'http:' && targetOrigin.protocol !== 'https:')
        ) {
            throw new Error('Invalid explicit endpoint URL');
        }
    }
    if (
        context.active
        && options.expectedActiveServer
        && (
            context.serverId !== options.expectedActiveServer.serverId
            || context.generation !== options.expectedActiveServer.generation
        )
    ) {
        throw new StaleServerGenerationError();
    }
    const normalizedPath = normalizePath(path);
    const transportOrigin = context.runtimeOrigin;
    const requestUrl = normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')
        ? normalizedPath
        : `${transportOrigin}${normalizedPath}`;

    if (context.active && isDebugEnabled() && !didLogActiveServerSnapshot) {
        didLogActiveServerSnapshot = true;
        const logSafeServerUrl = redactUrlForLogs(context.endpointUrl);
        // eslint-disable-next-line no-console
        console.log(
            `[serverFetch] active server snapshot: serverId=${context.serverId}, serverUrl=${logSafeServerUrl}, generation=${context.generation ?? 0}`,
        );
    }

    const absoluteRequestUrl = tryParseUrl(requestUrl);
    const activeServerUrl = tryParseUrl(transportOrigin);
    const isCrossOrigin =
        !!absoluteRequestUrl
        && !!activeServerUrl
        && absoluteRequestUrl.origin !== activeServerUrl.origin;

    const requestedCompatibilityDeclaration =
        readAccountStoredContentCompatibilityRequestDeclaration(init);
    const compatibility = normalizedPath === '/v1/features'
        ? null
        : resolveAccountStoredContentCompatibilityHeaders(
            init?.headers,
            {
                serverUrl: context.endpointUrl,
                ...(requestedCompatibilityDeclaration
                    ? { declaration: requestedCompatibilityDeclaration }
                    : {}),
            },
        );
    if (
        requestedCompatibilityDeclaration
        && compatibility?.status === 'unavailable'
    ) {
        throw new AccountStoredContentCompatibilityUnavailableError(
            compatibility.reason,
        );
    }
    const headers = compatibility?.status === 'available'
        ? compatibility.headers
        : stripAccountStoredContentCompatibilityHeader(init?.headers);
    const rejectedFirstKeyBearerKey =
        resolveRejectedFirstKeyBearerKey({
            serverId: context.serverId,
            serverUrl: context.endpointUrl,
        });
    let rejectedFirstKeyBearer =
        rejectedFirstKeyBearerByServer.get(
            rejectedFirstKeyBearerKey,
        ) ?? null;
    let usedToken: string | null = null;
    if (options.includeAuth !== false) {
        const credentials = context.credentials !== undefined
            ? context.credentials
            : context.useStoredCredentials
                ? context.active
                    ? await TokenStorage.getCredentials()
                    : await TokenStorage.getCredentialsForServerUrl(
                        context.endpointUrl,
                        context.serverId ? { serverId: context.serverId } : {},
                    )
                : null;
        if (!credentials?.token) {
            rejectedFirstKeyBearerByServer.delete(
                rejectedFirstKeyBearerKey,
            );
            classifiedAllowedBearerByServer.delete(
                rejectedFirstKeyBearerKey,
            );
            rejectedFirstKeyBearer = null;
        }
        if (
            rejectedFirstKeyBearer
            && credentials?.token
            !== rejectedFirstKeyBearer
        ) {
            rejectedFirstKeyBearerByServer.delete(
                rejectedFirstKeyBearerKey,
            );
            classifiedAllowedBearerByServer.delete(
                rejectedFirstKeyBearerKey,
            );
            rejectedFirstKeyBearer = null;
        }
        if (
            context.active
            && context.useStoredCredentials
            && credentials?.token
            && (
                rejectedFirstKeyBearer
                === credentials.token
                || classifiedAllowedBearerByServer
                    .get(
                        rejectedFirstKeyBearerKey,
                    )
                    !== credentials.token
            )
        ) {
            const classification =
                await TokenStorage
                    .classifyPendingExternalAuthFirstKeyRejectedCredential({
                        serverId:
                            context.serverId,
                        serverUrl:
                            context.endpointUrl,
                        token:
                            credentials.token,
                    });
            if (
                classification.kind
                === 'rejected'
            ) {
                rejectedFirstKeyBearer =
                    credentials.token;
                rejectedFirstKeyBearerByServer.set(
                    rejectedFirstKeyBearerKey,
                    credentials.token,
                );
                classifiedAllowedBearerByServer.delete(
                    rejectedFirstKeyBearerKey,
                );
                fireAndForget(
                    invalidateServerReachabilitySupervisor({
                        serverUrl:
                            context.endpointUrl,
                        token: null,
                    }),
                    {
                        tag:
                            'serverFetch.persistedFirstKeyRejectedBearerReachability',
                    },
                );
            } else {
                rejectedFirstKeyBearerByServer.delete(
                    rejectedFirstKeyBearerKey,
                );
                rejectedFirstKeyBearer = null;
                classifiedAllowedBearerByServer.set(
                    rejectedFirstKeyBearerKey,
                    credentials.token,
                );
            }
        }
        if (
            credentials?.token
            && credentials.token
            !== rejectedFirstKeyBearer
        ) {
            usedToken = credentials.token;
            headers.set('Authorization', `Bearer ${credentials.token}`);
        }
    }
    // Also capture an explicit Authorization header, even when includeAuth=false (many ops pass
    // credentials explicitly to avoid repeated TokenStorage reads).
    const explicitAuthHeader = headers.get('Authorization') ?? '';
    if (!usedToken && explicitAuthHeader.startsWith('Bearer ')) {
        usedToken = explicitAuthHeader.slice(7).trim() || null;
    }
    if (
        usedToken
        && usedToken === rejectedFirstKeyBearer
    ) {
        headers.delete('Authorization');
        usedToken = null;
    }
    const hasAuthorization = explicitAuthHeader.trim().length > 0;
    if (hasAuthorization) {
        const logSafeRequestUrl = redactUrlForLogs(requestUrl);
        const logSafeActiveServerUrl = redactUrlForLogs(context.endpointUrl);
        // Fail-closed: if we have any Authorization header, we must be able to validate same-origin
        // to avoid accidentally sending credentials to an unexpected host (or the current web origin).
        if (!absoluteRequestUrl || !activeServerUrl) {
            throw new Error(
                `Refused authenticated request because request/active server URL is not a valid absolute URL ` +
                `(requestUrl=${logSafeRequestUrl}, activeServerUrl=${logSafeActiveServerUrl})`,
            );
        }
        if ((absoluteRequestUrl.protocol !== 'http:' && absoluteRequestUrl.protocol !== 'https:') || (activeServerUrl.protocol !== 'http:' && activeServerUrl.protocol !== 'https:')) {
            throw new Error(
                `Refused authenticated request because request/active server URL is not http(s) ` +
                `(requestUrl=${logSafeRequestUrl}, activeServerUrl=${logSafeActiveServerUrl})`,
            );
        }
        if (absoluteRequestUrl.origin !== activeServerUrl.origin) {
            throw new Error(
                `Refused authenticated request to ${absoluteRequestUrl.origin}; active server is ${activeServerUrl.origin}`,
            );
        }
    }

    const requestController = new AbortController();
    if (context.active) inFlightControllers.add(requestController);
    if (context.active && localAbortSequence !== null && abortSequence !== localAbortSequence) {
        requestController.abort('server-switch');
    }

    const upstreamSignals = [context.signal, init?.signal].filter(
        (signal): signal is AbortSignal => Boolean(signal),
    );
    const removeUpstreamListeners: Array<() => void> = [];
    for (const upstreamSignal of upstreamSignals) {
        if (upstreamSignal.aborted) {
            requestController.abort((upstreamSignal as AbortSignal & { reason?: unknown }).reason);
            continue;
        }
        const onAbort = () => requestController.abort(
            (upstreamSignal as AbortSignal & { reason?: unknown }).reason,
        );
        upstreamSignal.addEventListener('abort', onAbort, { once: true });
        removeUpstreamListeners.push(() => upstreamSignal.removeEventListener('abort', onAbort));
    }

    const method = String(init?.method ?? 'GET').toUpperCase();
    const effectiveTimeoutMs = resolveRequestTimeoutMs(method, options.timeoutMs);
    let didWriteTimeout = false;
    let writeTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (effectiveTimeoutMs > 0) {
        writeTimeoutHandle = setTimeout(() => {
            didWriteTimeout = true;
            requestController.abort('write-timeout');
        }, effectiveTimeoutMs);
    }
    const retryMode: 'default' | 'none' = options.retry ?? 'default';
    const isActiveOrigin =
        !isCrossOrigin
        && !!absoluteRequestUrl
        && !!activeServerUrl;
    const endpointSupervisor =
        isActiveOrigin
            ? getEndpointSupervisorForServer({ serverId: context.serverId, serverUrl: context.endpointUrl })
            : null;

    let response: Response | null = null;
    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                if (isActiveOrigin && retryMode !== 'none') {
                    const reachabilityToken =
                        peekServerReachabilityToken(
                            context.endpointUrl,
                        ) ?? null;
                    const tokenForReachability =
                        usedToken
                        ?? (
                            reachabilityToken
                            === rejectedFirstKeyBearer
                                ? null
                                : reachabilityToken
                        );
                    try {
                        await waitForServerReachable({
                            serverUrl: context.endpointUrl,
                            token: tokenForReachability,
                            signal: requestController.signal,
                            timeoutMs: readServerReachabilityWaitTimeoutMs(),
                            acceptAuthFailed: true,
                        });
                    } catch (error) {
                        const aborted =
                            requestController.signal.aborted || (error instanceof Error && error.name === 'AbortError');
                        if (aborted) {
                            const reason = (requestController.signal as unknown as { reason?: unknown }).reason;
                            const serverSwitchAbort = context.active
                                && (reason === 'server-switch' || abortSequence !== localAbortSequence);
                            if (serverSwitchAbort) {
                                throw new ServerFetchAbortedForServerSwitchError();
                            }
                            if (didWriteTimeout) {
                                reportServerUnreachable(context.endpointUrl, error);
                                throw new ServerFetchWriteTimeoutError();
                            }
                            throw error;
                        }
                        if (error instanceof ServerReachabilityWaitTimeoutError) {
                            throw new ServerFetchConnectivityTimeoutError();
                        }
                        throw error;
                    }
                }

                if (endpointSupervisor && retryMode !== 'none') {
                    const supervisedFetch = createEndpointSupervisedRequest({
                        serverId: context.serverId,
                        serverUrl: transportOrigin,
                        token: usedToken,
                        endpointSupervisor,
                    });
                    response = await supervisedFetch(requestUrl, {
                        ...init,
                        headers,
                        signal: requestController.signal,
                    });
                } else {
                    response = await runtimeFetch(requestUrl, {
                        ...init,
                        headers,
                        signal: requestController.signal,
                    });
                }
            } catch (error) {
                maybeLogRuntimeFetchFailure({
                    method,
                    requestUrl,
                    activeServerUrl: context.endpointUrl,
                    activeServerId: context.serverId,
                    error,
                });
                const aborted =
                    requestController.signal.aborted || (error instanceof Error && error.name === 'AbortError');
                if (aborted) {
                    const reason = (requestController.signal as unknown as { reason?: unknown }).reason;
                    const serverSwitchAbort = context.active
                        && (reason === 'server-switch' || abortSequence !== localAbortSequence);
                    if (serverSwitchAbort) {
                        throw new ServerFetchAbortedForServerSwitchError();
                    }
                    if (didWriteTimeout) {
                        reportServerUnreachable(context.endpointUrl, error);
                        throw new ServerFetchWriteTimeoutError();
                    }
                    // Caller aborts should not poison reachability state.
                    throw error;
                }
                if (error instanceof ServerFetchConnectivityTimeoutError) {
                    // Reachability wait timeouts already represent a "paused/offline" state; do not report an extra
                    // transport failure which can reset backoff scheduling.
                    throw error;
                }
                reportServerUnreachable(context.endpointUrl, error);
                throw error;
            }

            if (context.active) {
                const current = getActiveServerSnapshot();
                if (
                    current.generation !== context.generation
                    || current.serverId !== context.serverId
                ) {
                    throw new StaleServerGenerationError();
                }
            }

            if (!usedToken || response.status !== 401 || !isActiveOrigin) {
                break;
            }

            // Classify the rejected active token before deleting it. Marked
            // first-key recovery custody must remain exact; otherwise removal
            // prevents a persistent 401 loop and permits a refreshed token.
            let invalidatedStoredCredentials = false;
            try {
                if (context.active && context.useStoredCredentials) {
                    // Load the first-key owner lazily: it uses serverFetch for recovery
                    // requests, so a static import here would create a module cycle.
                    const {
                        guardAccountEncryptionFirstKeyCredentialMutation,
                        markAccountEncryptionFirstKeyRejectedCredential,
                    } = await import(
                        '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth'
                    );
                    const guard =
                        await guardAccountEncryptionFirstKeyCredentialMutation({
                            serverId: context.serverId,
                            serverUrl: context.endpointUrl,
                        });
                    if (guard.kind !== 'allowed') {
                        const marked =
                            await markAccountEncryptionFirstKeyRejectedCredential({
                                recovery:
                                    guard.recovery,
                                token: usedToken,
                            });
                        if (
                            marked.kind
                            !== 'recorded'
                        ) {
                            break;
                        }
                        const alreadyFenced =
                            rejectedFirstKeyBearerByServer
                                .get(
                                    rejectedFirstKeyBearerKey,
                                )
                            === usedToken;
                        rejectedFirstKeyBearerByServer.set(
                            rejectedFirstKeyBearerKey,
                            usedToken,
                        );
                        classifiedAllowedBearerByServer.delete(
                            rejectedFirstKeyBearerKey,
                        );
                        fireAndForget(
                            invalidateServerReachabilitySupervisor({
                                serverUrl:
                                    context.endpointUrl,
                                token: null,
                            }),
                            {
                                tag:
                                    'serverFetch.firstKeyRejectedBearerReachability',
                            },
                        );
                        if (!alreadyFenced) {
                            notifyAuthCredentialsInvalidated({
                                kind:
                                    'first_key_recovery_required',
                                serverId:
                                    context.serverId,
                                serverUrl:
                                    context.endpointUrl,
                                recovery:
                                    marked.recovery,
                            });
                        }
                        // The rejected bearer is retained only as exact first-key
                        // recovery custody. It must not be retried as normal auth.
                        break;
                    }
                }
                if (context.useStoredCredentials) {
                    invalidatedStoredCredentials =
                        await TokenStorage.invalidateCredentialsTokenForServerUrl(
                            context.endpointUrl,
                            usedToken,
                            { serverId: context.serverId },
                        );
                }
            } catch {
                // ignore
            }
            if (invalidatedStoredCredentials) {
                notifyAuthCredentialsInvalidated({
                    kind: 'credentials_removed',
                    serverId: context.serverId,
                    serverUrl: context.endpointUrl,
                });
            }

            // Only retry idempotent requests to avoid surprising duplication.
            if (attempt !== 0 || (method !== 'GET' && method !== 'HEAD')) {
                break;
            }

            // Re-read target-scoped credentials and retry once if we found a
            // different token. Explicit caller credentials are immutable for the
            // request and must not be replaced from storage.
            if (!context.useStoredCredentials) break;
            try {
                const fresh = context.active
                    ? await TokenStorage.getCredentials()
                    : await TokenStorage.getCredentialsForServerUrl(
                        context.endpointUrl,
                        context.serverId ? { serverId: context.serverId } : {},
                    );
                const freshToken = fresh?.token ?? null;
                if (freshToken && freshToken !== usedToken) {
                    usedToken = freshToken;
                    headers.set('Authorization', `Bearer ${freshToken}`);
                    continue;
                }
            } catch {
                // ignore
            }

            break;
        }
    } finally {
        if (writeTimeoutHandle) {
            clearTimeout(writeTimeoutHandle);
        }
        for (const removeUpstreamListener of removeUpstreamListeners) {
            removeUpstreamListener();
        }
        if (context.active) inFlightControllers.delete(requestController);
    }

    if (!response) {
        // Defensive: loop always runs at least once, but keep return type strict.
        throw new Error('serverFetch did not attempt the request');
    }
    return response;
}

function normalizeEndpointBase(raw: string): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    try {
        const parsed = new URL(value);
        // Endpoint identity is an origin/base, never a caller-supplied query or fragment. This
        // also prevents credentials from being accidentally attached to an inherited URL query.
        parsed.search = '';
        parsed.hash = '';
        parsed.username = '';
        parsed.password = '';
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return value.replace(/\/+$/, '');
    }
}

function resolveEndpointRuntimeOrigin(endpointUrl: string, runtimeOrigin?: string): string {
    const candidate = String(runtimeOrigin ?? '').trim();
    if (candidate) {
        try {
            const parsed = new URL(candidate);
            if (
                (parsed.protocol === 'http:' || parsed.protocol === 'https:')
                && !parsed.username
                && !parsed.password
                && !parsed.search
                && !parsed.hash
            ) {
                return parsed.toString().replace(/\/+$/, '');
            }
        } catch {
            // Invalid runtime origins fail closed to the stable endpoint below.
        }
    }
    return endpointUrl;
}

/**
 * Build a request function for a specific Home/Account Service endpoint. The target is captured
 * once and never resolved through the active-server selector, so changing focus cannot retarget
 * an in-flight or subsequent request made by this function.
 */
export function createServerFetchAtEndpoint(
    params: Readonly<{
        endpointUrl: string;
        runtimeOrigin?: string;
        credentials?: AuthCredentials | null;
        serverId?: string;
        signal?: AbortSignal;
    }>,
): ServerFetch {
    const endpointUrl = normalizeEndpointBase(params.endpointUrl);
    const runtimeOrigin = resolveEndpointRuntimeOrigin(endpointUrl, params.runtimeOrigin);
    const serverId = String(params.serverId ?? '').trim();
    const context: EndpointRequestContext = {
        endpointUrl,
        runtimeOrigin,
        serverId,
        active: false,
        useStoredCredentials: params.credentials === undefined,
        ...(params.credentials !== undefined ? { credentials: params.credentials } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
    };

    return async (path, init, options) => await requestAtEndpoint(context, path, init, options);
}

/** Focused-Home compatibility wrapper. All request policy remains in `requestAtEndpoint`. */
export async function serverFetch(
    path: string,
    init?: RequestInit,
    options: ServerFetchOptions = {},
): Promise<Response> {
    const snapshot = getActiveServerSnapshot();
    return await requestAtEndpoint(
        {
            endpointUrl: snapshot.serverUrl,
            runtimeOrigin: resolveActiveServerRuntimeOrigin(snapshot),
            serverId: snapshot.serverId,
            generation: snapshot.generation,
            active: true,
            useStoredCredentials: true,
        },
        path,
        init,
        options,
    );
}
