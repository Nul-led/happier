import * as React from 'react';

import { useVisibleSessionListSummaryState } from '@/hooks/session/useVisibleSessionListSummaryState';
import { useAllMachines, useMachineListByServerId, useMachineListStatusByServerId } from '@/sync/domains/state/storage';
import { useHomeViewSelectionSettings } from '@/hooks/server/useHomeViewSelectionSettings';

import type { SessionGettingStartedViewModel } from './gettingStartedModel';
import { buildSessionGettingStartedViewModel } from './gettingStartedModel';
import { useSessionGettingStartedActiveServerProfile } from './useSessionGettingStartedActiveServerProfile';

export function useSessionGettingStartedGuidanceBaseModel(): SessionGettingStartedViewModel {
    const { selection: summarySelection, summary: sessionSummary } = useVisibleSessionListSummaryState();
    const { serverSelectionGroups } = useHomeViewSelectionSettings();
    const activeMachines = useAllMachines();
    const machineListByServerId = useMachineListByServerId();
    const machineListStatusByServerId = useMachineListStatusByServerId();
    const selectionSnapshot = React.useMemo(() => ({
        activeTarget: summarySelection.activeTarget,
        activeServerId: summarySelection.activeServerId,
        allowedServerIds: summarySelection.allowedServerIds,
    }), [
        summarySelection.activeTarget,
        summarySelection.activeServerId,
        summarySelection.allowedServerIds,
    ]);
    const activeServerProfile = useSessionGettingStartedActiveServerProfile(summarySelection.activeServerId);

    return React.useMemo(() => {
        return buildSessionGettingStartedViewModel({
            sessionsReady: sessionSummary.sessionsReady,
            sessionCount: sessionSummary.sessionCount,
            activeMachines,
            selection: selectionSnapshot,
            serverSelectionGroups,
            activeServerProfile,
            machineListByServerId,
            machineListStatusByServerId,
        });
    }, [
        activeServerProfile,
        activeMachines,
        machineListByServerId,
        machineListStatusByServerId,
        selectionSnapshot,
        serverSelectionGroups,
        sessionSummary.sessionCount,
        sessionSummary.sessionsReady,
    ]);
}
