import { describe, expect, it } from 'vitest';
import { deriveBoxPublicKeyFromSeed } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createSessionAttachmentTransferRouting, downloadDaemonSessionAttachmentToDestination, uploadDaemonSessionAttachmentFromReader } from './sessionAttachmentTransfers';
import { createEncryptedTransferChunkEnvelope } from '../plumbing/transferChunkEncryption';
import { isTransferFinalizeRecoveryFailure } from '../plumbing/directTransferFinalizeRecovery';

describe('session-bound attachment carrier', () => {
    it('previews a handle using the encrypted download loop without sending a filesystem path', async () => {
        let recipientPublicKeyBase64 = '';
        let downloadOpen = false;
        const bytes = new Uint8Array([1, 2, 3]);
        const downloaded: number[] = [];
        const handle = { v: 1 as const, sessionId: 'session-a', id: 'attachment-a' };
        // Genuine network boundary; the transfer encryption and destination logic remain real.
        const call = async <T>(method: string, request: unknown): Promise<T> => {
            const routing = createSessionAttachmentTransferRouting('session-a', method);
            expect(routing.t).toBe('session_attachment_download_v1');
            if (method === RPC_METHODS.DAEMON_TRANSFER_DOWNLOAD_INIT) {
                expect(request).toMatchObject({ t: 'session_attachment_download_v1', attachmentHandle: handle });
                expect(request).not.toHaveProperty('path');
                recipientPublicKeyBase64 = (request as { recipientPublicKeyBase64: string }).recipientPublicKeyBase64;
                downloadOpen = true;
                return { success: true, downloadId: 'download-a', chunkSizeBytes: 3, sizeBytes: 3, name: 'notes.png' } as T;
            }
            if (method === RPC_METHODS.DAEMON_TRANSFER_DOWNLOAD_CHUNK) {
                return { success: true, isLast: true, ...await createEncryptedTransferChunkEnvelope({
                    transferId: 'download-a', sequence: 0, payload: bytes, recipientPublicKeyBase64,
                }) } as T;
            }
            downloadOpen = false;
            return { success: true } as T;
        };
        const result = await downloadDaemonSessionAttachmentToDestination({
            transferContext: { kind: 'sessionBound', sessionId: 'session-a', call }, attachmentHandle: handle,
            destination: { writeBytes: async (chunk) => { downloaded.push(...chunk); }, close: async () => {} },
        });
        expect(result).toMatchObject({ ok: true, sizeBytes: bytes.length, name: 'notes.png' });
        expect(downloaded).toEqual([...bytes]);
        expect(downloadOpen).toBe(false);
    });

    it('retains staged upload custody for explicit finalize recovery', async () => {
        let staged = false;
        let recoveryRequired = true;
        let readerClosed = false;
        const call = async <T>(method: string): Promise<T> => {
            expect(createSessionAttachmentTransferRouting('session-a', method).t).toBe('session_attachment_upload_v1');
            if (method === RPC_METHODS.DAEMON_TRANSFER_UPLOAD_INIT) {
                staged = true;
                return { success: true, uploadId: 'upload-a', chunkSizeBytes: 2, expiresAt: 1234,
                    recipientPublicKeyBase64: Buffer.from(deriveBoxPublicKeyFromSeed(new Uint8Array(32).fill(7))).toString('base64') } as T;
            }
            if (method === RPC_METHODS.DAEMON_TRANSFER_UPLOAD_FINALIZE && recoveryRequired) {
                recoveryRequired = false;
                return { success: false, error: 'Destination unavailable', errorCode: 'TRANSFER_FINALIZE_RECOVERY_REQUIRED', expiresAt: 1234 } as T;
            }
            staged = false;
            return { success: true, path: 'notes.txt', sizeBytes: 0, sha256: 'hash',
                attachmentHandle: { v: 1, sessionId: 'session-a', id: 'attachment-a' } } as T;
        };
        const result = await uploadDaemonSessionAttachmentFromReader({
            sessionId: 'session-a', transferContext: { kind: 'sessionBound', sessionId: 'session-a', call },
            fileReader: { sizeBytes: 0, readBytes: async () => new Uint8Array(), close: async () => { readerClosed = true; } },
            request: { messageLocalId: 'message-a', fileName: 'notes.txt', sizeBytes: 0, uploadLocation: 'workspace',
                workspaceRelativeDir: '.happier/attachments', vcsIgnoreStrategy: 'none', vcsIgnoreWritesEnabled: false },
        });
        expect(readerClosed).toBe(true);
        expect(staged).toBe(true);
        if (!isTransferFinalizeRecoveryFailure(result)) throw new Error('Expected actionable transfer recovery');
        expect(await result.recovery.invoke('retry_finalize')).toMatchObject({ status: 'finalized', response: { attachmentHandle: { id: 'attachment-a' } } });
        expect(result.recovery.isActionable()).toBe(false);
        expect(staged).toBe(false);
    });

    it('uploads without machine state and retries an interrupted chunk through the same owner', async () => {
        let interrupted = true;
        let closed = 0;
        const methods: string[] = [];
        const call = async <T>(method: string, request: unknown): Promise<T> => {
            methods.push(method);
            if (method === RPC_METHODS.DAEMON_TRANSFER_UPLOAD_INIT) {
                expect(request).toMatchObject({ t: 'session_attachment_upload_v1' });
                expect(request).not.toHaveProperty('workingDirectory');
                return { success: true, uploadId: 'upload-a', chunkSizeBytes: 2,
                    recipientPublicKeyBase64: Buffer.from(deriveBoxPublicKeyFromSeed(new Uint8Array(32).fill(7))).toString('base64') } as T;
            }
            if (method === RPC_METHODS.DAEMON_TRANSFER_UPLOAD_CHUNK && interrupted) {
                interrupted = false;
                throw new Error('connection interrupted');
            }
            if (method === RPC_METHODS.DAEMON_TRANSFER_UPLOAD_FINALIZE) {
                return { success: true, path: '/session/notes.txt', sizeBytes: 3, sha256: 'hash',
                    attachmentHandle: { v: 1, sessionId: 'session-a', id: 'attachment-a' } } as T;
            }
            return { success: true } as T;
        };
        const upload = () => uploadDaemonSessionAttachmentFromReader({
            sessionId: 'session-a',
            transferContext: { kind: 'sessionBound', sessionId: 'session-a', call },
            fileReader: { sizeBytes: 3, readBytes: async (offset, length) => new Uint8Array([1, 2, 3]).slice(offset, offset + length), close: async () => { closed++; } },
            request: { messageLocalId: 'message-a', fileName: 'notes.txt', sizeBytes: 3, uploadLocation: 'workspace',
                workspaceRelativeDir: '.happier/attachments', vcsIgnoreStrategy: 'none', vcsIgnoreWritesEnabled: false },
        });
        await expect(upload()).rejects.toThrow('connection interrupted');
        expect(await upload()).toMatchObject({ success: true, attachmentHandle: { sessionId: 'session-a' } });
        expect(closed).toBe(2);
        expect(methods).toContain(RPC_METHODS.DAEMON_TRANSFER_UPLOAD_ABORT);
    });
});
