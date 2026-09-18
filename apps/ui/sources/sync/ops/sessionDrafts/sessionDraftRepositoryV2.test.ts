import { describe, expect, it, vi } from 'vitest';
import {
    canonicalSessionDraftAddressV2,
    type SessionDraftAddressV2,
    type SessionDraftDocumentV2,
    type SessionDraftStoredContentEnvelopeV2,
} from '@happier-dev/protocol';

import {
    createSessionDraftRepository,
    type SessionDraftRepositoryCipher,
    type SessionDraftRepositoryTransport,
} from './sessionDraftRepository';
import { createDeferred } from '@/dev/testkit';
import { createSessionDraftCipher } from '@/sync/encryption/sessionDraftEncryption';
import { SessionDraftEpochUnavailableError } from './sessionDraftEpochError';

const scope = { serverId: 'server-a', accountId: 'account-a' } as const;
const runAddress = { kind: 'run', sessionId: 'session-a', runId: 'run-a' } as const;
const discussionAddress = { kind: 'discussion', sessionId: 'session-a', discussionId: 'disc-a' } as const;
const newDiscussionAddress = { kind: 'newDiscussion', sessionId: 'session-a' } as const;

function createMemoryStorage() {
    const values = new Map<string, string>();
    return {
        values,
        getString: (key: string) => values.get(key),
        set: (key: string, value: string) => values.set(key, value),
        delete: (key: string) => values.delete(key),
    };
}

function plainCipher(): SessionDraftRepositoryCipher {
    return {
        seal: vi.fn(async (address: SessionDraftAddressV2, document: SessionDraftDocumentV2) => ({
            t: 'plain' as const,
            v: { v: document.v === 2 ? 2 as const : 1 as const, address, document },
        }) as SessionDraftStoredContentEnvelopeV2),
        open: vi.fn(async (address: SessionDraftAddressV2, content: SessionDraftStoredContentEnvelopeV2) => {
            if (content.t !== 'plain') return null;
            if (canonicalSessionDraftAddressV2(content.v.address) !== canonicalSessionDraftAddressV2(address)) return null;
            return content.v.document;
        }),
    };
}

function createRemote(address: SessionDraftAddressV2) {
    let current: { revision: number; content: SessionDraftStoredContentEnvelopeV2 | null; createdAt: number; updatedAt: number } | null = null;
    const transport: SessionDraftRepositoryTransport = {
        read: vi.fn(async () => (current === null
            ? { status: 'absent' as const }
            : current.content === null
                ? { status: 'deleted' as const, record: { ...current, address } }
                : { status: 'present' as const, record: { ...current, address } })),
        list: vi.fn(async () => ({ items: [], nextAfter: undefined })),
        mutate: vi.fn(async ({ expectedRevision, content }) => {
            const currentRevision = current?.revision ?? 'absent';
            if (currentRevision !== expectedRevision) {
                return {
                    status: 'conflict' as const,
                    current: current ? { address, ...current } : { status: 'absent' as const },
                };
            }
            const now = 100 + (current?.revision ?? 0);
            current = {
                revision: current ? current.revision + 1 : 0,
                content,
                createdAt: current?.createdAt ?? now,
                updatedAt: now,
            };
            return { status: 'updated' as const, record: { address, ...current } };
        }),
    };
    return { transport, readCurrent: () => current, replaceCurrent: (next: NonNullable<typeof current>) => { current = next; } };
}

describe('session draft repository V2 addresses', () => {
    it('materializes an inactive exact Home through an operation-scoped runtime without reading the configured active Home', async () => {
        const address = { kind: 'session', sessionId: 'shared-session-id' } as const;
        const scopeB = { serverId: 'server-b', accountId: 'account-b' } as const;
        const remoteA = createRemote(address);
        const remoteB = createRemote(address);
        const cipher = plainCipher();
        const writerB = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope: scopeB,
            transport: remoteB.transport,
            cipher,
            syncEnabled: true,
        });
        writerB.writeExistingSessionDraft({
            scope: scopeB,
            sessionId: address.sessionId,
            patch: { text: 'Home B draft' },
        });
        await writerB.flushSessionDraft({ scope: scopeB, address });

        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: remoteA.transport,
            cipher,
            syncEnabled: true,
        });
        await repository.materializeExactWithScopedRuntime({
            scope: scopeB,
            address,
            runtime: { transport: remoteB.transport, cipher },
            isCurrent: () => true,
        });

        expect(repository.getSessionDraftSnapshot(scopeB, address)?.document.composer.text.value)
            .toBe('Home B draft');
        expect(remoteB.transport.read).toHaveBeenCalledOnce();
        expect(remoteA.transport.read).not.toHaveBeenCalled();
    });

    it('hydrates an inactive Home remote-only draft collection without using the configured active Home runtime', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000901' } as const;
        const inactiveScope = { serverId: 'server-b', accountId: 'account-b' } as const;
        const activeRemote = createRemote(address);
        const inactiveRemote = createRemote(address);
        const cipher = plainCipher();
        const writer = createSessionDraftRepository({
            storage: createMemoryStorage(), scope: inactiveScope, transport: inactiveRemote.transport, cipher, syncEnabled: true,
        });
        writer.writeNewSessionDraft({
            scope: inactiveScope,
            draftId: address.draftId,
            patch: { text: 'waiting on inactive Home' },
            materializationIntent: 'userEdit',
        });
        await writer.flushSessionDraft({ scope: inactiveScope, address });
        const record = inactiveRemote.readCurrent();
        expect(record).not.toBeNull();
        vi.mocked(inactiveRemote.transport.list)
            .mockResolvedValueOnce({ items: [], nextAfter: 'second-page' })
            .mockResolvedValueOnce({ items: [{ address, ...record! }], nextAfter: undefined });
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(), scope, transport: activeRemote.transport, cipher, syncEnabled: true,
        });

        await repository.ensureSessionDraftRepositoryHydratedWithScopedRuntime({
            scope: inactiveScope,
            runtime: { transport: inactiveRemote.transport, cipher },
            isCurrent: () => true,
        });

        expect(repository.listNewSessionDraftProjections(inactiveScope)).toMatchObject([{
            draftId: address.draftId,
            document: { composer: { text: { value: 'waiting on inactive Home' } } },
        }]);
        expect(activeRemote.transport.list).not.toHaveBeenCalled();
        expect(activeRemote.transport.read).not.toHaveBeenCalled();
        expect(inactiveRemote.transport.list).toHaveBeenNthCalledWith(2, { after: 'second-page', limit: 100 });
    });

    it('publishes nothing when an inactive Home scoped hydration retires during the list response', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000902' } as const;
        const inactiveScope = { serverId: 'server-b', accountId: 'account-b' } as const;
        const cipher = plainCipher();
        const response = createDeferred<Awaited<ReturnType<SessionDraftRepositoryTransport['list']>>>();
        const transport: SessionDraftRepositoryTransport = {
            list: vi.fn(async () => response.promise),
            read: vi.fn(async () => ({ status: 'absent' as const })),
            mutate: vi.fn(async () => { throw new Error('not expected'); }),
        };
        const repository = createSessionDraftRepository({ storage: createMemoryStorage(), cipher, syncEnabled: false });
        const listener = vi.fn();
        repository.subscribeSessionDraftList(inactiveScope, listener);
        let current = true;
        const hydration = repository.ensureSessionDraftRepositoryHydratedWithScopedRuntime({
            scope: inactiveScope,
            runtime: { transport, cipher },
            isCurrent: () => current,
        });
        await vi.waitFor(() => expect(transport.list).toHaveBeenCalledOnce());
        current = false;
        response.resolve({
            items: [{
                address,
                revision: 1,
                content: await cipher.seal(address, {
                    v: 1,
                    target: { kind: 'newSession', authoring: {} },
                    composer: {
                        text: { mutationId: 'text', value: 'retired credentials' },
                        mentions: { mutationId: 'mentions', value: [] },
                        attachments: { mutationId: 'attachments', value: [] },
                    },
                    extensions: {},
                }),
                createdAt: 1,
                updatedAt: 1,
            }],
            nextAfter: undefined,
        });
        await hydration;

        expect(repository.listNewSessionDraftProjections(inactiveScope)).toEqual([]);
        expect(listener).not.toHaveBeenCalled();
        expect(transport.read).not.toHaveBeenCalled();
    });

    it('deletes only the exact inactive scoped draft without using or mutating the active Home runtime', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000903' } as const;
        const inactiveScope = { serverId: 'server-b', accountId: 'account-b' } as const;
        const activeRemote = createRemote(address);
        const inactiveRemote = createRemote(address);
        const cipher = plainCipher();
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(), scope, transport: activeRemote.transport, cipher, syncEnabled: true,
        });
        repository.writeNewSessionDraft({ scope, draftId: address.draftId, patch: { text: 'active Home' }, materializationIntent: 'userEdit' });
        await repository.flushSessionDraft({ scope, address });
        const inactiveWriter = createSessionDraftRepository({
            storage: createMemoryStorage(), scope: inactiveScope, transport: inactiveRemote.transport, cipher, syncEnabled: true,
        });
        inactiveWriter.writeNewSessionDraft({
            scope: inactiveScope,
            draftId: address.draftId,
            patch: { text: 'inactive Home' },
            materializationIntent: 'userEdit',
        });
        await inactiveWriter.flushSessionDraft({ scope: inactiveScope, address });
        await repository.materializeExactWithScopedRuntime({
            scope: inactiveScope,
            address,
            runtime: { transport: inactiveRemote.transport, cipher },
            isCurrent: () => true,
        });
        vi.mocked(activeRemote.transport.mutate).mockClear();

        await expect(repository.deleteSessionDraftWithScopedRuntime({
            scope: inactiveScope,
            address,
            runtime: { transport: inactiveRemote.transport, cipher },
            isCurrent: () => true,
        })).resolves.toBe(true);

        expect(repository.getSessionDraftSnapshot(inactiveScope, address)).toBeNull();
        expect(repository.getSessionDraftSnapshot(scope, address)?.document.composer.text.value).toBe('active Home');
        expect(inactiveRemote.readCurrent()?.content).toBeNull();
        expect(activeRemote.transport.mutate).not.toHaveBeenCalled();
    });

    it('keeps the exact scoped row when delete retires during a late response', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000904' } as const;
        const inactiveScope = { serverId: 'server-b', accountId: 'account-b' } as const;
        const remote = createRemote(address);
        const cipher = plainCipher();
        const repository = createSessionDraftRepository({ storage: createMemoryStorage(), cipher, syncEnabled: false });
        repository.writeNewSessionDraft({
            scope: inactiveScope,
            draftId: address.draftId,
            patch: { text: 'recoverable waiting draft' },
            materializationIntent: 'userEdit',
        });
        const currentness = repository.captureSessionDraftCurrentness({ scope: inactiveScope, address });
        expect(currentness).not.toBeNull();
        const sealed = await cipher.seal(address, repository.getSessionDraftSnapshot(inactiveScope, address)!.document);
        remote.replaceCurrent({ revision: 1, content: sealed, createdAt: 1, updatedAt: 1 });
        await repository.materializeExactWithScopedRuntime({
            scope: inactiveScope, address, runtime: { transport: remote.transport, cipher }, isCurrent: () => true,
        });
        const release = createDeferred<void>();
        const mutate = remote.transport.mutate;
        const transport: SessionDraftRepositoryTransport = {
            ...remote.transport,
            mutate: vi.fn(async (request, compatibility) => {
                await release.promise;
                return mutate(request, compatibility);
            }),
        };
        let current = true;
        const deletion = repository.deleteSessionDraftWithScopedRuntime({
            scope: inactiveScope,
            address,
            runtime: { transport, cipher },
            isCurrent: () => current,
        });
        await vi.waitFor(() => expect(transport.mutate).toHaveBeenCalledOnce());
        current = false;
        release.resolve();

        await expect(deletion).resolves.toBe(false);
        expect(repository.getSessionDraftSnapshot(inactiveScope, address)?.document.composer.text.value)
            .toBe('recoverable waiting draft');
    });

    it('preserves a recoverable scoped row with truthful status when delete transport fails', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000905' } as const;
        const inactiveScope = { serverId: 'server-b', accountId: 'account-b' } as const;
        const cipher = plainCipher();
        const repository = createSessionDraftRepository({ storage: createMemoryStorage(), cipher, syncEnabled: false });
        repository.writeNewSessionDraft({
            scope: inactiveScope,
            draftId: address.draftId,
            patch: { text: 'retry cancellation later' },
            materializationIntent: 'userEdit',
        });
        const transport: SessionDraftRepositoryTransport = {
            list: vi.fn(async () => ({ items: [], nextAfter: undefined })),
            read: vi.fn(async () => ({ status: 'absent' as const })),
            mutate: vi.fn(async () => { throw new Error('offline'); }),
        };

        await expect(repository.deleteSessionDraftWithScopedRuntime({
            scope: inactiveScope,
            address,
            runtime: { transport, cipher },
            isCurrent: () => true,
        })).rejects.toThrow('offline');

        expect(repository.getSessionDraftSnapshot(inactiveScope, address)).toMatchObject({
            status: 'offline',
            document: { composer: { text: { value: 'retry cancellation later' } } },
        });
    });

    it('retains and rematerializes the exact scoped row when its delete revision conflicts', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000906' } as const;
        const inactiveScope = { serverId: 'server-b', accountId: 'account-b' } as const;
        const remote = createRemote(address);
        const cipher = plainCipher();
        const remoteDocument: SessionDraftDocumentV2 = {
            v: 1,
            target: { kind: 'newSession', authoring: {} },
            composer: {
                text: { mutationId: 'text', value: 'newer remote waiting draft' },
                mentions: { mutationId: 'mentions', value: [] },
                attachments: { mutationId: 'attachments', value: [] },
            },
            extensions: {},
        };
        remote.replaceCurrent({
            revision: 2,
            content: await cipher.seal(address, remoteDocument),
            createdAt: 1,
            updatedAt: 2,
        });
        const repository = createSessionDraftRepository({ storage: createMemoryStorage(), cipher, syncEnabled: false });
        await repository.materializeExactWithScopedRuntime({
            scope: inactiveScope, address, runtime: { transport: remote.transport, cipher }, isCurrent: () => true,
        });
        const transport: SessionDraftRepositoryTransport = {
            ...remote.transport,
            mutate: vi.fn(async () => ({
                status: 'conflict' as const,
                current: { address, ...remote.readCurrent()! },
            })),
        };

        await expect(repository.deleteSessionDraftWithScopedRuntime({
            scope: inactiveScope,
            address,
            runtime: { transport, cipher },
            isCurrent: () => true,
        })).resolves.toBe(false);

        expect(repository.getSessionDraftSnapshot(inactiveScope, address)).toMatchObject({
            status: 'clean',
            document: { composer: { text: { value: 'newer remote waiting draft' } } },
        });
        expect(transport.read).toHaveBeenCalledWith(address);
    });

    it('carries a lossless predecessor mutation beside the canonical V2 newSession write', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000010' } as const;
        const remote = createRemote(address);
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: remote.transport,
            cipher: createSessionDraftCipher({
                accountMode: 'plain', accountCryptoMaterial: null, getSessionContext: () => null,
                randomBytes: (length) => new Uint8Array(length),
            }),
            syncEnabled: true,
        });
        const target = {
            kind: 'machine' as const,
            target: { serverId: scope.serverId, machineId: 'machine-a' },
            selectionOrigin: { kind: 'machine_pool' as const, poolId: '11111111-1111-4111-8111-111111111111' },
        };
        repository.writeNewSessionDraft({
            scope,
            draftId: address.draftId,
            materializationIntent: 'userEdit',
            patch: { text: 'run here', authoring: { executionTarget: target, runtimeDescriptorV1: null } },
        });

        expect(await repository.flushSessionDraft({ scope, address })).toEqual({ status: 'clean' });
        const compatibility = vi.mocked(remote.transport.mutate).mock.calls[0]?.[1];
        expect(compatibility?.supportedPredecessorV1Content).toMatchObject({
            t: 'plain',
            v: {
                v: 1,
                address,
                document: {
                    v: 1,
                    target: { kind: 'newSession', authoring: { executionTarget: { value: target } } },
                },
            },
        });
    });

    it('keeps a Temporary computer draft visible and preserves independent cross-device edits through the real cipher', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000010' } as const;
        const remote = createRemote(address);
        const cipher = createSessionDraftCipher({
            accountMode: 'plain', accountCryptoMaterial: null, getSessionContext: () => null,
            randomBytes: (length) => new Uint8Array(length),
        });
        const create = () => createSessionDraftRepository({
            storage: createMemoryStorage(), scope, transport: remote.transport, cipher, syncEnabled: true,
        });
        const first = create();
        const target = { kind: 'temporary_computer', serverId: scope.serverId, artifactTarget: 'linux-x64', workspace: { kind: 'choose_on_endpoint' } } as const;
        const activationRef = { v: 1, activationId: '00000000-0000-4000-8000-000000000020', createdOnDeviceLabel: 'My laptop' } as const;
        first.writeNewSessionDraft({ scope, draftId: address.draftId, materializationIntent: 'userEdit', patch: {
            text: 'original', authoring: { executionTarget: target, temporaryComputerActivationRef: activationRef },
        } });
        expect(await first.flushSessionDraft({ scope, address })).toEqual({ status: 'clean' });
        expect(first.listNewSessionDraftProjections(scope)).toHaveLength(1);
        const second = create();
        await second.materializeExact(scope, address);
        const captured = first.captureSessionDraftCurrentness({ scope, address });
        second.writeNewSessionDraft({ scope, draftId: address.draftId, materializationIntent: 'userEdit', patch: {
            authoring: { temporaryComputerActivationRef: { ...activationRef, createdOnDeviceLabel: 'Renamed laptop' } },
        } });
        await second.flushSessionDraft({ scope, address });
        first.writeNewSessionDraft({ scope, draftId: address.draftId, materializationIntent: 'userEdit', patch: { text: 'newer local prompt' } });
        expect(await first.flushSessionDraft({ scope, address })).toEqual({ status: 'clean' });
        expect(first.getSessionDraftSnapshot(scope, address)?.document).toMatchObject({
            v: 2,
            composer: { text: { value: 'newer local prompt' } },
            target: { kind: 'newSession', authoring: {
                executionTarget: { value: target },
                temporaryComputerActivationRef: { value: { ...activationRef, createdOnDeviceLabel: 'Renamed laptop' } },
            } },
        });
        await first.clearSessionDraftCurrentness({ scope, address, currentness: captured });
        expect(first.getSessionDraftSnapshot(scope, address)?.document).toMatchObject({
            composer: { text: { value: 'newer local prompt' } },
            target: { authoring: { temporaryComputerActivationRef: { value: { createdOnDeviceLabel: 'Renamed laptop' } } } },
        });
    });

    it('returns the canonical unavailable result and retains successor fields when the peer cannot sync them', async () => {
        const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-000000000010' } as const;
        const remote = createRemote(address);
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(), scope,
            transport: { ...remote.transport, mutate: async () => { throw new SessionDraftEpochUnavailableError(); } },
            cipher: createSessionDraftCipher({
                accountMode: 'plain', accountCryptoMaterial: null, getSessionContext: () => null,
                randomBytes: (length) => new Uint8Array(length),
            }),
            syncEnabled: true,
        });
        const target = { kind: 'temporary_computer', serverId: scope.serverId, artifactTarget: 'linux-x64', workspace: { kind: 'endpoint_home' } } as const;
        repository.writeNewSessionDraft({ scope, draftId: address.draftId, materializationIntent: 'userEdit', patch: {
            text: 'retain on this device', authoring: { executionTarget: target },
        } });
        expect(await repository.flushSessionDraft({ scope, address })).toEqual({ status: 'error', code: 'session_draft_epoch_unavailable' });
        expect(repository.getSessionDraftSnapshot(scope, address)?.document).toMatchObject({
            composer: { text: { value: 'retain on this device' } }, target: { authoring: { executionTarget: { value: target } } },
        });
        expect(remote.readCurrent()).toBeNull();
    });

    it('synchronizes a Run draft through the same repository, cipher and CAS transport', async () => {
        const remote = createRemote(runAddress);
        const cipher = plainCipher();
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: remote.transport,
            cipher,
            syncEnabled: true,
        });
        repository.writeExistingSessionDraft({
            scope,
            sessionId: runAddress.sessionId,
            runId: runAddress.runId,
            patch: { text: 'ask the run' },
        });
        expect(await repository.flushSessionDraft({ scope, address: runAddress })).toEqual({ status: 'clean' });

        const stored = remote.readCurrent();
        expect(stored?.revision).toBe(0);
        expect(stored?.content?.t).toBe('plain');
        expect(cipher.seal).toHaveBeenCalledWith(runAddress, expect.objectContaining({ v: 1 }));
        const snapshot = repository.getSessionDraftSnapshot(scope, runAddress);
        expect(snapshot?.document.composer.text.value).toBe('ask the run');
        expect(snapshot?.document.target).toMatchObject({
            kind: 'session',
            routing: {
                recipient: {
                    value: { mode: 'manual', recipient: { kind: 'execution_run', runId: runAddress.runId } },
                },
            },
        });
    });

    it('keeps human discussion drafts on the human document with a new-discussion title', async () => {
        const remote = createRemote(newDiscussionAddress);
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: remote.transport,
            cipher: plainCipher(),
            syncEnabled: true,
        });
        repository.writeDiscussionSessionDraft({
            scope,
            address: newDiscussionAddress,
            patch: { text: 'about the release', title: 'Release plan' },
        });
        expect(await repository.flushSessionDraft({ scope, address: newDiscussionAddress })).toEqual({ status: 'clean' });
        const snapshot = repository.getSessionDraftSnapshot(scope, newDiscussionAddress);
        expect(snapshot?.document).toMatchObject({
            v: 2,
            target: { kind: 'newDiscussion' },
            composer: { text: { value: 'about the release' } },
            title: { value: 'Release plan' },
        });

        const discussionRemote = createRemote(discussionAddress);
        const discussionRepository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: discussionRemote.transport,
            cipher: plainCipher(),
            syncEnabled: true,
        });
        discussionRepository.writeDiscussionSessionDraft({
            scope,
            address: discussionAddress,
            patch: { text: 'reply' },
        });
        expect(await discussionRepository.flushSessionDraft({ scope, address: discussionAddress }))
            .toEqual({ status: 'clean' });
        expect(discussionRepository.getSessionDraftSnapshot(scope, discussionAddress)?.document)
            .toMatchObject({ v: 2, target: { kind: 'discussion' } });
    });

    it('preserves both the newer synchronized edit and the newer local edit on a Run draft conflict', async () => {
        const remote = createRemote(runAddress);
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: remote.transport,
            cipher: plainCipher(),
            syncEnabled: true,
        });
        repository.writeExistingSessionDraft({ scope, sessionId: runAddress.sessionId, runId: runAddress.runId, patch: { text: 'first' } });
        await repository.flushSessionDraft({ scope, address: runAddress });

        const base = remote.readCurrent()!;
        const remoteDocument = structuredClone(
            (base.content as Extract<SessionDraftStoredContentEnvelopeV2, { t: 'plain' }>).v.document,
        );
        remoteDocument.composer.attachments = { mutationId: '00000000-0000-4000-8000-0000000000a1', value: [{ id: 'from-another-device' }] };
        remote.replaceCurrent({
            revision: base.revision + 1,
            content: { t: 'plain', v: { v: 2, address: runAddress, document: remoteDocument } },
            createdAt: base.createdAt,
            updatedAt: base.updatedAt + 1,
        });

        repository.writeExistingSessionDraft({ scope, sessionId: runAddress.sessionId, runId: runAddress.runId, patch: { text: 'second' } });
        expect(await repository.flushSessionDraft({ scope, address: runAddress })).toEqual({ status: 'clean' });
        const snapshot = repository.getSessionDraftSnapshot(scope, runAddress);
        expect(snapshot?.document.composer.text.value).toBe('second');
        expect(snapshot?.document.composer.attachments.value).toEqual([{ id: 'from-another-device' }]);
        expect(snapshot?.conflict).toBeNull();
    });

    it('retains unsent content when the V2 draft epoch is unavailable', async () => {
        const remote = createRemote(runAddress);
        const unavailable: SessionDraftRepositoryTransport = {
            ...remote.transport,
            mutate: vi.fn(async () => { throw new Error('Session draft V2 operations are unavailable'); }),
        };
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: unavailable,
            cipher: plainCipher(),
            syncEnabled: true,
        });
        repository.writeExistingSessionDraft({ scope, sessionId: runAddress.sessionId, runId: runAddress.runId, patch: { text: 'unsent' } });
        expect(await repository.flushSessionDraft({ scope, address: runAddress })).toEqual({ status: 'offline' });
        const snapshot = repository.getSessionDraftSnapshot(scope, runAddress);
        expect(snapshot?.document.composer.text.value).toBe('unsent');
        expect(snapshot?.status).toBe('offline');
        expect(remote.readCurrent()).toBeNull();
    });

    it('deletes a Run or discussion draft through the existing lifecycle owner', async () => {
        const remote = createRemote(discussionAddress);
        const onDraftRemoved = vi.fn(async () => undefined);
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: remote.transport,
            cipher: plainCipher(),
            syncEnabled: true,
            onDraftRemoved,
        });
        repository.writeDiscussionSessionDraft({ scope, address: discussionAddress, patch: { text: 'draft' } });
        await repository.flushSessionDraft({ scope, address: discussionAddress });
        await expect(repository.deleteSessionDraft({ scope, address: discussionAddress })).resolves.toBe(true);
        expect(repository.getSessionDraftSnapshot(scope, discussionAddress)).toBeNull();
        expect(remote.readCurrent()?.content).toBeNull();
        await vi.waitFor(() => expect(onDraftRemoved).toHaveBeenCalledWith(expect.objectContaining({
            scope,
            address: discussionAddress,
        })));
    });

    it('keeps an acknowledged tombstone visible and retryable until authoritative custody cleanup succeeds', async () => {
        const remote = createRemote(discussionAddress);
        const onDraftRemoved = vi.fn()
            .mockRejectedValueOnce(new Error('local custody busy'))
            .mockResolvedValueOnce(undefined);
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: remote.transport,
            cipher: plainCipher(),
            syncEnabled: true,
            onDraftRemoved,
        });
        repository.writeDiscussionSessionDraft({ scope, address: discussionAddress, patch: { text: 'draft' } });
        await repository.flushSessionDraft({ scope, address: discussionAddress });

        await expect(repository.deleteSessionDraft({ scope, address: discussionAddress }))
            .rejects.toThrow('local custody busy');
        expect(remote.readCurrent()?.content).toBeNull();
        expect(repository.getSessionDraftSnapshot(scope, discussionAddress)).toMatchObject({ status: 'error' });

        await expect(repository.deleteSessionDraft({ scope, address: discussionAddress })).resolves.toBe(false);
        expect(repository.getSessionDraftSnapshot(scope, discussionAddress)).toBeNull();
        expect(onDraftRemoved).toHaveBeenCalledTimes(2);
    });

    it('publishes authoritative removal when another device tombstones the draft', async () => {
        const remote = createRemote(discussionAddress);
        const first = createSessionDraftRepository({
            storage: createMemoryStorage(), scope, transport: remote.transport, cipher: plainCipher(), syncEnabled: true,
        });
        const onDraftRemoved = vi.fn(async () => undefined);
        const observer = createSessionDraftRepository({
            storage: createMemoryStorage(), scope, transport: remote.transport, cipher: plainCipher(), syncEnabled: true,
            onDraftRemoved,
        });
        first.writeDiscussionSessionDraft({ scope, address: discussionAddress, patch: { text: 'cross-device draft' } });
        await first.flushSessionDraft({ scope, address: discussionAddress });
        await observer.materializeExact(scope, discussionAddress);

        await expect(first.deleteSessionDraft({ scope, address: discussionAddress })).resolves.toBe(true);
        await observer.materializeExact(scope, discussionAddress);

        expect(observer.getSessionDraftSnapshot(scope, discussionAddress)).toBeNull();
        await vi.waitFor(() => expect(onDraftRemoved).toHaveBeenCalledWith(expect.objectContaining({
            scope,
            address: discussionAddress,
        })));
    });

    it('purges revoked discussion presentation without authoring a remote deletion', async () => {
        const remote = createRemote(discussionAddress);
        const onDraftRemoved = vi.fn(async () => undefined);
        const repository = createSessionDraftRepository({
            storage: createMemoryStorage(),
            scope,
            transport: remote.transport,
            cipher: plainCipher(),
            syncEnabled: true,
            onDraftRemoved,
        });
        repository.writeDiscussionSessionDraft({ scope, address: discussionAddress, patch: { text: 'private draft' } });
        await repository.flushSessionDraft({ scope, address: discussionAddress });
        vi.mocked(remote.transport.mutate).mockClear();

        await repository.purgeSessionDraftPresentation({ scope, address: discussionAddress });

        expect(repository.getSessionDraftSnapshot(scope, discussionAddress)).toBeNull();
        expect(remote.transport.mutate).not.toHaveBeenCalled();
        expect(remote.readCurrent()?.content).not.toBeNull();
        expect(onDraftRemoved).not.toHaveBeenCalled();
    });
});
