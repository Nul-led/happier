import type {
    ActionExecuteResult,
    ActionExecutorContext,
    ActionUiPlacement,
} from '@happier-dev/protocol';

import {
    openSessionHandoffPicker,
    type SessionHandoffPickerResult,
} from '@/components/sessions/handoff/openSessionHandoffPicker';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sync } from '@/sync/sync';
import { randomUUID } from '@/platform/randomUUID';
import { actionOperationPresentationCoordinator } from '@/components/inbox/actionOperations/actionOperationPresentationRuntime';

import { readSessionHandoffSessionActivity } from './readSessionHandoffSessionActivity';
import {
    executeSessionHandoffAction,
    type ExecuteSessionHandoffActionResult,
} from './executeSessionHandoffAction';

type ExecuteAction = (
    actionId: 'session.handoff',
    input: unknown,
    context?: ActionExecutorContext,
) => Promise<ActionExecuteResult>;

async function confirmActiveSessionHandoff(sessionId: string): Promise<boolean> {
    if (readSessionHandoffSessionActivity(sessionId)?.active !== true) return true;

    return await Modal.confirm(
        t('sessionHandoff.activeWarning.title'),
        t('sessionHandoff.activeWarning.message'),
        {
            cancelText: t('common.cancel'),
            confirmText: t('sessionHandoff.activeWarning.confirm'),
            destructive: true,
        },
    );
}

async function confirmMirrorExactly(input: Readonly<{
    sourceMachineId?: string | null;
    selection: SessionHandoffPickerResult;
}>): Promise<boolean> {
    if (input.selection.workspaceAction?.kind !== 'create_relationship'
        || input.selection.workspaceAction.mode !== 'mirror_exactly') return true;

    return await Modal.confirm(
        t('sessionHandoff.mirrorConfirmation.title'),
        t('sessionHandoff.mirrorConfirmation.message', {
            sourceMachine: input.sourceMachineId?.trim() || '—',
            sourcePath: input.selection.sourceRootPath?.trim() || '—',
            targetMachine: input.selection.targetMachineLabel?.trim() || input.selection.targetMachineId,
            targetPath: input.selection.targetPath?.trim() || '—',
        }),
        {
            cancelText: t('common.cancel'),
            confirmText: t('sessionHandoff.mirrorConfirmation.confirm'),
            destructive: true,
        },
    );
}

export async function runSessionHandoffPickerFlow(args: Readonly<{
    execute: ExecuteAction;
    sessionId: string;
    sourceMachineId?: string | null;
    serverId: string | null;
    placement: ActionUiPlacement;
}>): Promise<ExecuteSessionHandoffActionResult | Readonly<{ ok: false; handled: true }> | null> {
    const selection = await openSessionHandoffPicker({
        sessionId: args.sessionId,
        sourceMachineId: args.sourceMachineId ?? null,
        serverId: args.serverId,
    });
    if (!selection) return null;
    if (!await confirmActiveSessionHandoff(args.sessionId)) return { ok: false, handled: true };
    if (!await confirmMirrorExactly({ sourceMachineId: args.sourceMachineId, selection })) {
        return { ok: false, handled: true };
    }

    const releaseUserRequestLease = sync.acquireUserRequestLease();
    const requestId = randomUUID();
    actionOperationPresentationCoordinator.register({ requestId, onStart: 'current' });
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
        releaseUserRequestLease();
    }
}
