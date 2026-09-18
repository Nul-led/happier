import * as React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { useAuth } from '@/auth/context/AuthContext';
import { BaseModal } from '@/modal/components/BaseModal';
import { SetupWizardSurface } from '@/components/onboarding/surfaces/SetupWizardSurface';
import { shouldUseWizardFullscreenPresentation } from '@/components/onboarding/ui/wizardPresentation';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { clearPendingSetupIntent } from '@/sync/domains/pending/pendingSetupIntent';
import type { WizardContext, WizardStepId } from '@/components/onboarding/state/wizardTypes';
import { useApplyLocalSettings } from '@/sync/store/settingsWriters';
import { t } from '@/text';
import {
    parseAuthenticatedAccountEntryRoute,
} from '@/components/navigation/accountEntry/authenticatedAccountEntryRoute';
import { AuthenticatedAccountEntryRouteSurface } from '@/components/navigation/accountEntry/AuthenticatedAccountEntryRouteSurface';
import {
    getActiveServerHomeCarrier,
    getServerProfileById,
} from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import type { AccountDirectoryAuthTransport } from '@/auth/accountDirectory/accountDirectoryAuthClient';

export default function SetupWizardRoute() {
    const auth = useAuth();
    const { width: windowWidth } = useWindowDimensions();
    const params = useLocalSearchParams() as Readonly<Record<string, string | string[] | undefined>>;
    const [hydrationAttempted, setHydrationAttempted] = React.useState(false);
    const applyLocalSettings = useApplyLocalSettings();
    const shouldTopAlignWebModal = shouldUseWizardFullscreenPresentation(windowWidth);
    const accountEntryRequested = typeof params.mode === 'string' && params.mode.trim() === 'account-entry';
    const accountEntryCallbackRequested = accountEntryRequested && params.accountServiceReturn === '1';
    const accountEntryRequest = React.useMemo(
        () => accountEntryRequested ? parseAuthenticatedAccountEntryRoute(params) : null,
        [
            accountEntryRequested,
            params.accountIntent,
            params.accountServiceEndpoint,
            params.accountServiceIdentity,
            params.accountServiceReturn,
            params.accountEntryReturnTo,
            params.mode,
        ],
    );
    const accountEntryTransport = React.useMemo((): AccountDirectoryAuthTransport | undefined => {
        if (!accountEntryRequest) return undefined;
        const active = getActiveServerSnapshot();
        const profile = getServerProfileById(active.serverId);
        const activeIdentity = profile?.serverIdentityId?.trim() ?? '';
        const activeEndpoint = createServerUrlComparableKey(profile?.canonicalServerUrl ?? profile?.serverUrl ?? active.serverUrl);
        const requestedEndpoint = createServerUrlComparableKey(accountEntryRequest.service.endpointUrl);
        if (activeIdentity !== accountEntryRequest.service.serverIdentityId || activeEndpoint !== requestedEndpoint) {
            return undefined;
        }
        const homeCarrier = getActiveServerHomeCarrier();
        if (homeCarrier) return { homeCarrier };
        const runtimeOrigin = active.runtimeOrigin?.trim() ?? '';
        return runtimeOrigin ? { runtimeOrigin } : undefined;
    }, [accountEntryRequest]);

    const initialStepId: WizardStepId | undefined = React.useMemo(() => {
        const raw = typeof params.step === 'string' ? params.step.trim() : '';
        const allowed: readonly WizardStepId[] = [
            'setup_chooser',
            'setup_this_computer',
            'host_relay_local',
            'remote_ssh_setup',
        ];
        return (allowed as readonly string[]).includes(raw) ? (raw as WizardStepId) : undefined;
    }, [params.step]);

    const initialSetupAction: WizardContext['setupAction'] | undefined = React.useMemo(() => {
        const raw = typeof params.action === 'string' ? params.action.trim() : '';
        switch (raw) {
            case 'local':
            case 'relayLocal':
            case 'remote':
                return raw as WizardContext['setupAction'];
            default:
                return undefined;
        }
    }, [params.action]);

    const scope = React.useMemo(() => {
        const raw = typeof params.scope === 'string' ? params.scope.trim() : '';
        if (raw === 'relay' || raw === 'machine' || raw === 'all') {
            return raw;
        }
        return undefined;
    }, [params.scope]);

    React.useEffect(() => {
        if (auth.isAuthenticated) {
            setHydrationAttempted(true);
            return;
        }
        if (hydrationAttempted) {
            return;
        }

        let canceled = false;
        Promise.resolve(auth.refreshFromActiveServer?.())
            .catch(() => {})
            .finally(() => {
                if (canceled) return;
                setHydrationAttempted(true);
            });
        return () => {
            canceled = true;
        };
    }, [auth.isAuthenticated, auth.refreshFromActiveServer, hydrationAttempted]);

    React.useEffect(() => {
        if (auth.isAuthenticated) {
            return;
        }
        if (!hydrationAttempted) {
            return;
        }
        if (accountEntryCallbackRequested) {
            return;
        }
        clearPendingSetupIntent();
        router.replace('/');
    }, [accountEntryCallbackRequested, auth.isAuthenticated, hydrationAttempted]);

    React.useEffect(() => {
        if (!auth.isAuthenticated || !accountEntryRequested || accountEntryRequest) return;
        router.replace('/');
    }, [accountEntryRequest, accountEntryRequested, auth.isAuthenticated]);

    if (accountEntryRequested && !accountEntryRequest) {
        return null;
    }

    if (accountEntryRequest && (auth.isAuthenticated || accountEntryCallbackRequested)) {
        return (
            <BaseModal
                visible={true}
                showBackdrop={true}
                accessibilityLabel={t('settingsAccount.accountServiceHomes')}
                webPlacement={shouldTopAlignWebModal ? 'top' : undefined}
                onClose={() => router.replace('/')}
            >
                <AuthenticatedAccountEntryRouteSurface
                    request={accountEntryRequest}
                    routeParams={params}
                    transport={accountEntryTransport}
                    onExit={(returnTo) => router.replace(returnTo)}
                />
            </BaseModal>
        );
    }

    if (!auth.isAuthenticated) {
        return null;
    }

    const content = (
        <SetupWizardSurface
            testID="setupWizard.surface"
            isDesktopShell={isDesktopHost()}
            useOuterScrollContainer={true}
            onExit={() => {
                applyLocalSettings({ sessionGettingStartedGuidanceDismissed: true });
                router.replace('/');
            }}
            initialStepId={initialStepId}
            initialSetupAction={initialSetupAction}
            scope={scope}
        />
    );

    return (
        <BaseModal
            visible={true}
            showBackdrop={true}
            accessibilityLabel={t('setupOnboarding.screenTitle')}
            webPlacement={shouldTopAlignWebModal ? 'top' : undefined}
            onClose={() => {
                applyLocalSettings({ sessionGettingStartedGuidanceDismissed: true });
                router.replace('/');
            }}
        >
            {content}
        </BaseModal>
    );
}
