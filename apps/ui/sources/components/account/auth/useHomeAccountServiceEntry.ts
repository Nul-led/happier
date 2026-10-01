import * as React from 'react';
import { resolveEffectiveSignInService } from '@happier-dev/cli-common/accountService';

import { useAccountServiceDisplayName } from '@/components/account/auth/accountServiceDisplayName';
import {
    useAccountServiceEntryOptions,
    type AccountServiceEntryOptions,
    type AccountServiceEntryTargetContext,
} from '@/components/account/auth/useAccountServiceEntryOptions';
import { useStoredAccountServiceSignIn } from '@/components/account/auth/useAccountServiceSignedInName';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';

export type HomeAccountServiceEntry = Readonly<{
    entry: AccountServiceEntryOptions;
    /** The service's name from its one name owner, or null when it has none to offer. */
    namedService: string | null;
    /** Whether the Home's sign-in policy has been read (else "not offered" only means "not known yet"). */
    policyReady: boolean;
    /** The policy read failed (the Home did not answer it); retried by the features owner. */
    policyFailed: boolean;
}>;

/**
 * The sign-in service a signed-in person reaches from a Home they are in (the Home's advertised
 * policy, else this device's selection) and its name. The account/Home popover and the "Add a
 * Home / Sign in" sheet both read it here, so they can never disagree about which service they offer.
 */
export function useHomeAccountServiceEntry(input: Readonly<{
    profile: ServerProfile | null;
    runtimeOrigin: string | null;
    homeCarrier: HomeCarrier | null;
}>): HomeAccountServiceEntry {
    const { profile, runtimeOrigin, homeCarrier } = input;
    const { policy, ready: policyReady, failed: policyFailed } = useHomeSignInServicePolicy(profile);
    const targetContext = React.useMemo<AccountServiceEntryTargetContext>(() => {
        if (!profile) return { kind: 'none' };
        return {
            kind: 'home',
            target: { kind: 'saved_profile', profileRef: profile.id },
            ...(policy ? { policy } : {}),
            selfService: {
                endpointUrl: profile.canonicalServerUrl ?? profile.serverUrl,
                ...(profile.serverIdentityId ? { expectedServerIdentityId: profile.serverIdentityId } : {}),
                ...(runtimeOrigin ? { runtimeOrigin } : {}),
                ...(homeCarrier ? { homeCarrier } : {}),
            },
        };
    }, [homeCarrier, policy, profile, runtimeOrigin]);
    const entry = useAccountServiceEntryOptions(targetContext);
    const discovery = entry.status === 'ready' ? entry.discovery : null;
    const namedService = useAccountServiceDisplayName({
        url: discovery?.endpointUrl ?? entry.endpoint.url,
        serverIdentityId: discovery?.serverIdentityId ?? entry.endpoint.serverIdentityId,
        savedName: entry.endpoint.displayName,
        advertisedName: discovery?.accountServiceDisplayName,
    });
    return React.useMemo(
        () => ({ entry, namedService, policyReady, policyFailed }),
        [entry, namedService, policyFailed, policyReady],
    );
}

/** The sign-in policy a Home advertises (its features snapshot), once read. */
function useHomeSignInServicePolicy(profile: ServerProfile | null) {
    const profileScopeId = profile ? resolveServerProfileScopeId(profile) : '';
    const featuresSnapshot = useServerFeaturesSnapshotForServerId(profileScopeId, { enabled: Boolean(profile) });
    const ready = featuresSnapshot.status === 'ready';
    return {
        policy: ready ? featuresSnapshot.features.signInService ?? null : null,
        // A Home without the features endpoint advertises no policy: that is an answer, not a wait.
        ready: ready || featuresSnapshot.status === 'unsupported',
        failed: featuresSnapshot.status === 'error',
    };
}

export type HomeAccountServiceSummary =
    /** The Home offers no sign-in service, or its policy has not been read yet. */
    | Readonly<{ kind: 'none' }>
    /** The Home is its own sign-in service: the person signed in to it is signed in to the service. */
    | Readonly<{ kind: 'self' }>
    /** Another service; `signedIn` is this device's stored sign-in to it (null until read). */
    | Readonly<{ kind: 'service'; serviceName: string | null; signedIn: boolean | null }>;

const NO_SERVICE_ENDPOINT = Object.freeze({ url: '', serverIdentityId: null });

/**
 * The same service the popover's entry resolves (`resolveEffectiveSignInService` over this Home's
 * policy), reduced to what always-mounted chrome can show: which kind it is, its name and this
 * device's stored sign-in. Local reads only; the popover probes the service when it opens.
 */
export function useHomeAccountServiceSummary(profile: ServerProfile | null): HomeAccountServiceSummary {
    const { policy } = useHomeSignInServicePolicy(profile);
    const effective = profile
        ? resolveEffectiveSignInService({
            targetContext: {
                kind: 'home',
                target: { kind: 'saved_profile', profileRef: profile.id },
                ...(policy ? { policy } : {}),
            },
        })
        : ({ kind: 'not_offered' } as const);
    const serviceUrl = effective.kind === 'external' ? effective.endpoint : null;
    const serviceIdentityId = effective.kind === 'external' ? effective.expectedServerIdentityId ?? null : null;
    const endpoint = React.useMemo(() => serviceUrl
        ? { url: serviceUrl, serverIdentityId: serviceIdentityId }
        : NO_SERVICE_ENDPOINT, [serviceIdentityId, serviceUrl]);
    const signIn = useStoredAccountServiceSignIn(endpoint);
    return React.useMemo<HomeAccountServiceSummary>(() => {
        if (effective.kind === 'self') return { kind: 'self' };
        if (!serviceUrl) return { kind: 'none' };
        return { kind: 'service', serviceName: signIn.serviceName, signedIn: signIn.signedIn };
    }, [effective.kind, serviceUrl, signIn.serviceName, signIn.signedIn]);
}
