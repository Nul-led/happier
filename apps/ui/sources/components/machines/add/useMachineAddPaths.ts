import * as React from 'react';
import { Platform } from 'react-native';
import { getNativeSshAvailability } from '@happier-dev/ssh-native';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useMachineListByServerId } from '@/sync/domains/state/storage';
import { resolveSetupSurfacePolicy } from '@/sync/domains/server/setup/setupSurfacePolicy';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { getSystemTasksRunner } from '@/components/systemTasks/systemTasksRuntime';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import {
    readLocalDaemonSharedState,
    subscribeLocalDaemonSharedState,
} from '@/components/settings/machines/localControl/localDaemonSharedState';
import type { LocalDaemonStatusData } from '@/components/settings/machines/localControl/useLocalDaemonControl';
import { isThisComputerMachineOfHome, resolveMachineAddPaths, type MachineAddPath } from './machineAddPaths';

/** Reads the canonical status projection; it does not start another daemon status task. */
export function useMachineAddPaths(serverId?: string, taskRunner?: SystemTaskRunner): readonly MachineAddPath[] {
    const activeServer = useActiveServerSnapshot();
    const machinesByServer = useMachineListByServerId();
    const runner = taskRunner ?? getSystemTasksRunner();
    const subscribe = React.useCallback((listener: () => void) => subscribeLocalDaemonSharedState(runner, listener), [runner]);
    const read = React.useCallback(() => readLocalDaemonSharedState<LocalDaemonStatusData>(runner), [runner]);
    const daemon = React.useSyncExternalStore(subscribe, read, read);
    const device = isDesktopHost() ? 'desktop' : Platform.OS === 'web' ? 'browser' : 'phone';
    const nativeSshAvailable = device === 'phone' && getNativeSshAvailability().available === true;
    const policy = React.useMemo(() => resolveSetupSurfacePolicy().machine, []);
    const machines = machinesByServer[serverId ?? activeServer.serverId];
    const thisMachineId = daemon.status?.machineId ?? null;
    const joined = isThisComputerMachineOfHome(thisMachineId, machines);
    return React.useMemo(() => resolveMachineAddPaths({
        device, thisComputerJoined: joined, thisComputerMachineId: joined ? thisMachineId : null, nativeSshAvailable, policy,
    }), [device, joined, nativeSshAvailable, policy, thisMachineId]);
}
