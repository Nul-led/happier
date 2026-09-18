import type { Machine } from '@/sync/domains/state/storageTypes';
import { isPersistentMachine } from '@happier-dev/protocol';

import { isMachineReplaced } from './machineIdentityTypes';

export function isMachineVisibleForSelection(machine: Machine): boolean {
    const revokedAt = machine.revokedAt;
    return isPersistentMachine(machine)
        && !(typeof revokedAt === 'number' && Number.isFinite(revokedAt) && revokedAt > 0);
}

export function isMachineVisibleForLaunchSelection(machine: Machine): boolean {
    return isMachineVisibleForSelection(machine) && !isMachineReplaced(machine);
}

export function filterVisibleMachinesForLaunchSelection(machines: ReadonlyArray<Machine>): Machine[] {
    return machines.filter(isMachineVisibleForLaunchSelection);
}
