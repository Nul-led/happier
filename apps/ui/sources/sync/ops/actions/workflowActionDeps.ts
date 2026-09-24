import type { WorkflowActionExecute } from '@happier-dev/protocol';

import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storage';
import { resolveVisibleMachinesForActiveServerFromState } from '@/sync/store/domains/machines/resolveMachinesForActiveServerFromState';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import type { ActionAccountContext } from './actionAccountContext';
import {
    createUiWorkflowActionTransport,
    type WorkflowActionTransport,
} from './workflowActionTransport';

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
    const execute = createUiWorkflowActionTransport({
        account: params.account,
        resolveFallbackMachineId: () => (
            resolveVisibleMachinesForActiveServerFromState(storage.getState())[0]?.id ?? null
        ),
        transport,
    });
    // The invocation may name the Home by its device-local profile id while the
    // captured Account names it by its published identity; both are this Home.
    return async (args) => await execute(
        args.context.serverId !== params.account.serverId
            && areServerProfileIdentifiersEquivalent(args.context.serverId, params.account.serverId)
            ? { ...args, context: { ...args.context, serverId: params.account.serverId } }
            : args,
    );
}
