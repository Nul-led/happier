import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { setAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';

/**
 * Unauthenticated Welcome sign-in against the selected Account Service (Lane 02 A7 / G02-1, G02-2).
 *
 * These assertions are deliberately about the exact request target: a focused Home must never be
 * able to retarget sign-in-service discovery or the provider continuation.
 */

const SELECTED_SERVICE_URL = 'https://api.happier.dev';
const SELECTED_SERVICE_IDENTITY = 'srv_cloud_identity';
const PREFERRED_HOME_IDENTITY = 'srv_home_preferred';
const OTHER_SERVICE_URL = 'https://other.happier.dev';
const OTHER_SERVICE_IDENTITY = 'srv_other_identity';
const FOCUSED_HOME_URL = 'https://home-a.example.test';

const discoverAuthenticationMethodsMock = vi.hoisted(() => vi.fn());
const startOAuthMock = vi.hoisted(() => vi.fn());
const loginWithKeyMock = vi.hoisted(() => vi.fn<
    (...args: unknown[]) => Promise<{ token: string }>
>(async () => ({ token: 'restricted-directory-token' })));
const refreshOpMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    endpoint: SELECTED_SERVICE_URL,
    status: 'ready',
    homes: [],
    preferredHomeServerIdentityId: PREFERRED_HOME_IDENTITY,
    refreshedAtMs: 1,
    error: null,
    reconciliation: { kind: 'not_run' },
})));
const enrollOpMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    kind: 'enrolled',
    homeServerIdentityId: PREFERRED_HOME_IDENTITY,
})));
const finalizeIntentMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<'completed'>>(async () => 'completed'));
const modalPromptMock = vi.hoisted(() => vi.fn(async () => null as string | null));
const modalAlertMock = vi.hoisted(() => vi.fn(() => {}));
const modalAlertAsyncMock = vi.hoisted(() => vi.fn(async () => {}));
const getActiveServerSnapshotMock = vi.hoisted(() => vi.fn(() => ({
    serverId: 'home-a',
    serverUrl: 'https://home-a.example.test',
    generation: 1,
})));
const setPendingExternalAuthMock = vi.hoisted(() => vi.fn(async () => true));
const clearPendingExternalAuthMock = vi.hoisted(() => vi.fn(async () => true));
const clearPendingAccountDirectoryAuthMock = vi.hoisted(() => vi.fn(async () => true));
const locationAssignMock = vi.hoisted(() => vi.fn());
const runtimeFetchMock = vi.hoisted(() => vi.fn());
const pendingEnrollmentSnapshot = vi.hoisted(() => ({
    kind: 'approval_required' as const,
    homeServerIdentityId: 'srv_home_preferred',
    approvalId: 'approval-welcome',
    expiresAtMs: Date.now() + 60_000,
    serviceKey: 'https://api.happier.dev\u0000srv_cloud_identity',
    entryIntent: 'enter_preferred_home' as const,
    resume: vi.fn(async () => ({ kind: 'cancelled' as const })),
    cancel: vi.fn(async () => ({ kind: 'cancelled' as const })),
}));

const wizardControllerMock = vi.hoisted(() => {
    const goToStep = vi.fn();
    return {
        goToStep,
        lastProps: null as Record<string, unknown> | null,
        current: {
            stepId: 'welcome',
            currentStepIndex: 0,
            stepCount: 4,
            contentTransitionDirection: 'replace',
            showBack: false,
            showSkip: undefined,
            navigationLocked: false,
            onBack: null,
            onSkip: null,
            onPrimary: null,
            primaryLabel: null,
            primaryDisabled: false,
            skipLabel: null,
            skipDisabled: false,
            title: 'welcome',
            subtitle: null,
            footerHint: null,
            body: null as React.ReactNode,
            goToStep,
        },
    };
});

const authEntryOptionsState = vi.hoisted(() => ({
    current: {
        serverAvailability: 'ready',
        serverUrlForCopy: 'https://home-a.example.test',
        showAuthActions: true,
        showProviderSignup: true,
        showAnonymousSignup: true,
        showMtlsLogin: false,
        showKeylessProviderLogin: false,
        providerId: 'github',
        keylessProviderId: null,
        providerSignupTitle: 'Continue with GitHub',
        providerKeylessTitle: '',
        anonymousSignupTitle: 'Create account',
        mtlsTitle: '',
        primaryAction: { kind: 'provider-keyed', title: 'Continue with GitHub' },
        mtlsPrimary: false,
        keylessPrimary: false,
        retentionSummary: null as string | null,
        autoRedirect: {
            enabled: false,
            providerId: null,
            toKeyedProvision: false,
            toKeylessLogin: false,
            toMtls: false,
            toLegacySignupProvider: false,
        },
        retryServerCheck: () => {},
    },
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
    });
});

const expoRouterMock = createExpoRouterMock({
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
});
vi.mock('expo-router', () => expoRouterMock.module);

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: { prompt: modalPromptMock, alert: modalAlertMock, alertAsync: modalAlertAsyncMock },
    }).module;
});

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: false,
        login: vi.fn(),
        loginWithCredentials: vi.fn(),
    }),
}));

vi.mock('@/components/account/auth/useAuthEntryOptions', () => ({
    useAuthEntryOptions: () => authEntryOptionsState.current,
}));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: (featureId: string, scope?: unknown) => ({
        featureId,
        state: 'disabled',
        blockedBy: 'server',
        blockerCode: 'feature_disabled',
        diagnostics: [],
        evaluatedAt: 0,
        scope: scope ?? { scopeKind: 'runtime' },
    }),
}));

vi.mock('@/utils/platform/responsive', () => ({ useIsLandscape: () => false }));
vi.mock('@/sync/store/hooks', () => ({ useLocalSetting: () => false }));
vi.mock('@/components/onboarding/tour/state/journeySession', () => ({
    useOnboardingJourneySessionActive: () => false,
}));
vi.mock('@/components/onboarding/state/usePendingSetupIntent', () => ({
    usePendingSetupIntent: () => null,
}));
vi.mock('@/utils/platform/desktopHost', () => ({ isDesktopHost: () => false }));
vi.mock('@/sync/domains/pending/pendingSetupIntent', () => ({
    getPendingSetupIntent: () => null,
    clearPendingSetupIntent: () => {},
}));
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: runtimeFetchMock }));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => getActiveServerSnapshotMock(),
}));
vi.mock('@/sync/domains/server/readConfiguredServerUrlEnv', () => ({
    readConfiguredServerUrlEnvRaw: () => '',
    readConfiguredServerUrlEnv: () => '',
}));

vi.mock('@/auth/accountDirectory/accountDirectoryAuthClient', () => ({
    accountDirectoryAuthClient: {
        discoverAuthenticationMethods: (input: unknown) => discoverAuthenticationMethodsMock(input),
        startOAuth: (input: unknown) => startOAuthMock(input),
        loginWithKey: (input: unknown) => loginWithKeyMock(input),
    },
}));

vi.mock('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome', () => ({
    enrollPreferredDirectoryHome: (...args: unknown[]) => enrollOpMock(...args),
    finalizePreferredHomeEnrollmentEntryIntent: (...args: unknown[]) => finalizeIntentMock(...args),
    cancelPendingPreferredHomeEnrollment: vi.fn(async () => {}),
    resumePendingPreferredHomeEnrollment: vi.fn(async () => null),
    getPendingPreferredHomeEnrollment: () => pendingEnrollmentSnapshot,
    subscribePendingPreferredHomeEnrollment: () => () => {},
}));

vi.mock('@/sync/ops/accountDirectory/refreshAccountHomeDirectory', () => ({
    refreshAccountHomeDirectory: (...args: unknown[]) => refreshOpMock(...args),
}));

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            setPendingExternalAuth: setPendingExternalAuthMock,
            clearPendingExternalAuth: clearPendingExternalAuthMock,
            clearPendingAccountDirectoryAuth: clearPendingAccountDirectoryAuthMock,
            getAuthAutoRedirectSuppressedUntil: async () => 0,
        },
    };
});

vi.mock('@/components/onboarding/surfaces/OnboardingWizardSurface', () => ({
    OnboardingWizardSurface: (props: Record<string, unknown>) =>
        React.createElement('OnboardingWizardSurface', props),
    OnboardingWizardSurfacePresentation: (props: Record<string, unknown>) =>
        React.createElement('OnboardingWizardSurfacePresentation', props),
}));

vi.mock('@/components/onboarding/surfaces/useOnboardingWizardController', () => ({
    useOnboardingWizardController: (props: Record<string, unknown>) => {
        wizardControllerMock.lastProps = props;
        return wizardControllerMock.current;
    },
}));

vi.mock('@/components/onboarding/unauthShell', () => ({
    UnauthenticatedSplitShell: (props: Record<string, unknown>) =>
        React.createElement('UnauthenticatedSplitShell', props, props.children as React.ReactNode),
    useApplyBrandHeroSeen: () => vi.fn(),
}));

vi.mock('@/components/ui/feedback/AppUpdateStatusTag', () => ({
    AppUpdateStatusTag: (props: Record<string, unknown>) => React.createElement('AppUpdateStatusTag', props),
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

function supportedDiscovery() {
    return {
        kind: 'supported_account_service' as const,
        endpointUrl: SELECTED_SERVICE_URL,
        serverIdentityId: SELECTED_SERVICE_IDENTITY,
        canonicalServerUrl: SELECTED_SERVICE_URL,
        capability: { homeDirectory: true, homeEnrollment: true },
        keyLoginAvailable: false,
        oauthProviderIds: ['github'] as const,
        preferredProvisionProviderId: 'github',
    };
}

function keyOnlyDiscovery() {
    return {
        kind: 'supported_account_service' as const,
        endpointUrl: SELECTED_SERVICE_URL,
        serverIdentityId: SELECTED_SERVICE_IDENTITY,
        canonicalServerUrl: SELECTED_SERVICE_URL,
        capability: {
            version: 1,
            homeDirectory: true,
            homeEnrollment: true,
            homeLoginAssertion: {
                keyId: 'a'.repeat(64),
                publicKeyBase64Url: 'A'.repeat(43),
            },
        },
        keyLoginAvailable: true,
        oauthProviderIds: [] as const,
        preferredProvisionProviderId: null,
    };
}

async function renderEntry() {
    const { PreAuthOnboardingWizardEntry } = await import('./PreAuthOnboardingWizardEntry');
    const screen = await renderScreen(React.createElement(PreAuthOnboardingWizardEntry));
    await act(async () => {
        await Promise.resolve();
    });
    return screen;
}

function capturedAccountServiceEntry() {
    return wizardControllerMock.lastProps?.accountServiceEntry as
        | Readonly<{ status: string; endpoint: { url: string }; discovery: unknown }>
        | undefined;
}

describe('PreAuthOnboardingWizardEntry — Account Service welcome sign-in', () => {
    beforeEach(() => {
        delete process.env.EXPO_PUBLIC_DEBUG;
        setAccountServiceEndpoint({
            url: SELECTED_SERVICE_URL,
            source: 'default',
        });
        discoverAuthenticationMethodsMock.mockReset();
        discoverAuthenticationMethodsMock.mockResolvedValue(supportedDiscovery());
        startOAuthMock.mockReset();
        startOAuthMock.mockResolvedValue(`${SELECTED_SERVICE_URL}/v1/auth/external/github/start?pending=abc`);
        loginWithKeyMock.mockReset();
        loginWithKeyMock.mockResolvedValue({ token: 'restricted-directory-token' });
        refreshOpMock.mockClear();
        enrollOpMock.mockClear();
        finalizeIntentMock.mockClear();
        modalPromptMock.mockReset();
        modalPromptMock.mockResolvedValue(null);
        modalAlertMock.mockClear();
        modalAlertAsyncMock.mockClear();
        getActiveServerSnapshotMock.mockClear();
        setPendingExternalAuthMock.mockClear();
        clearPendingExternalAuthMock.mockClear();
        clearPendingAccountDirectoryAuthMock.mockClear();
        locationAssignMock.mockReset();
        runtimeFetchMock.mockReset();
        runtimeFetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        authEntryOptionsState.current = {
            ...authEntryOptionsState.current,
            showAnonymousSignup: true,
            showMtlsLogin: false,
            autoRedirect: {
                enabled: false,
                providerId: null,
                toKeyedProvision: false,
                toKeylessLogin: false,
                toMtls: false,
                toLegacySignupProvider: false,
            },
        };
        wizardControllerMock.lastProps = null;
        vi.stubGlobal('window', {
            location: {
                href: 'http://localhost:8081/',
                search: '',
                assign: locationAssignMock,
            },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        standardCleanup();
    });

    it('discovers the selected sign-in service on its exact endpoint while another Home is focused', async () => {
        await renderEntry();

        expect(discoverAuthenticationMethodsMock).toHaveBeenCalledTimes(1);
        const [discoveryInput] = discoverAuthenticationMethodsMock.mock.calls[0] as [
            Readonly<{ endpointUrl: string; expectedServerIdentityId?: string | null }>,
        ];
        expect(discoveryInput.endpointUrl).toBe(SELECTED_SERVICE_URL);
        expect(discoveryInput.endpointUrl).not.toBe(FOCUSED_HOME_URL);

        const entry = capturedAccountServiceEntry();
        expect(entry?.status).toBe('ready');
        expect(entry?.endpoint.url).toBe(SELECTED_SERVICE_URL);
        expect(entry?.discovery).toMatchObject({
            serverIdentityId: SELECTED_SERVICE_IDENTITY,
            oauthProviderIds: ['github'],
        });
    });

    it('does not let the active Home auto-redirect while the selected Account Service owns Welcome', async () => {
        authEntryOptionsState.current = {
            ...authEntryOptionsState.current,
            showAnonymousSignup: false,
            showMtlsLogin: true,
            autoRedirect: {
                enabled: true,
                providerId: null,
                toKeyedProvision: false,
                toKeylessLogin: false,
                toMtls: true,
                toLegacySignupProvider: false,
            },
        };

        await renderEntry();
        await vi.waitFor(() => expect(capturedAccountServiceEntry()?.status).toBe('ready'));

        // Other Welcome composition still reads the active snapshot for legacy fallback
        // presentation. The material invariant is that it must not execute the Home mTLS
        // request while the selected Account Service owns authentication.
        expect(runtimeFetchMock).not.toHaveBeenCalled();
    });

    it('starts provider sign-in on the exact selected service with the preferred-Home entry intent', async () => {
        await renderEntry();
        getActiveServerSnapshotMock.mockClear();

        const start = wizardControllerMock.lastProps
            ?.onContinueWithAccountServiceProvider as (providerId: string) => Promise<void>;
        expect(typeof start).toBe('function');
        await act(async () => {
            await start('github');
        });

        expect(startOAuthMock).toHaveBeenCalledTimes(1);
        expect(startOAuthMock.mock.calls[0]?.[0]).toMatchObject({
            endpointUrl: SELECTED_SERVICE_URL,
            endpointServerIdentityId: SELECTED_SERVICE_IDENTITY,
            canonicalServerUrl: SELECTED_SERVICE_URL,
            providerId: 'github',
            entryIntent: 'enter_preferred_home',
            returnTo: '/',
        });
        expect(locationAssignMock).toHaveBeenCalledWith(
            `${SELECTED_SERVICE_URL}/v1/auth/external/github/start?pending=abc`,
        );

        // Ordinary Home OAuth custody and the focused-Home snapshot are never consulted.
        expect(setPendingExternalAuthMock).not.toHaveBeenCalled();
        expect(getActiveServerSnapshotMock).not.toHaveBeenCalled();

        // The observed service identity is bound through the existing endpoint owner so the
        // OAuth callback's selected-service custody check can match this exact continuation.
        const { getAccountServiceEndpointSnapshot } = await import('@/sync/domains/server/serverProfiles');
        expect(getAccountServiceEndpointSnapshot()).toMatchObject({
            url: SELECTED_SERVICE_URL,
            serverIdentityId: SELECTED_SERVICE_IDENTITY,
        });
    });

    it('reports the selected service unavailable when it is an ordinary Home without Account Directory', async () => {
        discoverAuthenticationMethodsMock.mockResolvedValue({
            kind: 'not_account_service',
            endpointUrl: SELECTED_SERVICE_URL,
            serverIdentityId: SELECTED_SERVICE_IDENTITY,
        });

        await renderEntry();

        const entry = capturedAccountServiceEntry();
        expect(entry?.status).toBe('unsupported');
        expect(entry?.discovery).toBeNull();
        expect(startOAuthMock).not.toHaveBeenCalled();
    });

    it('changes the selected sign-in service only after the entered endpoint proves Account Service support', async () => {
        await renderEntry();
        modalPromptMock.mockResolvedValueOnce(OTHER_SERVICE_URL);
        discoverAuthenticationMethodsMock.mockResolvedValueOnce({
            ...supportedDiscovery(),
            endpointUrl: OTHER_SERVICE_URL,
            canonicalServerUrl: OTHER_SERVICE_URL,
            serverIdentityId: OTHER_SERVICE_IDENTITY,
        });

        const choose = wizardControllerMock.lastProps
            ?.onChooseAccountService as () => Promise<void>;
        expect(typeof choose).toBe('function');
        await act(async () => {
            await choose();
        });

        expect(discoverAuthenticationMethodsMock).toHaveBeenCalledWith({
            endpointUrl: OTHER_SERVICE_URL,
            expectedServerIdentityId: null,
        });
        const { getAccountServiceEndpointSnapshot } = await import('@/sync/domains/server/serverProfiles');
        expect(getAccountServiceEndpointSnapshot()).toMatchObject({
            url: OTHER_SERVICE_URL,
            serverIdentityId: OTHER_SERVICE_IDENTITY,
            source: 'user',
        });
    });

    it('presents and executes key sign-in for a key-only selected service without reading the active Home', async () => {
        // Fresh device: the selected service advertises key login and no OAuth providers.
        discoverAuthenticationMethodsMock.mockReset();
        discoverAuthenticationMethodsMock.mockResolvedValue(keyOnlyDiscovery());
        modalPromptMock.mockResolvedValueOnce('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        await renderEntry();

        // The key-only service still owns the welcome sign-in path: the entry exposes the key
        // action instead of falling back to the ordinary active-Home actions.
        const startKeySignIn = wizardControllerMock.lastProps
            ?.onContinueWithAccountServiceKey as () => Promise<void>;
        expect(typeof startKeySignIn).toBe('function');

        getActiveServerSnapshotMock.mockClear();
        await act(async () => {
            await startKeySignIn();
        });

        // Executes key sign-in against that exact Account Service, on its observed stable
        // identity and advertised canonical audience.
        expect(loginWithKeyMock).toHaveBeenCalledTimes(1);
        expect(loginWithKeyMock.mock.calls[0]?.[0]).toMatchObject({
            endpointUrl: SELECTED_SERVICE_URL,
            endpointServerIdentityId: SELECTED_SERVICE_IDENTITY,
            canonicalServerUrl: SELECTED_SERVICE_URL,
        });
        expect((loginWithKeyMock.mock.calls[0]?.[0] as { secret: Uint8Array }).secret).toHaveLength(32);

        // Only the restricted Account Directory credential namespace is written: the ordinary
        // Home OAuth custody and the focused-Home runtime are never consulted.
        expect(setPendingExternalAuthMock).not.toHaveBeenCalled();
        expect(startOAuthMock).not.toHaveBeenCalled();
        expect(getActiveServerSnapshotMock).not.toHaveBeenCalled();

        // Directory refresh and preferred-Home enrollment run under the explicit
        // enter_preferred_home intent, and the exact enrolled Home is entered through the one
        // post-enrollment intent finalizer.
        expect(refreshOpMock).toHaveBeenCalledTimes(1);
        expect(refreshOpMock.mock.calls[0]?.[1]).toMatchObject({ entryIntent: 'enter_preferred_home' });
        expect(enrollOpMock).toHaveBeenCalledTimes(1);
        expect(enrollOpMock.mock.calls[0]?.[1]).toMatchObject({ entryIntent: 'enter_preferred_home' });
        expect(finalizeIntentMock).toHaveBeenCalledTimes(1);
        expect(finalizeIntentMock).toHaveBeenCalledWith(
            PREFERRED_HOME_IDENTITY,
            'enter_preferred_home',
            expect.any(String),
            expect.any(Function),
        );

        // The observed stable service identity is bound through the existing endpoint owner so
        // later continuations resolve to this exact service selection.
        const { getAccountServiceEndpointSnapshot } = await import('@/sync/domains/server/serverProfiles');
        expect(getAccountServiceEndpointSnapshot()).toMatchObject({
            url: SELECTED_SERVICE_URL,
            serverIdentityId: SELECTED_SERVICE_IDENTITY,
        });
    });

    it('keeps a key-sign-in approval on Welcome and presents the shared continuation surface', async () => {
        discoverAuthenticationMethodsMock.mockReset();
        discoverAuthenticationMethodsMock.mockResolvedValue(keyOnlyDiscovery());
        modalPromptMock.mockResolvedValueOnce('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        enrollOpMock.mockResolvedValueOnce({
            kind: 'approval_required',
            homeServerIdentityId: PREFERRED_HOME_IDENTITY,
            approvalId: 'approval-welcome',
            expiresAtMs: Date.now() + 60_000,
            resume: vi.fn(async () => ({ kind: 'cancelled' as const })),
            cancel: vi.fn(async () => ({ kind: 'cancelled' as const })),
        });
        const screen = await renderEntry();

        const startKeySignIn = wizardControllerMock.lastProps
            ?.onContinueWithAccountServiceKey as () => Promise<void>;
        await act(async () => {
            await startKeySignIn();
        });

        expect(screen.findByTestId('oauth-account-directory-approval-waiting')).toBeTruthy();
        expect(screen.findByTestId('oauth-account-directory-approval-cancel')).toBeTruthy();
        expect(modalAlertMock).not.toHaveBeenCalled();
        expect(finalizeIntentMock).not.toHaveBeenCalled();
    });

    it('reports an invalid key without writing any credential for a key-only selected service', async () => {
        discoverAuthenticationMethodsMock.mockReset();
        discoverAuthenticationMethodsMock.mockResolvedValue(keyOnlyDiscovery());
        modalPromptMock.mockResolvedValueOnce('not-a-valid-key');
        await renderEntry();

        const startKeySignIn = wizardControllerMock.lastProps
            ?.onContinueWithAccountServiceKey as () => Promise<void>;
        await act(async () => {
            await startKeySignIn();
        });

        expect(loginWithKeyMock).not.toHaveBeenCalled();
        expect(modalAlertMock).toHaveBeenCalled();
        expect(enrollOpMock).not.toHaveBeenCalled();
        expect(finalizeIntentMock).not.toHaveBeenCalled();
    });

    it('cancels a superseded key sign-in when the selected service changes while the secret prompt is open', async () => {
        discoverAuthenticationMethodsMock.mockReset();
        discoverAuthenticationMethodsMock.mockResolvedValue(keyOnlyDiscovery());
        let resolvePrompt: ((value: string) => void) | null = null;
        modalPromptMock.mockImplementationOnce(() => new Promise<string>((resolve) => {
            resolvePrompt = resolve;
        }));
        await renderEntry();

        const startKeySignIn = wizardControllerMock.lastProps
            ?.onContinueWithAccountServiceKey as () => Promise<void>;
        expect(typeof startKeySignIn).toBe('function');

        let action: Promise<void> | null = null;
        await act(async () => {
            action = startKeySignIn();
        });
        expect(modalPromptMock).toHaveBeenCalledTimes(1);

        // The user replaces the selected sign-in service through the canonical endpoint owner
        // while the secret prompt is still open.
        const { setAccountServiceEndpoint, getAccountServiceEndpointSnapshot } =
            await import('@/sync/domains/server/serverProfiles');
        act(() => {
            setAccountServiceEndpoint({
                url: OTHER_SERVICE_URL,
                serverIdentityId: OTHER_SERVICE_IDENTITY,
                source: 'user',
            });
        });

        await act(async () => {
            resolvePrompt?.('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
            await action;
        });

        // The superseded attempt is cancelled across the prompt boundary: no late restricted
        // credential for the replaced service, no endpoint bind-back over the newer selection,
        // and no refresh, enrollment, or Home entry for a service that is no longer selected.
        expect(loginWithKeyMock).not.toHaveBeenCalled();
        expect(getAccountServiceEndpointSnapshot()).toMatchObject({
            url: OTHER_SERVICE_URL,
            serverIdentityId: OTHER_SERVICE_IDENTITY,
        });
        expect(refreshOpMock).not.toHaveBeenCalled();
        expect(enrollOpMock).not.toHaveBeenCalled();
        expect(finalizeIntentMock).not.toHaveBeenCalled();
        // Cancellation is silent, exactly like the Settings attempt path.
        expect(modalAlertMock).not.toHaveBeenCalled();
        expect(modalAlertAsyncMock).not.toHaveBeenCalled();
    });
});
