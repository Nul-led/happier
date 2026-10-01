import * as React from 'react';

import {
    resolveServerScopedMachineLiveStreamRelaySocket,
    type ServerScopedMachineLiveStreamRelaySocket,
} from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineLiveStreamRelaySocket';
import { fireAndForget } from '@/utils/system/fireAndForget';

/**
 * The production `server_relay` viewer socket for one source machine, whatever the stream shows
 * (a simulator, the agent's browser). Opened only while `enabled` and a machine id is known, and
 * disconnected on teardown or when the machine changes. A surface's own policy (a feature decision)
 * decides `enabled`; this owner only owns the socket's lifetime.
 */
export function useMachineLiveStreamRelaySocket(input: Readonly<{
    machineId?: string | null;
    serverId?: string | null;
    enabled?: boolean;
    disconnectTag: string;
}>): ServerScopedMachineLiveStreamRelaySocket | null {
    const enabled = input.enabled ?? true;
    const machineId = String(input.machineId ?? '').trim();
    const serverId = String(input.serverId ?? '').trim();
    const tag = input.disconnectTag;
    const [socket, setSocket] = React.useState<ServerScopedMachineLiveStreamRelaySocket | null>(null);

    React.useEffect(() => {
        if (!enabled || !machineId) {
            setSocket(null);
            return;
        }
        let disposed = false;
        let resolved: ServerScopedMachineLiveStreamRelaySocket | null = null;
        resolveServerScopedMachineLiveStreamRelaySocket({ machineId, serverId: serverId || null })
            .then((next) => {
                if (disposed) {
                    fireAndForget(next.disconnect(), { tag });
                    return;
                }
                resolved = next;
                setSocket(next);
            })
            .catch(() => {
                if (!disposed) setSocket(null);
            });
        return () => {
            disposed = true;
            fireAndForget(resolved?.disconnect(), { tag });
            setSocket(null);
        };
    }, [enabled, machineId, serverId, tag]);

    return socket;
}
