import { MMKV } from 'react-native-mmkv';
import {
    HomeConnectionDescriptorV1Schema,
    normalizeServerIdentityIdCapability,
    parseIrohEndpointDescriptorV1,
    type HomeConnectionDescriptorV1,
    type IrohEndpointDescriptorV1,
} from '@happier-dev/protocol';
import type { IrohObservedPath, IrohRelayPolicy } from '@happier-dev/iroh-native';
import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';
import { isStackContext } from './serverContext';
import { canonicalizeServerUrl, createServerUrlComparableKey } from './url/serverUrlCanonical';
import { sanitizeServerUrlForShareableLink } from './url/shareableServerUrl';
import { readConfiguredServerUrlEnv, readConfiguredServerUrlEnvRaw } from './readConfiguredServerUrlEnv';
import { resolveSetupSurfacePolicy } from './setup/setupSurfacePolicy';
import { normalizeStoredServerSelectionGroups } from './selection/serverSelectionMutations';
import type { ServerSelectionGroup } from './selection/serverSelectionTypes';

export type ServerProfileSource =
    | 'manual' | 'qr' | 'account-directory' | 'desktop-personal-home' | 'legacy'
    | 'url' | 'stack-env' | 'notification' | 'preconfigured';

export type AccountServiceEndpointV1 = Readonly<{
    url: string;
    serverIdentityId?: string;
    displayName?: string;
    source: 'default' | 'configured' | 'user';
}>;

type LegacyManualHomeDescriptor = Readonly<{
    serverUrl: string;
    canonicalServerUrl?: string;
    publicServerUrl?: string | null;
    homeServerIdentityId?: string;
    displayName?: string;
}>;

export const HAPPIER_CLOUD_SERVER_URL = 'https://api.happier.dev' as const;

export type ServerProfile = Readonly<{
    id: string;
    name: string;
    serverUrl: string;
    shareableServerUrl?: string | null;
    shareableServerUrlValidatedAgainstServerUrl?: string | null;
    serverIdentityId?: string | null;
    legacyServerIds?: readonly string[];
    createdAt: number;
    updatedAt: number;
    lastUsedAt: number;
    source?: ServerProfileSource;
    /** Original unknown persisted source retained for lossless downgrade/round-trip. */
    legacySource?: string;
    canonicalServerUrl?: string;
    publicServerUrl?: string | null;
    /** Last adopted Iroh endpoint sub-descriptor; absent for non-Iroh Homes. */
    irohEndpoint?: IrohEndpointDescriptorV1;
    /** Monotonic revision of the last adopted connection descriptor. */
    connectionDescriptorRevision?: number;
}>;

export type PortableServerIdentityProfileResolution =
    | Readonly<{
        kind: 'resolved';
        serverIdentityId: string;
        profile: ServerProfile;
    }>
    | Readonly<{
        kind: 'missing';
        serverIdentityId: string;
    }>
    | Readonly<{
        kind: 'ambiguous';
        serverIdentityId: string;
        profiles: readonly ServerProfile[];
    }>;

export type ActiveServerSnapshot = Readonly<{
    serverId: string;
    serverUrl: string;
    activeShareableServerUrl?: string | null;
    activeShareableServerUrlValidatedAgainstServerUrl?: string | null;
    activeLocalRelayUrl?: string | null;
    runtimeOrigin?: string;
    carrier?: 'https' | 'iroh';
    /** Native-observed selected Iroh path; never inferred from descriptor or policy. */
    irohObservedPath?: IrohObservedPath;
    /** Effective local mode applied to the currently published Iroh lease. */
    irohRelayPolicy?: IrohRelayPolicy;
    connectionDescriptorRevision?: number;
    isSelectionExplicit?: boolean;
    generation: number;
}>;

export type ActiveServerRuntimeTarget = Readonly<{
    serverId: string;
    generation: number;
}>;

type PersistedServerState = {
    activeServerIdIsExplicit?: boolean;
    activeServerId?: string;
    servers?: Record<string, ServerProfile>;
    accountServiceEndpoint?: AccountServiceEndpointV1 | null;
    homeViewState?: HomeViewStateV1 | null;
    /**
     * Explicit initialization/version marker for `homeViewState`. Absent/false means the
     * legacy pre-marker world where a missing payload still permits the one-time scoped
     * migration; true means the payload is authoritative and corruption repairs to the
     * normalized focused fallback instead of re-consulting scoped settings.
     */
    homeViewStateInitialized?: boolean;
};

export type HomeViewStateV1 = Readonly<{
    version: 1;
    groups: readonly ServerSelectionGroup[];
    activeTargetKind: 'server' | 'group' | null;
    activeTargetId: string | null;
}>;

type PreconfiguredServer = Readonly<{
    name: string;
    source: ServerProfileSource;
    url: string;
    idSeed?: string;
}>;

const SESSION_STORAGE_ACTIVE_ID_KEY = 'activeServerId';
const STATE_KEY = 'server-state-v1';

let activeServerGeneration = 0;
const activeServerListeners = new Set<(snapshot: ActiveServerSnapshot) => void>();
let activeServerSnapshotCache: ActiveServerSnapshot | null = null;
let activeRuntimeOriginLease: Readonly<{
    target: ActiveServerRuntimeTarget;
    leaseId: string;
    runtimeOrigin: string;
    carrier: 'https' | 'iroh';
    irohObservedPath?: IrohObservedPath;
    irohRelayPolicy?: IrohRelayPolicy;
}> | null = null;
const runtimeOriginListeners = new Set<(snapshot: ActiveServerSnapshot) => void>();

let serverProfilesGeneration = 0;
const serverProfilesListeners = new Set<(generation: number) => void>();
const homeViewStateListeners = new Set<() => void>();
let webPersistedStateObserverInstalled = false;

function emitServerProfilesChanged(): void {
    serverProfilesGeneration += 1;
    for (const listener of serverProfilesListeners) listener(serverProfilesGeneration);
}

function emitHomeViewStateChanged(): void {
    for (const listener of homeViewStateListeners) listener();
}

function ensureWebPersistedStateObserver(): void {
    if (webPersistedStateObserverInstalled || !isWebRuntime()) return;
    const eventTarget = globalThis.window;
    if (!eventTarget || typeof eventTarget.addEventListener !== 'function') return;
    webPersistedStateObserverInstalled = true;
    eventTarget.addEventListener('storage', (event: StorageEvent) => {
        if (event.key !== `${storageId()}:${STATE_KEY}`) return;

        const previousState = persistedStateParseCache?.state ?? null;
        const previousSnapshot = activeServerSnapshotCache;
        persistedStateParseCache = null;
        const nextState = readPersistedState();

        const serversChanged = !previousState
            || JSON.stringify(previousState.servers) !== JSON.stringify(nextState.servers);
        if (serversChanged) {
            emitServerProfilesChanged();
        }
        if (!previousState || JSON.stringify(previousState.homeViewState) !== JSON.stringify(nextState.homeViewState)) {
            emitHomeViewStateChanged();
        }
        if (!previousState || JSON.stringify(previousState.accountServiceEndpoint) !== JSON.stringify(nextState.accountServiceEndpoint)) {
            const endpoint = nextState.accountServiceEndpoint ?? null;
            for (const listener of accountServiceEndpointListeners) listener(endpoint);
        }
        if (
            !previousState
            || serversChanged
            || previousState.activeServerId !== nextState.activeServerId
            || previousState.activeServerIdIsExplicit !== nextState.activeServerIdIsExplicit
        ) {
            emitActiveServerChanged(previousSnapshot, { force: true });
        }
    });
}

function isWebRuntime(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function normalizeUrl(raw: string): string {
    return canonicalizeServerUrl(raw);
}

function normalizeServerId(raw: unknown): string | null {
    const id = String(raw ?? '').trim();
    return id || null;
}

function normalizeServerIdentityId(raw: unknown): string | null {
    return normalizeServerIdentityIdCapability(raw) ?? null;
}

function uniqueServerIds(ids: readonly unknown[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of ids) {
        const id = normalizeServerId(raw);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }
    return result;
}

export function resolveServerProfileScopeId(profile: Pick<ServerProfile, 'id' | 'serverIdentityId'>): string {
    return profile.serverIdentityId ?? profile.id;
}

function comparableUrlKey(rawUrl: string): string {
    return createServerUrlComparableKey(rawUrl);
}

function deriveServerIdFromUrl(serverUrl: string): string {
    const normalized = normalizeUrl(serverUrl);
    try {
        const url = new URL(normalized);
        const host = url.hostname.toLowerCase();
        const port = url.port ? `-${url.port}` : '';
        const base = `${host}${port}`;
        const sanitized = base.replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_');
        return sanitized || 'custom';
    } catch {
        const fallback = normalized.toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/_+/g, '_');
        return fallback || 'custom';
    }
}

function defaultServerNameFromUrl(serverUrl: string): string {
    const normalized = normalizeUrl(serverUrl);
    try {
        const parsed = new URL(normalized);
        const host = parsed.hostname;
        if (!host) return normalized;
        return parsed.port ? `${host}:${parsed.port}` : host;
    } catch {
        return normalized;
    }
}

function nowMs(): number {
    return Date.now();
}

function storageId(): string {
    const scope = readStorageScopeFromEnv();
    return scopedStorageId('server-profiles', scope);
}

type PersistedStateStorage = Readonly<{
    getString: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
}>;

let persistedStateStorage: PersistedStateStorage | null = null;

function resolveWebStorageBackend(): Storage | null {
    const windowStorage = (globalThis as any).window?.localStorage;
    if (windowStorage && typeof windowStorage.getItem === 'function') return windowStorage as Storage;
    const localStorage = (globalThis as any).localStorage;
    if (localStorage && typeof localStorage.getItem === 'function') return localStorage as Storage;
    const sessionStorage = (globalThis as any).sessionStorage;
    if (sessionStorage && typeof sessionStorage.getItem === 'function') return sessionStorage as Storage;
    return null;
}

function createWebPersistedStateStorage(): PersistedStateStorage {
    const storage = resolveWebStorageBackend();
    const fallback = new Map<string, string>();
    const prefix = `${storageId()}:`;
    const resolveKey = (key: string) => `${prefix}${key}`;

    return {
        getString: (key: string) => {
            const resolvedKey = resolveKey(key);
            try {
                const value = storage?.getItem(resolvedKey) ?? null;
                return typeof value === 'string' ? value : fallback.get(resolvedKey);
            } catch {
                return fallback.get(resolvedKey);
            }
        },
        set: (key: string, value: string) => {
            const resolvedKey = resolveKey(key);
            try {
                storage?.setItem(resolvedKey, value);
            } catch {
                // ignore
            }
            fallback.set(resolvedKey, value);
        },
    };
}

function createNativePersistedStateStorage(): PersistedStateStorage {
    const storage = new MMKV({ id: storageId() });
    return {
        getString: (key: string) => storage.getString(key),
        set: (key: string, value: string) => storage.set(key, value),
    };
}

function getPersistedStateStorage(): PersistedStateStorage {
    if (persistedStateStorage) return persistedStateStorage;
    persistedStateStorage = isWebRuntime() ? createWebPersistedStateStorage() : createNativePersistedStateStorage();
    return persistedStateStorage;
}

// Demo-scoped persistence firewall. While demo mode is active the onboarding
// journey seeds a demo relay server into the active-server state; those writes
// must never reach durable storage, or a hard exit (tab close / crash / mid-seed
// navigation) would strand the real profile pointed at the dead demo server on the
// next boot. This mirrors the runtimeFetch demo firewall: on suspend we swap the
// live backend for an in-memory scratch seeded with the current durable value so
// reads stay coherent for the demo world while every write is redirected away from
// the real store; on resume we restore the untouched durable backend. Graceful
// teardown behavior is unchanged (the real store was already correct).
let demoPersistenceSuspendDepth = 0;
let durablePersistedStateStorageDuringDemo: PersistedStateStorage | null = null;

function createInMemoryPersistedStateStorage(seed: string | undefined): PersistedStateStorage {
    const values = new Map<string, string>();
    if (seed !== undefined) values.set(STATE_KEY, seed);
    return {
        getString: (key: string) => values.get(key),
        set: (key: string, value: string) => {
            values.set(key, value);
        },
    };
}

export function suspendServerProfilePersistenceForDemo(): void {
    demoPersistenceSuspendDepth += 1;
    if (demoPersistenceSuspendDepth !== 1) return;
    const durable = getPersistedStateStorage();
    durablePersistedStateStorageDuringDemo = durable;
    persistedStateStorage = createInMemoryPersistedStateStorage(durable.getString(STATE_KEY));
    persistedStateParseCache = null;
}

export function resumeServerProfilePersistenceForDemo(): void {
    if (demoPersistenceSuspendDepth === 0) return;
    demoPersistenceSuspendDepth -= 1;
    if (demoPersistenceSuspendDepth !== 0) return;
    persistedStateStorage = durablePersistedStateStorageDuringDemo;
    durablePersistedStateStorageDuringDemo = null;
    persistedStateParseCache = null;
}

export function isServerProfilePersistenceSuspendedForDemo(): boolean {
    return demoPersistenceSuspendDepth > 0;
}

export function resetServerProfilePersistenceSuspendForTests(): void {
    if (demoPersistenceSuspendDepth > 0 && durablePersistedStateStorageDuringDemo) {
        persistedStateStorage = durablePersistedStateStorageDuringDemo;
        persistedStateParseCache = null;
    }
    demoPersistenceSuspendDepth = 0;
    durablePersistedStateStorageDuringDemo = null;
}

function parsePreconfiguredServersFromEnv(): PreconfiguredServer[] {
    const entries: PreconfiguredServer[] = [];
    const seenUrlKeys = new Set<string>();
    const setupPolicy = resolveSetupSurfacePolicy();

    const append = (
        urlRaw: unknown,
        nameRaw: unknown,
        source: ServerProfileSource,
        opts: Readonly<{ idSeed?: string }> = {},
    ): void => {
        const url = normalizeUrl(String(urlRaw ?? ''));
        if (!url) return;
        const key = comparableUrlKey(url);
        if (seenUrlKeys.has(key)) return;
        seenUrlKeys.add(key);
        const name = String(nameRaw ?? '').trim();
        entries.push({ name, source, url, ...(opts.idSeed ? { idSeed: opts.idSeed } : {}) });
    };

    const rawPreconfigured = String(process.env.EXPO_PUBLIC_HAPPY_PRECONFIGURED_SERVERS ?? '').trim();
    if (rawPreconfigured) {
        try {
            const parsed = JSON.parse(rawPreconfigured);
            if (Array.isArray(parsed)) {
                for (const entry of parsed) {
                    if (typeof entry === 'string') {
                        append(entry, '', 'preconfigured');
                        continue;
                    }
                    if (!entry || typeof entry !== 'object') continue;
                    const record = entry as Record<string, unknown>;
                    append(record.url ?? record.serverUrl ?? '', record.name ?? '', 'preconfigured');
                }
            }
        } catch {
            // ignore malformed preconfigured JSON
        }
    }

    const rawSingleUrl = normalizeUrl(readConfiguredServerUrlEnvRaw());
    const singleUrl = normalizeUrl(readConfiguredServerUrlEnv());
    if (singleUrl) {
        const inStack = isStackContext();
        const idSeed = rawSingleUrl && rawSingleUrl !== singleUrl ? deriveServerIdFromUrl(rawSingleUrl) : undefined;
        append(singleUrl, '', inStack ? 'stack-env' : 'url', inStack ? { idSeed } : {});
    }

    // On web with no explicitly configured server, fall back to same-origin so that
    // self-hosted deployments (e.g. https://happier.example.com) get a server profile
    // without needing EXPO_PUBLIC_HAPPIER_SERVER_URL set at build time.
    if (entries.length === 0) {
        const origin = getWebSameOriginServerUrl();
        if (origin) {
            append(origin, '', 'url');
        }
    }

    // In stack context, and on native builds, never start "serverless": seed Happier Cloud when no preconfigured server exists.
    if (entries.length === 0 && (isStackContext() || !isWebRuntime()) && setupPolicy.relay.allowHappierCloud) {
        append(HAPPIER_CLOUD_SERVER_URL, 'Happier Cloud', 'preconfigured');
    }

    return entries;
}

function findProfileByEquivalentUrl(servers: Record<string, ServerProfile>, serverUrl: string): ServerProfile | null {
    return findProfilesByEquivalentUrl(servers, serverUrl)[0] ?? null;
}

function findProfilesByEquivalentUrl(servers: Record<string, ServerProfile>, serverUrl: string): ServerProfile[] {
    const targetKey = comparableUrlKey(serverUrl);
    if (!targetKey) return [];
    return Object.values(servers).filter(
        (profile) => comparableUrlKey(profile.canonicalServerUrl ?? profile.serverUrl) === targetKey,
    );
}

function findProfileByServerIdentifier(
    servers: Record<string, ServerProfile>,
    idRaw: string | null | undefined,
): ServerProfile | null {
    const id = normalizeServerId(idRaw);
    if (!id) return null;
    const direct = servers[id];
    if (direct) return direct;
    for (const profile of Object.values(servers)) {
        if (profile.serverIdentityId === id) return profile;
        if ((profile.legacyServerIds ?? []).includes(id)) return profile;
    }
    return null;
}

function createUniqueServerId(
    servers: Record<string, ServerProfile>,
    baseIdRaw: string,
    serverUrl: string,
): string {
    const targetUrlKey = comparableUrlKey(serverUrl);
    const baseId = String(baseIdRaw ?? '').trim() || 'custom';
    let id = baseId;
    let suffix = 2;
    while (servers[id] && comparableUrlKey(servers[id]!.serverUrl) !== targetUrlKey) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
    }
    return id;
}

function applyRuntimeSeedPolicy(servers: Record<string, ServerProfile>): Record<string, ServerProfile> {
    const next = { ...servers };
    for (const configured of parsePreconfiguredServersFromEnv()) {
        const existing = findProfileByEquivalentUrl(next, configured.url);
        if (existing) continue;

        const idSeed = String(configured.idSeed ?? '').trim();
        if (idSeed && idSeed in next) {
            const current = next[idSeed]!;
            if (
                current.source === 'stack-env'
                && configured.source === 'stack-env'
                && comparableUrlKey(current.serverUrl) !== comparableUrlKey(configured.url)
            ) {
                const now = nowMs();
                next[idSeed] = {
                    ...current,
                    serverUrl: configured.url,
                    updatedAt: now,
                };
                continue;
            }
        }

        const id = createUniqueServerId(next, idSeed || deriveServerIdFromUrl(configured.url), configured.url);
        const now = nowMs();
        next[id] = {
            id,
            name: configured.name || defaultServerNameFromUrl(configured.url) || id,
            serverUrl: configured.url,
            createdAt: now,
            updatedAt: now,
            lastUsedAt: 0,
            source: configured.source,
        };
    }
    return next;
}

function getPrimaryPreconfiguredServerId(servers: Record<string, ServerProfile>): string | null {
    for (const configured of parsePreconfiguredServersFromEnv()) {
        const existing = findProfileByEquivalentUrl(servers, configured.url);
        if (existing) return existing.id;
    }
    return null;
}

function resolvePrimaryActiveServerId(servers: Record<string, ServerProfile>, desiredId: string | null): string {
    if (desiredId && desiredId in servers) return desiredId;
    const preconfiguredId = getPrimaryPreconfiguredServerId(servers);
    if (preconfiguredId) return preconfiguredId;
    const first = Object.keys(servers)[0];
    return first ?? '';
}

function parseProfile(id: string, value: unknown): ServerProfile | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const sid = String(record.id ?? id).trim();
    const name = String(record.name ?? '').trim();
    const serverUrl = normalizeUrl(String(record.serverUrl ?? ''));
    if (!sid || !name || !serverUrl) return null;

    const rawSource = String(record.source ?? '').trim().toLowerCase();
    const source: ServerProfileSource | undefined =
        rawSource === 'manual'
            || rawSource === 'url'
            || rawSource === 'stack-env'
            || rawSource === 'notification'
            || rawSource === 'preconfigured'
            || rawSource === 'qr'
            || rawSource === 'account-directory'
            || rawSource === 'desktop-personal-home'
            || rawSource === 'legacy'
            ? rawSource
            : rawSource ? 'legacy' : undefined;
    const legacySource = source === 'legacy' && rawSource ? rawSource : undefined;

    const canonicalServerUrl = typeof record.canonicalServerUrl === 'string'
        ? normalizeUrl(record.canonicalServerUrl) : '';
    const publicServerUrl = record.publicServerUrl === null
        ? null
        : typeof record.publicServerUrl === 'string' ? normalizeUrl(record.publicServerUrl) : undefined;
    // Tolerant, additive read of the persisted Iroh endpoint sub-descriptor;
    // malformed persisted shapes are dropped, never trusted.
    let irohEndpoint: IrohEndpointDescriptorV1 | undefined;
    try {
        irohEndpoint = record.irohEndpoint === undefined ? undefined : parseIrohEndpointDescriptorV1(record.irohEndpoint);
    } catch {
        irohEndpoint = undefined;
    }
    const connectionDescriptorRevision = typeof record.connectionDescriptorRevision === 'number'
        && Number.isInteger(record.connectionDescriptorRevision)
        && record.connectionDescriptorRevision > 0
        ? record.connectionDescriptorRevision
        : undefined;

    return {
        id: sid,
        name,
        serverUrl,
        ...(canonicalServerUrl ? { canonicalServerUrl } : {}),
        ...(publicServerUrl !== undefined ? { publicServerUrl } : {}),
        ...(irohEndpoint ? { irohEndpoint } : {}),
        ...(connectionDescriptorRevision !== undefined ? { connectionDescriptorRevision } : {}),
        ...(typeof record.shareableServerUrl === 'string'
            ? { shareableServerUrl: sanitizeServerUrlForShareableLink(record.shareableServerUrl) }
            : {}),
        ...(typeof record.shareableServerUrlValidatedAgainstServerUrl === 'string'
            ? { shareableServerUrlValidatedAgainstServerUrl: normalizeUrl(String(record.shareableServerUrlValidatedAgainstServerUrl)) }
            : {}),
        ...(normalizeServerIdentityId(record.serverIdentityId)
            ? { serverIdentityId: normalizeServerIdentityId(record.serverIdentityId) }
            : {}),
        ...(Array.isArray(record.legacyServerIds)
            ? { legacyServerIds: uniqueServerIds(record.legacyServerIds).filter((legacyId) => legacyId !== sid) }
            : {}),
        createdAt: Number(record.createdAt ?? 0) || 0,
        updatedAt: Number(record.updatedAt ?? 0) || 0,
        lastUsedAt: Number(record.lastUsedAt ?? 0) || 0,
        source,
        ...(legacySource ? { legacySource } : {}),
    };
}

function pickPreferredEquivalentProfile(
    profiles: readonly ServerProfile[],
    opts: Readonly<{ sameOriginServerUrl: string | null; preferredServerId: string | null }>,
): ServerProfile {
    if (profiles.length === 1) return profiles[0]!;

    const sameOrigin = opts.sameOriginServerUrl ? normalizeUrl(opts.sameOriginServerUrl) : '';
    if (sameOrigin) {
        const sameOriginMatch = profiles.find((p) => normalizeUrl(p.serverUrl) === sameOrigin);
        if (sameOriginMatch) return sameOriginMatch;
    }

    const preferredId = normalizeServerId(opts.preferredServerId);
    if (preferredId) {
        const preferredMatch = profiles.find((p) => normalizeServerId(p.id) === preferredId);
        if (preferredMatch) return preferredMatch;
    }

    const sourceRank: Record<ServerProfileSource, number> = {
        'stack-env': 0,
        preconfigured: 1,
        url: 2,
        notification: 3,
        manual: 4,
        qr: 2,
        'account-directory': 2,
        'desktop-personal-home': 1,
        legacy: 10,
    };

    return [...profiles].sort((a, b) => {
        const aRank = a.source ? (sourceRank[a.source] ?? 10) : 10;
        const bRank = b.source ? (sourceRank[b.source] ?? 10) : 10;
        if (aRank !== bRank) return aRank - bRank;

        const aUsed = Number(a.lastUsedAt ?? 0) || 0;
        const bUsed = Number(b.lastUsedAt ?? 0) || 0;
        if (aUsed !== bUsed) return bUsed - aUsed;

        const aUpdated = Number(a.updatedAt ?? 0) || 0;
        const bUpdated = Number(b.updatedAt ?? 0) || 0;
        if (aUpdated !== bUpdated) return bUpdated - aUpdated;

        const aCreated = Number(a.createdAt ?? 0) || 0;
        const bCreated = Number(b.createdAt ?? 0) || 0;
        return aCreated - bCreated;
    })[0]!;
}

function mergeProfileIdentityMetadata(
    profiles: readonly ServerProfile[],
    preferred: ServerProfile,
): Pick<ServerProfile, 'serverIdentityId' | 'legacyServerIds'> {
    const identity = preferred.serverIdentityId ?? profiles.find((profile) => profile.serverIdentityId)?.serverIdentityId ?? null;
    const legacyIds = uniqueServerIds([
        preferred.id,
        ...profiles.map((profile) => profile.id),
        ...profiles.map((profile) => profile.serverIdentityId),
        ...profiles.flatMap((profile) => profile.legacyServerIds ?? []),
    ]).filter((id) => id !== preferred.id && id !== identity);

    return {
        ...(identity ? { serverIdentityId: identity } : {}),
        ...(legacyIds.length > 0 ? { legacyServerIds: legacyIds } : {}),
    };
}

function preserveDurablePersonalHomeClassification(
    profiles: readonly ServerProfile[],
    fallback: ServerProfile['source'],
): ServerProfile['source'] {
    return profiles.some((profile) => profile.source === 'desktop-personal-home')
        ? 'desktop-personal-home'
        : fallback;
}

/**
 * Iroh transport facts are one descriptor generation (endpoint sub-descriptor
 * plus revision). Equivalent-profile merges adopt the pair atomically from the
 * single highest-revision profile — preferring the merge winner when no profile
 * carries a revision — so a stale endpoint is never spliced onto a newer
 * revision (or vice versa), and a newer descriptor generation that removed the
 * endpoint stays authoritative over older copies that still carry one. Groups
 * never span Home identities, so facts cannot cross Homes.
 */
function coalesceIrohTransportFacts(
    group: readonly ServerProfile[],
    preferred: ServerProfile,
): Pick<ServerProfile, 'irohEndpoint' | 'connectionDescriptorRevision'> {
    let source = preferred;
    for (const profile of group) {
        if (
            profile.connectionDescriptorRevision !== undefined
            && (source.connectionDescriptorRevision === undefined
                || profile.connectionDescriptorRevision > source.connectionDescriptorRevision)
        ) {
            source = profile;
        }
    }
    if (source.irohEndpoint === undefined && source.connectionDescriptorRevision === undefined) return {};
    return {
        ...(source.irohEndpoint ? { irohEndpoint: source.irohEndpoint } : {}),
        ...(source.connectionDescriptorRevision !== undefined
            ? { connectionDescriptorRevision: source.connectionDescriptorRevision }
            : {}),
    };
}

function dedupeEquivalentProfiles(params: Readonly<{
    servers: Record<string, ServerProfile>;
    sameOriginServerUrl: string | null;
    preferredServerId: string | null;
}>): Readonly<{
    servers: Record<string, ServerProfile>;
    idRewrite: Map<string, string>;
    changed: boolean;
}> {
    const groupsByKey = new Map<string, ServerProfile[]>();
    const profilesByUrl = new Map<string, ServerProfile[]>();
    for (const profile of Object.values(params.servers)) {
        const key = comparableUrlKey(profile.canonicalServerUrl ?? profile.serverUrl) || `id:${profile.id}`;
        const group = profilesByUrl.get(key);
        if (group) group.push(profile);
        else profilesByUrl.set(key, [profile]);
    }
    for (const [urlKey, profiles] of profilesByUrl) {
        const identities = new Set(profiles.map((profile) => profile.serverIdentityId).filter(Boolean));
        if (identities.size <= 1) {
            groupsByKey.set(urlKey, profiles);
            continue;
        }
        // Stable identities outrank URL equality. Keep conflicting Homes
        // separate; identity-less legacy entries may only join when there is
        // no ambiguity (handled by the <=1 branch above).
        for (const profile of profiles) {
            const identityKey = profile.serverIdentityId ?? `legacy:${profile.id}`;
            const key = `${urlKey}|identity:${identityKey}`;
            const group = groupsByKey.get(key);
            if (group) group.push(profile);
            else groupsByKey.set(key, [profile]);
        }
    }

    let changed = false;
    const idRewrite = new Map<string, string>();
    const next: Record<string, ServerProfile> = {};

    for (const group of groupsByKey.values()) {
        if (group.length === 1) {
            const only = group[0]!;
            next[only.id] = only;
            continue;
        }

        changed = true;
        const preferred = pickPreferredEquivalentProfile(group, {
            sameOriginServerUrl: params.sameOriginServerUrl,
            preferredServerId: params.preferredServerId,
        });
        const merged: ServerProfile = group.reduce<ServerProfile>((acc, current) => {
            if (current.id === acc.id) return acc;
            return {
                ...acc,
                createdAt: Math.min(acc.createdAt, current.createdAt),
                updatedAt: Math.max(acc.updatedAt, current.updatedAt),
                lastUsedAt: Math.max(acc.lastUsedAt, current.lastUsedAt),
                ...(acc.shareableServerUrl ?? current.shareableServerUrl
                    ? { shareableServerUrl: acc.shareableServerUrl ?? current.shareableServerUrl ?? null }
                    : {}),
                ...(acc.shareableServerUrlValidatedAgainstServerUrl ?? current.shareableServerUrlValidatedAgainstServerUrl
                    ? {
                        shareableServerUrlValidatedAgainstServerUrl:
                            acc.shareableServerUrlValidatedAgainstServerUrl
                            ?? current.shareableServerUrlValidatedAgainstServerUrl
                            ?? null,
                    }
                    : {}),
                ...(acc.canonicalServerUrl ?? current.canonicalServerUrl ? { canonicalServerUrl: acc.canonicalServerUrl ?? current.canonicalServerUrl } : {}),
                ...(acc.publicServerUrl !== undefined || current.publicServerUrl !== undefined
                    ? { publicServerUrl: acc.publicServerUrl ?? current.publicServerUrl ?? null } : {}),
                ...coalesceIrohTransportFacts(group, acc),
            };
        }, preferred);

        const identityMetadata = mergeProfileIdentityMetadata(group, merged);

        next[merged.id] = {
            ...merged,
            ...identityMetadata,
            source: preserveDurablePersonalHomeClassification(group, merged.source),
        };

        for (const current of group) {
            if (current.id === merged.id) continue;
            idRewrite.set(current.id, merged.id);
        }
    }

    return { servers: next, idRewrite, changed };
}

function dedupeIdentityProfiles(params: Readonly<{
    servers: Record<string, ServerProfile>;
    sameOriginServerUrl: string | null;
    preferredServerId: string | null;
}>): Readonly<{
    servers: Record<string, ServerProfile>;
    idRewrite: Map<string, string>;
    changed: boolean;
}> {
    const groupsByIdentity = new Map<string, ServerProfile[]>();
    for (const profile of Object.values(params.servers)) {
        const identity = profile.serverIdentityId;
        if (!identity) continue;
        const group = groupsByIdentity.get(identity);
        if (group) group.push(profile);
        else groupsByIdentity.set(identity, [profile]);
    }

    let changed = false;
    const idRewrite = new Map<string, string>();
    const next: Record<string, ServerProfile> = { ...params.servers };

    for (const group of groupsByIdentity.values()) {
        if (group.length <= 1) continue;
        changed = true;

        const preferred = pickPreferredEquivalentProfile(group, {
            sameOriginServerUrl: params.sameOriginServerUrl,
            preferredServerId: params.preferredServerId,
        });
        const merged: ServerProfile = group.reduce<ServerProfile>((acc, current) => {
            if (current.id === acc.id) return acc;
            return {
                ...acc,
                createdAt: Math.min(acc.createdAt, current.createdAt),
                updatedAt: Math.max(acc.updatedAt, current.updatedAt),
                lastUsedAt: Math.max(acc.lastUsedAt, current.lastUsedAt),
                ...(acc.shareableServerUrl ?? current.shareableServerUrl
                    ? { shareableServerUrl: acc.shareableServerUrl ?? current.shareableServerUrl ?? null }
                    : {}),
                ...(acc.shareableServerUrlValidatedAgainstServerUrl ?? current.shareableServerUrlValidatedAgainstServerUrl
                    ? {
                        shareableServerUrlValidatedAgainstServerUrl:
                            acc.shareableServerUrlValidatedAgainstServerUrl
                            ?? current.shareableServerUrlValidatedAgainstServerUrl
                            ?? null,
                    }
                    : {}),
                ...(acc.canonicalServerUrl ?? current.canonicalServerUrl ? { canonicalServerUrl: acc.canonicalServerUrl ?? current.canonicalServerUrl } : {}),
                ...(acc.publicServerUrl !== undefined || current.publicServerUrl !== undefined
                    ? { publicServerUrl: acc.publicServerUrl ?? current.publicServerUrl ?? null } : {}),
                ...coalesceIrohTransportFacts(group, acc),
            };
        }, preferred);
        const identityMetadata = mergeProfileIdentityMetadata(group, merged);

        for (const current of group) {
            if (current.id !== merged.id) {
                delete next[current.id];
                idRewrite.set(current.id, merged.id);
            }
        }
        next[merged.id] = {
            ...merged,
            ...identityMetadata,
            source: preserveDurablePersonalHomeClassification(group, merged.source),
        };
    }

    return { servers: next, idRewrite, changed };
}

// Parse cache keyed by the raw persisted string: readPersistedState sits on hot selector
// paths and re-parsing the whole blob per call costs CPU and breaks referential stability.
// Keying by the raw value (re-read every call) stays correct for cross-tab and self-heal
// writes without invalidation wiring; local writes clear it explicitly.
let persistedStateParseCache: { raw: string; state: Required<PersistedServerState> } | null = null;

function parseAccountServiceEndpoint(value: unknown): AccountServiceEndpointV1 | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const url = typeof record.url === 'string' ? normalizeUrl(record.url) : '';
    const source = record.source;
    if (!url || source !== 'default' && source !== 'configured' && source !== 'user') return null;
    let parsed: URL;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const identity = normalizeServerIdentityId(record.serverIdentityId);
    if (Object.prototype.hasOwnProperty.call(record, 'serverIdentityId') && !identity) return null;
    return {
        url,
        ...(identity ? { serverIdentityId: identity } : {}),
        ...(typeof record.displayName === 'string' && record.displayName.trim() ? { displayName: record.displayName.trim() } : {}),
        source,
    };
}

function parseHomeViewState(value: unknown): HomeViewStateV1 | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (record.version !== 1) return null;
    const kind = record.activeTargetKind === 'server' || record.activeTargetKind === 'group'
        ? record.activeTargetKind : null;
    const id = typeof record.activeTargetId === 'string' && record.activeTargetId.trim()
        ? record.activeTargetId.trim() : null;
    return {
        version: 1,
        groups: normalizeStoredServerSelectionGroups(record.groups).map((group) => ({ ...group })),
        activeTargetKind: kind,
        activeTargetId: id,
    };
}

function rewriteHomeViewStateIdentity(state: HomeViewStateV1 | null, rewrites: ReadonlyMap<string, string>): HomeViewStateV1 | null {
    if (!state || rewrites.size === 0) return state;
    const rewrite = (id: string | null): string | null => id ? (rewrites.get(id) ?? id) : null;
    return {
        ...state,
        groups: normalizeStoredServerSelectionGroups(state.groups.map((group) => ({
            ...group,
            serverIds: group.serverIds.map((id) => rewrites.get(id) ?? id),
        }))),
        activeTargetId: state.activeTargetKind === 'server' ? rewrite(state.activeTargetId) : state.activeTargetId,
    };
}

/**
 * Corruption repair for an initialized (marker-present) `homeViewState`: normalized
 * empty groups and the current focused profile scope as target, or no target when no
 * focused profile exists. Never derived from scoped account settings.
 */
function createRepairedHomeViewState(
    servers: Readonly<Record<string, ServerProfile>>,
    activeServerId: string,
): HomeViewStateV1 {
    const focused = activeServerId ? servers[activeServerId] : null;
    const focusedScopeId = focused ? resolveServerProfileScopeId(focused) : null;
    return {
        version: 1,
        groups: [],
        activeTargetKind: focusedScopeId ? 'server' : null,
        activeTargetId: focusedScopeId,
    };
}

function addProfileScopeIdentityRewrites(
    rewrites: Map<string, string>,
    servers: Readonly<Record<string, ServerProfile>>,
): void {
    for (const profile of Object.values(servers)) {
        const scopeId = resolveServerProfileScopeId(profile);
        rewrites.set(profile.id, scopeId);
        for (const legacyId of profile.legacyServerIds ?? []) rewrites.set(legacyId, scopeId);
    }
}

function readPersistedState(
    options: Readonly<{ persistCanonicalization?: boolean }> = {},
): Required<PersistedServerState> {
    const raw = getPersistedStateStorage().getString(STATE_KEY);
    if (!raw) {
        const seeded = applyRuntimeSeedPolicy({});
        return {
            activeServerIdIsExplicit: false,
            activeServerId: resolvePrimaryActiveServerId(seeded, null),
            servers: seeded,
            accountServiceEndpoint: null,
            homeViewState: null,
            homeViewStateInitialized: false,
        };
    }
    if (persistedStateParseCache && persistedStateParseCache.raw === raw) {
        return persistedStateParseCache.state;
    }

    try {
        const parsed = JSON.parse(raw) as PersistedServerState;
        const serversRaw = parsed?.servers && typeof parsed.servers === 'object' ? parsed.servers : {};
        const servers: Record<string, ServerProfile> = {};
        for (const [id, value] of Object.entries(serversRaw)) {
            const profile = parseProfile(id, value);
            if (!profile) continue;
            servers[profile.id] = profile;
        }
        const desiredActive = normalizeServerId(parsed.activeServerId);
        const activeServerIdIsExplicit = parsed.activeServerIdIsExplicit === true;

        // Stable Home identity is authoritative. Deduplicate by identity first,
        // then use canonical URL only for remaining compatible legacy entries.
        const dedupedIdentity = dedupeIdentityProfiles({
            servers,
            sameOriginServerUrl: getWebSameOriginServerUrl(),
            preferredServerId: desiredActive,
        });
        const rewrittenAfterEquivalent =
            desiredActive && dedupedIdentity.idRewrite.has(desiredActive)
                ? dedupedIdentity.idRewrite.get(desiredActive)!
                : desiredActive;
        const deduped = dedupeEquivalentProfiles({
            servers: dedupedIdentity.servers,
            sameOriginServerUrl: getWebSameOriginServerUrl(),
            preferredServerId: rewrittenAfterEquivalent,
        });

        const rewrittenDesiredActive =
            rewrittenAfterEquivalent && deduped.idRewrite.has(rewrittenAfterEquivalent)
                ? deduped.idRewrite.get(rewrittenAfterEquivalent)!
                : rewrittenAfterEquivalent;
        const activeServerId = resolvePrimaryActiveServerId(deduped.servers, rewrittenDesiredActive);
        const accountServiceEndpoint = parseAccountServiceEndpoint(parsed.accountServiceEndpoint);
        const combinedIdRewrite = new Map<string, string>();
        for (const [from, intermediate] of dedupedIdentity.idRewrite) {
            combinedIdRewrite.set(from, deduped.idRewrite.get(intermediate) ?? intermediate);
        }
        for (const [from, to] of deduped.idRewrite) combinedIdRewrite.set(from, to);
        addProfileScopeIdentityRewrites(combinedIdRewrite, deduped.servers);
        const parsedHomeViewState = rewriteHomeViewStateIdentity(parseHomeViewState(parsed.homeViewState), combinedIdRewrite);

        // The initialization marker separates the legacy pre-marker world (missing/invalid
        // payload still permits the one-time scoped migration) from the initialized world
        // (marker + invalid payload is corruption: repair to the normalized focused
        // fallback and never consult stale scoped state again).
        const persistedHomeViewStateInitialized = parsed.homeViewStateInitialized === true;
        let homeViewState = parsedHomeViewState;
        let homeViewStateInitialized = persistedHomeViewStateInitialized;
        let needsHomeViewInitializationWrite = false;
        if (parsedHomeViewState === null) {
            if (persistedHomeViewStateInitialized) {
                homeViewState = createRepairedHomeViewState(deduped.servers, activeServerId);
                homeViewStateInitialized = true;
                needsHomeViewInitializationWrite = true;
            }
            // No marker: keep the store eligible for the legacy one-time migration.
        } else if (!persistedHomeViewStateInitialized) {
            // A valid pre-marker Home view state is preserved as-is; it acquires the
            // marker through this ordinary canonical read/write path.
            homeViewStateInitialized = true;
            needsHomeViewInitializationWrite = true;
        }

        const state: Required<PersistedServerState> = {
            activeServerIdIsExplicit,
            activeServerId,
            servers: deduped.servers,
            accountServiceEndpoint,
            homeViewState,
            homeViewStateInitialized,
        };

        if (dedupedIdentity.changed || deduped.changed || needsHomeViewInitializationWrite) {
            if (options.persistCanonicalization !== false) {
                writePersistedState(state);
            }
            // A read-only caller may inspect the canonical state, but must not
            // make that unpersisted projection the module cache. A later normal
            // read/adoption still owns the existing canonicalization write.
            return state;
        }

        persistedStateParseCache = { raw, state };
        return state;
    } catch {
        const seeded = applyRuntimeSeedPolicy({});
        return {
            activeServerIdIsExplicit: false,
            activeServerId: resolvePrimaryActiveServerId(seeded, null),
            servers: seeded,
            accountServiceEndpoint: null,
            homeViewState: null,
            homeViewStateInitialized: false,
        };
    }
}

function writePersistedState(state: Required<PersistedServerState>): void {
    const servers = Object.fromEntries(Object.entries(state.servers).map(([id, profile]) => {
        if (profile.source !== 'legacy' || !profile.legacySource) return [id, profile];
        const { legacySource, ...persisted } = profile;
        return [id, { ...persisted, source: legacySource }];
    }));
    getPersistedStateStorage().set(STATE_KEY, JSON.stringify({ ...state, servers }));
    // Invalidate rather than prime: the next read re-parses so the parse path stays the
    // single canonicalization owner for cached state shapes.
    persistedStateParseCache = null;
}

export function loadHomeViewState(): HomeViewStateV1 | null {
    return readPersistedState().homeViewState;
}

export function saveHomeViewState(state: HomeViewStateV1): void {
    const current = readPersistedState();
    const normalized = parseHomeViewState(state);
    if (!normalized) throw new Error('invalid Home view state');
    if (JSON.stringify(current.homeViewState) === JSON.stringify(normalized) && current.homeViewStateInitialized) return;
    // Any save is itself initialization evidence: write the marker so the legacy
    // one-time scoped migration can never re-run over this store.
    writePersistedState({ ...current, homeViewState: normalized, homeViewStateInitialized: true });
    emitHomeViewStateChanged();
}

export function updateHomeViewState(
    update: (current: HomeViewStateV1) => HomeViewStateV1,
): HomeViewStateV1 {
    const current = loadHomeViewState() ?? {
        version: 1,
        groups: [],
        activeTargetKind: null,
        activeTargetId: null,
    };
    saveHomeViewState(update(current));
    return loadHomeViewState() ?? current;
}

export function subscribeHomeViewState(listener: () => void): () => void {
    homeViewStateListeners.add(listener);
    ensureWebPersistedStateObserver();
    return () => {
        homeViewStateListeners.delete(listener);
    };
}

/** One-time migration from focused account settings into device-global server state. */
export function migrateHomeViewStateFromSettings(settings: Readonly<Record<string, unknown>>): HomeViewStateV1 | null {
    const existing = loadHomeViewState();
    if (existing) return existing;
    const state: HomeViewStateV1 = {
        version: 1,
        groups: normalizeStoredServerSelectionGroups(settings.serverSelectionGroups),
        activeTargetKind:
            settings.serverSelectionActiveTargetKind === 'server' || settings.serverSelectionActiveTargetKind === 'group'
                ? settings.serverSelectionActiveTargetKind : null,
        activeTargetId:
            typeof settings.serverSelectionActiveTargetId === 'string' && settings.serverSelectionActiveTargetId.trim()
                ? settings.serverSelectionActiveTargetId.trim() : null,
    };
    saveHomeViewState(state);
    return state;
}

function readTabActiveServerId(): string | null {
    if (!isWebRuntime()) return null;
    try {
        const value = (globalThis as any).sessionStorage?.getItem?.(SESSION_STORAGE_ACTIVE_ID_KEY);
        const normalized = typeof value === 'string' ? value.trim() : '';
        return normalizeServerId(normalized);
    } catch {
        return null;
    }
}

function writeTabActiveServerId(id: string | null): void {
    if (!isWebRuntime()) return;
    try {
        const sessionStorage = (globalThis as any).sessionStorage;
        if (!sessionStorage) return;
        if (id) sessionStorage.setItem(SESSION_STORAGE_ACTIVE_ID_KEY, id);
        else sessionStorage.removeItem(SESSION_STORAGE_ACTIVE_ID_KEY);
    } catch {
        // ignore
    }
}

function getWebSameOriginServerUrl(): string | null {
    if (!isWebRuntime()) return null;
    const origin = (globalThis as any).window?.location?.origin;
    if (!origin || origin === 'null') return null;
    try {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        // Official hosted web app (app.happier.dev) is a static SPA; the API lives on api.happier.dev.
        // When builds are missing EXPO_PUBLIC_HAPPIER_SERVER_URL (and legacy aliases), this prevents the default server
        // from incorrectly pointing at the web host.
        if (parsed.hostname.toLowerCase() === 'app.happier.dev') {
            return HAPPIER_CLOUD_SERVER_URL;
        }
        // In stack context, the UI can be served by an Expo/Metro dev server (e.g. http://localhost:8081).
        // Do not treat the UI origin as a relay server. Only allow same-origin fallback for stack-served
        // hosts (happier-<stack>.localhost).
        if (isStackContext()) {
            const host = parsed.hostname.toLowerCase();
            const isStackServedOrigin = host.startsWith('happier-') && host.endsWith('.localhost');
            if (!isStackServedOrigin) {
                return null;
            }
        }
        return origin;
    } catch {
        return null;
    }
}

function buildActiveSnapshotFromState(state: Required<PersistedServerState>): ActiveServerSnapshot {
    const tabId = readTabActiveServerId();
    const tabProfile = findProfileByServerIdentifier(state.servers, tabId);
    const tabExplicit = Boolean(tabProfile);
    const isSelectionExplicit = tabExplicit || state.activeServerIdIsExplicit === true;
    const selectedId = tabProfile
        ? tabProfile.id
        : resolvePrimaryActiveServerId(state.servers, state.activeServerId);
    const selected = selectedId ? state.servers[selectedId] : null;
    const sameOriginUrl = getWebSameOriginServerUrl();

    if (selected) {
        const runtimeLease = activeRuntimeOriginLease?.target.serverId === resolveServerProfileScopeId(selected)
            && activeRuntimeOriginLease.target.generation === activeServerGeneration
            ? activeRuntimeOriginLease
            : null;
        return {
            serverId: resolveServerProfileScopeId(selected),
            serverUrl: selected.canonicalServerUrl ?? selected.serverUrl,
            activeShareableServerUrl: selected.shareableServerUrl ?? null,
            activeShareableServerUrlValidatedAgainstServerUrl: selected.shareableServerUrlValidatedAgainstServerUrl ?? null,
            activeLocalRelayUrl: sameOriginUrl && comparableUrlKey(sameOriginUrl) !== comparableUrlKey(selected.serverUrl)
                ? sameOriginUrl
                : null,
            isSelectionExplicit,
            ...(selected.connectionDescriptorRevision === undefined
                ? {}
                : { connectionDescriptorRevision: selected.connectionDescriptorRevision }),
            ...(runtimeLease ? {
                runtimeOrigin: runtimeLease.runtimeOrigin,
                carrier: runtimeLease.carrier,
                ...(runtimeLease.irohObservedPath ? { irohObservedPath: runtimeLease.irohObservedPath } : {}),
                ...(runtimeLease.irohRelayPolicy ? { irohRelayPolicy: runtimeLease.irohRelayPolicy } : {}),
            } : {}),
            generation: activeServerGeneration,
        };
    }

    return {
        serverId: selectedId || '',
        serverUrl: sameOriginUrl ?? '',
        activeShareableServerUrl: null,
        activeShareableServerUrlValidatedAgainstServerUrl: null,
        activeLocalRelayUrl: sameOriginUrl,
        isSelectionExplicit,
        generation: activeServerGeneration,
    };
}

/** Capture the focused Home basis to which a native runtime-origin lease may publish. */
export function captureActiveServerRuntimeTarget(): ActiveServerRuntimeTarget {
    return {
        serverId: getActiveServerSnapshot().serverId,
        generation: activeServerGeneration,
    };
}

/** Publish only for the still-focused Home and make the native lease the clearing authority. */
export function publishActiveServerRuntimeOrigin(params: Readonly<{
    target: ActiveServerRuntimeTarget;
    leaseId: string;
    runtimeOrigin: string;
    carrier: 'https' | 'iroh';
    irohObservedPath?: IrohObservedPath;
    irohRelayPolicy?: IrohRelayPolicy;
}>): boolean {
    const runtimeOrigin = params.runtimeOrigin.trim();
    const leaseId = params.leaseId.trim();
    const current = captureActiveServerRuntimeTarget();
    if (!runtimeOrigin || !leaseId || current.serverId !== params.target.serverId || current.generation !== params.target.generation) {
        return false;
    }
    activeRuntimeOriginLease = {
        target: params.target,
        leaseId,
        runtimeOrigin,
        carrier: params.carrier,
        ...(params.carrier === 'iroh' && params.irohObservedPath
            ? { irohObservedPath: params.irohObservedPath }
            : {}),
        ...(params.carrier === 'iroh' && params.irohRelayPolicy
            ? { irohRelayPolicy: params.irohRelayPolicy }
            : {}),
    };
    activeServerSnapshotCache = null;
    const snapshot = getActiveServerSnapshot();
    for (const listener of activeServerListeners) listener(snapshot);
    for (const listener of runtimeOriginListeners) listener(snapshot);
    return true;
}

/** Clear only the runtime origin still owned by this focused-Home lease. */
export function releaseActiveServerRuntimeOrigin(params: Readonly<{
    target: ActiveServerRuntimeTarget;
    leaseId: string;
}>): boolean {
    const owner = activeRuntimeOriginLease;
    if (
        !owner
        || owner.leaseId !== params.leaseId
        || owner.target.serverId !== params.target.serverId
    ) {
        return false;
    }
    activeRuntimeOriginLease = null;
    activeServerSnapshotCache = null;
    const snapshot = getActiveServerSnapshot();
    for (const listener of activeServerListeners) listener(snapshot);
    for (const listener of runtimeOriginListeners) listener(snapshot);
    return true;
}

export function subscribeActiveServerRuntimeOrigin(listener: (snapshot: ActiveServerSnapshot) => void): () => void {
    runtimeOriginListeners.add(listener);
    return () => runtimeOriginListeners.delete(listener);
}

function getStableActiveServerSnapshot(next: ActiveServerSnapshot): ActiveServerSnapshot {
    const cached = activeServerSnapshotCache;
    if (
        cached
        && cached.serverId === next.serverId
        && cached.serverUrl === next.serverUrl
        && (cached.activeShareableServerUrl ?? null) === (next.activeShareableServerUrl ?? null)
        && (cached.activeShareableServerUrlValidatedAgainstServerUrl ?? null) === (next.activeShareableServerUrlValidatedAgainstServerUrl ?? null)
        && (cached.activeLocalRelayUrl ?? null) === (next.activeLocalRelayUrl ?? null)
        && (cached.runtimeOrigin ?? null) === (next.runtimeOrigin ?? null)
        && (cached.carrier ?? null) === (next.carrier ?? null)
        && (cached.irohObservedPath ?? null) === (next.irohObservedPath ?? null)
        && (cached.irohRelayPolicy ?? null) === (next.irohRelayPolicy ?? null)
        && (cached.connectionDescriptorRevision ?? null) === (next.connectionDescriptorRevision ?? null)
        && (cached.isSelectionExplicit ?? null) === (next.isSelectionExplicit ?? null)
        && cached.generation === next.generation
    ) {
        return cached;
    }
    activeServerSnapshotCache = next;
    return next;
}

function emitActiveServerChanged(
    previous: ActiveServerSnapshot | null,
    options: Readonly<{ force?: boolean; invalidateRuntimeOrigin?: boolean }> = {},
): void {
    let next = getActiveServerSnapshot();
    const targetChanged = Boolean(
        previous
        && (
            previous.serverId !== next.serverId
            || previous.serverUrl !== next.serverUrl
            || (previous.connectionDescriptorRevision ?? null) !== (next.connectionDescriptorRevision ?? null)
        )
    );
    const invalidateRuntimeOrigin = targetChanged || options.invalidateRuntimeOrigin === true;
    // A runtime origin belongs to one focused Home generation. Never carry an ephemeral
    // loopback listener across an active-profile/descriptor change; the native
    // lease is reacquired and publishes against the next authoritative generation.
    if (invalidateRuntimeOrigin) {
        activeRuntimeOriginLease = null;
        activeServerSnapshotCache = null;
        next = getActiveServerSnapshot();
    }
    const materiallyChanged = !previous
        || previous.serverId !== next.serverId
        || previous.serverUrl !== next.serverUrl
        || (previous.activeShareableServerUrl ?? null) !== (next.activeShareableServerUrl ?? null)
        || (previous.activeShareableServerUrlValidatedAgainstServerUrl ?? null) !== (next.activeShareableServerUrlValidatedAgainstServerUrl ?? null)
        || (previous.activeLocalRelayUrl ?? null) !== (next.activeLocalRelayUrl ?? null)
        || (previous.connectionDescriptorRevision ?? null) !== (next.connectionDescriptorRevision ?? null)
        || (previous.isSelectionExplicit ?? null) !== (next.isSelectionExplicit ?? null)
        || invalidateRuntimeOrigin;
    if (!materiallyChanged && !options.force) return;
    activeServerGeneration += 1;
    // Non-transport changes keep the existing publication owned by the same
    // single active generation instead of creating a parallel focus fence.
    if (activeRuntimeOriginLease) {
        activeRuntimeOriginLease = {
            ...activeRuntimeOriginLease,
            target: { ...activeRuntimeOriginLease.target, generation: activeServerGeneration },
        };
        activeServerSnapshotCache = null;
        next = getActiveServerSnapshot();
    }
    const emitted: ActiveServerSnapshot = getStableActiveServerSnapshot({ ...next, generation: activeServerGeneration });
    for (const listener of activeServerListeners) listener(emitted);
}

export function listServerProfiles(): ServerProfile[] {
    return Object.values(readPersistedState().servers);
}

export function getServerProfilesGeneration(): number {
    return serverProfilesGeneration;
}

export function subscribeServerProfiles(listener: (generation: number) => void): () => void {
    serverProfilesListeners.add(listener);
    ensureWebPersistedStateObserver();
    return () => {
        serverProfilesListeners.delete(listener);
    };
}

const accountServiceEndpointListeners = new Set<(endpoint: AccountServiceEndpointV1 | null) => void>();

export function getAccountServiceEndpointSnapshot(): AccountServiceEndpointV1 | null {
    return readPersistedState().accountServiceEndpoint ?? null;
}

export function subscribeAccountServiceEndpoint(listener: (endpoint: AccountServiceEndpointV1 | null) => void): () => void {
    accountServiceEndpointListeners.add(listener);
    ensureWebPersistedStateObserver();
    return () => accountServiceEndpointListeners.delete(listener);
}

export function setAccountServiceEndpoint(endpoint: AccountServiceEndpointV1): void {
    const parsed = parseAccountServiceEndpoint(endpoint);
    if (!parsed) throw new Error('Invalid Account Service endpoint');
    const state = readPersistedState();
    writePersistedState({ ...state, accountServiceEndpoint: parsed });
    for (const listener of accountServiceEndpointListeners) listener(parsed);
}

export function resetAccountServiceToDefault(): void {
    const state = readPersistedState();
    const endpoint: AccountServiceEndpointV1 = { url: HAPPIER_CLOUD_SERVER_URL, source: 'default', displayName: 'Happier Cloud' };
    writePersistedState({ ...state, accountServiceEndpoint: endpoint });
    for (const listener of accountServiceEndpointListeners) listener(endpoint);
}

/**
 * Composes the canonical connection descriptor of a Home profile from stable persisted
 * state only. This is the single descriptor composer for QR producers: the adopted Iroh
 * endpoint rides along when present, an HTTPS endpoint is advertised only when a real
 * public HTTPS ingress exists for an Iroh-capable (typically loopback) Home, and ordinary
 * non-Iroh Homes keep their reachable canonical HTTPS endpoint. `runtimeOrigin` and
 * ephemeral tunnel ports are runtime-only request state and can never enter a descriptor.
 * Returns null when the profile has no stable Home identity/audience to compose from.
 */
export function buildHomeConnectionDescriptorForProfile(profile: ServerProfile): HomeConnectionDescriptorV1 | null {
    const identity = normalizeServerIdentityId(profile.serverIdentityId);
    if (!identity) return null;
    const canonicalServerUrl = (profile.canonicalServerUrl ?? profile.serverUrl ?? '').trim().replace(/\/+$/, '');
    if (!canonicalServerUrl) return null;
    const publicHttpsUrl = typeof profile.publicServerUrl === 'string'
        && /^https:\/\//i.test(profile.publicServerUrl.trim())
        ? profile.publicServerUrl.trim().replace(/\/+$/, '')
        : '';
    const endpoints: HomeConnectionDescriptorV1['endpoints'] = [];
    if (profile.irohEndpoint) {
        const { endpointId, relayUrls, directAddresses } = profile.irohEndpoint;
        endpoints.push({
            kind: 'iroh',
            endpointId,
            ...(relayUrls ? { relayUrls: [...relayUrls] } : {}),
            ...(directAddresses ? { directAddresses: [...directAddresses] } : {}),
        });
        // A loopback-only Iroh Home has no HTTPS ingress: advertise HTTPS only for a real
        // public endpoint instead of falsely claiming the loopback canonical audience.
        if (publicHttpsUrl) endpoints.push({ kind: 'https', url: publicHttpsUrl });
    } else {
        // Non-Iroh Homes keep the current reachable HTTPS behavior under the existing
        // canonical/public rules: the stable canonical URL is the advertised endpoint.
        endpoints.push({ kind: 'https', url: canonicalServerUrl });
    }
    return {
        v: 1,
        homeServerIdentityId: identity,
        canonicalServerUrl,
        revision: profile.connectionDescriptorRevision ?? 1,
        endpoints,
    };
}

type HomeProfileAdoptionParams = Readonly<{
    descriptor: HomeConnectionDescriptorV1 | LegacyManualHomeDescriptor;
    source: ServerProfileSource;
    preserveUserLabel?: boolean;
    suggestedName?: string;
}>;

export type HomeProfileAdoptionPreflight = Readonly<{
    canonicalServerUrl: string;
    serverIdentityId: string | null;
}>;

type ResolvedHomeProfileAdoption = Readonly<{
    descriptor: HomeConnectionDescriptorV1 | LegacyManualHomeDescriptor;
    canonicalServerUrl: string;
    serverIdentityId: string | null;
    state: Required<PersistedServerState>;
    existing: ServerProfile | null;
}>;

function resolveHomeProfileAdoption(
    params: HomeProfileAdoptionParams,
    options: Readonly<{ persistCanonicalization?: boolean }> = {},
): ResolvedHomeProfileAdoption {
    let descriptor = params.descriptor;
    if (!descriptor || typeof descriptor !== 'object') {
        throw new Error('Invalid Home connection descriptor');
    }
    const strictDescriptor = params.source === 'qr' || params.source === 'account-directory';
    if (strictDescriptor) {
        const parsed = HomeConnectionDescriptorV1Schema.safeParse(descriptor);
        if (!parsed.success) throw new Error('Invalid Home connection descriptor');
        descriptor = parsed.data;
    }
    const endpointUrl = 'endpoints' in descriptor
        ? descriptor.endpoints.find((endpoint) => endpoint.kind === 'https')?.url
        : undefined;
    // canonicalServerUrl is the stable auth/profile origin; serverUrl is retained
    // only as a legacy/manual alias when no canonical value is supplied.
    const url = normalizeUrl(descriptor.canonicalServerUrl ?? ('serverUrl' in descriptor ? descriptor.serverUrl : undefined) ?? endpointUrl ?? '');
    if (!url) throw new Error('Invalid Home connection URL');
    const identity = normalizeServerIdentityId(descriptor.homeServerIdentityId);
    if (strictDescriptor && (!identity || !normalizeUrl(descriptor.canonicalServerUrl ?? ''))) {
        throw new Error('Home identity is required for strict adoption');
    }
    const state = readPersistedState(options);
    const byIdentity = identity ? Object.values(state.servers).filter((p) => p.serverIdentityId === identity || (p.legacyServerIds ?? []).includes(identity)) : [];
    const byUrlProfiles = findProfilesByEquivalentUrl(state.servers, normalizeUrl(descriptor.canonicalServerUrl ?? url));
    const byUrl = byUrlProfiles[0] ?? null;
    if (identity && byIdentity.length > 1) throw new Error('Ambiguous Home identity');
    if (identity && byUrlProfiles.some((profile) => (
        (profile.serverIdentityId && profile.serverIdentityId !== identity)
        || (byIdentity.length === 1 && profile.id !== byIdentity[0]!.id)
    ))) throw new Error('Home identity conflicts with URL');
    return {
        descriptor,
        canonicalServerUrl: url,
        serverIdentityId: identity,
        state,
        existing: byIdentity[0] ?? byUrl,
    };
}

/**
 * Read-only adoption validation for authority-bearing callers that must verify
 * the exact Home target before an asynchronous credential write. The mutating
 * owner reuses the same resolver and therefore revalidates before persistence.
 */
export function preflightHomeProfileAdoption(
    params: HomeProfileAdoptionParams,
): HomeProfileAdoptionPreflight {
    const resolved = resolveHomeProfileAdoption(params, {
        persistCanonicalization: false,
    });
    return {
        canonicalServerUrl: resolved.canonicalServerUrl,
        serverIdentityId: resolved.serverIdentityId,
    };
}

export async function adoptHomeProfile(params: HomeProfileAdoptionParams): Promise<ServerProfile> {
    const {
        descriptor,
        canonicalServerUrl: url,
        serverIdentityId: identity,
        state,
        existing,
    } = resolveHomeProfileAdoption(params);
    const displayNameRaw = ('displayName' in descriptor ? descriptor.displayName : undefined)
        ?? params.suggestedName;
    const displayName = typeof displayNameRaw === 'string' && displayNameRaw.trim()
        ? displayNameRaw.trim()
        : undefined;
    const profile = existing ?? buildUpsertedServerProfile(state, {
        serverUrl: url,
        name: displayName,
        source: params.source,
        replaceEquivalentStoredUrl: true,
    });
    // The Iroh endpoint sub-descriptor and revision ride on the profile so the
    // transport identity survives restart/focus changes. They are refreshed on
    // every authoritative descriptor adoption and cleared when that descriptor
    // no longer advertises an Iroh endpoint. They never alter the stable
    // canonical URL.
    const descriptorEndpoints = 'endpoints' in descriptor ? descriptor.endpoints : undefined;
    const adoptedPublicEndpoint = descriptorEndpoints?.find((endpoint) => endpoint.kind === 'https');
    const candidateIrohEndpoint = descriptorEndpoints?.find(
        (endpoint): endpoint is Extract<typeof endpoint, { kind: 'iroh' }> => endpoint.kind === 'iroh',
    );
    // Every candidate Iroh endpoint passes through the one canonical parser —
    // including non-strict sources whose runtime descriptor objects may carry
    // untrusted endpoint shapes. Malformed candidates are treated as absent.
    let adoptedIrohEndpoint: IrohEndpointDescriptorV1 | undefined;
    try {
        adoptedIrohEndpoint = candidateIrohEndpoint
            ? parseIrohEndpointDescriptorV1({
                endpointId: candidateIrohEndpoint.endpointId,
                ...(Array.isArray(candidateIrohEndpoint.relayUrls) ? { relayUrls: candidateIrohEndpoint.relayUrls } : {}),
                ...(Array.isArray(candidateIrohEndpoint.directAddresses) ? { directAddresses: candidateIrohEndpoint.directAddresses } : {}),
            })
            : undefined;
    } catch {
        adoptedIrohEndpoint = undefined;
    }
    const descriptorRevision = 'revision' in descriptor
        && Number.isInteger(descriptor.revision)
        && descriptor.revision > 0
        ? descriptor.revision
        : undefined;
    // Revisioned descriptor snapshots are monotonic at this single writer. Only
    // a strictly newer generation may replace snapshot-owned identity/transport
    // facts; equal is idempotent and lower is stale. Revision-less manual/legacy
    // adoption retains its established classification behavior but has no
    // authority over persisted revisioned transport facts.
    const acceptsDescriptorSnapshot = descriptorRevision === undefined
        || profile.connectionDescriptorRevision === undefined
        || descriptorRevision > profile.connectionDescriptorRevision;
    const transportFacts = descriptorRevision === undefined || !acceptsDescriptorSnapshot
        ? {}
        : {
            ...(adoptedIrohEndpoint
                ? {
                    irohEndpoint: {
                        endpointId: adoptedIrohEndpoint.endpointId,
                        ...(adoptedIrohEndpoint.relayUrls ? { relayUrls: [...adoptedIrohEndpoint.relayUrls] } : {}),
                        ...(adoptedIrohEndpoint.directAddresses ? { directAddresses: [...adoptedIrohEndpoint.directAddresses] } : {}),
                    },
                }
                : { irohEndpoint: undefined }),
            connectionDescriptorRevision: descriptorRevision,
        };
    const publicEndpointFacts = descriptorRevision !== undefined
        ? acceptsDescriptorSnapshot
            ? { publicServerUrl: adoptedPublicEndpoint ? normalizeUrl(adoptedPublicEndpoint.url) : null }
            : {}
        : 'publicServerUrl' in descriptor && descriptor.publicServerUrl === null
            ? { publicServerUrl: null }
            : 'publicServerUrl' in descriptor && descriptor.publicServerUrl
                ? { publicServerUrl: normalizeUrl(descriptor.publicServerUrl) }
                : {};
    const updated: ServerProfile = {
        ...profile,
        // Personal Home source is the durable first-run completion classification.
        // Later QR/Directory/manual descriptor refreshes may update connection facts,
        // but must not reopen Desktop bootstrap by relabelling the profile.
        ...(acceptsDescriptorSnapshot
            ? {
                source: preserveDurablePersonalHomeClassification([profile], params.source),
                legacySource: undefined,
                ...(existing ? { serverUrl: url } : {}),
                ...((!existing || !params.preserveUserLabel) && displayName
                    ? { name: displayName }
                    : {}),
                ...(identity ? { serverIdentityId: identity } : {}),
                ...(descriptor.canonicalServerUrl ? { canonicalServerUrl: normalizeUrl(descriptor.canonicalServerUrl) } : {}),
            }
            : {}),
        ...publicEndpointFacts,
        ...transportFacts,
    };
    if (!existing || JSON.stringify(updated) !== JSON.stringify(profile)) {
        const previousSnapshot = getActiveServerSnapshot();
        const next = { ...state, servers: { ...state.servers, [updated.id]: updated } };
        writePersistedState(next);
        emitServerProfilesChanged();
        emitActiveServerChanged(previousSnapshot, {
            force: true,
            invalidateRuntimeOrigin: previousSnapshot.serverId === resolveServerProfileScopeId(updated),
        });
    }
    return updated;
}

export function getServerProfileById(idRaw: string): ServerProfile | null {
    const id = normalizeServerId(idRaw);
    if (!id) return null;
    return findProfileByServerIdentifier(readPersistedState().servers, id);
}

/**
 * Resolves only a portable server identity to the current device-local profile
 * that can be used for routing. Profile ids themselves are intentionally not
 * accepted here: they must never be promoted into Account-synced selections.
 */
export function resolveServerProfileForPortableIdentity(
    serverIdentityIdRaw: string | null | undefined,
): PortableServerIdentityProfileResolution {
    const serverIdentityId = normalizeServerIdentityId(serverIdentityIdRaw) ?? '';
    if (!serverIdentityId) {
        return { kind: 'missing', serverIdentityId: '' };
    }

    const profiles = Object.values(readPersistedState().servers);
    const matchingProfiles = profiles.filter((profile) => (
        profile.serverIdentityId === serverIdentityId
        || (profile.legacyServerIds ?? []).includes(serverIdentityId)
    ));
    if (matchingProfiles.length === 1) {
        return {
            kind: 'resolved',
            serverIdentityId,
            profile: matchingProfiles[0]!,
        };
    }
    if (matchingProfiles.length > 1) {
        return {
            kind: 'ambiguous',
            serverIdentityId,
            profiles: matchingProfiles,
        };
    }
    return { kind: 'missing', serverIdentityId };
}

export function resolveServerProfileScopeIdForIdentifier(idRaw: string | null | undefined): string {
    const id = normalizeServerId(idRaw);
    if (!id) return '';
    const profile = findProfileByServerIdentifier(readPersistedState().servers, id);
    return profile ? resolveServerProfileScopeId(profile) : id;
}

export function areServerProfileIdentifiersEquivalent(
    leftRaw: string | null | undefined,
    rightRaw: string | null | undefined,
): boolean {
    const left = normalizeServerId(leftRaw);
    const right = normalizeServerId(rightRaw);
    if (!left || !right) return false;
    if (left === right) return true;

    const state = readPersistedState();
    const leftProfile = findProfileByServerIdentifier(state.servers, left);
    if (!leftProfile) return false;
    const rightProfile = findProfileByServerIdentifier(state.servers, right);
    return Boolean(rightProfile && rightProfile.id === leftProfile.id);
}

type UpsertServerProfileParams = Readonly<{
    serverUrl: string;
    name?: string;
    source?: ServerProfileSource;
    replaceEquivalentStoredUrl?: boolean;
}>;

function buildUpsertedServerProfile(
    state: Required<PersistedServerState>,
    params: UpsertServerProfileParams,
): ServerProfile {
    const url = normalizeUrl(params.serverUrl);
    if (!url) throw new Error('serverUrl is required');

    const existingEquivalent = findProfileByEquivalentUrl(state.servers, url);
    const id = existingEquivalent?.id
        ?? createUniqueServerId(state.servers, deriveServerIdFromUrl(url), url);
    const existing = state.servers[id];
    const now = nowMs();

    const profile: ServerProfile = {
        id,
        name: String(
            existingEquivalent?.name
            ?? params.name
            ?? existing?.name
            ?? defaultServerNameFromUrl(url)
            ?? id,
        ).trim() || id,
        serverUrl:
            existingEquivalent && params.replaceEquivalentStoredUrl !== true
                ? existingEquivalent.serverUrl
                : url,
        ...(existingEquivalent?.shareableServerUrl
            ? { shareableServerUrl: existingEquivalent.shareableServerUrl }
            : existing?.shareableServerUrl
                ? { shareableServerUrl: existing.shareableServerUrl }
                : {}),
        ...(existingEquivalent?.shareableServerUrlValidatedAgainstServerUrl
            ? { shareableServerUrlValidatedAgainstServerUrl: existingEquivalent.shareableServerUrlValidatedAgainstServerUrl }
            : existing?.shareableServerUrlValidatedAgainstServerUrl
                ? { shareableServerUrlValidatedAgainstServerUrl: existing.shareableServerUrlValidatedAgainstServerUrl }
                : {}),
        ...(existingEquivalent?.serverIdentityId ?? existing?.serverIdentityId
            ? { serverIdentityId: existingEquivalent?.serverIdentityId ?? existing?.serverIdentityId ?? null }
            : {}),
        ...(existingEquivalent?.canonicalServerUrl ?? existing?.canonicalServerUrl
            ? { canonicalServerUrl: existingEquivalent?.canonicalServerUrl ?? existing?.canonicalServerUrl }
            : {}),
        ...(existingEquivalent?.publicServerUrl !== undefined || existing?.publicServerUrl !== undefined
            ? { publicServerUrl: existingEquivalent?.publicServerUrl ?? existing?.publicServerUrl ?? null }
            : {}),
        ...(existingEquivalent?.irohEndpoint ?? existing?.irohEndpoint
            ? { irohEndpoint: existingEquivalent?.irohEndpoint ?? existing?.irohEndpoint }
            : {}),
        ...(existingEquivalent?.connectionDescriptorRevision !== undefined || existing?.connectionDescriptorRevision !== undefined
            ? { connectionDescriptorRevision: existingEquivalent?.connectionDescriptorRevision ?? existing?.connectionDescriptorRevision }
            : {}),
        ...((existingEquivalent?.legacyServerIds ?? existing?.legacyServerIds)?.length
            ? { legacyServerIds: existingEquivalent?.legacyServerIds ?? existing?.legacyServerIds ?? [] }
            : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: existing?.lastUsedAt ?? 0,
        source: preserveDurablePersonalHomeClassification(
            [existingEquivalent, existing].filter((value): value is ServerProfile => value != null),
            params.source ?? existingEquivalent?.source ?? existing?.source ?? 'manual',
        ),
        ...(existing?.legacySource ? { legacySource: existing.legacySource } : {}),
    };

    return profile;
}

export function upsertServerProfile(params: UpsertServerProfileParams): ServerProfile {
    const state = readPersistedState();
    const profile = buildUpsertedServerProfile(state, params);

    const previousSnapshot = getActiveServerSnapshot();
    writePersistedState({
        ...state,
        servers: {
            ...state.servers,
            [profile.id]: profile,
        },
    });
    emitServerProfilesChanged();
    emitActiveServerChanged(previousSnapshot, { force: true });
    return profile;
}

export function getOrCreateHappierCloudServerProfile(): ServerProfile {
    const state = readPersistedState();
    const existing = findProfileByEquivalentUrl(state.servers, HAPPIER_CLOUD_SERVER_URL);
    if (existing) return existing;

    return upsertServerProfile({
        serverUrl: HAPPIER_CLOUD_SERVER_URL,
        name: 'Happier Cloud',
        source: 'preconfigured',
    });
}

export function setServerProfileIdentityForUrl(serverUrlRaw: string, identityRaw: string | null | undefined): ServerProfile | null {
    const url = normalizeUrl(serverUrlRaw);
    const serverIdentityId = normalizeServerIdentityId(identityRaw);
    if (!url || !serverIdentityId) return null;

    const state = readPersistedState();
    const existing = findProfileByEquivalentUrl(state.servers, url);
    const hasCompetingIdentityProfile = Object.values(state.servers).some((profile) => (
        profile.id !== existing?.id
        && (
            profile.serverIdentityId === serverIdentityId
            || comparableUrlKey(profile.serverUrl) === comparableUrlKey(url)
        )
    ));
    if (
        existing?.serverIdentityId === serverIdentityId
        && !hasCompetingIdentityProfile
    ) {
        return existing;
    }
    const id = existing?.id ?? createUniqueServerId(state.servers, deriveServerIdFromUrl(url), url);
    const now = nowMs();
    const profile: ServerProfile = {
        id,
        name: existing?.name ?? defaultServerNameFromUrl(url) ?? id,
        serverUrl: existing?.serverUrl ?? url,
        ...(existing?.shareableServerUrl ? { shareableServerUrl: existing.shareableServerUrl } : {}),
        ...(existing?.shareableServerUrlValidatedAgainstServerUrl
            ? { shareableServerUrlValidatedAgainstServerUrl: existing.shareableServerUrlValidatedAgainstServerUrl }
            : {}),
        serverIdentityId,
        legacyServerIds: uniqueServerIds([...(existing?.legacyServerIds ?? []), existing?.serverIdentityId, id]).filter(
            (legacyId) => legacyId !== serverIdentityId,
        ),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: existing?.lastUsedAt ?? 0,
        source: existing?.source ?? 'url',
        ...(existing?.legacySource ? { legacySource: existing.legacySource } : {}),
    };

    const previousSnapshot = getActiveServerSnapshot();
    const withIdentity: Record<string, ServerProfile> = {
        ...state.servers,
        [id]: profile,
    };
    const deduped = dedupeIdentityProfiles({
        servers: withIdentity,
        sameOriginServerUrl: getWebSameOriginServerUrl(),
        preferredServerId: state.activeServerId,
    });
    const activeServerId =
        deduped.idRewrite.has(state.activeServerId)
            ? deduped.idRewrite.get(state.activeServerId)!
            : resolvePrimaryActiveServerId(deduped.servers, state.activeServerId);
    const tabId = readTabActiveServerId();
    if (tabId && deduped.idRewrite.has(tabId)) {
        writeTabActiveServerId(deduped.idRewrite.get(tabId)!);
    }

    const selectionRewrites = new Map(deduped.idRewrite);
    addProfileScopeIdentityRewrites(selectionRewrites, deduped.servers);
    const nextState: Required<PersistedServerState> = {
        ...state,
        activeServerId,
        servers: deduped.servers,
        homeViewState: rewriteHomeViewStateIdentity(state.homeViewState, selectionRewrites),
    };
    writePersistedState(nextState);
    if (nextState.homeViewState !== state.homeViewState) emitHomeViewStateChanged();
    emitServerProfilesChanged();
    emitActiveServerChanged(previousSnapshot, { force: true });
    return findProfileByServerIdentifier(nextState.servers, serverIdentityId);
}

export function getServerProfileLegacyServerIds(idRaw: string): string[] {
    const state = readPersistedState();
    const profile = findProfileByServerIdentifier(state.servers, idRaw);
    if (!profile) return [];
    return uniqueServerIds([
        profile.id,
        ...(profile.legacyServerIds ?? []),
    ]).filter((id) => id !== profile.serverIdentityId);
}

export function setActiveServerId(
    idRaw: string,
    opts: Readonly<{ scope: 'tab' | 'device' }> = { scope: 'device' },
): void {
    const id = normalizeServerId(idRaw);
    if (!id) throw new Error('server id is required');

    const state = readPersistedState();
    const profile = findProfileByServerIdentifier(state.servers, id);
    if (!profile) {
        if (opts.scope === 'tab') {
            const previousSnapshot = getActiveServerSnapshot();
            writeTabActiveServerId(null);
            emitActiveServerChanged(previousSnapshot, { force: true });
        }
        return;
    }

    const previousSnapshot = getActiveServerSnapshot();
    if (opts.scope === 'tab') {
        writeTabActiveServerId(profile.id);
        emitActiveServerChanged(previousSnapshot, { force: true });
        return;
    }

    const now = nowMs();
    const existing = state.servers[profile.id]!;
    writePersistedState({
        ...state,
        activeServerIdIsExplicit: true,
        activeServerId: profile.id,
        servers: {
            ...state.servers,
            [profile.id]: { ...existing, lastUsedAt: now, updatedAt: now },
        },
    });
    emitServerProfilesChanged();
    emitActiveServerChanged(previousSnapshot, { force: true });
}

/**
 * Makes a newly adopted local Home the implicit default only while no user-owned
 * device or tab selection exists. This is the one first-local activation policy;
 * ordinary profile adoption remains non-focusing.
 */
export function activateServerProfileIfSelectionImplicit(idRaw: string): boolean {
    const id = normalizeServerId(idRaw);
    if (!id) return false;
    const state = readPersistedState();
    const profile = findProfileByServerIdentifier(state.servers, id);
    if (!profile || state.activeServerIdIsExplicit || findProfileByServerIdentifier(state.servers, readTabActiveServerId())) {
        return false;
    }
    if (state.activeServerId === profile.id) return true;

    const previousSnapshot = getActiveServerSnapshot();
    writePersistedState({
        ...state,
        activeServerId: profile.id,
        activeServerIdIsExplicit: false,
    });
    emitActiveServerChanged(previousSnapshot, { force: true });
    return true;
}

export function getResetToDefaultServerId(): string {
    const state = readPersistedState();
    const preconfiguredId = getPrimaryPreconfiguredServerId(state.servers);
    if (preconfiguredId) return preconfiguredId;
    return Object.keys(state.servers)[0] ?? '';
}

export function getTabActiveServerId(): string | null {
    return readTabActiveServerId();
}

export function clearTabActiveServerId(): void {
    if (!readTabActiveServerId()) return;
    const previousSnapshot = getActiveServerSnapshot();
    writeTabActiveServerId(null);
    emitActiveServerChanged(previousSnapshot, { force: true });
}

export function getDeviceDefaultServerId(): string {
    const state = readPersistedState();
    return resolvePrimaryActiveServerId(state.servers, state.activeServerId);
}

export function getDeviceDefaultServerScopeId(): string {
    const state = readPersistedState();
    const profileId = resolvePrimaryActiveServerId(state.servers, state.activeServerId);
    const profile = profileId ? state.servers[profileId] : null;
    return profile ? resolveServerProfileScopeId(profile) : profileId;
}

export function getActiveServerId(): string {
    return getActiveServerSnapshot().serverId;
}

export function isActiveServerSelectionExplicit(): boolean {
    const state = readPersistedState();
    const tab = readTabActiveServerId();
    if (findProfileByServerIdentifier(state.servers, tab)) return true;
    return state.activeServerIdIsExplicit === true;
}

export function getActiveServerUrl(): string {
    const state = readPersistedState();
    const tab = readTabActiveServerId();
    const tabProfile = findProfileByServerIdentifier(state.servers, tab);
    if (tabProfile) return tabProfile.canonicalServerUrl ?? tabProfile.serverUrl;

    const explicit = findProfileByServerIdentifier(state.servers, state.activeServerId);
    if (state.activeServerIdIsExplicit && explicit) {
        return explicit.canonicalServerUrl ?? explicit.serverUrl;
    }

    const fallbackId = resolvePrimaryActiveServerId(state.servers, state.activeServerId);
    if (fallbackId && state.servers[fallbackId]) return state.servers[fallbackId]!.canonicalServerUrl ?? state.servers[fallbackId]!.serverUrl;

    const sameOrigin = getWebSameOriginServerUrl();
    if (sameOrigin) return sameOrigin;

    return '';
}

export function getActiveServerSnapshot(): ActiveServerSnapshot {
    const state = readPersistedState();
    return getStableActiveServerSnapshot(buildActiveSnapshotFromState(state));
}

export function subscribeActiveServer(listener: (snapshot: ActiveServerSnapshot) => void): () => void {
    activeServerListeners.add(listener);
    ensureWebPersistedStateObserver();
    return () => {
        activeServerListeners.delete(listener);
    };
}

export function removeServerProfile(idRaw: string): void {
    const id = normalizeServerId(idRaw);
    if (!id) throw new Error('server id is required');

    const state = readPersistedState();
    if (!(id in state.servers)) throw new Error(`Server profile not found: ${id}`);

    const previousSnapshot = getActiveServerSnapshot();
    const { [id]: removed, ...rest } = state.servers;
    const nextActive = state.activeServerId === id
        ? resolvePrimaryActiveServerId(rest, null)
        : resolvePrimaryActiveServerId(rest, state.activeServerId);
    const tab = readTabActiveServerId();
    if (tab === id) writeTabActiveServerId(null);

    const removedIds = new Set(uniqueServerIds([
        removed.id,
        removed.serverIdentityId,
        ...(removed.legacyServerIds ?? []),
    ]));
    const remainingIds = new Set(Object.values(rest).map(resolveServerProfileScopeId));
    const groups = (state.homeViewState?.groups ?? [])
        .map((group) => ({
            ...group,
            serverIds: group.serverIds.filter((serverId) => !removedIds.has(serverId) && remainingIds.has(serverId)),
        }))
        .filter((group) => group.serverIds.length > 0);
    const removedWasActiveTarget = state.homeViewState?.activeTargetKind === 'server'
        && state.homeViewState.activeTargetId !== null
        && removedIds.has(state.homeViewState.activeTargetId);
    const activeGroupStillExists = state.homeViewState?.activeTargetKind !== 'group'
        || groups.some((group) => group.id === state.homeViewState?.activeTargetId);
    const fallbackTargetId = nextActive ? resolveServerProfileScopeId(rest[nextActive]!) : null;
    const nextHomeViewState = state.homeViewState
        ? {
            ...state.homeViewState,
            groups,
            ...((removedWasActiveTarget || !activeGroupStillExists)
                ? {
                    activeTargetKind: fallbackTargetId ? 'server' as const : null,
                    activeTargetId: fallbackTargetId,
                }
                : {}),
        }
        : null;

    writePersistedState({
        ...state,
        activeServerId: nextActive,
        activeServerIdIsExplicit: true,
        servers: rest,
        homeViewState: nextHomeViewState,
    });
    if (nextHomeViewState !== state.homeViewState) emitHomeViewStateChanged();
    emitServerProfilesChanged();
    emitActiveServerChanged(previousSnapshot, { force: true });
}

export function renameServerProfile(idRaw: string, nameRaw: string): void {
    const id = normalizeServerId(idRaw);
    const name = String(nameRaw ?? '').trim();
    if (!id) throw new Error('server id is required');
    if (!name) throw new Error('server name is required');

    const state = readPersistedState();
    const existing = state.servers[id];
    if (!existing) throw new Error(`Server profile not found: ${id}`);

    const previousSnapshot = getActiveServerSnapshot();
    const now = nowMs();
    const updated: ServerProfile = {
        ...existing,
        name,
        updatedAt: now,
    };
    writePersistedState({
        ...state,
        servers: {
            ...state.servers,
            [id]: updated,
        },
    });
    emitServerProfilesChanged();
    emitActiveServerChanged(previousSnapshot, { force: true });
}

export function setServerProfileShareableUrl(
    idRaw: string,
    shareableServerUrl: string | null | undefined,
    options: Readonly<{ validatedAgainstServerUrl?: string | null | undefined }> = {},
): void {
    const id = normalizeServerId(idRaw);
    if (!id) return;

    const normalized = sanitizeServerUrlForShareableLink(shareableServerUrl ?? null);
    const validatedAgainstServerUrl = normalized
        ? normalizeUrl(String(options.validatedAgainstServerUrl ?? '')) || null
        : null;
    const state = readPersistedState();
    const existing = state.servers[id];
    if (!existing) return;
    if (
        (existing.shareableServerUrl ?? null) === normalized
        && (existing.shareableServerUrlValidatedAgainstServerUrl ?? null) === validatedAgainstServerUrl
    ) return;

    const previousSnapshot = getActiveServerSnapshot();
    writePersistedState({
        ...state,
        servers: {
            ...state.servers,
            [id]: {
                ...existing,
                shareableServerUrl: normalized,
                shareableServerUrlValidatedAgainstServerUrl: validatedAgainstServerUrl,
                updatedAt: nowMs(),
            },
        },
    });
    emitServerProfilesChanged();
    emitActiveServerChanged(previousSnapshot, { force: true });
}
