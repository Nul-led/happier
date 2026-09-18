import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';
import { adoptHomeProfile, getActiveServerId, setActiveServerId } from '@/sync/domains/server/serverProfiles';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { AuthProvider, getCurrentAuth } from '@/auth/context/AuthContext';
import { subscribeActiveServer } from '@/sync/domains/server/serverRuntime';
import { consumeAccountServiceOAuthReturn } from '@/sync/ops/accountDirectory/consumeAccountServiceOAuthReturn';
import { router } from 'expo-router';
import OAuthProviderReturn from './[provider]';
import MtlsCallbackScreen from '../mtls';
import { Modal } from '@/modal';
import { t } from '@/text';
import { executeHomeAuthentication } from '@/auth/flows/executeHomeAuthentication';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn(), params: {
    provider: 'github', flow: 'auth', pending: 'provider-handle', purpose: '', admissionReference: '', accountMode: 'plain', code: 'mtls-code', error: '',
} }));
vi.mock('@/sync/http/client', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/http/client')>(),
    createServerFetchAtEndpoint: (target: { endpointUrl: string; runtimeOrigin?: string }) => (path: string, init?: RequestInit) => boundary.request(target.endpointUrl, path, init, target.runtimeOrigin),
    serverFetch: (path: string, init?: RequestInit) => boundary.request('ambient', path, init),
}));
vi.mock('expo-router', async () => ({
    ...(await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module,
    useLocalSearchParams: () => boundary.params,
}));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);

let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
let restore: (() => void) | undefined;
afterEach(async () => {
    await screen?.unmount();
    screen = undefined;
    restore?.();
    boundary.params.provider = 'github';
    boundary.params.flow = 'auth';
    boundary.params.pending = 'provider-handle';
    boundary.params.purpose = '';
    boundary.params.admissionReference = '';
    boundary.params.accountMode = 'plain';
    boundary.params.code = 'mtls-code';
    boundary.params.error = '';
    vi.clearAllMocks();
});

it('rejects a Team callback whose admission reference does not match its pending continuation', async () => {
    restore = installLocalStorageMock().restore;
    const fixture = createDirectoryHttpFixture();
    const home = await adoptHomeProfile({
        descriptor: fixture.home.connectionDescriptor,
        source: 'account-directory',
        descriptorAuthority: 'current_connection_observation',
    });
    await setActiveServerId(home.id, { scope: 'device' });
    boundary.params.provider = 'github';
    boundary.params.flow = 'auth';
    boundary.params.pending = 'provider-handle';
    boundary.params.purpose = 'team_admission';
    boundary.params.admissionReference = 'returned-admission-reference';
    boundary.params.accountMode = 'plain';
    boundary.params.error = '';
    await expect(TokenStorage.setPendingExternalAuth({
        provider: 'github',
        proof: 'proof-b',
        serverUrl: home.serverUrl,
        serverId: fixture.home.connectionDescriptor.homeServerIdentityId,
        teamContinuation: {
            v: 1,
            purpose: 'team_admission',
            admissionReference: 'expected-admission-reference',
            teamId: 'team-1',
            homeServerIdentityId: fixture.home.connectionDescriptor.homeServerIdentityId,
            destination: { kind: 'team_sign_in', teamId: 'team-1' },
        },
    }, {
        serverUrl: home.serverUrl,
        serverId: fixture.home.connectionDescriptor.homeServerIdentityId,
    })).resolves.toBe(true);
    await expect(TokenStorage.readPendingExternalAuthContinuationState()).resolves.toMatchObject({
        serverMismatch: false,
        value: {
            provider: 'github',
            teamContinuation: {
                admissionReference: 'expected-admission-reference',
            },
        },
    });
    boundary.request.mockRejectedValue(new Error('A mismatched callback must not reach finalization'));

    screen = await renderScreen(<AuthProvider initialCredentials={null}><OAuthProviderReturn /></AuthProvider>);

    await vi.waitFor(() => expect(Modal.alert).toHaveBeenCalledWith(
        t('common.error'),
        t('errors.oauthStateMismatch'),
    ));
    expect(boundary.request).not.toHaveBeenCalled();
    expect(await TokenStorage.getPendingExternalAuth({
        serverUrl: home.serverUrl,
        serverId: fixture.home.connectionDescriptor.homeServerIdentityId,
    })).toBeNull();
    expect(router.replace).toHaveBeenCalledWith(
        `/teams/team-1/sign-in?target=${encodeURIComponent(fixture.home.connectionDescriptor.homeServerIdentityId)}`,
    );
});

it.each(['oauth', 'mtls-claim', 'mtls-redirect', 'mtls-web'] as const)('presents a disabled Account on its captured Home after %s proof without committing credentials', async (flow) => {
    restore = installLocalStorageMock().restore;
    const fixture = createDirectoryHttpFixture();
    const homeA = await adoptHomeProfile({ descriptor: { ...fixture.home.connectionDescriptor,
        homeServerIdentityId: 'srv_home_a', canonicalServerUrl: 'https://home-a.test',
        endpoints: [{ kind: 'https', url: 'https://home-a.test' }] }, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
    const homeB = await adoptHomeProfile({ descriptor: fixture.home.connectionDescriptor,
        source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
    await setActiveServerId(homeA.id, { scope: 'device' });
    const activeHomeA = getActiveServerId();
    boundary.params.accountMode = 'plain';
    boundary.params.error = flow === 'mtls-redirect' ? 'account-disabled' : '';
    boundary.params.code = flow === 'mtls-redirect' ? '' : 'mtls-code';
    const provider = flow === 'oauth' ? 'github' : 'mtls';
    await TokenStorage.setPendingExternalAuth({ provider, proof: 'proof-b', serverUrl: homeB.serverUrl,
        serverId: 'srv_home_b', returnTo: '/setup/wizard' }, { serverUrl: homeB.serverUrl, serverId: 'srv_home_b' });
    boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
        if (path === '/v1/auth/external/github/finalize-keyless' || path === '/v1/auth/mtls/claim' || path === '/v1/auth/mtls') {
            expect(endpoint).toBe(homeB.serverUrl);
            return new Response(JSON.stringify({ error: 'account-disabled', message: 'private diagnostics' }), { status: 403 });
        }
        return fixture.request(endpoint, path, init);
    });
    screen = await renderScreen(<AuthProvider initialCredentials={null}>{flow === 'mtls-web' ? <></>
        : provider === 'mtls' ? <MtlsCallbackScreen /> : <OAuthProviderReturn />}</AuthProvider>);
    if (flow === 'mtls-web') {
        const target = { kind: 'descriptor', authority: 'current_connection', descriptor: fixture.home.connectionDescriptor } as const;
        await executeHomeAuthentication({
            request: {
                method: { id: 'mtls', enabledActions: [{ id: 'login', mode: 'keyless' }] },
                action: { id: 'login', mode: 'keyless' }, execution: { kind: 'mtls' },
                authority: { purpose: 'home', target }, intendedHome: target,
            },
            loginWithCredentials: async () => { throw new Error('Failed proof cannot commit credentials'); },
            returnTo: '/setup/wizard',
        });
    }
    await vi.waitFor(() => expect(Modal.alert).toHaveBeenCalledWith(t('common.error'), t('errors.accountDisabled', { home: homeB.serverUrl })));
    expect(getActiveServerId()).toBe(activeHomeA);
    expect(await TokenStorage.getCredentialsForServerUrl(homeB.serverUrl, { serverId: 'srv_home_b' })).toBeNull();
    expect(getCurrentAuth()?.credentials).toBeNull();
});

it.each([
    { provider: 'github', superseded: false, restoreRequired: false, accountCredentialReplaced: false },
    { provider: 'mtls', superseded: false, restoreRequired: false, accountCredentialReplaced: false },
    { provider: 'github', superseded: true, restoreRequired: false, accountCredentialReplaced: false },
    { provider: 'mtls', superseded: true, restoreRequired: false, accountCredentialReplaced: false },
    { provider: 'github', superseded: false, restoreRequired: true, accountCredentialReplaced: false },
    { provider: 'mtls', superseded: false, restoreRequired: true, accountCredentialReplaced: false },
    { provider: 'github', superseded: false, restoreRequired: false, accountCredentialReplaced: true },
    { provider: 'mtls', superseded: false, restoreRequired: false, accountCredentialReplaced: true },
    { provider: 'github', superseded: false, restoreRequired: true, accountCredentialReplaced: true },
    { provider: 'mtls', superseded: false, restoreRequired: true, accountCredentialReplaced: true },
])('preserves exact Home callback custody for $provider (superseded=$superseded, restoreRequired=$restoreRequired, accountCredentialReplaced=$accountCredentialReplaced)', async ({ provider, superseded, restoreRequired, accountCredentialReplaced }) => {
    boundary.params.code = 'mtls-code';
    boundary.params.accountMode = restoreRequired ? 'e2ee' : 'plain';
    boundary.params.error = provider === 'mtls' && restoreRequired ? 'restore_required' : '';
    restore = installLocalStorageMock().restore;
    const fixture = createDirectoryHttpFixture();
    fixture.state.homes = [];
    fixture.state.preferredHomeServerIdentityId = null;
    const homeA = await adoptHomeProfile({ descriptor: { ...fixture.home.connectionDescriptor,
        homeServerIdentityId: 'srv_home_a', canonicalServerUrl: 'https://home-a.test',
        endpoints: [{ kind: 'https', url: 'https://home-a.test' }] }, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
    const homeB = await adoptHomeProfile({ descriptor: { ...fixture.home.connectionDescriptor,
        endpoints: [{ kind: 'https', url: 'https://home-b-transport.test' }] }, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
    // These table rows intentionally reuse the same canonical Home identity.
    // Clear the exact scope before arranging this row so a successful earlier
    // row cannot masquerade as a credential committed by a superseded or
    // restore-required callback.
    await TokenStorage.removeCredentialsForServerUrl(homeB.serverUrl, { serverId: 'srv_home_b' });
    await setActiveServerId(homeA.id, { scope: 'device' });
    const activeHomeA = getActiveServerId();
    const focusChanges: string[] = [];
    const unsubscribeFocus = subscribeActiveServer((snapshot) => { if (snapshot.serverId !== activeHomeA) focusChanges.push(snapshot.serverId); });
    const credentialsA = { token: 'header.eyJzdWIiOiJhY2NvdW50LWEifQ.signature' };
    await TokenStorage.setCredentialsForServerUrl(homeA.serverUrl, { serverId: 'srv_home_a' }, credentialsA);
    const directoryTarget = { endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId };
    await TokenStorage.accountDirectoryAuthCredentials.set(directoryTarget, { token: 'directory-token' });
    const continuation = { endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId,
        canonicalServerUrl: fixture.service.canonicalServerUrl, entryIntent: { kind: 'enroll' as const, homeServerIdentityId: 'srv_home_b' },
        homeServerIdentityId: 'srv_home_b', returnTo: '/setup/wizard', accountEntryReturnTo: '/settings/account',
        credentialTokenDigest: 'C0jknAf55a-WIBFlxj8xId4cq00hoNQDzcbt4__9tlM' };
    await TokenStorage.setPendingExternalAuth({ provider, proof: 'proof-b', serverUrl: homeB.serverUrl,
        serverId: 'srv_home_b', returnTo: '/setup/wizard', accountContinuation: continuation },
    { serverUrl: homeB.serverUrl, serverId: 'srv_home_b' });
    if (accountCredentialReplaced && restoreRequired) {
        await TokenStorage.accountDirectoryAuthCredentials.set(directoryTarget, { token: 'replacement-directory-token' });
    }
    boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit, runtimeOrigin?: string) => {
        if (path === '/v1/auth/external/github/finalize-keyless' || path === '/v1/auth/mtls/claim') {
            expect(endpoint).toBe(homeB.serverUrl);
            if (!superseded) expect(runtimeOrigin).toBe('https://home-b-transport.test');
            if (superseded) {
                await TokenStorage.setPendingExternalAuth({ provider, proof: 'replacement-proof', serverUrl: homeB.serverUrl,
                    serverId: 'srv_home_b', returnTo: '/setup/wizard', accountContinuation: continuation },
                { serverUrl: homeB.serverUrl, serverId: 'srv_home_b' });
            }
            if (accountCredentialReplaced && !restoreRequired) {
                await TokenStorage.accountDirectoryAuthCredentials.set(directoryTarget, { token: 'replacement-directory-token' });
            }
            return new Response(JSON.stringify({ token: fixture.token }));
        }
        return fixture.request(endpoint, path, init);
    });
    screen = await renderScreen(<AuthProvider initialCredentials={credentialsA}>{provider === 'mtls' ? <MtlsCallbackScreen /> : <OAuthProviderReturn />}</AuthProvider>);
    if (superseded) {
        try {
            await vi.waitFor(() => expect(boundary.request.mock.calls.some(([, path]) =>
                path === '/v1/auth/external/github/finalize-keyless' || path === '/v1/auth/mtls/claim')).toBe(true));
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
            expect(await TokenStorage.getCredentialsForServerUrl(homeB.serverUrl, { serverId: 'srv_home_b' })).toBeNull();
            expect((await TokenStorage.readPendingExternalAuthContinuationState()).value?.proof).toBe('replacement-proof');
            expect(router.replace).not.toHaveBeenCalled();
            expect(focusChanges).toEqual([]);
        } finally { unsubscribeFocus(); }
        return;
    }
    if (accountCredentialReplaced) {
        if (!restoreRequired) {
            await vi.waitFor(() => expect(boundary.request.mock.calls.some(([, path]) =>
                path === '/v1/auth/external/github/finalize-keyless' || path === '/v1/auth/mtls/claim')).toBe(true));
        }
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
        expect(await TokenStorage.accountDirectoryAuthCredentials.get(directoryTarget)).toEqual({ token: 'replacement-directory-token' });
        expect(TokenStorage.readAccountDirectoryOAuthReturn({
            ...directoryTarget,
            intent: continuation.entryIntent,
            invokingSurface: continuation.returnTo,
            accountEntryReturnTo: continuation.accountEntryReturnTo,
        })).toBeNull();
        expect(vi.mocked(router.replace).mock.calls.some(([destination]) =>
            typeof destination === 'object' && destination !== null && 'params' in destination
            && destination.params && typeof destination.params === 'object'
            && 'accountServiceReturn' in destination.params)).toBe(false);
        expect(fixture.state.calls.some(({ path }) => path.startsWith('/v1/account-directory/'))).toBe(false);
        unsubscribeFocus();
        return;
    }
    try {
        await vi.waitFor(() => {
            expect(focusChanges).toEqual([]);
            expect(router.replace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/setup/wizard',
                params: expect.objectContaining({ accountServiceReturn: '1', accountEntryReturnTo: '/settings/account' }) }));
        });
    } finally { unsubscribeFocus(); }
    expect(getActiveServerId()).toBe(activeHomeA);
    expect(getCurrentAuth()?.credentials).toEqual(credentialsA);
    expect(await TokenStorage.getCredentialsForServerUrl(homeB.serverUrl, { serverId: 'srv_home_b' })).toEqual(restoreRequired ? null : { token: fixture.token });
    const destination = vi.mocked(router.replace).mock.calls.at(-1)?.[0];
    if (!destination || typeof destination !== 'object' || !('params' in destination) || !destination.params) throw new Error('Expected sanitized return');
    expect(JSON.stringify(destination)).not.toContain(fixture.token);
    const options = { invokingSurface: '/setup/wizard', signal: new AbortController().signal };
    const returned = await consumeAccountServiceOAuthReturn(destination.params, options);
    expect(returned).toMatchObject({ kind: 'consumed', result: restoreRequired
        ? { kind: 'failure', recovery: 'use_home_auth', targetHomeServerIdentityId: 'srv_home_b', homeCredentialCommitted: false }
        : { kind: 'home_enrolled', homeServerIdentityId: 'srv_home_b' } });
    expect(fixture.state.calls.some(({ path }) => path.startsWith('/v1/account-directory/') || path === '/v1/auth/home-login')).toBe(false);
    expect(await consumeAccountServiceOAuthReturn(destination.params, options)).toEqual({ kind: 'invalid' });
});
