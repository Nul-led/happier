import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const routeMock = vi.hoisted(() => vi.fn());
const directExportMock = vi.hoisted(() => vi.fn());
const machineRpcMock = vi.hoisted(() => vi.fn());
const legacyDownloadMock = vi.hoisted(() => vi.fn());

vi.mock('../plumbing/machineCarrierHttpLease', () => ({
    resolveMachineCarrierRoute: (...args: unknown[]) => routeMock(...args),
}));

vi.mock('../plumbing/directTransferExportDownload', () => ({
    downloadBulkJsonPayloadViaDirectExport: (...args: unknown[]) => directExportMock(...args),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (...args: unknown[]) => machineRpcMock(...args),
}));

vi.mock('./downloadBulkJsonPayloadViaMachineRpc', () => ({
    downloadBulkJsonPayloadViaMachineRpc: (...args: unknown[]) => legacyDownloadMock(...args),
}));

describe('downloadJsonPayloadViaMachineCarrier', () => {
    beforeEach(() => {
        routeMock.mockReset();
        directExportMock.mockReset();
        machineRpcMock.mockReset();
        legacyDownloadMock.mockReset();
    });

    it('uses the preselected predecessor chunk-RPC carrier without preparing Iroh', async () => {
        routeMock.mockResolvedValue({ kind: 'legacy_machine_rpc' });
        legacyDownloadMock.mockImplementation(async (params: {
            init: (request: { recipientPublicKeyBase64: string }) => Promise<unknown>;
        }) => {
            await params.init({ recipientPublicKeyBase64: 'recipient-key' });
            return { ok: true, payload: { name: 'legacy' } };
        });
        machineRpcMock.mockResolvedValue({
            success: true,
            downloadId: 'legacy-download',
            chunkSizeBytes: 1024,
            sizeBytes: 17,
            name: 'legacy.json',
        });

        const { downloadJsonPayloadViaMachineCarrier } = await import('./downloadJsonPayloadViaMachineCarrier');
        const result = await downloadJsonPayloadViaMachineCarrier({
            machineId: 'machine-1',
            serverId: 'server-a',
            parsePayload: (value) => value as { name: string },
            directExportRequest: {
                t: 'prompt_asset_download_v1',
                assetTypeId: 'agents.skill',
                scope: 'user',
                externalRef: { name: 'skill-a' },
            },
            predecessorRpc: {
                payloadWithRecipient: (recipientPublicKeyBase64: string) => ({
                    assetTypeId: 'agents.skill',
                    recipientPublicKeyBase64,
                }),
                initMethod: RPC_METHODS.DAEMON_PROMPT_ASSETS_DOWNLOAD_INIT,
                chunkMethod: RPC_METHODS.DAEMON_PROMPT_ASSETS_DOWNLOAD_CHUNK,
                finalizeMethod: RPC_METHODS.DAEMON_PROMPT_ASSETS_DOWNLOAD_FINALIZE,
                abortMethod: RPC_METHODS.DAEMON_PROMPT_ASSETS_DOWNLOAD_ABORT,
            },
        });

        expect(result).toEqual({ ok: true, payload: { name: 'legacy' } });
        expect(legacyDownloadMock).toHaveBeenCalledTimes(1);
        expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            method: RPC_METHODS.DAEMON_PROMPT_ASSETS_DOWNLOAD_INIT,
            payload: {
                assetTypeId: 'agents.skill',
                recipientPublicKeyBase64: 'recipient-key',
            },
            preferScoped: false,
        }));
        expect(directExportMock).not.toHaveBeenCalled();
    });
});
