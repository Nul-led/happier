import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { encodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import type { AccountDirectoryHomeEntryV1, HomeLoginAssertionV1 } from '@/sync/api/accountDirectory/accountDirectoryClient';
import {
    enrollPreferredDirectoryHome,
    cancelPendingPreferredHomeEnrollment,
    getPendingPreferredHomeEnrollment,
    resumePendingPreferredHomeEnrollment,
} from './enrollPreferredDirectoryHome';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const irohReleaseMock = vi.hoisted(() => vi.fn(async () => {}));
const acquireIrohHomeRuntimeOriginMock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{
    leaseId: string;
    runtimeOrigin: string;
    release: () => Promise<void>;
}>>(async () => ({
    leaseId: 'lease-home-b',
    runtimeOrigin: 'http://127.0.0.1:45991',
    release: irohReleaseMock,
})));
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: vi.fn(() => endpointFetchMock),
    serverFetch: vi.fn(),
}));
vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({
    acquireIrohHomeRuntimeOrigin: (input: unknown) => acquireIrohHomeRuntimeOriginMock(input),
}));

const setCredentialsForServerUrlMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<{ rollback: () => Promise<void> }>
>(async () => ({ rollback: async () => {} })));
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
}>(() => ({
    canonicalServerUrl: 'https://home-b.test',
    serverIdentityId: 'srv_home_b',
})));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    adoptHomeProfile: (...args: unknown[]) => adoptHomeProfileMock(...args),
    preflightHomeProfileAdoption: (...args: unknown[]) => preflightHomeProfileAdoptionMock(...args),
}));

const HOME_B: AccountDirectoryHomeEntryV1 = {
    v: 1,
    homeServerIdentityId: 'srv_home_b',
    canonicalServerUrl: 'https://home-b.test',
    label: 'Home B',
    preferred: true,
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
    clientBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    issuedAtMs: Date.now() - 1_000,
    expiresAtMs: Date.now() + 120_000,
    keyId: 'a'.repeat(64),
    signatureBase64Url: 'A'.repeat(86),
};

function json(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function sealToken(token: string, recipientPublicKey: Uint8Array): string {
    return encodeBase64(
        encryptBox(
            new TextEncoder().encode(JSON.stringify({
                token,
            })),
            recipientPublicKey,
        ),
        'base64url',
    );
}

function authorizedResponse(recipientPublicKey: Uint8Array): Response {
    return json(200, {
        v: 1,
        homeServerIdentityId: 'srv_home_b',
        sealedHomeTokenBase64Url: sealToken('home-b-token', recipientPublicKey),
        issuedAtMs: Date.now() - 500,
        expiresAtMs: Date.now() + 120_000,
    });
}

/** Test harness stub for the Account Service session; assertion minting is not under test here. */
function makeSession(
    home: AccountDirectoryHomeEntryV1 = HOME_B,
): Parameters<typeof enrollPreferredDirectoryHome>[0] {
    return {
        serviceKey: 'https://directory.test\u0000srv_dir_1',
        supportsHomeEnrollment: true,
        snapshot: {
            endpoint: 'https://directory.test',
            status: 'ready' as const,
            homes: [home],
            preferredHomeServerIdentityId: home.homeServerIdentityId,
            refreshedAtMs: Date.now(),
            error: null,
            reconciliation: { kind: 'not_run' },
        },
        requestLoginAssertion: async () => ({ ...ASSERTION }),
    };
}

describe('enrollPreferredDirectoryHome requester continuation', () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        endpointFetchMock.mockReset();
        irohReleaseMock.mockClear();
        acquireIrohHomeRuntimeOriginMock.mockClear();
        setCredentialsForServerUrlMock.mockClear();
        adoptHomeProfileMock.mockClear();
        preflightHomeProfileAdoptionMock.mockClear();
    });

    it('closes a transient Iroh attempt without projecting a general continuation', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock.mockResolvedValueOnce(json(503, { error: 'home_unavailable' }));

        const enrollment = await enrollPreferredDirectoryHome(makeSession({
            ...HOME_B,
            connectionDescriptor: {
                ...HOME_B.connectionDescriptor,
                canonicalServerUrl: 'http://localhost:3010',
                endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
            },
        }));

        expect(enrollment).toEqual({ kind: 'failed' });
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
        expect(acquireIrohHomeRuntimeOriginMock).toHaveBeenCalledTimes(1);
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('runs at most one resume at a time and shares the in-flight continuation with concurrent callers', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock.mockResolvedValueOnce(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-resume-single-flight',
            deviceLabel: 'Phone',
            expiresAtMs: Date.now() + 60_000,
        }));

        const enrollment = await enrollPreferredDirectoryHome(makeSession());
        expect(enrollment.kind).toBe('approval_required');
        expect(getPendingPreferredHomeEnrollment()).toMatchObject({
            serviceKey: 'https://directory.test\u0000srv_dir_1',
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);

        let release!: (response: Response) => void;
        const gated = new Promise<Response>((resolve) => {
            release = resolve;
        });
        endpointFetchMock.mockReturnValueOnce(gated);
        const first = resumePendingPreferredHomeEnrollment();
        const second = resumePendingPreferredHomeEnrollment();
        release(authorizedResponse(keyPair.publicKey));
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult).toEqual({ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' });
        expect(secondResult).toEqual(firstResult);
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
    });

    it('returns the retained pending continuation instead of cancelling it and starting a competing enrollment', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock.mockResolvedValueOnce(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-retained',
            deviceLabel: null,
            expiresAtMs: Date.now() + 60_000,
        }));

        const first = await enrollPreferredDirectoryHome(makeSession());
        const retained = await enrollPreferredDirectoryHome(makeSession());

        expect(retained).toBe(getPendingPreferredHomeEnrollment());
        expect(retained).toBe(first);
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
    });

    it('stop waiting cancels the retained continuation and prevents a late response from persisting or publishing', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock.mockResolvedValueOnce(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-cancel-late',
            deviceLabel: 'Phone',
            expiresAtMs: Date.now() + 60_000,
        }));
        await enrollPreferredDirectoryHome(makeSession());

        let release!: (response: Response) => void;
        endpointFetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));
        const resume = resumePendingPreferredHomeEnrollment();
        await cancelPendingPreferredHomeEnrollment();
        release(authorizedResponse(keyPair.publicKey));

        await expect(resume).resolves.toEqual({ kind: 'cancelled' });
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
    });
});
