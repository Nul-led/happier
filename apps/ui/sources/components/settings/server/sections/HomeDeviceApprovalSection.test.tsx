import * as React from 'react';
import { router } from 'expo-router';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { setAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';
import { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { completeAccountServicePostAuth, type AccountPostAuthResult } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';
import { cancelPendingDirectoryHomeEnrollment, getPendingDirectoryHomeEnrollment } from '@/sync/ops/accountDirectory/enrollDirectoryHome';
import { ENROLLMENT_POLL_IDLE_DELAY_MS } from '@/auth/enrollment/enrollmentPollingBackoff';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (options: { endpointUrl: string }) => (path: string, init?: RequestInit) => boundary.request(options.endpointUrl, path, init),
    serverFetch: (path: string, init?: RequestInit) => boundary.request('ambient', path, init),
}));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);

import { HomeDeviceApprovalSection } from './HomeDeviceApprovalSection';
import { adoptHomeProfile } from '@/sync/domains/server/serverProfiles';
import { HOME_LOGIN_APPROVALS_HTTP_PATH_V1, buildHomeLoginApprovalDecisionHttpPathV1 } from '@happier-dev/protocol';

/** Non-secret binding to the Account credential a continuation was created under. */
const ACCOUNT_CREDENTIAL_TOKEN_DIGEST = 'C0jknAf55a-WIBFlxj8xId4cq00hoNQDzcbt4__9tlM';

describe('Home approval visible continuation', () => {
    let fixture: ReturnType<typeof createDirectoryHttpFixture>;
    let restore: () => void;
    let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
    beforeEach(() => { restore = installLocalStorageMock().restore; fixture = createDirectoryHttpFixture(); boundary.request.mockImplementation(fixture.request); });
    afterEach(async () => { await screen?.unmount(); screen = undefined; await cancelPendingDirectoryHomeEnrollment(); restore(); });

    it('routes deliberate approval recovery to the original Account Service and enrollment intent', async () => {
        const { service } = fixture;
        await TokenStorage.accountDirectoryAuthCredentials.set({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { token: 'directory-token' });
        const intent = { kind: 'enroll' as const, homeServerIdentityId: fixture.home.homeServerIdentityId };
        await completeAccountServicePostAuth({ service, intent,
            credentialTokenDigest: ACCOUNT_CREDENTIAL_TOKEN_DIGEST,
            session: new AccountDirectorySession({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { capability: service.capability }),
        });
        screen = await renderScreen(<HomeDeviceApprovalSection homes={[]} />);
        fixture.state.approval = 'expired';
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, ENROLLMENT_POLL_IDLE_DELAY_MS + 100)); });
        await vi.waitFor(() => expect(getPendingDirectoryHomeEnrollment()).toBeNull());
        fixture.state.directoryStatus = 401;
        await screen.pressByTestIdAsync('account-service-continuation-failure-action');
        await setAccountServiceEndpoint({ url: 'https://unrelated.test', serverIdentityId: 'srv_unrelated', source: 'user' });
        await screen.pressByTestIdAsync('account-service-continuation-failure-action');
        expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({
            accountServiceEndpoint: service.endpointUrl, accountServiceIdentity: service.serverIdentityId,
            accountIntent: JSON.stringify(intent),
        }) }));
        expect(fixture.state.calls.some(({ endpoint }) => endpoint === 'ambient' || endpoint === 'https://unrelated.test')).toBe(false);
    });

    it('resumes the pending requester automatically without another Directory assertion', async () => {
        const { service } = fixture;
        await TokenStorage.accountDirectoryAuthCredentials.set({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { token: 'directory-token' });
        expect(await completeAccountServicePostAuth({ service,
            credentialTokenDigest: ACCOUNT_CREDENTIAL_TOKEN_DIGEST,
            session: new AccountDirectorySession({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { capability: service.capability }),
            intent: { kind: 'enroll', homeServerIdentityId: fixture.home.homeServerIdentityId },
        })).toMatchObject({ kind: 'approval_required' });
        screen = await renderScreen(<HomeDeviceApprovalSection homes={[]} />);
        fixture.state.approval = 'approved';
        fixture.state.mode = 'e2ee';
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, ENROLLMENT_POLL_IDLE_DELAY_MS + 100)); });
        await vi.waitFor(() => expect(getPendingDirectoryHomeEnrollment()).toBeNull());
        expect(screen.findByTestId('settings.server.homeEnrollment.continuation')).not.toBeNull();
        expect(await TokenStorage.getCredentialsForServerUrl(fixture.home.canonicalServerUrl, { serverId: fixture.home.homeServerIdentityId })).toEqual({ token: fixture.token });
        expect(fixture.state.calls.filter(({ path }) => path.includes('login-assertion'))).toHaveLength(1);
    });

    it('decides approval at the exact authenticated Home without consulting ambient focus', async () => {
        const home = await adoptHomeProfile({ descriptor: fixture.home.connectionDescriptor, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
        await TokenStorage.setCredentialsForServerUrl(home.serverUrl, { serverId: fixture.home.homeServerIdentityId }, { token: fixture.token });
        let decided = false;
        boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
            expect(endpoint).toBe(home.serverUrl);
            if (path === HOME_LOGIN_APPROVALS_HTTP_PATH_V1) return new Response(JSON.stringify(decided ? [] : [{
                approvalId: 'approval-b', accountId: 'account-home', flow: 'account_assertion',
                requesterBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
                issuerServerIdentityId: fixture.service.serverIdentityId, issuerSubjectId: 'account-directory',
                deviceLabel: 'New phone', status: 'pending', expiresAtMs: Date.now() + 60_000, decidedAtMs: null,
            }]));
            if (path === buildHomeLoginApprovalDecisionHttpPathV1('approval-b')) {
                expect(JSON.parse(String(init?.body))).toEqual({ decision: 'approve' });
                decided = true;
                return new Response(JSON.stringify({ status: 'approved' }));
            }
            return fixture.request(endpoint, path, init);
        });
        screen = await renderScreen(<HomeDeviceApprovalSection homes={[home]} />);
        await vi.waitFor(() => expect(screen?.findByTestId('settings.server.homeApprovals.approval-b.approve')).not.toBeNull());
        const text = screen.getTextContent();
        expect(text).toContain('Approve this device');
        expect(text).toContain('New phone');
        expect(text).toContain(`Continue on a device already connected to ${home.name}.`);
        expect(text).toContain('Request-key fingerprint');
        await screen.pressByTestIdAsync('settings.server.homeApprovals.approval-b.approve');
        expect(decided).toBe(true);
        await vi.waitFor(() => expect(screen?.findByTestId('settings.server.homeApprovals.approval-b')).toBeNull());
    });
});
