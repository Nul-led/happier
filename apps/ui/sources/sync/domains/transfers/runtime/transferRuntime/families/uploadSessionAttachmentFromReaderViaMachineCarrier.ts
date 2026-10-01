import type {
    SessionAttachmentsUploadFinalizeResponse,
    SessionAttachmentsUploadInitRequest,
    TransferFileReader,
} from './sessionAttachmentTransfers';
import { uploadBulkPayloadFromFileViaMachineCarrier } from '../plumbing/uploadBulkPayloadFromFileViaMachineCarrier';
import type { TransferFinalizeRecoveryFailure } from '../plumbing/directTransferFinalizeRecovery';

type TransferFailureResponse = Readonly<{ success: false; error: string; errorCode?: string }>;
type SessionUploadRequest = SessionAttachmentsUploadInitRequest & Readonly<{
    t: 'session_attachment_upload_v1';
    sessionId: string;
    workingDirectory: string;
}>;
export async function uploadSessionAttachmentFromReaderViaMachineCarrier(params: Readonly<{
    machineId: string;
    serverId?: string | null;
    fileReader: TransferFileReader;
    request: SessionUploadRequest;
    signal?: AbortSignal | null;
    onProgress?: ((progress: Readonly<{ uploadedBytes: number; totalBytes: number }>) => void) | null;
}>): Promise<
    SessionAttachmentsUploadFinalizeResponse
    | TransferFailureResponse
    | TransferFinalizeRecoveryFailure<SessionAttachmentsUploadFinalizeResponse>
> {
    return await uploadBulkPayloadFromFileViaMachineCarrier<SessionAttachmentsUploadFinalizeResponse>({
        machineId: params.machineId,
        ...(typeof params.serverId === 'string' ? { serverId: params.serverId } : {}),
        fileReader: params.fileReader,
        directImportRequest: params.request,
        onProgress: params.onProgress ?? null,
        signal: params.signal ?? null,
    });
}
