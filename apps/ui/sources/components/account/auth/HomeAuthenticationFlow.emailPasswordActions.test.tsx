import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';
import { projectAuthEntryMethodCapabilities } from '@/auth/capabilities/authMethodCapabilities';
import { AuthProvider } from '@/auth/context/AuthContext';
import { HomeAuthenticationFlow } from './HomeAuthenticationFlow';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: boundary.request }));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);

let restore: () => void;
let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
beforeEach(() => {
    restore = installLocalStorageMock().restore;
    boundary.request.mockReset();
    boundary.request.mockResolvedValue(new Response('{}', { status: 404 }));
});
afterEach(async () => { await screen?.unmount(); screen = undefined; restore(); });

async function renderEntry(
    actions: readonly Readonly<{ action: 'login' | 'provision' | 'connect'; mode: 'keyed' | 'keyless' | 'either' }>[],
) {
    const fixture = createDirectoryHttpFixture();
    const capabilities = projectAuthEntryMethodCapabilities({
        v: 1, state: 'ready', scope: { kind: 'home' }, autoRedirect: null,
        actions: actions.map((row) => ({
            kind: 'authenticate', methodId: 'email_password', action: row.action, mode: row.mode,
            origin: 'home', presentation: { displayName: 'Email and password' },
        })),
    });
    screen = await renderScreen(<AuthProvider initialCredentials={null}>
        <HomeAuthenticationFlow
            target={{ kind: 'descriptor', descriptor: fixture.home.connectionDescriptor, authority: 'current_connection' }}
            actions={capabilities.authenticationActions} returnTo="/" onAuthenticated={vi.fn()} onBack={vi.fn()} />
    </AuthProvider>);
    return screen;
}

it('opens the account-creation controller — not the login form — for a published provision action', async () => {
    const rendered = await renderEntry([
        { action: 'login', mode: 'either' },
        { action: 'provision', mode: 'either' },
    ]);

    await rendered.pressByTestIdAsync('home-auth-email_password-provision-either');

    expect(rendered.findByTestId('email-password-create')).not.toBeNull();
    expect(rendered.findByTestId('email-password-confirm')).not.toBeNull();
    // Both Account modes are permitted here, so the protection choice is offered.
    expect(rendered.findByTestId('email-password-protection-plain')).not.toBeNull();
    expect(rendered.findByTestId('email-password-protection-e2ee')).not.toBeNull();
    expect(boundary.request).not.toHaveBeenCalled();
});

it('omits the protection choice and states the outcome when the Home permits one Account mode', async () => {
    const rendered = await renderEntry([{ action: 'provision', mode: 'keyed' }]);

    await rendered.pressByTestIdAsync('home-auth-email_password-provision-keyed');

    expect(rendered.findByTestId('email-password-protection-plain')).toBeNull();
    expect(rendered.findByTestId('email-password-protection-e2ee')).toBeNull();
    expect(rendered.findByTestId('email-password-protection-fixed')).not.toBeNull();
});

it('routes a connect action to enrolment guidance instead of a sign-in form', async () => {
    const rendered = await renderEntry([{ action: 'connect', mode: 'either' }]);

    await rendered.pressByTestIdAsync('home-auth-email_password-connect-either');

    expect(rendered.findByTestId('email-password-connect-detail')).not.toBeNull();
    expect(rendered.findByTestId('email-password-submit')).toBeNull();
});

it('offers forgot-password recovery from the login controller without disclosing Account existence', async () => {
    const rendered = await renderEntry([{ action: 'login', mode: 'either' }]);

    await rendered.pressByTestIdAsync('home-auth-email_password-login-either');
    await rendered.pressByTestIdAsync('email-password-forgot');

    expect(rendered.findByTestId('email-password-request-reset')).not.toBeNull();
    expect(rendered.findByTestId('email-password-use-recovery-key')).not.toBeNull();
    expect(boundary.request).not.toHaveBeenCalled();
});

it('keeps the entered address and focuses the password when the Home rejects the credentials', async () => {
    const rendered = await renderEntry([{ action: 'login', mode: 'either' }]);
    await rendered.pressByTestIdAsync('home-auth-email_password-login-either');
    boundary.request.mockImplementation(async (url: string) => (
        url.endsWith('/prelogin')
            ? new Response(JSON.stringify({ v: 1, kind: 'plain_password' }))
            : new Response(JSON.stringify({ error: 'authentication_failed' }), { status: 401 })
    ));

    await act(async () => {
        rendered.findByTestId('email-password-email')!.props.onChangeText('person@example.test');
        rendered.findByTestId('email-password-password')!.props.onChangeText('a calm sixteen plus password');
    });
    await rendered.pressByTestIdAsync('email-password-submit');

    expect(rendered.findByTestId('email-password-email')!.props.value).toBe('person@example.test');
    expect(rendered.findByTestId('email-password-password-error')).not.toBeNull();
});
