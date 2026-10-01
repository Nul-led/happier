import * as React from 'react';

import { isAutomationSessionCandidate } from '@/sync/domains/automations/isAutomationSessionCandidate';
import { useAllMachines, useSessions, useSettings } from '@/sync/domains/state/storage';
import type { WorkflowExistingSessionOption } from '@/sync/domains/workflows/workflowAuthoring';
import { readDisplayMachineIdForSession } from '@/sync/ops/sessionMachineTarget';
import { getSessionName } from '@/utils/sessions/sessionUtils';

/**
 * The existing Sessions a workflow step or an Account trigger's prompt may continue (01 §5.5): the
 * canonical Automation Session candidacy, each with the exact Machine the canonical target owner
 * reads for it. Once a Machine is known only its Sessions are offered, because the coordinator
 * refuses a Session on another Machine.
 */
export function useWorkflowExistingSessionOptions(params: Readonly<{
    serverId: string | null;
    machineId: string | null;
}>): Readonly<{
    existingSessions: readonly WorkflowExistingSessionOption[];
    /** Every continuable Session on any Machine: what the Session drop target resolves against. */
    sessionDropCandidates: readonly WorkflowExistingSessionOption[];
}> {
    const { serverId, machineId } = params;
    const machines = useAllMachines();
    const sessions = useSessions();
    const settings = useSettings();
    // Every Session the canonical candidacy owner can continue, on any Machine
    // of this server: the drop target needs them to state *why* a Session on
    // another Machine is refused (07 J19), while the picker offers only the
    // Where Machine's.
    const sessionDropCandidates = React.useMemo<readonly WorkflowExistingSessionOption[]>(() => {
        const options: WorkflowExistingSessionOption[] = [];
        for (const session of sessions ?? []) {
            if (serverId !== null && session.serverId !== serverId) continue;
            if (!isAutomationSessionCandidate(session, settings)) continue;
            const sessionMachineId = readDisplayMachineIdForSession({ sessionId: session.id, metadata: session.metadata });
            // A Session whose Machine the canonical owner cannot name is not
            // offered: the selection records the exact Machine, and guessing
            // one would author a continuation the coordinator refuses.
            if (sessionMachineId.length === 0) continue;
            options.push({ sessionId: session.id, machineId: sessionMachineId, label: getSessionName(session) });
        }
        return options;
        // `machines` is read imperatively by the canonical target owner, so it
        // is a dependency even though it is not referenced here.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    }, [machines, serverId, sessions, settings]);
    const existingSessions = React.useMemo<readonly WorkflowExistingSessionOption[]>(() => (
        machineId === null
            ? sessionDropCandidates
            : sessionDropCandidates.filter((option) => option.machineId === machineId)
    ), [machineId, sessionDropCandidates]);

    return { existingSessions, sessionDropCandidates };
}
