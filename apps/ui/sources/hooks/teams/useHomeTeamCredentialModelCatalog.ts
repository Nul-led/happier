import * as React from 'react';
import type { TeamCredentialResourceCatalogEntryV1 } from '@happier-dev/protocol/teams';

import { observeTeamCredentialResourceCatalog, refreshTeamCredentialResourceCatalog } from '@/sync/engine/teams/teamsDirectoryEngine';
import { getTeamCredentialResourceCatalogSnapshot, subscribeTeamsSnapshots } from '@/sync/store/teams/teamsSnapshots';
import { useTeamsDirectory } from './useTeamsDirectory';

export type HomeTeamCredentialModelCatalog = Readonly<{
    resources: readonly TeamCredentialResourceCatalogEntryV1[];
    teamNameById: Readonly<Record<string, string>>;
    homeNameByTeamId: Readonly<Record<string, string>>;
    currentResourceKeys: ReadonlySet<string>;
    current: boolean;
    /** Re-reads every observed Team catalog through the canonical directory engine. */
    reload: () => Promise<void>;
}>;

const EMPTY_RESOURCES: readonly TeamCredentialResourceCatalogEntryV1[] = Object.freeze([]);

/**
 * Recipient-safe model catalog for the exact Home selected by Session authoring.
 * The Team directory owns membership discovery and each Team resource loader
 * owns eligibility/currentness; this hook only composes their projections.
 */
export function useHomeTeamCredentialModelCatalog(input: Readonly<{
    serverId: string | null | undefined;
    enabled: boolean;
}>): HomeTeamCredentialModelCatalog {
    const serverId = input.serverId?.trim() ?? '';
    const directory = useTeamsDirectory({ enabled: input.enabled && serverId !== '', serverIds: serverId ? [serverId] : [] });
    const scope = directory.scopes.find((candidate) => candidate.serverId === serverId) ?? null;
    const rowsKey = JSON.stringify(directory.rows.map((row) => [row.address.serverId, row.address.teamId]));

    React.useEffect(() => {
        if (!input.enabled || !scope) return;
        const releases = directory.rows.map((row) => observeTeamCredentialResourceCatalog(scope, row.address));
        return () => { for (const release of releases) release(); };
        // rowsKey is the collision-safe identity of the Team addresses observed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input.enabled, rowsKey, scope?.accountId, scope?.serverId]);

    const reload = React.useCallback(async () => {
        if (!input.enabled || !scope) return;
        await Promise.all(directory.rows.map((row) => refreshTeamCredentialResourceCatalog(scope, row.address)));
    }, [directory.rows, input.enabled, scope]);

    const snapshotVersion = React.useSyncExternalStore(
        subscribeTeamsSnapshots,
        () => JSON.stringify(directory.rows.map((row) => {
            const snapshot = getTeamCredentialResourceCatalogSnapshot(scope, row.address);
            return [row.address.teamId, snapshot?.status ?? 'none', snapshot?.lastObservedAt ?? null, snapshot?.stale === true];
        })),
        () => '',
    );

    return React.useMemo(() => {
        if (!input.enabled || !scope) {
            return {
                resources: EMPTY_RESOURCES,
                teamNameById: {},
                homeNameByTeamId: {},
                currentResourceKeys: new Set(),
                current: false,
                reload,
            };
        }
        const resources: TeamCredentialResourceCatalogEntryV1[] = [];
        const teamNameById: Record<string, string> = {};
        const homeNameByTeamId: Record<string, string> = {};
        const currentResourceKeys = new Set<string>();
        let current = directory.kind !== 'loading' && !directory.partial;
        for (const row of directory.rows) {
            teamNameById[row.address.teamId] = row.team.name;
            homeNameByTeamId[row.address.teamId] = row.homeName;
            const snapshot = getTeamCredentialResourceCatalogSnapshot(scope, row.address);
            if (snapshot?.status !== 'ready' || snapshot.stale) current = false;
            resources.push(...(snapshot?.data ?? []));
            if (snapshot?.status === 'ready' && !snapshot.stale) {
                for (const resource of snapshot.data ?? []) currentResourceKeys.add(`${resource.teamId}:${resource.id}`);
            }
        }
        return Object.freeze({
            resources: resources.length > 0 ? Object.freeze(resources) : EMPTY_RESOURCES,
            teamNameById: Object.freeze(teamNameById),
            homeNameByTeamId: Object.freeze(homeNameByTeamId),
            currentResourceKeys,
            current,
            reload,
        });
        // snapshotVersion is the scoped store change signal.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [directory.kind, directory.partial, input.enabled, reload, rowsKey, scope?.accountId, scope?.serverId, snapshotVersion]);
}
