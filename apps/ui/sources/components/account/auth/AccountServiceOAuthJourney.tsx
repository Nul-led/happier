import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { focusNativeAccessibilityTarget } from '@/keyboard/focusReturn';
import { formatEnrollmentExpiry } from '@/auth/pairing/pairingPresentation';
import {
    cancelPendingPreferredHomeEnrollment,
    getPendingPreferredHomeEnrollment,
    resumePendingPreferredHomeEnrollment,
    subscribePendingPreferredHomeEnrollment,
} from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import type { HomeLoginContinuationResult } from '@/sync/ops/accountDirectory/homeLoginApproval';
import { useAccountDirectoryActivePolling } from '@/sync/ops/accountDirectory/useAccountDirectoryActivePolling';
import {
    resolveSelectedAccountServiceEndpoint,
    subscribeAccountServiceEndpoint,
} from '@/sync/domains/server/serverProfiles';
import { isSelectedAccountServiceKey } from '@/sync/domains/accountDirectory/accountServiceSelection';

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

export type AccountServiceApprovalOutcome =
    | 'enrolled'
    | 'cancelled'
    | 'rejected'
    | 'expired'
    | 'partial_commit'
    | 'service_replaced'
    | 'failed';

type AccountServiceApprovalPresentation =
    | 'waiting'
    | 'unavailable'
    | Exclude<AccountServiceApprovalOutcome, 'enrolled'>;

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
    approvalActions: {
        width: '100%',
        maxWidth: 360,
        alignSelf: 'center',
        gap: 10,
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

function approvalOutcome(result: HomeLoginContinuationResult | null): AccountServiceApprovalOutcome | null {
    if (!result || result.kind === 'approval_required' || result.kind === 'transport_unavailable') return null;
    if (
        result.kind === 'enrolled'
        || result.kind === 'cancelled'
        || result.kind === 'rejected'
        || result.kind === 'expired'
        || result.kind === 'partial_commit'
    ) return result.kind;
    return 'failed';
}

function approvalCopy(
    presentation: AccountServiceApprovalPresentation,
    pending: ReturnType<typeof getPendingPreferredHomeEnrollment>,
): Readonly<{ title: string; body: string }> {
    switch (presentation) {
        case 'waiting': {
            const expiry = pending?.kind === 'approval_required'
                ? ` ${t('connect.expiresAtLabel')}: ${formatEnrollmentExpiry(pending.expiresAtMs)}`
                : '';
            return {
                title: t('settingsAccount.accountServiceOAuth.stages.waitingApproval'),
                body: `${t('settingsAccount.accountServiceOAuth.approvalWait.waitingBody')}${expiry}`,
            };
        }
        case 'unavailable':
            return {
                title: t('settingsAccount.accountServiceOAuth.errors.homeEnrollment.title'),
                body: t('connect.homeEnrollmentRetryBody'),
            };
        case 'rejected':
            return {
                title: t('approvals.status.rejected'),
                body: t('settingsAccount.accountServiceOAuth.errors.homeEnrollment.body'),
            };
        case 'expired':
            return {
                title: t('approvals.status.expired'),
                body: t('settingsAccount.accountServiceOAuth.approvalWait.expiredBody'),
            };
        case 'cancelled':
            return {
                title: t('settingsAccount.accountServiceOAuth.approvalWait.cancelledTitle'),
                body: t('settingsAccount.accountServiceOAuth.approvalWait.cancelledBody'),
            };
        case 'service_replaced':
            return failureCopy('identity_changed');
        case 'partial_commit':
        case 'failed':
            return failureCopy('home_enrollment_failed');
    }
}

export function AccountServiceOAuthJourney(props: Readonly<{
    state: AccountServiceOAuthJourneyState;
    onRecovery: () => void;
    onTerminalPresented?: () => void;
    approvalContinuation?: boolean;
    onApprovalOutcome?: (outcome: AccountServiceApprovalOutcome) => void;
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
    const approvalActive = props.approvalContinuation === true
        && sourceStage === 'waiting_approval';
    const pendingEnrollment = React.useSyncExternalStore(
        subscribePendingPreferredHomeEnrollment,
        getPendingPreferredHomeEnrollment,
        getPendingPreferredHomeEnrollment,
    );
    // The selection subscription only invalidates this presentation. Endpoint equality and
    // replacement authority remain in the canonical Account Service selection owner.
    const selectedAccountServiceEndpoint = React.useSyncExternalStore(
        subscribeAccountServiceEndpoint,
        resolveSelectedAccountServiceEndpoint,
        resolveSelectedAccountServiceEndpoint,
    );
    const [approvalPresentation, setApprovalPresentation] =
        React.useState<AccountServiceApprovalPresentation>('waiting');

    React.useEffect(() => {
        if (!approvalActive) setApprovalPresentation('waiting');
    }, [approvalActive]);

    React.useEffect(() => {
        if (!approvalActive || approvalPresentation !== 'waiting') return;
        if (pendingEnrollment?.kind === 'transport_unavailable') {
            setApprovalPresentation('unavailable');
        } else if (!pendingEnrollment) {
            setApprovalPresentation('failed');
        }
    }, [approvalActive, approvalPresentation, pendingEnrollment]);

    const applyApprovalResult = React.useCallback((result: HomeLoginContinuationResult | null) => {
        if (result?.kind === 'approval_required') {
            setApprovalPresentation('waiting');
            return;
        }
        if (result?.kind === 'transport_unavailable') {
            setApprovalPresentation('unavailable');
            return;
        }
        const outcome = approvalOutcome(result);
        if (outcome === 'enrolled') {
            props.onApprovalOutcome?.('enrolled');
        } else if (outcome) {
            setApprovalPresentation(outcome);
        }
    }, [props.onApprovalOutcome]);

    const resumeApproval = React.useCallback(async (): Promise<'success' | 'transient'> => {
        try {
            const result = await resumePendingPreferredHomeEnrollment();
            if (
                pendingEnrollment
                && !isSelectedAccountServiceKey(pendingEnrollment.serviceKey)
            ) {
                setApprovalPresentation('service_replaced');
                return 'success';
            }
            applyApprovalResult(result);
            return result?.kind === 'transport_unavailable' ? 'transient' : 'success';
        } catch {
            setApprovalPresentation('failed');
            return 'success';
        }
    }, [applyApprovalResult, pendingEnrollment]);

    useAccountDirectoryActivePolling(
        resumeApproval,
        approvalActive
            && approvalPresentation === 'waiting'
            && pendingEnrollment?.kind === 'approval_required',
    );

    React.useEffect(() => {
        if (!approvalActive || !pendingEnrollment) return;
        if (isSelectedAccountServiceKey(pendingEnrollment.serviceKey)) return;
        void cancelPendingPreferredHomeEnrollment(pendingEnrollment).finally(() => {
            setApprovalPresentation('service_replaced');
        });
    }, [approvalActive, pendingEnrollment, selectedAccountServiceEndpoint]);

    const cancelApproval = React.useCallback(async () => {
        try {
            await cancelPendingPreferredHomeEnrollment(
                pendingEnrollment ?? undefined,
            );
            setApprovalPresentation('cancelled');
        } catch {
            setApprovalPresentation('failed');
        }
    }, [pendingEnrollment]);

    const finishApproval = React.useCallback(() => {
        if (approvalPresentation === 'waiting' || approvalPresentation === 'unavailable') return;
        props.onApprovalOutcome?.(approvalPresentation);
    }, [approvalPresentation, props.onApprovalOutcome]);
    const currentApprovalCopy = approvalActive
        ? approvalCopy(approvalPresentation, pendingEnrollment)
        : null;

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
            || (sourceStage !== 'account_service_connected'
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
                    : approvalActive
                        ? `oauth-account-directory-approval-${approvalPresentation}`
                    : `oauth-account-directory-stage-${stage}`}
                kind={isError || (approvalActive && approvalPresentation !== 'waiting')
                    ? 'error'
                    : 'loading'}
                title={failure?.title ?? currentApprovalCopy?.title ?? stageTitle(stage!)}
                reason={failure?.body
                    ?? currentApprovalCopy?.body
                    ?? t('settingsAccount.accountServiceOAuth.focusedHomePreserved')}
                accessibilitySemantics={isError || (approvalActive && approvalPresentation !== 'waiting') ? 'alert' : 'status'}
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
            ) : approvalActive ? (
                <View style={styles.approvalActions}>
                    {approvalPresentation === 'unavailable' ? (
                        <RoundButton
                            testID="oauth-account-directory-approval-retry"
                            size="normal"
                            title={t('common.retry')}
                            action={resumeApproval}
                        />
                    ) : null}
                    {approvalPresentation === 'waiting' || approvalPresentation === 'unavailable' ? (
                        <RoundButton
                            testID="oauth-account-directory-approval-cancel"
                            size="normal"
                            display="inverted"
                            title={t('approvals.stopWaiting')}
                            action={cancelApproval}
                        />
                    ) : (
                        <RoundButton
                            testID="oauth-account-directory-approval-continue"
                            size="normal"
                            title={t('common.continue')}
                            onPress={finishApproval}
                        />
                    )}
                </View>
            ) : null}
        </View>
    );
}
