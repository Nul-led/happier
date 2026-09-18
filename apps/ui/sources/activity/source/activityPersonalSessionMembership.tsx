import type { SessionListQueryV1 } from '@happier-dev/protocol';
import * as React from 'react';

import {
    getServerProfilesGeneration,
    getActiveServerSnapshot,
    listServerProfiles,
    resolveServerProfileScopeId,
    subscribeServerProfiles,
    subscribeActiveServer,
} from '@/sync/domains/server/serverProfiles';
import type { SessionListQueryHomeState } from '@/sync/domains/session/listing/sessionListQueryController';
import { buildSessionListQueryKey } from '@/sync/domains/session/listing/sessionListQueryKey';
import { useSessionListQuerySourceState } from '@/sync/domains/session/listing/useSessionListQuerySourceState';

export type ActivityPersonalSessionMembership = Readonly<{
    membershipByServerId: Readonly<Record<string, readonly string[]>>;
    statesByServerId: Readonly<Record<string, SessionListQueryHomeState | undefined>>;
    coverageComplete: boolean;
}>;

const EMPTY_ACTIVITY_PERSONAL_SESSION_MEMBERSHIP: ActivityPersonalSessionMembership = {
    membershipByServerId: {},
    statesByServerId: {},
    coverageComplete: false,
};

const ActivityPersonalSessionMembershipContext = React.createContext<ActivityPersonalSessionMembership>(
    EMPTY_ACTIVITY_PERSONAL_SESSION_MEMBERSHIP,
);

/**
 * Activity's independent personal corpus. The strict query owner evaluates every
 * personal-relevance producer before pagination; Activity only retains its exact
 * per-Home membership and lets the shared row owner hydrate the returned rows.
 */
export const ACTIVITY_PERSONAL_SESSION_QUERY: SessionListQueryV1 = {
    v: 1,
    storage: 'active',
    includeInactive: true,
    scope: 'my_work',
    attention: 'any',
    audiences: [],
    tagIds: [],
    includeAttention: true,
};

type ActivityPersonalQueryHome = Readonly<{
    serverId: string;
    query: SessionListQueryV1;
    queryKey: string;
    queryMembership: 'rowOnly';
}>;

export function buildActivityPersonalQueryHomes(serverIds: readonly string[]): ActivityPersonalQueryHome[] {
    const seen = new Set<string>();
    const homes: ActivityPersonalQueryHome[] = [];
    for (const serverIdRaw of serverIds) {
        const serverId = serverIdRaw.trim();
        if (!serverId || seen.has(serverId)) continue;
        seen.add(serverId);
        homes.push({
            serverId,
            query: ACTIVITY_PERSONAL_SESSION_QUERY,
            queryKey: buildSessionListQueryKey(serverId, ACTIVITY_PERSONAL_SESSION_QUERY),
            queryMembership: 'rowOnly',
        });
    }
    return homes;
}

export function buildActivityPersonalQueryHomeServerIds(
    profileServerIds: readonly string[],
    activeServerId: string | null | undefined,
): string[] {
    return Array.from(new Set([activeServerId ?? '', ...profileServerIds].map((id) => id.trim()).filter(Boolean)));
}

export function projectActivityPersonalSessionMembership(input: Readonly<{
    enabled: boolean;
    homes: readonly ActivityPersonalQueryHome[];
    statesByServerId: Readonly<Record<string, SessionListQueryHomeState | undefined>>;

    coverageComplete: boolean;
}>): ActivityPersonalSessionMembership {
    if (!input.enabled) return EMPTY_ACTIVITY_PERSONAL_SESSION_MEMBERSHIP;
    const membershipByServerId: Record<string, readonly string[]> = {};
    for (const home of input.homes) {
        const state = input.statesByServerId[home.serverId];
        membershipByServerId[home.serverId] = state?.appliedSourceKind === 'query'
            && state.appliedQueryKey === home.queryKey
            && state.failureReason !== 'unsupported'
            && state.failureReason !== 'invalid_query'
            ? state.addresses
                .filter((address) => address.serverId === home.serverId)
                .map((address) => address.sessionId)
            : [];
    }
    return {
        membershipByServerId,
        statesByServerId: input.statesByServerId,
        coverageComplete: input.coverageComplete,
    };
}

export function buildActivityPersonalQueryContinuationKey(
    homes: readonly ActivityPersonalQueryHome[],
    statesByServerId: Readonly<Record<string, SessionListQueryHomeState | undefined>>,
): string {
    const pending = homes.flatMap((home) => {
        const state = statesByServerId[home.serverId];
        if (!(state?.phase === 'ready'
            && state.appliedSourceKind === 'query'
            && state.appliedQueryKey === home.queryKey
            && (state.hasNext || state.attentionHasNext))) {
            return [];
        }
        return [{
            serverId: home.serverId,
            nextCursor: state.hasNext ? state.nextCursor : null,
            attentionNextCursor: state.attentionHasNext ? state.attentionNextCursor : null,
        }];
    });
    return pending.length > 0 ? JSON.stringify(pending) : '';
}

export function ActivityPersonalSessionMembershipProvider(props: React.PropsWithChildren<{
    enabled: boolean;
}>): React.ReactElement {
    const profilesGeneration = React.useSyncExternalStore(
        subscribeServerProfiles,
        getServerProfilesGeneration,
        getServerProfilesGeneration,
    );
    const activeServer = React.useSyncExternalStore(
        (listener) => subscribeActiveServer(() => listener()),
        getActiveServerSnapshot,
        getActiveServerSnapshot,
    );
    const serverIds = React.useMemo(
        () => buildActivityPersonalQueryHomeServerIds(
            listServerProfiles().map(resolveServerProfileScopeId),
            activeServer.serverId,
        ),
        [activeServer.serverId, profilesGeneration],
    );
    const homes = React.useMemo(() => buildActivityPersonalQueryHomes(serverIds), [serverIds]);
    const querySource = useSessionListQuerySourceState({
        enabled: props.enabled,
        homes,
    });
    const continuationKey = buildActivityPersonalQueryContinuationKey(homes, querySource.statesByServerId);
    const loadNext = querySource.loadNext;
    React.useEffect(() => {
        if (!props.enabled || !continuationKey) return;
        void loadNext();
    }, [continuationKey, loadNext, props.enabled]);

    const value = React.useMemo(() => projectActivityPersonalSessionMembership({
        enabled: props.enabled,
        homes,
        statesByServerId: querySource.statesByServerId,
        coverageComplete: querySource.coverageComplete,
    }), [homes, props.enabled, querySource.coverageComplete, querySource.statesByServerId]);

    return (
        <ActivityPersonalSessionMembershipContext.Provider value={value}>
            {props.children}
        </ActivityPersonalSessionMembershipContext.Provider>
    );
}

export function useActivityPersonalSessionMembership(): ActivityPersonalSessionMembership {
    return React.useContext(ActivityPersonalSessionMembershipContext);
}
