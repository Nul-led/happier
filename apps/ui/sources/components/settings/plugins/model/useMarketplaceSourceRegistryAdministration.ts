import * as React from 'react';
import type { MarketplaceSourceRegistryMutationV1, MarketplaceSourceRegistryV1 } from '@happier-dev/protocol/marketplace';

import type { FreshMachineAdministrationExecutionTargetV1 } from '@/sync/domains/machines/administration/useTargetSelection';
import {
    machineMarketplaceSourceRegistryGet,
    machineMarketplaceSourceRegistryMutate,
} from '@/sync/ops/machineMarketplaceSources';

export type MarketplaceSourceRegistryMutationSettlementV1 =
    | Readonly<{ status: 'success' }>
    | Readonly<{ status: 'unavailable' }>
    | Readonly<{ status: 'outcomeUnknown' }>
    | Readonly<{ status: 'superseded' }>;

/**
 * The one machine-scoped marketplace source registry owner in the app.
 *
 * Discover's source filter, the npm registry profile bindings, and the
 * Sources & registries administration screen all read and write the same
 * per-machine registry. Giving each surface its own loader and its own
 * write path would let two screens disagree about which sources a machine
 * has, so the read, the currentness fence, and every write live here.
 *
 * Every write re-resolves the execution target it was issued against and
 * discards its own result when that target is no longer current: a source
 * added while the user was pointing at one machine must never be applied to,
 * or reported as applied to, a machine they selected afterwards.
 */
export type MarketplaceSourceRegistryAdministrationV1 = Readonly<{
    registry: MarketplaceSourceRegistryV1 | null;
    loading: boolean;
    loadError: boolean;
    refresh: () => void;
    upsertSource: (input: Extract<MarketplaceSourceRegistryMutationV1, { kind: 'upsert' }>['input']) => Promise<MarketplaceSourceRegistryMutationSettlementV1>;
    setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<MarketplaceSourceRegistryMutationSettlementV1>;
    removeSource: (sourceId: string) => Promise<MarketplaceSourceRegistryMutationSettlementV1>;
    setSourceRegistryProfile: (sourceId: string, profileId: string | null) => Promise<MarketplaceSourceRegistryMutationSettlementV1>;
}>;

export type MarketplaceSourceRegistryAdministrationParamsV1 = Readonly<{
    /**
     * Cache identity for the selected machine. The registry is dropped when it
     * changes so a newly selected machine can never inherit another machine's
     * configured sources, and retained when the same machine merely goes
     * offline so the screen keeps its last-known truth.
     */
    scopeKey: string | null;
    enabled: boolean;
    executionTarget: FreshMachineAdministrationExecutionTargetV1 | null;
    resolveCurrentExecutionTarget: (
        expected: FreshMachineAdministrationExecutionTargetV1 | null,
    ) => FreshMachineAdministrationExecutionTargetV1 | null;
}>;

export function useMarketplaceSourceRegistryAdministration(
    params: MarketplaceSourceRegistryAdministrationParamsV1,
): MarketplaceSourceRegistryAdministrationV1 {
    const { scopeKey, enabled, executionTarget, resolveCurrentExecutionTarget } = params;
    const [registry, setRegistry] = React.useState<MarketplaceSourceRegistryV1 | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [loadError, setLoadError] = React.useState(false);
    const [refreshKey, setRefreshKey] = React.useState(0);
    const requestIdRef = React.useRef(0);
    const lastScopeKeyRef = React.useRef<string | null>(scopeKey);
    const scopeIsCurrent = lastScopeKeyRef.current === scopeKey;
    const visibleRegistry = scopeIsCurrent ? registry : null;
    const registryRef = React.useRef<MarketplaceSourceRegistryV1 | null>(visibleRegistry);
    registryRef.current = visibleRegistry;

    React.useEffect(() => {
        if (lastScopeKeyRef.current === scopeKey) return;
        lastScopeKeyRef.current = scopeKey;
        requestIdRef.current += 1;
        registryRef.current = null;
        setRegistry(null);
        setLoading(false);
        setLoadError(false);
    }, [scopeKey]);

    React.useEffect(() => {
        const requestedTarget = resolveCurrentExecutionTarget(executionTarget);
        if (!enabled || !requestedTarget) {
            requestIdRef.current += 1;
            setLoading(false);
            return;
        }

        const requestId = ++requestIdRef.current;
        setLoading(true);
        setLoadError(false);
        void (async () => {
            try {
                const nextRegistry = await machineMarketplaceSourceRegistryGet(requestedTarget.machine.id, {
                    serverId: requestedTarget.serverId,
                });
                if (
                    requestIdRef.current !== requestId
                    || !resolveCurrentExecutionTarget(requestedTarget)
                ) return;
                setRegistry(nextRegistry);
                setLoading(false);
            } catch {
                if (
                    requestIdRef.current !== requestId
                    || !resolveCurrentExecutionTarget(requestedTarget)
                ) return;
                // A failed read of the SAME machine says nothing about which
                // sources that machine has. Keeping the last known registry
                // beside the load error preserves the truth the screen already
                // had; clearing it would present "no sources configured" as an
                // answer and disable the actions the reader came here for. The
                // scope-change effect above remains the only path that drops
                // it, so a different machine can still never inherit it.
                setLoadError(true);
                setLoading(false);
            }
        })();
    }, [enabled, executionTarget, refreshKey, resolveCurrentExecutionTarget, scopeKey]);

    const refresh = React.useCallback(() => {
        setRefreshKey((previous) => previous + 1);
    }, []);

    /**
     * Applies one source-scoped mutation against daemon-current registry state
     * while preserving the exact-target currentness fence around its result.
     */
    const applyRegistryChange = React.useCallback(async (
        mutation: MarketplaceSourceRegistryMutationV1,
    ): Promise<MarketplaceSourceRegistryMutationSettlementV1> => {
        const currentRegistry = registryRef.current;
        const issuedTarget = resolveCurrentExecutionTarget(executionTarget);
        if (!enabled || !issuedTarget || !currentRegistry) {
            throw new Error('Marketplace source registry is unavailable');
        }
        const requestId = ++requestIdRef.current;
        const result = await machineMarketplaceSourceRegistryMutate(issuedTarget.machine.id, mutation, {
            serverId: issuedTarget.serverId,
        });
        if (
            requestIdRef.current !== requestId
            || !resolveCurrentExecutionTarget(issuedTarget)
        ) return { status: 'superseded' };
        if (result.status === 'outcomeUnknown') {
            // Re-read only through the incumbent registry owner. The mutation
            // itself is never replayed, and the effect above retains the same
            // exact-target currentness fence around the returned snapshot.
            refresh();
            return result;
        }
        if (result.status === 'unavailable') return result;
        setRegistry(result.registry);
        setLoadError(false);
        return { status: 'success' };
    }, [enabled, executionTarget, refresh, resolveCurrentExecutionTarget]);

    const upsertSource = React.useCallback(async (
        input: Extract<MarketplaceSourceRegistryMutationV1, { kind: 'upsert' }>['input'],
    ): Promise<MarketplaceSourceRegistryMutationSettlementV1> => {
        return await applyRegistryChange({ kind: 'upsert', input });
    }, [applyRegistryChange]);

    const setSourceEnabled = React.useCallback(async (
        sourceId: string,
        sourceEnabled: boolean,
    ): Promise<MarketplaceSourceRegistryMutationSettlementV1> => {
        return await applyRegistryChange({ kind: 'setEnabled', sourceId, enabled: sourceEnabled });
    }, [applyRegistryChange]);

    const removeSource = React.useCallback(async (sourceId: string): Promise<MarketplaceSourceRegistryMutationSettlementV1> => {
        return await applyRegistryChange({ kind: 'remove', sourceId });
    }, [applyRegistryChange]);

    const setSourceRegistryProfile = React.useCallback(async (
        sourceId: string,
        profileId: string | null,
    ): Promise<MarketplaceSourceRegistryMutationSettlementV1> => {
        return await applyRegistryChange({ kind: 'setRegistryProfile', sourceId, registryProfileId: profileId });
    }, [applyRegistryChange]);

    return React.useMemo(() => Object.freeze({
        registry: visibleRegistry,
        loading,
        loadError,
        refresh,
        upsertSource,
        setSourceEnabled,
        removeSource,
        setSourceRegistryProfile,
    }), [
        loadError,
        loading,
        refresh,
        visibleRegistry,
        removeSource,
        setSourceEnabled,
        setSourceRegistryProfile,
        upsertSource,
    ]);
}
