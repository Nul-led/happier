import { useShallow } from 'zustand/react/shallow';

import { getStorage } from '@/sync/domains/state/storage';
import { resolveServerScopedMachine } from '@/sync/store/domains/machines/resolveServerScopedMachine';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';

import {
    resolveSessionMachineReachabilityState,
    type SessionMachineReachability,
} from './resolveSessionMachineReachability';

/**
 * What a pane header says about the machine a tab runs on ("~/happier on MacBook Pro", "MacBook Pro is
 * offline"): its name, its home folder for `~` paths, and whether it is reachable. Primitives only, so
 * a heartbeat that does not flip presence re-renders nothing.
 *
 * `reachability` is the existing session reachability vocabulary: `unknown` when the machine record
 * is not visible from here (a shared Session), which callers must not present as offline.
 */
export type MachinePresenceSummary = Readonly<{
    name: string | null;
    homeDir: string | null;
    reachability: SessionMachineReachability;
}>;

type MachinePresenceStorageState = Parameters<typeof resolveServerScopedMachine>[0];

export function useMachinePresenceSummary(
    serverId: string | null | undefined,
    machineId: string | null | undefined,
): MachinePresenceSummary {
    return getStorage()(useShallow((state): MachinePresenceSummary => {
        const machine = machineId
            ? resolveServerScopedMachine(state as MachinePresenceStorageState, serverId, machineId)
            : null;
        const name = machine ? getMachineDisplayName(machine).trim() : '';
        const homeDir = machine?.metadata?.homeDir?.trim() ?? '';
        return {
            name: name.length > 0 ? name : null,
            homeDir: homeDir.length > 0 ? homeDir : null,
            reachability: resolveSessionMachineReachabilityState({
                machineIsKnown: Boolean(machine),
                machineIsOnline: machine ? isMachineOnline(machine) : false,
            }),
        };
    }));
}
