import * as React from 'react';

import { acquireAccountServiceAuthTransport } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import {
    projectAuthEntryMethodCapabilities,
    projectAuthenticationMethodCapabilities,
    type AuthenticationMethodCapabilities,
} from '@/auth/capabilities/authMethodCapabilities';
import { fetchHomeAuthEntry } from '@/auth/entry/authEntryClient';
import type { AccountHomeAuthenticationContinuation } from '@/auth/storage/tokenStorage';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { resolveServerProfileForPortableIdentity, resolveServerProfileScopeId } from '@/sync/domains/server/serverProfiles';
import { resumeAccountServicePostAuth, type AccountPostAuthInput, type AccountPostAuthResult } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';
import { t } from '@/text';

import { HomeAuthenticationFlow } from './HomeAuthenticationFlow';

export function AccountServiceHomeAuthenticationAdapter(props: Readonly<{
    input: AccountPostAuthInput;
    previous: AccountPostAuthResult;
    homeServerIdentityId: string;
    returnTo: string;
    accountEntryReturnTo?: string;
    onResult: (result: AccountPostAuthResult) => void | Promise<void>;
    onBack: () => void;
}>): React.ReactElement {
    const resolved = resolveServerProfileForPortableIdentity(props.homeServerIdentityId);
    const profile = resolved.kind === 'resolved' ? resolved.profile : null;
    const scopeId = profile ? resolveServerProfileScopeId(profile) : null;
    const canonicalServerUrl = profile?.canonicalServerUrl ?? profile?.serverUrl ?? null;
    const snapshot = useServerFeaturesSnapshotForServerId(scopeId, { enabled: Boolean(scopeId) });
    const [transportState, setTransportState] = React.useState<
        | Readonly<{ kind: 'loading' }>
        | Readonly<{ kind: 'ready'; transport: Awaited<ReturnType<typeof acquireAccountServiceAuthTransport>>['transport'] }>
        | Readonly<{ kind: 'unavailable' }>
    >({ kind: 'loading' });
    const [authenticationState, setAuthenticationState] = React.useState<
        | Readonly<{ kind: 'loading' }>
        | Readonly<{ kind: 'ready'; capabilities: AuthenticationMethodCapabilities }>
        | Readonly<{ kind: 'unavailable' }>
    >({ kind: 'loading' });

    React.useEffect(() => {
        if (!canonicalServerUrl) {
            setTransportState({ kind: 'unavailable' });
            return;
        }
        let current = true;
        let close = async () => {};
        void acquireAccountServiceAuthTransport({
            serverIdentityId: props.homeServerIdentityId,
            canonicalServerUrl,
        }).then((acquired) => {
            close = acquired.close;
            if (current) setTransportState({ kind: 'ready', transport: acquired.transport });
            else void acquired.close();
        }).catch(() => {
            if (current) setTransportState({ kind: 'unavailable' });
        });
        return () => {
            current = false;
            void close();
        };
    }, [canonicalServerUrl, props.homeServerIdentityId]);

    React.useEffect(() => {
        if (!canonicalServerUrl || !scopeId || snapshot.status !== 'ready' || transportState.kind !== 'ready') {
            setAuthenticationState({ kind: 'loading' });
            return;
        }
        let current = true;
        const controller = new AbortController();
        setAuthenticationState({ kind: 'loading' });
        void fetchHomeAuthEntry({
            endpointUrl: canonicalServerUrl,
            serverId: scopeId,
            ...transportState.transport,
            signal: controller.signal,
        }).then((entry) => {
            if (!current) return;
            if (entry.kind === 'ready' && entry.projection.state === 'ready') {
                setAuthenticationState({
                    kind: 'ready',
                    capabilities: projectAuthEntryMethodCapabilities(entry.projection),
                });
                return;
            }
            if (entry.kind === 'unsupported') {
                setAuthenticationState({
                    kind: 'ready',
                    capabilities: projectAuthenticationMethodCapabilities(snapshot.features),
                });
                return;
            }
            setAuthenticationState({ kind: 'unavailable' });
        }).catch(() => {
            if (current) setAuthenticationState({ kind: 'unavailable' });
        });
        return () => {
            current = false;
            controller.abort();
        };
    }, [canonicalServerUrl, scopeId, snapshot, transportState]);

    if (!profile || snapshot.status === 'error' || snapshot.status === 'unsupported'
        || transportState.kind === 'unavailable' || authenticationState.kind === 'unavailable') {
        return <SurfaceStateCard testID="account-service-home-auth-unavailable" kind="error"
            title={t('welcome.serverUnavailableTitle')} reason={t('errors.operationFailed')}
            accessibilitySemantics="alert" action={{ label: t('common.back'), onPress: props.onBack }} />;
    }
    if (snapshot.status === 'loading' || transportState.kind === 'loading' || authenticationState.kind === 'loading') {
        return <ActivitySpinner />;
    }

    const capabilities = authenticationState.capabilities;
    const continuation: AccountHomeAuthenticationContinuation = {
        endpoint: props.input.service.endpointUrl,
        serverIdentityId: props.input.service.serverIdentityId,
        canonicalServerUrl: props.input.service.canonicalServerUrl,
        entryIntent: props.input.intent,
        credentialTokenDigest: props.input.credentialTokenDigest,
        returnTo: props.returnTo,
        ...(props.accountEntryReturnTo ? { accountEntryReturnTo: props.accountEntryReturnTo } : {}),
        homeServerIdentityId: props.homeServerIdentityId,
    };
    return <HomeAuthenticationFlow
        target={{ kind: 'saved_profile', profileRef: profile.id }}
        actions={capabilities.authenticationActions}
        transport={transportState.transport}
        keyChallengeV2Available={snapshot.features.capabilities.auth.keyChallenge.v2 === true}
        returnTo={props.returnTo}
        accountContinuation={continuation}
        signal={props.input.signal}
        onAuthenticated={async (authenticatedHome) => {
            await props.onResult(await resumeAccountServicePostAuth(props.input, props.previous, authenticatedHome));
        }}
        onBack={props.onBack}
    />;
}
