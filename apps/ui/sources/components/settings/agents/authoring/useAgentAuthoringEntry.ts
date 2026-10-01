import * as React from 'react';

import { MACHINES_ADD_ROUTE } from '@/components/settings/machines/collection/machineCollectionModel';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import type { AgentAdministrationCatalog } from '../collection/useAgentAdministrationCatalog';
import { useOpenAgentAuthoringSession, type AgentAuthoringIntent } from './agentAuthoringSession';

/**
 * An "ask an agent" entry in Agents settings. It is available when the Account has a machine to
 * run a session on; otherwise opening it goes to machine setup, so the entry is never a dead tap.
 */
export function useAgentAuthoringEntry(catalog: Pick<AgentAdministrationCatalog, 'targetSelection' | 'executionTarget'>) {
    const router = useRouter();
    const available = catalog.targetSelection.candidates.length > 0;
    const target = catalog.executionTarget
        ? { serverId: catalog.executionTarget.serverId, machineId: catalog.executionTarget.machine.id }
        : null;
    const stableTarget = React.useMemo(() => target, [target?.serverId, target?.machineId]);
    const openSession = useOpenAgentAuthoringSession(stableTarget);
    const open = React.useCallback((intent: AgentAuthoringIntent) => {
        if (available) {
            openSession(intent);
            return;
        }
        const result = runGuardedNavigation(() => router.push(MACHINES_ADD_ROUTE as never));
        if (result !== true) fireAndForget(result, { tag: 'useAgentAuthoringEntry.setUpMachine' });
    }, [available, openSession, router]);
    return { available, open } as const;
}
