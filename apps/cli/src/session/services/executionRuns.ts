import {
    ExecutionRunListRequestSchema,
    ExecutionRunGetRequestSchema,
    ExecutionRunGetResponseSchema,
    ExecutionRunListResponseSchema,
    ExecutionRunPublicStateSchema,
    ExecutionRunWaitResultSchema,
    isExecutionRunTerminalStatus,
    readExecutionRunStartRunCreation,
    withExecutionRunStartFailureDetails,
    FeatureAxisSchema,
    FeatureBlockerCodeSchema,
    isFeatureId,
    type ExecutionRunListRequest,
    type ExecutionRunPublicState,
    type ExecutionRunStartFailureDetailsV1,
    type ExecutionRunStartRunCreation,
    type ExecutionRunTerminalStatus as ProtocolExecutionRunTerminalStatus,
    type ExecutionRunWaitLoopResult,
    type FeatureAxis,
    type FeatureBlockerCode,
    type FeatureId,
} from '@happier-dev/protocol';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
    isRpcMethodNotAvailableError,
    isRpcMethodNotFoundError,
} from '@happier-dev/protocol/rpcErrors';

import { configuration } from '@/configuration';
import { listExecutionRunMarkers } from '@/daemon/executionRunRegistry';
import type {
    SessionStoredContentCryptoContext,
} from '@/session/transport/encryption/sessionEncryptionContext';
import { callSessionRpc } from '@/session/transport/rpc/sessionRpc';
import { readRpcRequestDisposition } from '@happier-dev/sync-client';
import { applyExecutionRunListRequest } from './applyExecutionRunListRequest';
import {
    findExecutionRunPublicStateInHistoryRows,
    listExecutionRunPublicStatesFromHistoryRows,
} from './executionRunPublicStatesFromHistory';
import { readRawSessionHistoryRows } from './getSessionHistory';
import { normalizeExecutionRunPublicStateBackendTarget } from './executionRunPublicStateBackendTarget';

type ExecutionRunRpcContext = Readonly<{
    token: string;
    sessionId: string;
    signal?: AbortSignal;
}> & SessionStoredContentCryptoContext;

export type ExecutionRunTerminalStatus = ProtocolExecutionRunTerminalStatus;
declare const executionRunFeatureBlockerDetailsBrand: unique symbol;
export type ExecutionRunFeatureBlockerDetails = Readonly<{
    featureId: FeatureId;
    blockedBy: FeatureAxis;
    blockerCode: FeatureBlockerCode;
    [executionRunFeatureBlockerDetailsBrand]: true;
}>;
type ExecutionRunServiceFailure = Readonly<{
    ok: false;
    code: string;
    message?: string;
    details?: ExecutionRunFeatureBlockerDetails | ExecutionRunStartFailureDetailsV1;
}>;
export type ExecutionRunServiceResult<T> =
    | Readonly<{ ok: true; data: T }>
    | ExecutionRunServiceFailure;

export type WaitForExecutionRunResult = ExecutionRunWaitLoopResult<unknown, ExecutionRunServiceFailure>;

type ExecutionRunMarkerRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExecutionRunStartResponseTimeout(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.toLowerCase().includes('rpc call timeout');
}

function readOwnDataProperty(record: Record<string, unknown>, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? descriptor.value
        : undefined;
}

export function normalizeExecutionRunFeatureBlockerDetails(
    value: unknown,
): ExecutionRunFeatureBlockerDetails | undefined {
    if (!isRecord(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const featureId = readOwnDataProperty(value, 'featureId');
    const blockedBy = FeatureAxisSchema.safeParse(readOwnDataProperty(value, 'blockedBy'));
    const blockerCode = FeatureBlockerCodeSchema.safeParse(readOwnDataProperty(value, 'blockerCode'));
    if (!isFeatureId(featureId)) return undefined;
    if (!blockedBy.success || !blockerCode.success) return undefined;
    return {
        featureId,
        blockedBy: blockedBy.data,
        blockerCode: blockerCode.data,
    } as ExecutionRunFeatureBlockerDetails;
}

type ExecutionRunFallbackExhaustedCode =
    | 'execution_run_protocol_unsupported'
    | 'execution_run_target_unavailable';

function classifyExecutionRunRpcFallback(error: unknown): ExecutionRunFallbackExhaustedCode | null {
    const errorMessage = error instanceof Error ? error.message : String(error ?? '');
    if (
        isRpcMethodNotAvailableError(error)
        || isRpcMethodNotFoundError(error)
        || errorMessage === 'Method not found'
        || errorMessage === 'RPC method not available'
    ) {
        return 'execution_run_protocol_unsupported';
    }

    const normalizedMessage = errorMessage.toLowerCase();
    if (
        normalizedMessage.includes('connect_error')
        || normalizedMessage.includes('socket connect timeout')
        || normalizedMessage.includes('rpc call timeout')
    ) {
        return 'execution_run_target_unavailable';
    }

    return null;
}

function isFallbackSafeExecutionRunRpcError(error: unknown): boolean {
    return classifyExecutionRunRpcFallback(error) !== null;
}

function classifyExecutionRunServiceFallback(
    result: Readonly<{ code: string; message?: string }>,
): ExecutionRunFallbackExhaustedCode | null {
    if (
        result.code === 'RPC_METHOD_NOT_AVAILABLE'
        || result.code === 'RPC_METHOD_NOT_FOUND'
        || result.message === 'RPC method not available'
        || result.message === 'Method not found'
    ) {
        return 'execution_run_protocol_unsupported';
    }

    return null;
}

function isFallbackSafeExecutionRunServiceError(result: Readonly<{ code: string; message?: string }>): boolean {
    if (result.code === 'execution_run_not_found') {
        return true;
    }

    return classifyExecutionRunServiceFallback(result) !== null;
}

function executionRunNotFound(): ExecutionRunServiceResult<unknown> {
    return {
        ok: false,
        code: 'execution_run_not_found',
        message: 'Execution run not found',
    };
}

function executionRunControlUnavailable(): ExecutionRunServiceResult<unknown> {
    return {
        ok: false,
        code: 'execution_run_not_allowed',
        message: 'Execution run control unavailable',
    };
}

function executionRunStartUnavailable(
    runCreation: ExecutionRunStartRunCreation,
): ExecutionRunServiceResult<unknown> {
    return {
        ok: false,
        code: 'execution_run_not_allowed',
        message: 'Execution run start unavailable',
        details: withExecutionRunStartFailureDetails(undefined, runCreation),
    };
}

function readExecutionRunRequestRunId(request: unknown): string | null {
    if (!isRecord(request)) return null;
    const runId = typeof request.runId === 'string' ? request.runId.trim() : '';
    return runId.length > 0 ? runId : null;
}

function toExecutionRunPublicState(marker: ExecutionRunMarkerRecord): ExecutionRunPublicState | null {
    const permissionMode =
        typeof marker.permissionMode === 'string' && marker.permissionMode.trim().length > 0
            ? marker.permissionMode
            : null;
    if (!permissionMode) {
        return null;
    }
    const backendTarget = normalizeExecutionRunPublicStateBackendTarget(marker.backendTarget);
    if (!backendTarget) {
        return null;
    }

    const payload: Record<string, unknown> = {
        runId: marker.runId,
        callId: marker.callId,
        sidechainId: marker.sidechainId,
        intent: marker.intent,
        backendTarget,
        ...(marker.display !== undefined ? { display: marker.display } : {}),
        ...(marker.launchOrigin !== undefined ? { launchOrigin: marker.launchOrigin } : {}),
        ...(marker.requestedConfiguration !== undefined
            ? { requestedConfiguration: marker.requestedConfiguration }
            : {}),
        permissionMode,
        retentionPolicy: marker.retentionPolicy,
        runClass: marker.runClass,
        ioMode: marker.ioMode,
        status: marker.status,
        ...(marker.resumeHandle && marker.resumeHandle !== null ? { resumeHandle: marker.resumeHandle } : {}),
        startedAtMs: marker.startedAtMs,
        ...(typeof marker.finishedAtMs === 'number' ? { finishedAtMs: marker.finishedAtMs } : {}),
    };

    const errorCode =
        typeof marker.errorCode === 'string' && marker.errorCode.trim().length > 0 ? marker.errorCode : null;
    if (errorCode) {
        payload.error = { code: errorCode };
    }

    const parsed = ExecutionRunPublicStateSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
}

async function listMarkerBackedExecutionRuns(params: Readonly<{ sessionId: string }>): Promise<ExecutionRunPublicState[]> {
    const markers = await listExecutionRunMarkers();
    const runs = markers
        .filter((marker) => marker.happySessionId === params.sessionId)
        .map((marker) => toExecutionRunPublicState(marker as ExecutionRunMarkerRecord))
        .filter((run): run is ExecutionRunPublicState => run !== null);
    runs.sort((left, right) => left.startedAtMs - right.startedAtMs);
    return runs;
}

async function getMarkerBackedExecutionRun(params: Readonly<{ sessionId: string; runId: string }>): Promise<ExecutionRunPublicState | null> {
    const runs = await listMarkerBackedExecutionRuns({ sessionId: params.sessionId });
    return runs.find((run) => run.runId === params.runId) ?? null;
}

function mergeExecutionRunLists(params: Readonly<{
    primaryRuns: readonly ExecutionRunPublicState[];
    markerRuns: readonly ExecutionRunPublicState[];
}>): readonly ExecutionRunPublicState[] {
    const byRunId = new Map<string, ExecutionRunPublicState>();
    for (const run of params.primaryRuns) {
        byRunId.set(run.runId, run);
    }
    for (const run of params.markerRuns) {
        if (!byRunId.has(run.runId)) {
            byRunId.set(run.runId, run);
        }
    }
    return Array.from(byRunId.values()).sort((left, right) => left.startedAtMs - right.startedAtMs);
}

function toExecutionRunFallbackExhaustedError(
    error: unknown,
    code: ExecutionRunFallbackExhaustedCode,
): ExecutionRunServiceResult<unknown> {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return {
        ok: false,
        code,
        ...(message.trim().length > 0 ? { message } : {}),
    };
}

async function listTranscriptBackedExecutionRuns(
    params: ExecutionRunRpcContext,
): Promise<readonly ExecutionRunPublicState[]> {
    const rows = await readRawSessionHistoryRows({
        ...params,
        limit: configuration.memoryMaxTranscriptWindowMessages,
    });
    return listExecutionRunPublicStatesFromHistoryRows(rows);
}

async function getTranscriptBackedExecutionRun(
    params: ExecutionRunRpcContext & Readonly<{ runId: string }>,
): Promise<ExecutionRunPublicState | null> {
    const rows = await readRawSessionHistoryRows({
        ...params,
        limit: configuration.memoryMaxTranscriptWindowMessages,
    });
    return findExecutionRunPublicStateInHistoryRows(rows, params.runId);
}

async function tryListTranscriptBackedExecutionRuns(
    params: ExecutionRunRpcContext,
): Promise<Readonly<{ ok: true; runs: readonly ExecutionRunPublicState[] }> | Readonly<{ ok: false }>> {
    try {
        return {
            ok: true,
            runs: await listTranscriptBackedExecutionRuns(params),
        };
    } catch {
        return { ok: false };
    }
}

async function tryGetTranscriptBackedExecutionRun(
    params: ExecutionRunRpcContext & Readonly<{ runId: string }>,
): Promise<ExecutionRunPublicState | null> {
    try {
        return await getTranscriptBackedExecutionRun(params);
    } catch {
        return null;
    }
}

async function buildExecutionRunListFallbackRuns(
    params: ExecutionRunRpcContext & Readonly<{ request: ExecutionRunListRequest }>,
): Promise<Readonly<{ runs: readonly ExecutionRunPublicState[] }>> {
    const markerRuns = await listMarkerBackedExecutionRuns({ sessionId: params.sessionId });
    const transcriptResult = await tryListTranscriptBackedExecutionRuns(params);
    const transcriptRuns = transcriptResult.ok ? transcriptResult.runs : null;
    const combinedRuns =
        transcriptRuns && transcriptRuns.length > 0
            ? mergeExecutionRunLists({
                primaryRuns: transcriptRuns,
                markerRuns,
            })
            : markerRuns;

    return {
        runs: applyExecutionRunListRequest(combinedRuns, params.request),
    };
}

async function buildExecutionRunGetFallbackRun(
    params: ExecutionRunRpcContext & Readonly<{ runId: string }>,
): Promise<ExecutionRunPublicState | null> {
    const transcriptRun = await tryGetTranscriptBackedExecutionRun(params);
    if (transcriptRun) {
        return transcriptRun;
    }

    return await getMarkerBackedExecutionRun({
        sessionId: params.sessionId,
        runId: params.runId,
    });
}

async function tryBuildExecutionRunGetFallbackRun(
    params: ExecutionRunRpcContext & Readonly<{ runId: string }>,
): Promise<Readonly<{ ok: true; run: ExecutionRunPublicState | null }> | Readonly<{ ok: false }>> {
    let transcriptLookupOk = true;
    try {
        const transcriptRun = await getTranscriptBackedExecutionRun(params);
        if (transcriptRun) {
            return { ok: true, run: transcriptRun };
        }
    } catch {
        transcriptLookupOk = false;
    }

    try {
        const markerRun = await getMarkerBackedExecutionRun({
            sessionId: params.sessionId,
            runId: params.runId,
        });
        if (markerRun) {
            return { ok: true, run: markerRun };
        }

        return transcriptLookupOk ? { ok: true, run: null } : { ok: false };
    } catch {
        return { ok: false };
    }
}

function normalizeExecutionRunStartFailureDetails(
    value: unknown,
): ExecutionRunStartFailureDetailsV1 {
    return withExecutionRunStartFailureDetails(
        undefined,
        readExecutionRunStartRunCreation(value),
    );
}

export function normalizeExecutionRunRpcPayload<T>(
    payload: unknown,
    options: Readonly<{ executionRunStart?: boolean }> = {},
): ExecutionRunServiceResult<T> {
    if (!isRecord(payload)) {
        return {
            ok: true,
            data: payload as T,
        };
    }

    if (typeof payload.ok !== 'boolean') {
        const topLevelError =
            typeof payload.error === 'string' && payload.error.trim().length > 0
                ? payload.error
                : typeof payload.message === 'string' && payload.message.trim().length > 0
                  ? payload.message
                  : null;
        const topLevelErrorCode =
            typeof payload.errorCode === 'string' && payload.errorCode.trim().length > 0
                ? payload.errorCode
                : typeof payload.code === 'string' && payload.code.trim().length > 0
                  ? payload.code
                  : null;

        if (topLevelError || topLevelErrorCode) {
            const details = options.executionRunStart === true
                ? normalizeExecutionRunStartFailureDetails(payload.details)
                : normalizeExecutionRunFeatureBlockerDetails(payload.details);
            return {
                ok: false,
                code: topLevelErrorCode ?? 'execution_run_failed',
                ...(topLevelError ? { message: topLevelError } : {}),
                ...(details ? { details } : {}),
            };
        }

        return {
            ok: true,
            data: payload as T,
        };
    }

    if (payload.ok === false) {
        const details = options.executionRunStart === true
            ? normalizeExecutionRunStartFailureDetails(payload.details)
            : normalizeExecutionRunFeatureBlockerDetails(payload.details);
        return {
            ok: false,
            code:
                typeof payload.errorCode === 'string' && payload.errorCode.trim().length > 0
                    ? payload.errorCode
                    : typeof payload.code === 'string' && payload.code.trim().length > 0
                      ? payload.code
                      : 'execution_run_failed',
            ...(typeof payload.error === 'string' && payload.error.trim().length > 0
                ? { message: payload.error }
                : typeof payload.message === 'string' && payload.message.trim().length > 0
                  ? { message: payload.message }
                  : {}),
            ...(details ? { details } : {}),
        };
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return {
            ok: true,
            data: (payload as { data: T }).data,
        };
    }

    const { ok: _ok, ...rest } = payload;
    return {
        ok: true,
        data: rest as T,
    };
}

async function callExecutionRunRpc(
    params: ExecutionRunRpcContext & Readonly<{
        methodSuffix: string;
        request: unknown;
        executionRunStart?: boolean;
        transportTimeoutMs?: number | null;
    }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    const {
        methodSuffix,
        executionRunStart,
        transportTimeoutMs,
        ...rpcContext
    } = params;
    const payload = await callSessionRpc({
        ...rpcContext,
        method: `${params.sessionId}:${methodSuffix}`,
        request: params.request,
        ...(transportTimeoutMs !== undefined ? { timeoutMs: transportTimeoutMs } : {}),
    });
    return normalizeExecutionRunRpcPayload(payload, {
        ...(executionRunStart === true ? { executionRunStart: true } : {}),
    });
}

async function fallbackForUnavailableExecutionRunControl(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    params.signal?.throwIfAborted();
    const runId = readExecutionRunRequestRunId(params.request);
    if (!runId) {
        return executionRunControlUnavailable();
    }

    const fallback = await tryBuildExecutionRunGetFallbackRun({
        ...params,
        runId,
    });
    if (!fallback.ok) {
        return executionRunControlUnavailable();
    }
    return fallback.run ? executionRunControlUnavailable() : executionRunNotFound();
}

async function callExecutionRunControlRpc(
    params: ExecutionRunRpcContext & Readonly<{
        methodSuffix: string;
        request: unknown;
        transportTimeoutMs?: number | null;
    }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    try {
        const result = await callExecutionRunRpc(params);
        if (result.ok || !isFallbackSafeExecutionRunServiceError(result)) {
            return result;
        }
        return await fallbackForUnavailableExecutionRunControl(params);
    } catch (error) {
        if (!isFallbackSafeExecutionRunRpcError(error)) {
            throw error;
        }
        return await fallbackForUnavailableExecutionRunControl(params);
    }
}

export { isExecutionRunTerminalStatus } from '@happier-dev/protocol';

export async function startExecutionRun(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    try {
        const result = await callExecutionRunRpc({
            ...params,
            methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_START,
            executionRunStart: true,
            transportTimeoutMs: null,
        });
        return result.ok || !isFallbackSafeExecutionRunServiceError(result)
            ? result
            : executionRunStartUnavailable(readExecutionRunStartRunCreation(result.details));
    } catch (error) {
        const runCreation = readRpcRequestDisposition(error) === 'notSent'
            ? 'noRunCreated'
            : 'outcomeUnknown';
        if (runCreation === 'outcomeUnknown' && isExecutionRunStartResponseTimeout(error)) {
            // A run marker is diagnostic evidence, never a durable receipt: a lost
            // start response stays ambiguous and the caller owns any fresh attempt.
            return {
                ok: false,
                code: 'execution_run_start_ambiguous',
                message: 'Execution run start response timed out; accepted outcome is unknown',
                details: withExecutionRunStartFailureDetails(undefined, 'outcomeUnknown'),
            };
        }
        if (!isFallbackSafeExecutionRunRpcError(error)) {
            if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
                let detailsAttached = false;
                try {
                    Object.defineProperty(error, 'details', {
                        configurable: true,
                        value: withExecutionRunStartFailureDetails(
                            (error as { details?: unknown }).details,
                            runCreation,
                        ),
                    });
                    detailsAttached = true;
                } catch {
                    // Fall through to a preserving wrapper for frozen/non-extensible values.
                }
                if (detailsAttached) throw error;
            }
            throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
                cause: error,
                details: withExecutionRunStartFailureDetails(undefined, runCreation),
            });
        }
        return executionRunStartUnavailable(runCreation);
    }
}

export async function listExecutionRuns(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown; skipLiveRpc?: boolean }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    params.signal?.throwIfAborted();
    const request = ExecutionRunListRequestSchema.parse(params.request);

    if (params.skipLiveRpc === true) {
        const fallback = await buildExecutionRunListFallbackRuns({ ...params, request });
        if (fallback.runs.length > 0) {
            return {
                ok: true,
                data: { runs: fallback.runs },
            };
        }

        return {
            ok: false,
            code: 'execution_run_target_unavailable',
            message: 'Execution run list unavailable',
        };
    }

    try {
        const result = await callExecutionRunRpc({
            ...params,
            methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_LIST,
            request,
        });
        if (!result.ok) {
            if (!isFallbackSafeExecutionRunServiceError(result)) {
                return result;
            }

            const fallback = await buildExecutionRunListFallbackRuns({ ...params, request });
            if (fallback.runs.length > 0) {
                return {
                    ok: true,
                    data: { runs: fallback.runs },
                };
            }

            const fallbackExhaustedCode = classifyExecutionRunServiceFallback(result);
            return fallbackExhaustedCode
                ? toExecutionRunFallbackExhaustedError(result.message, fallbackExhaustedCode)
                : result;
        }

        const parsed = ExecutionRunListResponseSchema.safeParse(result.data);
        if (!parsed.success) {
            return {
                ok: false,
                code: 'execution_run_invalid_response',
                message: 'Invalid execution run list response',
            };
        }

        const markerRuns = await listMarkerBackedExecutionRuns({ sessionId: params.sessionId });
        const runs = markerRuns.length === 0
            ? applyExecutionRunListRequest(parsed.data.runs, request)
            : applyExecutionRunListRequest(
                mergeExecutionRunLists({
                    primaryRuns: parsed.data.runs,
                    markerRuns,
                }),
                request,
            );

        return {
            ok: true,
            data: {
                ...parsed.data,
                runs,
            },
        };
    } catch (error) {
        if (!isFallbackSafeExecutionRunRpcError(error)) {
            throw error;
        }

        const fallback = await buildExecutionRunListFallbackRuns({ ...params, request });
        if (fallback.runs.length > 0) {
            return {
                ok: true,
                data: { runs: fallback.runs },
            };
        }

        return toExecutionRunFallbackExhaustedError(
            error,
            classifyExecutionRunRpcFallback(error) ?? 'execution_run_target_unavailable',
        );
    }
}

export async function getExecutionRun(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    params.signal?.throwIfAborted();
    const runId = ExecutionRunGetRequestSchema.parse(params.request).runId;

    try {
        const result = await callExecutionRunRpc({
            ...params,
            methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_GET,
        });
        if (result.ok) {
            const parsed = ExecutionRunGetResponseSchema.safeParse(result.data);
            if (!parsed.success) {
                return {
                    ok: false,
                    code: 'execution_run_invalid_response',
                    message: 'Invalid execution run get response',
                };
            }
            return {
                ok: true,
                data: parsed.data,
            };
        }
        if (!isFallbackSafeExecutionRunServiceError(result)) {
            return result;
        }

        const fallback = await tryBuildExecutionRunGetFallbackRun({
            ...params,
            runId,
        });
        if (!fallback.ok) {
            return result;
        }
        if (!fallback.run) {
            const fallbackExhaustedCode = classifyExecutionRunServiceFallback(result);
            return fallbackExhaustedCode
                ? toExecutionRunFallbackExhaustedError(result.message, fallbackExhaustedCode)
                : executionRunNotFound();
        }

        return {
            ok: true,
            data: ExecutionRunGetResponseSchema.parse({ run: fallback.run }),
        };
    } catch (error) {
        if (!isFallbackSafeExecutionRunRpcError(error)) {
            throw error;
        }

        const fallback = await tryBuildExecutionRunGetFallbackRun({
            ...params,
            runId,
        });
        if (!fallback.ok) {
            return toExecutionRunFallbackExhaustedError(
                error,
                classifyExecutionRunRpcFallback(error) ?? 'execution_run_target_unavailable',
            );
        }
        if (!fallback.run) {
            return toExecutionRunFallbackExhaustedError(
                error,
                classifyExecutionRunRpcFallback(error) ?? 'execution_run_target_unavailable',
            );
        }

        return {
            ok: true,
            data: ExecutionRunGetResponseSchema.parse({ run: fallback.run }),
        };
    }
}

/** Released attached-send compatibility: current input uses session.message.send. */
export async function sendExecutionRunMessage(
    _params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    return {
        ok: false,
        code: 'session_input_target_update_required',
        message: 'session_input_target_update_required',
    };
}

export async function stopExecutionRun(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    return await callExecutionRunControlRpc({
        ...params,
        methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_STOP,
        transportTimeoutMs: null,
    });
}

export async function executeExecutionRunAction(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    return await callExecutionRunControlRpc({
        ...params,
        methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_ACTION,
        transportTimeoutMs: null,
    });
}

export async function ensureExecutionRun(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    return await callExecutionRunControlRpc({
        ...params,
        methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_ENSURE,
        transportTimeoutMs: null,
    });
}

export async function ensureOrStartExecutionRun(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    return await callExecutionRunControlRpc({
        ...params,
        methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_ENSURE_OR_START,
        transportTimeoutMs: null,
    });
}

export async function startExecutionRunStream(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    return await callExecutionRunControlRpc({
        ...params,
        methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_START,
        transportTimeoutMs: null,
    });
}

export async function readExecutionRunStream(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    return await callExecutionRunControlRpc({
        ...params,
        methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_READ,
        ...(isRecord(params.request) && params.request.waitForEvents === true ? { transportTimeoutMs: null } : {}),
    });
}

export async function cancelExecutionRunStream(
    params: ExecutionRunRpcContext & Readonly<{ request: unknown }>,
): Promise<ExecutionRunServiceResult<unknown>> {
    return await callExecutionRunControlRpc({
        ...params,
        methodSuffix: SESSION_RPC_METHODS.EXECUTION_RUN_STREAM_CANCEL,
        transportTimeoutMs: null,
    });
}

type ExecutionRunWaitRequest = Readonly<{
    runId: string;
    timeoutMs: number | null;
    signal?: AbortSignal;
}>;

function projectTerminalExecutionRunWaitResult(data: unknown): WaitForExecutionRunResult | null {
    if (!isRecord(data) || !isRecord(data.run) || !isExecutionRunTerminalStatus(data.run.status)) {
        return null;
    }
    return {
        ok: true,
        status: data.run.status,
        result: data,
    };
}

async function readExecutionRunWaitCompatibilitySnapshot(
    params: ExecutionRunRpcContext & ExecutionRunWaitRequest,
): Promise<WaitForExecutionRunResult | null> {
    const snapshot = await getExecutionRun({
        ...params,
        request: ExecutionRunGetRequestSchema.parse({
            runId: params.runId,
            includeStructured: true,
        }),
    });
    return snapshot.ok ? projectTerminalExecutionRunWaitResult(snapshot.data) : snapshot;
}

export async function waitForExecutionRun(
    params: ExecutionRunRpcContext & ExecutionRunWaitRequest,
): Promise<WaitForExecutionRunResult> {
    const request = {
        runId: params.runId,
        ...(params.timeoutMs === null
            ? {}
            : { timeoutSeconds: Math.max(1, Math.ceil(params.timeoutMs / 1_000)) }),
    };
    try {
        const waitedPayload = await callSessionRpc({
            ...params,
            token: params.token,
            sessionId: params.sessionId,
            method: `${params.sessionId}:${SESSION_RPC_METHODS.EXECUTION_RUN_WAIT}`,
            request,
            // The daemon owns the optional observation deadline. A second local
            // acknowledgement timer can only race and discard its final reply.
            timeoutMs: null,
        });
        const waited = ExecutionRunWaitResultSchema.safeParse(waitedPayload);
        if (waited.success) {
            return waited.data;
        }
        const normalized = normalizeExecutionRunRpcPayload(waitedPayload);
        if (!normalized.ok && isFallbackSafeExecutionRunServiceError(normalized)) {
            return await readExecutionRunWaitCompatibilitySnapshot(params) ?? normalized;
        }
        return {
            ok: false,
            code: 'execution_run_wait_result_invalid',
            message: 'Execution run wait returned an invalid result',
        };
    } catch (error) {
        const fallbackCode = classifyExecutionRunRpcFallback(error);
        if (!fallbackCode) throw error;
        const fallback = await readExecutionRunWaitCompatibilitySnapshot(params);
        return fallback ?? {
            ok: false,
            code: fallbackCode,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}
