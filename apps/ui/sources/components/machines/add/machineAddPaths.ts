import type { Machine } from '@/sync/domains/state/storageTypes';
import type { SetupSurfacePolicy } from '@/sync/domains/server/setup/setupSurfacePolicy';

export type MachineAddPathId = 'thisComputer' | 'ssh' | 'anotherComputer';
/**
 * One way to add a machine. `connectedMachineId`: this computer is already a machine of the Home, so the
 * path answers "is this computer set up?" with the computer itself instead of a setup (lab agent-setup S1).
 */
export type MachineAddPath = Readonly<{ id: MachineAddPathId; runs: 'task' | 'command'; connectedMachineId?: string }>;
export type MachineAddDevice = 'desktop' | 'browser' | 'phone';
export type MachineAddPathsInput = Readonly<{
    device: MachineAddDevice;
    thisComputerJoined: boolean;
    /** The joined computer's machine id (desktop), shown as connected rather than hidden. */
    thisComputerMachineId?: string | null;
    nativeSshAvailable: boolean;
    policy: SetupSurfacePolicy['machine'];
}>;

export function resolveMachineAddPaths(input: MachineAddPathsInput): readonly MachineAddPath[] {
    const paths: MachineAddPath[] = [];
    if (input.policy.allowLocalMachineSetup && input.device === 'desktop' && input.thisComputerJoined && input.thisComputerMachineId) {
        paths.push({ id: 'thisComputer', runs: 'task', connectedMachineId: input.thisComputerMachineId });
    } else if (input.policy.allowLocalMachineSetup && input.device !== 'phone'
        && (input.device === 'browser' || !input.thisComputerJoined)) {
        paths.push({ id: 'thisComputer', runs: input.device === 'desktop' ? 'task' : 'command' });
    }
    if (input.policy.allowRemoteSshMachineSetup && (input.device !== 'phone' || input.nativeSshAvailable)) {
        paths.push({ id: 'ssh', runs: input.device === 'browser' ? 'command' : 'task' });
    }
    if (input.policy.allowLocalMachineSetup) paths.push({ id: 'anotherComputer', runs: 'command' });
    return paths;
}

/** Offline machines count; revoked machines do not. Unknown lists remain unknown. */
export function homeHasMachine(machines: readonly Machine[] | null | undefined): boolean | null {
    if (!machines) return null;
    return machines.some((machine) => !machine.revokedAt);
}

export function isThisComputerMachineOfHome(machineId: string | null, machines: readonly Machine[] | null | undefined): boolean {
    return Boolean(machineId && machines?.some((machine) => machine.id === machineId && !machine.revokedAt));
}

export function resolveMachineSetupSatisfied(summary: Readonly<{ machineCount: number; hasUnknownServers: boolean }>): boolean | null {
    return summary.machineCount > 0 ? true : summary.hasUnknownServers ? null : false;
}
