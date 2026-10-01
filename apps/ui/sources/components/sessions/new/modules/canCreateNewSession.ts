import type { Machine } from '@/sync/domains/state/storageTypes';
import { canAttemptMachineSpawn, type MachineSpawnReadiness } from '@/sync/domains/machines/identity/resolveMachineSpawnReadiness';
import type { SessionAuthoringExecutionTargetV2 } from '@happier-dev/protocol';

export function isHostBoundNewSessionMachine(params: Readonly<{
    selectedMachineId: string | null;
    hostBoundMachineId?: string | null;
    directoryKind?: 'path' | 'managed';
}>): boolean {
    return Boolean(params.selectedMachineId)
        && params.directoryKind === 'managed'
        && params.selectedMachineId === params.hostBoundMachineId;
}

export function canCreateNewSession(params: Readonly<{
    selectedMachineId: string | null;
    selectedMachine: Machine | null;
    /** An injected creation host owns this exact managed-directory machine. */
    hostBoundMachineId?: string | null;
    selectedPath: string;
    /** `managed`: no folder is needed; the machine keeps a private one. */
    directoryKind?: 'path' | 'managed';
    spawnReadiness?: MachineSpawnReadiness | null;
    executionTarget?: SessionAuthoringExecutionTargetV2 | null;
}>): boolean {
    if (params.executionTarget?.kind === 'temporary_computer') {
        return true;
    }
    if (!params.selectedMachineId) return false;
    if (params.directoryKind !== 'managed' && !params.selectedPath.trim()) return false;
    if (isHostBoundNewSessionMachine(params)) return true;
    if (!params.selectedMachine) return false;
    return canAttemptMachineSpawn({
        selectedMachineId: params.selectedMachineId,
        machine: params.selectedMachine,
        spawnReadiness: params.spawnReadiness,
    });
}
