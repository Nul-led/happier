import * as React from 'react';

import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { useMachineLiveStreamRelaySocket } from '@/components/stream/useMachineLiveStreamRelaySocket';
import type { ServerScopedMachineLiveStreamRelaySocket } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineLiveStreamRelaySocket';

/**
 * The simulator's relay socket: the shared machine live-stream socket owner, opened only while the
 * `devices.simulatorPreview` decision is enabled for this scope.
 */
export function useSimulatorLiveStreamRelaySocket(input: Readonly<{
    machineId?: string | null;
    serverId?: string | null;
    enabled?: boolean;
}>): ServerScopedMachineLiveStreamRelaySocket | null {
    const enabled = input.enabled ?? true;
    const machineId = String(input.machineId ?? '').trim();
    const serverId = String(input.serverId ?? '').trim();

    const featureScope = React.useMemo(() => (
        serverId
            ? { scopeKind: 'spawn' as const, serverId }
            : { scopeKind: 'runtime' as const }
    ), [serverId]);
    const featureDecision = useFeatureDecision('devices.simulatorPreview', featureScope);
    const featureEnabled = featureDecision?.state === 'enabled';

    return useMachineLiveStreamRelaySocket({
        machineId,
        serverId,
        enabled: enabled && featureEnabled,
        disconnectTag: 'simulator-live-stream-relay-disconnect',
    });
}
