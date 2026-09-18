import * as React from 'react';

import {
    resolveHomeGovernanceViewState,
    type HomeGovernanceViewState,
} from '@/components/settings/home/governance/homeGovernanceViewState';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';

import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { useHomeGovernanceSnapshot } from './useHomeGovernanceSnapshot';

/**
 * What this device can currently say about one explicitly addressed Home.
 *
 * `unknown_home` and `signed_out` are facts about this device's saved Homes,
 * not answers from the Home, and are deliberately distinct from every state the
 * Home itself reports.
 */
export type HomeAdministrationBinding =
    | Readonly<{ kind: 'resolving' }>
    | Readonly<{ kind: 'unknown_home' }>
    | Readonly<{ kind: 'signed_out'; homeName: string }>
    | Readonly<{
        kind: 'bound';
        scope: ServerAccountScope;
        homeName: string;
        state: HomeGovernanceViewState;
    }>;

const RESOLVING: HomeAdministrationBinding = Object.freeze({ kind: 'resolving' as const });
const UNKNOWN_HOME: HomeAdministrationBinding = Object.freeze({ kind: 'unknown_home' as const });

/**
 * Binds Home Administration to one exact Home for the whole time a screen is
 * open.
 *
 * The Home is addressed by the route's `serverId`, never by whichever Home
 * happens to be focused, so switching Homes elsewhere in the app cannot
 * retarget an open administration screen or a mutation started from it. The
 * Account comes from the Home-family credential binding, so signing out or
 * signing in as someone else on this Home moves the screen with it instead of
 * leaving it addressed to an Account this device no longer holds.
 */
export function useHomeAdministration(serverIdRaw: string): HomeAdministrationBinding {
    const serverId = serverIdRaw.trim();
    const profile = React.useMemo(
        () => (serverId ? getServerProfileById(serverId) : null),
        [serverId],
    );
    const homeName = (profile?.name ?? '').trim() || (profile?.serverUrl ?? '');

    const resolution = useServerCredentialAccountScopeResolution(serverId);
    const scope: ServerAccountScope | null = resolution.kind === 'bound' ? resolution.scope : null;

    // Subscribing is what declares this screen a live consumer of that exact
    // Home; the engine owns when it is fetched and the screen never refetches.
    const snapshot = useHomeGovernanceSnapshot(scope);

    return React.useMemo<HomeAdministrationBinding>(() => {
        switch (resolution.kind) {
            case 'resolving':
                return RESOLVING;
            case 'unknown_home':
                return UNKNOWN_HOME;
            case 'signed_out':
                return Object.freeze({ kind: 'signed_out' as const, homeName });
            case 'bound':
                return Object.freeze({
                    kind: 'bound' as const,
                    scope: resolution.scope,
                    homeName,
                    state: resolveHomeGovernanceViewState(snapshot),
                });
        }
    }, [resolution, homeName, snapshot]);
}
