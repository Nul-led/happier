import {
    createManagedConnectionSupervisor,
    DEFAULT_MANAGED_CONNECTION_POLICY,
    type ManagedConnectionState,
    type ManagedProbeReportScope,
    type ManagedConnectionSupervisor,
    type ManagedConnectionTransport,
    type ReadinessProbeResult,
    type TransportDisconnectEvent,
} from '@happier-dev/connection-supervisor';

import { probeAuthenticatedServerAuthPingEndpoint } from '@/sync/api/capabilities/probeAuthenticatedServerAuthPingEndpoint';
import { canonicalizeServerUrl } from '@/sync/domains/server/url/serverUrlCanonical';
import { runtimeFetch } from '@/utils/system/runtimeFetch';

import { createNotAuthenticatedError } from './authErrors';
import { buildRetryLaterProbeResultFromResponse } from './retryLaterProbeResult';
import { readServerReachabilityBackgroundRetryMs, readServerReachabilityProbeTimeoutMs } from './serverReachabilityTuning';

export class ServerReachabilityWaitTimeoutError extends Error {
    constructor() {
        super('Timed out waiting for server reachability');
        this.name = 'ServerReachabilityWaitTimeoutError';
    }
}

const DEFAULT_SERVER_RESTARTING_RETRY_AFTER_MS = 10_000;

function normalizeServerRestartingRetryAfterMs(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return DEFAULT_SERVER_RESTARTING_RETRY_AFTER_MS;
    }
    return Math.floor(value);
}

let networkAllowed = true;
const networkAllowedListeners = new Set<(allowed: boolean) => void>();

export function setServerReachabilityNetworkAllowed(next: boolean): void {
    const allowed = next === true;
    if (allowed === networkAllowed) return;
    networkAllowed = allowed;
    networkAllowedListeners.forEach((listener) => listener(allowed));
}

export function isServerReachabilityNetworkAllowed(): boolean {
    return networkAllowed;
}

export function subscribeServerReachabilityNetworkAllowed(listener: (allowed: boolean) => void): () => void {
    networkAllowedListeners.add(listener);
    listener(networkAllowed);
    return () => networkAllowedListeners.delete(listener);
}

type TransportController = Readonly<{
    transport: ManagedConnectionTransport;
    emitDisconnect: (event: TransportDisconnectEvent) => void;
}>;

function createExternallyDisconnectableTransport(): TransportController {
    const connectedListeners = new Set<() => void>();
    const disconnectedListeners = new Set<(event: TransportDisconnectEvent) => void>();
    const errorListeners = new Set<(error: unknown) => void>();
    let connected = false;

    return {
        transport: {
            async connect() {
                connected = true;
                connectedListeners.forEach((listener) => listener());
            },
            async disconnect(params?: { intentional?: boolean }) {
                connected = false;
                disconnectedListeners.forEach((listener) =>
                    listener({
                        intentional: params?.intentional === true,
                        reason: params?.intentional === true ? 'manual' : 'disconnect',
                    }),
                );
            },
            async destroy() {
                connected = false;
                connectedListeners.clear();
                disconnectedListeners.clear();
                errorListeners.clear();
            },
            isConnected() {
                return connected;
            },
            onConnected(listener) {
                connectedListeners.add(listener);
                return () => connectedListeners.delete(listener);
            },
            onDisconnected(listener) {
                disconnectedListeners.add(listener);
                return () => disconnectedListeners.delete(listener);
            },
            onError(listener) {
                errorListeners.add(listener);
                return () => errorListeners.delete(listener);
            },
        },
        emitDisconnect(event) {
            connected = false;
            disconnectedListeners.forEach((listener) => listener(event));
        },
    };
}

async function runtimeFetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    if (typeof AbortController !== 'function') {
        return await runtimeFetch(input, init);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, Math.max(0, timeoutMs));

    try {
        return await runtimeFetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function probeServerReadiness(params: Readonly<{ endpoint: string; token: string | null }>): Promise<ReadinessProbeResult> {
    const endpoint = params.endpoint.replace(/\/+$/, '');
    if (!networkAllowed) {
        return {
            status: 'retry_later',
            retryAfterMs: readServerReachabilityBackgroundRetryMs(),
            errorMessage: 'Network disabled while app is backgrounded',
        };
    }
    // The authenticated ping subsumes the unauthenticated health check: it proves the same reachability and
    // additionally proves the token is accepted, with the same retry_later/server_restarting classification.
    // Running both sequentially cost every cold boot and every resume a second full round trip before the socket
    // transport was even constructed, without producing evidence the ping does not already carry. `/health`
    // remains the probe for the tokenless case, where no authenticated route can be used.
    if (!params.token) {
        try {
            const healthResponse = await runtimeFetchWithTimeout(
                `${endpoint}/health`,
                {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                },
                readServerReachabilityProbeTimeoutMs(),
            );
            if (healthResponse.status === 429) {
                return buildRetryLaterProbeResultFromResponse(healthResponse, `Health check returned ${healthResponse.status}`);
            }
            if (healthResponse.status >= 500) {
                return buildRetryLaterProbeResultFromResponse(healthResponse, `Health check returned ${healthResponse.status}`);
            }
            if (!healthResponse.ok) {
                return {
                    status: 'server_unreachable',
                    errorMessage: `Health check returned ${healthResponse.status}`,
                };
            }
        } catch (error) {
            return {
                status: 'server_unreachable',
                errorMessage: error instanceof Error ? error.message : String(error),
            };
        }

        return { status: 'ready' };
    }

    if (typeof AbortController !== 'function') {
        return await probeAuthenticatedServerAuthPingEndpoint({ endpoint, token: params.token });
    }

    const controller = new AbortController();
    const timeoutMs = readServerReachabilityProbeTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
    try {
        return await probeAuthenticatedServerAuthPingEndpoint({
            endpoint,
            token: params.token,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

type ReachabilitySupervisorEntry = {
    scopeKey: string;
    serverUrl: string;
    /** Verified request-only transport origin; canonical serverUrl remains part of the scope key. */
    runtimeOrigin: string | null;
    token: string | null;
    state: ManagedConnectionState;
    supervisor: ManagedConnectionSupervisor;
    currentTransportController: TransportController | null;
    subscribers: Set<(state: ManagedConnectionState) => void>;
    invalidateInFlight: Promise<void> | null;
    lastInvalidateAt: number;
    ownerCount: number;
    pendingStartCount: number;
    stopInFlight: Promise<void> | null;
};

const entriesByScopeKey = new Map<string, ReachabilitySupervisorEntry>();

let didInstallOnlineListener = false;

const VITEST_RUNTIME_CLEANUPS_KEY = Symbol.for('happier.vitest.runtimeCleanups');

type RuntimeCleanupRegistryForTests = Map<string, () => Promise<void> | void>;

function registerRuntimeCleanupForTests(id: string, cleanup: () => Promise<void> | void): void {
    const globalWithRegistry = globalThis as unknown as {
        [key: symbol]: RuntimeCleanupRegistryForTests | undefined;
    };
    globalWithRegistry[VITEST_RUNTIME_CLEANUPS_KEY]?.set(id, cleanup);
}

function ensureOnlineListenerInstalled(): void {
    if (didInstallOnlineListener) return;
    const w = (globalThis as unknown as { window?: unknown }).window;
    if (!w || typeof (w as any).addEventListener !== 'function') return;
    didInstallOnlineListener = true;
    (w as any).addEventListener('online', () => {
        void invalidateAllServerReachabilitySupervisors();
    });
}

function resolveReachabilityScope(serverUrlRaw: string, token: string | null): Readonly<{
    serverUrl: string;
    scopeKey: string;
}> {
    const serverUrl = canonicalizeServerUrl(String(serverUrlRaw ?? ''));
    if (!serverUrl) {
        throw new Error('Missing server URL');
    }
    return {
        serverUrl,
        scopeKey: JSON.stringify([serverUrl, token]),
    };
}

function getOrCreateEntry(serverUrlRaw: string, token: string | null = null): ReachabilitySupervisorEntry {
    const { serverUrl, scopeKey } = resolveReachabilityScope(serverUrlRaw, token);
    ensureOnlineListenerInstalled();
    const existing = entriesByScopeKey.get(scopeKey);
    if (existing) return existing;

    const subscribers = new Set<(state: ManagedConnectionState) => void>();
    const entry: ReachabilitySupervisorEntry = {
        scopeKey,
        serverUrl,
        runtimeOrigin: null,
        token,
        state: {
            phase: 'idle',
            reason: null,
            attempt: 0,
            nextRetryAt: null,
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            lastErrorMessage: null,
        },
        supervisor: createManagedConnectionSupervisor({
        ...DEFAULT_MANAGED_CONNECTION_POLICY,
        probeBeforeInitialConnect: true,
        createTransport: () => {
            const controller = createExternallyDisconnectableTransport();
            entry.currentTransportController = controller;
            return controller.transport;
        },
        probeReadiness: async () => probeServerReadiness({
            endpoint: entry.runtimeOrigin ?? entry.serverUrl,
            token: entry.token,
        }),
        onStateChange: (state) => {
            entry.state = state;
            subscribers.forEach((listener) => listener(state));
        },
        }),
        currentTransportController: null,
        subscribers,
        invalidateInFlight: null,
        lastInvalidateAt: Number.NEGATIVE_INFINITY,
        ownerCount: 0,
        pendingStartCount: 0,
        stopInFlight: null,
    };

    entriesByScopeKey.set(scopeKey, entry);
    return entry;
}

function entryHasConsumers(entry: ReachabilitySupervisorEntry): boolean {
    return entry.ownerCount > 0 || entry.pendingStartCount > 0 || entry.subscribers.size > 0;
}

async function stopEntryIfUnused(entry: ReachabilitySupervisorEntry): Promise<void> {
    if (entry.stopInFlight) {
        await entry.stopInFlight;
        return;
    }
    if (entryHasConsumers(entry)) return;

    const stop = (async () => {
        await entry.supervisor.stop();
        if (entriesByScopeKey.get(entry.scopeKey) !== entry) return;
        if (entryHasConsumers(entry)) {
            await entry.supervisor.start();
            return;
        }
        entriesByScopeKey.delete(entry.scopeKey);
    })();
    entry.stopInFlight = stop;
    try {
        await stop;
    } finally {
        if (entry.stopInFlight === stop) {
            entry.stopInFlight = null;
        }
    }
}

function findEntryForRead(serverUrlRaw: string, token?: string | null): ReachabilitySupervisorEntry | null {
    const serverUrl = canonicalizeServerUrl(String(serverUrlRaw ?? ''));
    if (!serverUrl) return null;
    if (token !== undefined) {
        return entriesByScopeKey.get(JSON.stringify([serverUrl, token])) ?? null;
    }
    const matches = Array.from(entriesByScopeKey.values()).filter((entry) => entry.serverUrl === serverUrl);
    return matches.length === 1 ? matches[0]! : null;
}

function waitForState(params: Readonly<{
    entry: ReachabilitySupervisorEntry;
    predicate: (state: ManagedConnectionState) => boolean;
    signal?: AbortSignal;
    timeoutMs: number;
}>): Promise<void> {
    if (params.predicate(params.entry.state)) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
        const createAbortError = (): Error => {
            try {
                // DOMException exists in modern JS runtimes and provides a standard AbortError shape.
                // eslint-disable-next-line no-undef
                return new DOMException('Aborted', 'AbortError') as unknown as Error;
            } catch {
                const error = new Error('Aborted');
                (error as unknown as { name: string }).name = 'AbortError';
                return error;
            }
        };

        const timeout = setTimeout(() => {
            cleanup();
            reject(new ServerReachabilityWaitTimeoutError());
        }, Math.max(0, params.timeoutMs));

        const onAbort = () => {
            cleanup();
            reject(createAbortError());
        };

        const unsubscribe = subscribeServerReachabilityState(params.entry.serverUrl, (state) => {
            if (!params.predicate(state)) return;
            cleanup();
            resolve();
        }, params.entry.token);

        const cleanup = () => {
            clearTimeout(timeout);
            unsubscribe();
            params.signal?.removeEventListener('abort', onAbort);
        };

        if (params.signal) {
            if (params.signal.aborted) {
                cleanup();
                reject(createAbortError());
                return;
            }
            params.signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

async function waitForNetworkAllowed(params: Readonly<{ signal?: AbortSignal; timeoutMs: number }>): Promise<void> {
    if (networkAllowed) return;

    await new Promise<void>((resolve, reject) => {
        const createAbortError = (): Error => {
            try {
                // eslint-disable-next-line no-undef
                return new DOMException('Aborted', 'AbortError') as unknown as Error;
            } catch {
                const error = new Error('Aborted');
                (error as unknown as { name: string }).name = 'AbortError';
                return error;
            }
        };

        const timeout = setTimeout(() => {
            cleanup();
            reject(new ServerReachabilityWaitTimeoutError());
        }, Math.max(0, params.timeoutMs));

        const onAbort = () => {
            cleanup();
            reject(createAbortError());
        };

        const unsubscribe = subscribeServerReachabilityNetworkAllowed((allowed) => {
            if (!allowed) return;
            cleanup();
            resolve();
        });

        const cleanup = () => {
            clearTimeout(timeout);
            unsubscribe();
            params.signal?.removeEventListener('abort', onAbort);
        };

        if (params.signal) {
            if (params.signal.aborted) {
                cleanup();
                reject(createAbortError());
                return;
            }
            params.signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

export function subscribeServerReachabilityState(
    serverUrl: string,
    listener: (state: ManagedConnectionState) => void,
    token: string | null = null,
): () => void {
    const entry = getOrCreateEntry(serverUrl, token);
    entry.subscribers.add(listener);
    listener(entry.state);
    return () => entry.subscribers.delete(listener);
}

export function peekServerReachabilityToken(serverUrl: string, token?: string | null): string | null | undefined {
    const entry = findEntryForRead(serverUrl, token);
    return entry ? entry.token : undefined;
}

export function peekServerReachabilityState(serverUrl: string, token?: string | null): ManagedConnectionState | null {
    return findEntryForRead(serverUrl, token)?.state ?? null;
}

export async function waitForServerReachable(params: Readonly<{
    serverUrl: string;
    token: string | null;
    signal?: AbortSignal;
    timeoutMs: number;
    acceptAuthFailed?: boolean;
}>): Promise<void> {
    await waitForNetworkAllowed({ signal: params.signal, timeoutMs: params.timeoutMs });
    const entry = getOrCreateEntry(params.serverUrl, params.token);
    const tokenChanged = entry.token !== params.token;
    entry.token = params.token;

    // IMPORTANT: `createManagedConnectionSupervisor.start()` will immediately create/connect a transport when the
    // supervisor is already started but currently offline/auth_failed. For reachability supervision we must not
    // bypass the existing probe/backoff schedule (otherwise each caller waiting for reachability can reset the
    // offline state and cause request storms).
    //
    // Only start when the supervisor has never been started (idle) or when it was explicitly stopped (shutting_down).
    // If we are stuck in auth_failed and the auth token changed, restart from a fresh initial probe.
    if (entry.state.phase === 'idle' || entry.state.phase === 'shutting_down') {
        await entry.supervisor.start();
    } else if (entry.state.phase === 'auth_failed' && tokenChanged) {
        await entry.supervisor.stop();
        await entry.supervisor.start();
    }
    await waitForState({
        entry,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
        predicate: (state) => state.phase === 'online' || (params.acceptAuthFailed === true && state.phase === 'auth_failed'),
    });
}

export async function invalidateServerReachabilitySupervisor(params: Readonly<{
    serverUrl: string;
    token: string | null;
}>): Promise<void> {
    const entry = getOrCreateEntry(params.serverUrl, params.token);
    const tokenChanged = entry.token !== params.token;
    entry.token = params.token;

    if (!networkAllowed) {
        return;
    }

    if (entry.invalidateInFlight) {
        await entry.invalidateInFlight;
        return;
    }

    const now = Date.now();
    // Avoid repeated stop/start loops when multiple callers attempt to "force reconnect" at once.
    if (now - entry.lastInvalidateAt < 250) {
        return;
    }
    entry.lastInvalidateAt = now;

    const run = (async () => {
        if (entry.state.phase === 'online' || entry.state.phase === 'connecting' || entry.state.phase === 'offline') {
            // Explicit invalidation is used after out-of-band evidence such as a Socket.IO transport drop.
            // Force a fresh probe even if the synthetic reachability transport still thinks it is online.
            await entry.supervisor.stop();
            await entry.supervisor.start();
            return;
        }
        if (entry.state.phase === 'idle' || entry.state.phase === 'shutting_down') {
            await entry.supervisor.start();
            return;
        }
        if (entry.state.phase === 'auth_failed' && tokenChanged) {
            await entry.supervisor.stop();
            await entry.supervisor.start();
            return;
        }
    })();

    entry.invalidateInFlight = run;
    try {
        await run;
    } finally {
        if (entry.invalidateInFlight === run) {
            entry.invalidateInFlight = null;
        }
    }
}

export async function invalidateAllServerReachabilitySupervisors(): Promise<void> {
    await Promise.allSettled(Array.from(entriesByScopeKey.values()).map((entry) =>
        invalidateServerReachabilitySupervisor({ serverUrl: entry.serverUrl, token: entry.token }),
    ));
}

export function reportServerUnreachable(serverUrl: string, error: unknown, token?: string | null): void {
    const entry = findEntryForRead(serverUrl, token);
    if (!entry) return;
    if (entry.state.phase !== 'online' && entry.state.phase !== 'connecting') {
        return;
    }
    const controller = entry.currentTransportController;
    if (!controller) return;
    controller.emitDisconnect({
        intentional: false,
        reason: 'network_error',
        error,
    });
}

export function reportServerRestarting(serverUrl: string, retryAfterMs?: number, token?: string | null): void {
    const entry = findEntryForRead(serverUrl, token);
    if (!entry) return;
    if (typeof entry.supervisor.reportProbeResult !== 'function') return;
    const scope = entry.supervisor.captureProbeReportScope?.();
    if (!scope) return;
    entry.supervisor.reportProbeResult({
        status: 'retry_later',
        retryAfterMs: normalizeServerRestartingRetryAfterMs(retryAfterMs),
        reason: 'server_restarting',
        errorMessage: 'Server restart in progress',
    }, scope);
}

export function reportServerAuthFailed(
    serverUrl: string,
    statusCode: 401 | 403,
    scope?: ManagedProbeReportScope,
    token?: string | null,
): void {
    const entry = findEntryForRead(serverUrl, token);
    if (!entry) return;
    if (typeof entry.supervisor.reportProbeResult !== 'function') return;
    const resolvedScope = scope ?? entry.supervisor.captureProbeReportScope?.();
    if (!resolvedScope) return;
    entry.supervisor.reportProbeResult({
        status: 'auth_failed',
        statusCode,
        errorMessage: `HTTP ${statusCode}`,
    }, resolvedScope);
}

export function peekServerReachabilityScope(serverUrl: string, token?: string | null): ManagedProbeReportScope | null {
    const entry = findEntryForRead(serverUrl, token);
    const captureProbeReportScope = entry?.supervisor.captureProbeReportScope;
    return typeof captureProbeReportScope === 'function' ? captureProbeReportScope() : null;
}

export function assertServerReachabilityAuthenticated(serverUrl: string, token?: string | null): void {
    if (peekServerReachabilityState(serverUrl, token)?.phase === 'auth_failed') {
        throw createNotAuthenticatedError();
    }
}

export async function stopServerReachabilitySupervisors(): Promise<void> {
    await Promise.allSettled(Array.from(entriesByScopeKey.values()).map((entry) => entry.supervisor.stop()));
}

export async function startServerReachabilitySupervisor(params: Readonly<{
    serverUrl: string;
    token: string | null;
    /** Verified transport-only origin; ownership/subscriptions remain keyed by serverUrl. */
    runtimeOrigin?: string;
}>): Promise<void> {
    const entry = getOrCreateEntry(params.serverUrl, params.token);
    entry.pendingStartCount += 1;
    try {
        await entry.stopInFlight;
        const tokenChanged = entry.token !== params.token;
        const runtimeOriginRaw = String(params.runtimeOrigin ?? '').trim();
        const runtimeOrigin = runtimeOriginRaw ? canonicalizeServerUrl(runtimeOriginRaw) : null;
        if (runtimeOriginRaw && !runtimeOrigin) {
            throw new Error('Invalid server reachability runtime origin');
        }
        const runtimeOriginChanged = entry.runtimeOrigin !== runtimeOrigin;
        entry.token = params.token;
        entry.runtimeOrigin = runtimeOrigin;

        if (!networkAllowed) {
            return;
        }

        if (entry.state.phase === 'idle' || entry.state.phase === 'shutting_down') {
            await entry.supervisor.start();
        } else if (runtimeOriginChanged || (entry.state.phase === 'auth_failed' && tokenChanged)) {
            await entry.supervisor.stop();
            await entry.supervisor.start();
        }
    } finally {
        entry.pendingStartCount = Math.max(0, entry.pendingStartCount - 1);
    }
}

export type ServerReachabilityLease = Readonly<{ release: () => Promise<void> }>;

export async function acquireServerReachabilitySupervisor(params: Readonly<{
    serverUrl: string;
    token: string | null;
    runtimeOrigin?: string;
}>): Promise<ServerReachabilityLease> {
    const entry = getOrCreateEntry(params.serverUrl, params.token);
    entry.ownerCount += 1;
    try {
        await startServerReachabilitySupervisor(params);
    } catch (error) {
        entry.ownerCount = Math.max(0, entry.ownerCount - 1);
        throw error;
    }
    let released = false;
    return {
        release: async () => {
            if (released) return;
            released = true;
            entry.ownerCount = Math.max(0, entry.ownerCount - 1);
            await stopEntryIfUnused(entry);
        },
    };
}

export async function stopServerReachabilitySupervisor(serverUrl: string, token?: string | null): Promise<void> {
    const normalized = canonicalizeServerUrl(String(serverUrl ?? ''));
    if (!normalized) return;
    const entries = token === undefined
        ? Array.from(entriesByScopeKey.values()).filter((entry) => entry.serverUrl === normalized)
        : [findEntryForRead(normalized, token)].filter((entry): entry is ReachabilitySupervisorEntry => Boolean(entry));
    await Promise.allSettled(entries.map(async (entry) => {
        await stopEntryIfUnused(entry);
    }));
}

export async function resetServerReachabilitySupervisors(): Promise<void> {
    await stopServerReachabilitySupervisors();
    entriesByScopeKey.clear();
}

registerRuntimeCleanupForTests('resetServerReachabilitySupervisors', resetServerReachabilitySupervisors);
