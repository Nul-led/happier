import * as React from 'react';

import {
    getWorkspaceSyncEngineReadinessSnapshot,
    subscribeWorkspaceSyncEngineReadiness,
    type WorkspaceSyncEngineReadinessSnapshot,
    type WorkspaceSyncEngineScope,
} from './workspaceSyncEngineReadinessStore';

const UNSCOPED: WorkspaceSyncEngineReadinessSnapshot = {
    phase: 'idle', errorCode: null, carrierPhase: 'unknown', carrierErrorCode: null,
};

/**
 * Subscribe to one machine's daemon-owned workspace-sync readiness. Passing
 * `null` (no machine chosen yet, or no workspace action that needs the engine)
 * deliberately performs no RPC probe. The machine projection updates this
 * store when daemon state advances.
 */
export function useWorkspaceSyncEngineReadiness(
    scope: WorkspaceSyncEngineScope | null,
): WorkspaceSyncEngineReadinessSnapshot {
    const serverId = scope?.serverId ?? null;
    const machineId = scope?.machineId ?? null;
    const [, rerender] = React.useReducer((value: number) => value + 1, 0);
    const stableScope = React.useMemo<WorkspaceSyncEngineScope | null>(
        () => (machineId ? { serverId, machineId } : null),
        [machineId, serverId],
    );

    React.useEffect(() => {
        if (!stableScope) return;
        const unsubscribe = subscribeWorkspaceSyncEngineReadiness(stableScope, rerender);
        return unsubscribe;
    }, [stableScope]);

    return stableScope ? getWorkspaceSyncEngineReadinessSnapshot(stableScope) : UNSCOPED;
}
