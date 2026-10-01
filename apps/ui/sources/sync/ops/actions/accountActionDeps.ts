import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import { resolveVisibleMachinesForActiveServerFromState } from '@/sync/store/domains/machines/resolveMachinesForActiveServerFromState';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import type { ActionAccountContext } from './actionAccountContext';
import { isMachineOnline } from '@/utils/sessions/machineUtils';
import {
    createUiAccountActionTransport,
    type AccountActionTransport,
    type UiAccountActionExecute,
} from './accountActionTransport';

/** Compose the existing machine relay with the invocation's captured Account. */
export function createUiAccountAction(params: Readonly<{
    account: Pick<ActionAccountContext, 'serverId' | 'accountId' | 'assertCurrent'>;
    transport?: AccountActionTransport;
}>): UiAccountActionExecute {
    const execute = createUiAccountActionTransport({
        account: params.account,
        resolveFallbackMachineId: () => (
            areServerProfileIdentifiersEquivalent(getActiveServerSnapshot().serverId, params.account.serverId)
                ? resolveVisibleMachinesForActiveServerFromState(storage.getState()).find((machine) => isMachineOnline(machine))?.id ?? null
                : null
        ),
        transport: params.transport ?? (async (input) => await machineRpcWithServerScope(input)),
    });
    return async (args) => await execute(
        args.context.serverId !== params.account.serverId
            && areServerProfileIdentifiersEquivalent(args.context.serverId, params.account.serverId)
            ? { ...args, context: { ...args.context, serverId: params.account.serverId } }
            : args,
    );
}
