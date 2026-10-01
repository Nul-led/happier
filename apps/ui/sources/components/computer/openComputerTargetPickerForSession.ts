import type { ComputerAccessV1, ComputerSelectedTargetResponseV1 } from '@happier-dev/protocol';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import { readSessionPresentationAgentId } from '@/sync/domains/session/presentation/readSessionPresentationAgentId';
import { noteSessionComputerMachine } from '@/sync/domains/computer/sessionComputerMachines';
import { getStorage } from '@/sync/domains/state/storage';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { t } from '@/text';
import { getSessionName, getSessionSubtitle } from '@/utils/sessions/sessionUtils';

import type { ComputerTargetEntry } from './ComputerTargetPicker';
import { showComputerTargetPicker } from './showComputerTargetPicker';

/** The folder a Session works in, as its last path segment ("~/src/happier" → "happier"). */
function readProjectLabel(subtitle: string): string | null {
    const segment = subtitle.split(/[\\/]/).filter(Boolean).pop()?.trim() ?? '';
    return segment && segment !== '~' && segment !== t('status.unknown') ? segment : null;
}

/**
 * Opens the target picker for a Session from a surface that renders without the store (the chat's
 * approval card loads this module on the press, not at render). The agent's name is read once, at the
 * person's intent, from the Session the request belongs to.
 */
export function openComputerTargetPickerForSession(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
    machineId: string;
    machineName: string;
    currentTargetKey?: string | null;
    access?: ComputerAccessV1;
    onSelected: (selection: ComputerSelectedTargetResponseV1) => void;
    onStoppedSharing?: () => void;
    /** Approval of an agent's `computer.target.select`: its suggestion, and where the pick goes. */
    requestedTarget?: string | null;
    onChosen?: (entry: ComputerTargetEntry, access: ComputerAccessV1) => void;
}>): void {
    const session = getStorage().getState().sessions[params.sessionId] ?? null;
    // Computer use targets the Session's own machine (orchestrator ruling 2026-10-01): a request naming
    // another machine opens the picker on its typed refusal, never on that other machine.
    const sessionMachineId = readMachineControlTargetForSession(params.serverId
        ? { serverId: params.serverId, sessionId: params.sessionId }
        : params.sessionId)?.machineId ?? null;
    const refusalCode = sessionMachineId && sessionMachineId !== params.machineId ? 'computer_machine_mismatch' : null;
    const agentId = session ? readSessionPresentationAgentId(session) : null;
    const core = agentId ? getAgentCore(agentId as AgentId) : null;
    const sessionName = session ? getSessionName(session, params.serverId ?? null) : null;
    const project = session ? readProjectLabel(getSessionSubtitle(session, params.serverId ?? null)) : null;
    const purpose = sessionName
        ? project ? t('computerUse.picker.purposeIn', { session: sessionName, project }) : t('computerUse.picker.purpose', { session: sessionName })
        : null;
    showComputerTargetPicker({
        purpose,
        scope: { sessionId: params.sessionId, machineId: params.machineId, serverId: params.serverId ?? null },
        agentName: core ? t(core.displayNameKey) : t('browserPresence.agentFallbackName'),
        machineName: params.machineName,
        currentTargetKey: params.currentTargetKey ?? null,
        access: params.access,
        ...(refusalCode ? { refusalCode } : {}),
        ...(params.onStoppedSharing ? { onStoppedSharing: params.onStoppedSharing } : {}),
        ...(params.requestedTarget ? { requestedTarget: params.requestedTarget } : {}),
        ...(params.onChosen ? { onChosen: params.onChosen } : {}),
        onSelected: (selection) => {
            // The session-wide line now knows where to ask who is using the window.
            noteSessionComputerMachine({ sessionId: params.sessionId, machineId: params.machineId,
                machineName: selection.approvalDisplay.machineDisplayName });
            params.onSelected(selection);
        },
    });
}
