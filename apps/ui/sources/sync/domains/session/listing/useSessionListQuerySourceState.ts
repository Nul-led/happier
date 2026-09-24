import * as React from 'react';
import { featureRequiresServerSnapshot, type FeatureId, type SessionListQueryV1 } from '@happier-dev/protocol';

import {
    useMachineListByServerId,
    useMachineListStatusByServerId,
    useOrdinarySessionListMembershipByServerId,
    useSessionListRowsByServerId,
    useSettings,
    useSocketStatus,
} from '@/sync/domains/state/storage';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { buildMachineDisplaysByIdFromMachineList, buildSessionListIndexWithServerScope } from '@/sync/store/sessionListIndex/buildSessionListIndexWithServerScope';
import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import type { SessionListRenderableSession } from './sessionListRenderable';
import type { SessionAddress } from '../sessionAddress';
import {
    resolveRuntimeFeatureDecisionFromSnapshot,
    useServerFeaturesMainSelectionSnapshot,
    type ServerFeaturesMainSelectionSnapshot,
} from '@/sync/domains/features/featureDecisionRuntime';
import type { FeatureLocalPolicySettings } from '@/sync/domains/features/featureLocalPolicy';
import { useFeatureLocalPolicySettings } from '@/hooks/server/useFeatureLocalPolicySettings';
import {
    useServerCredentialAccountScopes,
    type ServerCredentialAccountScopeBinding,
} from '@/sync/domains/scope/useServerCredentialAccountScopes';

import {
    createSessionListQueryHomeController,
    type SessionListOrdinaryPageAdapter,
    type SessionListQueryHomeController,
    type SessionListQueryHomeState,
} from './sessionListQueryController';
import {
    fetchSessionListQueryPageForHome,
    getSessionListQueryHomeAvailability,
    loadNextOrdinarySessionListPage,
    readOrdinarySessionListHomeState,
    refreshOrdinarySessionList,
    resolveOrdinarySessionListHomeOwner,
    retrySessionListQueryHome,
} from './sessionListQueryRuntime';
import { buildSessionListQueryKey } from './sessionListQueryKey';
import { subscribeSessionListQueryHomeInvalidation } from './sessionListQueryInvalidation';
import { isSessionListQueryHomeCoverageComplete } from './sessionListHomeObservation';

export type SessionListQueryHomeInput = Readonly<{
    serverId: string;
    /**
     * Derived corpus identity. Callers may pass the value produced by
     * `buildSessionListQueryKey`, but this hook always re-derives it from
     * `{serverId, query}` so no caller can supply a contradictory identity.
     */
    queryKey?: string;
    query: SessionListQueryV1;
    /**
     * Mounted Sessions corpora use `query`. Independent secondary consumers
     * use `rowOnly` to hydrate the shared exact-Home rows without publishing a
     * competing mounted-filter membership.
     */
    queryMembership?: 'query' | 'rowOnly';
    /**
     * Released GET adapter for this corpus, used when the Home cannot serve the
     * strict query. Ordinary/archived GET and the strict query are request adapters
     * over this one per-Home pagination owner.
     */
    ordinaryAdapter?: SessionListOrdinaryPageAdapter | null;
}>;

export type SessionListQuerySourceState = Readonly<{
    statesByServerId: Readonly<Record<string, SessionListQueryHomeState | undefined>>;
    byServerId: Readonly<Record<string, ReadonlyArray<SessionListIndexItem> | null | undefined>>;
    source: ReadonlyArray<SessionListIndexItem> | null;
    coverageComplete: boolean;
    loadNext(): Promise<void>;
    refresh(): Promise<void>;
}>;

/**
 * A zero-Home query is authoritative only when the mounted filter owner has
 * already observed Homes and proved that none can match the qualified facets.
 * Startup before Home discovery is the same array shape but is not an empty
 * result, so it must stay incomplete.
 */
export function resolveEmptySessionListQueryCoverage(input: Readonly<{
    enabled: boolean;
    homeCount: number;
    emptySelectionComplete: boolean;
}>): boolean {
    return input.enabled && input.homeCount === 0 && input.emptySelectionComplete;
}

/**
 * One Home's filtered-listing admission, decided by the canonical feature owner
 * for that exact Home rather than by a Sessions-local bit read or an aggregate
 * over the whole selection.
 *
 * `null` means undecided — the Home has not answered yet — and is never a denial:
 * the controller waits instead of failing a capable Home closed. Everything else
 * fails closed, so a missing or malformed server bit disables the query.
 */
export function resolveSessionListFeatureHomeSupport(
    featureId: FeatureId,
    featureSnapshots: ServerFeaturesMainSelectionSnapshot,
    serverId: string,
    enabled: boolean,
    settings: FeatureLocalPolicySettings,
): boolean | null {
    if (!enabled) return null;
    const snapshot = featureSnapshots.snapshotsByServerId[serverId];
    if (!snapshot && featureRequiresServerSnapshot(featureId)) return null;
    const decision = resolveRuntimeFeatureDecisionFromSnapshot({
        featureId,
        settings,
        // Client-represented features are decided by build/local policy and do
        // not need a Home response. The resolver ignores this placeholder for
        // those features; server-represented features returned above instead.
        snapshot: snapshot ?? { status: 'unsupported', reason: 'endpoint_missing' },
        scope: { scopeKind: 'spawn', serverId },
    });
    if (!decision) return null;
    if (decision.state === 'enabled') return true;
    return decision.state === 'unknown' ? null : false;
}

export function resolveSessionListQueryHomeSupport(
    featureSnapshots: ServerFeaturesMainSelectionSnapshot,
    serverId: string,
    enabled: boolean,
    settings: FeatureLocalPolicySettings,
): boolean | null {
    return resolveSessionListFeatureHomeSupport(
        'sessions.filteredListing',
        featureSnapshots,
        serverId,
        enabled,
        settings,
    );
}

/**
 * Composes the endpoint decision with an optional scope-specific decision for
 * one exact Home. `undefined` means the active scope has no additional feature
 * requirement; `null` remains undecided so the controller waits and retries
 * when the canonical feature projection changes.
 */
export function resolveSessionListQueryHomeAdmissionSupport(
    filteredListingSupport: boolean | null | undefined,
    scopeFeatureSupport: boolean | null | undefined,
): boolean | null {
    if (filteredListingSupport === false || scopeFeatureSupport === false) return false;
    if (filteredListingSupport !== true) return null;
    if (scopeFeatureSupport === undefined) return true;
    return scopeFeatureSupport === true ? true : null;
}

type NormalizedQueryHome = Readonly<{
    serverId: string;
    queryKey: string;
    query: SessionListQueryV1;
    queryMembership: 'query' | 'rowOnly';
    ordinaryAdapter: SessionListOrdinaryPageAdapter | null;
}>;

/**
 * Per-Home filtered-listing admission.
 *
 * Support is decided once per exact Home through the canonical feature owner. An
 * aggregate decision over the whole selection is never an admission gate: it would
 * let one loading, disabled or unsupported Home suppress a capable one.
 */
export function useSessionListFeatureHomeSupportByServerId(
    featureId: FeatureId,
    serverIds: readonly string[],
    enabled: boolean,
): Readonly<Record<string, boolean | null>> {
    const normalizedServerIds = React.useMemo(
        () => [...new Set(serverIds.map((serverId) => serverId.trim()).filter(Boolean))],
        [serverIds],
    );
    const featureSnapshots = useServerFeaturesMainSelectionSnapshot(normalizedServerIds, {
        enabled: enabled && featureRequiresServerSnapshot(featureId),
    });
    const localPolicySettings = useFeatureLocalPolicySettings();
    return React.useMemo(() => {
        const supportByServerId: Record<string, boolean | null> = {};
        for (const serverId of normalizedServerIds) {
            supportByServerId[serverId] = resolveSessionListFeatureHomeSupport(
                featureId,
                featureSnapshots,
                serverId,
                enabled,
                localPolicySettings,
            );
        }
        return supportByServerId;
    }, [enabled, featureId, featureSnapshots, localPolicySettings, normalizedServerIds]);
}

export function useSessionListQueryHomeSupportByServerId(
    serverIds: readonly string[],
    enabled: boolean,
): Readonly<Record<string, boolean | null>> {
    return useSessionListFeatureHomeSupportByServerId('sessions.filteredListing', serverIds, enabled);
}

function normalizeHomes(homes: readonly SessionListQueryHomeInput[]): NormalizedQueryHome[] {
    const normalized: NormalizedQueryHome[] = [];
    const seen = new Set<string>();
    for (const home of homes) {
        const serverId = home.serverId.trim();
        if (!serverId || seen.has(serverId)) continue;
        seen.add(serverId);
        normalized.push({
            serverId,
            query: home.query,
            queryKey: buildSessionListQueryKey(serverId, home.query),
            queryMembership: home.queryMembership ?? 'query',
            ordinaryAdapter: home.ordinaryAdapter ?? null,
        });
    }
    return normalized;
}

export function buildSessionListQueryHomeIndex(input: Readonly<{
    addresses: readonly SessionAddress[];
    rowsBySessionId: Readonly<Record<string, SessionListRenderableSession | undefined>> | null | undefined;
    machines: ReturnType<typeof buildMachineDisplaysByIdFromMachineList>;
    activeGroupingV1?: 'project' | 'date';
    inactiveGroupingV1?: 'project' | 'date';
    sectionModeV1?: 'activity' | 'single';
    serverId: string;
    serverName: string | null;
}>): SessionListIndexItem[] {
    const rows: Record<string, SessionListRenderableSession> = {};
    for (const address of input.addresses) {
        const row = input.rowsBySessionId?.[address.sessionId];
        if (row) rows[address.sessionId] = row;
    }
    const index = buildSessionListIndexWithServerScope({
        sessions: rows,
        machines: input.machines,
        activeGroupingV1: input.activeGroupingV1,
        inactiveGroupingV1: input.inactiveGroupingV1,
        sectionModeV1: input.sectionModeV1,
        serverScope: {
            serverId: input.serverId,
            serverName: input.serverName,
        },
    });
    for (const address of input.addresses) {
        if (input.rowsBySessionId?.[address.sessionId]) continue;
        index.push({
            type: 'session',
            serverId: address.serverId,
            ...(input.serverName ? { serverName: input.serverName } : {}),
            sessionId: address.sessionId,
            section: 'active',
            groupKind: 'loading',
        });
    }
    return index;
}

/**
 * The exact per-Home completeness predicate. Retained rows may render during any
 * partial state, but only this predicate can turn a zero-row result into an
 * authoritative empty one.
 */
export function useSessionListQuerySourceState(input: Readonly<{
    enabled: boolean;
    homes: readonly SessionListQueryHomeInput[];
    emptySelectionComplete?: boolean;
}>): SessionListQuerySourceState {
    const homes = React.useMemo(() => normalizeHomes(input.homes), [input.homes]);
    const homeServerIds = React.useMemo(() => homes.map((home) => home.serverId), [homes]);
    const supportByServerId = useSessionListQueryHomeSupportByServerId(homeServerIds, input.enabled);
    const followingHomeServerIds = React.useMemo(
        () => homes.filter((home) => home.query.scope === 'following').map((home) => home.serverId),
        [homes],
    );
    const followingSupportByServerId = useSessionListFeatureHomeSupportByServerId(
        'sessions.following',
        followingHomeServerIds,
        input.enabled && followingHomeServerIds.length > 0,
    );
    const rowsByServerId = useSessionListRowsByServerId();
    const ordinaryMembershipByServerId = useOrdinarySessionListMembershipByServerId();
    const machineListsByServerId = useMachineListByServerId();
    const machineStatusesByServerId = useMachineListStatusByServerId();
    const socketStatus = useSocketStatus();
    const settings = useSettings();
    const accountScopesByServerId = useServerCredentialAccountScopes(homeServerIds);
    // Homes whose ordinary corpus an incumbent runtime already owns — Sync for the
    // applied Home, the concurrent cache for every other managed Home. Their
    // bootstrap/reconnect replace, append continuation and cursors are the only
    // ones for `/v2/sessions` on that Home, so the filter reads that frontier here
    // instead of mounting a controller that would paginate and replace the same
    // membership — two owners that could orphan each other's pages.
    const managedOrdinaryHomeKey = homes
        .filter((home) => (
            home.ordinaryAdapter?.membership === 'ordinary'
            && supportByServerId[home.serverId] === false
            && resolveOrdinarySessionListHomeOwner(home.serverId) !== null
        ))
        .map((home) => home.serverId)
        .join('\u0000');
    const managedOrdinaryHomes = React.useMemo(
        () => new Set(managedOrdinaryHomeKey ? managedOrdinaryHomeKey.split('\u0000') : []),
        [managedOrdinaryHomeKey],
    );
    const controllersRef = React.useRef(new Map<string, SessionListQueryHomeController>());
    const controllerAccountScopesRef = React.useRef(new Map<string, ServerCredentialAccountScopeBinding>());
    const controllerRetirementsRef = React.useRef(new Map<string, Readonly<{ dispose(): void }>>());
    const [controllerRevision, forceRender] = React.useReducer((value) => value + 1, 0);
    const disposeController = React.useCallback((
        serverId: string,
        expected?: SessionListQueryHomeController,
    ): boolean => {
        const controller = controllersRef.current.get(serverId);
        if (!controller || (expected && controller !== expected)) return false;
        controllerRetirementsRef.current.get(serverId)?.dispose();
        controllerRetirementsRef.current.delete(serverId);
        controllerAccountScopesRef.current.delete(serverId);
        controllersRef.current.delete(serverId);
        controller.dispose();
        return true;
    }, []);

    React.useLayoutEffect(() => {
        // Controllers, their cursors, and their in-flight requests belong to the
        // committed mounted selection and exact credential/Account lifetime.
        // Never reconcile this map during render:
        // React may abandon a concurrent render after it has observed different
        // Homes, and that render must not dispose the still-committed controllers.
        const selectedServerIds = new Set(homes.flatMap((home) => {
            if (managedOrdinaryHomes.has(home.serverId)) return [];
            const binding = accountScopesByServerId.get(home.serverId);
            return binding?.isCurrent() === true ? [home.serverId] : [];
        }));
        let membershipChanged = false;
        for (const [serverId, controller] of [...controllersRef.current]) {
            const binding = accountScopesByServerId.get(serverId);
            if (
                selectedServerIds.has(serverId)
                && binding
                && controllerAccountScopesRef.current.get(serverId) === binding
            ) continue;
            membershipChanged = disposeController(serverId, controller) || membershipChanged;
        }
        const selectedControllers: SessionListQueryHomeController[] = [];
        for (const home of homes) {
            if (managedOrdinaryHomes.has(home.serverId)) continue;
            const binding = accountScopesByServerId.get(home.serverId);
            if (!binding?.isCurrent()) continue;
            let controller = controllersRef.current.get(home.serverId);
            if (!controller) {
                controller = createSessionListQueryHomeController({
                    serverId: home.serverId,
                    fetchPage: (page) => fetchSessionListQueryPageForHome(home.serverId, page),
                });
                controllersRef.current.set(home.serverId, controller);
                controllerAccountScopesRef.current.set(home.serverId, binding);
                const retirement = binding.onRetire(() => {
                    if (disposeController(home.serverId, controller)) forceRender();
                });
                if (!binding.isCurrent() || controllersRef.current.get(home.serverId) !== controller) {
                    retirement.dispose();
                    disposeController(home.serverId, controller);
                    continue;
                }
                controllerRetirementsRef.current.set(home.serverId, retirement);
                membershipChanged = true;
            }
            selectedControllers.push(controller);
        }
        const unsubscribes = selectedControllers.map((controller) => controller.subscribe(forceRender));
        if (membershipChanged) forceRender();
        return () => {
            for (const unsubscribe of unsubscribes) unsubscribe();
        };
    }, [accountScopesByServerId, disposeController, homes, managedOrdinaryHomes]);

    React.useEffect(() => (
        subscribeSessionListQueryHomeInvalidation(() => controllersRef.current)
    ), []);

    React.useEffect(() => {
        for (const home of homes) {
            const controller = controllersRef.current.get(home.serverId);
            if (!controller) continue;
            const availability = getSessionListQueryHomeAvailability(home.serverId);
            void controller.update({
                query: home.query,
                selected: input.enabled,
                online: availability === 'pending' ? null : availability === 'online',
                supported: resolveSessionListQueryHomeAdmissionSupport(
                    supportByServerId[home.serverId],
                    home.query.scope === 'following'
                        ? (followingSupportByServerId[home.serverId] ?? null)
                        : undefined,
                ),
                queryMembership: home.queryMembership,
                ordinaryAdapter: home.ordinaryAdapter ?? null,
            });
        }
    }, [accountScopesByServerId, followingSupportByServerId, homes, input.enabled, machineStatusesByServerId, socketStatus, supportByServerId]);

    React.useLayoutEffect(() => () => {
        for (const [serverId, controller] of [...controllersRef.current]) {
            disposeController(serverId, controller);
        }
    }, [disposeController]);

    const readHomeState = React.useCallback((home: NormalizedQueryHome): SessionListQueryHomeState | undefined => {
        if (!managedOrdinaryHomes.has(home.serverId)) {
            return controllersRef.current.get(home.serverId)?.getSnapshot();
        }
        const availability = getSessionListQueryHomeAvailability(home.serverId);
        return readOrdinarySessionListHomeState({
            serverId: home.serverId,
            requestedQueryKey: home.queryKey,
            online: availability === 'pending' ? null : availability === 'online',
        });
    }, [managedOrdinaryHomes]);
    const loadNext = React.useCallback(async () => {
        await Promise.all(homes.map((home) => (
            managedOrdinaryHomes.has(home.serverId)
                ? loadNextOrdinarySessionListPage(home.serverId)
                : controllersRef.current.get(home.serverId)?.loadNext()
        )));
    }, [homes, managedOrdinaryHomes]);
    const refresh = React.useCallback(async () => {
        const retryableHomes = homes.filter((home) => {
            const state = readHomeState(home);
            return state?.phase === 'offline'
                || (state?.phase === 'error' && state.failureReason === 'network');
        });
        // Re-arm every unavailable Home through its transport owner before
        // asking query controllers for their next page. A failed reconnect is
        // still followed by refresh so the controller remains the one source
        // of query state and error presentation.
        await Promise.allSettled(retryableHomes.map((home) => (
            retrySessionListQueryHome(home.serverId)
        )));
        await Promise.all(homes.map((home) => (
            managedOrdinaryHomes.has(home.serverId)
                ? refreshOrdinarySessionList(home.serverId)
                : controllersRef.current.get(home.serverId)?.refresh()
        )));
    }, [homes, readHomeState, managedOrdinaryHomes]);

    return React.useMemo(() => {
        const statesByServerId: Record<string, SessionListQueryHomeState | undefined> = {};
        const byServerId: Record<string, ReadonlyArray<SessionListIndexItem> | null | undefined> = {};
        const source: SessionListIndexItem[] = [];
        let hasReadySource = false;
        let hasPendingSource = false;
        let coverageComplete = true;
        for (const home of homes) {
            const state = readHomeState(home);
            statesByServerId[home.serverId] = state;
            if (!state || state.appliedQueryKey !== home.queryKey) {
                if (state?.phase === 'error' && state.failureReason === 'unsupported') {
                    byServerId[home.serverId] = [];
                    hasReadySource = true;
                    coverageComplete = false;
                    continue;
                }
                byServerId[home.serverId] = null;
                hasPendingSource = true;
                coverageComplete = false;
                continue;
            }
            const index = buildSessionListQueryHomeIndex({
                addresses: state.addresses,
                rowsBySessionId: rowsByServerId[home.serverId],
                machines: buildMachineDisplaysByIdFromMachineList(machineListsByServerId[home.serverId]),
                activeGroupingV1: settings.sessionListActiveGroupingV1,
                inactiveGroupingV1: settings.sessionListInactiveGroupingV1,
                sectionModeV1: settings.sessionListSectionModeV1,
                serverId: home.serverId,
                serverName: getServerProfileById(home.serverId)?.name ?? null,
            });
            byServerId[home.serverId] = index;
            source.push(...index);
            hasReadySource = true;
            if (!isSessionListQueryHomeCoverageComplete({
                state,
                requestedQueryKey: home.queryKey,
            })) {
                coverageComplete = false;
            }
        }

        return {
            statesByServerId,
            byServerId,
            source: !input.enabled ? null : hasReadySource ? source : hasPendingSource ? null : [],
            coverageComplete: homes.length === 0
                ? resolveEmptySessionListQueryCoverage({
                    enabled: input.enabled,
                    homeCount: homes.length,
                    emptySelectionComplete: input.emptySelectionComplete === true,
                })
                : input.enabled && coverageComplete && !hasPendingSource,
            loadNext,
            refresh,
        };
    }, [
        controllerRevision,
        homes,
        input.enabled,
        input.emptySelectionComplete,
        loadNext,
        machineListsByServerId,
        machineStatusesByServerId,
        ordinaryMembershipByServerId,
        readHomeState,
        refresh,
        rowsByServerId,
        settings.sessionListActiveGroupingV1,
        settings.sessionListInactiveGroupingV1,
        settings.sessionListSectionModeV1,
        socketStatus,
    ]);
}
