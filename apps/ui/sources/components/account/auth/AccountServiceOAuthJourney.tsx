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
    | 'home_added';

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

function endpointHost(endpointUrl: string): string {
    try {
        return new URL(endpointUrl).host;
    } catch {
        return endpointUrl;
    }
}

function stageTitle(stage: AccountServiceOAuthStage): string {
    switch (stage) {
        case 'verifying_service': return t('settingsAccount.accountServiceOAuth.stages.verifyingService');
        case 'signing_in': return t('settingsAccount.accountServiceOAuth.stages.signingIn');
        case 'saving_credentials': return t('settingsAccount.accountServiceOAuth.stages.signingIn');
        case 'signed_in': return t('settingsAccount.accountServiceOAuth.stages.signedIn');
        case 'finding_homes': return t('settingsAccount.accountServiceOAuth.stages.findingHomes');
        case 'connecting_home': return t('settingsAccount.accountServiceOAuth.stages.connectingHome');
        case 'waiting_approval': return t('settingsAccount.accountServiceOAuth.stages.waitingApproval');
        case 'home_added': return t('settingsAccount.accountServiceOAuth.stages.homeAdded');
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
}>): React.ReactElement {
    const styles = stylesheet;
    const host = endpointHost(props.state.endpointUrl);
    const identity = t('settingsAccount.accountServiceOAuth.serviceIdentity', {
        provider: props.state.providerName,
        host,
    });
    const isError = props.state.kind === 'error';
    const failure = isError ? failureCopy(props.state.failure) : null;
    const stage = props.state.kind === 'progress' ? props.state.stage : null;
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
                    : stage === 'waiting_approval'
                        ? 'warning'
                        : stage === 'home_added'
                            ? 'empty'
                            : 'loading'}
                iconName={!isError && stage === 'home_added'
                    ? 'check-circle'
                    : undefined}
                title={failure?.title ?? stageTitle(stage!)}
                reason={failure?.body ?? t('settingsAccount.accountServiceOAuth.focusedHomePreserved')}
                accessibilitySemantics={isError ? 'alert' : 'status'}
            />
            {isError ? (
                <View
                    ref={nativeRecoveryRef}
                    accessible={Platform.OS !== 'web'}
                    accessibilityRole={Platform.OS !== 'web' ? 'button' : undefined}
                    accessibilityLabel={recoveryLabel}
                    style={styles.recoveryAction}
                    onAccessibilityTap={props.onRecovery}
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
