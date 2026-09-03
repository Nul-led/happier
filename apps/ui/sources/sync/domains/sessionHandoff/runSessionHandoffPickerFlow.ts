import type {
    ActionExecuteResult,
    ActionExecutorContext,
    ActionUiPlacement,
} from '@happier-dev/protocol';

import { openSessionHandoffPicker } from '@/components/sessions/handoff/openSessionHandoffPicker';
import { openObservedSessionHandoffProgressModal } from '@/components/sessions/handoff/openSessionHandoffProgressModal';
import { sync } from '@/sync/sync';
import { randomUUID } from '@/platform/randomUUID';
import { actionOperationPresentationCoordinator } from '@/components/inbox/actionOperations/actionOperationPresentationRuntime';

import {
    executeSessionHandoffAction,
    type ExecuteSessionHandoffActionResult,
} from './executeSessionHandoffAction';

type ExecuteAction = (
    actionId: 'session.handoff',
    input: unknown,
    context?: ActionExecutorContext,
) => Promise<ActionExecuteResult>;

/**
 * The destination confirmation belongs to the Action approval corridor: the
 * target daemon inspects the exact destination and stamps one proof covering
 * replacement and exact-mirror deletion together. A picker-side prompt here
 * would ask a second time and would not be bound to what the daemon observed.
 */
export async function runSessionHandoffPickerFlow(args: Readonly<{
    execute: ExecuteAction;
    sessionId: string;
    sourceMachineId?: string | null;
    serverId: string | null;
    placement: ActionUiPlacement;
}>): Promise<ExecuteSessionHandoffActionResult | null> {
    const selection = await openSessionHandoffPicker({
        sessionId: args.sessionId,
        sourceMachineId: args.sourceMachineId ?? null,
        serverId: args.serverId,
    });
    if (!selection) return null;

    const releaseUserRequestLease = sync.acquireUserRequestLease();
    const requestId = randomUUID();
    const workspaceSyncEnabled = selection.workspaceAction !== undefined
        && selection.workspaceAction.kind !== 'none';
    const openProgress = () => openObservedSessionHandoffProgressModal({
        requestId,
        sessionId: args.sessionId,
        workspaceSyncEnabled,
    });
    const progressPresentation = openProgress();
    actionOperationPresentationCoordinator.register({
        requestId,
        onStart: 'current',
        origin: {
            resolve: (snapshot) => (
                snapshot.state === 'accepted' || snapshot.state === 'running'
                    ? () => { openProgress(); }
                    : null
            ),
        },
    });
    try {
        return await executeSessionHandoffAction({
            execute: args.execute,
            sessionId: args.sessionId,
            targetMachineId: selection.targetMachineId,
            ...(selection.targetPath ? { targetPath: selection.targetPath } : {}),
            targetSessionStorageMode: selection.targetSessionStorageMode,
            workspaceAction: selection.workspaceAction,
            context: {
                defaultSessionId: args.sessionId,
                serverId: args.serverId,
                surface: 'ui',
                placement: args.placement,
                actionRequestId: requestId,
            },
        });
    } finally {
        progressPresentation.close();
        releaseUserRequestLease();
    }
}
