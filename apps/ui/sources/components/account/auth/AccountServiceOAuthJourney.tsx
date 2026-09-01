import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { focusNativeAccessibilityTarget } from '@/keyboard/focusReturn';

export type AccountServiceOAuthStage =
    | 'verifying_service'
    | 'signing_in'
    | 'saving_credentials'
    | 'signed_in'
    | 'finding_homes'
    | 'connecting_home'
    | 'waiting_approval'
    | 'account_service_connected'
    | 'home_added';

type AccountServiceOAuthVisibleStage =
    | 'signing_in'
    | 'finding_homes';

export type AccountServiceOAuthFailure =
    | 'provider_failed'
    | 'request_expired'
    | 'identity_changed'
    | 'service_unavailable'
    | 'token_exchange_failed'
    | 'credential_storage_failed'
    | 'home_link_failed'
    | 'directory_refresh_failed'
    | 'home_enrollment_failed'
    | 'invalid_request';

export type AccountServiceOAuthJourneyState = Readonly<{
    providerName: string;
    endpointUrl: string;
}> & (
    | Readonly<{ kind: 'progress'; stage: AccountServiceOAuthStage }>
    | Readonly<{
        kind: 'error';
        failure: AccountServiceOAuthFailure;
        signedIn: boolean;
    }>
);

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        width: '100%',
        maxWidth: 560,
        alignSelf: 'center',
        gap: 12,
    },
    serviceIdentity: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
    recoveryAction: {
        alignSelf: 'center',
        minWidth: 200,
    },
}));

function endpointDisplayName(endpointUrl: string): string {
    try {
        const endpoint = new URL(endpointUrl);
        const pathname = endpoint.pathname.replace(/\/+$/, '');
        return `${endpoint.host}${pathname === '' || pathname === '/' ? '' : pathname}`;
    } catch {
        return endpointUrl;
    }
}

function visibleStageFor(stage: AccountServiceOAuthStage): AccountServiceOAuthVisibleStage {
    switch (stage) {
        case 'verifying_service':
        case 'signing_in':
        case 'saving_credentials':
        case 'signed_in':
            return 'signing_in';
        case 'finding_homes':
        case 'connecting_home':
        case 'waiting_approval':
        case 'account_service_connected':
        case 'home_added':
            return 'finding_homes';
    }
}

function stageTitle(
    stage: AccountServiceOAuthVisibleStage,
): string {
    switch (stage) {
        case 'signing_in': return t('settingsAccount.accountServiceOAuth.stages.signingIn');
        case 'finding_homes': return t('settingsAccount.accountServiceOAuth.stages.findingHomes');
    }
}

function failureCopy(failure: AccountServiceOAuthFailure): Readonly<{ title: string; body: string }> {
    switch (failure) {
        case 'provider_failed': return { title: t('settingsAccount.accountServiceOAuth.errors.provider.title'), body: t('settingsAccount.accountServiceOAuth.errors.provider.body') };
        case 'request_expired': return { title: t('settingsAccount.accountServiceOAuth.errors.expired.title'), body: t('settingsAccount.accountServiceOAuth.errors.expired.body') };
        case 'identity_changed': return { title: t('settingsAccount.accountServiceOAuth.errors.identityChanged.title'), body: t('settingsAccount.accountServiceOAuth.errors.identityChanged.body') };
        case 'service_unavailable': return { title: t('settingsAccount.accountServiceOAuth.errors.unavailable.title'), body: t('settingsAccount.accountServiceOAuth.errors.unavailable.body') };
        case 'token_exchange_failed': return { title: t('settingsAccount.accountServiceOAuth.errors.exchange.title'), body: t('settingsAccount.accountServiceOAuth.errors.exchange.body') };
        case 'credential_storage_failed': return { title: t('settingsAccount.accountServiceOAuth.errors.storage.title'), body: t('settingsAccount.accountServiceOAuth.errors.storage.body') };
        case 'home_link_failed': return { title: t('settingsAccount.accountServiceOAuth.errors.homeLink.title'), body: t('settingsAccount.accountServiceOAuth.errors.homeLink.body') };
        case 'directory_refresh_failed': return { title: t('settingsAccount.accountServiceOAuth.errors.directoryRefresh.title'), body: t('settingsAccount.accountServiceOAuth.errors.directoryRefresh.body') };
        case 'home_enrollment_failed': return { title: t('settingsAccount.accountServiceOAuth.errors.homeEnrollment.title'), body: t('settingsAccount.accountServiceOAuth.errors.homeEnrollment.body') };
        case 'invalid_request': return { title: t('settingsAccount.accountServiceOAuth.errors.invalid.title'), body: t('settingsAccount.accountServiceOAuth.errors.invalid.body') };
    }
}

export function AccountServiceOAuthJourney(props: Readonly<{
    state: AccountServiceOAuthJourneyState;
    onRecovery: () => void;
    onTerminalPresented?: () => void;
}>): React.ReactElement {
    const styles = stylesheet;
    const host = endpointDisplayName(props.state.endpointUrl);
    const identity = t('settingsAccount.accountServiceOAuth.serviceIdentity', {
        provider: props.state.providerName,
        host,
    });
    const isError = props.state.kind === 'error';
    const failure = isError ? failureCopy(props.state.failure) : null;
    const sourceStage = props.state.kind === 'progress' ? props.state.stage : null;
    const stage = props.state.kind === 'progress'
        ? visibleStageFor(props.state.stage)
        : null;
    const nativeRecoveryRef = React.useRef<React.ComponentRef<typeof View>>(null);
    const recoveryLabel = isError && props.state.signedIn
        ? t('settingsAccount.accountServiceOAuth.actions.openSettings')
        : t('settingsAccount.accountServiceOAuth.actions.startAgain');

    React.useEffect(() => {
        if (!isError) return;
        if (Platform.OS === 'web') {
            const documentValue = (globalThis as unknown as { document?: Document }).document;
            const control = documentValue?.querySelector<HTMLElement>(
                '[data-testid="oauth-account-directory-continue"]',
            );
            control?.focus();
            return;
        }
        focusNativeAccessibilityTarget(nativeRecoveryRef.current);
    }, [isError, props.state.kind === 'error' ? props.state.failure : null]);

    React.useEffect(() => {
        if (
            isError
            || (sourceStage !== 'waiting_approval'
                && sourceStage !== 'account_service_connected'
                && sourceStage !== 'home_added')
        ) return;
        props.onTerminalPresented?.();
    }, [isError, props.onTerminalPresented, sourceStage]);

    return (
        <View style={styles.root}>
            <Text
                testID="oauth-account-directory-service-identity"
                accessibilityLabel={t('settingsAccount.accountServiceOAuth.serviceIdentity', {
                    provider: props.state.providerName,
                    host: props.state.endpointUrl,
                })}
                numberOfLines={1}
                style={styles.serviceIdentity}
            >
                {identity}
            </Text>
            <SurfaceStateCard
                testID={isError
                    ? `oauth-account-directory-error-${props.state.failure}`
                    : `oauth-account-directory-stage-${stage}`}
                kind={isError
                    ? 'error'
                    : 'loading'}
                title={failure?.title ?? stageTitle(stage!)}
                reason={failure?.body ?? t('settingsAccount.accountServiceOAuth.focusedHomePreserved')}
                accessibilitySemantics={isError ? 'alert' : 'status'}
            />
            {isError ? (
                <View
                    ref={nativeRecoveryRef}
                    style={styles.recoveryAction}
                >
                    <RoundButton
                        testID="oauth-account-directory-continue"
                        size="normal"
                        title={recoveryLabel}
                        accessibilityLabel={recoveryLabel}
                        onPress={props.onRecovery}
                    />
                </View>
            ) : null}
        </View>
    );
}
