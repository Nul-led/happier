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
    MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR,
    MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR,
    type AcquireMachineCarrierHttpLease,
    type MachineCarrierHttpLease,
    normalizeMachineCarrierGrantMaxBytes,
    normalizeMachineCarrierHttpLocalOrigin,
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
    /** Pin this operation to the authenticated Iroh machine/1 carrier. */
    machineCarrierRequired?: boolean;
    machineCarrierOperationId?: string;
    acquireMachineCarrierHttpLease?: AcquireMachineCarrierHttpLease | null;
}>): Promise<TResponse | BulkTransferFailureResponse | TransferFinalizeRecoveryFailure<TResponse>> {
    let machineCarrierLease: MachineCarrierHttpLease | null = null;
    try {
        let httpOriginOverride: string | null = null;
        if (params.machineCarrierRequired) {
            if (!params.acquireMachineCarrierHttpLease) {
                return { success: false, error: MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR, errorCode: 'machine_carrier_unavailable' };
            }
            const maxBytes = normalizeMachineCarrierGrantMaxBytes(
                Number.isSafeInteger(params.fileReader.sizeBytes) && params.fileReader.sizeBytes >= 0
                    ? Math.max(1, params.fileReader.sizeBytes)
                    : null,
            );
            if (maxBytes === null) {
                return { success: false, error: MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR, errorCode: 'machine_carrier_unavailable' };
            }
            try {
                machineCarrierLease = await params.acquireMachineCarrierHttpLease({
                    operationId: params.machineCarrierOperationId ?? 'transfer',
                    machineId: params.machineId,
                    flow: params.directImportRequest.t === 'session_attachment_upload_v1' ? 'attachment_transfer' : 'file_transfer',
                    maxBytes,
                    signal: params.signal ?? undefined,
                });
                httpOriginOverride = normalizeMachineCarrierHttpLocalOrigin(machineCarrierLease.localOrigin);
                if (!httpOriginOverride) {
                    throw new Error('Machine carrier returned an invalid local HTTP origin');
                }
            } catch {
                return {
                    success: false,
                    error: MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR,
                    errorCode: 'machine_carrier_transport_failed',
                };
            }
        }
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
                httpOriginOverride,
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

        if (params.machineCarrierRequired) {
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
        if (machineCarrierLease) {
            try {
                await machineCarrierLease.release();
            } catch {
                // Lease cleanup must not replace the authoritative transfer outcome.
            }
        }
        await params.fileReader.close();
    }
}
