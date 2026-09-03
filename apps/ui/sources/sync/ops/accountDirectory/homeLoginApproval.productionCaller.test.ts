import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { decryptBox, encryptBox } from '@/encryption/libsodium';
import {
    createHomeCredentialDestinationDigestV1,
    HomeLoginRedemptionResultV1Schema,
} from '@happier-dev/protocol';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';

const setCredentialsForServerUrlMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<{ rollback: () => Promise<void> }>
>(async () => ({ rollback: async () => {} })));
const endpointFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: vi.fn(() => endpointFetchMock),
    serverFetch: vi.fn(),
}));
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            setCredentialsForServerUrlWithRollback: (...args: unknown[]) => setCredentialsForServerUrlMock(...args),
        },
    };
});

describe('Directory enrollment production composition', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    beforeAll(async () => {
        await sodium.ready;
    });

    afterEach(() => {
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        setCredentialsForServerUrlMock.mockClear();
        setCredentialsForServerUrlMock.mockResolvedValue({ rollback: async () => {} });
        endpointFetchMock.mockReset();
        vi.resetModules();
    });

    it('enrolls a fresh destination-bound Home through one advisory credential write without changing focus or groups', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `directory_enrollment_${Date.now()}_${Math.random()}`;
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = profiles.upsertServerProfile({ serverUrl: 'https://home-a.test', source: 'manual' });
        profiles.setActiveServerId(focused.id);
        profiles.saveHomeViewState({
            version: 1,
            activeTargetKind: 'server',
            activeTargetId: focused.id,
            groups: [{ id: 'g', name: 'Homes', serverIds: [focused.id] }],
        });
        const activeBefore = profiles.getActiveServerSnapshot();
        const now = Date.now();
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        const home = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_b',
            label: 'Home B',
            preferred: true,
            connectionDescriptor: {
                v: 1 as const,
                homeServerIdentityId: 'srv_home_b',
                canonicalServerUrl: 'https://home-b.test',
                revision: 1,
                endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
            },
            createdAtMs: now,
            updatedAtMs: now,
        };
        let requesterPublicKey: Uint8Array | null = null;
        const client = {
            getMe: vi.fn(async () => ({ accountId: 'account-1' })),
            listHomes: vi.fn(async () => ({ homes: [home], preferredHomeServerIdentityId: 'srv_home_b' })),
            requestLoginAssertion: vi.fn(async (_homeServerIdentityId: string, body: { clientBoxPublicKeyBase64: string }) => {
                requesterPublicKey = decodeBase64(body.clientBoxPublicKeyBase64, 'base64');
                return {
                    v: 1 as const,
                    purpose: 'happier.home-login' as const,
                    issuerServerIdentityId: 'srv_directory',
                    issuerSubjectId: 'account-1',
                    audienceHomeServerIdentityId: 'srv_home_b',
                    credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(
                        home.connectionDescriptor,
                    ),
                    clientBoxPublicKeyBase64: body.clientBoxPublicKeyBase64,
                    issuedAtMs: now - 1_000,
                    expiresAtMs: now + 2 * 60_000,
                    keyId: 'a'.repeat(64),
                    signatureBase64Url: 'A'.repeat(86),
                };
            }),
        };
        const coupledPayload = { token: 'home-b-token' };
        const sealedTokenBase64Url = encodeBase64(
            encryptBox(new TextEncoder().encode(JSON.stringify(coupledPayload)), keyPair.publicKey),
            'base64url',
        );
        expect(new TextDecoder().decode(decryptBox(
            decodeBase64(sealedTokenBase64Url, 'base64url'),
            keyPair.privateKey,
        )!)).toBe(JSON.stringify(coupledPayload));
        const authorized = HomeLoginRedemptionResultV1Schema.parse({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealedTokenBase64Url,
            issuedAtMs: now,
            expiresAtMs: now + 2 * 60_000,
        });
        const observedDescriptor = {
            ...home.connectionDescriptor,
            revision: 2,
        };
        endpointFetchMock.mockImplementation(async (path: string) => new Response(JSON.stringify(
            path === '/v1/features'
                ? {
                    ...createRootLayoutFeaturesResponse({
                        capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    }),
                    homeConnectionDescriptor: observedDescriptor,
                }
                : authorized,
        ), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        const { AccountDirectorySession } = await import('@/sync/domains/accountDirectory/accountDirectorySession');
        const session = new AccountDirectorySession({
            endpoint: 'https://directory.test',
            serverIdentityId: 'srv_directory',
        }, {
            client: client as never,
            capability: {
                version: 1,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: {
                    keyId: 'a'.repeat(64),
                    publicKeyBase64Url: 'A'.repeat(43),
                },
            },
        });
        const { refreshAccountHomeDirectory } = await import('./refreshAccountHomeDirectory');
        const { enrollPreferredDirectoryHome } = await import('./enrollPreferredDirectoryHome');
        expect(profiles.preflightHomeProfileAdoption({
            descriptor: home.connectionDescriptor,
            source: 'account-directory',
            preserveUserLabel: true,
            suggestedName: home.label,
        })).toEqual({
            canonicalServerUrl: 'https://home-b.test',
            serverIdentityId: 'srv_home_b',
            credentialWrite: 'required',
        });
        setCredentialsForServerUrlMock.mockImplementationOnce(async () => {
            expect(profiles.listServerProfiles()).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    serverIdentityId: 'srv_home_b',
                    source: 'account-directory',
                }),
            ]));
            expect(profiles.getActiveServerSnapshot()).toMatchObject({
                serverId: activeBefore.serverId,
                serverUrl: activeBefore.serverUrl,
            });
            return { rollback: async () => {} };
        });

        await expect(refreshAccountHomeDirectory(session)).resolves.toMatchObject({ status: 'ready' });
        expect(profiles.listServerProfiles()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                serverIdentityId: 'srv_home_b',
                source: 'account-directory',
            }),
        ]));
        const result = await enrollPreferredDirectoryHome(session, { entryIntent: 'connect_service' });

        expect(requesterPublicKey).toEqual(keyPair.publicKey);
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
        expect(endpointFetchMock.mock.calls.map(([path]) => path)).toEqual([
            '/v1/features',
            '/v1/auth/home-login',
        ]);
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledWith(
            'https://home-b.test',
            { serverId: 'srv_home_b' },
            { token: 'home-b-token' },
        );
        expect(result).toEqual({ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' });
        expect(profiles.listServerProfiles()).toEqual(expect.arrayContaining([
            expect.objectContaining({ serverIdentityId: 'srv_home_b', name: 'Home B' }),
        ]));
        expect(profiles.listServerProfiles().filter((profile) => profile.serverIdentityId === 'srv_home_b')).toHaveLength(1);
        expect(profiles.listServerProfiles()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                serverIdentityId: 'srv_home_b',
                name: 'Home B',
                canonicalServerUrl: 'https://home-b.test',
                connectionDescriptorRevision: 1,
                descriptorProvenance: 'advisory-only',
            }),
        ]));
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: activeBefore.serverId,
            serverUrl: activeBefore.serverUrl,
        });
        expect(profiles.loadHomeViewState()).toMatchObject({
            activeTargetId: focused.id,
            groups: [{ id: 'g', serverIds: [focused.id] }],
        });
    });

    it('fails closed before Home contact when the production caller receives the wrong signed destination digest', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `directory_enrollment_wrong_digest_${Date.now()}_${Math.random()}`;
        const now = Date.now();
        const home = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_wrong_digest',
            label: 'Wrong digest Home',
            preferred: true,
            connectionDescriptor: {
                v: 1 as const,
                homeServerIdentityId: 'srv_home_wrong_digest',
                canonicalServerUrl: 'https://wrong-digest-home.test',
                revision: 1,
                endpoints: [{ kind: 'https' as const, url: 'https://wrong-digest-home.test' }],
            },
            createdAtMs: now,
            updatedAtMs: now,
        };
        const session = {
            serviceKey: 'https://directory.test\u0000srv_directory',
            supportsHomeEnrollment: true,
            snapshot: {
                endpoint: 'https://directory.test',
                status: 'ready' as const,
                homes: [home],
                preferredHomeServerIdentityId: home.homeServerIdentityId,
                refreshedAtMs: now,
                error: null,
                reconciliation: { kind: 'not_run' as const },
            },
            requestLoginAssertion: vi.fn(async (_homeServerIdentityId: string, clientBoxPublicKeyBase64: string) => ({
                v: 1 as const,
                purpose: 'happier.home-login' as const,
                issuerServerIdentityId: 'srv_directory',
                issuerSubjectId: 'account-1',
                audienceHomeServerIdentityId: home.homeServerIdentityId,
                credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1({
                    ...home.connectionDescriptor,
                    canonicalServerUrl: 'https://attacker.test',
                    endpoints: [{ kind: 'https' as const, url: 'https://attacker.test' }],
                }),
                clientBoxPublicKeyBase64,
                issuedAtMs: now - 1_000,
                expiresAtMs: now + 2 * 60_000,
                keyId: 'a'.repeat(64),
                signatureBase64Url: 'A'.repeat(86),
            })),
        };
        const { enrollPreferredDirectoryHome } = await import('./enrollPreferredDirectoryHome');

        await expect(enrollPreferredDirectoryHome(session, {
            entryIntent: 'connect_service',
        })).resolves.toMatchObject({ kind: 'failed' });
        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('persists a later valid Home when an earlier Directory entry conflicts in the real profile owner', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `directory_refresh_isolation_${Date.now()}_${Math.random()}`;
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focused = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_existing_home',
                canonicalServerUrl: 'https://claimed-route.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://claimed-route.test' }],
            },
        });
        profiles.setActiveServerId(focused.id);
        const activeBefore = profiles.getActiveServerSnapshot();
        const now = Date.now();
        const conflicting = {
            v: 1 as const,
            homeServerIdentityId: 'srv_conflicting_home',
            label: 'Conflicting Home',
            preferred: false,
            connectionDescriptor: {
                v: 1 as const,
                homeServerIdentityId: 'srv_conflicting_home',
                canonicalServerUrl: 'https://claimed-route.test',
                revision: 1,
                endpoints: [{ kind: 'https' as const, url: 'https://claimed-route.test' }],
            },
            createdAtMs: now,
            updatedAtMs: now,
        };
        const valid = {
            v: 1 as const,
            homeServerIdentityId: 'srv_valid_home',
            label: 'Valid Home',
            preferred: true,
            connectionDescriptor: {
                v: 1 as const,
                homeServerIdentityId: 'srv_valid_home',
                canonicalServerUrl: 'https://valid-home.test',
                revision: 1,
                endpoints: [{ kind: 'https' as const, url: 'https://valid-home.test' }],
            },
            createdAtMs: now,
            updatedAtMs: now,
        };
        const { AccountDirectorySession } = await import('@/sync/domains/accountDirectory/accountDirectorySession');
        const session = new AccountDirectorySession({
            endpoint: 'https://directory.test',
            serverIdentityId: 'srv_directory',
        }, {
            client: {
                listHomes: vi.fn(async () => ({
                    homes: [conflicting, valid],
                    preferredHomeServerIdentityId: valid.homeServerIdentityId,
                })),
            } as never,
            capability: {
                version: 1,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: {
                    keyId: 'a'.repeat(64),
                    publicKeyBase64Url: 'A'.repeat(43),
                },
            },
        });
        const { refreshAccountHomeDirectory } = await import('./refreshAccountHomeDirectory');

        const result = await refreshAccountHomeDirectory(session);
        if (result.status !== 'ready') throw result.error;

        expect(result.reconciliation).toMatchObject({
            kind: 'completed',
            adopted: [{ homeServerIdentityId: 'srv_valid_home', label: 'Valid Home' }],
            failures: [{ homeServerIdentityId: 'srv_conflicting_home', label: 'Conflicting Home' }],
        });
        expect(profiles.listServerProfiles()).toEqual(expect.arrayContaining([
            expect.objectContaining({ serverIdentityId: 'srv_valid_home', name: 'Valid Home' }),
        ]));
        expect(profiles.listServerProfiles()).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ serverIdentityId: 'srv_conflicting_home' }),
        ]));
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: activeBefore.serverId,
            serverUrl: activeBefore.serverUrl,
        });
    });
});
