import * as React from 'react';
import type { SessionEffectiveAccessV1 } from '@happier-dev/protocol';

import { storage } from '@/sync/domains/state/storage';
import { findSessionListLookupSession } from '@/sync/domains/session/listing/sessionListLookupState';
import { buildSessionContextFacts } from '@/sync/domains/session/presentation/sessionContextPresentation';
import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { useServerCredentialAccountScopeBindings } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { observeTeam, observeTeamGroup } from '@/sync/engine/teams/teamsDirectoryEngine';
import { subscribeTeamsSnapshots } from '@/sync/store/teams/teamsSnapshots';

type AudienceTarget = Readonly<{
    address: SessionAddress;
    audience: NonNullable<SessionEffectiveAccessV1['audienceContext']>;
}>;

/** One surface binding to existing exact-Home credentials and Team projections, never per card. */
export function useSessionAudienceContext(addresses: readonly SessionAddress[]) {
    const addressesKey = JSON.stringify([...new Map(addresses.map((address) => [sessionAddressKey(address), address])).values()]
        .sort((a, b) => sessionAddressKey(a).localeCompare(sessionAddressKey(b))));
    // These are our own serialized address tuples. Keeping this primitive as the selector result
    // makes streaming and unrelated row mutations invisible to audience observation.
    const stableAddresses = React.useMemo(() => JSON.parse(addressesKey) as SessionAddress[], [addressesKey]);
    const targetsKey = storage(React.useCallback((state) => JSON.stringify(stableAddresses.flatMap((address) => {
        const row = findSessionListLookupSession(state, address)?.session;
        const hydrated = state.sessions[address.sessionId];
        const session = row ?? (hydrated?.serverId === address.serverId ? hydrated : null);
        const audience = session?.access?.audienceContext;
        return audience ? [{ address, audience }] : [];
    })), [stableAddresses]));
    const targets = React.useMemo(() => JSON.parse(targetsKey) as AudienceTarget[], [targetsKey]);
    const credentialBindingsByServerId = useServerCredentialAccountScopeBindings(
        stableAddresses.map((address) => address.serverId),
    );
    const scopes = React.useMemo(() => {
        const result = new Map<string, ServerAccountScope>();
        for (const [serverId, binding] of credentialBindingsByServerId) {
            result.set(serverId, binding.scope);
        }
        return result;
    }, [credentialBindingsByServerId]);
    const observedKey = JSON.stringify(targets.flatMap(({ address, audience }) => {
        const scope = scopes.get(address.serverId);
        return scope ? [{ scope, audience }] : [];
    }));
    React.useEffect(() => {
        const releases: (() => void)[] = [];
        const teams = new Set<string>();
        const groups = new Set<string>();
        for (const { address, audience } of targets) {
            const scope = scopes.get(address.serverId);
            if (!scope) continue;
            const teamAddress = { serverId: address.serverId, teamId: audience.teamId };
            const teamKey = JSON.stringify([scope.serverId, scope.accountId, audience.teamId]);
            if (!teams.has(teamKey)) {
                teams.add(teamKey);
                releases.push(observeTeam(scope, teamAddress));
            }
            if (audience.kind === 'group') {
                const groupKey = JSON.stringify([teamKey, audience.groupId]);
                if (!groups.has(groupKey)) {
                    groups.add(groupKey);
                    releases.push(observeTeamGroup(scope, teamAddress, audience.groupId));
                }
            }
        }
        return () => { for (const release of releases) release(); };
        // Exact observer identity; a row streaming without changing audience keeps its observers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [observedKey]);
    const readLabels = React.useCallback(() => JSON.stringify(targets.map(({ address, audience }) => [
        sessionAddressKey(address),
        buildSessionContextFacts({ address, audienceContext: audience, audienceScope: scopes.get(address.serverId) }).audience?.label ?? null,
    ])), [scopes, targets]);
    const labelsVersion = React.useSyncExternalStore(subscribeTeamsSnapshots, readLabels, readLabels);
    const labelsBySessionKey = React.useMemo(() => new Map<string, string | null>(JSON.parse(labelsVersion)), [labelsVersion]);
    return React.useMemo(() => ({
        credentialBindingsByServerId,
        scopes,
        labelsVersion,
        labelsBySessionKey,
    }), [credentialBindingsByServerId, scopes, labelsVersion, labelsBySessionKey]);
}
