import * as React from 'react';

import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { listTeamMembers } from '@/sync/ops/teams/teamMemberOperations';

/**
 * Names the recipients an access manager can see but Lane 04's grant projection cannot.
 *
 * A Session granted to a Team has one grant row and many recipients, so every recipient
 * reachable only through that Team has no principal row to take a name from and the
 * encryption resource deliberately carries none. This asks the Home the same bounded
 * `teams.members.list` question the responsibility picker and the Home governance picker
 * already ask — exact `accountId` equality, one Account at a time — and only for the
 * recipients currently on screen. It never pages a roster, never caches a directory, and
 * never invents a label: an Account the Team lookup does not answer for keeps its
 * identifier, which is what a Group-only or out-of-Team recipient still shows.
 */
export function useSessionAccessTeamRecipientLabels(input: Readonly<{
    scope: ServerAccountScope;
    /** The Team grants this Session actually carries; no Team grant, no lookup. */
    teamIds: readonly string[];
    /** Exactly the recipients rendered right now, in the order they are shown. */
    visibleRecipientAccountIds: readonly string[];
    /** Recipients Lane 04 already names; asking about them would be redundant. */
    isAlreadyNamed: (accountId: string) => boolean;
    enabled: boolean;
}>): (accountId: string) => string | undefined {
    const { enabled, isAlreadyNamed, scope } = input;
    const scopeKey = `${scope.serverId} ${scope.accountId}`;
    const teamKey = [...input.teamIds].sort().join(',');
    const visibleKey = input.visibleRecipientAccountIds.join(',');
    // A resolved answer and a "this Team does not know them" answer are both final for
    // this mounted scope: neither is worth asking twice while the manager pages around.
    const [labels, setLabels] = React.useState<Readonly<Record<string, string | null>>>({});
    const labelsRef = React.useRef(labels);
    labelsRef.current = labels;
    const isAlreadyNamedRef = React.useRef(isAlreadyNamed);
    isAlreadyNamedRef.current = isAlreadyNamed;
    const lifetime = React.useRef(scopeKey);

    React.useEffect(() => {
        lifetime.current = scopeKey;
        setLabels({});
    }, [scopeKey]);

    React.useEffect(() => {
        if (!enabled) return;
        const teamIds = teamKey.length > 0 ? teamKey.split(',') : [];
        if (teamIds.length === 0) return;
        const unresolved = [...new Set(visibleKey.length > 0 ? visibleKey.split(',') : [])]
            .filter((accountId) => accountId.length > 0
                && labelsRef.current[accountId] === undefined
                && !isAlreadyNamedRef.current(accountId));
        if (unresolved.length === 0) return;
        const requestScope = scopeKey;
        let cancelled = false;
        void (async () => {
            const resolved: Record<string, string | null> = {};
            for (const accountId of unresolved) {
                let label: string | null = null;
                for (const teamId of teamIds) {
                    const outcome = await listTeamMembers({
                        scope, address: { serverId: scope.serverId, teamId }, filter: 'all', query: accountId, limit: 1,
                    });
                    if (cancelled || lifetime.current !== requestScope) return;
                    if (outcome.kind !== 'succeeded') continue;
                    const membership = outcome.value.items.find((item) => item.accountId === accountId);
                    if (!membership) continue;
                    // A membership with no display profile at all stays on its
                    // identifier: the existing fallback is honest, a generic word is not.
                    label = formatAccountDisplayName(membership.account);
                    break;
                }
                resolved[accountId] = label;
            }
            if (cancelled || lifetime.current !== requestScope) return;
            setLabels((previous) => ({ ...previous, ...resolved }));
        })();
        return () => { cancelled = true; };
    }, [enabled, scope, scopeKey, teamKey, visibleKey]);

    return React.useCallback(
        (accountId: string) => labels[accountId] ?? undefined,
        [labels],
    );
}
