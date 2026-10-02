import { getActionSpec, type ActionExecutorDeps } from '@happier-dev/protocol';
import { runMachineScmRpcWithFallback } from '@/sync/ops/scm/machineScm';
import { runSessionScmRpc } from '@/sync/ops/sessionScm';
import type { LazyActionAccountContext } from './actionAccountContext';

/** Admission and schemas belong to Actions; repository policy belongs to SCM. */
export function createUiScmAction(account?: LazyActionAccountContext): NonNullable<ActionExecutorDeps['scmActionExecute']> {
    return async ({ actionId, input, context }) => {
        context.signal?.throwIfAborted();
        account?.assertCurrent();
        const method = getActionSpec(actionId).bindings?.rpcMethod;
        if (!method) return { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action' };

        // The canonical Action owner has already parsed this family's request schema.
        const request = input as Readonly<{ cwd?: string; backendPreference?: unknown; destinationParentPath?: string }>;
        const serverId = account?.serverId ?? context.serverId;
        const accountId = account?.accountId ?? context.runtimeAccountId;
        const target = context.externalActionTarget;
        if (target?.kind === 'machine') {
            const cwd = actionId === 'scm.repository.clone' ? request.destinationParentPath : request.cwd;
            if (!target.machineId.trim() || !cwd?.trim()) return { ok: false, errorCode: 'invalid_input', error: 'invalid_input' };
            const result = await runMachineScmRpcWithFallback(target.machineId, method, request, {
                serverId, accountId, signal: context.signal,
            });
            account?.assertCurrent();
            return result;
        }
        const sessionId = target?.kind === 'session' ? target.sessionId : context.defaultSessionId;
        if (!sessionId) return { ok: false, errorCode: 'session_not_selected', error: 'session_not_selected' };
        // Like the CLI Action adapter, Session Actions cannot substitute another
        // repository. The general SCM facade still owns caller-relative paths.
        const sessionRequest = actionId === 'scm.repository.clone' ? request : { ...request, cwd: undefined };
        const result = await runSessionScmRpc(sessionId, method, sessionRequest, serverId, context.signal, accountId,
            actionId === 'scm.pullRequest.prepareWorktree' ? (resolved) => ({ ...resolved, sourcePath: resolved.cwd }) : undefined);
        account?.assertCurrent();
        return result;
    };
}
