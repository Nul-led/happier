import { describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { AccountEncryptionCurrentnessResponse } from '@happier-dev/protocol';

import { fetchAndApplySessionById, type SessionByIdEncryption } from './sessionById';
import { Encryption } from '@/sync/encryption/encryption';
import { encodeBase64 } from '@/encryption/base64';
import {
    projectLegacySessionAccessCapabilitiesV1,
    sealEncryptedDataKeyEnvelopeV1,
    sealSessionOwnerMetadataEnvelopeV1,
} from '@happier-dev/protocol';
import { fetchAndApplySessions } from './sessionSnapshot';
import { hasAuthoritativeSessionRouteData } from '@/sync/domains/session/hasAuthoritativeSessionRouteData';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';
import { isUserFacingSession } from '@/sync/domains/session/listing/isUserFacingSession';

/**
 * Single-Session hydration must settle. A Session the viewer is authorized to see but cannot
 * decrypt is a locked Session with a truthful state, not a retryable failure that leaves the route
 * spinning, and never a reason to reach for owner-only Account material.
 */

const PLAIN_ACCOUNT_CURRENTNESS = {
    mode: 'plain',
    version: 1,
    signingKeyFingerprint: null,
    contentKeyFingerprint: null,
    updatedAt: 1,
    recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' },
} satisfies AccountEncryptionCurrentnessResponse;
const E2EE_ACCOUNT_CURRENTNESS = {
    ...PLAIN_ACCOUNT_CURRENTNESS,
    mode: 'e2ee',
    signingKeyFingerprint: 'signing-current',
    contentKeyFingerprint: 'content-current',
    recipientEnvelopeReadiness: { status: 'available' },
} satisfies AccountEncryptionCurrentnessResponse;

const LEGACY_CREDENTIALS = { token: 't', secret: 's' } as AuthCredentials;

function sessionResponse(session: Record<string, unknown>): Response {
    return new Response(JSON.stringify({ session }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function buildRow(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        id: 's_locked',
        createdAt: 1,
        updatedAt: 2,
        seq: 3,
        active: true,
        activeAt: 2,
        encryptionMode: 'e2ee',
        dataEncryptionKey: null,
        metadataLayoutVersion: 0,
        metadataVersion: 4,
        metadata: 'encrypted-metadata',
        agentStateVersion: 5,
        agentState: null,
        share: null,
        ...overrides,
    };
}

function createEncryption(openEnvelope: (value: string) => Uint8Array | null = () => null) {
    const initializedSessionIds = new Set<string>();
    const decryptEncryptionKey = vi.fn(async (value: string) => openEnvelope(value));
    const initializeSessions = vi.fn(async (sessionKeys: Map<string, Uint8Array | null>) => {
        for (const sessionId of sessionKeys.keys()) initializedSessionIds.add(sessionId);
    });
    const removeSessionEncryption = vi.fn((sessionId: string) => {
        initializedSessionIds.delete(sessionId);
    });
    const getSessionEncryption = vi.fn((sessionId: string) => (
        initializedSessionIds.has(sessionId)
            ? {
                decryptMetadata: async (_version: number, value: string) => ({ decrypted: value }),
                decryptMetadataPayload: async (_version: number, value: string) => ({ decrypted: value }),
                decryptAgentState: async () => null,
            }
            : null
    ));
    const encryption = {
        decryptEncryptionKey,
        initializeSessions,
        removeSessionEncryption,
        getSessionEncryption,
    } as unknown as SessionByIdEncryption;
    return { encryption, decryptEncryptionKey, initializeSessions, removeSessionEncryption };
}

async function hydrateRow(params: Readonly<{
    row: Record<string, unknown>;
    encryption: ReturnType<typeof createEncryption>;
    credentials?: AuthCredentials;
}>) {
    const applySessions = vi.fn();
    const result = await fetchAndApplySessionById({
        sessionId: 's_locked',
        accountCurrentness: E2EE_ACCOUNT_CURRENTNESS,
        credentials: params.credentials ?? LEGACY_CREDENTIALS,
        encryption: params.encryption.encryption,
        sessionDataKeys: new Map<string, Uint8Array>(),
        sessionDataKeyEnvelopes: new Map<string, string>(),
        request: async () => sessionResponse(params.row),
        applySessions,
        log: { log: () => {} },
        includeTurnsProjection: false,
    });
    return { result, applySessions, applied: applySessions.mock.calls[0]?.[0]?.[0] };
}

describe('fetchAndApplySessionById locked continuity', () => {
    it('treats a settled locked carrier as authoritative route data without requiring decrypted metadata', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: 1,
            metadata: null,
            ownerMetadataView: null,
            encryptedContentAvailability: 'encrypted_access_pending',
        })).toBe(true);
    });

    it.each([
        ['encryption_setup_required', 'recipient_encryption_setup_required'],
        ['encryption_inconsistent', 'encrypted_access_needs_repair'],
    ] as const)('uses the Account-owned %s result while retaining the authorized Session', async (reason, availability) => {
        const encryption = await Encryption.create(new Uint8Array(32).fill(7));
        const applied: unknown[] = [];
        const result = await fetchAndApplySessionById({
            sessionId: 's_locked',
            credentials: { token: 't' },
            encryption,
            sessionDataKeys: new Map(),
            request: async (path) => path === '/v1/account/encryption/currentness'
                ? new Response(JSON.stringify({
                    error: 'migration-required',
                    recipientEnvelopeReadiness: { status: 'unavailable', reason },
                }), { status: 400 })
                : sessionResponse(buildRow({ share: { accessLevel: 'view', canApprovePermissions: false } })),
            applySessions: (sessions) => applied.push(...sessions),
            log: { log: () => {} },
            includeTurnsProjection: false,
        });
        expect(result.ok).toBe(true);
        expect(applied).toEqual([expect.objectContaining({
            id: 's_locked',
            metadata: null,
            encryptedContentAvailability: availability,
        })]);
    });

    it('keeps a current recipient snapshot locked without installing the owner Account reader', async () => {
        const secret = new Uint8Array(32).fill(7);
        const encryption = await Encryption.create(secret);
        const applied: unknown[] = [];
        await fetchAndApplySessions({
            accountCurrentness: E2EE_ACCOUNT_CURRENTNESS,
            credentials: { token: 't', secret: encodeBase64(secret, 'base64') },
            encryption,
            sessionDataKeys: new Map(),
            sessionDataKeyEnvelopes: new Map(),
            request: async () => new Response(JSON.stringify({
                sessions: [buildRow({
                    effectiveAccess: {
                        v: 1,
                        level: 'view',
                        sources: [{ kind: 'team', teamId: 'team-1', requiredByTeamPolicy: false }],
                        capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'view', canApprovePermissions: false }),
                    },
                })],
                nextCursor: null,
                hasNext: false,
            }), { status: 200 }),
            applySessions: (sessions) => applied.push(...sessions),
            log: { log: () => {} },
        });
        expect(encryption.getSessionEncryption('s_locked')).toBeNull();
        expect(applied).toEqual([expect.objectContaining({
            id: 's_locked',
            metadata: null,
            encryptedContentAvailability: 'encrypted_access_pending',
        })]);
    });

    it.each([
        ['ordinary_owner_session', false, true],
        ['voice_carrier', true, false],
    ] as const)('uses independently opened owner metadata to classify a locked owner (%s)', async (key, hidden, visible) => {
        const contentKeys = tweetnacl.box.keyPair();
        const credentials = {
            token: 't',
            encryption: {
                publicKey: encodeBase64(contentKeys.publicKey, 'base64'),
                machineKey: encodeBase64(contentKeys.secretKey, 'base64'),
            },
        } satisfies AuthCredentials;
        const ownerMetadata = sealSessionOwnerMetadataEnvelopeV1({
            material: resolveAccountScopedCryptoMaterialFromCredentials(credentials),
            ownerMetadata: {
                v: 1,
                system: { systemSessionV1: { v: 1, key, hidden } },
            },
            randomBytes: (length) => new Uint8Array(length).fill(3),
        });
        const encryption = await Encryption.createFromContentKeyPair({
            publicKey: contentKeys.publicKey,
            machineKey: contentKeys.secretKey,
        });
        const applied: unknown[] = [];

        const result = await fetchAndApplySessionById({
            sessionId: 's_locked',
            accountCurrentness: E2EE_ACCOUNT_CURRENTNESS,
            credentials,
            encryption,
            sessionDataKeys: new Map(),
            request: async () => sessionResponse(buildRow({
                metadataLayoutVersion: 1,
                ownerMetadata,
                effectiveAccess: {
                    v: 1,
                    level: 'owner',
                    sources: [{ kind: 'owner' }],
                    capabilities: projectLegacySessionAccessCapabilitiesV1({
                        level: 'owner',
                        canApprovePermissions: true,
                    }),
                },
            })),
            applySessions: (sessions) => applied.push(...sessions),
            log: { log: () => {} },
            includeTurnsProjection: false,
        });

        expect(result.ok).toBe(true);
        expect(applied).toHaveLength(1);
        expect(isUserFacingSession(applied[0] as Parameters<typeof isUserFacingSession>[0]))
            .toBe(visible);
    });

    it.each(['wrong_key', 'unsupported', 'null'] as const)('distinguishes metadata authentication from unsupported payloads (%s)', async (kind) => {
        const secret = new Uint8Array(32).fill(7);
        const encryption = await Encryption.create(secret);
        const sessionKey = new Uint8Array(32).fill(8);
        const wrongWriter = await Encryption.create(secret);
        await wrongWriter.initializeSessions(new Map([['s_locked', kind === 'wrong_key' ? new Uint8Array(32).fill(9) : sessionKey]]));
        const ciphertext = await wrongWriter.getSessionEncryption('s_locked')!.encryptRaw(kind === 'null' ? null : false);
        const envelope = sealEncryptedDataKeyEnvelopeV1({
            dataKey: sessionKey,
            recipientPublicKey: encryption.contentDataKey,
            randomBytes: (length) => new Uint8Array(length).fill(3),
        });
        const applied: unknown[] = [];
        const result = await fetchAndApplySessionById({
            sessionId: 's_locked',
            credentials: { token: 't', secret: encodeBase64(secret, 'base64') },
            encryption,
            sessionDataKeys: new Map(),
            sessionDataKeyEnvelopes: new Map(),
            request: async () => sessionResponse(buildRow({
                dataEncryptionKey: encodeBase64(envelope, 'base64'),
                metadata: ciphertext,
            })),
            applySessions: (sessions) => applied.push(...sessions),
            log: { log: () => {} },
            includeTurnsProjection: false,
        });
        expect(result.ok).toBe(true);
        expect(applied).toEqual([expect.objectContaining({
            id: 's_locked',
            metadata: null,
            encryptedContentAvailability: kind === 'wrong_key' ? 'encrypted_content_unavailable' : 'ready',
        })]);
        const snapshotApplied: unknown[] = [];
        await fetchAndApplySessions({
            credentials: { token: 't', secret: encodeBase64(secret, 'base64') },
            accountCurrentness: E2EE_ACCOUNT_CURRENTNESS,
            encryption,
            sessionDataKeys: new Map(),
            sessionDataKeyEnvelopes: new Map(),
            request: async () => Response.json({
                sessions: [buildRow({ dataEncryptionKey: encodeBase64(envelope, 'base64'), metadata: ciphertext })],
                nextCursor: null, hasNext: false,
            }),
            applySessions: (sessions) => snapshotApplied.push(...sessions),
            log: { log: () => {} },
        });
        expect(snapshotApplied).toEqual([expect.objectContaining({
            id: 's_locked',
            encryptedContentAvailability: kind === 'wrong_key' ? 'encrypted_content_unavailable' : 'ready',
        })]);
    });

    it('settles an authorized Session whose envelope has not arrived as pending, not as a failure', async () => {
        const encryption = createEncryption();
        const { result, applied } = await hydrateRow({
            row: buildRow({ share: { accessLevel: 'edit', canApprovePermissions: false } }),
            encryption,
        });

        expect(result.ok).toBe(true);
        expect(result.errorCode).toBeUndefined();
        expect(encryption.decryptEncryptionKey).not.toHaveBeenCalled();
        expect(encryption.initializeSessions).not.toHaveBeenCalled();
        expect(applied).toEqual(expect.objectContaining({
            id: 's_locked',
            metadata: null,
            encryptedContentAvailability: 'encrypted_access_pending',
        }));
    });

    it('settles a present envelope that will not open as repair and never falls back to account material', async () => {
        const encryption = createEncryption(() => null);
        const { result, applied } = await hydrateRow({
            row: buildRow({ dataEncryptionKey: 'unopenable-envelope' }),
            encryption,
        });

        expect(result.ok).toBe(true);
        expect(encryption.decryptEncryptionKey).toHaveBeenCalledTimes(1);
        expect(encryption.initializeSessions).not.toHaveBeenCalled();
        expect(encryption.removeSessionEncryption).toHaveBeenCalledWith('s_locked');
        expect(applied).toEqual(expect.objectContaining({
            id: 's_locked',
            metadata: null,
            encryptedContentAvailability: 'encrypted_access_needs_repair',
        }));
    });

    it('settles the first ready→locked refresh instead of rejecting its own clear', async () => {
        // The real generation owner is the point of this case: clearing a key the
        // request itself found unopenable advances the owning generation, and a
        // by-ID request must adopt that advance rather than read it as an Account
        // switch that invalidates its own truthful result.
        const secret = new Uint8Array(32).fill(7);
        const encryption = await Encryption.create(secret);
        await encryption.initializeSessions(new Map([['s_locked', new Uint8Array(32).fill(8)]]));
        expect(encryption.getSessionEncryption('s_locked')).not.toBeNull();

        const applied: unknown[] = [];
        const result = await fetchAndApplySessionById({
            sessionId: 's_locked',
            accountCurrentness: E2EE_ACCOUNT_CURRENTNESS,
            credentials: { token: 't', secret: encodeBase64(secret, 'base64') },
            encryption,
            sessionDataKeys: new Map([['s_locked', new Uint8Array(32).fill(8)]]),
            sessionDataKeyEnvelopes: new Map(),
            request: async () => sessionResponse(buildRow({
                dataEncryptionKey: 'unopenable-envelope',
                share: { accessLevel: 'view', canApprovePermissions: false },
            })),
            applySessions: (sessions) => applied.push(...sessions),
            log: { log: () => {} },
            includeTurnsProjection: false,
        });

        expect(result.errorCode).not.toBe('stale_response');
        expect(result.ok).toBe(true);
        expect(encryption.getSessionEncryption('s_locked')).toBeNull();
        expect(applied).toEqual([expect.objectContaining({
            id: 's_locked',
            metadata: null,
            encryptedContentAvailability: 'encrypted_access_needs_repair',
        })]);
    });

    it('keeps the owner-only account reader for a legacy-credential Session with no envelope', async () => {
        const encryption = createEncryption();
        const { result, applied } = await hydrateRow({
            row: buildRow({ share: null }),
            encryption,
        });

        expect(result.ok).toBe(true);
        expect(encryption.decryptEncryptionKey).not.toHaveBeenCalled();
        expect([...(encryption.initializeSessions.mock.calls[0]?.[0] as Map<string, Uint8Array | null>).entries()])
            .toEqual([['s_locked', null]]);
        expect(applied).toEqual(expect.objectContaining({
            id: 's_locked',
            encryptedContentAvailability: 'ready',
            metadata: expect.objectContaining({ decrypted: 'encrypted-metadata' }),
        }));
    });
});
