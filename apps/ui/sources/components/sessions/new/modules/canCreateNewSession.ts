import type { Machine } from '@/sync/domains/state/storageTypes';
import { canAttemptMachineSpawn, type MachineSpawnReadiness } from '@/sync/domains/machines/identity/resolveMachineSpawnReadiness';
import type { SessionAuthoringExecutionTargetV2 } from '@happier-dev/protocol';

export function canCreateNewSession(params: Readonly<{
    selectedMachineId: string | null;
    selectedMachine: Machine | null;
    selectedPath: string;
    allowOfflineMachine?: boolean;
    spawnReadiness?: MachineSpawnReadiness | null;
    executionTarget?: SessionAuthoringExecutionTargetV2 | null;
}>): boolean {
    if (params.executionTarget?.kind === 'temporary_computer') {
        return true;
    }
    if (!params.selectedMachineId) return false;
    if (!params.selectedPath.trim()) return false;
    if (!params.selectedMachine) return false;
    if (params.allowOfflineMachine === true) return true;
    return canAttemptMachineSpawn({
        selectedMachineId: params.selectedMachineId,
        machine: params.selectedMachine,
        spawnReadiness: params.spawnReadiness,
    });
}
