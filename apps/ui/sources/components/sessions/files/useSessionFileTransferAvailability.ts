import * as React from 'react';

import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { useMachine, useServerScopedMachine, useSessionRpcAvailabilityState } from '@/sync/domains/state/storage';
import { useMachineRpcDirectRouteAvailability } from '@/sync/domains/transfers/runtime/useMachineRpcDirectRouteAvailability';
import {
    resolveSessionFileTransferAvailability,
    type ResolveSessionFileTransferAvailabilityResult,
} from '@/sync/domains/transfers/runtime/transferRuntime';
import { readMachineTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { usePreferredServerIdForSession } from '@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession';
import {
    isIrohMachineTransferLifecycleAvailable,
    probeIrohMachineTransferLifecycleAvailability,
    subscribeIrohMachineTransferLifecycleAvailability,
} from '@/sync/runtime/nativeIrohTunnels/machineTransferLifecycle';
import { isBrowserIrohHost } from '@/sync/runtime/browserIroh/hostEligibility';

export function useSessionFileTransferAvailabilityState(
    sessionId: string,
    sessionServerId?: string | null,
): ResolveSessionFileTransferAvailabilityResult {
    const { sessionExists } = useSessionRpcAvailabilityState(sessionId);
    const { machineRpcTargetAvailable } = useSessionMachineReachability(sessionId, sessionServerId);
    const serverId = usePreferredServerIdForSession({ serverId: sessionServerId, sessionId });
    const serverSnapshot = useServerFeaturesSnapshotForServerId(serverId, {
        enabled: Boolean(serverId) && machineRpcTargetAvailable,
    });
    const machineTarget = readMachineTargetForSession(serverId
        ? { serverId, sessionId }
        : sessionId);
    const globalMachine = useMachine(machineTarget?.machineId ?? '');
    const serverScopedMachine = useServerScopedMachine(serverId, machineTarget?.machineId ?? '');
    const machine = serverScopedMachine ?? globalMachine;
    const nativeMachineCarrierAvailable = React.useSyncExternalStore(
        subscribeIrohMachineTransferLifecycleAvailability,
        isIrohMachineTransferLifecycleAvailable,
        isIrohMachineTransferLifecycleAvailable,
    );
    React.useEffect(() => {
        void probeIrohMachineTransferLifecycleAvailability();
    }, []);
    const machineRpcRouteInput = machineTarget && serverId
        ? {
            serverId,
            remoteMachineId: machineTarget.machineId,
        }
        : null;
    const machineRpcRouteAvailability = useMachineRpcDirectRouteAvailability({
        serverId: machineRpcRouteInput?.serverId,
        remoteMachineId: machineRpcRouteInput?.remoteMachineId,
    });

    return resolveSessionFileTransferAvailability({
        sessionAvailable: sessionExists,
        machineTargetAvailable: machineRpcTargetAvailable,
        serverFeatures: serverSnapshot.status === 'ready' ? serverSnapshot.features : null,
        machineDaemonState: machine?.daemonState ?? null,
        machineKind: machine?.kind ?? null,
        machineOperationProtocolCapabilities: machine?.operationProtocolCapabilities ?? null,
        machineOperationProtocolCapabilitiesRevision: machine?.operationProtocolCapabilitiesRevision ?? null,
        machineActive: machine?.active ?? null,
        machineRevokedAt: machine?.revokedAt ?? null,
        machineCarrierHost: isBrowserIrohHost()
            ? { kind: 'browser' }
            : { kind: 'native', lifecycleAvailable: nativeMachineCarrierAvailable },
        machineRpcDirectRoute: machineRpcRouteAvailability === 'viable'
            ? { status: 'viable', checkedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER }
            : machineRpcRouteAvailability === 'unavailable'
                ? { status: 'unavailable', checkedAt: 0, expiresAt: 0, failureReason: 'machine_rpc_direct_unavailable' }
                : { status: 'unknown' },
    });
}

export function useSessionFileTransferAvailabilityResolver(
    sessionId: string,
    sessionServerId?: string | null,
): (transferSizeBytes?: number | null) => boolean {
    const availability = useSessionFileTransferAvailabilityState(sessionId, sessionServerId);

    return React.useCallback((transferSizeBytes?: number | null) => {
        void transferSizeBytes;
        return availability.available;
    }, [availability.available]);
}

export function useSessionFileTransferAvailability(sessionId: string, sessionServerId?: string | null): boolean {
    const canTransfer = useSessionFileTransferAvailabilityResolver(sessionId, sessionServerId);
    return canTransfer(null);
}
