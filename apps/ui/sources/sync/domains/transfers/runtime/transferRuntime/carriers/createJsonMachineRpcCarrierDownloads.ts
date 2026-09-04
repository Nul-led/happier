import { assertRpcResponseWithSuccess } from '@/sync/runtime/assertRpcResponseWithSuccess';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

import { downloadBulkJsonPayloadViaDirectExport } from '../plumbing/directTransferExportDownload';
import { downloadBulkJsonPayloadViaServerRelay } from '../plumbing/downloadBulkJsonPayloadViaServerRelay';
import { downloadBulkJsonPayloadViaMachineRpc } from './downloadBulkJsonPayloadViaMachineRpc';
import { downloadJsonPayloadWithCarrierFallbacks } from './downloadJsonPayloadWithCarrierFallbacks';
import {
    MACHINE_CARRIER_TRANSPORT_FAILED_ERROR_CODE,
    resolveMachineCarrierRoute,
    type MachineCarrierRoute,
} from '../plumbing/machineCarrierHttpLease';
import { resolveMachineCarrierTransferFlow } from '../routing/machineCarrierTransferFlow';

type JsonDownloadInitSuccess = Readonly<{
    success: true;
    downloadId: string;
    chunkSizeBytes: number;
    sizeBytes: number;
    name: string;
}>;

type JsonDownloadInitFailure = Readonly<{
    success: false;
    error: string;
    errorCode?: string;
}>;

type JsonDownloadInitResponse = JsonDownloadInitSuccess | JsonDownloadInitFailure;

type JsonDownloadFinalizeResponse = Readonly<{
    success: boolean;
    error?: string;
    errorCode?: string;
}>;

type DirectExportDownloadParams = Parameters<typeof downloadBulkJsonPayloadViaDirectExport>[0];
type DirectExportRequest = DirectExportDownloadParams['request'];

type MachineJsonCarrierDownloadParams<TPayload, TPayloadWithRecipient extends object> = Readonly<{
    machineId: string;
    serverId?: string | null;
    timeoutMs?: number;
    preferScoped: boolean;
    payloadWithRecipient: (recipientPublicKeyBase64: string) => TPayloadWithRecipient;
    initMethod: string;
    chunkMethod: string;
    finalizeMethod: string;
    abortMethod: string;
    parsePayload: (value: unknown) => TPayload | null;
    signal?: AbortSignal | null;
}>;

async function callScopedMachineDownloadRpc<TResponse extends { success: boolean }, TPayload>(params: Readonly<{
    machineId: string;
    serverId?: string | null;
    timeoutMs?: number;
    preferScoped: boolean;
    method: string;
    payload: TPayload;
}>): Promise<TResponse> {
    return await assertRpcResponseWithSuccess<TResponse>(
        await machineRpcWithServerScope<TResponse, TPayload>({
            machineId: params.machineId,
            serverId: params.serverId,
            timeoutMs: params.timeoutMs,
            method: params.method,
            preferScoped: params.preferScoped,
            payload: params.payload,
        }),
    );
}

export async function downloadJsonPayloadViaMachineTransferCarriers<
    TPayload,
    TPayloadWithRecipient extends object,
    TDirectExportRequest extends DirectExportRequest,
>(
    params: MachineJsonCarrierDownloadParams<TPayload, TPayloadWithRecipient> & Readonly<{
        directExportRequest: TDirectExportRequest;
    }>,
) {
    let machineRoute: MachineCarrierRoute | null = null;
    const downloadViaDirectExport = async () => await downloadBulkJsonPayloadViaDirectExport({
        machineId: params.machineId,
        serverId: params.serverId,
        timeoutMs: params.timeoutMs,
        request: params.directExportRequest,
        parsePayload: params.parsePayload,
        signal: params.signal ?? null,
        acquirePreparedCarrier: async ({ operationId, maxBytes }) => {
            machineRoute ??= await resolveMachineCarrierRoute(params.machineId, params.serverId);
            return machineRoute.kind === 'iroh_peer' ? await machineRoute.acquire({
                operationId,
                maxBytes,
                flow: resolveMachineCarrierTransferFlow(params.directExportRequest),
                signal: params.signal ?? undefined,
            })
                : null;
        },
    });
    let directResult;
    try {
        directResult = await downloadViaDirectExport();
    } catch {
        directResult = { ok: false as const, error: 'Direct export unavailable' };
    }
    if (directResult.ok) return directResult;
    if (directResult.errorCode === MACHINE_CARRIER_TRANSPORT_FAILED_ERROR_CODE) {
        return directResult;
    }
    return await downloadJsonPayloadWithCarrierFallbacks({
        downloadViaDirectExport: async () => directResult,
        downloadViaServerRelay: async () => await downloadBulkJsonPayloadViaServerRelay<TPayload>({
            machineId: params.machineId,
            serverId: params.serverId,
            timeoutMs: params.timeoutMs,
            init: async (request): Promise<JsonDownloadInitResponse> => await callScopedMachineDownloadRpc({
                machineId: params.machineId,
                serverId: params.serverId,
                timeoutMs: params.timeoutMs,
                preferScoped: params.preferScoped,
                method: params.initMethod,
                payload: params.payloadWithRecipient(request.recipientPublicKeyBase64),
            }),
            finalize: async (request): Promise<JsonDownloadFinalizeResponse> => await callScopedMachineDownloadRpc({
                machineId: params.machineId,
                serverId: params.serverId,
                timeoutMs: params.timeoutMs,
                preferScoped: params.preferScoped,
                method: params.finalizeMethod,
                payload: request,
            }),
            abort: async (request): Promise<JsonDownloadFinalizeResponse> => await callScopedMachineDownloadRpc({
                machineId: params.machineId,
                serverId: params.serverId,
                timeoutMs: params.timeoutMs,
                preferScoped: params.preferScoped,
                method: params.abortMethod,
                payload: request,
            }),
            parsePayload: params.parsePayload,
        }),
        downloadViaChunkRpc: async () => await downloadBulkJsonPayloadViaMachineRpc<TPayload>({
            init: async (request): Promise<JsonDownloadInitResponse> => await callScopedMachineDownloadRpc({
                machineId: params.machineId,
                serverId: params.serverId,
                timeoutMs: params.timeoutMs,
                preferScoped: params.preferScoped,
                method: params.initMethod,
                payload: params.payloadWithRecipient(request.recipientPublicKeyBase64),
            }),
            readChunk: async (request) => await callScopedMachineDownloadRpc({
                machineId: params.machineId,
                serverId: params.serverId,
                timeoutMs: params.timeoutMs,
                preferScoped: params.preferScoped,
                method: params.chunkMethod,
                payload: request,
            }),
            finalize: async (request): Promise<JsonDownloadFinalizeResponse> => await callScopedMachineDownloadRpc({
                machineId: params.machineId,
                serverId: params.serverId,
                timeoutMs: params.timeoutMs,
                preferScoped: params.preferScoped,
                method: params.finalizeMethod,
                payload: request,
            }),
            abort: async (request): Promise<JsonDownloadFinalizeResponse> => await callScopedMachineDownloadRpc({
                machineId: params.machineId,
                serverId: params.serverId,
                timeoutMs: params.timeoutMs,
                preferScoped: params.preferScoped,
                method: params.abortMethod,
                payload: request,
            }),
            parsePayload: params.parsePayload,
        }),
    });
}
