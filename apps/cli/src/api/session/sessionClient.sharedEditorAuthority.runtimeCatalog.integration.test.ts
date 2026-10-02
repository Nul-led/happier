import { createTestApiSessionClient } from '@/testkit/backends/createTestApiSessionClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSession, createPlainSessionFixture, createAccountEncryptionCurrentnessFixture } from '@/testkit/backends/sessionFixtures';
import { createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { AgentStateRequestStore } from '@/agent/permissions/agentStateRequestStore';
import { decodeBase64, decrypt, encodeBase64, encrypt } from '../encryption';

const {
    mockIo,
    readStoredCredentialsMock,
    fetchSessionByIdCompatMock,
    patchSessionMetadataEnvelopeTupleMock,
} = vi.hoisted(() => ({
    mockIo: vi.fn(),
    readStoredCredentialsMock: vi.fn(),
    fetchSessionByIdCompatMock: vi.fn(),
    patchSessionMetadataEnvelopeTupleMock: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io: mockIo }));
vi.mock('@/api/connection/createLoopbackReadinessProbe', () => ({
    createLoopbackReadinessProbe: () => async () => ({ status: 'ready' as const }),
}));
vi.mock('@/persistence', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/persistence')>()),
    readStoredCredentials: readStoredCredentialsMock,
}));
vi.mock('@/session/transport/http/sessionsHttp', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/session/transport/http/sessionsHttp')>()),
    fetchSessionByIdCompat: fetchSessionByIdCompatMock,
    patchSessionMetadataEnvelopeTuple: patchSessionMetadataEnvelopeTupleMock,
}));

import { ApiSessionClient } from './sessionClient';
import { logger } from '@/ui/logger';

const SESSION_KEY = new Uint8Array(32).fill(9);

function sharedMetadataCiphertext(summaryText: string): string {
    return encodeBase64(encrypt(SESSION_KEY, 'legacy', {
        v: 1,
        summary: { text: summaryText, updatedAt: 1 },
    }));
}

function createLayout1Session() {
    return createMockSession({
        id: 'sess-runner',
        encryptionMode: 'e2ee',
        encryptionKey: SESSION_KEY,
        encryptionVariant: 'legacy',
        metadataLayoutVersion: 1,
        metadata: { v: 1, summary: { text: 'Before', updatedAt: 1 } },
        metadataVersion: 4,
        agentState: null,
        agentStateVersion: 2,
    });
}

describe('ApiSessionClient shared-editor metadata authority', () => {
    const clients = new Set<ApiSessionClient>();

    beforeEach(() => {
        mockIo.mockReset();
        readStoredCredentialsMock.mockReset();
        fetchSessionByIdCompatMock.mockReset();
        patchSessionMetadataEnvelopeTupleMock.mockReset();
        // An unrelated Account signed in on the endpoint machine must never be
        // discovered by a restricted runtime composition.
        readStoredCredentialsMock.mockResolvedValue({
            token: 'unrelated-account-token',
            encryption: { type: 'legacy', secret: new Uint8Array(32).fill(2) },
        });
        mockIo.mockImplementation(() => createApiSessionSocketStub({ connected: true }));
    });

    afterEach(async () => {
        await Promise.allSettled([...clients].map((client) => client.close()));
        clients.clear();
        vi.restoreAllMocks();
    });

    function createSharedEditorClient() {
        const client = createTestApiSessionClient(ApiSessionClient, 'runtime-token', createLayout1Session(), {
            metadataAuthority: { kind: 'shared_editor' },
            getAccountEncryptionCurrentness: async () => {
                throw new Error('shared editors must not read Account encryption currentness');
            },
        });
        clients.add(client);
        return client;
    }

    it('retires recovered Action confirmations at owner Session startup without a new Action', async () => {
        const debug = vi.spyOn(logger, 'debug');
        const session = createPlainSessionFixture({
            id: 'session-recovered-action',
            agentState: { requests: {
                action: { tool: 'Happier Action confirmation', arguments: {}, createdAt: 1, source: 'happier_action' },
                native: { tool: 'Bash', arguments: {}, createdAt: 1, source: 'native_tool' },
            }, completedRequests: {} },
        });
        const persistedState = JSON.stringify(session.agentState);
        const persistedVersion = session.agentStateVersion;
        fetchSessionByIdCompatMock.mockImplementation(async () => ({
            ...session, metadataLayoutVersion: 0, metadata: JSON.stringify(session.metadata),
            ownerMetadata: null, agentState: persistedState, agentStateVersion: persistedVersion,
            dataEncryptionKey: null,
        }));
        // Owner writes upgrade the legacy tuple through the HTTP tuple boundary.
        // The real tuple owner applies the successful response to the client.
        patchSessionMetadataEnvelopeTupleMock.mockResolvedValue({
            success: true, metadataLayoutVersion: 1,
            sharedMetadata: { version: 1 }, agentState: { version: 1 },
        });
        const client = createTestApiSessionClient(ApiSessionClient, 'owner-token', session, {
            metadataAuthority: { kind: 'owner', credentials: { token: 'owner-token', encryption: null } },
            getAccountEncryptionCurrentness: async () => createAccountEncryptionCurrentnessFixture(),
        });
        clients.add(client);
        await vi.waitFor(() => expect({
            actionStatus: client.getAgentStateSnapshot()?.completedRequests?.action?.status,
            errors: debug.mock.calls.filter(([message]) => String(message).includes('Failed to retire recovered')),
        }).toMatchObject({ actionStatus: 'canceled', errors: [] }));
        expect(client.getAgentStateSnapshot()?.requests?.action).toBeUndefined();
        expect(client.getAgentStateSnapshot()?.requests?.native).toBeDefined();
    });

    it('writes shared metadata through the shared-editor tuple with the supplied runtime token', async () => {
        fetchSessionByIdCompatMock.mockResolvedValue({
            metadataLayoutVersion: 1,
            metadata: sharedMetadataCiphertext('Before'),
            metadataVersion: 4,
            agentState: null,
            agentStateVersion: 2,
            encryptionMode: 'e2ee',
            dataEncryptionKey: null,
        });
        patchSessionMetadataEnvelopeTupleMock.mockResolvedValue({
            success: true,
            metadataLayoutVersion: 1,
            sharedMetadata: { version: 5 },
        });
        const client = createSharedEditorClient();

        await client.updateMetadata((metadata) => ({
            ...metadata,
            summary: { text: 'After', updatedAt: 2 },
        }) as never);

        expect(patchSessionMetadataEnvelopeTupleMock).toHaveBeenCalledTimes(1);
        const [request] = patchSessionMetadataEnvelopeTupleMock.mock.calls[0];
        expect(request.token).toBe('runtime-token');
        expect(request.patch).toMatchObject({
            mode: 'shared_editor',
            metadataLayoutVersion: 1,
            sharedMetadata: { expectedVersion: 4 },
        });
        expect(request.patch.ownerMetadata).toBeUndefined();
        expect(request.patch.agentState).toBeUndefined();
        expect(client.getMetadataSnapshot()).toMatchObject({
            summary: { text: 'After', updatedAt: 2 },
        });
        expect(readStoredCredentialsMock).not.toHaveBeenCalled();
    });

    it('refuses an owner-only field without reaching the server', async () => {
        fetchSessionByIdCompatMock.mockResolvedValue({
            metadataLayoutVersion: 1,
            metadata: sharedMetadataCiphertext('Before'),
            metadataVersion: 4,
            agentState: null,
            agentStateVersion: 2,
            encryptionMode: 'e2ee',
            dataEncryptionKey: null,
        });
        const client = createSharedEditorClient();

        await expect(client.updateMetadata((metadata) => ({
            ...metadata,
            path: '/owner/only',
        }) as never)).rejects.toMatchObject({
            code: 'metadata_privacy_upgrade_required',
        });
        expect(patchSessionMetadataEnvelopeTupleMock).not.toHaveBeenCalled();
    });

    it('fails owner-only operations before any effect', async () => {
        const client = createSharedEditorClient();

        await expect(client.updateAgentState((state) => ({ ...state, thinking: true } as never)))
            .rejects.toMatchObject({ code: 'session_owner_authority_required' });
        await expect(client.updateMetadataAsCurrentPublisher((metadata) => metadata))
            .rejects.toMatchObject({ code: 'session_owner_authority_required' });

        expect(fetchSessionByIdCompatMock).not.toHaveBeenCalled();
        expect(patchSessionMetadataEnvelopeTupleMock).not.toHaveBeenCalled();
        expect(readStoredCredentialsMock).not.toHaveBeenCalled();
    });

    it('refreshes the Session snapshot from the shared projection only', async () => {
        fetchSessionByIdCompatMock.mockResolvedValue({
            metadataLayoutVersion: 1,
            metadata: sharedMetadataCiphertext('Server side'),
            metadataVersion: 9,
            ownerMetadata: { t: 'plain', v: { v: 1, workspace: { path: '/owner/only' } } },
            agentState: null,
            agentStateVersion: 2,
            encryptionMode: 'e2ee',
            dataEncryptionKey: null,
        });
        const client = createSharedEditorClient();

        await expect((client as never as {
            syncSessionSnapshotFromServer: (opts: { reason: string }) => Promise<boolean>;
        }).syncSessionSnapshotFromServer({ reason: 'waitForMetadataUpdate' })).resolves.toBe(true);

        expect(client.getMetadataSnapshot()).toMatchObject({
            summary: { text: 'Server side', updatedAt: 1 },
        });
        expect((client.getMetadataSnapshot() as Record<string, unknown>).path).toBeUndefined();
        expect(readStoredCredentialsMock).not.toHaveBeenCalled();
    });

    it('never opens the Account-wide user-scoped socket', () => {
        createSharedEditorClient();

        const clientTypes = mockIo.mock.calls.map(
            ([, options]) => (options as { auth?: { clientType?: string } } | undefined)?.auth?.clientType,
        );
        expect(clientTypes).not.toContain('user-scoped');
    });

    it('publishes restricted Action confirmation only in Session-DEK shared metadata', async () => {
        fetchSessionByIdCompatMock.mockResolvedValue({
            metadataLayoutVersion: 1,
            metadata: sharedMetadataCiphertext('Before'),
            metadataVersion: 4,
            agentState: null,
            agentStateVersion: 2,
            encryptionMode: 'e2ee',
            dataEncryptionKey: null,
        });
        patchSessionMetadataEnvelopeTupleMock.mockResolvedValue({
            success: true,
            metadataLayoutVersion: 1,
            sharedMetadata: { version: 5 },
        });
        const client = createTestApiSessionClient(ApiSessionClient, 'runtime-token', createLayout1Session(), {
            metadataAuthority: { kind: 'shared_editor' },
            runtimePrincipalAccountId: 'account-runner',
        });
        clients.add(client);
        const store = new AgentStateRequestStore({ session: client, logPrefix: '[runner-confirmation-test]' });
        client.bindAgentStateRequestStore(store);
        const lifetime = new AbortController();

        const confirmation = client.confirmSessionAction({
            actionId: 'session.activity.get',
            input: { sessionId: 'sess-runner' },
            preview: { sessionId: 'sess-runner' },
            context: {
                surface: 'agent',
                authority: 'account_automation',
                defaultSessionId: 'sess-runner',
                sessionInputSource: {
                    sourceSessionId: 'sess-runner',
                    sourceTurnId: 'turn-1',
                    via: 'action',
                },
            },
            sessionId: 'sess-runner',
        }, {
            turnId: 'turn-1',
            lifetimeSignal: lifetime.signal,
            isCurrent: () => true,
        });
        await vi.waitFor(() => expect(patchSessionMetadataEnvelopeTupleMock).toHaveBeenCalled());
        const [request] = patchSessionMetadataEnvelopeTupleMock.mock.calls[0];
        expect(request.patch).toMatchObject({
            mode: 'shared_editor',
            metadataLayoutVersion: 1,
        });
        expect(request.patch.agentState).toBeUndefined();
        expect(request.patch.sharedMetadata.ciphertext).toEqual(expect.any(String));
        expect(decrypt(
            SESSION_KEY,
            'legacy',
            decodeBase64(request.patch.sharedMetadata.ciphertext),
        )).toMatchObject({
            actionConfirmationsV1: {
                requests: expect.objectContaining({}),
            },
        });
        const actionState = (client.getMetadataSnapshot() as Record<string, unknown>)
            .actionConfirmationsV1 as { requests: Record<string, { turnId: string }> };
        const requestId = Object.keys(actionState.requests)[0];
        if (!requestId) throw new Error('Expected one Action confirmation request');
        await expect(client.respondToSessionActionConfirmation({
            id: requestId,
            turnId: 'turn-other',
            approved: true,
            decision: 'approved',
        }, {
            kind: 'accountUser',
            accountId: 'authorized-approver',
            relationship: 'sharedApprover',
        })).resolves.toBe('invalid');
        await expect(client.respondToSessionActionConfirmation({
            id: requestId,
            turnId: 'turn-1',
            approved: true,
            decision: 'approved',
        }, {
            kind: 'accountUser',
            accountId: 'authorized-approver',
            relationship: 'sharedApprover',
        })).resolves.toBe('resolved');
        await expect(confirmation).resolves.toMatchObject({ decision: 'approve' });
        const completed = ((client.getMetadataSnapshot() as Record<string, unknown>)
            .actionConfirmationsV1 as { completedRequests: Record<string, Record<string, unknown>> })
            .completedRequests[requestId];
        expect(completed).toMatchObject({
            status: 'approved',
            permissionDecisionActorV1: {
                accountId: 'authorized-approver',
                relationship: 'sharedApprover',
            },
        });
        expect(readStoredCredentialsMock).not.toHaveBeenCalled();
    });

    it('still opens the Account-wide user-scoped socket under owner authority', () => {
        const client = createTestApiSessionClient(ApiSessionClient, 'owner-token', createLayout1Session(), {
            metadataAuthority: {
                kind: 'owner',
                credentials: { token: 'owner-token', encryption: null },
            },
        });
        clients.add(client);

        const clientTypes = mockIo.mock.calls.map(
            ([, options]) => (options as { auth?: { clientType?: string } } | undefined)?.auth?.clientType,
        );
        expect(clientTypes).toContain('user-scoped');
    });
});
