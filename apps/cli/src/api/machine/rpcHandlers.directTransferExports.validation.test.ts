import { describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { registerMachineDirectTransferExportRpcHandlers } from './rpcHandlers.directTransferExports';
import type { RpcHandlerRegistrar } from '../rpc/types';

type Handler = (data: unknown) => Promise<unknown>;

function createRpcHandlerRegistrar(): {
    handlers: Map<string, Handler>;
    registrar: RpcHandlerRegistrar;
} {
    const handlers = new Map<string, Handler>();
    return {
        handlers,
        registrar: {
            registerHandler(method, handler) {
                handlers.set(method, async (data) => await handler(data as never));
            },
        },
    };
}

describe('direct transfer export request validation', () => {
    it.each([
        {
            t: 'workspace_file_download_v1',
            workingDirectory: '/repo',
            path: '/repo/file.txt',
            asZip: 'false',
        },
        {
            t: 'workspace_file_download_v1',
            workingDirectory: '/repo',
            path: '/repo/file.txt',
        },
        {
            t: 'workspace_file_download_v1',
            workingDirectory: '/repo',
            path: '/repo/file.txt',
            asZip: false,
            unexpectedAuthority: true,
        },
    ])('rejects malformed workspace export request %# before calling the export owner', async (request) => {
        const prepareExportSession = vi.fn();
        const registrar = createRpcHandlerRegistrar();
        registerMachineDirectTransferExportRpcHandlers({
            rpcHandlerManager: registrar.registrar,
            prepareExportSession,
        });

        const handler = registrar.handlers.get(RPC_METHODS.DAEMON_DIRECT_TRANSFER_EXPORT_PREPARE);
        if (!handler) throw new Error('expected direct transfer export prepare handler');

        await expect(handler(request)).resolves.toEqual({
            success: false,
            error: 'Invalid direct transfer export request',
        });
        expect(prepareExportSession).not.toHaveBeenCalled();
    });
});
