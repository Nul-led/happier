import type { ActionExecuteResult, ActionExecutorContext, ActionId } from '@happier-dev/protocol';
import type { createCliActionExecutor } from '@/session/actions/createCliActionExecutor';
import type { RpcLocalActionContext } from '@/api/rpc/types';

type CliActionExecutorParams = Parameters<typeof createCliActionExecutor>[0];

export type RpcActionExecutorContext = ActionExecutorContext & Readonly<{
    signal?: AbortSignal;
    operationProgress?: NonNullable<RpcLocalActionContext['operationProgress']>;
    operationOwnerUpdate?: NonNullable<RpcLocalActionContext['operationOwnerUpdate']>;
}>;

export type RpcActionExecutor = Readonly<{
    execute: (
        actionId: ActionId,
        input: unknown,
        context?: RpcActionExecutorContext,
    ) => Promise<ActionExecuteResult>;
}>;

export type RpcActionDispatchRequest = Readonly<{
    actionId: ActionId;
    input: unknown;
    defaultSessionId?: string | null;
    serverId?: string | null;
    externalActionTarget?: ActionExecutorContext['externalActionTarget'];
    signal?: AbortSignal;
    localActionContext?: RpcLocalActionContext;
    callerAuthority?: ActionExecutorContext['authority'];
    executor?: RpcActionExecutor;
    executorParams?: CliActionExecutorParams;
}>;

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export function buildActionExecutorContextForRpc(
    params: Pick<RpcActionDispatchRequest, 'defaultSessionId' | 'serverId' | 'externalActionTarget' | 'signal' | 'localActionContext' | 'callerAuthority'>,
): RpcActionExecutorContext {
    const defaultSessionId = normalizeOptionalString(params.defaultSessionId);
    const serverId = normalizeOptionalString(params.serverId);
    const localActionContext = params.localActionContext;
    const surface = localActionContext?.surface ?? 'rpc';
    const hasLocalCallerPermissionMode = Boolean(
        localActionContext
        && Object.prototype.hasOwnProperty.call(localActionContext, 'callerPermissionMode'),
    );
    const hasLocalCausalPermissionAuthority = Boolean(
        localActionContext
        && Object.prototype.hasOwnProperty.call(localActionContext, 'causalPermissionAuthority'),
    );

    return {
        ...(defaultSessionId ? { defaultSessionId } : {}),
        ...(serverId ? { serverId } : {}),
        ...(params.externalActionTarget ? { externalActionTarget: params.externalActionTarget } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
        ...(localActionContext?.agentStartContext ? { agentStartContext: localActionContext.agentStartContext } : {}),
        ...(localActionContext?.agentStartWorkDepth !== undefined ? { agentStartWorkDepth: localActionContext.agentStartWorkDepth } : {}),
        ...(localActionContext?.agentStartWorkspaceWrites !== undefined ? { agentStartWorkspaceWrites: localActionContext.agentStartWorkspaceWrites } : {}),
        ...(localActionContext?.sessionAgentSpawnPolicyV1 !== undefined ? { sessionAgentSpawnPolicyV1: localActionContext.sessionAgentSpawnPolicyV1 } : {}),
        ...(localActionContext?.operationProgress
            ? { operationProgress: localActionContext.operationProgress }
            : {}),
        ...(localActionContext?.operationOwnerUpdate
            ? { operationOwnerUpdate: localActionContext.operationOwnerUpdate }
            : {}),
        ...(localActionContext?.executionRunPermissionRequestStore === undefined
            ? {}
            : { executionRunPermissionRequestStore: localActionContext.executionRunPermissionRequestStore }),
        ...(localActionContext?.executionRunWorkflowObservationSink === undefined
            ? {}
            : { executionRunWorkflowObservationSink: localActionContext.executionRunWorkflowObservationSink }),
        ...(localActionContext?.executionRunWorkflowRunId
            ? { executionRunWorkflowRunId: localActionContext.executionRunWorkflowRunId }
            : {}),
        surface,
        authority: params.callerAuthority ?? localActionContext?.authority ?? 'account_automation',
        ...(localActionContext?.actionRequestId
            ? { actionRequestId: localActionContext.actionRequestId }
            : {}),
        ...(hasLocalCallerPermissionMode
            ? { callerPermissionMode: localActionContext?.callerPermissionMode ?? null }
            : {}),
        ...(hasLocalCausalPermissionAuthority
            ? { causalPermissionAuthority: localActionContext?.causalPermissionAuthority ?? null }
            : {}),
    };
}

export function buildActionExecutorDepsForRpc(
    params: Readonly<{ executorParams: CliActionExecutorParams }>,
): CliActionExecutorParams {
    return params.executorParams;
}

async function resolveRpcActionExecutor(params: RpcActionDispatchRequest): Promise<RpcActionExecutor> {
    if (params.executor) {
        return params.executor;
    }
    if (!params.executorParams) {
        throw new Error('rpc_action_executor_params_required');
    }
    const module = await import('@/session/actions/createCliActionExecutor');
    return module.createCliActionExecutor(buildActionExecutorDepsForRpc({ executorParams: params.executorParams }));
}

export async function dispatchActionFromRpc(
    params: RpcActionDispatchRequest,
): Promise<ActionExecuteResult> {
    const executor = await resolveRpcActionExecutor(params);
    return await executor.execute(
        params.actionId,
        params.input,
        buildActionExecutorContextForRpc(params),
    );
}
