import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { encodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import { createAccountDirectoryClient, type AccountDirectoryHomeEntryV1, type HomeLoginAssertionV1 } from '@/sync/api/accountDirectory/accountDirectoryClient';
import {
    continueHomeLoginEnrollment,
} from './homeLoginApproval';
import { enrollPreferredDirectoryHome } from './enrollPreferredDirectoryHome';
import {
    ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_CREDENTIAL_PLAINTEXT_BYTES,
    ACCOUNT_DIRECTORY_MAX_SEALED_TOKEN_BYTES,
} from '@happier-dev/protocol';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointMock = vi.hoisted(() => vi.fn(() => endpointFetchMock));
const irohReleaseMock = vi.hoisted(() => vi.fn(async () => {}));
const acquireIrohHomeRuntimeOriginMock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<unknown>>(async () => {
    throw new Error('native unavailable');
}));

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (...args: unknown[]) => createServerFetchAtEndpointMock(...args),
    serverFetch: vi.fn(),
}));

vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    acquireIrohHomeRuntimeOrigin: (input: unknown) => acquireIrohHomeRuntimeOriginMock(input),
}));

const setCredentialsForServerUrlMock = vi.hoisted(() => vi.fn(async () => ({
    rollback: vi.fn(async () => {}),
})));
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn(async () => ({ token: 'home-a-full-credential' })));

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

const adoptHomeProfileMock = vi.hoisted(() => vi.fn(async () => ({
    id: 'profile-b',
    serverUrl: 'https://home-b.test',
    serverIdentityId: 'srv_home_b',
})));
const preflightHomeProfileAdoptionMock = vi.hoisted(() => vi.fn(() => ({
    canonicalServerUrl: 'https://home-b.test',
    serverIdentityId: 'srv_home_b',
})));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    adoptHomeProfile: (...args: unknown[]) => adoptHomeProfileMock(...args),
    preflightHomeProfileAdoption: (...args: unknown[]) => preflightHomeProfileAdoptionMock(...args),
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

function sealCredentials(token: string, recipientPublicKey: Uint8Array): string {
    return encodeBase64(
        encryptBox(new TextEncoder().encode(JSON.stringify({ token })), recipientPublicKey),
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
    homeServerIdentityId: 'srv_home_b',
    label: 'Home B',
    preferred: false,
    connectionDescriptor: {
        v: 1,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://home-b.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home-b.test' }],
    },
};

const ASSERTION: HomeLoginAssertionV1 = {
    v: 1,
    purpose: 'happier.home-login',
    issuerServerIdentityId: 'srv_dir_1',
    issuerSubjectId: 'account-1',
    audienceHomeServerIdentityId: 'srv_home_b',
    clientBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    issuedAtMs: Date.now() - 1_000,
    expiresAtMs: Date.now() + 120_000,
    keyId: 'a'.repeat(64),
    signatureBase64Url: 'A'.repeat(86),
};

describe('Home login approval continuation (explicit target, Home-authoritative)', () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        endpointFetchMock.mockReset();
        createServerFetchAtEndpointMock.mockClear();
        createServerFetchAtEndpointMock.mockImplementation(() => endpointFetchMock);
        setCredentialsForServerUrlMock.mockClear();
        getCredentialsForServerUrlMock.mockClear();
        adoptHomeProfileMock.mockClear();
        preflightHomeProfileAdoptionMock.mockClear();
        directoryCredentialStorageMock.get.mockClear();
        irohReleaseMock.mockClear();
        acquireIrohHomeRuntimeOriginMock.mockReset();
        acquireIrohHomeRuntimeOriginMock.mockRejectedValue(new Error('native unavailable'));
    });

    it('preserves the same assertion and approval id in an explicit resume operation', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const sealedToken = sealCredentials('home-b-session-token', keyPair.publicKey);
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
            source: 'account-directory',
            preserveUserLabel: true,
        }));
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledWith(
            'https://home-b.test',
            { serverId: 'srv_home_b' },
            { token: 'home-b-session-token' },
        );
    });

    it('closes each pure-Iroh redemption transport and reacquires one for approval resume', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const sealedToken = sealCredentials('home-b-iroh-token', keyPair.publicKey);
        acquireIrohHomeRuntimeOriginMock.mockResolvedValue({
            leaseId: 'lease-home-b',
            runtimeOrigin: 'http://127.0.0.1:45991',
            release: irohReleaseMock,
        });
        endpointFetchMock
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-iroh',
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
            home: {
                ...HOME_B,
                connectionDescriptor: {
                    ...HOME_B.connectionDescriptor,
                    canonicalServerUrl: 'http://localhost:3010',
                    endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
                },
            },
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });
        expect(pending).toMatchObject({ kind: 'approval_required', approvalId: 'approval-iroh' });
        expect(acquireIrohHomeRuntimeOriginMock).toHaveBeenCalledTimes(1);
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
        expect(createServerFetchAtEndpointMock).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: 'http://localhost:3010',
            runtimeOrigin: 'http://127.0.0.1:45991',
            serverId: 'srv_home_b',
            credentials: null,
        }));

        if (pending.kind !== 'approval_required') return;
        await expect(pending.resume()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(acquireIrohHomeRuntimeOriginMock).toHaveBeenCalledTimes(2);
        expect(irohReleaseMock).toHaveBeenCalledTimes(2);
    });

    it('releases a retained pure-Iroh approval lease when the continuation is cancelled', async () => {
        const keyPair = sodium.crypto_box_keypair();
        acquireIrohHomeRuntimeOriginMock.mockResolvedValueOnce({
            leaseId: 'lease-home-b',
            runtimeOrigin: 'http://127.0.0.1:45991',
            release: irohReleaseMock,
        });
        endpointFetchMock.mockResolvedValueOnce(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-cancel',
            deviceLabel: 'Phone',
            expiresAtMs: Date.now() + 60_000,
        }));
        const pending = await continueHomeLoginEnrollment({
            home: {
                ...HOME_B,
                connectionDescriptor: {
                    ...HOME_B.connectionDescriptor,
                    canonicalServerUrl: 'http://localhost:3010',
                    endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
                },
            },
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });
        if (pending.kind !== 'approval_required') throw new Error('Expected approval continuation');
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
        await expect(pending.cancel()).resolves.toEqual({ kind: 'cancelled' });
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
    });

    it('releases a retained pure-Iroh approval lease when resume observes expiry', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const expiresAtMs = Date.now() + 5_000;
        acquireIrohHomeRuntimeOriginMock.mockResolvedValueOnce({
            leaseId: 'lease-home-b',
            runtimeOrigin: 'http://127.0.0.1:45991',
            release: irohReleaseMock,
        });
        endpointFetchMock.mockResolvedValueOnce(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-expiry',
            deviceLabel: 'Phone',
            expiresAtMs,
        }));
        const pending = await continueHomeLoginEnrollment({
            home: {
                ...HOME_B,
                connectionDescriptor: {
                    ...HOME_B.connectionDescriptor,
                    canonicalServerUrl: 'http://localhost:3010',
                    endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
                },
            },
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });
        if (pending.kind !== 'approval_required') throw new Error('Expected approval continuation');
        vi.spyOn(Date, 'now').mockReturnValue(expiresAtMs);
        await expect(pending.resume()).resolves.toEqual({ kind: 'expired' });
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports failure without profile adoption when explicit-target credential storage fails', async () => {
        const keyPair = sodium.crypto_box_keypair();
        setCredentialsForServerUrlMock.mockResolvedValueOnce(false);
        endpointFetchMock.mockResolvedValueOnce(json(200, {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            sealedHomeTokenBase64Url: sealCredentials('home-b-session-token', keyPair.publicKey),
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
            sealedHomeTokenBase64Url: sealCredentials('other-home-token', keyPair.publicKey),
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
            sealedHomeTokenBase64Url: sealCredentials('token-for-someone-else', otherKey.publicKey),
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

    it('maps an initial transient redemption to the existing failed outcome', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(503, { error: 'home_unavailable' }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({ kind: 'failed' });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('retains approval state across a transient resume and retries through a fresh transport', async () => {
        const keyPair = sodium.crypto_box_keypair();
        acquireIrohHomeRuntimeOriginMock.mockResolvedValue({
            leaseId: 'lease-home-b',
            runtimeOrigin: 'http://127.0.0.1:45991',
            release: irohReleaseMock,
        });
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
                sealedHomeTokenBase64Url: sealCredentials('home-b-after-retry', keyPair.publicKey),
                issuedAtMs: Date.now() - 500,
                expiresAtMs: Date.now() + 120_000,
            }));

        const first = await continueHomeLoginEnrollment({
            home: {
                ...HOME_B,
                connectionDescriptor: {
                    ...HOME_B.connectionDescriptor,
                    canonicalServerUrl: 'http://localhost:3010',
                    endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
                },
            },
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });
        expect(first).toMatchObject({ kind: 'approval_required', approvalId: 'approval-transient' });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
        if (first.kind !== 'approval_required') return;

        const second = await first.resume();
        expect(second).toMatchObject({ kind: 'approval_required', approvalId: 'approval-transient' });
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
        expect(irohReleaseMock).toHaveBeenCalledTimes(2);
        if (second.kind !== 'approval_required') return;

        await expect(second.resume()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(3);
        expect(acquireIrohHomeRuntimeOriginMock).toHaveBeenCalledTimes(3);
        expect(irohReleaseMock).toHaveBeenCalledTimes(3);
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
                sealedHomeTokenBase64Url: sealCredentials('must-not-be-consumed', keyPair.publicKey),
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

    it('does not classify an arbitrary error containing expired as protocol expiry', async () => {
        const keyPair = sodium.crypto_box_keypair();
        endpointFetchMock.mockResolvedValueOnce(json(401, { error: 'attacker_controlled_expired' }));

        const result = await continueHomeLoginEnrollment({
            home: HOME_B,
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({ kind: 'rejected' });
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
    });

    it('resumes a preferred-directory enrollment that returned approval_required', async () => {
        const keyPair = sodium.crypto_box_keypair();
        const sealedToken = sealCredentials('home-b-resumed-token', keyPair.publicKey);
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);

        // Assertion request against the Account Service endpoint.
        endpointFetchMock.mockResolvedValueOnce(json(200, { ...ASSERTION }));
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
            snapshot: {
                endpoint: 'https://directory.test',
                status: 'ready' as const,
                account: null,
                homes: [HOME_B],
                preferredHomeServerIdentityId: 'srv_home_b',
                refreshedAtMs: Date.now(),
                error: null,
            },
            requestLoginAssertion: async (homeServerIdentityId: string, clientBoxPublicKeyBase64: string) => (
                await createAccountDirectoryClient({ endpoint: 'https://directory.test' }).requestLoginAssertion(
                    homeServerIdentityId,
                    { clientBoxPublicKeyBase64 },
                )
            ),
        };

        const first = await enrollPreferredDirectoryHome(sessionSnapshot);
        expect(first).toMatchObject({ kind: 'approval_required', approvalId: 'approval-8' });
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

        const resumed = await first.resume();
        expect(resumed).toEqual({ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' });
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledWith(
            'https://home-b.test',
            { serverId: 'srv_home_b' },
            { token: 'home-b-resumed-token' },
        );
    });

    it('returns a typed transport blocker for an Iroh-only non-focused Home', async () => {
        acquireIrohHomeRuntimeOriginMock.mockRejectedValueOnce(
            Object.assign(new Error('native unavailable'), { name: 'IrohError', code: 'unavailable' }),
        );
        const keyPair = sodium.crypto_box_keypair();
        const result = await continueHomeLoginEnrollment({
            home: {
                ...HOME_B,
                connectionDescriptor: {
                    ...HOME_B.connectionDescriptor,
                    endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
                },
            },
            clientSecretKey: keyPair.privateKey,
            assertion: ASSERTION,
        });

        expect(result).toEqual({
            kind: 'transport_unavailable',
            reason: 'iroh_transport_unavailable',
        });
        expect(createServerFetchAtEndpointMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
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
            token: 'forged-home-token',
            encryption: { publicKey: 'forged-public-key', machineKey: 'forged-machine-key' },
        }],
        ['an unknown field', { token: 'forged-home-token', futureAuthority: true }],
    ])('rejects sealed %s at the token-only redemption boundary', async (_label, payload) => {
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

    it('fails closed when decrypted token-only credential plaintext exceeds the protocol bound', async () => {
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
