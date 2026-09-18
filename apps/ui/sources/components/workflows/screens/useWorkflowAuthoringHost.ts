import * as React from 'react';

import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';

import type { AuthoringComposerScope } from '@/components/sessions/authoring/ScopedAuthoringComposer';
import type { SessionAuthoringControlFacts } from '@/components/sessions/authoring/controls/sessionAuthoringFieldControls';
import { useSessionAuthoringControlFacts } from '@/components/sessions/authoring/controls/useSessionAuthoringControlFacts';
import { isAutomationSessionCandidate } from '@/sync/domains/automations/isAutomationSessionCandidate';
import { useAllMachines, useSessions, useSettings } from '@/sync/domains/state/storage';
import { readDisplayMachineIdForSession } from '@/sync/ops/sessionMachineTarget';
import type { WorkflowExistingSessionOption } from '@/sync/domains/workflows/workflowAuthoring';
import { getSessionName } from '@/utils/sessions/sessionUtils';

export type WorkflowAuthoringHostContext = Readonly<{
    /** Option sources for the shared Session-authoring controls. */
    authoringFacts: SessionAuthoringControlFacts;
    /** Where every step prompt resolves references, files and attachments. */
    composerScope: AuthoringComposerScope;
    /**
     * Existing Sessions a step may continue: the canonical Automation Session
     * candidacy, each with the exact Machine the canonical target owner reads
     * for it. Once this workflow's Machine is known, only Sessions on that
     * Machine are offered, because the coordinator refuses any other.
     */
    existingSessions: readonly WorkflowExistingSessionOption[];
}>;

/**
 * The one adapter every Workflow editor host uses to supply the controlled
 * editor with its host-owned context.
 *
 * The editor body is deliberately controlled: it reads no store and resolves no
 * catalog, so a host that contributes nothing leaves the Agent picker with no
 * options while the strict Workflow schema still requires an effective Agent,
 * and leaves every step prompt without reference or attachment scope. Both
 * facts come from the same place — the exact Machine this workflow runs on —
 * so one adapter resolves them together and all three hosts consume it rather
 * than each assembling its own.
 *
 * A captured Session keeps its own exact Session scope: it is a genuine live
 * context, not a Machine substitute.
 */
export function useWorkflowAuthoringHost(params: Readonly<{
    /** Present only for a Session-origin draft that captured its Session. */
    capturedSession?: Readonly<{ sessionId: string; serverId?: string | null }> | undefined;
    projectTarget: WorkflowProjectTargetV1 | null | undefined;
    serverId: string | null;
}>): WorkflowAuthoringHostContext {
    const { capturedSession, serverId } = params;
    const machineId = params.projectTarget?.machineId ?? null;
    const directory = params.projectTarget?.directory ?? null;
    const machines = useAllMachines();
    const machineHomeDir = React.useMemo(() => (
        machineId === null
            ? null
            : machines.find((machine) => machine.id === machineId)?.metadata?.homeDir ?? null
    ), [machineId, machines]);

    const authoringFacts = useSessionAuthoringControlFacts({ machineId, serverId, directory });

    const sessions = useSessions();
    const settings = useSettings();
    const existingSessions = React.useMemo<readonly WorkflowExistingSessionOption[]>(() => {
        const options: WorkflowExistingSessionOption[] = [];
        for (const session of sessions ?? []) {
            if (serverId !== null && session.serverId !== serverId) continue;
            if (!isAutomationSessionCandidate(session, settings)) continue;
            const sessionMachineId = readDisplayMachineIdForSession({ sessionId: session.id, metadata: session.metadata });
            // A Session whose Machine the canonical owner cannot name is not
            // offered: the selection records the exact Machine, and guessing
            // one would author a continuation the coordinator refuses.
            if (sessionMachineId.length === 0) continue;
            if (machineId !== null && sessionMachineId !== machineId) continue;
            options.push({ sessionId: session.id, machineId: sessionMachineId, label: getSessionName(session) });
        }
        return options;
        // `machines` is read imperatively by the canonical target owner, so it
        // is a dependency even though it is not referenced here.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    }, [machineId, machines, serverId, sessions, settings]);

    const capturedSessionId = capturedSession?.sessionId ?? null;
    const capturedServerId = capturedSession?.serverId ?? null;
    const composerScope = React.useMemo<AuthoringComposerScope>(() => (
        capturedSessionId === null
            ? { kind: 'machine', machineId, serverId, directory, machineHomeDir }
            : { kind: 'session', sessionId: capturedSessionId, serverId: capturedServerId }
    ), [capturedServerId, capturedSessionId, directory, machineHomeDir, machineId, serverId]);

    return React.useMemo(
        () => ({ authoringFacts, composerScope, existingSessions }),
        [authoringFacts, composerScope, existingSessions],
    );
}
