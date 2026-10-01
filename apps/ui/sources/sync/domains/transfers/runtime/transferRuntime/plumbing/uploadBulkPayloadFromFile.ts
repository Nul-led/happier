import { type ChunkUploadProgress, uploadInChunks } from './chunkTransferClient';

export type BulkTransferFailureResponse = Readonly<{
    success: false;
    error: string;
    errorCode?: string;
}>;

export type BulkTransferFileReader = Readonly<{
    sizeBytes: number;
    readBytes: (offset: number, length: number) => Promise<Uint8Array>;
    close: () => Promise<void>;
}>;

type BulkTransferUploadInitSuccess = Readonly<{
    success: true;
    uploadId: string;
    chunkSizeBytes: number;
    recipientPublicKeyBase64: string;
}>;

export async function uploadBulkPayloadFromFile<TFinalize extends { success: boolean; error?: string }>(params: Readonly<{
    fileReader: BulkTransferFileReader;
    init: (signal?: AbortSignal | null) => Promise<BulkTransferUploadInitSuccess | BulkTransferFailureResponse>;
    sendChunk: (request: Readonly<{
        uploadId: string;
        index: number;
        payloadBase64: string;
        encryptedDataKeyEnvelopeBase64: string;
    }>, signal?: AbortSignal | null) => Promise<{ success: boolean; error?: string }>;
    finalize: (request: Readonly<{ uploadId: string }>, signal?: AbortSignal | null) => Promise<TFinalize>;
    abort?: ((request: Readonly<{ uploadId: string }>) => Promise<unknown>) | null;
    closeFileReader?: boolean;
    retainUploadAfterFinalize?: (response: TFinalize) => boolean;
    onProgress?: ((progress: ChunkUploadProgress) => void) | null;
    signal?: AbortSignal | null;
}>): Promise<TFinalize | BulkTransferFailureResponse> {
    try {
        const init = params.signal
            ? await params.init(params.signal)
            : await params.init();
        if (init.success !== true) {
            return init;
        }

        return await uploadInChunks<BulkTransferUploadInitSuccess, { success: boolean; error?: string }, TFinalize>({
            totalBytes: params.fileReader.sizeBytes,
            readBytes: async (offset, length) => await params.fileReader.readBytes(offset, length),
            init: async () => init,
            sendChunk: async (request, signal) => signal
                ? await params.sendChunk(request, signal)
                : await params.sendChunk(request),
            finalize: async (request, signal) => signal
                ? await params.finalize(request, signal)
                : await params.finalize(request),
            abort: params.abort ?? null,
            onProgress: params.onProgress ?? null,
            signal: params.signal ?? null,
            retainUploadAfterFinalize: params.retainUploadAfterFinalize,
        });
    } finally {
        if (params.closeFileReader !== false) {
            await params.fileReader.close();
        }
    }
}
