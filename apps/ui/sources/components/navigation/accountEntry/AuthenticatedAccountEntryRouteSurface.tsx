import * as React from 'react';
import { accountDirectoryAuthClient, createVerifiedAccountServiceAuthority, type AccountDirectoryAuthMethodDiscovery, type AccountDirectoryAuthTransport } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { AccountServiceAuthenticationFlow } from '@/components/account/auth/AccountServiceAuthenticationFlow';
import { AccountServiceContinuation } from '@/components/account/auth/AccountServiceContinuation';
import { AccountServiceHomeAuthenticationAdapter } from '@/components/account/auth/AccountServiceHomeAuthenticationAdapter';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { WizardModalShell } from '@/components/onboarding/ui/WizardModalShell';
import { t } from '@/text';
import { consumeAccountServiceOAuthReturn } from '@/sync/ops/accountDirectory/consumeAccountServiceOAuthReturn';
import type { AccountPostAuthInput, AccountPostAuthResult } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';

import { AUTHENTICATED_ACCOUNT_ENTRY_ROUTE, type AuthenticatedAccountEntryRequest } from './authenticatedAccountEntryRoute';

type State =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'unavailable' }>
    | Readonly<{ kind: 'methods'; discovery: AccountDirectoryAuthMethodDiscovery; intent: AccountPostAuthInput['intent'] }>
    | Readonly<{ kind: 'continuation'; input: AccountPostAuthInput; result: AccountPostAuthResult }>
    | Readonly<{ kind: 'home_auth'; input: AccountPostAuthInput; previous: AccountPostAuthResult; homeServerIdentityId: string }>;

function isTerminalResult(result: AccountPostAuthResult): boolean {
    return result.kind === 'account_connected' || result.kind === 'home_entered'
        || result.kind === 'home_enrolled' || result.kind === 'home_linked';
}

export function AuthenticatedAccountEntryRouteSurface(props: Readonly<{
    request: AuthenticatedAccountEntryRequest;
    routeParams: Readonly<Record<string, string | string[] | undefined>>;
    transport?: AccountDirectoryAuthTransport;
    onExit: (returnTo: string) => void;
}>): React.ReactElement {
    const [retryGeneration, setRetryGeneration] = React.useState(0);
    const [state, setState] = React.useState<State>({ kind: 'loading' });
    const operationSequenceRef = React.useRef(0);
    const activeOperationRef = React.useRef(0);
    const recoveryAbortRef = React.useRef<AbortController | null>(null);
    const exit = React.useCallback(() => {
        recoveryAbortRef.current?.abort();
        props.onExit(props.request.returnTo);
    }, [props.onExit, props.request.returnTo]);

    React.useEffect(() => () => recoveryAbortRef.current?.abort(), []);

    React.useEffect(() => {
        const operation = ++operationSequenceRef.current;
        activeOperationRef.current = operation;
        const controller = new AbortController();
        recoveryAbortRef.current?.abort();
        recoveryAbortRef.current = controller;
        setState({ kind: 'loading' });
        void (async () => {
            const returned = await consumeAccountServiceOAuthReturn(props.routeParams, {
                invokingSurface: AUTHENTICATED_ACCOUNT_ENTRY_ROUTE,
                signal: controller.signal,
                transport: props.transport,
            });
            if (controller.signal.aborted || operation !== activeOperationRef.current) return;
            if (returned.kind === 'retryable') {
                setState({ kind: 'unavailable' });
                return;
            }
            // `invalid` is a consumed or unrecognised one-shot return (a reload
            // after custody was claimed). Retrying the same params can never
            // succeed, so it falls through to read-only discovery exactly like
            // `absent`, inferring no link, enrollment or focus from them.
            if (returned.kind === 'consumed') {
                if (isTerminalResult(returned.result)) {
                    exit();
                    return;
                }
                setState({ kind: 'continuation', input: returned.input, result: returned.result });
                return;
            }
            const discovery = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                endpointUrl: props.request.service.endpointUrl,
                expectedServerIdentityId: props.request.service.serverIdentityId,
                ...props.transport,
                signal: controller.signal,
            });
            if (controller.signal.aborted || operation !== activeOperationRef.current) return;
            if (discovery.kind !== 'supported_account_service') {
                setState({ kind: 'unavailable' });
                return;
            }
            setState({ kind: 'methods', discovery, intent: props.request.intent });
        })().catch(() => {
            if (!controller.signal.aborted && operation === activeOperationRef.current) setState({ kind: 'unavailable' });
        });
        return () => {
            controller.abort();
            if (activeOperationRef.current === operation) activeOperationRef.current = 0;
        };
    }, [exit, props.request, props.routeParams, props.transport, retryGeneration]);

    const showExactServiceMethods = React.useCallback(async (input: AccountPostAuthInput) => {
        recoveryAbortRef.current?.abort();
        const controller = new AbortController();
        recoveryAbortRef.current = controller;
        const operation = ++operationSequenceRef.current;
        activeOperationRef.current = operation;
        setState({ kind: 'loading' });
        try {
            const discovery = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                endpointUrl: input.service.endpointUrl,
                expectedServerIdentityId: input.service.serverIdentityId,
                ...props.transport,
                signal: controller.signal,
            });
            if (controller.signal.aborted || operation !== activeOperationRef.current) return;
            if (discovery.kind !== 'supported_account_service') {
                setState({ kind: 'unavailable' });
                return;
            }
            setState({ kind: 'methods', discovery, intent: input.intent });
        } catch {
            if (!controller.signal.aborted && operation === activeOperationRef.current) setState({ kind: 'unavailable' });
        }
    }, [props.transport]);

    const title = props.request.intent.kind === 'link' ? t('settingsAccount.accountServiceLinkThisHome') : t('settingsAccount.accountServiceHomes');
    const discovery = state.kind === 'methods' ? state.discovery : null;
    const serviceName = discovery?.accountServiceDisplayName ?? discovery?.endpointUrl ?? props.request.service.endpointUrl;

    let content: React.ReactNode;
    if (state.kind === 'loading') {
        // Directory discovery, adoption, assertion mint and approval polling all
        // sit behind this one wait. The contract names it, so it is announced
        // rather than left as an unlabeled spinner.
        content = <SurfaceStateCard testID="authenticated-account-entry-loading" kind="loading"
            title={t('settingsAccount.accountServiceOAuth.stages.findingHomes')} accessibilitySemantics="status" />;
    } else if (state.kind === 'unavailable') {
        content = <SurfaceStateCard testID="authenticated-account-entry-unavailable" kind="error" title={t('welcome.signInServiceUnavailableTitle')}
            reason={t('settingsAccount.accountServiceDiscoveryUnavailableDescription')} accessibilitySemantics="alert"
            action={{ label: t('common.retry'), onPress: () => setRetryGeneration((value) => value + 1) }} />;
    } else if (state.kind === 'home_auth') {
        content = <AccountServiceHomeAuthenticationAdapter
            input={state.input}
            previous={state.previous}
            homeServerIdentityId={state.homeServerIdentityId}
            returnTo={AUTHENTICATED_ACCOUNT_ENTRY_ROUTE}
            accountEntryReturnTo={props.request.returnTo}
            onResult={async (result) => {
                if (isTerminalResult(result)) {
                    exit();
                    return;
                }
                setState({ kind: 'continuation', input: state.input, result });
            }}
            onBack={() => setState({ kind: 'continuation', input: state.input, result: state.previous })}
        />;
    } else if (state.kind === 'continuation') {
        content = <AccountServiceContinuation input={state.input} result={state.result}
            onResult={async (result, input) => {
                if (isTerminalResult(result)) {
                    exit();
                    return;
                }
                setState({ kind: 'continuation', input: input ?? state.input, result });
            }} onReauthenticate={showExactServiceMethods}
            onOpenHomeAuthentication={(input, homeServerIdentityId, previous) => {
                setState({ kind: 'home_auth', input, previous, homeServerIdentityId });
            }}
            onBack={exit} />;
    } else {
        content = <AccountServiceAuthenticationFlow service={{
            authority: createVerifiedAccountServiceAuthority(state.discovery),
            displayName: serviceName,
            authenticationActions: state.discovery.authenticationActions,
            transport: props.transport,
        }} intent={state.intent} returnTo={AUTHENTICATED_ACCOUNT_ENTRY_ROUTE}
            accountEntryReturnTo={props.request.returnTo}
            onResult={(result) => {
                if (isTerminalResult(result)) exit();
            }}
            onReauthenticate={showExactServiceMethods}
            onOpenHomeAuthentication={(input, homeServerIdentityId, previous) => {
                setState({ kind: 'home_auth', input, previous, homeServerIdentityId });
            }}
            signal={recoveryAbortRef.current?.signal}
            onExternalAuthStarted={() => undefined} onBack={exit} isCurrent={() => activeOperationRef.current > 0} />;
    }

    return <WizardModalShell testID="authenticated-account-entry-wizard" stepIndex={state.kind === 'methods' ? 0 : 1}
        stepCount={2} layoutPresentation="auto" title={title} subtitle={serviceName} showSkip={false} onBack={exit}>
        {content}
    </WizardModalShell>;
}
