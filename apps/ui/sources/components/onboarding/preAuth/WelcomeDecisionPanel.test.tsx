import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { AccountServiceEntryOptions } from '@/components/account/auth/useAccountServiceEntryOptions';
import type { AuthEntryOptions } from '@/components/account/auth/useAuthEntryOptions';

import { WelcomeDecisionPanel } from './WelcomeDecisionPanel';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));

const baseOptions: AuthEntryOptions = {
    serverAvailability: 'ready',
    serverUrlForCopy: 'https://relay.example.test',
    showAuthActions: true,
    showProviderSignup: false,
    showAnonymousSignup: true,
    showMtlsLogin: false,
    showKeylessProviderLogin: false,
    providerId: null,
    keylessProviderId: null,
    providerSignupTitle: '',
    providerKeylessTitle: '',
    anonymousSignupTitle: 'Create account',
    mtlsTitle: 'Sign in with certificate',
    primaryAction: {
        kind: 'anonymous',
        title: 'Create account',
    },
    mtlsPrimary: false,
    keylessPrimary: false,
    autoRedirect: {
        enabled: false,
        providerId: null,
        toKeyedProvision: false,
        toKeylessLogin: false,
        toMtls: false,
        toLegacySignupProvider: false,
    },
    retryServerCheck: () => {},
};

function flattenStyle(style: unknown): Record<string, unknown> {
    if (typeof style === 'function') {
        const resolvePressableStyle = style as (state: { pressed: boolean }) => unknown;
        return flattenStyle(resolvePressableStyle({ pressed: false }));
    }
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

function renderPanel(
    overrides: Partial<AuthEntryOptions> = {},
    accountServiceEntry?: AccountServiceEntryOptions,
) {
    const callbacks = {
        onCreateAccount: vi.fn(),
        onCreateAccountViaProvider: vi.fn(),
        onLoginWithKeylessProvider: vi.fn(),
        onLoginWithMtls: vi.fn(),
        onOpenRestore: vi.fn(),
        onChangeRelay: vi.fn(),
        onContinueWithAccountServiceProvider: vi.fn(),
        onContinueWithAccountServiceKey: vi.fn(),
        onChooseAccountService: vi.fn(),
    };

    return {
        callbacks,
        screenPromise: renderScreen(
            <WelcomeDecisionPanel
                authEntryOptions={{ ...baseOptions, ...overrides }}
                accountServiceEntry={accountServiceEntry}
                {...callbacks}
            />,
        ),
    };
}

function readyAccountServiceEntry(
    oauthProviderIds: readonly string[],
    options: Readonly<{ keyLoginAvailable?: boolean }> = {},
): AccountServiceEntryOptions {
    return {
        endpoint: { url: 'https://api.happier.dev', displayName: 'Happier Cloud', source: 'default' },
        status: 'ready',
        discovery: {
            endpointUrl: 'https://api.happier.dev',
            serverIdentityId: 'srv_cloud_identity',
            canonicalServerUrl: 'https://api.happier.dev',
            capability: {
                version: 1,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: {
                    keyId: 'a'.repeat(64),
                    publicKeyBase64Url: 'A'.repeat(43),
                },
            },
            keyLoginAvailable: options.keyLoginAvailable ?? false,
            oauthProviderIds,
            preferredProvisionProviderId: oauthProviderIds[0] ?? null,
        },
    };
}

describe('WelcomeDecisionPanel', () => {
    it('routes anonymous start and restore actions from stable controls', async () => {
        const { callbacks, screenPromise } = renderPanel();
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-decision-panel')).toBeTruthy();
        expect(screen.findAllByTestId('welcome-private-key-copy')).toHaveLength(0);
        expect(screen.findByTestId('welcome-primary-start-title')).toBeTruthy();
        expect(screen.findByTestId('welcome-primary-start-subtitle')).toBeTruthy();
        expect(screen.findByTestId('welcome-primary-start-icon')).toBeTruthy();
        expect(screen.findByTestId('welcome-scan-existing-home-title')).toBeTruthy();
        expect(screen.findByTestId('welcome-scan-existing-home-icon')).toBeTruthy();
        expect(screen.findByTestId('welcome-use-different-home-title')).toBeTruthy();
        expect(screen.findByTestId('welcome-primary-start-title')?.props.children).toBe('First time here — let\'s start');
        expect(screen.findByTestId('welcome-scan-existing-home-title')?.props.children).toBe('Scan a QR from an existing Home');
        expect(screen.findByTestId('welcome-use-different-home-title')?.props.children).toBe('Use a different Home');
        const primaryStyle = flattenStyle(screen.findByTestId('welcome-primary-start')?.props.style);
        const textBlockStyle = flattenStyle(screen.findByTestId('welcome-primary-start-text')?.props.style);
        expect(primaryStyle.minHeight).toBe(66);
        expect(primaryStyle.paddingHorizontal).toBe(18);
        expect(primaryStyle.paddingVertical).toBe(10);
        expect(textBlockStyle.gap).toBe(0);
        expect(screen.findByTestId('welcome-primary-start')?.props.accessibilityHint)
            .toBe('One tap. No form. Your key lives here.');

        await screen.pressByTestIdAsync('welcome-primary-start');
        await screen.pressByTestIdAsync('welcome-scan-existing-home');
        await screen.pressByTestIdAsync('welcome-use-different-home');

        expect(callbacks.onCreateAccount).toHaveBeenCalledTimes(1);
        expect(callbacks.onOpenRestore).toHaveBeenCalledTimes(1);
        expect(callbacks.onChangeRelay).toHaveBeenCalledTimes(1);
    });

    it('uses provider signup without rendering anonymous private-key copy', async () => {
        const { callbacks, screenPromise } = renderPanel({
            showAnonymousSignup: false,
            showProviderSignup: true,
            providerId: 'github',
            providerSignupTitle: 'Continue with GitHub',
            primaryAction: {
                kind: 'provider-keyed',
                title: 'Continue with GitHub',
            },
        });
        const screen = await screenPromise;

        expect(screen.findAllByTestId('welcome-private-key-copy')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);

        await screen.pressByTestIdAsync('welcome-provider-primary');

        expect(callbacks.onCreateAccountViaProvider).toHaveBeenCalledWith('github');
    });

    it('uses keyless provider login without rendering anonymous private-key copy', async () => {
        const { callbacks, screenPromise } = renderPanel({
            showAnonymousSignup: false,
            showKeylessProviderLogin: true,
            keylessPrimary: true,
            keylessProviderId: 'github',
            providerKeylessTitle: 'Continue with GitHub',
            primaryAction: {
                kind: 'keyless',
                title: 'Continue with GitHub',
            },
        });
        const screen = await screenPromise;

        expect(screen.findAllByTestId('welcome-private-key-copy')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);

        await screen.pressByTestIdAsync('welcome-provider-primary');

        expect(callbacks.onLoginWithKeylessProvider).toHaveBeenCalledWith('github');
    });

    it('keeps a visible secondary keyless provider login when anonymous signup remains primary', async () => {
        const { callbacks, screenPromise } = renderPanel({
            showAnonymousSignup: true,
            showKeylessProviderLogin: true,
            keylessPrimary: false,
            keylessProviderId: 'github',
            providerKeylessTitle: 'Continue with GitHub',
            primaryAction: {
                kind: 'anonymous',
                title: 'Create account',
            },
        });
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-primary-start')).toBeTruthy();
        expect(screen.findByTestId('welcome-login-provider')).toBeTruthy();

        await screen.pressByTestIdAsync('welcome-login-provider');

        expect(callbacks.onLoginWithKeylessProvider).toHaveBeenCalledWith('github');
    });

    it('uses mTLS login without rendering anonymous private-key copy', async () => {
        const { callbacks, screenPromise } = renderPanel({
            showAnonymousSignup: false,
            showMtlsLogin: true,
            mtlsPrimary: true,
            primaryAction: {
                kind: 'mtls',
                title: 'Sign in with certificate',
            },
        });
        const screen = await screenPromise;

        expect(screen.findAllByTestId('welcome-private-key-copy')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);

        await screen.pressByTestIdAsync('welcome-mtls-primary');

        expect(callbacks.onLoginWithMtls).toHaveBeenCalledTimes(1);
    });

    it('shows loading state without auth actions before capabilities resolve', async () => {
        const { screenPromise } = renderPanel({
            serverAvailability: 'loading',
            showAuthActions: false,
            showAnonymousSignup: false,
        });
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-auth-loading')).toBeTruthy();
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-scan-existing-home')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-private-key-copy')).toHaveLength(0);
    });

    it('keeps retry and relay-change actions available when the server is unavailable', async () => {
        const retryServerCheck = vi.fn();
        const { callbacks, screenPromise } = renderPanel({
            serverAvailability: 'unavailable',
            showAuthActions: false,
            showAnonymousSignup: false,
            retryServerCheck,
        });
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-auth-blocked')).toBeTruthy();
        expect(screen.findAllByTestId('welcome-private-key-copy')).toHaveLength(0);

        await screen.pressByTestIdAsync('welcome-auth-blocked-change-relay');
        await screen.pressByTestIdAsync('welcome-auth-blocked-retry');

        expect(callbacks.onChangeRelay).toHaveBeenCalledTimes(1);
        expect(retryServerCheck).toHaveBeenCalledTimes(1);
    });

    it('offers the selected sign-in service methods as familiar provider actions and keeps QR entry', async () => {
        const { callbacks, screenPromise } = renderPanel(
            { showAnonymousSignup: true, showProviderSignup: true, providerId: 'github' },
            readyAccountServiceEntry(['github', 'google']),
        );
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-account-service-provider-github-title')?.props.children)
            .toBe('Continue with GitHub');
        expect(screen.findByTestId('welcome-account-service-provider-google')).toBeTruthy();
        // The Home-targeted welcome actions are replaced, not shown beside the service actions.
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-signup-provider')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-private-key-copy')).toHaveLength(0);
        // Direct QR entry stays available.
        expect(screen.findByTestId('welcome-scan-existing-home')).toBeTruthy();
        expect(screen.findByTestId('welcome-use-different-home')).toBeTruthy();

        await screen.pressByTestIdAsync('welcome-account-service-provider-google');
        await screen.pressByTestIdAsync('welcome-scan-existing-home');

        expect(callbacks.onContinueWithAccountServiceProvider).toHaveBeenCalledWith('google');
        expect(callbacks.onCreateAccountViaProvider).not.toHaveBeenCalled();
        expect(callbacks.onOpenRestore).toHaveBeenCalledTimes(1);
    });

    it('offers the advertised key method for a key-only selected sign-in service', async () => {
        const { callbacks, screenPromise } = renderPanel(
            { showAnonymousSignup: true },
            readyAccountServiceEntry([], { keyLoginAvailable: true }),
        );
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-account-service-key')?.props.accessibilityLabel)
            .toBe('Use a key');
        // The key-only service owns the welcome sign-in path; Home-targeted actions stay hidden.
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-private-key-copy')).toHaveLength(0);
        // Direct QR entry stays available.
        expect(screen.findByTestId('welcome-scan-existing-home')).toBeTruthy();
        expect(screen.findByTestId('welcome-use-different-home')).toBeTruthy();

        await screen.pressByTestIdAsync('welcome-account-service-key');

        expect(callbacks.onContinueWithAccountServiceKey).toHaveBeenCalledTimes(1);
        expect(callbacks.onCreateAccount).not.toHaveBeenCalled();
        expect(callbacks.onContinueWithAccountServiceProvider).not.toHaveBeenCalled();
    });

    it('keeps the ordinary Home entry when the selected service does not advertise key login', async () => {
        const { screenPromise } = renderPanel(
            { showAnonymousSignup: true },
            readyAccountServiceEntry([], { keyLoginAvailable: false }),
        );
        const screen = await screenPromise;

        expect(screen.findAllByTestId('welcome-account-service-key')).toHaveLength(0);
        expect(screen.findByTestId('welcome-primary-start')).toBeTruthy();
    });

    it('waits for the selected sign-in service instead of flashing Home-targeted actions', async () => {
        const { screenPromise } = renderPanel({}, {
            endpoint: { url: 'https://api.happier.dev', source: 'default' },
            status: 'loading',
            discovery: null,
        });
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-auth-loading')).toBeTruthy();
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
    });

    it('keeps an unavailable custom sign-in service authoritative and offers recovery without focused-Home auth', async () => {
        const retry = vi.fn();
        const { callbacks, screenPromise } = renderPanel({}, {
            endpoint: { url: 'https://accounts.company.test', source: 'user' },
            status: 'unavailable',
            discovery: null,
            retry,
        } as unknown as AccountServiceEntryOptions);
        const screen = await screenPromise;

        expect(screen.findAllByTestId('welcome-account-service-provider-github')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-provider-primary')).toHaveLength(0);
        expect(screen.findByTestId('welcome-account-service-recovery')).toBeTruthy();
        expect(screen.findByTestId('welcome-account-service-choose')).toBeTruthy();
        expect(screen.findByTestId('welcome-scan-existing-home')).toBeTruthy();
        expect(screen.findByTestId('welcome-use-different-home')).toBeTruthy();

        await screen.pressByTestIdAsync('welcome-account-service-retry');
        await screen.pressByTestIdAsync('welcome-account-service-choose');

        expect(retry).toHaveBeenCalledTimes(1);
        expect(callbacks.onChooseAccountService).toHaveBeenCalledTimes(1);
        expect(callbacks.onCreateAccount).not.toHaveBeenCalled();
        expect(callbacks.onContinueWithAccountServiceProvider).not.toHaveBeenCalled();
    });

    it('keeps an unsupported selected sign-in service authoritative', async () => {
        const { screenPromise } = renderPanel({}, {
            endpoint: { url: 'https://ordinary-home.test', source: 'user' },
            status: 'unsupported',
            discovery: null,
            retry: vi.fn(),
        } as unknown as AccountServiceEntryOptions);
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-account-service-recovery')).toBeTruthy();
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-provider-primary')).toHaveLength(0);
    });

    it('promotes login and explains the policy when the server exposes no signup action', async () => {
        const { callbacks, screenPromise } = renderPanel({
            showAnonymousSignup: false,
            showProviderSignup: false,
            primaryAction: null,
        });
        const screen = await screenPromise;

        expect(screen.findByTestId('welcome-signup-disabled')).toBeTruthy();
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-provider-primary')).toHaveLength(0);
        expect(screen.findByTestId('welcome-scan-existing-home')).toBeTruthy();
        expect(screen.findByTestId('welcome-use-different-home')).toBeTruthy();

        await screen.pressByTestIdAsync('welcome-scan-existing-home');

        expect(callbacks.onOpenRestore).toHaveBeenCalledTimes(1);
        expect(callbacks.onCreateAccount).not.toHaveBeenCalled();
    });
});
