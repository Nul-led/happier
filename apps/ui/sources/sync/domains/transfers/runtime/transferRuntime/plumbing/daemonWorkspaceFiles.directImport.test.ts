import { describe, expect, it, vi } from 'vitest';

const directImportUploadMock = vi.hoisted(() => vi.fn());

vi.mock('./uploadBulkPayloadFromFileViaMachineCarrier', () => ({
    uploadBulkPayloadFromFileViaMachineCarrier: (...args: unknown[]) => directImportUploadMock(...args),
}));

import { uploadDaemonWorkspaceFileFromReader } from '../families/workspaceFileTransfers';

describe('daemonWorkspaceFiles upload', () => {
    it('routes workspace uploads through the mandatory machine carrier owner', async () => {
        directImportUploadMock.mockResolvedValue({
            success: true,
            path: '/repo/payload.bin',
            sizeBytes: 5,
            sha256: 'sha256:test',
        });
        const result = await uploadDaemonWorkspaceFileFromReader({
            machineId: 'machine-1',
            serverId: 'server-1',
            rootPath: '/repo',
            fileReader: {
                sizeBytes: 5,
                readBytes: async (offset, length) => new TextEncoder().encode('hello').subarray(offset, offset + length),
                close: async () => {},
            },
            request: {
                path: 'payload.bin',
                sizeBytes: 5,
                overwrite: true,
            },
        });

        expect(result).toEqual({
            success: true,
            path: '/repo/payload.bin',
            sizeBytes: 5,
            sha256: 'sha256:test',
        });
        expect(directImportUploadMock).toHaveBeenCalledTimes(1);
        expect(directImportUploadMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-1',
            fileReader: expect.objectContaining({ sizeBytes: 5 }),
            directImportRequest: {
                t: 'session_file_upload_v1',
                workingDirectory: '/repo',
                path: '/repo/payload.bin',
                sizeBytes: 5,
                overwrite: true,
            },
        }));
    });
});
