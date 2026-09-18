import {
    type DirectTransferImportFinalizeResponse,
    type DirectTransferImportOpenRequest,
} from './directTransferImportClient';
import {
    uploadBulkPayloadFromFileViaDirectImport,
    type TransferFinalizeRecoveryFailure,
} from './directTransferImportUpload';
import type {
    BulkTransferFailureResponse,
    BulkTransferFileReader,
} from './uploadBulkPayloadFromFile';
import { uploadBulkPayloadFromFile } from './uploadBulkPayloadFromFile';
import { resolveMachineCarrierRoute } from './machineCarrierHttpLease';
import { createWorkspaceFileTransferRpcCaller } from '../families/workspaceFileTransferRpcCaller';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

function toDirectFailure(error: unknown): BulkTransferFailureResponse {
    return {
        success: false,
        error: error instanceof Error ? error.message : 'Direct import upload unavailable',
        ...(error && typeof error === 'object' && typeof (error as { errorCode?: unknown }).errorCode === 'string'
            ? { errorCode: (error as { errorCode: string }).errorCode }
            : {}),
    };
}

/** Uploads one prepared finite transfer through the mandatory machine/1 carrier. */
export async function uploadBulkPayloadFromFileViaMachineCarrier<
    TResponse,
>(params: Readonly<{
    machineId: string;
    serverId?: string | null;
    fileReader: BulkTransferFileReader;
    directImportRequest: DirectTransferImportOpenRequest;
    parseDirectFinalizeResponse?: ((response: Extract<DirectTransferImportFinalizeResponse, { success: true }>) => TResponse | null) | null;
    timeoutMs?: number | null;
    signal?: AbortSignal | null;
    onProgress?: ((progress: Readonly<{ uploadedBytes: number; totalBytes: number }>) => void) | null;
}>): Promise<TResponse | BulkTransferFailureResponse | TransferFinalizeRecoveryFailure<TResponse>> {
    try {
        if (params.signal?.aborted) {
            return { success: false, error: 'Upload canceled' };
        }

        // Selection precedes preparation. An unavailable mandatory carrier must
        // not allocate a transfer that a legacy RPC/relay path could consume.
        const machineRoute = await resolveMachineCarrierRoute(params.machineId, params.serverId);
        if (machineRoute.kind === 'unavailable') {
            return {
                success: false,
                error: machineRoute.error,
                errorCode: machineRoute.errorCode,
            };
        }

        if (machineRoute.kind === 'legacy_machine_rpc') {
            const rpc = createWorkspaceFileTransferRpcCaller({
                machineId: params.machineId,
                ...(typeof params.serverId === 'string' ? { serverId: params.serverId } : {}),
            });
            return await uploadBulkPayloadFromFile<TResponse & { success: boolean; error?: string }>({
                fileReader: params.fileReader,
                closeFileReader: false,
                init: async (signal) => await rpc.call({
                    machineMethod: RPC_METHODS.DAEMON_TRANSFER_UPLOAD_INIT,
                    request: params.directImportRequest,
                    timeoutMs: params.timeoutMs ?? null,
                    signal,
                }),
                sendChunk: async (request, signal) => await rpc.call({
                    machineMethod: RPC_METHODS.DAEMON_TRANSFER_UPLOAD_CHUNK,
                    request,
                    timeoutMs: params.timeoutMs ?? null,
                    signal,
                }),
                finalize: async (request, signal) => await rpc.call({
                    machineMethod: RPC_METHODS.DAEMON_TRANSFER_UPLOAD_FINALIZE,
                    request,
                    timeoutMs: params.timeoutMs ?? null,
                    signal,
                }),
                abort: async (request) => await rpc.call({
                    machineMethod: RPC_METHODS.DAEMON_TRANSFER_UPLOAD_ABORT,
                    request,
                    timeoutMs: params.timeoutMs ?? null,
                }),
                onProgress: params.onProgress ?? null,
                signal: params.signal ?? null,
            }) as TResponse | BulkTransferFailureResponse;
        }

        try {
            return await uploadBulkPayloadFromFileViaDirectImport<TResponse>({
                machineId: params.machineId,
                ...(typeof params.serverId === 'string' ? { serverId: params.serverId } : {}),
                fileReader: params.fileReader,
                request: params.directImportRequest,
                parseFinalizeResponse: params.parseDirectFinalizeResponse ?? null,
                timeoutMs: params.timeoutMs ?? null,
                signal: params.signal ?? null,
                onProgress: params.onProgress ?? null,
                // Acquisition stays pinned to the route selected above, while
                // its cancellation scope belongs to the caller that invokes it:
                // the live upload passes this operation's signal, and the
                // deferred finalize recovery runs after this operation ended.
                acquirePreparedCarrier: machineRoute.acquire,
            });
        } catch (error) {
            return toDirectFailure(error);
        }
    } finally {
        await params.fileReader.close();
    }
}
