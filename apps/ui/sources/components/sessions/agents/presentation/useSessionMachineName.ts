import { useSessionReachableMachineTarget } from '@/components/sessions/model/useSessionMachineReachability';
import { useMachine, useServerScopedMachine } from '@/sync/domains/state/storage';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';

/**
 * The name of the Machine a Session runs on ("MacBook Pro"), for copy that says where agents run and
 * what they wait for. `null` while the Machine is unknown, so copy falls back to a sentence without
 * a name rather than printing an id.
 */
export function useSessionMachineName(sessionId: string, serverId?: string | null): string | null {
    const target = useSessionReachableMachineTarget(sessionId, serverId);
    const machineId = target?.machineId ?? '';
    const scopedMachine = useServerScopedMachine(serverId, serverId ? machineId : '');
    const legacyMachine = useMachine(serverId ? '' : machineId);
    const machine = serverId ? scopedMachine : legacyMachine;
    if (!machine) return null;
    const name = getMachineDisplayName(machine).trim();
    return name.length > 0 ? name : null;
}
