import type {
    ActionExecuteResult,
    ActionExecutorContext,
    ActionUiPlacement,
} from '@happier-dev/protocol';

import { openSessionHandoffPicker } from '@/components/sessions/handoff/openSessionHandoffPicker';
import { openObservedSessionHandoffProgressModal } from '@/components/sessions/handoff/openSessionHandoffProgressModal';
import { sync } from '@/sync/sync';
import { randomUUID } from '@/platform/randomUUID';
import { getStorage } from '@/sync/domains/state/storageStore';
import { actionOperationPresentationCoordinator } from '@/components/inbox/actionOperations/actionOperationPresentationRuntime';
import {
    actionOperationStore,
    type ActionOperationStore,
} from '@/sync/domains/actionOperations/actionOperationStore';

import {
    executeSessionHandoffAction,
    type ExecuteSessionHandoffActionResult,
} from './executeSessionHandoffAction';

type ExecuteAction = (
    actionId: 'session.handoff',
    input: unknown,
    context?: ActionExecutorContext,
) => Promise<ActionExecuteResult>;

function readRetainedHandoffRequestId(input: Readonly<{
    store: Pick<ActionOperationStore, 'getSnapshot'>;
    serverId: string | null;
    accountId: string;
    sessionId: string;
    sourceMachineId?: string | null;
}>): string | null {
    const serverId = input.serverId?.trim() ?? '';
    const accountId = input.accountId.trim();
    const sourceMachineId = input.sourceMachineId?.trim() ?? '';
    if (!serverId || !accountId) return null;
    const candidates = [...input.store.getSnapshot().operationsByKey.values()]
        .filter((operation) => operation.serverId === serverId)
        .map((operation) => operation.snapshot)
        .filter((snapshot) => snapshot.actionId === 'session.handoff'
            && snapshot.state === 'running'
            && snapshot.scope.accountId === accountId
            && snapshot.scope.sessionId === input.sessionId
            && (!sourceMachineId || snapshot.scope.machineId === sourceMachineId)
            && Boolean(snapshot.requestId))
        .sort((left, right) => right.createdAt - left.createdAt);
    return candidates[0]?.requestId ?? null;
}

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
    operationStore?: Pick<ActionOperationStore, 'getSnapshot'>;
}>): Promise<ExecuteSessionHandoffActionResult | null> {
    const selection = await openSessionHandoffPicker({
        sessionId: args.sessionId,
        sourceMachineId: args.sourceMachineId ?? null,
        serverId: args.serverId,
    });
    if (!selection) return null;

    const releaseUserRequestLease = sync.acquireUserRequestLease();
    const profileScope = getStorage().getState().profileScope;
    const accountId = profileScope?.serverId === args.serverId
        ? profileScope.accountId ?? ''
        : '';
    const requestId = readRetainedHandoffRequestId({
        store: args.operationStore ?? actionOperationStore,
        serverId: args.serverId,
        accountId,
        sessionId: args.sessionId,
        sourceMachineId: args.sourceMachineId,
    }) ?? randomUUID();
    const workspaceSyncEnabled = selection.workspaceAction !== undefined
        && selection.workspaceAction.kind !== 'none';
    const openProgress = () => openObservedSessionHandoffProgressModal({
        requestId,
        sessionId: args.sessionId,
        serverId: args.serverId,
        accountId,
        workspaceSyncEnabled,
    });
    const progressPresentation = openProgress();
    actionOperationPresentationCoordinator.register({
        serverId: args.serverId,
        accountId: profileScope?.serverId === args.serverId ? profileScope.accountId : '',
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
    let result: ExecuteSessionHandoffActionResult | null = null;
    try {
        result = await executeSessionHandoffAction({
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
        return result;
    } finally {
        // Workspace outcomes and failures remain visible through the canonical
        // Action operation result. Only an ordinary handoff with no workspace
        // result retains the compact auto-close behavior.
        if (result?.ok && result.result.workspace?.kind === 'none') {
            progressPresentation.close();
        }
        releaseUserRequestLease();
    }
}
