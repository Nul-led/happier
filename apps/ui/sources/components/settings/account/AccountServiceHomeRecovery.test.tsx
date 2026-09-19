import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { AuthProvider } from '@/auth/context/AuthContext';
import { adoptHomeProfile, getActiveServerId, setActiveServerId, setAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';
import { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { completeAccountServicePostAuth } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';
import { cancelPendingDirectoryHomeEnrollment, getPendingDirectoryHomeEnrollment } from '@/sync/ops/accountDirectory/enrollDirectoryHome';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';
import { AccountServiceSettingsSection } from './AccountServiceSettingsSection';
import { HomeDeviceApprovalSection } from '../server/sections/HomeDeviceApprovalSection';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn() }));

/** Non-secret binding to the Account credential a continuation was created under. */
const ACCOUNT_CREDENTIAL_TOKEN_DIGEST = 'C0jknAf55a-WIBFlxj8xId4cq00hoNQDzcbt4__9tlM';
vi.mock('@/utils/system/runtimeFetch', () => ({
    runtimeFetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return boundary.request(url.origin, url.pathname, init);
    },
}));
vi.mock('@/sync/http/client', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/http/client')>(),
    createServerFetchAtEndpoint: (target: { endpointUrl: string }) => (path: string, init?: RequestInit) => boundary.request(target.endpointUrl, path, init),
    serverFetch: (path: string, init?: RequestInit) => boundary.request('ambient', path, init),
}));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock({ pathname: '/settings/account' }).module);
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);

let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
let restore: (() => void) | undefined;
afterEach(async () => { await screen?.unmount(); screen = undefined; await cancelPendingDirectoryHomeEnrollment(); restore?.(); });

it.each(['account', 'approval'])('%s Settings resumes exact Home authentication without another enrollment or focus', async (surface) => {
    restore = installLocalStorageMock().restore;
    const fixture = createDirectoryHttpFixture();
    const homeA = await adoptHomeProfile({ descriptor: { ...fixture.home.connectionDescriptor, homeServerIdentityId: 'srv_home_a',
        canonicalServerUrl: 'https://home-a.test', endpoints: [{ kind: 'https', url: 'https://home-a.test' }] },
        source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
    await setActiveServerId(homeA.id, { scope: 'device' });
    const activeHomeA = getActiveServerId();
    const credentialsA = { token: 'header.eyJzdWIiOiJhY2NvdW50LWEifQ.signature' };
    await TokenStorage.setCredentialsForServerUrl(homeA.serverUrl, { serverId: 'srv_home_a' }, credentialsA);
    await setAccountServiceEndpoint({ url: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId, source: 'user' });
    await TokenStorage.accountDirectoryAuthCredentials.set({ endpoint: fixture.service.endpointUrl,
        serverIdentityId: fixture.service.serverIdentityId }, { token: 'directory-token' });
    let linkMissing = false;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
        if (path === '/health') return json({ status: 'ok' });
        if (path === '/v1/features' && endpoint === homeA.serverUrl) return json(createRootLayoutFeaturesResponse({ capabilities: {
            serverIdentity: { serverIdentityId: 'srv_home_a' }, server: { canonicalServerUrl: endpoint },
        } }));
        if (path.includes('/login-assertion') && linkMissing) return json({ error: 'directory_link_not_found' }, 404);
        if (path === '/v1/features' && endpoint === fixture.home.canonicalServerUrl) return json({
            ...createRootLayoutFeaturesResponse({ capabilities: { auth: { keyChallenge: { v2: true },
                methods: [{ id: 'key_challenge', actions: [{ id: 'login', enabled: true, mode: 'keyed' }] }] },
                serverIdentity: { serverIdentityId: fixture.home.homeServerIdentityId }, server: { canonicalServerUrl: endpoint } } }),
            homeConnectionDescriptor: fixture.home.connectionDescriptor,
        });
        if (path === '/v1/auth/challenge') return json({ challengeId: 'challenge-b', nonce: 'nonce',
            issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
            audience: { origin: fixture.home.canonicalServerUrl, serverIdentityId: fixture.home.homeServerIdentityId } });
        if (path === '/v1/auth') { expect(endpoint).toBe(fixture.home.canonicalServerUrl); return json({ token: fixture.token }); }
        return fixture.request(endpoint, path, init);
    });
    await completeAccountServicePostAuth({ service: fixture.service,
        credentialTokenDigest: ACCOUNT_CREDENTIAL_TOKEN_DIGEST,
        session: new AccountDirectorySession({ endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId }, { capability: fixture.service.capability }),
        intent: { kind: 'enroll', homeServerIdentityId: fixture.home.homeServerIdentityId } });
    screen = await renderScreen(<AuthProvider initialCredentials={credentialsA}>{surface === 'account'
        ? <AccountServiceSettingsSection /> : <HomeDeviceApprovalSection homes={[]} />}</AuthProvider>);
    fixture.state.approval = 'expired';
    await vi.waitFor(() => expect(getPendingDirectoryHomeEnrollment()).toBeNull(), { timeout: 3000 });
    linkMissing = true;
    await screen.pressByTestIdAsync('account-service-continuation-failure-action');
    await vi.waitFor(() => expect(screen?.findByTestId('account-service-direct-home-auth')).not.toBeNull());
    await screen.pressByTestIdAsync('account-service-direct-home-auth');
    await vi.waitFor(() => expect(screen?.findByTestId('home-auth-key_challenge-login-keyed'),
        `${screen?.getTextContent()} ${JSON.stringify(boundary.request.mock.calls.map(([endpoint, path]) => ({ endpoint, path })))}`).not.toBeNull());
    await screen.pressByTestIdAsync('home-auth-key_challenge-login-keyed');
    const requestsBeforeAuth = boundary.request.mock.calls.filter(([, path]) => path.includes('/login-assertion')).length;
    await act(async () => { screen!.findByTestId('restore-manual-secret-input')!.props.onChangeText('A'.repeat(43)); });
    await screen.pressByTestIdAsync('restore-manual-submit');
    await vi.waitFor(async () => expect(await TokenStorage.getCredentialsForServerUrl(fixture.home.canonicalServerUrl,
        { serverId: fixture.home.homeServerIdentityId })).toEqual({ token: fixture.token }));
    expect(screen.findByTestId('restore-manual-secret-input')).toBeNull();
    expect(getActiveServerId()).toBe(activeHomeA);
    expect(boundary.request.mock.calls.filter(([, path]) => path.includes('/login-assertion'))).toHaveLength(requestsBeforeAuth);
});
