import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import * as protocol from '@happier-dev/protocol';
import {
    ARTIFACT_PLAIN_DATA_KEY_MARKER,
    computeContentPublicKeyFingerprint,
    encodePlainArtifactStoredContent,
    openSessionOwnerMetadataEnvelopeV1,
    sealSessionOwnerMetadataEnvelopeV1,
    signAccountContentKeyBindingV1,
    sealEncryptedDataKeyEnvelopeV1,
    openEncryptedDataKeyEnvelopeV1,
} from '@happier-dev/protocol';

import { Encryption } from '@/sync/encryption/encryption';
import {
    MACHINE_PLAIN_DATA_KEY_MARKER,
    encodePlainMachineStoredContent,
} from '@happier-dev/protocol';
import { encodeAccountStoredJsonContent } from '@/sync/encryption/accountStoredJsonContent';
import {
    buildAccountEncryptionMigrationStorageDirectives,
} from './buildAccountEncryptionMigrationStorageDirectives';

describe('buildAccountEncryptionMigrationStorageDirectives', () => {
    const tokenOnlyCredentials = { token: 'token' } as const;
    const legacyCredentials = {
        token: 'token',
        secret: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
    };
    const emptyTransitionInventories = {
        readArtifactRecipients: async (artifactId: string) => ({ artifactId,
            ownerAccountId: 'account-a', access: 'owner' as const, encryptionMode: 'plain' as const,
            dataEncryptionKey: null, callerDataEncryptionKey: null, recipients: [] }),
        scope: {
            scope: { serverId: 'home-a', accountId: 'account-a' },
            isCurrent: () => true,
        },
        reviewCommentsInventory: { v: 1 as const, items: [] },
        sessionOrganizationInventory: {
            version: 0,
            folders: [],
            tags: [],
            labels: [],
        },
    };

    it('round-trips shared and handoff workspace tabs across Account modes with their exact CAS versions', async () => {
        const encryption = await Encryption.create(new Uint8Array(32).fill(7));
        const record = { v: 1, tabsById: { tab: { id: 'tab', target: { kind: 'session', params: { sessionId: 'private-session' } }, pinned: true } }, order: ['tab'], pairs: [] };
        const keys = ['workspace:tabs:v1', 'workspace:handoff-tabs:v1:device:window'];
        const inputs = { ...emptyTransitionInventories, machines: [], todos: [], artifacts: [], sessions: [], sessionSourceCredentials: tokenOnlyCredentials, sessionTargetCredentials: legacyCredentials };
        const workspace = await Promise.all(keys.map(async (key, index) => ({ key, version: index + 4,
            value: await encodeAccountStoredJsonContent({ mode: 'plain', value: record, encryption: null }),
        })));
        const encrypted = await buildAccountEncryptionMigrationStorageDirectives({ ...inputs, fromMode: 'plain', toMode: 'e2ee', sourceEncryption: null, targetEncryption: encryption, workspace });
        expect(encrypted).toHaveProperty('workspace.action', 'migrate');
        if (encrypted.workspace?.action !== 'migrate') throw new Error('Missing Workspace migration');
        const items = encrypted.workspace.items;
        expect(items.map(item => ({ key: item.key, version: item.expectedVersion }))).toEqual(workspace.map(row => ({ key: row.key, version: row.version })));
        const plain = await buildAccountEncryptionMigrationStorageDirectives({ ...inputs, fromMode: 'e2ee', toMode: 'plain', sourceEncryption: encryption, targetEncryption: null, workspace: items.map(item => ({ key: item.key, version: item.expectedVersion + 1, value: item.value })) });
        if (plain.workspace?.action !== 'migrate') throw new Error('Missing plain Workspace migration');
        expect(plain.workspace.items.map(item => JSON.parse(Buffer.from(item.value, 'base64').toString('utf8')))).toEqual(keys.map(() => ({ t: 'plain', v: record })));
    });

    it('wraps the replacement Artifact key for current recipients and emits no envelopes for a plain target', async () => {
        const targetEncryption = await Encryption.create(new Uint8Array(32).fill(7));
        const artifactId = '11111111-1111-4111-8111-111111111111';
        const signingSecret = randomBytes(32);
        const signingPublic = ed25519.getPublicKey(signingSecret);
        const contentSecret = randomBytes(32);
        const contentPublic = x25519.getPublicKey(contentSecret);
        const fingerprint = computeContentPublicKeyFingerprint(contentPublic);
        const signature = signAccountContentKeyBindingV1({ accountSigningSecretKey: new Uint8Array([...signingSecret, ...signingPublic]), contentPublicKey: contentPublic });
        const oldEnvelope = Buffer.from(sealEncryptedDataKeyEnvelopeV1({ dataKey: randomBytes(32), recipientPublicKey: contentPublic, randomBytes })).toString('base64');
        const rows = [{ id: artifactId, header: encodePlainArtifactStoredContent({ title: 'Shared' }),
            body: encodePlainArtifactStoredContent({ body: 'Private content' }), headerVersion: 1, bodyVersion: 1,
            dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER }];
        const inputs = { ...emptyTransitionInventories, machines: [], todos: [], sessions: [],
            sessionSourceCredentials: tokenOnlyCredentials, sessionTargetCredentials: legacyCredentials };
        const result = await buildAccountEncryptionMigrationStorageDirectives({ ...inputs,
            fromMode: 'plain', toMode: 'e2ee', sourceEncryption: null, targetEncryption, artifacts: rows,
            readArtifactRecipients: async () => ({ artifactId, ownerAccountId: 'account-a', access: 'owner', encryptionMode: 'plain',
                dataEncryptionKey: null, callerDataEncryptionKey: null, recipients: [{ recipientAccountId: 'peer',
                    contentKey: { status: 'available', accountSigningPublicKey: Buffer.from(signingPublic).toString('hex'),
                        contentPublicKey: Buffer.from(contentPublic).toString('base64'), contentPublicKeySignature: Buffer.from(signature).toString('base64') },
                    contentPublicKeyFingerprint: fingerprint, encryptedDataKey: oldEnvelope, recipientContentPublicKeyFingerprint: fingerprint }] }),
        });
        if (result.artifacts.action !== 'migrate') throw new Error('Missing Artifact directive');
        const item = result.artifacts.items[0]!;
        expect(item.expectedDataEncryptionKey).toBe(ARTIFACT_PLAIN_DATA_KEY_MARKER);
        expect(item.recipientKeyEnvelopes?.map(row => row.recipientAccountId)).toEqual(['peer']);
        const ownerKey = await targetEncryption.decryptEncryptionKey(item.dataEncryptionKey);
        expect(ownerKey).not.toBeNull();
        expect(openEncryptedDataKeyEnvelopeV1({ envelope: new Uint8Array(Buffer.from(item.recipientKeyEnvelopes![0]!.encryptedDataKey, 'base64')),
            recipientSecretKeyOrSeed: contentSecret })).toEqual(ownerKey);
        const plain = await buildAccountEncryptionMigrationStorageDirectives({ ...inputs, fromMode: 'e2ee', toMode: 'plain',
            sourceEncryption: targetEncryption, targetEncryption: null, sessionSourceCredentials: legacyCredentials, sessionTargetCredentials: null,
            artifacts: [{ ...rows[0]!, header: item.header, body: item.body, dataEncryptionKey: item.dataEncryptionKey }],
            readArtifactRecipients: async () => { throw new Error('Plain targets must not discover recipients'); },
        });
        expect(plain.artifacts).toMatchObject({ action: 'migrate', items: [{ dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER }] });
        if (plain.artifacts.action !== 'migrate') throw new Error('Missing plain directive');
        expect(plain.artifacts.items[0]).toMatchObject({
            expectedDataEncryptionKey: item.dataEncryptionKey,
            recipientKeyEnvelopes: [],
        });
    });

    it('rewrites complete plaintext Machine, Todo, Artifact, and Session inventories for e2ee', async () => {
        const targetEncryption =
            await Encryption.create(new Uint8Array(32).fill(7));
        const artifactId = '00000000-0000-4000-8000-000000000001';

        const result =
            await buildAccountEncryptionMigrationStorageDirectives({
                toMode: 'e2ee',
                fromMode: 'plain',
                sourceEncryption: null,
                targetEncryption,
                machines: [{
                    id: 'machine-1',
                    metadata: encodePlainMachineStoredContent({
                        host: 'plain-host',
                        platform: 'darwin',
                        happyCliVersion: '0.2.10',
                        happyHomeDir: '/tmp/happier',
                        homeDir: '/tmp',
                    }),
                    metadataVersion: 2,
                    daemonState: encodePlainMachineStoredContent({
                        status: 'running',
                    }),
                    daemonStateVersion: 3,
                    dataEncryptionKey: MACHINE_PLAIN_DATA_KEY_MARKER,
                }],
                todos: [{
                    key: 'todo.index',
                    value: await encodeAccountStoredJsonContent({
                        mode: 'plain',
                        value: { undoneOrder: [], completedOrder: [] },
                        encryption: null,
                    }),
                    version: 4,
                }],
                artifacts: [{
                    id: artifactId,
                    header: encodePlainArtifactStoredContent({
                        title: 'Plain artifact',
                    }),
                    headerVersion: 5,
                    body: encodePlainArtifactStoredContent({
                        body: 'Plain body',
                    }),
                    bodyVersion: 6,
                    dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
                }],
                sessions: [{
                    id: 'session-active',
                    metadataLayoutVersion: 1,
                    metadataVersion: 7,
                    agentStateVersion: 8,
                    ownerMetadata: {
                        t: 'plain',
                        v: { v: 1 },
                    },
                }],
                ...emptyTransitionInventories,
                sessionSourceCredentials: tokenOnlyCredentials,
                sessionTargetCredentials: legacyCredentials,
            });

        expect(result.machines).toMatchObject({
            action: 'migrate',
            items: [{
                machineId: 'machine-1',
                expectedMetadataVersion: 2,
                expectedDaemonStateVersion: 3,
                contentPublicKeyFingerprint:
                    computeContentPublicKeyFingerprint(
                        targetEncryption.contentDataKey,
                    ),
            }],
        });
        expect(result.todos).toMatchObject({
            action: 'migrate',
            items: [{
                key: 'todo.index',
                expectedVersion: 4,
            }],
        });
        expect(result.artifacts).toMatchObject({
            action: 'migrate',
            items: [{
                artifactId,
                expectedHeaderVersion: 5,
                expectedBodyVersion: 6,
            }],
        });
        expect(result.sessions).toMatchObject({
            action: 'migrate',
            items: [{
                sessionId: 'session-active',
                expectedMetadataLayoutVersion: 1,
                expectedMetadataVersion: 7,
                expectedAgentStateVersion: 8,
                expectedOwnerMetadata: {
                    t: 'plain',
                    v: { v: 1 },
                },
                ownerMetadata: { t: 'encrypted' },
            }],
        });
        if (result.sessions.action !== 'migrate') {
            throw new Error('expected Session migration');
        }
        expect(openSessionOwnerMetadataEnvelopeV1({
            accountMode: 'e2ee',
            envelope: result.sessions.items[0]!.ownerMetadata,
            material: {
                type: 'legacy',
                secret: new Uint8Array(32).fill(7),
            },
        })).toEqual({ ok: true, ownerMetadata: { v: 1 } });
        expect(result.machines.action === 'migrate'
            && result.machines.items[0]?.dataEncryptionKey)
            .not.toBe(MACHINE_PLAIN_DATA_KEY_MARKER);
        expect(result.artifacts.action === 'migrate'
            && result.artifacts.items[0]?.dataEncryptionKey)
            .not.toBe(ARTIFACT_PLAIN_DATA_KEY_MARKER);
    });

    it('builds every Session replacement beyond the former 500-item ceiling', async () => {
        const material = {
            type: 'legacy' as const,
            secret: new Uint8Array(32).fill(7),
        };
        const sourceOwnerMetadata = sealSessionOwnerMetadataEnvelopeV1({
            material,
            ownerMetadata: { v: 1 },
            randomBytes: (length) => new Uint8Array(length).fill(11),
        });

        const result = await buildAccountEncryptionMigrationStorageDirectives({
            toMode: 'plain',
            fromMode: 'e2ee',
            sourceEncryption: null,
            targetEncryption: null,
            machines: [],
            todos: [],
            artifacts: [],
            sessions: Array.from({ length: 501 }, (_, index) => ({
                id: `session-${index}`,
                metadataLayoutVersion: 1 as const,
                metadataVersion: index,
                agentStateVersion: index,
                ownerMetadata: sourceOwnerMetadata,
            })),
            ...emptyTransitionInventories,
            sessionSourceCredentials: legacyCredentials,
            sessionTargetCredentials: null,
        });

        expect(result.sessions.action).toBe('migrate');
        if (result.sessions.action !== 'migrate') {
            throw new Error('expected Session migration');
        }
        expect(result.sessions.items).toHaveLength(501);
        expect(result.sessions.items.at(-1)).toMatchObject({
            sessionId: 'session-500',
            ownerMetadata: { t: 'plain', v: { v: 1 } },
        });
    });

    it('uses strict empty assertions rather than inventing migration work', async () => {
        await expect(
            buildAccountEncryptionMigrationStorageDirectives({
                toMode: 'plain',
                fromMode: 'e2ee',
                sourceEncryption: null,
                targetEncryption: null,
                machines: [],
                todos: [],
                artifacts: [],
                sessions: [],
                ...emptyTransitionInventories,
                sessionSourceCredentials: tokenOnlyCredentials,
                sessionTargetCredentials: null,
            }),
        ).resolves.toEqual({
            machines: { action: 'assert_empty' },
            todos: { action: 'assert_empty' },
            artifacts: { action: 'assert_empty' },
            sessions: { action: 'assert_empty' },
            reviewComments: { action: 'assert_empty' },
            sessionOrganization: { action: 'assert_empty' },
            pets: { action: 'assert_empty' },
        });
    });

    it('rejects a malformed Todo inventory through the canonical Todo codec', async () => {
        await expect(
            buildAccountEncryptionMigrationStorageDirectives({
                toMode: 'plain',
                fromMode: 'e2ee',
                sourceEncryption: null,
                targetEncryption: null,
                machines: [],
                todos: [{
                    key: 'todo.index',
                    value: await encodeAccountStoredJsonContent({
                        mode: 'plain',
                        value: {
                            undoneOrder: 'invalid',
                            completedOrder: [],
                        },
                        encryption: null,
                    }),
                    version: 4,
                }],
                artifacts: [],
                sessions: [],
                ...emptyTransitionInventories,
                sessionSourceCredentials: tokenOnlyCredentials,
                sessionTargetCredentials: null,
            }),
        ).rejects.toMatchObject({
            code: 'todo_stored_content_unavailable',
            key: 'todo.index',
        });
    });

    it('rejects Todo transition inventory whose source envelope disagrees with the exact source Account mode', async () => {
        const encryption = await Encryption.create(
            new Uint8Array(32).fill(7),
        );
        const encryptedIndex = await encodeAccountStoredJsonContent({
            mode: 'e2ee',
            value: { undoneOrder: [], completedOrder: [] },
            encryption,
        });
        const plainIndex = await encodeAccountStoredJsonContent({
            mode: 'plain',
            value: { undoneOrder: [], completedOrder: [] },
            encryption: null,
        });

        for (const mismatch of [
            {
                fromMode: 'plain' as const,
                toMode: 'e2ee' as const,
                value: encryptedIndex,
                sourceEncryption: encryption,
                targetEncryption: encryption,
                sourceCredentials: tokenOnlyCredentials,
                targetCredentials: legacyCredentials,
            },
            {
                fromMode: 'e2ee' as const,
                toMode: 'plain' as const,
                value: plainIndex,
                sourceEncryption: encryption,
                targetEncryption: null,
                sourceCredentials: legacyCredentials,
                targetCredentials: null,
            },
        ]) {
            await expect(
                buildAccountEncryptionMigrationStorageDirectives({
                    fromMode: mismatch.fromMode,
                    toMode: mismatch.toMode,
                    sourceEncryption: mismatch.sourceEncryption,
                    targetEncryption: mismatch.targetEncryption,
                    machines: [],
                    todos: [{
                        key: 'todo.index',
                        value: mismatch.value,
                        version: 4,
                    }],
                    artifacts: [],
                    sessions: [],
                    ...emptyTransitionInventories,
                    sessionSourceCredentials:
                        mismatch.sourceCredentials,
                    sessionTargetCredentials:
                        mismatch.targetCredentials,
                }),
            ).rejects.toMatchObject({
                code: 'todo_stored_content_unavailable',
                key: 'todo.index',
                reason: 'account_mode_mismatch',
            });
        }
    });

    it('rejects an encrypted Session owner envelope when source material is unavailable', async () => {
        const ownerMetadata = sealSessionOwnerMetadataEnvelopeV1({
            material: {
                type: 'legacy',
                secret: new Uint8Array(32).fill(4),
            },
            ownerMetadata: { v: 1 },
            randomBytes: (length) => new Uint8Array(length).fill(2),
        });
        await expect(
            buildAccountEncryptionMigrationStorageDirectives({
                toMode: 'plain',
                fromMode: 'e2ee',
                sourceEncryption: null,
                targetEncryption: null,
                machines: [],
                todos: [],
                artifacts: [],
                sessions: [{
                    id: 'session-locked',
                    metadataLayoutVersion: 1,
                    metadataVersion: 3,
                    agentStateVersion: 4,
                    ownerMetadata,
                }],
                ...emptyTransitionInventories,
                sessionSourceCredentials: tokenOnlyCredentials,
                sessionTargetCredentials: null,
            }),
        ).rejects.toThrow(
            'Session owner metadata is unavailable (session-locked)',
        );
    });

    it('rejects a Session source envelope that disagrees with the source Account mode', async () => {
        const ownerMetadata = sealSessionOwnerMetadataEnvelopeV1({
            material: {
                type: 'legacy',
                secret: new Uint8Array(32).fill(7),
            },
            ownerMetadata: { v: 1 },
            randomBytes: (length) => new Uint8Array(length).fill(2),
        });
        await expect(
            buildAccountEncryptionMigrationStorageDirectives({
                toMode: 'e2ee',
                fromMode: 'plain',
                sourceEncryption: null,
                targetEncryption: null,
                machines: [],
                todos: [],
                artifacts: [],
                sessions: [{
                    id: 'session-wrong-source',
                    metadataLayoutVersion: 1,
                    metadataVersion: 3,
                    agentStateVersion: 4,
                    ownerMetadata,
                }],
                ...emptyTransitionInventories,
                sessionSourceCredentials: legacyCredentials,
                sessionTargetCredentials: legacyCredentials,
            }),
        ).rejects.toMatchObject({
            code: 'session_owner_metadata_account_mode_mismatch',
            reason: 'account_mode_mismatch',
        });
    });

    it('aborts locally when an E2EE target Session envelope cannot be reopened', async () => {
        const actualOpen =
            protocol.openSessionOwnerMetadataEnvelopeV1;
        const openSpy = vi
            .spyOn(protocol, 'openSessionOwnerMetadataEnvelopeV1')
            .mockImplementationOnce(actualOpen)
            .mockReturnValueOnce({
                ok: false,
                reason: 'invalid_ciphertext',
            });
        try {
            await expect(
                buildAccountEncryptionMigrationStorageDirectives({
                    toMode: 'e2ee',
                    fromMode: 'plain',
                    sourceEncryption: null,
                    targetEncryption: null,
                    machines: [],
                    todos: [],
                    artifacts: [],
                    sessions: [{
                        id: 'session-round-trip',
                        metadataLayoutVersion: 1,
                        metadataVersion: 3,
                        agentStateVersion: 4,
                        ownerMetadata: {
                            t: 'plain',
                            v: { v: 1 },
                        },
                    }],
                    ...emptyTransitionInventories,
                    sessionSourceCredentials: tokenOnlyCredentials,
                    sessionTargetCredentials: legacyCredentials,
                }),
            ).rejects.toThrow(
                'Target Session owner metadata verification failed',
            );
        } finally {
            openSpy.mockRestore();
        }
    });
});
