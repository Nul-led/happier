import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';
import { cancelPendingDirectoryHomeEnrollment } from '@/sync/ops/accountDirectory/enrollDirectoryHome';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn() }));
const modalBoundary = vi.hoisted(() => ({ show: vi.fn(() => 'generated-key-backup') }));
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (options: { endpointUrl: string }) => (path: string, init?: RequestInit) => boundary.request(options.endpointUrl, path, init),
    serverFetch: (path: string, init?: RequestInit) => boundary.request('ambient', path, init),
}));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => {
    const module = (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module;
    return { ...module, Modal: { ...module.Modal, show: modalBoundary.show } };
});

import { AccountDirectoryKeyLoginForm } from './AccountDirectoryKeyLoginForm';

let restore: () => void;
let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
beforeEach(() => { restore = installLocalStorageMock().restore; modalBoundary.show.mockClear(); boundary.request.mockReset(); });
afterEach(async () => { await screen?.unmount(); screen = undefined; await cancelPendingDirectoryHomeEnrollment(); restore(); });

it('retains the chosen Home through exact Account reauthentication', async () => {
    const fixture = createDirectoryHttpFixture();
    fixture.state.homes.push({ ...fixture.home, homeServerIdentityId: 'srv_other', label: 'Other Home',
        canonicalServerUrl: 'https://other.test',
        connectionDescriptor: { ...fixture.home.connectionDescriptor, homeServerIdentityId: 'srv_other',
            canonicalServerUrl: 'https://other.test', endpoints: [{ kind: 'https', url: 'https://other.test' }] },
    });
    fixture.state.preferredHomeServerIdentityId = null;
    fixture.state.homes = fixture.state.homes.map((home) => ({ ...home, preferred: false }));
    boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
        if (path === '/v1/auth/account-directory/challenge') return new Response(JSON.stringify({
            challengeId: 'directory-challenge', nonce: 'nonce', issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            audience: { origin: fixture.service.canonicalServerUrl, serverIdentityId: fixture.service.serverIdentityId },
        }));
        if (path === '/v1/auth/account-directory') return new Response(JSON.stringify({ token: 'directory-token' }));
        return fixture.request(endpoint, path, init);
    });
    const onResult = vi.fn();
    screen = await renderScreen(<AccountDirectoryKeyLoginForm service={fixture.service} serviceName="Directory"
        intent={{ kind: 'enter', target: { kind: 'automatic' } }} onBack={() => {}} onResult={onResult} />);
    const login = async () => {
        await act(async () => { screen!.findByTestId('restore-manual-secret-input')!.props.onChangeText('A'.repeat(43)); });
        await screen!.pressByTestIdAsync('restore-manual-submit');
    };
    await login();
    await vi.waitFor(() => expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'choose_home' })));
    fixture.state.directoryStatus = 401;
    await screen.pressByTestIdAsync(`account-service-choose-home-${fixture.home.homeServerIdentityId}`);
    await vi.waitFor(() => expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'failure', recovery: 'reauthenticate_account' })));
    await screen.pressByTestIdAsync('account-service-continuation-failure-action');
    fixture.state.directoryStatus = 200;
    fixture.state.homes = [];
    await login();
    await vi.waitFor(() => expect(onResult).toHaveBeenLastCalledWith({ kind: 'explicit_target_not_linked', homeServerIdentityId: fixture.home.homeServerIdentityId }));
});

it('authenticates a generated key and continues without an extra success tap', async () => {
    const fixture = createDirectoryHttpFixture();
    boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
        if (path === '/v1/auth/account-directory/challenge') return new Response(JSON.stringify({
            challengeId: 'directory-challenge', nonce: 'nonce', issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            audience: { origin: fixture.service.canonicalServerUrl, serverIdentityId: fixture.service.serverIdentityId },
        }));
        if (path === '/v1/auth/account-directory') return new Response(JSON.stringify({ token: 'directory-token' }));
        return fixture.request(endpoint, path, init);
    });
    const onResult = vi.fn();
    screen = await renderScreen(<AccountDirectoryKeyLoginForm service={fixture.service} serviceName="Directory" mode="provision"
        intent={{ kind: 'enter', target: { kind: 'automatic' } }} onBack={() => {}} onResult={onResult} />);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'approval_required' })));
    expect(modalBoundary.show).not.toHaveBeenCalled();
    expect(screen.findByTestId('account-service-continuation-approval_required')).not.toBeNull();
    expect(boundary.request.mock.calls.every(([endpoint]) => endpoint === fixture.service.endpointUrl || endpoint === fixture.home.canonicalServerUrl)).toBe(true);
});
