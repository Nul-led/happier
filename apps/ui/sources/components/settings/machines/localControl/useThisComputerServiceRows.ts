import * as React from 'react';

import { getDefaultSystemTaskRunner } from '@/components/systemTasks';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import {
    projectThisComputerServiceRowsForApp,
    type ThisComputerServiceRows,
} from '@/sync/domains/server/relayDrift/thisComputerConnection';

import { readLocalDaemonSharedState, subscribeLocalDaemonSharedState } from './localDaemonSharedState';
import type { LocalDaemonStatusData } from './useLocalDaemonControl';
import { useAppAccountIdentity } from './useThisComputerConnection';

/**
 * Every Home this computer serves, one row per service, from the one shared status of this computer
 * (R13C-F4): the executor's rows, with only the app's own Home judged again against the app's
 * account. It starts no read of its own — the status every "this computer" surface shares is read
 * by its owners and re-read after a native service change — so Settings, the popover and the tray
 * always list the same rows in the same states.
 */
export function useThisComputerServiceRows(options: Readonly<{ runner?: SystemTaskRunner }> = {}): ThisComputerServiceRows {
    const runner = options.runner ?? getDefaultSystemTaskRunner();
    const subscribe = React.useCallback((listener: () => void) => subscribeLocalDaemonSharedState(runner, listener), [runner]);
    const readStatus = React.useCallback(() => readLocalDaemonSharedState<LocalDaemonStatusData>(runner).status, [runner]);
    const status = React.useSyncExternalStore(subscribe, readStatus, readStatus);
    const activeServer = useActiveServerSnapshot();
    const { accountId } = useAppAccountIdentity();
    return React.useMemo(() => projectThisComputerServiceRowsForApp({
        status,
        activeRelayUrl: activeServer.serverUrl,
        activeLocalRelayUrl: activeServer.activeLocalRelayUrl ?? null,
        appAccountId: accountId,
    }), [accountId, activeServer.activeLocalRelayUrl, activeServer.serverUrl, status]);
}
