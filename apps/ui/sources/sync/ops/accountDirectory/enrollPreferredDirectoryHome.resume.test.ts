import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import sodium from '@/encryption/libsodium.lib';
import { encodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import { createHomeCredentialDestinationDigestV1 } from '@happier-dev/protocol';
import type { AccountDirectoryHomeEntryV1, HomeLoginAssertionV1 } from '@/sync/api/accountDirectory/accountDirectoryClient';
import {
    enrollPreferredDirectoryHome,
    cancelPendingPreferredHomeEnrollment,
    getPendingPreferredHomeEnrollment,
    resumePendingPreferredHomeEnrollment,
} from './enrollPreferredDirectoryHome';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointMock = vi.hoisted(() => vi.fn());
const irohReleaseMock = vi.hoisted(() => vi.fn(async () => {}));
const acquireIrohHomeRuntimeOriginMock = vi.hoisted(() => vi.fn<(input: unknown) => Promise<{
    leaseId: string;
    runtimeOrigin: string;
    endpointId: string;
    release: () => Promise<void>;
}>>(async () => ({
    leaseId: 'lease-home-b',
    runtimeOrigin: 'http://127.0.0.1:45991',
    endpointId: 'a'.repeat(64),
    release: irohReleaseMock,
})));
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (...args: unknown[]) => createServerFetchAtEndpointMock(...args),
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
const reconcileServerProfileHomeConnectionDescriptorMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{
    kind: 'applied';
    profile: {
        id: string;
        serverUrl: string;
        canonicalServerUrl: string;
        serverIdentityId: string;
        source: 'account-directory';
        connectionDescriptorRevision: number;
    };
}>>(async () => ({
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
const buildHomeConnectionDescriptorForProfileMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => AccountDirectoryHomeEntryV1['connectionDescriptor'] | null>());
const setActiveServerAndSwitchMock = vi.hoisted(() => vi.fn(async () => 'switched' as const));
const getAccountServiceEndpointSnapshotMock = vi.hoisted(() => vi.fn((): {
    url: string;
    serverIdentityId: string;
    source: 'user';
} | null => ({
    url: 'https://directory.test',
    serverIdentityId: 'srv_dir_1',
    source: 'user',
})));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    adoptHomeProfile: (...args: unknown[]) => adoptHomeProfileMock(...args),
    preflightHomeProfileAdoption: (...args: unknown[]) => preflightHomeProfileAdoptionMock(...args),
    reconcileServerProfileHomeConnectionDescriptor: (...args: unknown[]) => reconcileServerProfileHomeConnectionDescriptorMock(...args),
    buildHomeConnectionDescriptorForProfile: (...args: unknown[]) => buildHomeConnectionDescriptorForProfileMock(...args),
    resolveServerProfileForPortableIdentity: () => ({
        kind: 'resolved' as const,
        profile: { id: 'profile-b', serverUrl: 'https://home-b.test', serverIdentityId: 'srv_home_b' },
    }),
    resolveServerProfileScopeId: () => 'srv_home_b',
    getAccountServiceEndpointSnapshot: () => getAccountServiceEndpointSnapshotMock(),
    // Lane 04 owns the closed digest-bound authorization; its rejection behavior is proven by the
    // production-caller suite against the real owner. Here it is a transparent scope holder.
    withHomeCredentialWriteAuthorization: async <T,>(
        authorization: unknown,
        run: (authorization: unknown) => Promise<T>,
    ): Promise<T> => await run(authorization),
}));
vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: (...args: unknown[]) => setActiveServerAndSwitchMock(...args),
}));
vi.mock('@/sync/domains/server/selection/serverSelectionScope', () => ({
    resolveRoutineServerSelectionScope: () => 'tab',
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
    credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(HOME_B.connectionDescriptor),
    clientBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    issuedAtMs: Date.now() - 1_000,
    expiresAtMs: Date.now() + 120_000,
    keyId: 'a'.repeat(64),
    signatureBase64Url: 'A'.repeat(86),
};

const CONNECT_SERVICE_ENTRY = { entryIntent: 'connect_service' as const };

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
        requestLoginAssertion: async () => ({
            ...ASSERTION,
            credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(home.connectionDescriptor),
        }),
    };
}

function makeCountedSession(): Readonly<{
    session: Parameters<typeof enrollPreferredDirectoryHome>[0];
    requestLoginAssertion: ReturnType<typeof vi.fn>;
}> {
    const requestLoginAssertion = vi.fn(async () => ({ ...ASSERTION }));
    return {
        session: { ...makeSession(), requestLoginAssertion },
        requestLoginAssertion,
    };
}

describe('enrollPreferredDirectoryHome requester continuation', () => {
    beforeAll(async () => {
        await sodium.ready;
    });

    beforeEach(() => {
        createServerFetchAtEndpointMock.mockImplementation(() => async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: 'srv_home_b' } },
                    homeConnectionDescriptor: HOME_B.connectionDescriptor,
                });
            }
            return await endpointFetchMock(path, ...args);
        });
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

    afterEach(async () => {
        await cancelPendingPreferredHomeEnrollment();
        vi.restoreAllMocks();
        endpointFetchMock.mockReset();
        createServerFetchAtEndpointMock.mockReset();
        irohReleaseMock.mockClear();
        acquireIrohHomeRuntimeOriginMock.mockClear();
        setCredentialsForServerUrlMock.mockClear();
        adoptHomeProfileMock.mockClear();
        preflightHomeProfileAdoptionMock.mockClear();
        reconcileServerProfileHomeConnectionDescriptorMock.mockReset();
        buildHomeConnectionDescriptorForProfileMock.mockReset();
        setActiveServerAndSwitchMock.mockClear();
        getAccountServiceEndpointSnapshotMock.mockReturnValue({
            url: 'https://directory.test',
            serverIdentityId: 'srv_dir_1',
            source: 'user',
        });
    });

    it('closes a transient Iroh attempt and returns an explicit retryable continuation', async () => {
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
        }), CONNECT_SERVICE_ENTRY);

        expect(enrollment).toMatchObject({
            kind: 'transport_unavailable',
            reason: 'home_observation_unavailable',
            resume: expect.any(Function),
            cancel: expect.any(Function),
        });
        expect(getPendingPreferredHomeEnrollment()).toMatchObject({
            kind: 'transport_unavailable',
            reason: 'home_observation_unavailable',
            serviceKey: 'https://directory.test\u0000srv_dir_1',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(acquireIrohHomeRuntimeOriginMock).toHaveBeenCalledTimes(1);
        expect(irohReleaseMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('rejects an assertion bound to a different credential destination before contacting the Home', async () => {
        const requestLoginAssertion = vi.fn(async () => ({
            ...ASSERTION,
            credentialDestinationDigestBase64Url: 'A'.repeat(43),
        }));

        const enrollment = await enrollPreferredDirectoryHome({
            ...makeSession(),
            requestLoginAssertion,
        }, CONNECT_SERVICE_ENTRY);

        expect(enrollment).toMatchObject({ kind: 'failed' });
        expect(requestLoginAssertion).toHaveBeenCalledTimes(1);
        expect(createServerFetchAtEndpointMock).not.toHaveBeenCalled();
        expect(endpointFetchMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
    });

    it('reports enrollment success when initiating-screen cancellation flips after the credential commit', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        let initiatingScreenCancelled = false;
        endpointFetchMock.mockResolvedValueOnce(authorizedResponse(keyPair.publicKey));
        adoptHomeProfileMock.mockImplementationOnce(async () => {
            initiatingScreenCancelled = true;
            return {
                id: 'profile-b',
                serverUrl: 'https://home-b.test',
                serverIdentityId: 'srv_home_b',
            };
        });

        await expect(enrollPreferredDirectoryHome(makeSession(), {
            entryIntent: 'connect_service',
            shouldCancel: () => initiatingScreenCancelled,
        })).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledOnce();
        expect(adoptHomeProfileMock).toHaveBeenCalledOnce();
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

        const enrollment = await enrollPreferredDirectoryHome(makeSession(), CONNECT_SERVICE_ENTRY);
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
        expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
    });

    it('opens the exact enrolled Home after an enter-intent approval resume', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-enter-home',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            }))
            .mockResolvedValueOnce(authorizedResponse(keyPair.publicKey));

        await enrollPreferredDirectoryHome(makeSession(), { entryIntent: 'enter_preferred_home' });
        await expect(resumePendingPreferredHomeEnrollment()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });

        expect(setActiveServerAndSwitchMock).toHaveBeenCalledOnce();
        expect(setActiveServerAndSwitchMock).toHaveBeenCalledWith({
            serverId: 'srv_home_b',
            scope: 'tab',
        });
    });

    it('does not open the enrolled Home when the selected sign-in service was replaced while awaiting approval', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-superseded-service',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            }))
            .mockResolvedValueOnce(authorizedResponse(keyPair.publicKey));

        await enrollPreferredDirectoryHome(makeSession(), { entryIntent: 'enter_preferred_home' });
        // The user picks a different sign-in service while the Home approval is still pending.
        getAccountServiceEndpointSnapshotMock.mockReturnValue({
            url: 'https://other-directory.test',
            serverIdentityId: 'srv_dir_2',
            source: 'user',
        });

        // The Home still issues its credential, so adoption stays truthful and non-focusing…
        await expect(resumePendingPreferredHomeEnrollment()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledOnce();
        expect(setCredentialsForServerUrlMock.mock.calls[0]?.[0]).toBe('https://home-b.test');
        expect(setCredentialsForServerUrlMock.mock.calls[0]).toContainEqual({ token: 'home-b-token' });
        // …but the superseded service cannot make its Home the focused one.
        expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
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

        const first = await enrollPreferredDirectoryHome(makeSession(), CONNECT_SERVICE_ENTRY);
        const retained = await enrollPreferredDirectoryHome(makeSession(), CONNECT_SERVICE_ENTRY);

        expect(retained).toBe(getPendingPreferredHomeEnrollment());
        expect(retained).toBe(first);
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
    });

    it('publishes approval required before a late initiating cancellation can discard the continuation', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        let cancelled = false;
        endpointFetchMock.mockImplementationOnce(async () => {
            cancelled = true;
            return json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-publish-race',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            });
        });

        const result = await enrollPreferredDirectoryHome(makeSession(), {
            entryIntent: 'connect_service',
            shouldCancel: () => cancelled,
        });

        expect(result).toMatchObject({
            kind: 'approval_required',
            approvalId: 'approval-publish-race',
        });
        expect(getPendingPreferredHomeEnrollment()).toMatchObject({
            serviceKey: 'https://directory.test\u0000srv_dir_1',
            approvalId: 'approval-publish-race',
        });
        expect(acquireIrohHomeRuntimeOriginMock).not.toHaveBeenCalled();
    });

    it('cancels instead of publishing when explicit service invalidation wins the approval response race', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        let initiatingAttemptCancelled = false;
        let serviceInvalidated = false;
        endpointFetchMock.mockImplementationOnce(async () => {
            initiatingAttemptCancelled = true;
            serviceInvalidated = true;
            return json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-explicit-service-invalidation',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            });
        });
        const shouldInvalidateContinuation = vi.fn(() => serviceInvalidated);

        const result = await enrollPreferredDirectoryHome(makeSession(), {
            entryIntent: 'connect_service',
            shouldCancel: () => initiatingAttemptCancelled,
            shouldInvalidateContinuation,
        });

        expect(result).toEqual({ kind: 'cancelled' });
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(shouldInvalidateContinuation).toHaveBeenCalledTimes(1);
        expect(acquireIrohHomeRuntimeOriginMock).not.toHaveBeenCalled();
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
        expect(adoptHomeProfileMock).not.toHaveBeenCalled();
        await expect(resumePendingPreferredHomeEnrollment()).resolves.toBeNull();
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
        await enrollPreferredDirectoryHome(makeSession(), CONNECT_SERVICE_ENTRY);

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

    it('retains the pre-approval continuation and reaches approval required on one explicit enrollment resume', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-after-initial-transient',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            }));
        const { session, requestLoginAssertion } = makeCountedSession();

        const initial = await enrollPreferredDirectoryHome(session, CONNECT_SERVICE_ENTRY);

        expect(initial).toMatchObject({
            kind: 'transport_unavailable',
            reason: 'request_failed',
            resume: expect.any(Function),
            cancel: expect.any(Function),
        });
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(getPendingPreferredHomeEnrollment()).toMatchObject({
            kind: 'transport_unavailable',
            reason: 'request_failed',
            serviceKey: session.serviceKey,
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_home_b',
        });

        const resumed = await resumePendingPreferredHomeEnrollment();

        expect(resumed).toMatchObject({
            kind: 'approval_required',
            approvalId: 'approval-after-initial-transient',
        });
        expect(requestLoginAssertion).toHaveBeenCalledTimes(1);
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
        const firstBody = JSON.parse(String((endpointFetchMock.mock.calls[0]?.[1] as RequestInit).body));
        const secondBody = JSON.parse(String((endpointFetchMock.mock.calls[1]?.[1] as RequestInit).body));
        expect(secondBody).toEqual(firstBody);
        expect(getPendingPreferredHomeEnrollment()).toMatchObject({
            serviceKey: 'https://directory.test\u0000srv_dir_1',
            approvalId: 'approval-after-initial-transient',
        });
    });

    it('enrolls through one explicit resume that reuses the byte-identical assertion and client key', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(authorizedResponse(keyPair.publicKey));
        const { session, requestLoginAssertion } = makeCountedSession();

        const initial = await enrollPreferredDirectoryHome(session, CONNECT_SERVICE_ENTRY);
        expect(initial).toMatchObject({ kind: 'transport_unavailable', reason: 'request_failed' });

        await expect(resumePendingPreferredHomeEnrollment()).resolves.toEqual({
            kind: 'enrolled',
            homeServerIdentityId: 'srv_home_b',
        });
        expect(requestLoginAssertion).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).toHaveBeenCalledTimes(1);
        expect(adoptHomeProfileMock).toHaveBeenCalledTimes(1);
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
        await expect(resumePendingPreferredHomeEnrollment()).resolves.toBeNull();
    });

    it('runs at most one explicit resume of a retained pre-approval continuation at a time', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock.mockResolvedValueOnce(json(503, { error: 'home_unavailable' }));
        const { session } = makeCountedSession();
        await enrollPreferredDirectoryHome(session, CONNECT_SERVICE_ENTRY);

        let release!: (response: Response) => void;
        endpointFetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));
        const first = resumePendingPreferredHomeEnrollment();
        const second = resumePendingPreferredHomeEnrollment();
        release(authorizedResponse(keyPair.publicKey));
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult).toEqual({ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' });
        expect(secondResult).toEqual(firstResult);
        expect(endpointFetchMock).toHaveBeenCalledTimes(2);
    });

    it('clears a retained pre-approval continuation on a terminal rejection', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValue(keyPair);
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(403, { error: 'approval_rejected' }))
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-after-rejection',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            }));
        const { session, requestLoginAssertion } = makeCountedSession();
        await enrollPreferredDirectoryHome(session, CONNECT_SERVICE_ENTRY);

        await expect(resumePendingPreferredHomeEnrollment()).resolves.toEqual({ kind: 'rejected' });
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
        await expect(resumePendingPreferredHomeEnrollment()).resolves.toBeNull();

        const next = await enrollPreferredDirectoryHome(session, CONNECT_SERVICE_ENTRY);

        expect(next).toMatchObject({
            kind: 'approval_required',
            approvalId: 'approval-after-rejection',
        });
        expect(requestLoginAssertion).toHaveBeenCalledTimes(2);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('cancels instead of retaining when explicit service invalidation wins the transient failure race', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        let serviceInvalidated = false;
        endpointFetchMock.mockImplementationOnce(async () => {
            serviceInvalidated = true;
            return json(503, { error: 'home_unavailable' });
        });
        const shouldInvalidateContinuation = vi.fn(() => serviceInvalidated);
        const { session } = makeCountedSession();

        const result = await enrollPreferredDirectoryHome(session, {
            entryIntent: 'connect_service',
            shouldInvalidateContinuation,
        });

        expect(result).toEqual({ kind: 'cancelled' });
        expect(shouldInvalidateContinuation).toHaveBeenCalledTimes(1);
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
        await expect(resumePendingPreferredHomeEnrollment()).resolves.toBeNull();
        expect(endpointFetchMock).toHaveBeenCalledTimes(1);
        expect(setCredentialsForServerUrlMock).not.toHaveBeenCalled();
    });

    it('never resumes a retained pre-approval continuation for a different Account Service', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValue(keyPair);
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-other-service',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            }));
        const retainedService = makeCountedSession();
        await enrollPreferredDirectoryHome(retainedService.session, CONNECT_SERVICE_ENTRY);

        const replacement = makeCountedSession();
        const next = await enrollPreferredDirectoryHome({
            ...replacement.session,
            serviceKey: 'https://other-directory.test\u0000srv_dir_2',
        }, CONNECT_SERVICE_ENTRY);

        expect(next).toMatchObject({
            kind: 'approval_required',
            approvalId: 'approval-other-service',
        });
        expect(retainedService.requestLoginAssertion).toHaveBeenCalledTimes(1);
        expect(replacement.requestLoginAssertion).toHaveBeenCalledTimes(1);
        expect(getPendingPreferredHomeEnrollment()).toMatchObject({
            serviceKey: 'https://other-directory.test\u0000srv_dir_2',
        });
    });

    it('does not reuse a retained continuation created for a different entry intent', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValue(keyPair);
        endpointFetchMock
            .mockResolvedValueOnce(json(503, { error: 'home_unavailable' }))
            .mockResolvedValueOnce(json(202, {
                v: 1,
                outcome: 'approval_required',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-welcome-intent',
                deviceLabel: null,
                expiresAtMs: Date.now() + 60_000,
            }));
        const retainedSettings = makeCountedSession();
        await enrollPreferredDirectoryHome(retainedSettings.session, CONNECT_SERVICE_ENTRY);

        const welcome = makeCountedSession();
        const next = await enrollPreferredDirectoryHome(welcome.session, {
            entryIntent: 'enter_preferred_home',
        });

        expect(next).toMatchObject({
            kind: 'approval_required',
            approvalId: 'approval-welcome-intent',
            entryIntent: 'enter_preferred_home',
        });
        expect(retainedSettings.requestLoginAssertion).toHaveBeenCalledTimes(1);
        expect(welcome.requestLoginAssertion).toHaveBeenCalledTimes(1);
        expect(getPendingPreferredHomeEnrollment()).toMatchObject({
            serviceKey: welcome.session.serviceKey,
            entryIntent: 'enter_preferred_home',
        });
    });

    it('cancels an older callback continuation without clearing a newer retained approval', async () => {
        endpointFetchMock.mockResolvedValueOnce(json(202, {
            v: 1,
            outcome: 'approval_required',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-current',
            deviceLabel: null,
            expiresAtMs: Date.now() + 60_000,
        }));
        await enrollPreferredDirectoryHome(makeSession(), CONNECT_SERVICE_ENTRY);
        const retained = getPendingPreferredHomeEnrollment();
        const cancelOlder = vi.fn(async () => ({ kind: 'cancelled' as const }));

        await cancelPendingPreferredHomeEnrollment({ cancel: cancelOlder });

        expect(cancelOlder).toHaveBeenCalledOnce();
        expect(getPendingPreferredHomeEnrollment()).toBe(retained);
    });
});
