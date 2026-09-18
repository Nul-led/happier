import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import type { AccountServiceAuthenticationFlowProps } from './AccountServiceAuthenticationFlow';
import { TokenStorage, type PendingAccountDirectoryAuth } from '@/auth/storage/tokenStorage';

const authClient = vi.hoisted(() => ({ startOAuth: vi.fn() }));
const linking = vi.hoisted(() => ({ openURL: vi.fn(async () => {}) }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return { ...await createReactNativeWebMock(), Linking: linking };
});
vi.mock('@/auth/accountDirectory/accountDirectoryAuthClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/auth/accountDirectory/accountDirectoryAuthClient')>(),
    accountDirectoryAuthClient: authClient,
}));
vi.mock('@/components/account/auth/AccountDirectoryKeyLoginForm', () => ({
    AccountDirectoryKeyLoginForm: (props: Record<string, unknown>) => React.createElement('AccountDirectoryKeyLoginForm', props),
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

import { AccountServiceAuthenticationFlow } from './AccountServiceAuthenticationFlow';

const capability = {
    version: 1 as const,
    homeDirectory: true,
    homeEnrollment: true,
    homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) },
};
const service = {
    authority: {
        endpointUrl: 'https://accounts.example.test', serverIdentityId: 'srv_accounts',
        canonicalServerUrl: 'https://accounts.example.test', capability,
        snapshot: { status: 'ready' as const, features: createRootLayoutFeaturesResponse(), serverIdentityId: 'srv_accounts' },
    },
    displayName: 'Acme',
    authenticationActions: [
        {
            method: { id: 'github', enabledActions: [{ id: 'provision' as const, mode: 'either' as const }, { id: 'login' as const, mode: 'keyless' as const }] },
            action: { id: 'provision' as const, mode: 'either' as const },
            execution: { kind: 'oauth' as const, providerId: 'github', mode: 'keyed' as const },
        },
        {
            method: { id: 'github', enabledActions: [{ id: 'provision' as const, mode: 'either' as const }, { id: 'login' as const, mode: 'keyless' as const }] },
            action: { id: 'login' as const, mode: 'keyless' as const },
            execution: { kind: 'oauth' as const, providerId: 'github', mode: 'keyless' as const },
        },
        {
            method: { id: 'key_challenge', enabledActions: [{ id: 'provision' as const, mode: 'keyed' as const }] },
            action: { id: 'provision' as const, mode: 'keyed' as const },
            execution: { kind: 'generated_key' as const },
        },
        {
            method: { id: 'key_challenge', enabledActions: [{ id: 'login' as const, mode: 'keyed' as const }] },
            action: { id: 'login' as const, mode: 'keyed' as const },
            execution: { kind: 'key_entry' as const },
        },
    ],
    transport: { runtimeOrigin: 'http://127.0.0.1:43123' },
} satisfies AccountServiceAuthenticationFlowProps['service'];
const intent = { kind: 'enter', target: { kind: 'automatic' } } as const;
const pending: PendingAccountDirectoryAuth = {
    endpoint: service.authority.endpointUrl,
    serverIdentityId: service.authority.serverIdentityId,
    canonicalServerUrl: service.authority.canonicalServerUrl,
    provider: 'github',
    purpose: 'account_directory',
    credentialTarget: 'account_directory',
    entryIntent: intent,
    mode: 'keyless',
    proof: 'exact-proof',
    createdAt: 1,
    expiresAt: 2,
    returnTo: '/setup/wizard',
};
const startResult = { url: 'https://oauth.example.test/start', pending } as const;

describe('AccountServiceAuthenticationFlow', () => {
    beforeEach(() => {
        authClient.startOAuth.mockReset();
        linking.openURL.mockClear();
    });

    it('preserves exact catalog method/action order and dispatches the tuple mode', async () => {
        authClient.startOAuth.mockResolvedValue(startResult);
        const screen = await renderScreen(<AccountServiceAuthenticationFlow service={service} intent={intent}
            returnTo="/setup/wizard" onResult={vi.fn()} onExternalAuthStarted={vi.fn()} onBack={vi.fn()} />);
        expect([
            screen.findByTestId('account-service-auth-github-provision-either')?.props.testID,
            screen.findByTestId('account-service-auth-github-login-keyless')?.props.testID,
            screen.findByTestId('account-service-auth-key_challenge-provision-keyed')?.props.testID,
            screen.findByTestId('account-service-auth-key_challenge-login-keyed')?.props.testID,
        ]).toEqual([
            'account-service-auth-github-provision-either',
            'account-service-auth-github-login-keyless',
            'account-service-auth-key_challenge-provision-keyed',
            'account-service-auth-key_challenge-login-keyed',
        ]);
        await screen.pressByTestIdAsync('account-service-auth-github-provision-either');
        expect(authClient.startOAuth).toHaveBeenCalledWith(expect.objectContaining({
            providerId: 'github', mode: 'keyed', entryIntent: intent, returnTo: '/setup/wizard',
            transport: service.transport,
        }));
    });

    it('starts generated-key provisioning without opening the key-entry form', async () => {
        const screen = await renderScreen(<AccountServiceAuthenticationFlow service={service} intent={intent}
            returnTo="/setup/wizard" onResult={vi.fn()} onExternalAuthStarted={vi.fn()} onBack={vi.fn()} />);

        await screen.pressByTestIdAsync('account-service-auth-key_challenge-provision-keyed');

        expect(screen.findByType('AccountDirectoryKeyLoginForm')?.props.mode).toBe('provision');
    });

    it('admits one sibling ceremony and releases the guard after a failed launch', async () => {
        let reject!: (error: Error) => void;
        authClient.startOAuth.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
        const screen = await renderScreen(<AccountServiceAuthenticationFlow service={service} intent={intent}
            returnTo="/setup/wizard" onResult={vi.fn()} onExternalAuthStarted={vi.fn()} onBack={vi.fn()} />);
        const first = screen.findByTestId('account-service-auth-github-provision-either');
        const sibling = screen.findByTestId('account-service-auth-github-login-keyless');
        if (!first || !sibling) throw new Error('Expected both Account Service actions');
        const pressFirst = first.props.onPress;
        const pressSibling = sibling.props.onPress;
        act(() => { pressFirst(); pressSibling(); });
        expect(authClient.startOAuth).toHaveBeenCalledTimes(1);
        await act(async () => reject(new Error('failed')));
        await screen.pressByTestIdAsync('account-service-auth-launch-failed-action');
        await screen.pressByTestIdAsync('account-service-auth-github-login-keyless');
        expect(authClient.startOAuth).toHaveBeenCalledTimes(2);
    });

    it('does not open a returned OAuth URL after the invoking surface becomes stale', async () => {
        const clearPending = vi.spyOn(TokenStorage, 'clearPendingAccountDirectoryAuth')
            .mockResolvedValue(true);
        let resolve!: (result: typeof startResult) => void;
        let current = true;
        authClient.startOAuth.mockReturnValue(new Promise((resolvePromise) => { resolve = resolvePromise; }));
        const screen = await renderScreen(<AccountServiceAuthenticationFlow service={service} intent={intent}
            returnTo="/setup/wizard" onResult={vi.fn()} onExternalAuthStarted={vi.fn()} onBack={vi.fn()}
            isCurrent={() => current} />);

        const launch = screen.pressByTestIdAsync('account-service-auth-github-login-keyless');
        await vi.waitFor(() => expect(authClient.startOAuth).toHaveBeenCalledTimes(1));
        current = false;
        resolve(startResult);
        await launch;

        expect(linking.openURL).not.toHaveBeenCalled();
        expect(clearPending).toHaveBeenCalledWith({
            endpoint: service.authority.endpointUrl,
            serverIdentityId: service.authority.serverIdentityId,
        }, { expected: pending });
    });

    it('forwards cancellation and does not open a late OAuth URL after the journey aborts', async () => {
        const clearPending = vi.spyOn(TokenStorage, 'clearPendingAccountDirectoryAuth')
            .mockResolvedValue(true);
        let resolve!: (result: typeof startResult) => void;
        authClient.startOAuth.mockReturnValue(new Promise((resolvePromise) => { resolve = resolvePromise; }));
        const controller = new AbortController();
        const screen = await renderScreen(<AccountServiceAuthenticationFlow service={service} intent={intent}
            returnTo="/setup/wizard" onResult={vi.fn()} onExternalAuthStarted={vi.fn()} onBack={vi.fn()}
            signal={controller.signal} />);

        const launch = screen.pressByTestIdAsync('account-service-auth-github-login-keyless');
        await vi.waitFor(() => expect(authClient.startOAuth).toHaveBeenCalledWith(expect.objectContaining({
            signal: controller.signal,
        })));
        controller.abort();
        resolve(startResult);
        await launch;

        expect(linking.openURL).not.toHaveBeenCalled();
        expect(clearPending).toHaveBeenCalledWith({
            endpoint: service.authority.endpointUrl,
            serverIdentityId: service.authority.serverIdentityId,
        }, { expected: pending });
        expect(screen.findAllByTestId('account-service-auth-launch-failed')).toHaveLength(0);
    });
});
