import * as React from 'react';
import {
    TEAM_DIRECTORY_PAGE_LIMIT_DEFAULT_V1,
    teamDirectoryQueryKeyV1,
    type TeamsListInputV1,
} from '@happier-dev/protocol/teams';

import {
    resolveTeamsDirectoryViewState,
    type TeamsDirectoryViewState,
} from '@/components/settings/teams/teamsDirectoryViewState';
import { useServerCredentialAccountScopeResolutions } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { useTeamsSettingsAdmission } from '@/hooks/teams/useTeamsSettingsAdmission';
import {
    serverAccountScopeKeySuffix,
    serverAccountScopeListKey,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import type { TeamsHomeAdmissionEntry } from '@/sync/domains/teams/teamsSettingsAdmission';
import {
    loadMoreTeamsDirectory,
    observeTeamsDirectory,
    refreshTeamsDirectory,
} from '@/sync/engine/teams/teamsDirectoryEngine';
import {
    getTeamsDirectorySnapshot,
    subscribeTeamsSnapshots,
    type TeamsDirectorySnapshot,
} from '@/sync/store/teams/teamsSnapshots';

/**
 * The Teams directory across the exact Home set the user is looking at.
 *
 * Admission decides *which* Homes may contribute, each Home's own saved
 * credential decides *as whom* it is read, and the engine decides *when* it is
 * read. This hook adds none of those decisions: it binds them together, keeps
 * every admitted Home observed while the surface is mounted, and projects one
 * truthful view state that keeps reachable Homes rendered while naming the ones
 * that could not answer.
 */

export type TeamsDirectoryBinding = TeamsDirectoryViewState & Readonly<{
    /** The Homes currently contributing, for a caller that needs the targets. */
    scopes: readonly ServerAccountScope[];
    /** Whether a further page exists on any contributing Home. */
    hasMore: boolean;
    refresh: () => void;
    loadMore: () => void;
}>;

const EMPTY_SCOPES: readonly ServerAccountScope[] = Object.freeze([]);

function directoryInput(
    scope: TeamsListInputV1['scope'],
    archived: TeamsListInputV1['archived'],
): TeamsListInputV1 {
    return {
        v: 1,
        scope,
        archived,
        limit: TEAM_DIRECTORY_PAGE_LIMIT_DEFAULT_V1,
    };
}

export function useTeamsDirectory(options?: Readonly<{
    archived?: TeamsListInputV1['archived'];
    enabled?: boolean;
    /**
     * `member` is what a person's own Teams destination asks for. `administered`
     * is the explicit Home-governance scope a Home administrator with
     * `manageAllTeams` may request; the Home authorizes it, and its answer is a
     * separate query key so the two never share a page sequence or a snapshot.
     */
    scope?: TeamsListInputV1['scope'];
    /**
     * Restrict the read to these exact Homes. Admission still decides which
     * Homes may contribute at all, so this narrows the set and never widens it —
     * a Home-scoped surface asks its one Home and reports on that Home alone.
     */
    serverIds?: readonly string[];
}>): TeamsDirectoryBinding {
    const enabled = options?.enabled ?? true;
    const archived = options?.archived ?? 'active';
    const scope = options?.scope ?? 'member';
    const restrictTo = options?.serverIds;
    const restrictToKey = restrictTo ? JSON.stringify([...restrictTo].sort()) : null;
    const restrictedServerIds = React.useMemo(
        () => (restrictTo ? new Set(restrictTo) : null),
        // `restrictToKey` is a collision-safe identity for the requested set.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [restrictToKey],
    );
    const admission = useTeamsSettingsAdmission({ enabled });

    // Only a Home the feature decision admitted is ever read. A Home that said
    // no is not asked for Teams it has told us it does not have.
    const admittedHomes = React.useMemo(
        () => (restrictToKey === null
            ? admission.homes
            : admission.homes.filter((home) => restrictedServerIds?.has(home.serverId))),
        // `restrictToKey` is the identity of the requested restriction.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [admission.homes, restrictToKey],
    );
    const capableServerIds = React.useMemo(
        () => (restrictToKey === null
            ? admission.capableServerIds
            : admission.capableServerIds.filter((serverId) => restrictedServerIds?.has(serverId))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [admission.capableServerIds, restrictToKey],
    );
    const scopeResolutions = useServerCredentialAccountScopeResolutions(enabled ? capableServerIds : []);

    const scopes = React.useMemo(() => {
        const out: ServerAccountScope[] = [];
        for (const serverId of capableServerIds) {
            const resolution = scopeResolutions.get(serverId);
            if (resolution?.kind === 'bound') out.push(resolution.scope);
        }
        return out.length > 0 ? Object.freeze(out) : EMPTY_SCOPES;
    }, [capableServerIds, scopeResolutions]);

    const input = React.useMemo(() => directoryInput(scope, archived), [scope, archived]);
    const queryKey = React.useMemo(() => teamDirectoryQueryKeyV1(input), [input]);

    // Observing is what declares this surface a live consumer of each Home. The
    // engine owns first load, Account-change wake and retry; this never decides
    // to refetch on its own.
    const scopesKey = serverAccountScopeListKey(scopes);
    React.useEffect(() => {
        if (!enabled) return;
        const releases = scopes.map((scope) => observeTeamsDirectory(scope, input));
        return () => {
            for (const release of releases) release();
        };
        // `scopesKey` is the identity of the observed Home/Account set.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, input, scopesKey]);

    const getSnapshots = React.useCallback(() => {
        const byServerId: Record<string, TeamsDirectorySnapshot | undefined> = {};
        for (const scope of scopes) {
            byServerId[scope.serverId] = getTeamsDirectorySnapshot(scope, queryKey) ?? undefined;
        }
        return byServerId;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queryKey, scopesKey]);

    // The store publishes an immutable snapshot per key, so a serialized
    // identity of the observed keys is a sound change signal without
    // re-rendering on an unrelated Home's mutation.
    const snapshotsVersion = React.useSyncExternalStore(
        subscribeTeamsSnapshots,
        () => {
            return JSON.stringify(scopes.map((scope) => {
                const snapshot = getTeamsDirectorySnapshot(scope, queryKey);
                return [
                    serverAccountScopeKeySuffix(scope),
                    snapshot?.status ?? 'none',
                    snapshot?.lastObservedAt ?? null,
                    snapshot?.stale === true,
                    snapshot?.error?.kind ?? null,
                    snapshot?.data?.length ?? -1,
                ];
            }));
        },
        () => '',
    );

    const homeNamesByServerId = React.useMemo(() => {
        const names: Record<string, string | undefined> = {};
        for (const home of admittedHomes) {
            const profile = getServerProfileById(home.serverId);
            names[home.serverId] = (profile?.name ?? '').trim() || profile?.serverUrl || home.serverId;
        }
        return names;
    }, [admittedHomes]);

    // A Home whose credential this device cannot resolve has not refused; it is
    // reported as still resolving rather than silently dropped.
    const homes = React.useMemo<readonly TeamsHomeAdmissionEntry[]>(() => admittedHomes.map((home) => {
        if (home.state !== 'capable') return home;
        const resolution = scopeResolutions.get(home.serverId);
        if (resolution?.kind === 'bound') return home;
        return resolution?.kind === 'signed_out' || resolution?.kind === 'unknown_home'
            ? { serverId: home.serverId, state: 'disabled' as const }
            : { serverId: home.serverId, state: 'unresolved' as const, reason: 'loading' as const };
    }), [admittedHomes, scopeResolutions]);

    const state = React.useMemo(
        () => resolveTeamsDirectoryViewState({
            homes,
            homeNamesByServerId,
            snapshotsByServerId: getSnapshots(),
        }),
        // `snapshotsVersion` is the store's change signal for the observed keys.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [homes, homeNamesByServerId, getSnapshots, snapshotsVersion],
    );

    const hasMore = React.useMemo(
        () => scopes.some((scope) => (getTeamsDirectorySnapshot(scope, queryKey)?.nextCursor ?? null) !== null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [queryKey, scopesKey, snapshotsVersion],
    );

    const refresh = React.useCallback(() => {
        for (const scope of scopes) void refreshTeamsDirectory(scope, input);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input, scopesKey]);

    const loadMore = React.useCallback(() => {
        for (const scope of scopes) void loadMoreTeamsDirectory(scope, input);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input, scopesKey]);

    return React.useMemo(
        () => Object.freeze({ ...state, scopes, hasMore, refresh, loadMore }),
        [state, scopes, hasMore, refresh, loadMore],
    );
}
