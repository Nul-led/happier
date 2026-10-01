import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION } from '@happier-dev/protocol';
import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';

const ioMock = vi.hoisted(() => vi.fn());

vi.mock('socket.io-client', () => ({
    io: ioMock,
}));

vi.mock('@/utils/proxy/socketIoProxy', () => ({
    getSocketIoProxyOptions: () => ({}),
}));

describe('createMachineSocketTransport', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        ioMock.mockClear();
        ioMock.mockImplementation((_url: string, options: { auth: Record<string, unknown> }) => {
            return Object.assign(createApiSessionSocketStub({ disconnectReason: 'io client disconnect' }), {
                auth: options.auth,
            });
        });
    });

    it('refreshes terminal policy before each socket connection and narrows the new handshake', async () => {
        const get = vi.spyOn(axios, 'get')
            .mockResolvedValueOnce({ status: 200, data: {
                v: 1, encryptionMode: 'plain', nativeEmail: null,
                password: { status: 'not_enrolled', revision: null }, terminalPresentUserPolicy: 'allowed',
            } })
            .mockResolvedValueOnce({ status: 200, data: {
                v: 1, encryptionMode: 'plain', nativeEmail: null,
                password: { status: 'not_enrolled', revision: null }, terminalPresentUserPolicy: 'disallowed',
            } });
        const { createMachineSocketTransport } = await import('./createMachineSocketTransport');
        const { socket, transport } = createMachineSocketTransport({
            serverUrl: 'https://policy-reconnect.example.com', token: 'reconnect-test',
            machineId: 'machine-1', env: {},
        });
        await transport.connect();
        expect(socket.auth).not.toHaveProperty('authorityCeiling');
        await transport.disconnect();
        await transport.connect();
        expect(socket.auth).toHaveProperty('authorityCeiling', 'account_automation');
        expect(get).toHaveBeenCalledWith('https://policy-reconnect.example.com/v1/account/security', expect.anything());
        const { resolveEffectiveTerminalPresentUserPolicy } = await import('@/settings/accountSettings/resolveEffectiveTerminalPresentUserPolicy');
        expect(resolveEffectiveTerminalPresentUserPolicy({
            token: 'reconnect-test', serverHttpBaseUrl: 'https://policy-reconnect.example.com',
        })).toBe('disallowed');
    });

    it('declares only the account-storage contract on the machine-scoped socket', async () => {
        const { createMachineSocketTransport } = await import('./createMachineSocketTransport');

        createMachineSocketTransport({
            serverUrl: 'https://api.example.com',
            token: 'token',
            machineId: 'machine-1',
            env: {},
        });

        expect(ioMock).toHaveBeenLastCalledWith('https://api.example.com', expect.objectContaining({
            auth: expect.objectContaining({
                accountStoredContentCompatibility: CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
            }),
        }));
        expect((ioMock.mock.calls.at(-1)?.[1] as { auth?: Record<string, unknown> })?.auth)
            .not.toHaveProperty('clientCompatibility');
    });

    it('includes installation identity fields in machine-scoped socket auth when provided', async () => {
        const installationPublicKey = Buffer.from(
            tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32)).publicKey,
        ).toString('base64url');
        const installationProofSignature = Buffer.from(new Uint8Array(64)).toString('base64url');
        const { createMachineSocketTransport } = await import('./createMachineSocketTransport');

        createMachineSocketTransport({
            serverUrl: 'https://api.example.com',
            token: 'token',
            machineId: 'machine-1',
            installationId: 'installation-1',
            installationPublicKey,
            installationProof: {
                version: 1,
                algorithm: 'ed25519',
                signature: installationProofSignature,
            },
            env: {},
        });

        expect(ioMock).toHaveBeenCalledWith('https://api.example.com', expect.objectContaining({
            auth: expect.objectContaining({
                clientType: 'machine-scoped',
                machineId: 'machine-1',
                installationId: 'installation-1',
                installationPublicKey,
                installationProof: {
                    version: 1,
                    algorithm: 'ed25519',
                    signature: installationProofSignature,
                },
            }),
        }));
    });

});
