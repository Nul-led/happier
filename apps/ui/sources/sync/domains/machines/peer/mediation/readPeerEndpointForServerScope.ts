import type { Machine } from '@/sync/domains/state/storageTypes';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { getAppliedActiveServerId } from '@/sync/runtime/orchestration/connectionManager';

type PeerEndpointState = Readonly<{
    machines: Readonly<Record<string, Machine | undefined>>;
    machineListByServerId?: Readonly<Record<string, readonly Machine[] | null | undefined>>;
}>;

export function readPeerEndpointForServerScope<TEndpoint>(params: Readonly<{
    state: PeerEndpointState;
    serverId: string;
    machineId: string;
    select: (machine: Machine) => TEndpoint | null | undefined;
}>): TEndpoint | null {
    const machineId = String(params.machineId ?? '').trim();
    const serverId = String(params.serverId ?? '').trim();
    const activeServerId = String(getAppliedActiveServerId() ?? '').trim();
    if (!machineId || !serverId) return null;

    const targetsActiveHome = activeServerId.length > 0
        && areServerProfileIdentifiersEquivalent(serverId, activeServerId);
    const machine = targetsActiveHome
        ? params.state.machines[machineId] ?? null
        : params.state.machineListByServerId?.[serverId]?.find((candidate) => candidate.id === machineId) ?? null;
    return machine ? params.select(machine) ?? null : null;
}
