import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { FeaturesResponseSchema } from '@happier-dev/protocol';
import { adoptHomeProfile, getActiveServerId, setActiveServerId } from '@/sync/domains/server/serverProfiles';
import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { AuthProvider, getCurrentAuth } from '@/auth/context/AuthContext';
import { SecretKeyLoginForm } from './SecretKeyLoginForm';
import { t } from '@/text';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn(), targets: [] as Array<{ endpointUrl: string; credentials?: AuthCredentials | null }> }));
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (target: { endpointUrl: string; credentials?: AuthCredentials | null }) => {
        boundary.targets.push(target);
        return (path: string, init?: RequestInit) => boundary.request(target.endpointUrl, path, init);
    },
    serverFetch: (path: string, init?: RequestInit) => boundary.request('ambient', path, init),
}));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);

let restore: () => void;
let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
beforeEach(() => { restore = installLocalStorageMock().restore; boundary.targets.length = 0; boundary.request.mockReset(); });
afterEach(async () => { await screen?.unmount(); screen = undefined; vi.unstubAllEnvs(); restore(); });

it.each(['plain', 'e2ee'] as const)('commits exact Home B %s credentials before completion while Stack and focus remain A', async (mode) => {
    const fixture = createDirectoryHttpFixture();
    const homeA = await adoptHomeProfile({ descriptor: { ...fixture.home.connectionDescriptor,
        homeServerIdentityId: 'srv_home_a', canonicalServerUrl: 'https://home-a.test',
        endpoints: [{ kind: 'https', url: 'https://home-a.test' }] }, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
    const homeB = await adoptHomeProfile({ descriptor: fixture.home.connectionDescriptor, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
    await setActiveServerId(homeA.id, { scope: 'device' });
    const activeHomeA = getActiveServerId();
    const credentialsA = { token: 'header.eyJzdWIiOiJhY2NvdW50LWEifQ.signature' };
    await TokenStorage.setCredentialsForServerUrl(homeA.serverUrl, { serverId: 'srv_home_a' }, credentialsA);
    vi.stubEnv('EXPO_PUBLIC_HAPPY_SERVER_CONTEXT', 'stack');
    vi.stubEnv('EXPO_PUBLIC_HAPPY_SERVER_URL', homeA.serverUrl);
    let release!: () => void;
    const responseGate = new Promise<void>((resolve) => { release = resolve; });
    let redemptionStarted = false;
    const features = FeaturesResponseSchema.parse(createRootLayoutFeaturesResponse({
        capabilities: { auth: { keyChallenge: { v2: true } },
            serverIdentity: { serverIdentityId: 'srv_home_b' }, server: { canonicalServerUrl: homeB.serverUrl } },
    }));
    boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
        if (endpoint !== homeB.serverUrl) throw new Error(`Wrong authentication destination: ${endpoint}`);
        if (path === '/v1/features') return new Response(JSON.stringify(features), { headers: { 'Content-Type': 'application/json' } });
        if (path === '/v1/auth/challenge') {
            expect(JSON.parse(String(init?.body))).toMatchObject({ expectedAccountId: 'account-b' });
            return new Response(JSON.stringify({ challengeId: 'challenge-b', nonce: 'nonce',
                issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
                audience: { origin: homeB.serverUrl, serverIdentityId: 'srv_home_b' } }));
        }
        if (path === '/v1/auth') { redemptionStarted = true; await responseGate; return new Response(JSON.stringify({ token: fixture.token })); }
        if (path === '/v1/account/encryption') return new Response(JSON.stringify({ mode, updatedAt: 0 }));
        throw new Error(`Unexpected request: ${path}`);
    });
    let completed: AuthCredentials | null = null;
    screen = await renderScreen(<AuthProvider initialCredentials={credentialsA}>
        <SecretKeyLoginForm target={{ endpointUrl: homeB.serverUrl, canonicalServerUrl: homeB.serverUrl,
            serverIdentityId: 'srv_home_b', serverId: 'srv_home_b', expectedAccountId: 'account-b', requireKeyChallengeV2: true }}
            onAuthenticated={async (credentials) => {
                expect(await TokenStorage.getCredentialsForServerUrl(homeB.serverUrl, { serverId: 'srv_home_b' })).toEqual(credentials);
                completed = credentials;
            }} />
    </AuthProvider>);
    await act(async () => { screen!.findByTestId('restore-manual-secret-input')!.props.onChangeText('A'.repeat(43)); });
    let submission!: Promise<unknown>;
    act(() => { submission = screen!.findByTestId('restore-manual-submit')!.props.onPress(); });
    try {
        await act(async () => { await vi.waitFor(() => expect(redemptionStarted, JSON.stringify(boundary.request.mock.calls)).toBe(true)); });
        expect(completed).toBeNull();
        expect(getActiveServerId()).toBe(activeHomeA);
        expect(await TokenStorage.getCredentialsForServerUrl(homeB.serverUrl, { serverId: 'srv_home_b' })).toBeNull();
    } finally { await act(async () => { release(); await submission; }); }
    await vi.waitFor(() => expect(completed).toEqual(mode === 'plain' ? { token: fixture.token } : { token: fixture.token, secret: 'A'.repeat(43) }));
    expect(getActiveServerId()).toBe(activeHomeA);
    expect(getCurrentAuth()?.credentials).toEqual(credentialsA);
    expect(await TokenStorage.getCredentialsForServerUrl(homeA.serverUrl, { serverId: 'srv_home_a' })).toEqual(credentialsA);
    expect(boundary.targets.every((target) => target.endpointUrl === homeB.serverUrl)).toBe(true);
});

it.each([
    { failure: 'signup', message: 'errors.signupDisabled' },
    { failure: 'disabled', message: 'errors.accountDisabled' },
    { failure: 'permission', message: 'errors.permissionDenied' },
    { failure: 'authentication', message: 'errors.authenticationFailed' },
    { failure: 'network', message: 'welcome.serverUnavailableTitle' },
] as const)('retains the key draft and presents safe $failure recovery without committing credentials', async ({ failure, message }) => {
    const fixture = createDirectoryHttpFixture();
    const home = await adoptHomeProfile({ descriptor: fixture.home.connectionDescriptor,
        source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
    const features = createRootLayoutFeaturesResponse({ capabilities: { auth: { keyChallenge: { v2: true } },
        serverIdentity: { serverIdentityId: fixture.home.homeServerIdentityId }, server: { canonicalServerUrl: home.serverUrl } } });
    boundary.request.mockImplementation(async (endpoint: string, path: string) => {
        expect(endpoint).toBe(home.serverUrl);
        if (path === '/v1/features') return new Response(JSON.stringify(features), { headers: { 'Content-Type': 'application/json' } });
        if (path === '/v1/auth/challenge') return new Response(JSON.stringify({ challengeId: 'challenge-b', nonce: 'nonce',
            issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
            audience: { origin: home.serverUrl, serverIdentityId: fixture.home.homeServerIdentityId } }));
        if (path === '/v1/auth') {
            if (failure === 'network') throw new TypeError('private transport diagnostics');
            return new Response(JSON.stringify({ error: failure === 'signup' ? 'signup-disabled' : failure === 'disabled' ? 'account-disabled' : 'invalid-request', message: 'private server diagnostics' }),
                { status: failure === 'authentication' ? 401 : 403 });
        }
        throw new Error(`Unexpected request: ${path}`);
    });
    const onAuthenticated = vi.fn();
    screen = await renderScreen(<AuthProvider initialCredentials={null}><SecretKeyLoginForm
        target={{ endpointUrl: home.serverUrl, canonicalServerUrl: home.serverUrl, serverId: fixture.home.homeServerIdentityId,
            serverIdentityId: fixture.home.homeServerIdentityId, requireKeyChallengeV2: true }}
        onAuthenticated={onAuthenticated} /></AuthProvider>);
    const previous = await TokenStorage.getCredentialsForServerUrl(home.serverUrl, { serverId: fixture.home.homeServerIdentityId });
    await act(async () => { screen!.findByTestId('restore-manual-secret-input')!.props.onChangeText('A'.repeat(43)); });
    await screen.pressByTestIdAsync('restore-manual-submit');
    expect(boundary.request.mock.calls.some(([, path]) => path === '/v1/auth'), JSON.stringify(boundary.request.mock.calls.map(([endpoint, path]) => ({ endpoint, path })))).toBe(true);
    expect(screen.findByTestId('restore-manual-secret-error')?.props.children).toBe(message === 'errors.accountDisabled'
        ? t('errors.accountDisabled', { home: home.serverUrl })
        : t(message));
    expect(screen.findByTestId('restore-manual-secret-input')?.props.value).toBe('A'.repeat(43));
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(await TokenStorage.getCredentialsForServerUrl(home.serverUrl, { serverId: fixture.home.homeServerIdentityId })).toEqual(previous);
});
