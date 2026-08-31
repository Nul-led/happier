import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { decryptBox, encryptBox } from '@/encryption/libsodium';
import { HomeLoginRedemptionResultV1Schema } from '@happier-dev/protocol';

const setCredentialsForServerUrlMock = vi.hoisted(() => vi.fn(async () => true));
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
            setCredentialsForServerUrl: (...args: unknown[]) => setCredentialsForServerUrlMock(...args),
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
        setCredentialsForServerUrlMock.mockResolvedValue(true);
        endpointFetchMock.mockReset();
        vi.resetModules();
    });

    it('adopts B through the real owner, writes B credentials, and leaves focused A/groups unchanged', async () => {
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
                    clientBoxPublicKeyBase64: body.clientBoxPublicKeyBase64,
                    issuedAtMs: now - 1_000,
                    expiresAtMs: now + 2 * 60_000,
                    keyId: 'a'.repeat(64),
                    signatureBase64Url: 'A'.repeat(86),
                };
            }),
        };
        const sealedTokenBase64Url = encodeBase64(
            encryptBox(new TextEncoder().encode(JSON.stringify({ token: 'home-b-token' })), keyPair.publicKey),
            'base64url',
        );
        expect(new TextDecoder().decode(decryptBox(
            decodeBase64(sealedTokenBase64Url, 'base64url'),
            keyPair.privateKey,
        )!)).toBe('{"token":"home-b-token"}');
        const authorized = HomeLoginRedemptionResultV1Schema.parse({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealedTokenBase64Url,
            issuedAtMs: now,
            expiresAtMs: now + 2 * 60_000,
        });
        endpointFetchMock.mockImplementation(async () => new Response(JSON.stringify(authorized), {
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
            return true;
        });

        await expect(refreshAccountHomeDirectory(session)).resolves.toMatchObject({ status: 'ready' });
        expect(profiles.listServerProfiles()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                serverIdentityId: 'srv_home_b',
                source: 'account-directory',
            }),
        ]));
        const result = await enrollPreferredDirectoryHome(session);

        expect(requesterPublicKey).toEqual(keyPair.publicKey);
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).toHaveBeenCalled();
        expect(result).toEqual({ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' });
        expect(profiles.listServerProfiles()).toEqual(expect.arrayContaining([
            expect.objectContaining({ serverIdentityId: 'srv_home_b', name: 'Home B' }),
        ]));
        expect(profiles.listServerProfiles().filter((profile) => profile.serverIdentityId === 'srv_home_b')).toHaveLength(1);
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledWith(
            'https://home-b.test',
            { serverId: 'srv_home_b' },
            { token: 'home-b-token' },
        );
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: activeBefore.serverId,
            serverUrl: activeBefore.serverUrl,
        });
        expect(profiles.loadHomeViewState()).toMatchObject({
            activeTargetId: focused.id,
            groups: [{ id: 'g', serverIds: [focused.id] }],
        });
    });
});
