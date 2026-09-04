import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const createWorkspaceFileTransferRpcCallerMock = vi.hoisted(() => vi.fn());
const directExportDownloadMock = vi.hoisted(() => vi.fn());
const relayDownloadMock = vi.hoisted(() => vi.fn());
const bulkDownloadMock = vi.hoisted(() => vi.fn());
const createBufferedTransferDestinationMock = vi.hoisted(() => vi.fn());
const carrierBoundary = vi.hoisted(() => ({ selected: false, acquire: vi.fn() }));

vi.mock('../plumbing/directTransferExportDownload', () => ({
    downloadBulkPayloadViaDirectExportToDestination: (...args: unknown[]) => directExportDownloadMock(...args),
}));

vi.mock('../plumbing/downloadBulkPayloadViaServerRelayToDestination', () => ({
    downloadBulkPayloadViaServerRelayToDestination: (...args: unknown[]) => relayDownloadMock(...args),
}));

vi.mock('../carriers/downloadBulkPayloadViaMachineRpcToDestination', () => ({
    downloadBulkPayloadViaMachineRpcToDestination: (...args: unknown[]) => bulkDownloadMock(...args),
}));

vi.mock('./workspaceFileTransferRpcCaller', () => ({
    createWorkspaceFileTransferRpcCaller: (...args: unknown[]) => createWorkspaceFileTransferRpcCallerMock(...args),
}));

vi.mock('../carriers/createBufferedTransferDestination', () => ({
    createBufferedTransferDestination: (...args: unknown[]) => createBufferedTransferDestinationMock(...args),
}));

vi.mock('../plumbing/machineCarrierHttpLease', async (importOriginal) => ({
    ...await importOriginal<typeof import('../plumbing/machineCarrierHttpLease')>(),
    resolveMachineCarrierRoute: () => carrierBoundary.selected
        ? { kind: 'iroh_peer', acquire: (...args: unknown[]) => carrierBoundary.acquire(...args) }
        : { kind: 'standard' },
}));

describe('workspaceFileTransfers', () => {
    beforeEach(() => {
        createWorkspaceFileTransferRpcCallerMock.mockReset();
        directExportDownloadMock.mockReset();
        relayDownloadMock.mockReset();
        bulkDownloadMock.mockReset();
        createBufferedTransferDestinationMock.mockReset();
        carrierBoundary.selected = false;
        carrierBoundary.acquire.mockReset();

        createWorkspaceFileTransferRpcCallerMock.mockImplementation((params: unknown) => ({
            call: vi.fn(async (callParams: any) => {
                if (callParams.machineMethod === RPC_METHODS.STAT_FILE) {
                    return { success: true, exists: true, kind: 'file', sizeBytes: 3 };
                }
                throw new Error(`unexpected call: ${callParams.machineMethod}`);
            }),
        }));

        createBufferedTransferDestinationMock.mockImplementation(() => ({
            destination: {
                writeBytes: async () => {},
                close: async () => {},
                cleanup: async () => {},
            },
            toBase64: vi.fn(() => 'YWJj'),
            reset: vi.fn(),
        }));

        directExportDownloadMock.mockResolvedValue({
            ok: false,
            error: 'Direct export unavailable',
        });
        relayDownloadMock.mockResolvedValue({
            ok: false,
            error: 'Relay unavailable',
        });
        bulkDownloadMock.mockResolvedValue({
            ok: false,
            error: 'Bulk download unavailable',
            errorCode: 'BULK_DOWNLOAD_UNAVAILABLE',
        });
    });

    it('preserves the bulk fallback errorCode when inline file download falls through all carriers', async () => {
        const { downloadDaemonWorkspaceFileToBase64 } = await import('./workspaceFileTransfers');
        const result = await downloadDaemonWorkspaceFileToBase64({
            machineId: 'machine-1',
            rootPath: '/repo',
            path: 'a.txt',
            maxBytes: 128,
        });

        expect(result).toEqual({
            ok: false,
            error: 'Bulk download unavailable',
            errorCode: 'BULK_DOWNLOAD_UNAVAILABLE',
        });
        expect(directExportDownloadMock).toHaveBeenCalledTimes(1);
        expect(relayDownloadMock).toHaveBeenCalledTimes(1);
        expect(bulkDownloadMock).toHaveBeenCalledTimes(1);
        expect(createBufferedTransferDestinationMock).toHaveBeenCalledTimes(3);
        expect(directExportDownloadMock.mock.calls[0]?.[0]?.destination).not.toBe(relayDownloadMock.mock.calls[0]?.[0]?.destination);
        expect(relayDownloadMock.mock.calls[0]?.[0]?.destination).not.toBe(bulkDownloadMock.mock.calls[0]?.[0]?.destination);
        expect(createBufferedTransferDestinationMock.mock.results[0]?.value.toBase64).not.toHaveBeenCalled();
        expect(createBufferedTransferDestinationMock.mock.results[1]?.value.toBase64).not.toHaveBeenCalled();
        expect(createBufferedTransferDestinationMock.mock.results[2]?.value.toBase64).not.toHaveBeenCalled();
    });

    it('cleans up a timed-out relay attempt before reaching the retained machine-RPC fallback', async () => {
        relayDownloadMock.mockResolvedValue({
            ok: false,
            error: 'Server relay transfer timed out',
        });
        bulkDownloadMock.mockResolvedValue({
            ok: true,
            name: 'a.txt',
            sizeBytes: 3,
        });
        const cleanup = vi.fn(async () => {});

        const { downloadDaemonWorkspaceFileToDestination } = await import('./workspaceFileTransfers');
        const result = await downloadDaemonWorkspaceFileToDestination({
            machineId: 'machine-1',
            rootPath: '/repo',
            request: {
                path: 'a.txt',
                asZip: false,
            },
            destination: {
                writeBytes: async () => {},
                close: async () => {},
                cleanup,
            },
        });

        expect(result).toEqual({
            ok: true,
            name: 'a.txt',
            sizeBytes: 3,
        });
        expect(directExportDownloadMock).toHaveBeenCalledTimes(1);
        expect(relayDownloadMock).toHaveBeenCalledTimes(1);
        expect(bulkDownloadMock).toHaveBeenCalledTimes(1);
        expect(cleanup).toHaveBeenCalledTimes(2);
        expect(directExportDownloadMock.mock.invocationCallOrder[0]).toBeLessThan(
            relayDownloadMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
        );
        expect(relayDownloadMock.mock.invocationCallOrder[0]).toBeLessThan(
            bulkDownloadMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
        );
    });

    it('pins workspace file download to the acquired machine HTTP origin and releases once', async () => {
        const release = vi.fn(async () => undefined);
        const cleanup = vi.fn(async () => undefined);
        const acquireMachineCarrierHttpLease = vi.fn(async () => ({
            kind: 'native_http' as const,
            localOrigin: 'http://localhost:48128',
            requestHeaders: { 'X-Happier-Machine-Local-Capability': 'a'.repeat(64) },
            release,
        }));
        carrierBoundary.selected = true;
        carrierBoundary.acquire.mockImplementation(acquireMachineCarrierHttpLease);
        directExportDownloadMock.mockImplementationOnce(async (params: {
            acquirePreparedCarrier: (prepared: { operationId: string; maxBytes: number }) => Promise<{ release: () => Promise<void> }>;
        }) => {
            const lease = await params.acquirePreparedCarrier({ operationId: 'workspace-download-1', maxBytes: 3 });
            await lease.release();
            return { ok: true, name: 'a.txt', sizeBytes: 3 };
        });

        const { downloadDaemonWorkspaceFileToDestination } = await import('./workspaceFileTransfers');
        const result = await downloadDaemonWorkspaceFileToDestination({
            machineId: 'machine-1',
            rootPath: '/repo',
            request: { path: 'a.txt', asZip: false },
            destination: {
                writeBytes: async () => undefined,
                close: async () => undefined,
                cleanup,
            },
        });

        expect(result).toEqual({ ok: true, name: 'a.txt', sizeBytes: 3 });
        expect(directExportDownloadMock).toHaveBeenCalledWith(expect.objectContaining({
            acquirePreparedCarrier: expect.any(Function),
        }));
        expect(relayDownloadMock).not.toHaveBeenCalled();
        expect(bulkDownloadMock).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
        expect(cleanup).not.toHaveBeenCalled();
        expect(acquireMachineCarrierHttpLease).toHaveBeenCalledWith(expect.objectContaining({
            operationId: 'workspace-download-1',
            maxBytes: 3,
        }));
    });

    it('does not fall back when a required workspace machine-carrier download fails', async () => {
        const cleanup = vi.fn(async () => undefined);
        carrierBoundary.selected = true;
        carrierBoundary.acquire.mockResolvedValueOnce({
            kind: 'native_http',
            localOrigin: 'http://127.0.0.1:48130',
            requestHeaders: { 'X-Happier-Machine-Local-Capability': 'b'.repeat(64) },
            release: async () => undefined,
        });
        directExportDownloadMock.mockImplementationOnce(async (params: {
            acquirePreparedCarrier: (prepared: { operationId: string; maxBytes: number }) => Promise<unknown>;
        }) => {
            await params.acquirePreparedCarrier({ operationId: 'workspace-download-failed', maxBytes: 3 });
            return {
                ok: false,
                error: 'The direct machine connection was interrupted. Retry the transfer.',
                errorCode: 'machine_carrier_transport_failed',
            };
        });

        const { downloadDaemonWorkspaceFileToDestination } = await import('./workspaceFileTransfers');
        const result = await downloadDaemonWorkspaceFileToDestination({
            machineId: 'machine-1',
            rootPath: '/repo',
            request: { path: 'a.txt', asZip: false },
            destination: {
                writeBytes: async () => undefined,
                close: async () => undefined,
                cleanup,
            },
        });

        expect(result).toMatchObject({ ok: false, errorCode: 'machine_carrier_transport_failed' });
        expect(relayDownloadMock).not.toHaveBeenCalled();
        expect(bulkDownloadMock).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('rejects file-download destinations that cannot be cleaned up between carrier retries', async () => {
        const { downloadDaemonWorkspaceFileToDestination } = await import('./workspaceFileTransfers');
        const result = await downloadDaemonWorkspaceFileToDestination({
            machineId: 'machine-1',
            rootPath: '/repo',
            request: {
                path: 'a.txt',
                asZip: false,
            },
            destination: {
                writeBytes: async () => {},
                close: async () => {},
            },
        });

        expect(result).toEqual({
            ok: false,
            error: 'Workspace file download destination cleanup is required for retry-safe transfers',
        });
        expect(directExportDownloadMock).not.toHaveBeenCalled();
        expect(relayDownloadMock).not.toHaveBeenCalled();
        expect(bulkDownloadMock).not.toHaveBeenCalled();
    });

});
