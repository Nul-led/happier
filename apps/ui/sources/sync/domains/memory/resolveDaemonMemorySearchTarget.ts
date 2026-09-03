import { MACHINE_ADMINISTRATION_SELECTION_KEYS_V1 } from '@/sync/domains/machines/administration/selectionPreferences';
import {
    useMachineAdministrationTargetSelection,
    type MachineAdministrationTargetSelectionV1,
} from '@/sync/domains/machines/administration/useTargetSelection';
import { isMachineAdministrationCandidateSelectable } from '@/sync/domains/machines/administration/targetSelection';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

/**
 * Exact daemon-memory request target: the machine whose local index holds the
 * plaintext, plus the server scope that routes the RPC to it.
 */
export type DaemonMemorySearchTargetV1 = Readonly<{
    serverId: string;
    machineId: string;
}>;

/**
 * Re-resolves the explicitly selected memory machine from current owner state.
 *
 * Daemon memory search is per-machine by construction, so it uses the same
 * persisted Administration selection that Memory settings configures. There is
 * deliberately no first-machine fallback and no all-machine fanout: without a
 * usable explicit target the caller shows a truthful unavailable state instead
 * of querying an arbitrary daemon.
 */
export function resolveDaemonMemorySearchTarget(
    selection: Pick<MachineAdministrationTargetSelectionV1, 'resolveExecutionTarget' | 'pickerRows'>,
    requestedTarget?: Readonly<{ serverId: string; machineId: string }> | null,
): DaemonMemorySearchTargetV1 | null {
    if (requestedTarget) {
        const requestedServerId = String(requestedTarget.serverId ?? '').trim();
        const requestedMachineId = String(requestedTarget.machineId ?? '').trim();
        if (!requestedServerId || !requestedMachineId) return null;
        const row = selection.pickerRows.find((candidate) => (
            areServerProfileIdentifiersEquivalent(candidate.serverId, requestedServerId)
            && candidate.candidate.target.machineId === requestedMachineId
            && isMachineAdministrationCandidateSelectable(candidate.candidate)
        ));
        return row ? { serverId: row.serverId, machineId: requestedMachineId } : null;
    }
    const resolved = selection.resolveExecutionTarget();
    if (!resolved) return null;
    const serverId = String(resolved.serverId ?? '').trim();
    const machineId = String(resolved.machine?.id ?? '').trim();
    if (!serverId || !machineId) return null;
    return { serverId, machineId };
}

/** Live binding of {@link resolveDaemonMemorySearchTarget} to the selection owner. */
export function useDaemonMemorySearchTargetSelection(): MachineAdministrationTargetSelectionV1 {
    return useMachineAdministrationTargetSelection(MACHINE_ADMINISTRATION_SELECTION_KEYS_V1.memory);
}
