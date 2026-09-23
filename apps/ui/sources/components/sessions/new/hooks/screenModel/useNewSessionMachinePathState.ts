import * as React from 'react';
import type { MachinePoolSelectionOriginV1, SessionAuthoringExecutionTargetV2 } from '@happier-dev/protocol';

import { resolvePreferredMachineId } from '@/components/settings/pickers/resolvePreferredMachineId';
import { normalizeOptionalParam } from '@/profileRouteParams';
import type { Machine, Session } from '@/sync/domains/state/storageTypes';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import { resolveDefaultDirectoryForMachine } from '@/utils/sessions/machineDefaultDirectory';
import { useStableRecentPathsResolver } from '@/utils/sessions/useStableRecentPathsForMachine';

type RecentMachinePathsList = Array<{ machineId: string; path: string }>;

function normalizeMachineIdParam(raw: unknown): string {
    const normalized = normalizeOptionalParam(
        typeof raw === 'string' || Array.isArray(raw) ? raw : undefined,
    );
    return typeof normalized === 'string' ? normalized.trim() : '';
}

function normalizePathParam(raw: unknown): string {
    const normalized = normalizeOptionalParam(
        typeof raw === 'string' || Array.isArray(raw) ? raw : undefined,
    );
    return typeof normalized === 'string' ? normalized.trim() : '';
}

export function useNewSessionMachinePathState(params: Readonly<{
    serverId: string | null;
    persistedExecutionTarget?: SessionAuthoringExecutionTargetV2 | null;
    /** Fresh one-shot handoff identity for an explicit rich picker target. */
    executionTargetRequestKey?: string | null;
    routeSelectionOrigin?: MachinePoolSelectionOriginV1;
    machines: ReadonlyArray<Machine>;
    recentMachinePaths: unknown;
    sessions?: ReadonlyArray<Session | string> | null | undefined;
    machineIdParam: unknown;
    pathParam: unknown;
    persistedMachineId?: unknown;
    persistedPath?: unknown;
    cacheScopeKey?: string | null;
}>): Readonly<{
    executionTarget: SessionAuthoringExecutionTargetV2 | null;
    selectedMachineId: string | null;
    /**
     * The machine whose open Agent catalog this screen shows.
     *
     * It is the selected machine for an ordinary machine target. A Temporary
     * computer has no machine of its own, and an Agent still has to be chosen
     * for it, so the catalog comes from the creator's focused — or most
     * recently used — machine, resolved through the same preferred-machine
     * owner the screen already uses for its default target.
     */
    agentCatalogMachineId: string | null;
    setSelectedMachineId: React.Dispatch<React.SetStateAction<string | null>>;
    setSelectedMachineTarget: (target: Readonly<{
        machineId: string | null;
        selectionOrigin?: MachinePoolSelectionOriginV1 | null;
        path?: string;
    }>) => void;
    setTemporaryComputerTarget: (target: Readonly<{
        serverId: string;
        artifactTarget: Extract<SessionAuthoringExecutionTargetV2, { kind: 'temporary_computer' }>['artifactTarget'];
        workspace: Extract<SessionAuthoringExecutionTargetV2, { kind: 'temporary_computer' }>['workspace'];
        /** Absolute instant; omitted means the default, Never. */
        packageExpiresAt?: number;
    }>) => void;
    selectedPath: string;
    setSelectedPath: React.Dispatch<React.SetStateAction<string>>;
    setDraftSelectedPath: (path: string) => void;
    getRequestedPath: () => string;
    getBestPathForMachine: (machineId: string | null) => string;
}> {
    const recentMachinePaths = React.useMemo((): RecentMachinePathsList => {
        return Array.isArray(params.recentMachinePaths) ? (params.recentMachinePaths as any[]).slice() as any : [];
    }, [params.recentMachinePaths]);
    const resolveRecentPathsForMachine = useStableRecentPathsResolver({
        recentMachinePaths,
        sessions: params.sessions,
        cacheScopeKey: params.cacheScopeKey,
    });

    const resolveMachineId = React.useCallback((preferredMachineId: string | null): string | null => {
        const preferredOnlineMachineId = resolvePreferredMachineId({
            machines: params.machines,
            preferredMachineId,
            recentMachinePaths,
            onlineOnly: true,
        });
        if (preferredOnlineMachineId) return preferredOnlineMachineId;
        return resolvePreferredMachineId({
            machines: params.machines,
            preferredMachineId,
            recentMachinePaths,
        });
    }, [params.machines, recentMachinePaths]);

    const getBestPathForMachine = React.useCallback((machineId: string | null): string => (
        resolveDefaultDirectoryForMachine({
            machineId,
            machines: params.machines,
            recentPaths: resolveRecentPathsForMachine(machineId),
        })
    ), [params.machines, resolveRecentPathsForMachine]);

    const getPersistedPathForMachine = React.useCallback((machineId: string | null): string => {
        if (!machineId) return '';
        const persistedMachineId = params.persistedExecutionTarget?.kind === 'machine'
            ? params.persistedExecutionTarget.target.machineId
            : normalizeMachineIdParam(params.persistedMachineId);
        if (!persistedMachineId || persistedMachineId !== machineId) {
            return '';
        }
        return normalizePathParam(params.persistedPath);
    }, [params.persistedExecutionTarget, params.persistedMachineId, params.persistedPath]);

    const resolvePersistedMachineId = React.useCallback((): string | null => {
        const persistedMachineId = params.persistedExecutionTarget?.kind === 'machine'
            ? params.persistedExecutionTarget.target.machineId
            : normalizeMachineIdParam(params.persistedMachineId);
        if (!persistedMachineId) return null;
        return persistedMachineId;
    }, [params.persistedExecutionTarget, params.persistedMachineId]);

    const machineTarget = React.useCallback((
        machineId: string | null,
        selectionOriginOverride?: MachinePoolSelectionOriginV1 | null,
    ): SessionAuthoringExecutionTargetV2 | null => {
        if (!machineId || !params.serverId) return null;
        if (selectionOriginOverride !== undefined) {
            return {
                kind: 'machine',
                target: { serverId: params.serverId, machineId },
                ...(selectionOriginOverride ? { selectionOrigin: selectionOriginOverride } : {}),
            };
        }
        if (params.routeSelectionOrigin && normalizeMachineIdParam(params.machineIdParam) === machineId) {
            return {
                kind: 'machine',
                target: { serverId: params.serverId, machineId },
                selectionOrigin: params.routeSelectionOrigin,
            };
        }
        const persisted = params.persistedExecutionTarget;
        return persisted?.kind === 'machine'
            && persisted.target.serverId === params.serverId
            && persisted.target.machineId === machineId
            ? persisted
            : { kind: 'machine', target: { serverId: params.serverId, machineId } };
    }, [params.machineIdParam, params.persistedExecutionTarget, params.routeSelectionOrigin, params.serverId]);
    const [executionTarget, setExecutionTarget] = React.useState<SessionAuthoringExecutionTargetV2 | null>(() => {
        const requestedMachineId = normalizeMachineIdParam(params.machineIdParam);
        // A route/seeded machine is an exact target. Do not pair its directory
        // with a persisted or preferred machine while that target hydrates.
        if (requestedMachineId) {
            return machineTarget(requestedMachineId);
        }
        if (params.persistedExecutionTarget !== undefined) return params.persistedExecutionTarget;
        return machineTarget(resolvePersistedMachineId() ?? resolveMachineId(null));
    });
    const selectedMachineId = executionTarget?.kind === 'machine' ? executionTarget.target.machineId : null;
    const agentCatalogMachineId = executionTarget?.kind === 'temporary_computer'
        ? resolveMachineId(resolvePersistedMachineId())
        : selectedMachineId;
    const executionTargetRef = React.useRef(executionTarget);
    executionTargetRef.current = executionTarget;
    const setSelectedMachineIdState = React.useCallback((machineId: string | null) => {
        setExecutionTarget((current) => {
            const next = machineTarget(machineId);
            return current?.kind === 'machine'
                && next?.kind === 'machine'
                && current.target.serverId === next.target.serverId
                && current.target.machineId === next.target.machineId
                && current.selectionOrigin?.poolId === next.selectionOrigin?.poolId
                ? current
                : next;
        });
    }, [machineTarget, params.serverId]);
    const selectedMachineIdRef = React.useRef<string | null>(selectedMachineId);
    selectedMachineIdRef.current = selectedMachineId;
    const hasUserSelectedMachineRef = React.useRef(false);
    const hasCommittedExactTargetRef = React.useRef(
        normalizeMachineIdParam(params.machineIdParam).length > 0
        || normalizeMachineIdParam(params.persistedMachineId).length > 0
        || params.persistedExecutionTarget != null,
    );
    const selectedMachineOnlineSeenByIdRef = React.useRef<Map<string, boolean>>(new Map());
    const lastAppliedPersistedMachineIdRef = React.useRef<string>('');
    const lastAppliedExecutionTargetRequestKeyRef = React.useRef<string | null>(
        params.executionTargetRequestKey ?? null,
    );
    const lastAppliedRouteOriginPoolIdRef = React.useRef<string | null>(null);

    const [selectedPath, setSelectedPathState] = React.useState<string>(() => {
        const trimmedPath = normalizePathParam(params.pathParam);
        if (trimmedPath) return trimmedPath;
        if (executionTarget?.kind === 'temporary_computer') return normalizePathParam(params.persistedPath);
        const persistedPath = getPersistedPathForMachine(selectedMachineId);
        if (persistedPath) return persistedPath;
        return getBestPathForMachine(selectedMachineId);
    });
    const selectedPathDraftRef = React.useRef<string>(selectedPath);
    const hasUserEditedPathRef = React.useRef(false);
    const lastAppliedMachineParamRef = React.useRef<Readonly<{ machineId: string; scopeKey: string | null }> | null>(null);
    const lastAppliedPathParamRef = React.useRef<string>('');
    const applyCommittedSelectedPath = React.useCallback((nextPath: string) => {
        selectedPathDraftRef.current = nextPath;
        setSelectedPathState(nextPath);
    }, []);

    /**
     * Is this selection a *qualified target change*?
     *
     * Only a different Home+Machine is. Re-selecting the Machine already
     * authored — or resolving that same Machine through a Pool, which adds
     * provenance and nothing else — is not, and must never reconcile the
     * authored working directory: that directory is the user's unsaved work and
     * decides where the Agent actually runs.
     */
    const isQualifiedMachineTargetChange = React.useCallback((machineId: string | null): boolean => {
        const current = executionTargetRef.current;
        if (current?.kind !== 'machine') return true;
        return current.target.serverId !== params.serverId || current.target.machineId !== machineId;
    }, [params.serverId]);

    const setSelectedMachineTarget = React.useCallback((target: Readonly<{
        machineId: string | null;
        selectionOrigin?: MachinePoolSelectionOriginV1 | null;
        /** An explicitly authored directory. Callers do not pass a default here. */
        path?: string;
    }>) => {
        hasUserSelectedMachineRef.current = true;
        if (target.path !== undefined) {
            hasUserEditedPathRef.current = false;
            applyCommittedSelectedPath(target.path);
        } else if (isQualifiedMachineTargetChange(target.machineId)) {
            // The owner supplies the default, and only for a real target change.
            hasUserEditedPathRef.current = false;
            applyCommittedSelectedPath(
                getPersistedPathForMachine(target.machineId) || getBestPathForMachine(target.machineId),
            );
        }
        setExecutionTarget(() => {
            hasCommittedExactTargetRef.current = target.machineId !== null;
            return machineTarget(target.machineId, target.selectionOrigin ?? null);
        });
    }, [
        applyCommittedSelectedPath,
        getBestPathForMachine,
        getPersistedPathForMachine,
        isQualifiedMachineTargetChange,
        machineTarget,
    ]);

    const setSelectedMachineId = React.useCallback<React.Dispatch<React.SetStateAction<string | null>>>((next) => {
        const machineId = typeof next === 'function'
            ? next(selectedMachineIdRef.current)
            : next;
        setSelectedMachineTarget({ machineId, selectionOrigin: null });
    }, [setSelectedMachineTarget]);

    const setTemporaryComputerTarget = React.useCallback((target: Readonly<{
        serverId: string;
        artifactTarget: Extract<SessionAuthoringExecutionTargetV2, { kind: 'temporary_computer' }>['artifactTarget'];
        workspace: Extract<SessionAuthoringExecutionTargetV2, { kind: 'temporary_computer' }>['workspace'];
        packageExpiresAt?: number;
    }>) => {
        hasUserSelectedMachineRef.current = true;
        hasCommittedExactTargetRef.current = true;
        setExecutionTarget({ kind: 'temporary_computer', ...target });
    }, []);

    const setSelectedPath = React.useCallback<React.Dispatch<React.SetStateAction<string>>>((next) => {
        hasUserEditedPathRef.current = true;
        hasCommittedExactTargetRef.current = executionTargetRef.current !== null;
        setSelectedPathState((current) => {
            const resolved = typeof next === 'function' ? next(current) : next;
            selectedPathDraftRef.current = resolved;
            return resolved;
        });
    }, []);

    const setDraftSelectedPath = React.useCallback((path: string) => {
        hasUserEditedPathRef.current = true;
        hasCommittedExactTargetRef.current = executionTargetRef.current !== null;
        selectedPathDraftRef.current = path;
    }, []);

    const getRequestedPath = React.useCallback(() => {
        return selectedPathDraftRef.current;
    }, []);

    const hasMachine = React.useCallback((machineId: string | null): boolean => {
        if (!machineId) return false;
        return params.machines.some((machine) => machine.id === machineId);
    }, [params.machines]);

    // Handle machine route param from picker screens (main's navigation pattern)
    React.useEffect(() => {
        const machineId = normalizeMachineIdParam(params.machineIdParam);
        const scopeKey = params.cacheScopeKey ?? null;
        const routeOriginPoolId = params.routeSelectionOrigin?.poolId ?? null;
        if (!machineId) {
            lastAppliedMachineParamRef.current = null;
            lastAppliedRouteOriginPoolIdRef.current = null;
            return;
        }
        // Applying an exact ID does not require a hydrated Machine row. Consume
        // the route value once so reconnect cannot undo a later user selection.
        const previousRouteTarget = lastAppliedMachineParamRef.current;
        if (
            machineId === previousRouteTarget?.machineId
            && scopeKey === previousRouteTarget.scopeKey
            && routeOriginPoolId === lastAppliedRouteOriginPoolIdRef.current
        ) {
            return;
        }
        if (!hasMachine(machineId)) {
            // A fresh route target is authoritative before its row hydrates;
            // the consumed qualified route above prevents stale reconnects.
            hasUserEditedPathRef.current = false;
            applyCommittedSelectedPath(
                normalizePathParam(params.pathParam)
                || getPersistedPathForMachine(machineId)
                || getBestPathForMachine(machineId),
            );
            lastAppliedMachineParamRef.current = { machineId, scopeKey };
            lastAppliedRouteOriginPoolIdRef.current = routeOriginPoolId;
            hasCommittedExactTargetRef.current = true;
            setSelectedMachineIdState(machineId);
            return;
        }

        lastAppliedMachineParamRef.current = { machineId, scopeKey };
        lastAppliedRouteOriginPoolIdRef.current = routeOriginPoolId;
        if (
            (!previousRouteTarget || previousRouteTarget.scopeKey === scopeKey)
            && !isQualifiedMachineTargetChange(machineId)
        ) {
            // The same Home+Machine came back, possibly with new Pool provenance.
            // Let the origin update and leave the authored folder alone; the same
            // decision the in-place pickers make.
            setSelectedMachineIdState(machineId);
            return;
        }
        hasUserSelectedMachineRef.current = true;
        hasCommittedExactTargetRef.current = true;
        setSelectedMachineIdState(machineId);
        hasUserEditedPathRef.current = false;
        const trimmedPath = normalizePathParam(params.pathParam);
        applyCommittedSelectedPath(trimmedPath || getPersistedPathForMachine(machineId) || getBestPathForMachine(machineId));
    }, [applyCommittedSelectedPath, getBestPathForMachine, getPersistedPathForMachine, hasMachine, isQualifiedMachineTargetChange, params.cacheScopeKey, params.machineIdParam, params.pathParam, params.routeSelectionOrigin, setSelectedMachineIdState]);

    React.useEffect(() => {
        const requestKey = params.executionTargetRequestKey ?? null;
        if (requestKey === null || requestKey === lastAppliedExecutionTargetRequestKeyRef.current) {
            return;
        }
        lastAppliedExecutionTargetRequestKeyRef.current = requestKey;
        if (params.persistedExecutionTarget === undefined) return;

        hasUserSelectedMachineRef.current = true;
        hasCommittedExactTargetRef.current = params.persistedExecutionTarget !== null;
        setExecutionTarget(params.persistedExecutionTarget);
        if (params.persistedExecutionTarget?.kind === 'temporary_computer' && !hasUserEditedPathRef.current) {
            applyCommittedSelectedPath(normalizePathParam(params.persistedPath));
        }
    }, [applyCommittedSelectedPath, params.executionTargetRequestKey, params.persistedExecutionTarget, params.persistedPath]);

    React.useEffect(() => {
        const routeMachineId = normalizeMachineIdParam(params.machineIdParam);
        if (routeMachineId) {
            lastAppliedPersistedMachineIdRef.current = '';
            return;
        }
        if (hasUserSelectedMachineRef.current) {
            return;
        }

        if (params.persistedExecutionTarget?.kind === 'temporary_computer') {
            hasCommittedExactTargetRef.current = true;
            setExecutionTarget(params.persistedExecutionTarget);
            if (!hasUserEditedPathRef.current) {
                applyCommittedSelectedPath(normalizePathParam(params.persistedPath));
            }
            return;
        }

        const reconciledPersistedMachineId = resolvePersistedMachineId();
        if (!reconciledPersistedMachineId) {
            lastAppliedPersistedMachineIdRef.current = '';
            return;
        }
        if (reconciledPersistedMachineId === lastAppliedPersistedMachineIdRef.current) {
            return;
        }

        lastAppliedPersistedMachineIdRef.current = reconciledPersistedMachineId;
        hasCommittedExactTargetRef.current = true;
        if (reconciledPersistedMachineId === selectedMachineIdRef.current) {
            return;
        }

        setSelectedMachineIdState(reconciledPersistedMachineId);
        hasUserEditedPathRef.current = false;
        applyCommittedSelectedPath(
            getPersistedPathForMachine(reconciledPersistedMachineId) || getBestPathForMachine(reconciledPersistedMachineId),
        );
    }, [
        applyCommittedSelectedPath,
        getBestPathForMachine,
        getPersistedPathForMachine,
        params.machineIdParam,
        params.persistedExecutionTarget,
        params.persistedPath,
        resolvePersistedMachineId,
        setSelectedMachineIdState,
    ]);

    // Ensure a machine is pre-selected once machines have loaded (wizard expects this).
    React.useEffect(() => {
        if (executionTarget !== null) return;
        if (params.machines.length === 0) return;
        if (normalizeMachineIdParam(params.machineIdParam)) return;
        // Let persisted reconciliation own hydration when its preferred machine is available.
        // Otherwise this fallback can enqueue a competing selection in the same effect flush,
        // causing the persisted effect to run again against a stale selectedMachineId.
        if (resolvePersistedMachineId() !== null) return;
        if (params.persistedExecutionTarget !== undefined) return;
        const machineIdToUse = resolveMachineId(null);
        const trimmedPath = normalizePathParam(params.pathParam);

        hasUserSelectedMachineRef.current = false;
        hasCommittedExactTargetRef.current = false;
        setSelectedMachineIdState(machineIdToUse);
        hasUserEditedPathRef.current = false;
        applyCommittedSelectedPath(trimmedPath || getPersistedPathForMachine(machineIdToUse) || getBestPathForMachine(machineIdToUse));
    }, [applyCommittedSelectedPath, executionTarget, getBestPathForMachine, getPersistedPathForMachine, params.machines, params.pathParam, params.persistedExecutionTarget, resolveMachineId, setSelectedMachineIdState]);

    // Keep selection valid when machine snapshots change (server/account switch, revoke, reconnect).
    React.useEffect(() => {
        if (selectedMachineId === null) return;
        if (hasMachine(selectedMachineId)) return;
        if (hasCommittedExactTargetRef.current) return;

        const machineIdToUse = resolveMachineId(null);
        if (machineIdToUse === selectedMachineId) return;

        hasUserSelectedMachineRef.current = false;
        hasCommittedExactTargetRef.current = false;
        setSelectedMachineIdState(machineIdToUse);
        hasUserEditedPathRef.current = false;
        applyCommittedSelectedPath(getPersistedPathForMachine(machineIdToUse) || getBestPathForMachine(machineIdToUse));
    }, [applyCommittedSelectedPath, getBestPathForMachine, getPersistedPathForMachine, hasMachine, resolveMachineId, selectedMachineId]);

    React.useEffect(() => {
        if (!selectedMachineId) return;
        const machine = params.machines.find((m) => m.id === selectedMachineId);
        if (!machine) return;
        if (!isMachineOnline(machine)) return;
        selectedMachineOnlineSeenByIdRef.current.set(selectedMachineId, true);
    }, [params.machines, selectedMachineId]);

    // If we implicitly selected an offline machine, upgrade to the best available online machine
    // once machine snapshots hydrate. Keep explicit user/route choices stable.
    React.useEffect(() => {
        if (selectedMachineId === null) return;
        if (hasCommittedExactTargetRef.current) return;
        if (hasUserSelectedMachineRef.current) return;
        if (normalizeMachineIdParam(params.machineIdParam)) return;
        if (selectedMachineOnlineSeenByIdRef.current.get(selectedMachineId) === true) return;

        const machineIdToUse = resolveMachineId(selectedMachineId);
        if (!machineIdToUse || machineIdToUse === selectedMachineId) return;

        hasUserSelectedMachineRef.current = false;
        hasCommittedExactTargetRef.current = false;
        setSelectedMachineIdState(machineIdToUse);

        if (hasUserEditedPathRef.current) return;
        const trimmedPath = normalizePathParam(params.pathParam);
        hasUserEditedPathRef.current = false;
        applyCommittedSelectedPath(trimmedPath || getPersistedPathForMachine(machineIdToUse) || getBestPathForMachine(machineIdToUse));
    }, [applyCommittedSelectedPath, getBestPathForMachine, getPersistedPathForMachine, params.machineIdParam, params.pathParam, resolveMachineId, selectedMachineId]);

    // Handle path route param from picker screens (main's navigation pattern)
    React.useEffect(() => {
        const trimmedPath = normalizePathParam(params.pathParam);

        if (trimmedPath === lastAppliedPathParamRef.current) {
            return;
        }

        lastAppliedPathParamRef.current = trimmedPath;
        if (trimmedPath && trimmedPath !== selectedPath) {
            hasUserEditedPathRef.current = false;
            applyCommittedSelectedPath(trimmedPath);
        }
    }, [applyCommittedSelectedPath, hasMachine, params.machineIdParam, params.pathParam, selectedPath]);

    React.useEffect(() => {
        if (!selectedMachineId) {
            return;
        }
        if (normalizePathParam(params.pathParam)) {
            return;
        }
        if (hasUserEditedPathRef.current) {
            return;
        }

        const persistedPath = hasUserSelectedMachineRef.current ? '' : getPersistedPathForMachine(selectedMachineId);
        if (persistedPath) {
            if (selectedPath !== persistedPath) {
                applyCommittedSelectedPath(persistedPath);
            }
            return;
        }

        if (selectedPath.trim().length > 0) {
            return;
        }

        const bestPath = getBestPathForMachine(selectedMachineId);
        if (!bestPath) {
            return;
        }

        applyCommittedSelectedPath(bestPath);
    }, [applyCommittedSelectedPath, getBestPathForMachine, getPersistedPathForMachine, params.pathParam, selectedMachineId, selectedPath]);

    return {
        executionTarget,
        selectedMachineId,
        agentCatalogMachineId,
        setSelectedMachineId,
        setSelectedMachineTarget,
        setTemporaryComputerTarget,
        selectedPath,
        setSelectedPath,
        setDraftSelectedPath,
        getRequestedPath,
        getBestPathForMachine,
    };
}
