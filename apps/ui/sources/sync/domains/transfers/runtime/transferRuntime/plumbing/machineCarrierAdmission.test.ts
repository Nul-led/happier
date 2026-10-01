import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { resolveMachineCarrierRoute } from './machineCarrierHttpLease';

const socketMachineRpc = vi.hoisted(() => vi.fn());

// Socket.IO is the genuine active-Home machine-RPC network boundary. The
// finite-transfer families below stay real so this records any preparation or
// legacy bulk RPC that escapes admission.
vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: {
        machineRPC: (...args: unknown[]) => socketMachineRpc(...args),
    },
}));

// Actual optional native-module discovery is the hardware boundary. All
// endpoint lookup, scoped state, preselection and transfer policy remain real.
vi.mock('@happier-dev/iroh-native', async (importOriginal) => ({
    ...await importOriginal<typeof import('@happier-dev/iroh-native')>(),
    getOptionalHappierIrohNativeModule: () => null,
}));

describe('mandatory finite machine carrier admission', () => {
    let serverId: string;
    const previousPlatform = Platform.OS;
    const networkRequests: string[] = [];

    beforeEach(async () => {
        const profile = await upsertAndActivateServer({ serverUrl: 'https://machine-admission.example.test', scope: 'device' });
        serverId = profile.id;
        expect(serverId).not.toBe('');
        networkRequests.length = 0;
        socketMachineRpc.mockReset();
        socketMachineRpc.mockResolvedValue({ success: false, error: 'Unexpected machine RPC' });
        storage.setState({ machines: {}, machineListByServerId: {} });
        setRuntimeFetch(async (input) => {
            networkRequests.push(String(input));
            return new Response('{}', { status: 503 });
        });
    });

    afterEach(() => {
        Object.defineProperty(Platform, 'OS', { value: previousPlatform, configurable: true });
        vi.unstubAllGlobals();
        resetRuntimeFetch();
    });

    function publishMachine(relayUrls: string[] = []) {
        const machine = createMachineFixture({
            id: 'machine-admission',
            daemonState: { peerMediation: { iroh: { endpoint: {
                endpointId: 'a'.repeat(64), directAddresses: ['127.0.0.1:41101'], relayUrls,
            } } } },
        });
        storage.setState({ machines: { [machine.id]: machine }, machineListByServerId: { [serverId]: [machine] } });
    }

    it.each(['missing endpoint', 'unavailable native lifecycle', 'browser without a relay'] as const)(
        'refuses %s without feature, grant, or transfer network work', async (reason) => {
            if (reason !== 'missing endpoint') publishMachine();
            if (reason === 'browser without a relay') {
                Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
                vi.stubGlobal('SharedWorker', class SharedWorker {});
            }
            await expect(resolveMachineCarrierRoute('machine-admission', serverId)).resolves.toMatchObject({
                kind: 'unavailable', errorCode: 'machine_carrier_unavailable',
            });
            expect(networkRequests).toEqual([]);
        },
    );

    it('refuses a running daemon without a current transfer declaration before network work', async () => {
        const machine = createMachineFixture({
            id: 'machine-admission',
            daemonState: { status: 'running' },
        });
        storage.setState({ machines: { [machine.id]: machine }, machineListByServerId: { [serverId]: [machine] } });

        await expect(resolveMachineCarrierRoute(machine.id, serverId)).resolves.toMatchObject({
            kind: 'unavailable', errorCode: 'machine_carrier_unavailable',
        });
        expect(networkRequests).toEqual([]);
        expect(socketMachineRpc).not.toHaveBeenCalled();
    });

    it('refuses a workspace download before prepare without touching legacy bulk transports', async () => {
        const cleanup = vi.fn(async () => {});
        const { downloadDaemonWorkspaceFileToDestination } = await import('../families/workspaceFileTransfers');

        const result = await downloadDaemonWorkspaceFileToDestination({
            machineId: 'machine-admission',
            serverId,
            rootPath: '/repo',
            request: { path: 'README.md', asZip: false },
            destination: {
                writeBytes: async () => {},
                close: async () => {},
                cleanup,
            },
        });

        expect(result).toMatchObject({ ok: false, errorCode: 'machine_carrier_unavailable' });
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(networkRequests).toEqual([]);
        expect(socketMachineRpc).not.toHaveBeenCalled();
    });

    it('refuses an attachment upload before prepare and still closes the reader', async () => {
        const close = vi.fn(async () => {});
        const { uploadSessionAttachmentFromReaderViaMachineCarrier } = await import('../families/uploadSessionAttachmentFromReaderViaMachineCarrier');

        const result = await uploadSessionAttachmentFromReaderViaMachineCarrier({
            machineId: 'machine-admission',
            serverId,
            fileReader: {
                sizeBytes: 3,
                readBytes: async () => new Uint8Array([1, 2, 3]),
                close,
            },
            request: {
                t: 'session_attachment_upload_v1',
                sessionId: 'session-a',
                workingDirectory: '/repo',
                messageLocalId: 'message-local-1',
                fileName: 'note.txt',
                sizeBytes: 3,
                uploadLocation: 'workspace',
                workspaceRelativeDir: '.',
                vcsIgnoreStrategy: 'none',
                vcsIgnoreWritesEnabled: false,
            },
        });

        expect(result).toMatchObject({ success: false, errorCode: 'machine_carrier_unavailable' });
        expect(close).toHaveBeenCalledTimes(1);
        expect(networkRequests).toEqual([]);
        expect(socketMachineRpc).not.toHaveBeenCalled();
    });
});
