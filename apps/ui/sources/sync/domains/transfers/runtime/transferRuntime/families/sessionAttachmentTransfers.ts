import { RPC_ERROR_CODES, RPC_METHODS } from '@happier-dev/protocol/rpc';

import { resolveSessionListPreferredServerIdFromState } from '@/sync/domains/session/listing/sessionListLookupState';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import {
    readMachineControlTargetForSession,
    type SessionMachineTargetIdentity,
} from '@/sync/ops/sessionMachineTarget';
import { SESSION_MACHINE_TARGET_UNAVAILABLE_ERROR } from '@/sync/runtime/sessionMachineRpcErrorCodes';

import { uploadSessionAttachmentFromReaderViaMachineCarrier } from './uploadSessionAttachmentFromReaderViaMachineCarrier';
import type { TransferFinalizeRecoveryFailure } from '../plumbing/directTransferFinalizeRecovery';

type SessionRpcFailure = Readonly<{ success: false; error: string; errorCode?: string }>;
type TransferFailureResponse = Readonly<{ success: false; error: string; errorCode?: string }>;
export type TransferFileReader = Readonly<{
    sizeBytes: number;
    readBytes: (offset: number, length: number) => Promise<Uint8Array>;
    close: () => Promise<void>;
}>;

export type SessionAttachmentsUploadInitRequest = Readonly<{
    messageLocalId: string;
    fileName: string;
    sizeBytes: number;
    uploadLocation: 'workspace' | 'os_temp';
    workspaceRootPath?: string;
    workspaceRelativeDir: string;
    vcsIgnoreStrategy: 'git_info_exclude' | 'gitignore' | 'none';
    vcsIgnoreWritesEnabled: boolean;
}>;

export type SessionAttachmentsUploadFinalizeResponse =
    | Readonly<{ success: true; path: string; sizeBytes: number; sha256: string }>
    | SessionRpcFailure;

type SessionAttachmentUploadTarget =
    | Readonly<{ session: SessionMachineTargetIdentity; sessionId?: never }>
    | Readonly<{ sessionId: string; session?: never }>;

export async function uploadDaemonSessionAttachmentFromReader(params: SessionAttachmentUploadTarget & Readonly<{
    fileReader: TransferFileReader;
    request: SessionAttachmentsUploadInitRequest;
    signal?: AbortSignal | null;
    onProgress?: ((progress: Readonly<{ uploadedBytes: number; totalBytes: number }>) => void) | null;
}>): Promise<
    SessionAttachmentsUploadFinalizeResponse
    | TransferFailureResponse
    | TransferFinalizeRecoveryFailure<SessionAttachmentsUploadFinalizeResponse>
> {
    const session = params.session ?? params.sessionId;
    const machineTarget = readMachineControlTargetForSession(session);
    const preferredServerId = typeof session === 'object' && 'serverId' in session
        ? session.serverId
        : resolveSessionListPreferredServerIdFromState(
            storage.getState(),
            typeof session === 'string' ? session : session.sessionId,
            getActiveServerSnapshot().serverId,
        );
    const serverId = preferredServerId ?? undefined;
    if (!machineTarget || !serverId) {
        return {
            success: false,
            error: SESSION_MACHINE_TARGET_UNAVAILABLE_ERROR,
            errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
        };
    }

    return await uploadSessionAttachmentFromReaderViaMachineCarrier({
        machineId: machineTarget.machineId,
        serverId,
        fileReader: params.fileReader,
        request: {
            ...params.request,
            t: 'session_attachment_upload_v1',
            workingDirectory: machineTarget.basePath,
            workspaceRootPath: params.request.uploadLocation === 'workspace'
                ? machineTarget.basePath
                : params.request.workspaceRootPath,
        },
        onProgress: params.onProgress ?? null,
        signal: params.signal ?? null,
    });
}
