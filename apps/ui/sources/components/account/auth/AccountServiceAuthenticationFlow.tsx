import * as React from 'react';
import { Linking } from 'react-native';
import type { AccountContinuationIntent } from '@happier-dev/cli-common/accountService';

import type { AccountDirectoryAuthenticationAction, AccountDirectoryAuthTransport, VerifiedAccountServiceAuthority } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { isSafeExternalAuthUrl } from '@/auth/providers/externalAuthUrl';
import { getAuthProvider } from '@/auth/providers/registry';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { WelcomeActionCard } from '@/components/onboarding/preAuth/WelcomeActionCard';
import { WelcomeActionList } from '@/components/onboarding/preAuth/WelcomeActionList';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { AccountDirectoryKeyLoginForm, type AccountDirectoryKeyLoginOutcome } from './AccountDirectoryKeyLoginForm';
import { t } from '@/text';
import { startAccountServiceOAuthAuthentication } from './accountServiceAuthenticationActions';
import type { AccountPostAuthInput, AccountPostAuthResult } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';

export type AccountServiceAuthenticationFlowProps = Readonly<{
    service: Readonly<{
        authority: VerifiedAccountServiceAuthority;
        displayName: string;
        authenticationActions: readonly AccountDirectoryAuthenticationAction[];
        transport?: AccountDirectoryAuthTransport;
    }>;
    intent: AccountContinuationIntent;
    returnTo: string;
    accountEntryReturnTo?: string;
    onResult: (result: AccountDirectoryKeyLoginOutcome) => Promise<void> | void;
    onExternalAuthStarted: () => Promise<void> | void;
    onBack: () => void;
    onReauthenticate?: (input: AccountPostAuthInput) => void | Promise<void>;
    onOpenHomeAuthentication?: (
        input: AccountPostAuthInput,
        homeServerIdentityId: string,
        previous: AccountPostAuthResult,
    ) => void | Promise<void>;
    isCurrent?: () => boolean;
    signal?: AbortSignal;
}>;

export function AccountServiceAuthenticationFlow(props: AccountServiceAuthenticationFlowProps): React.ReactElement {
    const inFlightRef = React.useRef(false);
    const [pendingActionId, setPendingActionId] = React.useState<string | null>(null);
    const [keySelection, setKeySelection] = React.useState<'login' | 'provision' | null>(null);
    const [launchFailed, setLaunchFailed] = React.useState(false);
    const actions = props.service.authenticationActions;
    const admission = React.useMemo(() => ({
        pendingActionId,
        run: async (actionId: string, action: () => Promise<void> | void) => {
            if (inFlightRef.current || props.signal?.aborted || props.isCurrent?.() === false) return;
            inFlightRef.current = true;
            setPendingActionId(actionId);
            try {
                await action();
            } finally {
                inFlightRef.current = false;
                setPendingActionId(null);
            }
        },
    }), [pendingActionId, props]);
    if (keySelection) {
        return <AccountDirectoryKeyLoginForm
            service={props.service.authority}
            serviceName={props.service.displayName}
            intent={props.intent}
            mode={keySelection}
            transport={props.service.transport}
            onResult={props.onResult}
            onBack={() => setKeySelection(null)}
            onReauthenticate={props.onReauthenticate}
            onOpenHomeAuthentication={props.onOpenHomeAuthentication}
            isCurrent={props.isCurrent}
            signal={props.signal}
        />;
    }
    if (launchFailed) {
        return <SurfaceStateCard testID="account-service-auth-launch-failed" kind="error"
            title={t('welcome.signInServiceUnavailableTitle')} reason={t('errors.operationFailed')}
            accessibilitySemantics="alert"
            action={{ label: t('common.retry'), onPress: () => setLaunchFailed(false) }} />;
    }
    return <WelcomeActionList admission={admission}>
        {actions.map(({ method, action, execution }) => {
            const testID = `account-service-auth-${method.id}-${action.id}-${action.mode}`;
            const providerName = method.presentation?.displayName ?? getAuthProvider(method.id)?.displayName ?? method.id;
            const title = action.id === 'provision'
                ? t('welcome.welcomePrimaryButton')
                : execution.kind === 'key_entry'
                    ? t('welcome.continueWithKey')
                    : t('welcome.signUpWithProvider', { provider: providerName });
            const subtitle = execution.kind === 'generated_key'
                ? t('welcome.welcomePrimarySubtitle')
                : action.id === 'provision'
                    ? t('welcome.signUpWithProvider', { provider: providerName })
                    : props.service.displayName;
            return <WelcomeActionCard key={testID} testID={testID} title={title}
                subtitle={subtitle} iconName={execution.kind === 'oauth' ? 'sign-in' : 'key'} onPress={async () => {
                    if (execution.kind === 'key_entry' || execution.kind === 'generated_key') {
                        setKeySelection(execution.kind === 'generated_key' ? 'provision' : 'login');
                        return;
                    }
                    if (props.isCurrent?.() === false) return;
                    let started: Awaited<ReturnType<typeof startAccountServiceOAuthAuthentication>> | null = null;
                    try {
                        started = await startAccountServiceOAuthAuthentication({
                            authority: props.service.authority,
                            execution,
                            intent: props.intent,
                            returnTo: props.returnTo,
                            accountEntryReturnTo: props.accountEntryReturnTo,
                            transport: props.service.transport,
                            signal: props.signal,
                        });
                        if (props.signal?.aborted || props.isCurrent?.() === false) {
                            await TokenStorage.clearPendingAccountDirectoryAuth({
                                endpoint: props.service.authority.endpointUrl,
                                serverIdentityId: props.service.authority.serverIdentityId,
                            }, { expected: started.pending }).catch(() => false);
                            return;
                        }
                        if (!isSafeExternalAuthUrl(started.url)) throw new Error(t('errors.operationFailed'));
                        await Linking.openURL(started.url);
                        await props.onExternalAuthStarted();
                    } catch {
                        if (started) {
                            await TokenStorage.clearPendingAccountDirectoryAuth({
                                endpoint: props.service.authority.endpointUrl,
                                serverIdentityId: props.service.authority.serverIdentityId,
                            }, { expected: started.pending }).catch(() => false);
                        }
                        if (!props.signal?.aborted) setLaunchFailed(true);
                    }
                }} />;
        })}
        <WelcomeActionCard testID="account-service-auth-back" title={t('common.back')} iconName="arrow-left" onPress={props.onBack} />
    </WelcomeActionList>;
}
