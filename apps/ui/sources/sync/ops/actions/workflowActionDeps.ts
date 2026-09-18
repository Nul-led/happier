import {
    WorkflowActionFailureV1Schema,
    type WorkflowActionExecute,
} from '@happier-dev/protocol';

import { storage } from '@/sync/domains/state/storage';
import { resolveVisibleMachinesForActiveServerFromState } from '@/sync/store/domains/machines/resolveMachinesForActiveServerFromState';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import type { ActionAccountContext } from './actionAccountContext';

type WorkflowActionTransport = (input: Readonly<{
    serverId: string;
    accountId: string;
    machineId: string;
    method: string;
    payload: unknown;
    signal?: AbortSignal;
}>) => Promise<unknown>;

function resolveWorkflowActionHostMachineId(context: Parameters<WorkflowActionExecute>[0]['context']): string | null {
    const target = context.externalActionTarget;
    if (target?.kind === 'machine' && target.machineId.trim()) return target.machineId.trim();
    return resolveVisibleMachinesForActiveServerFromState(storage.getState())[0]?.id ?? null;
}

/** Thin UI transport leaf for the daemon-owned Workflow Action family. */
export function createUiWorkflowAction(params: Readonly<{
    account: Pick<ActionAccountContext, 'serverId' | 'accountId' | 'assertCurrent'>;
    transport?: WorkflowActionTransport;
}>): WorkflowActionExecute {
    const transport = params.transport ?? (async (input) => await machineRpcWithServerScope({
        serverId: input.serverId,
        accountId: input.accountId,
        machineId: input.machineId,
        method: input.method,
        payload: input.payload,
        ...(input.signal ? { signal: input.signal } : {}),
    }));
    return async (args) => {
        try {
            params.account.assertCurrent();
        } catch {
            return { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
        }
        if (args.context.serverId !== params.account.serverId
            || args.context.runtimeAccountId !== params.account.accountId) {
            return { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
        }
        const machineId = resolveWorkflowActionHostMachineId(args.context);
        if (!machineId) return { ok: false, errorCode: 'target_unavailable', error: 'target_unavailable' };
        const result = await transport({
            serverId: params.account.serverId,
            accountId: params.account.accountId,
            machineId,
            method: args.actionId,
            payload: args.input,
            ...(args.signal ? { signal: args.signal } : {}),
        });
        try {
            params.account.assertCurrent();
        } catch {
            return { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
        }
        const failure = WorkflowActionFailureV1Schema.safeParse(result);
        return failure.success ? failure.data : result as Awaited<ReturnType<WorkflowActionExecute>>;
    };
}
