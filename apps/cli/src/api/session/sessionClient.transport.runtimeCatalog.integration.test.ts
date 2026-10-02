import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSession, createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { encodeBase64, encrypt } from '@/api/encryption';
import { buildSessionMetadataEnvelopeFields } from '@/session/metadata/buildSessionMetadataEnvelopeCreateFields';
import { createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { createSocketTransportAdapter } from '@happier-dev/sync-client';
import { createSessionScopedSocket, createSessionScopedSocketConnection } from './sockets';
import { ApiSessionClient } from './sessionClient';
import { publishServerHttpRuntimeOrigin, resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';

const { mockIo, readStoredCredentials } = vi.hoisted(() => ({
    mockIo: vi.fn(),
    readStoredCredentials: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io: mockIo }));
vi.mock('axios');
// Credential persistence is an OS boundary. A scoped client must never read it.
vi.mock('@/persistence', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/persistence')>(),
    readStoredCredentials,
}));

describe('ApiSessionClient injected transport', () => {
    let client: ApiSessionClient | undefined;
    beforeEach(() => {
        vi.mocked(axios.get).mockReset().mockResolvedValue({ status: 404, data: {} });
        readStoredCredentials.mockReset().mockResolvedValue(null);
        mockIo.mockReset().mockImplementation(() => createApiSessionSocketStub());
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    });
    afterEach(async () => {
        await client?.close();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reads an E2EE shared-editor follow snapshot without Account lookup or owner-state disclosure', async () => {
        const token = 'shared-runtime-token';
        const encryptionKey = new Uint8Array(32).fill(17);
        const sharedMetadata = { v: 1 as const, summary: { text: 'Recipient-safe summary', updatedAt: 1 },
            publicAgentState: { completedRequests: { done: { tool: 'Bash', createdAt: 1, completedAt: 2, status: 'approved' as const } } } };
        const privateTuple = buildSessionMetadataEnvelopeFields({
            credentials: { token, encryption: null }, accountEncryptionMode: 'plain',
            metadata: { path: '/private-owner-path', host: 'owner-host' },
            agentState: { requests: { secret: { tool: 'Bash', arguments: { command: 'private-owner-command' }, createdAt: 1 } } },
            storedContentMode: 'e2ee', encryptionKey, encryptionVariant: 'dataKey',
        });
        vi.mocked(axios.get).mockImplementation(async (url) => String(url).includes('/v2/sessions/')
            ? { status: 200, data: { session: createSessionRecordFixture({ id: 'shared-session', encryptionMode: 'e2ee',
                metadataLayoutVersion: 1, metadataVersion: 7, share: null,
                metadata: encodeBase64(encrypt(encryptionKey, 'dataKey', sharedMetadata)),
                ownerMetadata: privateTuple.ownerMetadata, agentState: privateTuple.agentState, agentStateVersion: 9,
            }) } }
            : { status: 404, data: {} });
        const getAccountEncryptionCurrentness = vi.fn(async () => {
            throw new Error('Shared editors must not read Account currentness');
        });
        client = new ApiSessionClient(token, createMockSession({ id: 'shared-session', encryptionMode: 'e2ee',
            encryptionKey, encryptionVariant: 'dataKey', metadataLayoutVersion: 1,
            metadata: { v: 1 }, metadataVersion: 1, agentState: null,
        }), {
            metadataAuthority: { kind: 'shared_editor' },
            getAccountEncryptionCurrentness,
            transport: {
                serverId: 'shared-editor-home',
                serverUrl: 'https://shared-home.example.test',
                createSessionSocketTransport: ({ sessionId, machineId }) => createSessionScopedSocketConnection({
                    token, sessionId, machineId, serverUrl: 'https://shared-home.example.test',
                }),
            },
        });

        const result = await client.readOpenedSessionStateSnapshot({ agentStateVersion: -1, sharedMetadataVersion: -1 });

        expect(result).toEqual({ agentState: null, sharedMetadata: { version: 7, value: sharedMetadata } });
        expect(JSON.stringify(result)).not.toContain('private-owner');
        expect(getAccountEncryptionCurrentness).not.toHaveBeenCalled();
        expect(readStoredCredentials).not.toHaveBeenCalled();
    });

    it('connects using the supplied exact Session socket without provisioning an AccessKey or opening Account updates', async () => {
        const token = 'scoped-runtime-token';
        const serverUrl = 'https://runner-home.example.test';
        const machineAdmissionTransport = vi.fn(async (request: Parameters<NonNullable<import('./sessionClient').ApiSessionClientOptions['machineAdmissionTransport']>>[0]) => ({
            status: 'accepted' as const, localId: request.localId,
        }));
        client = new ApiSessionClient(token, createMockSession({
            id: 'scoped-session', encryptionMode: 'plain', metadataLayoutVersion: 1,
            metadata: { v: 1 }, agentState: null,
        }), {
            metadataAuthority: { kind: 'shared_editor' },
            localMachineId: 'exact-machine',
            machineAdmissionTransport,
            transport: {
                serverId: 'runner-home',
                serverUrl,
                createSessionSocketTransport: ({ sessionId, machineId }) => {
                    const socket = createSessionScopedSocket({ token, sessionId, machineId, serverUrl });
                    return { socket, transport: createSocketTransportAdapter(socket) };
                },
            },
        });

        await vi.waitFor(() => expect(mockIo).toHaveBeenCalled());
        expect(client.getServerBinding()).toEqual({
            serverId: 'runner-home',
            serverUrl,
        });
        expect(client.getMachineAdmissionTransport()).toBe(machineAdmissionTransport);
        expect(mockIo.mock.calls).toHaveLength(1);
        expect(mockIo.mock.calls[0]).toEqual([
            serverUrl,
            expect.objectContaining({ auth: expect.objectContaining({
                token, sessionId: 'scoped-session', machineId: 'exact-machine', clientType: 'session-scoped',
            }) }),
        ]);
        expect(vi.mocked(axios.get).mock.calls.some(([url]) => String(url).includes('/access-keys/'))).toBe(false);
        expect(readStoredCredentials).not.toHaveBeenCalled();
    });

    it('delivers only exact destination Session invalidations to the installed Follow wake receiver', async () => {
        const token = 'scoped-runtime-token';
        const serverUrl = 'https://runner-home.example.test';
        const socket = createApiSessionSocketStub();
        const onSessionFollowInvalidated = vi.fn();
        const disposeSessionFollowWakeReceiver = vi.fn();
        const installSessionFollowWakeReceiver = vi.fn(() => disposeSessionFollowWakeReceiver);
        client = new ApiSessionClient(token, createMockSession({
            id: 'destination-session', encryptionMode: 'plain', metadataLayoutVersion: 1,
            metadata: { v: 1 }, agentState: null,
        }), {
            metadataAuthority: { kind: 'shared_editor' },
            localMachineId: 'exact-machine',
            onSessionFollowInvalidated,
            installSessionFollowWakeReceiver,
            transport: {
                serverId: 'runner-home',
                serverUrl,
                createSessionSocketTransport: () => ({
                    socket: socket as never,
                    transport: createSocketTransportAdapter(socket as never),
                }),
            },
        });

        await vi.waitFor(() => expect(socket.getHandler('session')).toBeTypeOf('function'));
        expect(installSessionFollowWakeReceiver).toHaveBeenCalledTimes(1);
        onSessionFollowInvalidated.mockClear();

        socket.trigger('session', {
            id: 'wake-exact',
            createdAt: 1,
            body: { t: 'session-changed', sessionId: 'destination-session' },
        });
        socket.trigger('session', {
            id: 'wake-wrong-session',
            createdAt: 2,
            body: { t: 'session-changed', sessionId: 'other-session' },
        });
        socket.trigger('session', {
            id: 'wake-malformed',
            createdAt: 3,
            body: { t: 'session-changed' },
        });

        expect(onSessionFollowInvalidated).toHaveBeenCalledTimes(1);
        await client.close();
        client = undefined;
        expect(disposeSessionFollowWakeReceiver).toHaveBeenCalledTimes(1);
    });

    it('keeps subsequent Session HTTP reads on the injected Home after the active process Home changes', async () => {
        const token = 'scoped-runtime-token';
        const serverUrl = 'https://runner-home.example.test';
        client = new ApiSessionClient(token, createMockSession({ id: 'scoped-session', encryptionMode: 'plain' }), {
            metadataAuthority: { kind: 'shared_editor' },
            transport: {
                serverId: 'runner-home',
                serverUrl,
                createSessionSocketTransport: ({ sessionId, machineId }) => {
                    const socket = createSessionScopedSocket({ token, sessionId, machineId, serverUrl });
                    return { socket, transport: createSocketTransportAdapter(socket) };
                },
            },
        });
        const release = publishServerHttpRuntimeOrigin('https://unrelated-home.example.test', 'https');
        try {
            await expect(client.readSessionTurnsProjection()).resolves.toBeNull();
            expect(axios.get).toHaveBeenCalledWith(
                `${serverUrl}/v1/sessions/scoped-session/turns`,
                expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${token}` }) }),
            );
        } finally {
            release();
        }
    });

    it('keeps the initial worker projection local and refreshes it only on the existing exact Session invalidation', async () => {
        const token = 'scoped-runtime-token';
        const serverUrl = 'https://runner-home.example.test';
        const socket = createApiSessionSocketStub({ connected: true });
        client = new ApiSessionClient(token, createMockSession({ id: 'worker-session', encryptionMode: 'plain',
            metadataLayoutVersion: 1, reportsTo: { sessionId: 'lead' }, origin: { kind: 'run_step' } }), {
            metadataAuthority: { kind: 'shared_editor' },
            transport: { serverId: 'runner-home', serverUrl,
                createSessionSocketTransport: () => ({ socket: socket as never, transport: createSocketTransportAdapter(socket as never) }),
            },
        });
        const row = { id: 'worker-session', seq: 0, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
            encryptionMode: 'plain',
            metadata: '{"v":1}', metadataVersion: 0, metadataLayoutVersion: 1,
            share: { accessLevel: 'edit', canApprovePermissions: false }, dataEncryptionKey: null,
            agentState: null, agentStateVersion: 0 };
        const release = publishServerHttpRuntimeOrigin('https://unrelated-home.example.test', 'https');
        try {
            await vi.waitFor(() => expect(socket.getHandler('session')).toBeTypeOf('function'));
            await expect(client.readRolePromptOrganization()).resolves.toEqual({ reportsTo: { sessionId: 'lead' }, origin: { kind: 'run_step' } });
            expect(vi.mocked(axios.get).mock.calls.some(([url]) => String(url).includes('/v2/sessions/worker-session'))).toBe(false);
            vi.mocked(axios.get).mockResolvedValueOnce({ status: 200, data: { session: row } });
            socket.trigger('session', { id: 'relation-detached', createdAt: 1, body: { t: 'session-changed', sessionId: 'worker-session' } });
            await expect(client.readRolePromptOrganization()).resolves.toEqual({});
            expect(axios.get).toHaveBeenCalledWith(`${serverUrl}/v2/sessions/worker-session`,
                expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${token}` }) }));
            expect(readStoredCredentials).not.toHaveBeenCalled();
        } finally {
            release();
        }
    });

    it('keeps Follow source reads on the exact Session Home and rejects another Home credential', () => {
        const token = 'destination-home-token';
        const serverUrl = 'https://destination-home.example.test';
        client = new ApiSessionClient(token, createMockSession({ id: 'destination', encryptionMode: 'plain' }), {
            metadataAuthority: { kind: 'shared_editor' },
            transport: {
                serverId: 'destination-home',
                serverUrl,
                createSessionSocketTransport: ({ sessionId, machineId }) => {
                    const socket = createSessionScopedSocket({ token, sessionId, machineId, serverUrl });
                    return { socket, transport: createSocketTransportAdapter(socket) };
                },
            },
        });
        const release = publishServerHttpRuntimeOrigin('https://ambient-home.example.test', 'https');
        const wrongHomeRequest = vi.fn(() => resolveServerHttpBaseUrl());
        try {
            expect(client.runSessionFollowSourceRequest({
                credentials: { token },
                request: () => resolveServerHttpBaseUrl(),
            })).toBe(serverUrl);
            expect(() => client!.runSessionFollowSourceRequest({
                credentials: { token: 'another-home-token' },
                request: wrongHomeRequest,
            })).toThrow('do not belong to the destination Session Home');
            expect(wrongHomeRequest).not.toHaveBeenCalled();
        } finally {
            release();
        }
    });
});
