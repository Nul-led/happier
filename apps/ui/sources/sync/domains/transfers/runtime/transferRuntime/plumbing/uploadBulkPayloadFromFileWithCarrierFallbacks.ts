import {
    DIRECT_IMPORT_CLEANUP_FAILED_ERROR_CODE,
    isDirectImportTerminalFinalizeErrorCode,
    type DirectTransferImportFinalizeResponse,
    type DirectTransferImportOpenRequest,
} from './directTransferImportClient';
import {
    uploadBulkPayloadFromFileViaDirectImport,
    type TransferFinalizeRecoveryFailure,
} from './directTransferImportUpload';
import {
    type BulkTransferFailureResponse,
    type BulkTransferFileReader,
    uploadBulkPayloadFromFile,
} from './uploadBulkPayloadFromFile';
import {
    isIrohMachineCarrierRoute,
    MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR,
    resolveMachineCarrierRoute,
    type MachineCarrierRoute,
} from './machineCarrierHttpLease';

type UploadResponse = Readonly<{ success: boolean; error?: string }>;

type RelayUpload<TResponse extends UploadResponse> = Readonly<{
    init: () => Promise<
        | Readonly<{
            success: true;
            uploadId: string;
            chunkSizeBytes: number;
            recipientPublicKeyBase64: string;
        }>
        | BulkTransferFailureResponse
    >;
    sendChunk: (request: Readonly<{
        uploadId: string;
        index: number;
        payloadBase64: string;
        encryptedDataKeyEnvelopeBase64: string;
    }>) => Promise<UploadResponse>;
    finalize: (request: Readonly<{ uploadId: string }>) => Promise<TResponse | BulkTransferFailureResponse>;
    abort?: ((request: Readonly<{ uploadId: string }>) => Promise<unknown>) | null;
}>;

function toDirectFailure(error: unknown): BulkTransferFailureResponse {
    return {
        success: false,
        error: error instanceof Error ? error.message : 'Direct import upload unavailable',
    };
}

export async function uploadBulkPayloadFromFileWithCarrierFallbacks<
    TResponse extends UploadResponse,
>(params: Readonly<{
    machineId: string;
    serverId?: string | null;
    fileReader: BulkTransferFileReader;
    directImportRequest: DirectTransferImportOpenRequest;
    parseDirectFinalizeResponse?: ((response: Extract<DirectTransferImportFinalizeResponse, { success: true }>) => TResponse | null) | null;
    relay: RelayUpload<TResponse>;
    timeoutMs?: number | null;
    signal?: AbortSignal | null;
    onProgress?: ((progress: Readonly<{ uploadedBytes: number; totalBytes: number }>) => void) | null;
}>): Promise<TResponse | BulkTransferFailureResponse | TransferFinalizeRecoveryFailure<TResponse>> {
    let machineRoute: MachineCarrierRoute | null = null;
    try {
        let directResult: TResponse | BulkTransferFailureResponse | TransferFinalizeRecoveryFailure<TResponse>;
        try {
            directResult = await uploadBulkPayloadFromFileViaDirectImport<TResponse>({
                machineId: params.machineId,
                ...(typeof params.serverId === 'string' ? { serverId: params.serverId } : {}),
                fileReader: params.fileReader,
                request: params.directImportRequest,
                parseFinalizeResponse: params.parseDirectFinalizeResponse ?? null,
                timeoutMs: params.timeoutMs ?? null,
                signal: params.signal ?? null,
                onProgress: params.onProgress ?? null,
                acquirePreparedCarrier: async ({ operationId, maxBytes }) => {
                    machineRoute ??= await resolveMachineCarrierRoute(params.machineId, params.serverId);
                    return machineRoute.kind === 'iroh_peer' ? await machineRoute.acquire({
                        operationId,
                        maxBytes,
                        flow: params.directImportRequest.t === 'session_attachment_upload_v1'
                            ? 'attachment_transfer'
                            : 'file_transfer',
                        signal: params.signal ?? undefined,
                    })
                        : null;
                },
            });
        } catch (error) {
            directResult = toDirectFailure(error);
        }

        if (directResult.success === true || params.signal?.aborted) {
            return directResult;
        }
        const directFailureErrorCode = 'errorCode' in directResult
            && typeof directResult.errorCode === 'string'
            ? directResult.errorCode
            : null;
        if (
            directFailureErrorCode === DIRECT_IMPORT_CLEANUP_FAILED_ERROR_CODE
            || isDirectImportTerminalFinalizeErrorCode(directFailureErrorCode)
        ) {
            return directResult;
        }

        if (isIrohMachineCarrierRoute(machineRoute)) {
            return {
                success: false,
                error: MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR,
                errorCode: 'machine_carrier_transport_failed',
            };
        }

        return await uploadBulkPayloadFromFile<TResponse | BulkTransferFailureResponse>({
            fileReader: params.fileReader,
            init: params.relay.init,
            sendChunk: params.relay.sendChunk,
            finalize: params.relay.finalize,
            abort: params.relay.abort ?? null,
            closeFileReader: false,
            signal: params.signal ?? null,
            onProgress: params.onProgress ?? null,
        });
    } finally {
        await params.fileReader.close();
    }
}
