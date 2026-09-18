import { beforeEach, describe, expect, it, vi } from 'vitest';

const machineCarrierUploadMock = vi.hoisted(() => vi.fn());

vi.mock('./uploadBulkPayloadFromFileViaMachineCarrier', () => ({
    uploadBulkPayloadFromFileViaMachineCarrier: (...args: unknown[]) => machineCarrierUploadMock(...args),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: async () => ({ success: false, error: 'unexpected control RPC' }),
}));

import { uploadDaemonPromptAsset } from '../families/promptAssetTransfers';

const request = {
    assetTypeId: 'agents.skill',
    scope: 'user' as const,
    externalRef: null,
    targetName: 'writer',
    title: 'Writer',
    bundleSchemaId: 'skills.skill_md_v1',
    bundleBody: {
        v: 1 as const,
        entries: [],
        createdAtMs: 1,
        updatedAtMs: 1,
    },
    previewOnly: false,
    expectedDigest: null,
};

describe('daemonPromptAssets machine carrier upload', () => {
    beforeEach(() => machineCarrierUploadMock.mockReset());

    it('routes the encoded asset through the mandatory finite carrier owner', async () => {
        machineCarrierUploadMock.mockResolvedValueOnce({
            ok: true,
            externalRef: { skillName: 'writer' },
            digest: 'digest-a',
        });

        await expect(uploadDaemonPromptAsset('machine-1', request, { serverId: 'server-a' })).resolves.toEqual({
            ok: true,
            externalRef: { skillName: 'writer' },
            digest: 'digest-a',
        });
        expect(machineCarrierUploadMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            directImportRequest: expect.objectContaining({
                t: 'prompt_asset_upload_v1',
                sizeBytes: expect.any(Number),
            }),
            parseDirectFinalizeResponse: expect.any(Function),
        }));
    });

    it('preserves retained-session finalize recovery without another mutation path', async () => {
        const recovery = {
            kind: 'transfer_finalize_recovery' as const,
            expiresAt: Date.now() + 60_000,
            actions: ['retry_finalize', 'discard_staged'] as const,
            isActionable: () => true,
            invoke: vi.fn(),
        };
        machineCarrierUploadMock.mockResolvedValueOnce({
            success: false,
            error: 'Finalize recovery is required',
            errorCode: 'TRANSFER_FINALIZE_RECOVERY_REQUIRED',
            recovery,
        });

        await expect(uploadDaemonPromptAsset('machine-1', request)).resolves.toEqual({
            success: false,
            error: 'Finalize recovery is required',
            errorCode: 'TRANSFER_FINALIZE_RECOVERY_REQUIRED',
            recovery,
        });
        expect(machineCarrierUploadMock).toHaveBeenCalledTimes(1);
    });
});
