import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { encodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import sodium from '@/encryption/libsodium.lib';
import { createHomeCredentialDestinationDigestV1 } from '@happier-dev/protocol';
import type { AccountDirectoryHomeEntryV1, HomeLoginAssertionV1 } from '@/sync/api/accountDirectory/accountDirectoryClient';
import { setAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';
import {
    cancelPendingPreferredHomeEnrollment,
    enrollPreferredDirectoryHome,
    getPendingPreferredHomeEnrollment,
    resumePendingPreferredHomeEnrollment,
} from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createServerFetchAtEndpointMock = vi.hoisted(() => vi.fn());
const setCredentialsForServerUrlMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<{ rollback: () => Promise<void> }>
>(async () => ({ rollback: async () => {} })));
const adoptHomeProfileMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{
    id: string;
    serverUrl: string;
    serverIdentityId: string;
}>>(async () => ({ id: 'profile-b', serverUrl: 'https://home-b.test', serverIdentityId: 'srv_home_b' })));
const preflightHomeProfileAdoptionMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => {
    canonicalServerUrl: string;
    serverIdentityId: string;
}>(() => ({
    canonicalServerUrl: 'https://home-b.test',
    serverIdentityId: 'srv_home_b',
})));
const reconcileServerProfileHomeConnectionDescriptorMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<{
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
>(async () => ({
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
const buildHomeConnectionDescriptorForProfileMock = vi.hoisted(() => vi.fn());
const setActiveServerAndSwitchMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<'switched'>
>(async () => 'switched'));

const activePollingState = vi.hoisted(() => ({
    callback: null as null | (() => unknown | Promise<unknown>),
}));

vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (...args: unknown[]) => createServerFetchAtEndpointMock(...args),
    serverFetch: vi.fn(),
}));
vi.mock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({ acquireIrohHomeRuntimeOrigin: vi.fn() }));
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
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    adoptHomeProfile: (...args: unknown[]) => adoptHomeProfileMock(...args),
    preflightHomeProfileAdoption: (...args: unknown[]) => preflightHomeProfileAdoptionMock(...args),
    reconcileServerProfileHomeConnectionDescriptor: (...args: unknown[]) => reconcileServerProfileHomeConnectionDescriptorMock(...args),
    buildHomeConnectionDescriptorForProfile: (...args: unknown[]) => buildHomeConnectionDescriptorForProfileMock(...args),
    resolveServerProfileForPortableIdentity: () => ({
        kind: 'resolved' as const,
        profile: { id: 'profile-b', serverUrl: 'https://home-b.test', serverIdentityId: 'srv_home_b' },
    }),
    resolveServerProfileScopeId: () => 'srv_home_b',
    withHomeCredentialWriteAuthorization: async <T,>(authorization: unknown, run: (value: unknown) => Promise<T>) => await run(authorization),
}));
vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: (...args: unknown[]) => setActiveServerAndSwitchMock(...args),
}));
vi.mock('@/sync/domains/server/selection/serverSelectionScope', () => ({
    resolveRoutineServerSelectionScope: () => 'tab',
}));
vi.mock('@/sync/ops/accountDirectory/useAccountDirectoryActivePolling', async () => {
    const ReactModule = await import('react');
    return {
        useAccountDirectoryActivePolling: (callback: () => unknown | Promise<unknown>, enabled = true) => {
            ReactModule.useEffect(() => {
                if (!enabled) return;
                activePollingState.callback = callback;
                return () => {
                    if (activePollingState.callback === callback) activePollingState.callback = null;
                };
            }, [callback, enabled]);
        },
    };
});

import { AccountServiceOAuthJourney } from './AccountServiceOAuthJourney';

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
const JOURNEY_STATE = {
    kind: 'progress' as const,
    stage: 'waiting_approval' as const,
    providerName: 'GitHub',
    endpointUrl: 'https://directory.test',
};

function json(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function approvalRequiredResponse(approvalId: string): Response {
    return json(202, {
        v: 1,
        outcome: 'approval_required',
        homeServerIdentityId: HOME_B.homeServerIdentityId,
        approvalId,
        deviceLabel: null,
        expiresAtMs: Date.now() + 60_000,
    });
}

function authorizedResponse(recipientPublicKey: Uint8Array): Response {
    const sealedHomeTokenBase64Url = encodeBase64(
        encryptBox(new TextEncoder().encode(JSON.stringify({ token: 'home-b-token' })), recipientPublicKey),
        'base64url',
    );
    return json(200, {
        v: 1,
        homeServerIdentityId: HOME_B.homeServerIdentityId,
        sealedHomeTokenBase64Url,
        issuedAtMs: Date.now() - 500,
        expiresAtMs: Date.now() + 120_000,
    });
}

function makeSession(): Parameters<typeof enrollPreferredDirectoryHome>[0] {
    return {
        serviceKey: 'https://directory.test\u0000srv_dir_1',
        supportsHomeEnrollment: true,
        snapshot: {
            endpoint: 'https://directory.test',
            status: 'ready',
            homes: [HOME_B],
            preferredHomeServerIdentityId: HOME_B.homeServerIdentityId,
            refreshedAtMs: Date.now(),
            error: null,
            reconciliation: { kind: 'not_run' },
        },
        requestLoginAssertion: async () => ({
            v: 1,
            purpose: 'happier.home-login',
            issuerServerIdentityId: 'srv_dir_1',
            issuerSubjectId: 'account-1',
            audienceHomeServerIdentityId: HOME_B.homeServerIdentityId,
            credentialDestinationDigestBase64Url: createHomeCredentialDestinationDigestV1(HOME_B.connectionDescriptor),
            clientBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            issuedAtMs: Date.now() - 1_000,
            expiresAtMs: Date.now() + 120_000,
            keyId: 'a'.repeat(64),
            signatureBase64Url: 'A'.repeat(86),
        }) satisfies HomeLoginAssertionV1,
    };
}

async function renderApproval(onApprovalOutcome = vi.fn()) {
    const screen = await renderScreen(
        <AccountServiceOAuthJourney
            state={JOURNEY_STATE}
            onRecovery={vi.fn()}
            approvalContinuation
            onApprovalOutcome={onApprovalOutcome}
        />,
    );
    return { screen, onApprovalOutcome };
}

async function drivePoll(): Promise<void> {
    await act(async () => { await activePollingState.callback?.(); });
}

describe('AccountServiceOAuthJourney approval continuation', () => {
    beforeAll(async () => { await sodium.ready; });

    beforeEach(() => {
        setAccountServiceEndpoint({
            url: 'https://directory.test', serverIdentityId: 'srv_dir_1', source: 'user',
        });
        createServerFetchAtEndpointMock.mockImplementation(() => async (path: string, ...args: unknown[]) => {
            if (path === '/v1/features') {
                return json(200, {
                    features: {},
                    capabilities: { serverIdentity: { serverIdentityId: HOME_B.homeServerIdentityId } },
                    homeConnectionDescriptor: HOME_B.connectionDescriptor,
                });
            }
            return await endpointFetchMock(path, ...args);
        });
        buildHomeConnectionDescriptorForProfileMock.mockReturnValue(HOME_B.connectionDescriptor);
    });

    afterEach(async () => {
        await cancelPendingPreferredHomeEnrollment();
        activePollingState.callback = null;
        setAccountServiceEndpoint({
            url: 'https://directory.test', serverIdentityId: 'srv_dir_1', source: 'user',
        });
        endpointFetchMock.mockReset();
        createServerFetchAtEndpointMock.mockReset();
        setCredentialsForServerUrlMock.mockClear();
        adoptHomeProfileMock.mockClear();
        preflightHomeProfileAdoptionMock.mockClear();
        reconcileServerProfileHomeConnectionDescriptorMock.mockClear();
        buildHomeConnectionDescriptorForProfileMock.mockReset();
        setActiveServerAndSwitchMock.mockClear();
        vi.restoreAllMocks();
    });

    it('automatically resumes the canonical continuation and reports enrollment only after the exact Home opens', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock.mockResolvedValueOnce(approvalRequiredResponse('approval-open'));
        await enrollPreferredDirectoryHome(makeSession(), { entryIntent: 'enter_preferred_home' });
        const { screen, onApprovalOutcome } = await renderApproval();
        try {
            let release!: (response: Response) => void;
            endpointFetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
            let inFlight: Promise<unknown> | undefined;
            act(() => { inFlight = Promise.resolve(activePollingState.callback?.()); });
            await vi.waitFor(() => expect(release).toBeTruthy());
            await act(async () => { release(authorizedResponse(keyPair.publicKey)); await inFlight; });

            expect(setActiveServerAndSwitchMock).toHaveBeenCalledWith({ serverId: 'srv_home_b', scope: 'tab' });
            expect(setCredentialsForServerUrlMock).toHaveBeenCalledWith(
                'https://home-b.test', { serverId: 'srv_home_b' }, { token: 'home-b-token' },
            );
            expect(onApprovalOutcome).toHaveBeenCalledWith('enrolled');
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('holds rejected and expired outcomes until the user continues', async () => {
        for (const terminal of ['rejected', 'expired'] as const) {
            const keyPair = sodium.crypto_box_keypair();
            vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
            endpointFetchMock
                .mockResolvedValueOnce(approvalRequiredResponse(`approval-${terminal}`))
                .mockResolvedValueOnce(json(403, { error: terminal === 'rejected' ? 'approval_rejected' : 'approval_expired' }));
            await enrollPreferredDirectoryHome(makeSession(), { entryIntent: 'enter_preferred_home' });
            const { screen, onApprovalOutcome } = await renderApproval();
            try {
                await drivePoll();
                expect(screen.findByTestId(`oauth-account-directory-approval-${terminal}`)).toBeTruthy();
                expect(onApprovalOutcome).not.toHaveBeenCalled();
                await screen.pressByTestIdAsync('oauth-account-directory-approval-continue');
                expect(onApprovalOutcome).toHaveBeenCalledWith(terminal);
            } finally {
                act(() => screen.tree.unmount());
                await cancelPendingPreferredHomeEnrollment();
                activePollingState.callback = null;
            }
        }
    });

    it('cancels through the canonical continuation owner', async () => {
        endpointFetchMock.mockResolvedValueOnce(approvalRequiredResponse('approval-cancel'));
        await enrollPreferredDirectoryHome(makeSession(), { entryIntent: 'enter_preferred_home' });
        const { screen, onApprovalOutcome } = await renderApproval();
        try {
            await screen.pressByTestIdAsync('oauth-account-directory-approval-cancel');
            expect(screen.findByTestId('oauth-account-directory-approval-cancelled')).toBeTruthy();
            await expect(resumePendingPreferredHomeEnrollment()).resolves.toBeNull();
            expect(onApprovalOutcome).not.toHaveBeenCalled();
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('invalidates the wait when its selected Account Service is replaced', async () => {
        endpointFetchMock.mockResolvedValueOnce(approvalRequiredResponse('approval-stale'));
        await enrollPreferredDirectoryHome(makeSession(), { entryIntent: 'enter_preferred_home' });
        const { screen, onApprovalOutcome } = await renderApproval();
        try {
            await act(async () => {
                setAccountServiceEndpoint({
                    url: 'https://other-directory.test', serverIdentityId: 'srv_dir_2', source: 'user',
                });
            });
            await vi.waitFor(() => expect(
                screen.findByTestId('oauth-account-directory-approval-service_replaced'),
            ).toBeTruthy());
            expect(getPendingPreferredHomeEnrollment()).toBeNull();
            expect(onApprovalOutcome).not.toHaveBeenCalled();
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('does not report enrollment when the selected Account Service is replaced during resume', async () => {
        const keyPair = sodium.crypto_box_keypair();
        vi.spyOn(sodium, 'crypto_box_keypair').mockReturnValueOnce(keyPair);
        endpointFetchMock.mockResolvedValueOnce(approvalRequiredResponse('approval-race'));
        await enrollPreferredDirectoryHome(makeSession(), { entryIntent: 'enter_preferred_home' });
        const { screen, onApprovalOutcome } = await renderApproval();
        try {
            let release!: (response: Response) => void;
            endpointFetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
            let inFlight: Promise<unknown> | undefined;
            act(() => { inFlight = Promise.resolve(activePollingState.callback?.()); });
            await vi.waitFor(() => expect(release).toBeTruthy());
            await act(async () => {
                setAccountServiceEndpoint({
                    url: 'https://other-directory.test', serverIdentityId: 'srv_dir_2', source: 'user',
                });
                release(authorizedResponse(keyPair.publicKey));
                await inFlight;
            });

            expect(setActiveServerAndSwitchMock).not.toHaveBeenCalled();
            expect(onApprovalOutcome).not.toHaveBeenCalledWith('enrolled');
            expect(screen.findByTestId('oauth-account-directory-approval-service_replaced')).toBeTruthy();
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('keeps initial transport failure explicit-only and resumes once per retry', async () => {
        endpointFetchMock.mockResolvedValueOnce(json(503, { error: 'home_unavailable' }));
        await enrollPreferredDirectoryHome(makeSession(), { entryIntent: 'enter_preferred_home' });
        const { screen, onApprovalOutcome } = await renderApproval();
        try {
            expect(screen.findByTestId('oauth-account-directory-approval-unavailable')).toBeTruthy();
            expect(activePollingState.callback).toBeNull();
            endpointFetchMock.mockResolvedValueOnce(approvalRequiredResponse('approval-after-retry'));
            await screen.pressByTestIdAsync('oauth-account-directory-approval-retry');
            await vi.waitFor(() => expect(
                screen.findByTestId('oauth-account-directory-approval-waiting'),
            ).toBeTruthy());
            expect(endpointFetchMock).toHaveBeenCalledTimes(2);
            expect(onApprovalOutcome).not.toHaveBeenCalled();
        } finally {
            act(() => screen.tree.unmount());
        }
    });

    it('surfaces a missing canonical continuation as failed instead of waiting or succeeding', async () => {
        expect(getPendingPreferredHomeEnrollment()).toBeNull();
        const { screen, onApprovalOutcome } = await renderApproval();
        try {
            await vi.waitFor(() => expect(
                screen.findByTestId('oauth-account-directory-approval-failed'),
            ).toBeTruthy());
            expect(screen.findAllByTestId('oauth-account-directory-approval-waiting')).toHaveLength(0);
            expect(onApprovalOutcome).not.toHaveBeenCalled();
        } finally {
            act(() => screen.tree.unmount());
        }
    });
});
