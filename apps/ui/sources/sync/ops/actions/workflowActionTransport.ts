import {
    createTargetedActionRpcRequestV1,
    WorkflowActionFailureV1Schema,
    type WorkflowActionExecute,
} from '@happier-dev/protocol';

export type WorkflowActionTransport = (input: Readonly<{
    serverId: string;
    accountId: string;
    machineId: string;
    method: string;
    payload: unknown;
    signal?: AbortSignal;
}>) => Promise<unknown>;

function resolveWorkflowActionHostMachineId(
    context: Parameters<WorkflowActionExecute>[0]['context'],
    resolveFallbackMachineId: () => string | null,
): string | null {
    const target = context.externalActionTarget;
    if (target?.kind === 'machine' && target.machineId.trim()) return target.machineId.trim();
    return resolveFallbackMachineId();
}

/** Transport-only Workflow Action leaf shared by production composition and boundary tests. */
export function createUiWorkflowActionTransport(params: Readonly<{
    account: Readonly<{
        serverId: string;
        accountId: string;
        assertCurrent: () => void;
    }>;
    resolveFallbackMachineId: () => string | null;
    transport: WorkflowActionTransport;
}>): WorkflowActionExecute {
    return async (args) => {
        try {
            params.account.assertCurrent();
        } catch {
            return { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
        }
        // Exact after composition: `createUiWorkflowAction` resolves an equivalent Home
        // identifier through the server-profile owner. This leaf stays dependency-light
        // because the CLI boundary test imports it directly.
        if (args.context.serverId !== params.account.serverId
            || args.context.runtimeAccountId !== params.account.accountId) {
            return { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
        }
        const machineId = resolveWorkflowActionHostMachineId(
            args.context,
            params.resolveFallbackMachineId,
        );
        if (!machineId) return { ok: false, errorCode: 'target_unavailable', error: 'target_unavailable' };
        const target = args.context.externalActionTarget?.kind === 'machine'
            ? args.context.externalActionTarget
            : { kind: 'machine' as const, machineId };
        const result = await params.transport({
            serverId: params.account.serverId,
            accountId: params.account.accountId,
            machineId,
            method: args.actionId,
            payload: createTargetedActionRpcRequestV1(args.input, target),
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
