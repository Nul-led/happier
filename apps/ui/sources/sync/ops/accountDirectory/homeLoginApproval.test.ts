import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { encodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import { createAccountDirectoryClient, type AccountDirectoryHomeEntryV1, type HomeLoginAssertionV1 } from '@/sync/api/accountDirectory/accountDirectoryClient';
import {
    continueHomeLoginEnrollment,
} from './homeLoginApproval';
import {
    cancelPendingPreferredHomeEnrollment,
    enrollPreferredDirectoryHome,
    getPendingPreferredHomeEnrollment,
    resumePendingPreferredHomeEnrollment,
} from './enrollPreferredDirectoryHome';
import {
    ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_CREDENTIAL_PLAINTEXT_BYTES,
    ACCOUNT_DIRECTORY_MAX_SEALED_TOKEN_BYTES,
    createHomeCredentialDestinationDigestV1,
} from '@happier-dev/protocol';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointMock = vi.hoisted(() => vi.fn<
    (input: unknown) => typeof endpointFetchMock
>(() => endpointFetchMock));
const irohReleaseMock = vi.hoisted(() => vi.fn(async () => {}));
const acquireIrohHomeRuntimeOriginMock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>(async () => {
    throw new Error('native unavailable');
}));

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (input: unknown) => createServerFetchAtEndpointMock(input),
    serverFetch: vi.fn(),
}));

vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    acquireIrohHomeRuntimeOrigin: (input: unknown) => acquireIrohHomeRuntimeOriginMock(input),
}));

const setCredentialsForServerUrlMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<false | { rollback: () => Promise<void> }>
>(async () => ({ rollback: async () => {} })));
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<{ token: string }>
>(async () => ({ token: 'home-a-full-credential' })));

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            setCredentialsForServerUrlWithRollback: (...args: unknown[]) => setCredentialsForServerUrlMock(...args),
            getCredentialsForServerUrl: (...args: unknown[]) => getCredentialsForServerUrlMock(...args),
        },
    };
});

const adoptHomeProfileMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{
    id: string;
    serverUrl: string;
    serverIdentityId: string;
}>>(async () => ({
    id: 'profile-b',
    serverUrl: 'https://home-b.test',
    serverIdentityId: 'srv_home_b',
})));
const preflightHomeProfileAdoptionMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => {
    canonicalServerUrl: string;
    serverIdentityId: string;
    credentialWrite: 'required' | 'preserveExisting' | 'requiresCurrentObservation';
}>((...args: unknown[]) => {
    const adoption = (args[0] ?? {}) as {
        descriptor?: { canonicalServerUrl?: string; homeServerIdentityId?: string };
    };
    return {
        canonicalServerUrl: adoption.descriptor?.canonicalServerUrl ?? 'https://home-b.test',
        serverIdentityId: adoption.descriptor?.homeServerIdentityId ?? 'srv_home_b',
        credentialWrite: 'required',
    };
}));
const reconcileServerProfileHomeConnectionDescriptorMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<
    | Readonly<{
        kind: 'applied';
        profile: {
            id: string;
            serverUrl: string;
            canonicalServerUrl: string;
            serverIdentityId: string;
            source: 'account-directory';
            connectionDescriptorRevision: number;
        };
    }>
    | Readonly<{
        kind: 'conflict';
        code: 'equal_revision_conflict';
        profile: null;
    }>
>>(async () => ({
    kind: 'applied' as const,
    profile: {
        id: 'profile-b',
        serverUrl: 'https://home-b.test',
        canonicalServerUrl: 'https://home-b.test',
        serverIdentityId: 'srv_home_b',
        source: 'account-directory' as const,
        connectionDescriptorRevision: 1,
    },
})));
const buildHomeConnectionDescriptorForProfileMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => AccountDirectoryHomeEntryV1['connectionDescriptor'] | null>(() => ({
    v: 1 as const,
    homeServerIdentityId: 'srv_home_b',
    canonicalServerUrl: 'https://home-b.test',
    revision: 1,
    endpoints: [{ kind: 'https' as const, url: 'https://home-b.test' }],
})));
const resolveServerProfileForPortableIdentityMock = vi.hoisted(() => vi.fn(() => ({
    kind: 'resolved' as const,
    profile: {
        id: 'profile-b',
        serverUrl: 'https://home-b.test',
        serverIdentityId: 'srv_home_b',
    },
})));
const resolveServerProfileScopeIdMock = vi.hoisted(() => vi.fn(() => 'srv_home_b'));
const getAccountServiceEndpointSnapshotMock = vi.hoisted(() => vi.fn((): {
    url: string;
    serverIdentityId: string;
    source: 'user';
} | null => ({
    url: 'https://directory.test',
    serverIdentityId: 'srv_dir_1',
    source: 'user',
})));
const setActiveServerAndSwitchMock = vi.hoisted(() => vi.fn(async () => 'switched' as const));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    adoptHomeProfile: adoptHomeProfileMock,
    preflightHomeProfileAdoption: preflightHomeProfileAdoptionMock,
    reconcileServerProfileHomeConnectionDescriptor: reconcileServerProfileHomeConnectionDescriptorMock,
    buildHomeConnectionDescriptorForProfile: buildHomeConnectionDescriptorForProfileMock,
    resolveServerProfileForPortableIdentity: resolveServerProfileForPortableIdentityMock,
    resolveServerProfileScopeId: resolveServerProfileScopeIdMock,
    getAccountServiceEndpointSnapshot: () => getAccountServiceEndpointSnapshotMock(),
    resolveSelectedAccountServiceEndpoint: () => getAccountServiceEndpointSnapshotMock() ?? ({
        url: 'https://api.happier.dev', source: 'default' as const,
    }),
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: setActiveServerAndSwitchMock,
}));

vi.mock('@/sync/domains/server/selection/serverSelectionScope', () => ({
    resolveRoutineServerSelectionScope: () => 'tab' as const,
}));

vi.mock('@/utils/platform/desktopHost', () => ({
    desktopHostKind: () => 'tauri' as const,
    isDesktopHost: () => true,
}));

const directoryCredentialStorageMock = vi.hoisted(() => ({
    get: vi.fn(async () => ({ token: 'directory-oauth-token' })),
    set: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    normalizeAccountDirectoryEndpoint: (value: string) => value.replace(/\/+$/, ''),
}));

vi.mock('@/auth/accountDirectory/accountDirectoryCredentialStorage', () => ({
    accountDirectoryCredentialStorage: directoryCredentialStorageMock,
    normalizeAccountDirectoryEndpoint: directoryCredentialStorageMock.normalizeAccountDirectoryEndpoint,
}));

function json(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function sealCredentialPayload(
    token: string,
    recipientPublicKey: Uint8Array,
): string {
    const payload = { token };
    return encodeBase64(
        encryptBox(
            new TextEncoder().encode(JSON.stringify(payload)),
            recipientPublicKey,
        ),
        'base64url',
    );
}

function sealLegacyCredentialPayload(payload: unknown, recipientPublicKey: Uint8Array): string {
    return encodeBase64(
        encryptBox(
            new TextEncoder().encode(JSON.stringify(payload)),
            recipientPublicKey,
        ),
        'base64url',
    );
}

const HOME_B: AccountDirectoryHomeEntryV1 = {
    v: 1,
    homeServerIdentityId: 'srv_home_b',
    canonicalServerUrl: 'https://home-b.test',
    label: 'Home B',
    preferred: false,
    connectionDescriptor: {
        v: 1,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
    },
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_001,
};

const ASSERTION: HomeLoginAssertionV1 = {
    v: 1,
    purpose: 'happier.home-login',
    issuerServerIdentityId: 'srv_dir_1',
    issuerSubjectId: 'account-1',
    audienceHomeServerIdentityId: 'srv_home_b',
    credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(HOME_B.connectionDescriptor),
    clientBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    issuedAtMs: Date.now() - 1_000,
    expiresAtMs: Date.now() + 120_000,
    keyId: 'a'.repeat(64),
    signatureBase64Url: 'A'.repeat(86),
};

function assertionForHome(home: AccountDirectoryHomeEntryV1): HomeLoginAssertionV1 {
    return {
        ...ASSERTION,
        audienceHomeServerIdentityId: home.homeServerIdentityId,
        credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(
            home.connectionDescriptor,
        ),
    };
}

describe('Home login approval continuation (explicit target, Home-authoritative)', () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    beforeEach(() => {
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features' || path === '/v1/features/authenticated') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    homeConnectionDescriptor: HOME_B.connectionDescriptor,
                });
            }
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);
        reconcileServerProfileHomeConnectionDescriptorMock.mockResolvedValue({
            kind: 'applied',
            profile: {
                id: 'profile-b',
                serverUrl: 'https://home-b.test',
                canonicalServerUrl: 'https://home-b.test',
                serverIdentityId: 'srv_home_b',
                source: 'account-directory',
                connectionDescriptorRevision: 1,
            },
        });
        buildHomeConnectionDescriptorForProfileMock.mockReturnValue(HOME_B.connectionDescriptor);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        endpointFetchMock.mockReset();
        createServerFetchAtEndpointMock.mockClear();
        setCredentialsForServerUrlMock.mockClear();
        getCredentialsForServerUrlMock.mockClear();
        adoptHomeProfileMock.mockClear();
        preflightHomeProfileAdoptionMock.mockClear();
        reconcileServerProfileHomeConnectionDescriptorMock.mockClear();
        buildHomeConnectionDescriptorForProfileMock.mockClear();
        directoryCredentialStorageMock.get.mockClear();
        directoryCredentialStorageMock.remove.mockClear();
        irohReleaseMock.mockClear();
        acquireIrohHomeRuntimeOriginMock.mockReset();
        acquireIrohHomeRuntimeOriginMock.mockRejectedValue(new Error('native unavailable'));
        resolveServerProfileForPortableIdentityMock.mockClear();
        resolveServerProfileScopeIdMock.mockClear();
        setActiveServerAndSwitchMock.mockClear();
        setActiveServerAndSwitchMock.mockResolvedValue('switched');
    });

    it('preserves the same assertion and approval id in an explicit resume operation', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const sealedToken = sealCredentialPayload('home-b-session-token', keyPair.publicKey);
        endpointFetchMock
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-1',
                deviceLabel: 'Phone',
                expiresAtMs: Date.now() + 60_000,
            }))
            .mockResolvedValueOnce(json(200, {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                sealedHomeTokenBase64Url: sealedToken,
                issuedAtMs: Date.now() - 500,
                expiresAtMs: Date.now() + 120_000,
            }));

        const pending = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            approvalId: 'approval-1',
        });

        expect(pending).toMatchObject({ kind: 'approval_required', approvalId: 'approval-1' });
        if (pending.kind !== 'approval_required') return;
        const result = await pending.resume();
        expect(result).toEqual({ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' });
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
        expect(endpointFetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/home-login');
        const firstBody = JSON.parse(String((endpointFetchMock.mock.calls[0]?.[1] as RequestInit).body));
        const secondBody = JSON.parse(String((endpointFetchMock.mock.calls[1]?.[1] as RequestInit).body));
        expect(firstBody.approvalId).toBe('approval-1');
        expect(firstBody.assertion).toEqual(secondBody.assertion);
        expect(secondBody.approvalId).toBe('approval-1');
        expect(adoptHomeProfileMock).toHaveBeenCalledWith(expect.objectContaining({
            descriptor: HOME_B.connectionDescriptor,
            source: 'account-directory',
            preserveUserLabel: true,
            descriptorAuthority: 'advisory',
        }));
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledWith(
            'https://home-b.test',
            { serverId: 'srv_home_b' },
            { token: 'home-b-session-token' },
        );
    });

    it('rejects a conflicting authenticated descriptor before credential persistence', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const advisoryHome = {
            ...HOME_B,
            canonicalServerUrl: 'https://directory-advisory-route.test',
            connectionDescriptor: {
                ...HOME_B.connectionDescriptor,
                canonicalServerUrl: 'https://directory-advisory-route.test',
                revision: 99,
                endpoints: [{ kind: 'https' as const, url: 'https://directory-advisory-route.test' }],
            },
        };
        const assertion = {
            ...ASSERTION,
            credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(
                advisoryHome.connectionDescriptor,
            ),
        };
        const authenticatedDescriptor = {
            ...HOME_B.connectionDescriptor,
            revision: 100,
            endpoints: [{
                kind: 'iroh' as const,
                endpointId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            }],
        };
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    homeConnectionDescriptor: {
                        ...advisoryHome.connectionDescriptor,
                        revision: 100,
                    },
                });
            }
            if (path === '/v1/features/authenticated') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    homeConnectionDescriptor: authenticatedDescriptor,
                });
            }
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealCredentialPayload(
                'home-selected-token',
                keyPair.publicKey,
            ),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));
        preflightHomeProfileAdoptionMock.mockReturnValueOnce({
            canonicalServerUrl: 'https://home-b.test',
            serverIdentityId: 'srv_home_b',
            credentialWrite: 'preserveExisting',
        });

        await expect(continueHomeLoginEnrollment({
            home: advisoryHome,
            clientSecretKey: keyPair.privateKey,
            assertion,
        })).resolves.toEqual({ kind: 'failed' });

        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'https://directory-advisory-route.test',
        }));
        expect(reconcileServerProfileHomeConnectionDescriptorMock).not.toHaveBeenCalled();
        expect(endpointFetchMock).toHaveBeenCalledOnce();
        expect(preflightHomeProfileAdoptionMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('rejects an assertion whose signed destination does not match the exact Directory entry before transport', async () => {
        const keyPair = sodium.crypto_box_keypair();

        await expect(continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: {
                ...ASSERTION,
                credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1({
                    ...HOME_B.connectionDescriptor,
                    canonicalServerUrl: 'https://attacker.test',
                    endpoints: [{ kind: 'https', url: 'https://attacker.test' }],
                }),
            },
        })).resolves.toEqual({ kind: 'failed' });

        expect(createServerFetchAtEndpointMock).not.toHaveBeenCalled();
        expect(acquireIrohHomeRuntimeOriginMock).not.toHaveBeenCalled();
        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('preserves Directory authentication and returns an explicit retry when Home observation is unavailable', async () => {
        const keyPair = sodium.crypto_box_keypair();
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features') return json(503, { error: 'temporarily_unavailable' });
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);

        const unavailable = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(unavailable).toMatchObject({
            kind: 'transport_unavailable',
            reason: 'home_observation_unavailable',
            resume: expect.any(Function),
            cancel: expect.any(Function),
        });
        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(reconcileServerProfileHomeConnectionDescriptorMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(directoryCredentialStorageMock.remove).not.toHaveBeenCalled();

        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features' || path === '/v1/features/authenticated') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    homeConnectionDescriptor: HOME_B.connectionDescriptor,
                });
            }
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealCredentialPayload('home-b-retried-token', keyPair.publicKey),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));
        if (unavailable.kind !== 'transport_unavailable' || !unavailable.resume) return;

        await expect(unavailable.resume()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(directoryCredentialStorageMock.remove).not.toHaveBeenCalled();
    });

    it('retains an unavailable Home observation when the initiating screen unmounts during the probe', async () => {
        const keyPair = sodium.crypto_box_keypair();
        let initiatingScreenCancelled = false;
        let releaseObservation!: () => void;
        const observationGate = new Promise<void>((resolve) => {
            releaseObservation = resolve;
        });
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features' || path === '/v1/features/authenticated') {
                await observationGate;
                return json(503, { error: 'temporarily_unavailable' });
            }
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);

        const enrollment = continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            shouldCancel: () => initiatingScreenCancelled,
        });
        await vi.waitFor(() => expect(createServerFetchAtEndpointMock).toHaveBeenCalledOnce());
        initiatingScreenCancelled = true;
        releaseObservation();

        await expect(enrollment).resolves.toMatchObject({
            kind: 'transport_unavailable',
            reason: 'home_observation_unavailable',
            resume: expect.any(Function),
            cancel: expect.any(Function),
        });
        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('fails closed before redemption when the observed Home identity differs from the selected target', async () => {
        const keyPair = sodium.crypto_box_keypair();
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_attacker' } },
                    homeConnectionDescriptor: {
                        ...HOME_B.connectionDescriptor,
                        homeServerIdentityId: 'srv_attacker',
                    },
                });
            }
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);

        await expect(continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        })).resolves.toEqual({ kind: 'failed' });

        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(reconcileServerProfileHomeConnectionDescriptorMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('rejects a published descriptor whose credential destination differs from the signed assertion', async () => {
        const keyPair = sodium.crypto_box_keypair();
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    homeConnectionDescriptor: {
                        ...HOME_B.connectionDescriptor,
                        canonicalServerUrl: 'https://attacker.test',
                        endpoints: [{ kind: 'https', url: 'https://attacker.test' }],
                    },
                });
            }
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);

        await expect(continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        })).resolves.toEqual({ kind: 'failed' });

        expect(reconcileServerProfileHomeConnectionDescriptorMock).not.toHaveBeenCalled();
        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('does not redeem after cancellation arrives while Home observation is pending', async () => {
        const keyPair = sodium.crypto_box_keypair();
        let cancelled = false;
        let finishObservation!: () => void;
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path !== '/v1/features') return await endpointFetchMock(path, ...args);
            await new Promise<void>((resolve) => {
                finishObservation = resolve;
            });
            return json(200, {
                features: {},
                capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                homeConnectionDescriptor: HOME_B.connectionDescriptor,
            });
        }) as typeof endpointFetchMock);
        endpointFetchMock.mockResolvedValueOnce(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'must-not-be-created',
            deviceLabel: null,
            expiresAtMs: Date.now() + 60_000,
        }));

        const result = continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            shouldCancel: () => cancelled,
        });
        await vi.waitFor(() => {
            expect(createServerFetchAtEndpointMock).toHaveBeenCalledTimes(1);
        });
        cancelled = true;
        finishObservation();

        await expect(result).resolves.toEqual({ kind: 'cancelled' });
        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('keeps a Home approval continuation resumable after its initiating screen unmounts', async () => {
        const keyPair = sodium.crypto_box_keypair();
        let initiatingScreenCancelled = false;
        endpointFetchMock
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-screen-transition',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            }))
            .mockResolvedValueOnce(json(200, {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                sealedHomeTokenBase64Url: sealCredentialPayload('home-b-screen-transition-token', keyPair.publicKey),
                issuedAtMs: Date.now() - 500,
                expiresAtMs: Date.now() + 120_000,
            }));

        const pending = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            shouldCancel: () => initiatingScreenCancelled,
        });
        expect(pending.kind).toBe('approval_required');
        if (pending.kind !== 'approval_required') return;

        initiatingScreenCancelled = true;
        await expect(pending.resume()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
    });

    it('publishes the detached approval continuation when initiating cancellation flips after redemption resolves', async () => {
        const keyPair = sodium.crypto_box_keypair();
        let initiatingScreenCancelled = false;
        endpointFetchMock.mockImplementationOnce(async () => {
            initiatingScreenCancelled = true;
            return json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-publication-race',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            });
        });

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            shouldCancel: () => initiatingScreenCancelled,
        });

        expect(result).toMatchObject({
            kind: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-publication-race',
        });
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('redeems and stores a destination-bound credential through the selected Iroh EndpointId', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const endpointId = 'a'.repeat(64);
        acquireIrohHomeRuntimeOriginMock.mockResolvedValueOnce({
            leaseId: 'lease-home-b',
            status: 'ready',
            homeServerIdentityId: 'srv_home_b',
            runtimeOrigin: 'http://127.0.0.1:45991',
            endpointId,
            release: irohReleaseMock,
        });
        const home = {
            ...HOME_B,
            connectionDescriptor: {
                ...HOME_B.connectionDescriptor,
                canonicalServerUrl: 'http://localhost:3010',
                endpoints: [{ kind: 'iroh' as const, endpointId }],
            },
        };
        buildHomeConnectionDescriptorForProfileMock.mockReturnValueOnce(home.connectionDescriptor);
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features' || path === '/v1/features/authenticated') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    homeConnectionDescriptor: home.connectionDescriptor,
                });
            }
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealCredentialPayload('home-b-iroh-token', keyPair.publicKey),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home,
            clientSecretKey: keyPair.privateKey,
            assertion: assertionForHome(home),
        });

        expect(result).toEqual({ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' });
        expect(acquireIrohHomeRuntimeOriginMock).toHaveBeenCalledTimes(1);
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'http://localhost:3010',
            runtimeOrigin: 'http://127.0.0.1:45991',
            serverId: 'srv_home_b',
        }));
        expect(endpointFetchMock).toHaveBeenCalledOnce();
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledWith(
            'http://localhost:3010',
            { serverId: 'srv_home_b' },
            { token: 'home-b-iroh-token' },
        );
    });

    it('releases a transport acquired after the enrollment attempt was cancelled', async () => {
        const keyPair = sodium.crypto_box_keypair();
        let cancelled = false;
        const home = {
            ...HOME_B,
            connectionDescriptor: {
                ...HOME_B.connectionDescriptor,
                canonicalServerUrl: 'http://localhost:3010',
                endpoints: [{ kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
            },
        };
        const acquisition = {
            finish: null as ((lease: {
                leaseId: string;
                status: 'ready';
                homeServerIdentityId: string;
                runtimeOrigin: string;
                endpointId: string;
                release: typeof irohReleaseMock;
            }) => void) | null,
        };
        acquireIrohHomeRuntimeOriginMock.mockImplementationOnce(async () => await new Promise((resolve) => {
            acquisition.finish = resolve;
        }));

        const resultPromise = continueHomeLoginEnrollment({
            home,
            clientSecretKey: keyPair.privateKey,
            assertion: assertionForHome(home),
            shouldCancel: () => cancelled,
        });

        await vi.waitFor(() => expect(acquisition.finish).not.toBeNull());
        cancelled = true;
        acquisition.finish?.({
            leaseId: 'lease-cancelled-after-acquire',
            status: 'ready',
            homeServerIdentityId: 'srv_home_b',
            runtimeOrigin: 'http://127.0.0.1:45991',
            endpointId: 'a'.repeat(64),
            release: irohReleaseMock,
        });

        await expect(resultPromise).resolves.toEqual({ kind: 'cancelled' });
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
        expect(endpointFetchMock).not.toHaveBeenCalled();
    });

    it('reports failure without profile adoption when explicit-target credential storage fails', async () => {
        const keyPair = sodium.crypto_box_keypair();
        setCredentialsForServerUrlMock.mockResolvedValueOnce(false);
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealCredentialPayload('home-b-session-token', keyPair.publicKey),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            approvalId: 'approval-storage-failure',
        });

        expect(result).toEqual({ kind: 'failed' });
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('does not persist a Home credential when authenticated descriptor observation is unavailable', async () => {
        const keyPair = sodium.crypto_box_keypair();
        createServerFetchAtEndpointMock.mockImplementation(() => (async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    homeConnectionDescriptor: HOME_B.connectionDescriptor,
                });
            }
            if (path === '/v1/features/authenticated') return json(503, { error: 'temporarily_unavailable' });
            return await endpointFetchMock(path, ...args);
        }) as typeof endpointFetchMock);
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealCredentialPayload('home-b-stored-token', keyPair.publicKey),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });
        expect(result).toMatchObject({
            kind: 'transport_unavailable',
            reason: 'home_observation_unavailable',
        });
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(reconcileServerProfileHomeConnectionDescriptorMock).not.toHaveBeenCalled();
    });

    it('preserves target and rollback uncertainty for a partial credential/adoption commit', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const adoptionError = new Error('profile adoption failed');
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealCredentialPayload('partially-stored-token', keyPair.publicKey),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));
        adoptHomeProfileMock.mockRejectedValueOnce(adoptionError);
        setCredentialsForServerUrlMock.mockResolvedValueOnce({
            rollback: async () => false,
        } as never);

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({
            kind: 'partial_commit',
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'https://home-b.test',
            adoptionError,
            rollbackOutcome: { kind: 'not_applied', reason: 'ownership_changed' },
        });
        expect(result).not.toEqual({ kind: 'failed' });
    });

    it('never sends Account Service credentials and never stores a token while approval is still pending', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValue(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-2',
            deviceLabel: 'Phone',
            expiresAtMs: Date.now() + 40_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            approvalId: 'approval-2',
            approvalExpiresAtMs: Date.now() + 40_000,
        });

        expect(result).toMatchObject({ kind: 'approval_required', approvalId: 'approval-2' });
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        // Redemption at the target Home must never carry Account Service credentials.
        for (const call of createServerFetchAtEndpointMock.mock.calls) {
            expect(call[0]).toMatchObject({ credentials: null });
        }
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails closed when the sealed token names a different Home than the target descriptor', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_other',
            sealedHomeTokenBase64Url: sealCredentialPayload('other-home-token', keyPair.publicKey),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            approvalId: 'approval-3',
        });

        expect(result.kind).toBe('failed');
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('fails closed when the sealed token cannot be opened by this client key', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const otherKey = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealCredentialPayload('token-for-someone-else', otherKey.publicKey),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            approvalId: 'approval-4',
        });

        expect(result.kind).toBe('failed');
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('retains assertion and key across an initial transient redemption until one explicit resume', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(200, {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                sealedHomeTokenBase64Url: sealCredentialPayload('home-b-after-initial-retry', keyPair.publicKey),
                issuedAtMs: Date.now() - 500,
                expiresAtMs: Date.now() + 120_000,
            }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toMatchObject({
            kind: 'transport_unavailable',
            reason: 'request_failed',
            resume: expect.any(Function),
            cancel: expect.any(Function),
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        if (result.kind !== 'transport_unavailable' || !result.resume) return;

        await expect(result.resume()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
        const firstBody = JSON.parse(String((endpointFetchMock.mock.calls[0]?.[1] as RequestInit).body));
        const secondBody = JSON.parse(String((endpointFetchMock.mock.calls[1]?.[1] as RequestInit).body));
        expect(secondBody.assertion).toEqual(firstBody.assertion);
    });

    it('single-flights concurrent resume calls for one retained initial attempt', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const redemption = { release: null as (() => void) | null };
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockImplementationOnce(async () => {
                await new Promise<void>((resolve) => { redemption.release = resolve; });
                return json(202, {
                    v: 1,
                    outcome: 'approval_required',
                    homeServerIdentityId: 'srv_home_b',
                    approvalId: 'approval-single-flight',
                    deviceLabel: 'Phone',
                    expiresAtMs: Date.now() + 60_000,
                });
            });

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });
        if (result.kind !== 'transport_unavailable' || !result.resume) {
            throw new Error('expected a resumable transient continuation');
        }

        const firstResume = result.resume();
        const secondResume = result.resume();
        expect(secondResume).toBe(firstResume);
        await vi.waitFor(() => expect(endpointFetchMock).toHaveBeenCalledTimes(2));
        redemption.release?.();
        await expect(firstResume).resolves.toMatchObject({
            kind: 'approval_required',
            approvalId: 'approval-single-flight',
        });
        await expect(secondResume).resolves.toMatchObject({
            kind: 'approval_required',
            approvalId: 'approval-single-flight',
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps an initial transient continuation resumable after its initiating screen unmounts', async () => {
        const keyPair = sodium.crypto_box_keypair();
        let initiatingScreenCancelled = false;
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(200, {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                sealedHomeTokenBase64Url: sealCredentialPayload('home-b-after-unmount', keyPair.publicKey),
                issuedAtMs: Date.now() - 500,
                expiresAtMs: Date.now() + 120_000,
            }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            shouldCancel: () => initiatingScreenCancelled,
        });
        expect(result).toMatchObject({ kind: 'transport_unavailable', reason: 'request_failed' });
        if (result.kind !== 'transport_unavailable' || !result.resume) return;

        initiatingScreenCancelled = true;
        await expect(result.resume()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
    });

    it('stops a detached initial transient continuation through its own cancel owner', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(200, {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                sealedHomeTokenBase64Url: sealCredentialPayload('must-not-be-consumed', keyPair.publicKey),
                issuedAtMs: Date.now() - 500,
                expiresAtMs: Date.now() + 120_000,
            }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });
        if (result.kind !== 'transport_unavailable' || !result.resume || !result.cancel) {
            throw new Error('expected a resumable transient continuation');
        }

        await expect(result.cancel()).resolves.toEqual({ kind: 'cancelled' });
        await expect(result.resume()).resolves.toEqual({ kind: 'cancelled' });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('retains approval state across a transient resume and retries through a fresh transport', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-transient',
                deviceLabel: 'Phone',
                expiresAtMs: Date.now() + 60_000,
            }))
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(200, {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                sealedHomeTokenBase64Url: sealCredentialPayload('home-b-after-retry', keyPair.publicKey),
                issuedAtMs: Date.now() - 500,
                expiresAtMs: Date.now() + 120_000,
            }));

        const first = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });
        expect(first).toMatchObject({ kind: 'approval_required', approvalId: 'approval-transient' });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        if (first.kind !== 'approval_required') return;

        const second = await first.resume();
        expect(second).toMatchObject({ kind: 'transport_unavailable', resume: expect.any(Function) });
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
        if (second.kind !== 'transport_unavailable' || !second.resume) return;

        await expect(second.resume()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(3);
        const firstBody = JSON.parse(String((endpointFetchMock.mock.calls[0]?.[1] as RequestInit).body));
        const secondBody = JSON.parse(String((endpointFetchMock.mock.calls[1]?.[1] as RequestInit).body));
        const thirdBody = JSON.parse(String((endpointFetchMock.mock.calls[2]?.[1] as RequestInit).body));
        expect(secondBody.assertion).toEqual(firstBody.assertion);
        expect(thirdBody).toEqual(secondBody);
    });

    it('does not retry a terminal Home rejection', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock
            .mockResolvedValueOnce(json(403, { error: 'approval_rejected' }))
            .mockResolvedValueOnce(json(200, {
                v: 1,
                homeServerIdentityId: 'srv_home_b',
                sealedHomeTokenBase64Url: sealCredentialPayload('must-not-be-consumed', keyPair.publicKey),
                issuedAtMs: Date.now() - 500,
                expiresAtMs: Date.now() + 120_000,
            }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            approvalId: 'approval-terminal',
        });

        expect(result).toEqual({ kind: 'rejected' });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it.each([
        ['approval_expired', 'expired'],
        ['approval_invalid', 'failed'],
        ['invalid_audience', 'failed'],
    ] as const)('maps terminal %s without retry or credential mutation', async (error, kind) => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock
            .mockResolvedValueOnce(json(401, { error }))
            .mockResolvedValueOnce(json(200, { unexpected: true }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            approvalId: 'approval-terminal',
        });

        expect(result).toEqual({ kind });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(directoryCredentialStorageMock.remove).not.toHaveBeenCalled();
    });

    it('does not classify an arbitrary error containing expired as protocol expiry', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(401, { error: 'attacker_controlled_expired' }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({ kind: 'failed' });
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('resumes a preferred-directory enrollment that returned approval_required', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const sealedToken = sealCredentialPayload('home-b-resumed-token', keyPair.publicKey);
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);

        // Assertion request against the Account Service endpoint.
        endpointFetchMock.mockImplementationOnce(async (_path: string, init: RequestInit) => {
            const request = JSON.parse(String(init.body)) as { clientBoxPublicKeyBase64: string };
            return json(200, {
                ...ASSERTION,
                clientBoxPublicKeyBase64: request.clientBoxPublicKeyBase64,
            });
        });
        // First redemption: approval required.
        endpointFetchMock.mockResolvedValueOnce(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-8',
            deviceLabel: 'Phone',
            expiresAtMs: Date.now() + 60_000,
        }));

        const sessionSnapshot = {
            serviceKey: 'https://directory.test\u0000srv_dir_1',
            supportsHomeEnrollment: true,
            snapshot: {
                endpoint: 'https://directory.test',
                status: 'ready' as const,
                homes: [{ ...HOME_B, preferred: true }],
                preferredHomeServerIdentityId: 'srv_home_b',
                refreshedAtMs: Date.now(),
                error: null,
                reconciliation: { kind: 'not_run' as const },
            },
            requestLoginAssertion: async (homeServerIdentityId: string, clientBoxPublicKeyBase64: string) => (
                await createAccountDirectoryClient({ endpoint: 'https://directory.test', serverIdentityId: 'srv_dir_1' }).requestLoginAssertion(
                    homeServerIdentityId,
                    { clientBoxPublicKeyBase64 },
                )
            ),
        };

        const first = await enrollPreferredDirectoryHome(sessionSnapshot, { entryIntent: 'enter_preferred_home' });
        expect(first).toMatchObject({
            kind: 'approval_required',
            approvalId: 'approval-8',
            entryIntent: 'enter_preferred_home',
        });
        const assertionRequest = JSON.parse(String((endpointFetchMock.mock.calls[0]?.[1] as RequestInit).body));
        expect(assertionRequest.clientBoxPublicKeyBase64).toMatch(/^[A-Za-z0-9+/]{43}=$/);

        if (first.kind !== 'approval_required') return;

        // Resume: retry the same assertion + approval id at the target Home.
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealedToken,
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const resumed = await resumePendingPreferredHomeEnrollment();
        expect(resumed).toEqual({ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' });
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledWith(
            'https://home-b.test',
            { serverId: 'srv_home_b' },
            { token: 'home-b-resumed-token' },
        );
        expect(setActiveServerAndSwitchMock).toHaveBeenCalledWith({
            serverId: 'srv_home_b',
            scope: 'tab',
        });
    });

    it('retains an initial transient only for its exact Account Service and Home', async () => {
        await cancelPendingPreferredHomeEnrollment();
        const assertionRequests: string[] = [];
        const createSession = (serviceKey: string) => ({
            serviceKey,
            supportsHomeEnrollment: true,
            snapshot: {
                endpoint: 'https://directory.test',
                status: 'ready' as const,
                homes: [{ ...HOME_B, preferred: true }],
                preferredHomeServerIdentityId: HOME_B.homeServerIdentityId,
                refreshedAtMs: Date.now(),
                error: null,
                reconciliation: { kind: 'not_run' as const },
            },
            requestLoginAssertion: async (_homeServerIdentityId: string, clientBoxPublicKeyBase64: string) => {
                assertionRequests.push(serviceKey);
                return {
                    ...ASSERTION,
                    issuerServerIdentityId: serviceKey.slice(serviceKey.lastIndexOf('\u0000') + 1),
                    clientBoxPublicKeyBase64,
                };
            },
        });
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }));

        const first = await enrollPreferredDirectoryHome(
            createSession('https://directory-one.test\u0000srv_dir_1'),
            { entryIntent: 'enter_preferred_home' },
        );
        expect(first).toMatchObject({
            kind: 'transport_unavailable',
            serviceKey: 'https://directory-one.test\u0000srv_dir_1',
            entryIntent: 'enter_preferred_home',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(getPendingPreferredHomeEnrollment()).toBe(first);

        const reused = await enrollPreferredDirectoryHome(
            createSession('https://directory-one.test\u0000srv_dir_1'),
            { entryIntent: 'enter_preferred_home' },
        );
        expect(reused).toBe(first);
        expect(assertionRequests).toEqual(['https://directory-one.test\u0000srv_dir_1']);

        const replacement = await enrollPreferredDirectoryHome(
            createSession('https://directory-two.test\u0000srv_dir_2'),
            { entryIntent: 'connect_service' },
        );
        expect(replacement).toMatchObject({
            kind: 'transport_unavailable',
            serviceKey: 'https://directory-two.test\u0000srv_dir_2',
            entryIntent: 'connect_service',
        });
        expect(assertionRequests).toEqual([
            'https://directory-one.test\u0000srv_dir_1',
            'https://directory-two.test\u0000srv_dir_2',
        ]);
        if (first.kind !== 'transport_unavailable' || !first.resume) return;
        await expect(first.resume()).resolves.toEqual({ kind: 'cancelled' });
        await cancelPendingPreferredHomeEnrollment();
    });

    it('returns a typed transport blocker for an Iroh-only non-focused Home', async () => {
        acquireIrohHomeRuntimeOriginMock.mockRejectedValueOnce(
            Object.assign(new Error('native unavailable'), { name: 'IrohError', code: 'unavailable' }),
        );
        const keyPair = sodium.crypto_box_keypair();
        const home = {
            ...HOME_B,
            connectionDescriptor: {
                ...HOME_B.connectionDescriptor,
                endpoints: [{ kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
            },
        };
        const result = await continueHomeLoginEnrollment({
            home,
            clientSecretKey: keyPair.privateKey,
            assertion: assertionForHome(home),
        });

        expect(result).toMatchObject({
            kind: 'transport_unavailable',
            reason: 'iroh_transport_unavailable',
            resume: expect.any(Function),
            cancel: expect.any(Function),
        });
        expect(createServerFetchAtEndpointMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('propagates a failed-closed Iroh transport reason without collapsing it', async () => {
        acquireIrohHomeRuntimeOriginMock.mockRejectedValueOnce(
            Object.assign(new Error('identity mismatch'), { name: 'IrohError', code: 'identity_mismatch' }),
        );
        const keyPair = sodium.crypto_box_keypair();
        const home = {
            ...HOME_B,
            connectionDescriptor: {
                ...HOME_B.connectionDescriptor,
                endpoints: [
                    { kind: 'iroh' as const, endpointId: 'a'.repeat(64) },
                    { kind: 'https' as const, url: 'https://home-b.test' },
                ],
            },
        };

        const result = await continueHomeLoginEnrollment({
            home,
            clientSecretKey: keyPair.privateKey,
            assertion: assertionForHome(home),
        });

        expect(result).toEqual({
            kind: 'transport_unavailable',
            reason: 'iroh_transport_failed_closed',
        });
        expect(endpointFetchMock).not.toHaveBeenCalled();
    });

    it('rejects malformed UTF-8 token bytes before persistence', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: encodeBase64(
                // A non-fatal decoder would replace 0xff and leave valid JSON.
                encryptBox(new Uint8Array([
                    0x7b, 0x22, 0x74, 0x6f, 0x6b, 0x65, 0x6e,
                    0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d,
                ]), keyPair.publicKey),
                'base64url',
            ),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({ kind: 'failed' });
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('fails closed on a legacy credential wrapper with zero credential write or profile mutation', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealLegacyCredentialPayload(
                { credentials: { token: 'legacy-wrapped-token' } },
                keyPair.publicKey,
            ),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({ kind: 'failed' });
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(preflightHomeProfileAdoptionMock).not.toHaveBeenCalled();
    });

    it('rejects an unbound legacy credential envelope before persistence', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealLegacyCredentialPayload(
                { token: 'legacy-token', secret: 'legacy-secret' },
                keyPair.publicKey,
            ),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({ kind: 'failed' });
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it.each([
        ['data-key credentials', {
            v: 1,
            credentials: {
                token: 'forged-home-token',
                encryption: { publicKey: 'forged-public-key', machineKey: 'forged-machine-key' },
            },
            connectionDescriptor: HOME_B.connectionDescriptor,
        }],
        ['an unknown field', {
            v: 1,
            credentials: { token: 'forged-home-token' },
            connectionDescriptor: HOME_B.connectionDescriptor,
            futureAuthority: true,
        }],
    ])('rejects sealed %s at the coupled redemption boundary', async (_label, payload) => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealLegacyCredentialPayload(payload, keyPair.publicKey),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({ kind: 'failed' });
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('keeps the sealed token bounded and fails closed on oversized material', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: encodeBase64(
                new Uint8Array(ACCOUNT_DIRECTORY_MAX_SEALED_TOKEN_BYTES + 1).fill(1),
                'base64url',
            ),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
            approvalId: 'approval-9',
        });

        expect(result.kind).toBe('failed');
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('fails closed when decrypted credential plaintext exceeds the protocol bound', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealLegacyCredentialPayload(
                { token: 't'.repeat(ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_CREDENTIAL_PLAINTEXT_BYTES) },
                keyPair.publicKey,
            ),
            issuedAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 120_000,
        }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result.kind).toBe('failed');
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });
});
