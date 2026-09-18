import { useSessionAudienceContext } from '@/hooks/teams/useSessionAudienceContext';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { buildSessionListHomeObservations } from '@/sync/domains/session/listing/sessionListHomeObservation';
import * as React from 'react';

import { storage } from '@/sync/domains/state/storage';
import {
    getActiveServerSnapshot,
    getServerProfilesGeneration,
    listServerProfiles,
    subscribeActiveServer,
    subscribeServerProfiles,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';

import type { ActivityAttentionSource } from './activityAttentionSourceTypes';
import { createActivityAttentionStoreSourceSelector } from './createActivityAttentionStoreSourceSelector';
import { useActivityPersonalSessionMembership } from './activityPersonalSessionMembership';

function getServerSourceGeneration(): string {
    return `${getServerProfilesGeneration()}:${getActiveServerSnapshot().generation}`;
}

export function useActivityAttentionSource(): ActivityAttentionSource {
    const personalMembership = useActivityPersonalSessionMembership();
    const storeSourceSelector = React.useMemo(
        () => createActivityAttentionStoreSourceSelector(
            personalMembership.membershipByServerId,
        ),
        [personalMembership.membershipByServerId],
    );
    const serverSourceGeneration = React.useSyncExternalStore(
        React.useCallback((listener) => {
            const unsubscribeProfiles = subscribeServerProfiles(listener);
            const unsubscribeActive = subscribeActiveServer(() => listener());
            return () => {
                unsubscribeProfiles();
                unsubscribeActive();
            };
        }, []),
        getServerSourceGeneration,
        getServerSourceGeneration,
    );
    const storeSource = storage(storeSourceSelector);
    const serverSource = React.useMemo(() => {
        const profileEntries = listServerProfiles().flatMap((profile) => [
            [profile.id, profile] as const,
            [resolveServerProfileScopeId(profile), profile] as const,
        ]);
        return {
            serverProfilesById: Object.fromEntries(profileEntries),
            activeServer: getActiveServerSnapshot(),
        };
    }, [serverSourceGeneration]);

    const audienceAddresses = React.useMemo(() => [
        ...Object.values(storeSource.sessionsById).flatMap((session) => {
            const address = normalizeSessionAddress(session.serverId, session.id);
            return address ? [address] : [];
        }),
        ...Object.entries(storeSource.ordinarySessionListMembershipByServerId ?? {})
        .flatMap(([serverId, ids]) => (ids ?? []).flatMap((id) => {
            const address = normalizeSessionAddress(serverId, id);
            return address ? [address] : [];
        })),
        ...Object.entries(personalMembership.membershipByServerId)
        .flatMap(([serverId, ids]) => (ids ?? []).flatMap((id) => {
            const address = normalizeSessionAddress(serverId, id);
            return address ? [address] : [];
        })),
    ], [personalMembership.membershipByServerId, storeSource.ordinarySessionListMembershipByServerId, storeSource.sessionsById]);
    const audience = useSessionAudienceContext(audienceAddresses);
    const sessionListHomeObservationByServerId = React.useMemo(() => buildSessionListHomeObservations({
        concurrentSessionListCacheByServerId: storeSource.concurrentSessionListCacheByServerId,
        queryStatesByServerId: personalMembership.statesByServerId,
    }), [personalMembership.statesByServerId, storeSource.concurrentSessionListCacheByServerId]);
    return React.useMemo(() => ({
        audienceScopes: audience.scopes,
        audienceLabelsVersion: audience.labelsVersion,
        personalSessionListMembershipByServerId: personalMembership.membershipByServerId,
        personalSessionListQueryStatesByServerId: personalMembership.statesByServerId,
        personalSessionListCoverageComplete: personalMembership.coverageComplete,
        sessionListHomeObservationByServerId,
        ...storeSource,
        ...serverSource,
    }), [serverSource, sessionListHomeObservationByServerId, storeSource, audience, personalMembership]);
}
