import type { AuthCredentials, FeaturesResponse as ServerFeatures } from '@happier-dev/protocol';
import { AsyncTtlCache } from '@happier-dev/protocol';

import * as serverHttp from '@/sync/http/client';
import {
    ServerFetchAbortedForServerSwitchError,
    StaleServerGenerationError,
} from '@/sync/http/client';
import { getActiveServerHomeCarrier, getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import {
    areServerProfileIdentifiersEquivalent,
    getServerProfileById,
    resolveServerProfileScopeIdForIdentifier,
    reconcileServerProfileHomeConnectionDescriptor,
    setServerProfileIdentityForUrl,
} from '@/sync/domains/server/serverProfiles';
import { parseServerFeatures } from './serverFeaturesParse';
import { runtimeFetchWithServerReachability } from '@/sync/runtime/connectivity/serverReachabilityRuntimeFetch';
import { normalizeBaseUrl } from './probeAuthenticatedServerAuthPingEndpoint';
import { recordAccountStoredContentServerRequirements } from '@/sync/http/accountStoredContentCompatibility';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';

const TTL_READY_MS = 10 * 60 * 1000;
const TTL_UNSUPPORTED_ENDPOINT_MISSING_MS = 60 * 60 * 1000;
const TTL_UNSUPPORTED_INVALID_PAYLOAD_MS = 10 * 60 * 1000;
const TTL_ERROR_NETWORK_MS = 5 * 1000;
const TTL_ERROR_TIMEOUT_MS = 5 * 1000;
const TTL_ERROR_RESPONSE_STATUS_MS = 30 * 1000;
// A successfully parsed Home descriptor can still describe an active indexing
// transition. Reuse the existing short retry window for transient feature
// observations; this protects readiness freshness without a Search-owned poller.
const TTL_TRANSITIONAL_FEATURE_MS = TTL_ERROR_NETWORK_MS;

const FORCE_COOLDOWN_ENDPOINT_MISSING_MS = 60 * 1000;

export type ServerFeaturesSnapshot =
    | Readonly<{ status: 'ready'; features: ServerFeatures; serverIdentityId?: string | null }>
    | Readonly<{ status: 'unsupported'; reason: 'endpoint_missing' | 'invalid_payload' }>
    | Readonly<{ status: 'error'; reason: 'network' | 'timeout' | 'response_status' | 'identity_conflict' }>;

const cache = new AsyncTtlCache<ServerFeaturesSnapshot>({
    successTtlMs: TTL_READY_MS,
    errorTtlMs: TTL_ERROR_NETWORK_MS,
});
// Full descriptors are an authenticated projection, not a replacement for
// public capability discovery. Keep their cache and in-flight work separate so
// pre-auth consumers never inherit a credential requirement.
const authenticatedCache = new AsyncTtlCache<ServerFeaturesSnapshot>({
    successTtlMs: TTL_READY_MS,
    errorTtlMs: TTL_ERROR_NETWORK_MS,
});
// Explicit endpoint probes are diagnostic inputs for their caller, not active
// Home state. Keep their cache and in-flight map separate so a probe cannot
// notify active feature subscribers or collide with an id-scoped entry.
const endpointCache = new AsyncTtlCache<ServerFeaturesSnapshot>({
    successTtlMs: TTL_READY_MS,
    errorTtlMs: TTL_ERROR_NETWORK_MS,
});
const snapshotListeners = new Set<() => void>();

function notifyServerFeaturesSnapshotChanged(): void {
    for (const listener of snapshotListeners) {
        listener();
    }
}

function writeServerFeaturesSnapshot(
    cacheKey: string,
    snapshot: ServerFeaturesSnapshot,
    ttlMs: number,
): void {
    cache.setSuccess(cacheKey, snapshot, { ttlMs });
    notifyServerFeaturesSnapshotChanged();
}

type ActiveFeatureProjection = 'public' | 'authenticated';

function getActiveProjectionCache(projection: ActiveFeatureProjection): AsyncTtlCache<ServerFeaturesSnapshot> {
    return projection === 'authenticated' ? authenticatedCache : cache;
}

function writeActiveProjectionSnapshot(
    projection: ActiveFeatureProjection,
    cacheKey: string,
    snapshot: ServerFeaturesSnapshot,
    ttlMs: number,
): void {
    if (projection === 'public') {
        writeServerFeaturesSnapshot(cacheKey, snapshot, ttlMs);
        return;
    }
    authenticatedCache.setSuccess(cacheKey, snapshot, { ttlMs });
}

function writeEndpointServerFeaturesSnapshot(
    cacheKey: string,
    snapshot: ServerFeaturesSnapshot,
    ttlMs: number,
): void {
    endpointCache.setSuccess(cacheKey, snapshot, { ttlMs });
}

export function subscribeServerFeaturesSnapshot(
    listener: () => void,
): () => void {
    snapshotListeners.add(listener);
    return () => {
        snapshotListeners.delete(listener);
    };
}

function isEndpointMissing(status: number): boolean {
    return status === 404 || status === 405 || status === 501;
}

function getCacheTtlMs(snapshot: ServerFeaturesSnapshot): number {
    if (snapshot.status === 'ready') {
        return snapshot.features.capabilities.homeSearch?.reason === 'indexing'
            ? TTL_TRANSITIONAL_FEATURE_MS
            : TTL_READY_MS;
    }
    if (snapshot.status === 'unsupported') {
        return snapshot.reason === 'endpoint_missing'
            ? TTL_UNSUPPORTED_ENDPOINT_MISSING_MS
            : TTL_UNSUPPORTED_INVALID_PAYLOAD_MS;
    }

    // error
    switch (snapshot.reason) {
        case 'timeout':
            return TTL_ERROR_TIMEOUT_MS;
        case 'network':
            return TTL_ERROR_NETWORK_MS;
        case 'response_status':
        case 'identity_conflict':
            return TTL_ERROR_RESPONSE_STATUS_MS;
        default:
            return TTL_ERROR_NETWORK_MS;
    }
}

function getForceCooldownMs(snapshot: ServerFeaturesSnapshot): number {
    if (snapshot.status === 'unsupported' && snapshot.reason === 'endpoint_missing') {
        return FORCE_COOLDOWN_ENDPOINT_MISSING_MS;
    }
    return 0;
}

function getCacheKey(serverId?: string): string {
    const snapshot = getActiveServerSnapshot();
    const requested = String(serverId ?? '').trim();
    if (!requested || areServerProfileIdentifiersEquivalent(requested, snapshot.serverId)) return snapshot.serverId;
    return resolveServerProfileScopeIdForIdentifier(requested);
}

function joinBaseAndPath(baseUrl: string, path: string): string {
    const base = String(baseUrl ?? '').replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
}

/**
 * Explicit endpoint probes are keyed by their stable URL and effective request
 * origin rather than the focused server id. Keep the namespace separate from
 * id-scoped entries in the legacy active-server cache; a URL is allowed to be
 * unknown to the local profile store.
 */
function getEndpointCacheKey(
    endpointUrl: string,
    runtimeOrigin: string,
    homeCarrier?: HomeCarrier,
): string {
    return `endpoint:${endpointUrl}\u0000runtime:${runtimeOrigin}\u0000carrier:${homeCarrier?.endpointId ?? 'url'}`;
}

function normalizeExplicitEndpointUrl(raw: unknown): string {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    try {
        const parsed = new URL(value);
        parsed.username = '';
        parsed.password = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return '';
    }
}

function resolveEffectiveProbeRuntimeOrigin(
    endpointUrl: string,
    runtimeOrigin: unknown,
): string {
    const candidate = String(runtimeOrigin ?? '').trim();
    if (!candidate) return endpointUrl;
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
        // Invalid runtime origins use the same stable-endpoint fallback as the
        // explicit request adapter.
    }
    return endpointUrl;
}

function isAbortErrorLike(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    return 'name' in error && (error as { name?: unknown }).name === 'AbortError';
}

async function getServerFeaturesSnapshotWithRetry(
    params: {
        timeoutMs?: number;
        force?: boolean;
        serverId?: string;
        projection?: ActiveFeatureProjection;
        credentials?: AuthCredentials;
    } | undefined,
    remainingSwitchAbortRetries: number,
): Promise<ServerFeaturesSnapshot> {
    const force = params?.force ?? false;
    const timeoutMs = params?.timeoutMs ?? 800;
    const projection = params?.projection ?? 'public';
    const projectionCache = getActiveProjectionCache(projection);
    const cacheKey = getCacheKey(params?.serverId);
    const requestedServerId = String(params?.serverId ?? '').trim();
    let activeSnapshot = getActiveServerSnapshot();
    // Read at request time, not once: the focused Home's transport publication
    // can be replaced between retries, exactly like `activeSnapshot` itself.
    const readActiveHomeCarrier = () => {
        const homeCarrier = getActiveServerHomeCarrier();
        return homeCarrier ? { homeCarrier } : null;
    };
    const isExplicitServerRequest = requestedServerId.length > 0
        && !areServerProfileIdentifiersEquivalent(requestedServerId, activeSnapshot.serverId);
    const explicitServerId = isExplicitServerRequest ? resolveServerProfileScopeIdForIdentifier(requestedServerId) : '';
    const explicitServerUrl = isExplicitServerRequest
        ? normalizeBaseUrl(getServerProfileById(explicitServerId)?.serverUrl ?? '')
        : null;

    const cachedEntry = projectionCache.get(cacheKey);
    const cached = cachedEntry?.kind === 'success' ? cachedEntry.value : null;
    if (cached && cachedEntry) {
        const ageMs = Date.now() - cachedEntry.updatedAt;
        const fresh = projectionCache.isFresh(cachedEntry);
        if (fresh) {
            if (!force) return cached;

            const cooldownMs = getForceCooldownMs(cached);
            if (ageMs < cooldownMs) {
                return cached;
            }
        }
    }

    return await projectionCache.runDedupe(cacheKey, async (): Promise<ServerFeaturesSnapshot> => {
        const cachedEntry2 = projectionCache.get(cacheKey);
        const cached2 = cachedEntry2?.kind === 'success' ? cachedEntry2.value : null;
        if (cached2 && cachedEntry2) {
            const ageMs = Date.now() - cachedEntry2.updatedAt;
            const fresh = projectionCache.isFresh(cachedEntry2);
            if (fresh) {
                if (!force) return cached2;
                const cooldownMs = getForceCooldownMs(cached2);
                if (ageMs < cooldownMs) return cached2;
            }
        }

        if (isExplicitServerRequest && !explicitServerUrl) {
            const value: ServerFeaturesSnapshot = { status: 'error', reason: 'network' };
            writeActiveProjectionSnapshot(projection, cacheKey, value, getCacheTtlMs(value));
            return value;
        }

        let remainingRetries = remainingSwitchAbortRetries;
        // If a server switch is in-flight, it can cancel a feature probe or make its completed response stale.
        // Treat both as transient and retry a couple times so the UI doesn't get stuck behind a manual "Retry".
        // This is separate from network timeouts (which should still be cached briefly).
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                let response: Response;
                let descriptorObservation: 'exact' | 'public' = 'public';
                try {
                    const probedServerUrl = isExplicitServerRequest
                        ? explicitServerUrl!
                        : activeSnapshot.serverUrl;
                    recordAccountStoredContentServerRequirements({
                        serverUrl: probedServerUrl,
                        requirements: undefined,
                    });
                    response = isExplicitServerRequest
                        ? await runtimeFetchWithServerReachability({
                            serverUrl: explicitServerUrl!,
                            token: null,
                            url: joinBaseAndPath(explicitServerUrl!, '/v1/features'),
                            init: {
                                method: 'GET',
                                signal: controller.signal,
                            },
                            timeoutMs,
                        })
                        : projection === 'authenticated'
                            ? await serverHttp.createServerFetchAtEndpoint({
                                endpointUrl: activeSnapshot.serverUrl,
                                runtimeOrigin: activeSnapshot.runtimeOrigin,
                                // An ingress-less Home has no URL a platform fetch
                                // can reach; discovery uses the same carrier the
                                // requests do, while the canonical URL stays the
                                // cache and profile key.
                                ...(readActiveHomeCarrier() ?? {}),
                                serverId: activeSnapshot.serverId,
                                credentials: params?.credentials,
                            })(
                                '/v1/features/authenticated',
                                {
                                    method: 'GET',
                                    signal: controller.signal,
                                },
                                { includeAuth: true, retry: 'none' },
                            )
                            : await serverHttp.serverFetch(
                                '/v1/features',
                                {
                                    method: 'GET',
                                    signal: controller.signal,
                                },
                                // Public discovery must remain usable before a Home credential exists.
                                { includeAuth: false, retry: 'none' },
                            );
                    if (!isExplicitServerRequest && projection === 'authenticated') {
                        if (isEndpointMissing(response.status)) {
                            response = await serverHttp.createServerFetchAtEndpoint({
                                endpointUrl: activeSnapshot.serverUrl,
                                runtimeOrigin: activeSnapshot.runtimeOrigin,
                                ...(readActiveHomeCarrier() ?? {}),
                                serverId: activeSnapshot.serverId,
                                credentials: params?.credentials,
                            })(
                                '/v1/features',
                                {
                                    method: 'GET',
                                    signal: controller.signal,
                                },
                                { includeAuth: false, retry: 'none' },
                            );
                        } else if (response.ok) {
                            descriptorObservation = 'exact';
                        }
                    }
                } catch (error) {
                    const timedOut = controller.signal.aborted;
                    const aborted = isAbortErrorLike(error);
                    const serverSwitchFailure =
                        error instanceof ServerFetchAbortedForServerSwitchError
                        || error instanceof StaleServerGenerationError;

                    if (!isExplicitServerRequest && serverSwitchFailure && remainingRetries > 0) {
                        const current = getActiveServerSnapshot();
                        const activeChanged =
                            current.serverId !== activeSnapshot.serverId || current.generation !== activeSnapshot.generation;
                        remainingRetries -= 1;
                        // If we switched to a different active server, restart the whole flow so caching/dedupe uses
                        // the new server's key. Otherwise, the abort was likely caused by the switch itself racing
                        // with a follow-up probe against the already-selected server.
                        if (activeChanged) {
                            if (getCacheKey(params?.serverId) !== cacheKey) {
                                return await getServerFeaturesSnapshotWithRetry(params, remainingRetries);
                            }
                            // A generation-only change keeps this cache key. Re-entering its active dedupe
                            // invocation would await the current probe, so retry with the current snapshot here.
                            activeSnapshot = current;
                            continue;
                        }
                        await new Promise<void>((resolve) => setTimeout(resolve, 0));
                        continue;
                    }

                    if (!timedOut && aborted) {
                        const current = getActiveServerSnapshot();
                        const activeChanged =
                            current.serverId !== activeSnapshot.serverId || current.generation !== activeSnapshot.generation;
                        if (!isExplicitServerRequest && activeChanged && remainingRetries > 0) {
                            remainingRetries -= 1;
                            if (getCacheKey(params?.serverId) !== cacheKey) {
                                return await getServerFeaturesSnapshotWithRetry(params, remainingRetries);
                            }
                            activeSnapshot = current;
                            continue;
                        }
                        // Likely cancelled upstream (e.g. unmount). Do not cache.
                        return { status: 'error', reason: 'network' };
                    }

                    const value: ServerFeaturesSnapshot = { status: 'error', reason: timedOut ? 'timeout' : 'network' };
                    writeActiveProjectionSnapshot(projection, cacheKey, value, getCacheTtlMs(value));
                    return value;
                }

                if (!response.ok) {
                    const value: ServerFeaturesSnapshot = isEndpointMissing(response.status)
                        ? { status: 'unsupported', reason: 'endpoint_missing' }
                        : { status: 'error', reason: 'response_status' };
                    writeActiveProjectionSnapshot(projection, cacheKey, value, getCacheTtlMs(value));
                    return value;
                }

                const contentType = String(response.headers?.get?.('content-type') ?? '').toLowerCase();
                if (contentType && !contentType.includes('application/json') && !contentType.includes('+json')) {
                    const value: ServerFeaturesSnapshot = { status: 'unsupported', reason: 'invalid_payload' };
                    writeActiveProjectionSnapshot(projection, cacheKey, value, getCacheTtlMs(value));
                    return value;
                }

                let payload: unknown;
                try {
                    payload = await response.json();
                } catch {
                    const value: ServerFeaturesSnapshot = { status: 'unsupported', reason: 'invalid_payload' };
                    writeActiveProjectionSnapshot(projection, cacheKey, value, getCacheTtlMs(value));
                    return value;
                }

                const parsed = parseServerFeatures(payload);
                if (!parsed) {
                    const value: ServerFeaturesSnapshot = { status: 'unsupported', reason: 'invalid_payload' };
                    writeActiveProjectionSnapshot(projection, cacheKey, value, getCacheTtlMs(value));
                    return value;
                }

                const serverIdentityId = parsed.capabilities.serverIdentity.serverIdentityId;
                if (serverIdentityId) {
                    const observedServerUrl = isExplicitServerRequest ? explicitServerUrl! : activeSnapshot.serverUrl;
                    const learnedProfile = setServerProfileIdentityForUrl(
                        observedServerUrl,
                        serverIdentityId,
                    );
                    if (!learnedProfile) {
                        const value: ServerFeaturesSnapshot = { status: 'error', reason: 'identity_conflict' };
                        writeActiveProjectionSnapshot(projection, cacheKey, value, getCacheTtlMs(value));
                        return value;
                    }
                    if (
                        learnedProfile.serverIdentityId === serverIdentityId
                        && parsed.homeConnectionDescriptor
                    ) {
                        const reconciliation = await reconcileServerProfileHomeConnectionDescriptor({
                            serverUrl: observedServerUrl,
                            observedServerIdentityId: serverIdentityId,
                            descriptor: parsed.homeConnectionDescriptor,
                            observation: descriptorObservation,
                        });
                        if (reconciliation.kind === 'conflict') {
                            const value: ServerFeaturesSnapshot = { status: 'error', reason: 'identity_conflict' };
                            writeActiveProjectionSnapshot(projection, cacheKey, value, getCacheTtlMs(value));
                            return value;
                        }
                    }
                }

                const value: ServerFeaturesSnapshot = { status: 'ready', features: parsed };
                recordAccountStoredContentServerRequirements({
                    serverUrl: isExplicitServerRequest
                        ? explicitServerUrl!
                        : activeSnapshot.serverUrl,
                    requirements:
                        parsed.capabilities.accountStoredContentCompatibility,
                });
                const ttlMs = getCacheTtlMs(value);
                writeActiveProjectionSnapshot(projection, cacheKey, value, ttlMs);
                // Learning a stable server identity can synchronously change
                // the active/profile scope key. Publish the same observed
                // snapshot under that canonical key before returning so an
                // immediate identity-scoped consumer cannot miss the ready
                // result and fail closed on a transient null cache entry.
                // Keep the captured key until its TTL expires: deleting it
                // here would also remove this still-running dedupe entry.
                const canonicalCacheKey = getCacheKey(params?.serverId);
                if (canonicalCacheKey !== cacheKey) {
                    writeActiveProjectionSnapshot(projection, canonicalCacheKey, value, ttlMs);
                }
                return value;
            } finally {
                clearTimeout(timer);
            }
        }
    });
}

export async function getServerFeaturesSnapshot(params?: {
    timeoutMs?: number;
    force?: boolean;
    serverId?: string;
}): Promise<ServerFeaturesSnapshot> {
    return await getServerFeaturesSnapshotWithRetry({ ...params, projection: 'public' }, 2);
}

/**
 * Refresh the focused Home's full descriptor after authentication has already
 * succeeded. Older Homes fall back to the public projection; pre-auth feature
 * consumers continue to use `getServerFeaturesSnapshot`.
 */
export async function refreshAuthenticatedServerFeaturesSnapshot(params: {
    credentials: AuthCredentials;
    timeoutMs?: number;
    force?: boolean;
}): Promise<ServerFeaturesSnapshot> {
    return await getServerFeaturesSnapshotWithRetry({
        ...params,
        projection: 'authenticated',
    }, 0);
}

export function getCachedServerFeaturesSnapshot(params?: { serverId?: string }): ServerFeaturesSnapshot | null {
    const cacheKey = getCacheKey(params?.serverId);
    const cached = cache.get(cacheKey);
    return cached?.kind === 'success' ? cached.value : null;
}

export function getServerFeaturesSnapshotRetryDelayMs(params: {
    serverId?: string;
    snapshot: ServerFeaturesSnapshot;
}): number | null {
    const shouldRetry = params.snapshot.status === 'error'
        || (
            params.snapshot.status === 'ready'
            && params.snapshot.features.capabilities.homeSearch?.reason === 'indexing'
        );
    if (!shouldRetry) return null;
    const cached = cache.get(getCacheKey(params.serverId));
    if (cached?.kind !== 'success' || cached.value !== params.snapshot) {
        return getCacheTtlMs(params.snapshot);
    }
    return Math.max(0, cached.expiresAt - Date.now());
}

export function primeServerFeaturesSnapshot(params: {
    serverId?: string;
    snapshot: ServerFeaturesSnapshot;
    ttlMs?: number;
}): void {
    writeServerFeaturesSnapshot(
        getCacheKey(params.serverId),
        params.snapshot,
        params.ttlMs ?? getCacheTtlMs(params.snapshot),
    );
}

export function deleteServerFeaturesSnapshot(params?: { serverId?: string }): void {
    cache.delete(getCacheKey(params?.serverId));
    notifyServerFeaturesSnapshotChanged();
}

export type ProbeServerFeaturesAtUrlOptions = Readonly<{
    /** Bound for the feature request itself. Defaults to the active probe bound. */
    timeoutMs?: number;
    /** Force a refresh even when a URL-scoped snapshot is still fresh. */
    force?: boolean;
    /** Stable profile/identity hint used only for credential/reachability scoping. */
    serverId?: string;
    /** Request-only transport origin (for example an Iroh loopback origin). */
    runtimeOrigin?: string;
    /** Semantic browser Iroh carrier, where a loopback runtime origin cannot exist. */
    homeCarrier?: HomeCarrier;
    /** Caller cancellation; it never changes focused-server state. */
    signal?: AbortSignal;
}>;

export type ProbeServerFeaturesAtUrlInput = ProbeServerFeaturesAtUrlOptions & {
    /** Canonical spelling used by the endpoint contracts. */
    endpointUrl?: string;
    /** Compatibility spelling retained by the earlier probe helper contract. */
    serverUrl?: string;
};

function normalizeProbeServerFeaturesArgs(
    endpointOrInput: string | ProbeServerFeaturesAtUrlInput,
    options?: ProbeServerFeaturesAtUrlOptions,
): ProbeServerFeaturesAtUrlInput {
    if (typeof endpointOrInput === 'string') {
        return {
            endpointUrl: endpointOrInput,
            ...(options ?? {}),
        };
    }
    return {
        ...endpointOrInput,
        endpointUrl: endpointOrInput.endpointUrl ?? endpointOrInput.serverUrl ?? '',
    };
}

/**
 * Probe a Home/Account Service at an explicit endpoint. This is intentionally
 * independent from the focused-server snapshot/profile path: the URL is the
 * request's stable audience and the optional runtime origin is transport-only.
 * The result records observed identity, but does not adopt it into profiles or
 * change focus.
 */
export async function probeServerFeaturesAtUrl(
    endpointUrl: string,
    options?: ProbeServerFeaturesAtUrlOptions,
): Promise<ServerFeaturesSnapshot>;
export async function probeServerFeaturesAtUrl(
    input: ProbeServerFeaturesAtUrlInput,
): Promise<ServerFeaturesSnapshot>;
export async function probeServerFeaturesAtUrl(
    endpointOrInput: string | ProbeServerFeaturesAtUrlInput,
    options?: ProbeServerFeaturesAtUrlOptions,
): Promise<ServerFeaturesSnapshot> {
    const input = normalizeProbeServerFeaturesArgs(endpointOrInput, options);
    const endpointUrl = normalizeExplicitEndpointUrl(input.endpointUrl);
    const runtimeOrigin = resolveEffectiveProbeRuntimeOrigin(endpointUrl, input.runtimeOrigin);
    const cacheKey = getEndpointCacheKey(endpointUrl, runtimeOrigin, input.homeCarrier);
    const force = input.force ?? false;
    const timeoutMs = typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
        ? Math.max(0, Math.trunc(input.timeoutMs))
        : 800;

    const cachedEntry = endpointCache.get(cacheKey);
    const cached = cachedEntry?.kind === 'success' ? cachedEntry.value : null;
    if (cached && cachedEntry && endpointCache.isFresh(cachedEntry)) {
        if (!force) return cached;
        const ageMs = Date.now() - cachedEntry.updatedAt;
        if (ageMs < getForceCooldownMs(cached)) return cached;
    }

    return await endpointCache.runDedupe(cacheKey, async (): Promise<ServerFeaturesSnapshot> => {
        const cachedEntry2 = endpointCache.get(cacheKey);
        const cached2 = cachedEntry2?.kind === 'success' ? cachedEntry2.value : null;
        if (cached2 && cachedEntry2 && endpointCache.isFresh(cachedEntry2)) {
            if (!force) return cached2;
            const ageMs = Date.now() - cachedEntry2.updatedAt;
            if (ageMs < getForceCooldownMs(cached2)) return cached2;
        }

        if (!endpointUrl) {
            const value: ServerFeaturesSnapshot = { status: 'error', reason: 'network' };
            writeEndpointServerFeaturesSnapshot(cacheKey, value, getCacheTtlMs(value));
            return value;
        }

        const controller = new AbortController();
        let didTimeout = false;
        const timer = timeoutMs > 0
            ? setTimeout(() => {
                didTimeout = true;
                controller.abort('features-timeout');
            }, timeoutMs)
            : null;

        try {
            recordAccountStoredContentServerRequirements({
                serverUrl: endpointUrl,
                requirements: undefined,
            });
            const request = serverHttp.createServerFetchAtEndpoint({
                endpointUrl,
                runtimeOrigin,
                ...(input.homeCarrier ? { homeCarrier: input.homeCarrier } : {}),
                serverId: input.serverId,
                // A feature probe is intentionally unauthenticated. Passing null
                // also prevents a scoped credential lookup if a future caller
                // omits includeAuth on the request adapter.
                credentials: null,
                signal: input.signal,
            });

            let response: Response;
            try {
                response = await request(
                    '/v1/features',
                    {
                        method: 'GET',
                        signal: controller.signal,
                    },
                    { includeAuth: false, retry: 'none' },
                );
            } catch (error) {
                if (didTimeout) {
                    const value: ServerFeaturesSnapshot = { status: 'error', reason: 'timeout' };
                    writeEndpointServerFeaturesSnapshot(cacheKey, value, getCacheTtlMs(value));
                    return value;
                }
                // An upstream cancellation is not a server observation. Keep the
                // result uncached so a later owner can retry immediately.
                if (input.signal?.aborted || controller.signal.aborted) {
                    return { status: 'error', reason: 'network' };
                }
                const value: ServerFeaturesSnapshot = { status: 'error', reason: 'network' };
                writeEndpointServerFeaturesSnapshot(cacheKey, value, getCacheTtlMs(value));
                return value;
            }

            if (!response.ok) {
                const value: ServerFeaturesSnapshot = isEndpointMissing(response.status)
                    ? { status: 'unsupported', reason: 'endpoint_missing' }
                    : { status: 'error', reason: 'response_status' };
                writeEndpointServerFeaturesSnapshot(cacheKey, value, getCacheTtlMs(value));
                return value;
            }

            const contentType = String(response.headers?.get?.('content-type') ?? '').toLowerCase();
            if (contentType && !contentType.includes('application/json') && !contentType.includes('+json')) {
                const value: ServerFeaturesSnapshot = { status: 'unsupported', reason: 'invalid_payload' };
                writeEndpointServerFeaturesSnapshot(cacheKey, value, getCacheTtlMs(value));
                return value;
            }

            let payload: unknown;
            try {
                payload = await response.json();
            } catch {
                const value: ServerFeaturesSnapshot = { status: 'unsupported', reason: 'invalid_payload' };
                writeEndpointServerFeaturesSnapshot(cacheKey, value, getCacheTtlMs(value));
                return value;
            }

            const parsed = parseServerFeatures(payload);
            if (!parsed) {
                const value: ServerFeaturesSnapshot = { status: 'unsupported', reason: 'invalid_payload' };
                writeEndpointServerFeaturesSnapshot(cacheKey, value, getCacheTtlMs(value));
                return value;
            }

            const serverIdentityId = parsed.capabilities.serverIdentity.serverIdentityId;
            const value: ServerFeaturesSnapshot = {
                status: 'ready',
                features: parsed,
                serverIdentityId,
            };
            recordAccountStoredContentServerRequirements({
                serverUrl: endpointUrl,
                requirements: parsed.capabilities.accountStoredContentCompatibility,
            });
            writeEndpointServerFeaturesSnapshot(cacheKey, value, getCacheTtlMs(value));
            return value;
        } finally {
            if (timer) clearTimeout(timer);
        }
    });
}

export function resetServerFeaturesClientForTests(): void {
    cache.clear();
    authenticatedCache.clear();
    endpointCache.clear();
    notifyServerFeaturesSnapshotChanged();
}
