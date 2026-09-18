import {
    normalizeExecutionRunWaitPollIntervalMs,
    normalizeExecutionRunWaitTimeoutMs,
    waitForExecutionRunTerminal,
    type ActionExecutorDeps,
} from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import { readRpcErrorCode } from '@happier-dev/protocol/rpcErrors';

import { machineCapabilitiesDetect } from '@/sync/ops/capabilities';
import { readProtocolV2ExecutionRunSupport } from '@/sync/ops/actions/executionRunDetachedSupport';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import {
    sessionExecutionRunAction,
    sessionExecutionRunGet,
    sessionExecutionRunList,
    sessionExecutionRunStart,
    sessionExecutionRunStop,
} from '@/sync/ops/sessionExecutionRuns';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

type UiExecutionRunActionDeps = Pick<
    ActionExecutorDeps,
    | 'executionRunCheckProtocolV2'
    | 'executionRunStart'
    | 'executionRunList'
    | 'executionRunGet'
    | 'detachedExecutionRunSend'
    | 'executionRunStop'
    | 'executionRunAction'
    | 'executionRunWait'
>;

type ExecutionRunOptions = Parameters<UiExecutionRunActionDeps['executionRunStart']>[2];

function normalizeId(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function executionRunFailure(code: string, error = code): Readonly<{
    ok: false;
    errorCode: string;
    error: string;
}> {
    return { ok: false, errorCode: code, error };
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Readonly<Record<string, unknown>>
        : null;
}

function toExecutionRunWaitReadResult(value: unknown):
    | Readonly<{ ok: true; data: unknown }>
    | Readonly<{ ok: false; code: string; message?: string }> {
    const record = readRecord(value);
    if (record && (record.ok === false || typeof record.error === 'string')) {
        const code = normalizeId(record.errorCode) ?? 'execution_run_target_unavailable';
        const message = typeof record.error === 'string' ? record.error : undefined;
        return { ok: false, code, ...(message ? { message } : {}) };
    }
    return { ok: true, data: value };
}

function resolveExactExecutionRunMachineId(
    sessionId: string | null,
    opts: ExecutionRunOptions,
): string | null {
    const exactMachineId = normalizeId(opts?.exactMachineId);
    if (exactMachineId) return exactMachineId;

    const hostStampedMachineId = normalizeId(opts?.targetMachineId);
    if (hostStampedMachineId) return hostStampedMachineId;

    const contextualSessionId = normalizeId(opts?.originSessionId) ?? sessionId;
    const serverId = normalizeId(opts?.serverId);
    return contextualSessionId
        ? normalizeId(readMachineControlTargetForSession(
            serverId
                ? { serverId, sessionId: contextualSessionId }
                : contextualSessionId,
        )?.machineId)
        : null;
}

async function callDetachedExecutionRunRpc(
    method: string,
    request: unknown,
    opts: ExecutionRunOptions,
): Promise<unknown> {
    const machineId = resolveExactExecutionRunMachineId(null, opts);
    if (!machineId) return executionRunFailure('execution_run_target_not_selected');
    try {
        return await machineRpcWithServerScope<unknown, unknown>({
            machineId,
            method,
            payload: request,
            serverId: opts?.serverId,
            ...(opts?.signal ? { signal: opts.signal } : {}),
        });
    } catch (error) {
        return executionRunFailure(
            readRpcErrorCode(error) ?? 'execution_run_target_unavailable',
            error instanceof Error ? error.message : 'execution_run_target_unavailable',
        );
    }
}

/**
 * UI transport adapter for the one shared execution.run Action family. Session
 * scope stays on session RPC; detached scope has no fallback and only uses the
 * exact machine selected by V2 preflight or host-stamped invocation context.
 */
export function createUiExecutionRunActionDeps(): UiExecutionRunActionDeps {
    return {
        executionRunCheckProtocolV2: async (sessionId, requirement, opts) => {
            if (
                !requirement.detachedScope
                && !requirement.startAndWait
                && !requirement.exactInputResults
                && !requirement.runScopedAgentBindings
                && !requirement.secretReferenceOverlay
            ) {
                return { ok: true };
            }
            const machineId = resolveExactExecutionRunMachineId(sessionId, opts);
            if (!machineId) return executionRunFailure('execution_run_target_not_selected');
            const capability = await machineCapabilitiesDetect(
                machineId,
                { requests: [{ id: 'tool.executionRuns' }] },
                {
                    serverId: opts?.serverId,
                    ...(opts?.signal ? { signal: opts.signal } : {}),
                },
            );
            const executionRuns = capability.supported
                ? capability.response.results['tool.executionRuns']
                : null;
            if (!executionRuns?.ok || !readProtocolV2ExecutionRunSupport(executionRuns.data)) {
                return executionRunFailure('execution_run_protocol_unsupported');
            }
            const data = executionRuns.data as Readonly<Record<string, unknown>>;
            const features = data.features as Readonly<Record<string, unknown>>;
            if (
                (requirement.exactInputResults && features.exactInputResults !== true)
                || (requirement.runScopedAgentBindings && features.runScopedAgentBindings !== true)
                || (requirement.secretReferenceOverlay && features.secretReferenceOverlay !== true)
            ) return executionRunFailure('execution_run_protocol_unsupported');
            return { ok: true, exactMachineId: machineId };
        },
        executionRunStart: async (sessionId, request, opts) => sessionId === null
            ? await callDetachedExecutionRunRpc(SESSION_RPC_METHODS.EXECUTION_RUN_START, request, opts)
            : await sessionExecutionRunStart(sessionId, request, {
                serverId: opts?.serverId,
                ...(normalizeId(opts?.exactMachineId)
                    ? { expectedMachineId: normalizeId(opts?.exactMachineId) }
                    : {}),
            }),
        executionRunList: async (sessionId, request, opts) => sessionId === null
            ? await callDetachedExecutionRunRpc(SESSION_RPC_METHODS.EXECUTION_RUN_LIST, request, opts)
            : await sessionExecutionRunList(sessionId, request, { serverId: opts?.serverId }),
        executionRunGet: async (sessionId, request, opts) => sessionId === null
            ? await callDetachedExecutionRunRpc(SESSION_RPC_METHODS.EXECUTION_RUN_GET, request, opts)
            : await sessionExecutionRunGet(sessionId, request, { serverId: opts?.serverId }),
        detachedExecutionRunSend: async (_sessionId, request, opts) =>
            await callDetachedExecutionRunRpc(SESSION_RPC_METHODS.EXECUTION_RUN_SEND, request, opts),
        executionRunStop: async (sessionId, request, opts) => sessionId === null
            ? await callDetachedExecutionRunRpc(SESSION_RPC_METHODS.EXECUTION_RUN_STOP, request, opts)
            : await sessionExecutionRunStop(sessionId, request, { serverId: opts?.serverId }),
        executionRunAction: async (sessionId, request, opts) => sessionId === null
            ? await callDetachedExecutionRunRpc(SESSION_RPC_METHODS.EXECUTION_RUN_ACTION, request, opts)
            : await sessionExecutionRunAction(sessionId, request, { serverId: opts?.serverId }),
        executionRunWait: async (sessionId, request, opts) => await waitForExecutionRunTerminal({
            runId: String(readRecord(request)?.runId ?? ''),
            timeoutMs: normalizeExecutionRunWaitTimeoutMs(readRecord(request)?.timeoutSeconds),
            pollIntervalMs: normalizeExecutionRunWaitPollIntervalMs(
                readRecord(request)?.pollIntervalMs,
            ),
            ...(opts?.signal ? { signal: opts.signal } : {}),
            readRun: async ({ runId }) => {
                const response = sessionId === null
                    ? await callDetachedExecutionRunRpc(
                    SESSION_RPC_METHODS.EXECUTION_RUN_GET,
                    { runId, includeStructured: true },
                    opts,
                )
                    : await sessionExecutionRunGet(
                    sessionId,
                    { runId, includeStructured: true },
                    { serverId: opts?.serverId },
                );
                return toExecutionRunWaitReadResult(response);
            },
        }),
    };
}
