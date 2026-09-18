import * as React from 'react';
import { readServerEnabledBit, type MachineKind, type MachinePoolViewV1 } from '@happier-dev/protocol';

import { useServerFeaturesMainSelectionSnapshot } from '@/sync/domains/features/featureDecisionRuntime';
import {
    useServerCredentialAccountScopeResolutions,
    type ServerCredentialAccountScopeProjectionLifecycle,
} from '@/sync/domains/scope/useServerCredentialAccountScopes';
import {
    storage,
    useMachinePoolAccountIdByServerId,
    useMachinePoolListByServerId,
    useMachinePoolListStatusByServerId,
} from '@/sync/domains/state/storage';
import type { MachinePoolListStatus } from '@/sync/store/domains/machinePools';

import { useMachinePoolProjectionSync } from './machinePoolSyncRuntime';

/**
 * The Machine lifecycle facts a Home uses to recompute Pool availability. Presentation, metadata and
 * per-consumer decoration stay with the consumer; this owner only needs identity plus liveness.
 */
export type MachinePoolProjectionMachine = Readonly<{
    id: string;
    kind?: MachineKind;
    active?: boolean;
    activeAt?: number;
    updatedAt?: number;
    revokedAt?: number | null;
    replacedByMachineId?: string | null;
}>;

export type MachinePoolProjectionScope = Readonly<{
    serverId: string;
    machines: readonly MachinePoolProjectionMachine[];
}>;

export type MachinePoolFeatureStatus = 'loading' | 'enabled' | 'disabled' | 'error';

export type MachinePoolProjection = Readonly<{
    serverId: string;
    /** The credential-bound Account currently allowed to consume these rows. */
    accountId: string | null;
    /** Current feature-discovery state; consumers render loading/error without inventing a fetcher. */
    featureStatus: MachinePoolFeatureStatus;
    /** The Home's own `machines.pools` decision; a missing or malformed bit is disabled. */
    featureEnabled: boolean;
    /** Last known Pool rows, retained across refresh. Empty while the feature is off. */
    pools: readonly MachinePoolViewV1[];
    status: MachinePoolListStatus;
    /**
     * The Home has settled its Pool answer: positively disabled, or enabled with a hydrated list.
     * Unknown, loading and failed projections are deliberately not "ready and empty".
     */
    ready: boolean;
}>;

const EMPTY_POOLS: readonly MachinePoolViewV1[] = [];

const MACHINE_POOL_CREDENTIAL_SCOPE_LIFECYCLE: ServerCredentialAccountScopeProjectionLifecycle = {
    beforeBinding(binding) {
        // Account identity is known before the binding can render. A replacement therefore clears
        // the previous Account's private rows even when no Pool surface observed the mutation.
        storage.getState().beginMachinePoolAccountScope(binding.serverId, binding.accountId);
    },
};

function buildMachineLifecycleRevisionKey(scope: MachinePoolProjectionScope): string {
    return scope.machines.map((machine) => [
            machine.id,
            machine.kind ?? '',
            machine.active === true ? '1' : '0',
            machine.activeAt ?? '',
            machine.revokedAt ?? '',
            machine.replacedByMachineId ?? '',
        ].join(':')).join('|');
}

/**
 * The single owner of a Home's Machine Pool projection: its feature decision, its refresh
 * invalidation, and the rows consumers render. Settings, the Pool editor and New Session all read
 * this result instead of repeating the same decisions with their own revision keys.
 */
export function useMachinePoolProjections(
    scopes: readonly MachinePoolProjectionScope[],
): readonly MachinePoolProjection[] {
    const poolListByServerId = useMachinePoolListByServerId();
    const poolListStatusByServerId = useMachinePoolListStatusByServerId();
    const poolAccountIdByServerId = useMachinePoolAccountIdByServerId();
    const serverIds = React.useMemo(() => scopes.map((scope) => scope.serverId), [scopes]);
    const features = useServerFeaturesMainSelectionSnapshot(serverIds);
    const accountScopes = useServerCredentialAccountScopeResolutions(
        serverIds,
        MACHINE_POOL_CREDENTIAL_SCOPE_LIFECYCLE,
    );

    const projections = React.useMemo<readonly MachinePoolProjection[]>(() => scopes.map((scope) => {
        const snapshot = features.snapshotsByServerId[scope.serverId];
        const featureStatus: MachinePoolProjection['featureStatus'] = !snapshot
            ? 'loading'
            : snapshot.status === 'error'
                ? 'error'
                : snapshot.status === 'ready'
                    ? readServerEnabledBit(snapshot.features, 'machines.pools') === true ? 'enabled' : 'disabled'
                    : 'disabled';
        const featureEnabled = featureStatus === 'enabled';
        const featureKnownDisabled = featureStatus === 'disabled';
        // `null` is this Home's explicit "not hydrated yet" marker, so an array is the only
        // evidence that a real list arrived.
        const cached = poolListByServerId[scope.serverId];
        const hydrated = Array.isArray(cached);
        const storedStatus = poolListStatusByServerId[scope.serverId] ?? 'idle';
        const accountScope = accountScopes.get(scope.serverId);
        const cachedAccountId = poolAccountIdByServerId[scope.serverId];
        const cachedAccountIsCurrent = accountScope?.kind === 'signed_out'
            ? Boolean(cachedAccountId)
            : accountScope?.kind === 'bound' && accountScope.scope.accountId === cachedAccountId;
        const status: MachinePoolListStatus = accountScope?.kind === 'bound'
            // A settled disabled feature has no list left to read: an unhydrated cache is not a
            // pending request, and a status left over from when Pools were enabled is not a current
            // failure. Reporting either would leave every Home without `machines.pools` looking
            // permanently incomplete to the shared destination projection.
            ? featureKnownDisabled
                ? 'idle'
                : hydrated && cachedAccountIsCurrent ? storedStatus : 'loading'
            : accountScope?.kind === 'signed_out' || accountScope?.kind === 'unknown_home'
                ? 'signedOut'
                : 'loading';
        return {
            serverId: scope.serverId,
            accountId: accountScope?.kind === 'bound' ? accountScope.scope.accountId : null,
            featureStatus,
            featureEnabled,
            // Retain this Account's last-known rows through feature discovery/error so surfaces
            // stay continuous and inert while offering recovery. Only a settled disabled decision
            // withdraws the Pool feature; transport still requires `featureEnabled === true`.
            pools: featureStatus !== 'disabled' && hydrated && cachedAccountIsCurrent ? cached : EMPTY_POOLS,
            status,
            ready: featureKnownDisabled || (featureEnabled && hydrated && cachedAccountIsCurrent && status === 'idle'),
        };
    }), [accountScopes, features.snapshotsByServerId, poolAccountIdByServerId, poolListByServerId, poolListStatusByServerId, scopes]);

    const projectionDemands = React.useMemo(() => projections.map((projection, index) => {
        const accountScope = accountScopes.get(projection.serverId);
        return {
            serverId: projection.serverId,
            machineRevisionKey: buildMachineLifecycleRevisionKey(scopes[index]!),
            transportEnabled: projection.featureEnabled,
            // A signed-out or failed Home keeps its last-known rows visible but inert. Those states
            // recover from the canonical credential/Home-change lifecycle, not from a render-driven
            // retry loop. Initial enabled Homes alone need an observation-time hydration request.
            needsHydration: projection.featureEnabled
                && accountScope?.kind === 'bound'
                && (
                    !Array.isArray(poolListByServerId[projection.serverId])
                    || poolAccountIdByServerId[projection.serverId] !== accountScope.scope.accountId
                )
                && (poolListStatusByServerId[projection.serverId] ?? 'idle') === 'idle',
        };
    }), [accountScopes, poolAccountIdByServerId, poolListByServerId, projections, scopes]);
    // Every visible Home participates in the shared feature/currentness wake, while Pool transport
    // itself is admitted only after the Home positively advertises it. This lets a live Home move
    // from unsupported/disabled to enabled without a remount or an unsupported speculative Action.
    useMachinePoolProjectionSync(projectionDemands);

    return projections;
}
