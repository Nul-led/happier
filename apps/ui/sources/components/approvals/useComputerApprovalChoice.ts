import * as React from 'react';
import type { ComputerAccessV1, ComputerApprovalDisplayV1, ComputerTargetV1 } from '@happier-dev/protocol';

import { noteSessionComputerMachine } from '@/sync/domains/computer/sessionComputerMachines';

import { applyComputerSelection, describeComputerActionApproval, type ComputerActionApproval } from './ComputerActionApprovalCard';

type OpenComputerTargetPicker = typeof import('@/components/computer/openComputerTargetPickerForSession').openComputerTargetPickerForSession;

export type ComputerApprovalChoice = Readonly<{
    /** What the approval asks for, with the person's pick applied (null for other Actions). */
    presentation: ComputerActionApproval | null;
    /** Opens the picker for this approval (choose a window, or change the agent's suggestion). */
    chooseTarget: () => void;
    /** What the decision carries: the picked window for an agent's `computer.target.select` (W15). */
    decisionOptions: Readonly<{ computerTarget?: ComputerTargetV1; computerAccess?: ComputerAccessV1 }>;
    /** Approving an agent's window choice needs an exact window first: Approve opens the picker. */
    needsChoiceBeforeApprove: boolean;
}>;

/**
 * The one owner of a computer approval's person-side choice, for the chat card and the approval page:
 * the request's own display facts (frozen at creation) with the person's pick applied, the picker, and
 * the decision options. For an agent's `computer.target.select` the picker opens on its suggestion and
 * the pick returns here, so approving shares exactly that window with the agent's provenance; for any
 * other computer Action the pick is shared directly by the person.
 */
export function useComputerApprovalChoice(input: Readonly<{
    actionId: string;
    actionArgs: unknown;
    preview: unknown;
    sessionId: string;
    serverId?: string | null;
    /** The picker opener, resolved on the press (surfaces that render without the store pass a require). */
    resolveOpenPicker: () => OpenComputerTargetPicker;
}>): ComputerApprovalChoice {
    const [chosenDisplay, setChosenDisplay] = React.useState<ComputerApprovalDisplayV1 | null>(null);
    const [chosenTarget, setChosenTarget] = React.useState<ComputerTargetV1 | null>(null);
    const [chosenAccess, setChosenAccess] = React.useState<ComputerAccessV1 | null>(null);
    const described = React.useMemo(
        () => describeComputerActionApproval({ actionId: input.actionId, actionArgs: input.actionArgs, preview: input.preview }),
        [input.actionArgs, input.actionId, input.preview],
    );
    const presentation = React.useMemo(
        () => (described ? applyComputerSelection(described, chosenDisplay) : null),
        [chosenDisplay, described],
    );
    const { sessionId, serverId, resolveOpenPicker } = input;
    const machineId = described?.machineId ?? null;
    const machineName = described?.machineName ?? null;
    React.useEffect(() => {
        if (machineId) noteSessionComputerMachine({ sessionId, machineId, machineName });
    }, [machineId, machineName, sessionId]);

    const chooseTarget = React.useCallback(() => {
        if (!described) return;
        const open = resolveOpenPicker();
        const share = described.act === 'share';
        open({
            sessionId,
            serverId: serverId ?? null,
            machineId: described.machineId,
            machineName: described.machineName,
            access: presentation?.access ?? described.access,
            ...(share
                ? {
                    requestedTarget: described.suggestion ?? null,
                    onChosen: (entry, access) => {
                        setChosenTarget(entry.target);
                        setChosenAccess(access);
                        setChosenDisplay({
                            machineDisplayName: described.machineName,
                            requiresTargetSelection: false,
                            access,
                            ...(entry.appName ? { appName: entry.appName } : {}),
                            target: { kind: entry.target.kind, title: entry.target.kind === 'display' ? entry.label ?? entry.title ?? '' : entry.title ?? '' },
                        });
                    },
                }
                : {}),
            onSelected: (selection) => setChosenDisplay(selection.approvalDisplay),
        });
    }, [described, presentation?.access, resolveOpenPicker, serverId, sessionId]);

    const share = described?.act === 'share';
    const exactTargetInRequest = share && Boolean(
        input.actionArgs && typeof input.actionArgs === 'object' && 'target' in input.actionArgs
        && (input.actionArgs as { target?: unknown }).target,
    );
    const decisionOptions = React.useMemo(
        () => (share && chosenTarget ? { computerTarget: chosenTarget, computerAccess: chosenAccess ?? 'use' } : {}),
        [chosenAccess, chosenTarget, share],
    );
    return {
        presentation,
        chooseTarget,
        decisionOptions,
        needsChoiceBeforeApprove: share && !chosenTarget && !exactTargetInRequest,
    };
}
