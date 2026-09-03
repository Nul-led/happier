import * as React from 'react';
import { Linking, Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import {
    useAuth,
    type AuthCredentialLifecycleResult,
} from '@/auth/context/AuthContext';
import { authGetToken } from '@/auth/flows/getToken';
import { getAuthProvider } from '@/auth/providers/registry';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { encodeBase64 } from '@/encryption/base64';
import { encodeHex } from '@/encryption/hex';
import sodium from '@/encryption/libsodium.lib';
import { digest } from '@/platform/digest';
import { getRandomBytesAsync } from '@/platform/cryptoRandom';
import { Modal } from '@/modal';
import { accountDirectoryAuthClient } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import {
    authenticateSelectedAccountServiceWithKey,
    refreshAndEnrollAccountServiceDirectory,
} from '@/auth/accountDirectory/accountDirectoryKeyAuth';
import { finalizePreferredHomeEnrollmentEntryIntent } from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import { isSelectedAccountServiceKey } from '@/sync/domains/accountDirectory/accountServiceSelection';
import { createAccountDirectoryServiceKey } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { useAuthEntryOptions } from '@/components/account/auth/useAuthEntryOptions';
import { useAccountServiceEntryOptions } from '@/components/account/auth/useAccountServiceEntryOptions';
import { AccountServiceOAuthJourney } from '@/components/account/auth/AccountServiceOAuthJourney';
import { setAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';
import { useIsLandscape } from '@/utils/platform/responsive';
import { isSafeExternalAuthUrl } from '@/auth/providers/externalAuthUrl';
import { formatOperationFailedDebugMessage } from '@/utils/errors/formatOperationFailedDebugMessage';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { resolveAppUrlScheme } from '@/utils/url/appScheme';
import { trackAccountCreated } from '@/track';
import { t } from '@/text';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';

import { clearPendingSetupIntent } from '@/sync/domains/pending/pendingSetupIntent';
import { usePendingSetupIntent } from '@/components/onboarding/state/usePendingSetupIntent';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { readConfiguredServerUrlEnv } from '@/sync/domains/server/readConfiguredServerUrlEnv';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import {
    captureHomeExternalAuthTarget,
    createHomeOAuthRequestContext,
} from '@/auth/providers/homeExternalAuthTarget';

import { OnboardingWizardSurfacePresentation } from '@/components/onboarding/surfaces/OnboardingWizardSurface';
import { useOnboardingWizardController } from '@/components/onboarding/surfaces/useOnboardingWizardController';
import { UnauthenticatedSplitShell, useApplyBrandHeroSeen } from '@/components/onboarding/unauthShell';
import { DesktopShellUpdateIndicatorHost } from '@/components/navigation/shell/desktopChrome/DesktopShellUpdateIndicatorHost';
import { DesktopShellWindowControlsHost } from '@/components/navigation/shell/desktopChrome/DesktopShellWindowControlsHost';
import { useResolvedDesktopWindowControls } from '@/components/navigation/shell/desktopChrome/useResolvedDesktopWindowControls';
import { AppUpdateStatusTag } from '@/components/ui/feedback/AppUpdateStatusTag';
import { runtimeFetch } from '@/utils/system/runtimeFetch';
import { resolveAppShellChromeHost } from '@/components/appShell/resolveAppShellChromeHost';
import { resolveWizardAuthReturnToRoute } from '@/components/onboarding/state/wizardResume';
import { getWizardStepDefinition } from '@/components/onboarding/state/wizardStepRegistry';
import type { WizardStepId } from '@/components/onboarding/state/wizardTypes';
import { type JourneyBeatId, type JourneySurface } from '@/components/onboarding/tour/state/journeyBeats';
import { readJourneyReplayBeatId, readWebQueryParam } from '@/components/onboarding/tour/state/journeyReplayIntent';
import { useOnboardingJourneySessionActive } from '@/components/onboarding/tour/state/journeySession';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { useLocalSetting } from '@/sync/store/hooks';
import {
    presentFirstKeyCredentialLifecycle,
} from '@/components/account/presentFirstKeyCredentialLifecycle';
import {
    guardAccountEncryptionFirstKeyCredentialMutation,
} from '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth';
import { HappyError } from '@/utils/errors/errors';

async function guardOrdinaryAuthIngress(
): Promise<AuthCredentialLifecycleResult> {
    const result =
        await guardAccountEncryptionFirstKeyCredentialMutation();
    return result.kind === 'allowed'
        ? { kind: 'completed' }
        : result;
}

type OnboardingJourneyHostModule = typeof import('@/components/onboarding/tour/OnboardingJourneyHost');
let onboardingJourneyHostModulePromise: Promise<OnboardingJourneyHostModule> | null = null;

function loadOnboardingJourneyHostModule(): Promise<OnboardingJourneyHostModule> {
    onboardingJourneyHostModulePromise ??= import('@/components/onboarding/tour/OnboardingJourneyHost');
    return onboardingJourneyHostModulePromise;
}

export function preloadOnboardingJourneyHost(): void {
    void loadOnboardingJourneyHostModule();
}

const LazyOnboardingJourneyHost = React.lazy(async () => {
    const module = await loadOnboardingJourneyHostModule();
    return { default: module.OnboardingJourneyHost };
});

const journeyLoadingStylesheet = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        minHeight: 0,
        backgroundColor: theme.colors.background.canvas,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.margins.md,
        paddingHorizontal: theme.margins.xxl,
    },
    label: {
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
}));

function OnboardingJourneyLoadingSurface(): React.ReactElement {
    const { theme } = useUnistyles();
    const loadingLabel = t('common.loading');

    return (
        <View
            testID="onboarding-journey-loading"
            accessible
            accessibilityLabel={loadingLabel}
            accessibilityRole="progressbar"
            accessibilityLiveRegion="polite"
            role="status"
            aria-live="polite"
            style={journeyLoadingStylesheet.root}
        >
            <ActivitySpinner
                testID="onboarding-journey-loading-spinner"
                color={theme.colors.text.secondary}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            />
            <Text testID="onboarding-journey-loading-label" style={journeyLoadingStylesheet.label}>
                {loadingLabel}
            </Text>
        </View>
    );
}

type JourneyHostErrorBoundaryProps = Readonly<{
    children: React.ReactNode;
    fallback: React.ReactNode;
}>;

type JourneyHostErrorBoundaryState = Readonly<{
    didCatch: boolean;
}>;

class JourneyHostErrorBoundary extends React.Component<JourneyHostErrorBoundaryProps, JourneyHostErrorBoundaryState> {
    state: JourneyHostErrorBoundaryState = { didCatch: false };

    static getDerivedStateFromError(): JourneyHostErrorBoundaryState {
        return { didCatch: true };
    }

    render(): React.ReactNode {
        if (this.state.didCatch) {
            return this.props.fallback;
        }
        return this.props.children;
    }
}

export type PreAuthOnboardingWizardEntryProps = Readonly<{
    testID?: string;
    clearPendingSetupIntentOnMount?: boolean;
    initialStepId?: WizardStepId;
}>;

function resolveAuthReturnToRoute(): string {
    return resolveWizardAuthReturnToRoute();
}

/**
 * Leaves the app for a provider authorization URL. Web replaces the current document so the
 * provider return lands back on the same origin; native hands the URL to the OS.
 */
async function openExternalAuthUrl(url: string): Promise<void> {
    if (Platform.OS === 'web') {
        const location = typeof window !== 'undefined' ? window.location : null;
        if (location && typeof location.assign === 'function') {
            location.assign(url);
            return;
        }
        if (location && typeof location.href === 'string') {
            location.href = url;
            return;
        }
    }
    await Linking.openURL(url);
}

function resolveUnauthShellRouteTestId(stepId: WizardStepId): string {
    if (stepId === 'auth_restore') return 'unauth-shell-route-restore';
    if (stepId === 'relay_select') return 'unauth-shell-route-setup-pre-auth';
    return 'unauth-shell-route-welcome';
}

function readDebugWebQueryParam(name: string): string {
    if (!process.env.EXPO_PUBLIC_DEBUG) return '';
    return readWebQueryParam(name);
}

function resolveJourneySurface(params: Readonly<{ isDesktopShell: boolean; platformOs: string }>): JourneySurface {
    if (params.isDesktopShell) return 'desktop';
    return params.platformOs === 'web' ? 'web' : 'native';
}

export const PreAuthOnboardingWizardEntry = React.memo(function PreAuthOnboardingWizardEntry(props: PreAuthOnboardingWizardEntryProps) {
    const auth = useAuth();
    const onboardingTourDecision = useFeatureDecision('app.ui.onboardingTour', { scopeKind: 'runtime' });
    const onboardingTourEnabled = onboardingTourDecision?.state === 'enabled';
    const onboardingTourResolving = onboardingTourDecision == null;
    // The journey is a FIRST-RUN experience (D21). `hasCompletedAuthOnce` survives
    // logout by design, so returning users get the preserved classic welcome shell.
    const hasCompletedAuthOnce = useLocalSetting('hasCompletedAuthOnce') === true;
    // Sticky: once a journey session is live it OWNS the viewport until it ends.
    // This flag flips true when the host mounts and stays true across the auth hinge
    // (login sets `hasCompletedAuthOnce`), so a first-run journey is never torn down
    // mid-setup — the root cause of the S4-beside-the-live-shell composition defect.
    const journeySessionActive = useOnboardingJourneySessionActive();
    // A persisted setup-intent continuation for an authed user means the journey's
    // setup act was interrupted (e.g. reload lost the in-memory session latch). The
    // journey re-latches at the setup act instead of ever exposing the shell (D21/P1).
    const routeGatePendingSetupIntent = usePendingSetupIntent();
    const hasAuthedSetupContinuation =
        auth.isAuthenticated
        && (routeGatePendingSetupIntent?.phase === 'awaiting_auth' || routeGatePendingSetupIntent?.phase === 'post_auth');
    const isLandscape = useIsLandscape();
    const isDesktopShell = React.useMemo(() => isDesktopHost(), []);
    const authEntryOptions = useAuthEntryOptions();
    // The selected sign-in service is resolved independently of the focused Home, so a fresh
    // device with zero Home profiles still reaches its advertised sign-in methods.
    const accountServiceEntry = useAccountServiceEntryOptions();
    const accountServiceEndpoint = accountServiceEntry.endpoint;
    const accountServiceDiscovery = accountServiceEntry.discovery;
    const [accountServiceApprovalPending, setAccountServiceApprovalPending] = React.useState(false);
    const applyBrandHeroSeen = useApplyBrandHeroSeen();
    const autoRedirectAttemptedRef = React.useRef(false);
    const shellChromeHost = resolveAppShellChromeHost({
        isAuthenticated: false,
        isWeb: Platform.OS === 'web',
        isDesktopHost: isDesktopShell,
        isTablet: false,
        isTerminalConnectRoute: false,
    });
    const resolvedDesktopWindowControls = useResolvedDesktopWindowControls({
        variant: 'expanded',
    });

    React.useEffect(() => {
        if (!props.clearPendingSetupIntentOnMount) {
            return;
        }
        clearPendingSetupIntent();
    }, [props.clearPendingSetupIntentOnMount]);

    const createAccount = React.useCallback(async () => {
        try {
            const secret = await getRandomBytesAsync(32);
            const token = await authGetToken(secret);
            if (token && secret) {
                await presentFirstKeyCredentialLifecycle({
                    run: async () =>
                        await auth.login(
                            token,
                            encodeBase64(secret, 'base64url'),
                        ),
                    onCompleted: trackAccountCreated,
                });
            }
        } catch (error) {
            if (error instanceof HappyError && error.code === 'signup-disabled') {
                authEntryOptions.retryServerCheck();
                await Modal.alert(t('common.error'), t('errors.signupDisabled'));
                return;
            }
            const message = process.env.EXPO_PUBLIC_DEBUG
                ? formatOperationFailedDebugMessage(t('errors.operationFailed'), error)
                : t('errors.operationFailed');
            await Modal.alert(t('common.error'), message);
        }
    }, [auth, authEntryOptions.retryServerCheck]);

    const createAccountViaProvider = React.useCallback(async (providerId: string) => {
        // OAuth custody must be fixed before any modal, lifecycle guard, or
        // randomness await can allow focus to move to another Home.
        const target = captureHomeExternalAuthTarget(getActiveServerSnapshot());
        const requestContext = createHomeOAuthRequestContext(target);
        try {
            if (!requestContext) {
                throw new Error('Home OAuth target is unavailable');
            }
            let mayStart = false;
            await presentFirstKeyCredentialLifecycle({
                run: guardOrdinaryAuthIngress,
                onCompleted: () => {
                    mayStart = true;
                },
            });
            if (!mayStart) return;

            const proofBytes = await getRandomBytesAsync(32);
            const proof = encodeBase64(proofBytes, 'base64url');
            const proofHashBytes = await digest('SHA-256', new TextEncoder().encode(proof));
            const proofHash = encodeHex(proofHashBytes).toLowerCase();

            const secretBytes = await getRandomBytesAsync(32);
            const secret = encodeBase64(secretBytes, 'base64url');
            const signingKeyPair = sodium.crypto_sign_seed_keypair(secretBytes);
            const publicKey = encodeBase64(signingKeyPair.publicKey);

            const stored =
                await TokenStorage.setPendingExternalAuth({
                    provider: providerId,
                    proof,
                    secret,
                    returnTo: resolveAuthReturnToRoute(),
                    ...target,
                }, requestContext.target);
            if (!stored) {
                const guard =
                    await guardAccountEncryptionFirstKeyCredentialMutation();
                if (guard.kind !== 'allowed') {
                    await presentFirstKeyCredentialLifecycle({
                        run: guardOrdinaryAuthIngress,
                    });
                    return;
                }
                throw new Error(
                    'Failed to persist pending external authentication',
                );
            }

            const provider = getAuthProvider(providerId);
            if (!provider) {
                await TokenStorage.clearPendingExternalAuth();
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }

            const url = await provider.getExternalAuthUrl(
                { mode: 'keyed', proofHash, publicKey },
                requestContext,
            );
            if (!isSafeExternalAuthUrl(url)) {
                await TokenStorage.clearPendingExternalAuth();
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }
            await openExternalAuthUrl(url);
        } catch (error) {
            await TokenStorage.clearPendingExternalAuth();
            await Modal.alert(t('common.error'), t('errors.operationFailed'));
        }
    }, []);

    const loginWithKeylessProvider = React.useCallback(async (providerId: string) => {
        // Capture the exact Home before the first asynchronous guard for the
        // same reason as keyed OAuth above.
        const target = captureHomeExternalAuthTarget(getActiveServerSnapshot());
        const requestContext = createHomeOAuthRequestContext(target);
        try {
            if (!requestContext) {
                throw new Error('Home OAuth target is unavailable');
            }
            let mayStart = false;
            await presentFirstKeyCredentialLifecycle({
                run: guardOrdinaryAuthIngress,
                onCompleted: () => {
                    mayStart = true;
                },
            });
            if (!mayStart) return;

            const proofBytes = await getRandomBytesAsync(32);
            const proof = encodeBase64(proofBytes, 'base64url');
            const proofHashBytes = await digest('SHA-256', new TextEncoder().encode(proof));
            const proofHash = encodeHex(proofHashBytes).toLowerCase();

            const stored =
                await TokenStorage.setPendingExternalAuth({
                    provider: providerId,
                    proof,
                    returnTo: resolveAuthReturnToRoute(),
                    ...target,
                }, requestContext.target);
            if (!stored) {
                const guard =
                    await guardAccountEncryptionFirstKeyCredentialMutation();
                if (guard.kind !== 'allowed') {
                    await presentFirstKeyCredentialLifecycle({
                        run: guardOrdinaryAuthIngress,
                    });
                    return;
                }
                throw new Error(
                    'Failed to persist pending external authentication',
                );
            }

            const provider = getAuthProvider(providerId);
            if (!provider) {
                await TokenStorage.clearPendingExternalAuth();
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }

            const url = await provider.getExternalAuthUrl(
                { mode: 'keyless', proofHash },
                requestContext,
            );
            if (!isSafeExternalAuthUrl(url)) {
                await TokenStorage.clearPendingExternalAuth();
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }
            await openExternalAuthUrl(url);
        } catch {
            await TokenStorage.clearPendingExternalAuth();
            await Modal.alert(t('common.error'), t('errors.operationFailed'));
        }
    }, []);

    /**
     * Unauthenticated Welcome sign-in against the selected sign-in service (A7 / G02-2).
     *
     * Every fact comes from the service's own advertisement: the immutable endpoint URL, its
     * observed stable identity, and its canonical audience. The focused Home is never read, the
     * ordinary Home OAuth custody namespace is never written, and no Home runtime is constructed.
     */
    const continueWithAccountServiceProvider = React.useCallback(async (providerId: string) => {
        if (!accountServiceDiscovery) return;
        const endpointUrl = accountServiceDiscovery.endpointUrl;
        const endpointServerIdentityId = accountServiceDiscovery.serverIdentityId;
        let pendingMayExist = false;
        try {
            // Bind the selection to the observed stable service identity through the existing
            // endpoint owner before a continuation exists, so the OAuth callback's
            // selected-service custody check resolves to this exact service.
            setAccountServiceEndpoint({
                ...accountServiceEndpoint,
                serverIdentityId: endpointServerIdentityId,
            });
            const url = await accountDirectoryAuthClient.startOAuth({
                endpointUrl,
                endpointServerIdentityId,
                canonicalServerUrl: accountServiceDiscovery.canonicalServerUrl,
                providerId,
                // Linked plaintext/keyless Accounts complete without manufacturing a Home
                // signing secret. An unlinked identity receives the typed keyed-required
                // result and the callback starts a fresh keyed continuation on this service.
                mode: 'keyless',
                entryIntent: 'enter_preferred_home',
                returnTo: resolveAuthReturnToRoute(),
            });
            pendingMayExist = true;
            if (!isSafeExternalAuthUrl(url)) {
                throw new Error('Invalid Account Service OAuth URL');
            }
            await openExternalAuthUrl(url);
        } catch {
            if (pendingMayExist) {
                await TokenStorage.clearPendingAccountDirectoryAuth({
                    endpoint: endpointUrl,
                    serverIdentityId: endpointServerIdentityId,
                }).catch(() => false);
            }
            await Modal.alert(t('common.error'), t('errors.operationFailed'));
        }
    }, [accountServiceDiscovery, accountServiceEndpoint]);

    /**
     * Unauthenticated Welcome key sign-in against the selected sign-in service (A7 / G02-2).
     *
     * Runs the one canonical Account Service key ceremony shared with Settings — endpoint-targeted
     * discovery of the exact selected service, the secure secret prompt, and restricted
     * `account_directory` credential storage — then refreshes the Directory and enrolls the
     * preferred Home under the explicit `enter_preferred_home` entry intent. The focused Home is
     * never read; only the enrollment owner's post-enrollment intent finalizer may open the exact
     * enrolled preferred Home.
     */
    const continueWithAccountServiceKey = React.useCallback(async () => {
        if (!accountServiceDiscovery) return;
        // The selected sign-in service may change while discovery, the secret prompt, or login
        // is awaiting. Every async boundary cancels a superseded attempt through the canonical
        // endpoint snapshot (the same comparison the enrollment owner's finalizer uses), so a
        // replaced service can never be bound back, authenticated, or enrolled late. The
        // observed identity updates the captured key before the coordinator binds it, so the
        // bind itself never reads as a replacement.
        let capturedServiceKey = createAccountDirectoryServiceKey({
            endpoint: accountServiceEndpoint.url,
            serverIdentityId: accountServiceEndpoint.serverIdentityId ?? null,
        });
        const serviceSuperseded = () => !isSelectedAccountServiceKey(capturedServiceKey);
        const auth = await authenticateSelectedAccountServiceWithKey({
            endpoint: accountServiceEndpoint,
            shouldCancel: serviceSuperseded,
            onServiceIdentityObserved: ({ serviceKey }) => {
                capturedServiceKey = serviceKey;
            },
        });
        if (auth.kind === 'cancelled') return;
        if (auth.kind === 'invalid_key') {
            await Modal.alert(t('common.error'), t('connect.invalidSecretKey'));
            return;
        }
        if (auth.kind !== 'authenticated') {
            await Modal.alert(t('common.error'), t('errors.operationFailed'));
            return;
        }
        const { enrollment } = await refreshAndEnrollAccountServiceDirectory(auth.session, {
            entryIntent: 'enter_preferred_home',
            shouldCancel: serviceSuperseded,
            shouldInvalidateContinuation: serviceSuperseded,
        });
        if (serviceSuperseded()) return;
        if (enrollment?.kind === 'enrolled') {
            // One explicit post-enrollment intent finalizer (A10): open the exact enrolled Home.
            // The enrollment owner finalizes only its own approval-resume path, so this immediate
            // result is finalized here exactly once.
            const applied = await finalizePreferredHomeEnrollmentEntryIntent(
                enrollment.homeServerIdentityId,
                'enter_preferred_home',
                auth.serviceKey,
            );
            if (applied === 'blocked') {
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
            }
            return;
        }
        if (enrollment?.kind === 'approval_required') {
            // The enrollment owner retained the credential-bearing continuation. Welcome stays
            // mounted as its destination-owned presenter and lets that owner resume/open/cancel.
            setAccountServiceApprovalPending(true);
            return;
        }
        if (
            enrollment?.kind === 'failed'
            || enrollment?.kind === 'rejected'
            || enrollment?.kind === 'expired'
            || enrollment?.kind === 'partial_commit'
        ) {
            // A failed stage preserves the valid Account Service credential and reports truthfully.
            await Modal.alert(t('common.error'), t('errors.operationFailed'));
        }
    }, [accountServiceDiscovery, accountServiceEndpoint]);

    const loginWithMtls = React.useCallback(async () => {
        try {
            const snapshot = getActiveServerSnapshot();
            const rawServerUrl = snapshot.serverUrl ? String(snapshot.serverUrl).trim() : '';
            const serverUrl = rawServerUrl.replace(/\/+$/, '') || readConfiguredServerUrlEnv().replace(/\/+$/, '');
            if (!serverUrl) {
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }
            const target = captureHomeExternalAuthTarget({
                serverId: snapshot.serverId,
                serverUrl,
            });
            if (!target.serverId || !target.serverUrl) {
                await Modal.alert(t('common.error'), t('errors.operationFailed'));
                return;
            }

            if (Platform.OS !== 'web') {
                const pendingWritten = await TokenStorage.setPendingExternalAuth(
                    { provider: 'mtls', serverId: target.serverId, serverUrl: target.serverUrl },
                    target,
                );
                if (!pendingWritten) {
                    await Modal.alert(t('common.error'), t('errors.operationFailed'));
                    return;
                }
                const returnTo = `${resolveAppUrlScheme()}:///mtls`;
                const startUrl = `${serverUrl}/v1/auth/mtls/start?returnTo=${encodeURIComponent(returnTo)}`;
                try {
                    await Linking.openURL(startUrl);
                } catch (error) {
                    await TokenStorage.clearPendingExternalAuth(target).catch(() => false);
                    throw error;
                }
                return;
            }

            const controller = new AbortController();
            const timeoutMs = 15000;
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await runtimeFetch(`${serverUrl}/v1/auth/mtls`, { method: 'POST', signal: controller.signal });
                const json = await res.json().catch(() => null);
                if (!res.ok || !json || typeof json.token !== 'string') {
                    await Modal.alert(t('common.error'), t('errors.operationFailed'));
                    return;
                }
                const token = String(json.token);
                await presentFirstKeyCredentialLifecycle({
                    run: async () =>
                        await auth.loginWithCredentials({ token }, { target }),
                });
            } finally {
                clearTimeout(timer);
            }
        } catch (error) {
            const message = process.env.EXPO_PUBLIC_DEBUG
                ? formatOperationFailedDebugMessage(t('errors.operationFailed'), error)
                : t('errors.operationFailed');
            await Modal.alert(t('common.error'), message);
        }
    }, [auth]);

    React.useEffect(() => {
        const autoRedirect = authEntryOptions.autoRedirect;
        const providerId = autoRedirect.providerId;
        const nonMtlsProviderId =
            typeof providerId === 'string' && providerId.trim().length > 0
                ? providerId
                : null;
        if (!autoRedirect.enabled) {
            return;
        }
        if (autoRedirectAttemptedRef.current) {
            return;
        }
        if (authEntryOptions.showAnonymousSignup) {
            return;
        }
        if (!autoRedirect.toMtls && !autoRedirect.toKeyedProvision && !autoRedirect.toKeylessLogin && !autoRedirect.toLegacySignupProvider) {
            return;
        }
        if (!autoRedirect.toMtls && nonMtlsProviderId == null) {
            return;
        }

        autoRedirectAttemptedRef.current = true;
        fireAndForget((async () => {
            const suppressedUntil = await TokenStorage.getAuthAutoRedirectSuppressedUntil();
            if (Date.now() < suppressedUntil) return;
            if (autoRedirect.toMtls) {
                await loginWithMtls();
                return;
            }
            if (nonMtlsProviderId == null) {
                return;
            }
            if (autoRedirect.toKeylessLogin) {
                await loginWithKeylessProvider(nonMtlsProviderId);
                return;
            }
            await createAccountViaProvider(nonMtlsProviderId);
        })(), { tag: 'PreAuthOnboardingWizardEntry.autoRedirect' });
    }, [authEntryOptions, createAccountViaProvider, loginWithKeylessProvider, loginWithMtls]);

    const resolvedInitialStepId = React.useMemo((): WizardStepId | undefined => {
        if (props.initialStepId) {
            return props.initialStepId;
        }
        const candidate = readDebugWebQueryParam('happier_wizard_step');
        if (!candidate) {
            return undefined;
        }

        try {
            getWizardStepDefinition(candidate as WizardStepId);
            return candidate as WizardStepId;
        } catch {
            return undefined;
        }
    }, [props.initialStepId]);

    const resolvedInitialBeatId = React.useMemo((): JourneyBeatId | undefined => (
        readJourneyReplayBeatId()
    ), []);

    const shellChrome = shellChromeHost === 'unauth-shell' ? (
        <>
            <DesktopShellWindowControlsHost>
                {resolvedDesktopWindowControls}
            </DesktopShellWindowControlsHost>
            <DesktopShellUpdateIndicatorHost>
                <AppUpdateStatusTag testID="preauth-app-update-status-tag" />
            </DesktopShellUpdateIndicatorHost>
        </>
    ) : null;

    const wizardSurfaceProps = {
        testID: props.testID ?? 'onboarding-wizard',
        layout: isLandscape ? 'landscape' as const : 'portrait' as const,
        isDesktopShell,
        wizardChromeMode: 'bare' as const,
        wizardLayoutPresentation: isDesktopShell ? 'fullscreen' as const : undefined,
        authEntryOptions,
        accountServiceEntry,
        shellChrome,
        initialStepId: resolvedInitialStepId,
        onContinueWithAccountServiceProvider: continueWithAccountServiceProvider,
        onContinueWithAccountServiceKey: continueWithAccountServiceKey,
        onCreateAccount: createAccount,
        onCreateAccountViaProvider: createAccountViaProvider,
        onLoginWithKeylessProvider: loginWithKeylessProvider,
        onLoginWithMtls: loginWithMtls,
    };

    const controller = useOnboardingWizardController(wizardSurfaceProps);
    const wizardFallback = (
        <OnboardingWizardSurfacePresentation
            {...wizardSurfaceProps}
            controller={controller}
        />
    );
    const journeyLoadingFallback = <OnboardingJourneyLoadingSurface />;
    const journeySurface = resolveJourneySurface({
        isDesktopShell,
        platformOs: Platform.OS,
    });
    const shellTestID = props.testID ?? resolveUnauthShellRouteTestId(controller.stepId);
    const renderClassicShell = (children: React.ReactNode) => (
        <UnauthenticatedSplitShell
            stepId={controller.stepId}
            isWelcomeStep={controller.stepId === 'welcome'}
            allowMobileBrandHero={controller.stepId === 'welcome'}
            retentionSummary={authEntryOptions.retentionSummary}
            onOpenRelayCustomFlow={() => {
                controller.goToStep('relay_select');
            }}
            onBrandHeroGetStarted={applyBrandHeroSeen}
            onBack={controller.onBack ?? undefined}
            transitionDirection={controller.contentTransitionDirection}
            workflowPresentation={controller.stepId === 'scan_code' ? 'fullBleed' : 'padded'}
            testID={shellTestID}
        >
            {children}
        </UnauthenticatedSplitShell>
    );

    if (onboardingTourResolving) {
        return journeyLoadingFallback;
    }

    if (accountServiceApprovalPending) {
        return renderClassicShell(
            <AccountServiceOAuthJourney
                state={{
                    kind: 'progress',
                    stage: 'waiting_approval',
                    providerName: accountServiceEndpoint.displayName ?? t('connect.secretKeyInputLabel'),
                    endpointUrl: accountServiceEndpoint.url,
                }}
                onRecovery={() => setAccountServiceApprovalPending(false)}
                approvalContinuation
                onApprovalOutcome={() => setAccountServiceApprovalPending(false)}
            />,
        );
    }

    // Explicit replay intent (deep-link into a specific journey beat) reaches the
    // journey regardless of returning-user status; replay is an intent, not the default.
    const hasExplicitJourneyReplayIntent = resolvedInitialBeatId != null;
    const shouldRenderJourney =
        onboardingTourEnabled
        && (journeySessionActive || hasAuthedSetupContinuation || !hasCompletedAuthOnce || hasExplicitJourneyReplayIntent);
    // Re-latch case: authed setup continuation without a live journey session mounts
    // the host directly at the first setup-act beat (S3) instead of the journey start.
    const journeyInitialBeatId = resolvedInitialBeatId
        ?? (hasAuthedSetupContinuation && !journeySessionActive ? 'S3' as JourneyBeatId : undefined);

    if (shouldRenderJourney) {
        preloadOnboardingJourneyHost();
        const fallback = renderClassicShell(wizardFallback);
        return (
            <JourneyHostErrorBoundary fallback={fallback}>
                <React.Suspense fallback={journeyLoadingFallback}>
                    <LazyOnboardingJourneyHost
                        testID={props.testID ?? 'onboarding-journey'}
                        surface={journeySurface}
                        isDesktopShell={isDesktopShell}
                        initialBeatId={journeyInitialBeatId}
                        retentionSummary={authEntryOptions.retentionSummary}
                        preAuthController={controller}
                        wizardSurfaceProps={wizardSurfaceProps}
                    />
                </React.Suspense>
            </JourneyHostErrorBoundary>
        );
    }

    return renderClassicShell(wizardFallback);
});
