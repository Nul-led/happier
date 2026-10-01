import * as React from 'react';

import { useHomeGovernanceEligibilitySnapshots } from '@/hooks/home/useHomeGovernanceEligibilitySnapshots';
import { useTeamsDirectory, type TeamsDirectoryBinding } from '@/hooks/teams/useTeamsDirectory';
import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { teamAddressKey } from '@/sync/domains/teams/teamAddress';

import type { TeamCredentialSourceHint } from '../teamsRoutes';
import type { TeamsDirectoryRow } from '../teamsDirectoryViewState';
import { resolveTeamsCreateGuidance, type TeamsCreateAnswer, type TeamsCreateGuidance } from './teamsCreateGuidance';

function matchesDirectorySearch(row: TeamsDirectoryRow, normalizedQuery: string): boolean {
    if (normalizedQuery.length === 0) return true;
    return row.team.name.toLocaleLowerCase().includes(normalizedQuery)
        || row.homeName.toLocaleLowerCase().includes(normalizedQuery);
}

export type TeamsCollection = Readonly<{
    active: TeamsDirectoryBinding;
    archived: TeamsDirectoryBinding;
    visibleActiveRows: readonly TeamsDirectoryRow[];
    visibleArchivedRows: readonly TeamsDirectoryRow[];
    showArchived: boolean;
    /**
     * Whether "Show archived" has anything behind it: archived Teams, or an archive a Home could not
     * read (not known to be empty). A control over an empty set is not offered.
     */
    offerArchived: boolean;
    toggleArchived: () => void;
    /** Still being read, as opposed to read and refused. */
    archivedPending: boolean;
    /** A Home in view offers Team creation to this viewer. */
    showCreateTeam: boolean;
    /** …and has said so in a current answer, so a create would be admitted. */
    canCreateTeam: boolean;
    /**
     * When no Home in view offers this viewer Team creation, why and who can, from the Homes' current
     * answers; and, for an administrator of managed creation, the Home whose policy could open it up.
     */
    createGuidance: TeamsCreateGuidance;
    normalizedQuery: string;
    /** Paging or an unavailable/stale Home prevents claiming a complete collection. */
    activeIncomplete: boolean;
    /**
     * Whether a search field belongs over the list: it no longer fits at a glance (or more pages
     * exist), or a search is already in progress. Never over an empty or short list.
     */
    searchable: boolean;
}>;

/** A list longer than this no longer fits at a glance, so the rail and the page offer a search. */
const TEAMS_SEARCH_THRESHOLD = 8;

/**
 * The Teams collection: one calm list across the exact Home set, not a per-Home dashboard. The rail
 * beside a Team and the Teams page where no rail shows both read it, so they list, search, group
 * archived Teams and offer creation identically.
 *
 * A Home that answered keeps its rows through every refresh and failure, and a Home that could not
 * answer is named with its own reason instead of quietly shrinking the list — so "no Teams" is only
 * ever shown when every admitted Home actually said so.
 */
export function useTeamsCollection(options: Readonly<{
    sourceHint: TeamCredentialSourceHint | null;
    query: string;
}>): TeamsCollection {
    const { sourceHint } = options;
    const [showArchived, setShowArchived] = React.useState(false);

    const active = useTeamsDirectory({
        archived: 'active',
        ...(sourceHint ? { serverIds: [sourceHint.serverId] } : {}),
    });
    const createEligibility = useHomeGovernanceEligibilitySnapshots(active.scopes);
    // The archived query is a separate page sequence with its own ordering. Its first page is read
    // with the active one, so "Show archived" is only offered when there is something behind it.
    const archived = useTeamsDirectory({ archived: 'archived', enabled: sourceHint === null });

    const toggleArchived = React.useCallback(() => {
        setShowArchived((current) => !current);
    }, []);

    // A Team archived from this device is already in the active sequence's own
    // answer, and the archived sequence returns it again once it has been read.
    // Both are kept — the local one so the section is never empty on arrival —
    // but one Team is one row, in the order it was first known here.
    const archivedRows = React.useMemo(() => {
        if (archived.archivedRows.length === 0) return active.archivedRows;
        const seen = new Set<string>();
        const merged: TeamsDirectoryRow[] = [];
        for (const row of [...active.archivedRows, ...archived.archivedRows]) {
            const key = teamAddressKey(row.address);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(row);
        }
        return merged;
    }, [active.archivedRows, archived.archivedRows]);

    const normalizedQuery = options.query.trim().toLocaleLowerCase();
    const visibleActiveRows = React.useMemo(
        () => active.rows.filter((row) => matchesDirectorySearch(row, normalizedQuery)),
        [active.rows, normalizedQuery],
    );
    const visibleArchivedRows = React.useMemo(
        () => archivedRows.filter((row) => matchesDirectorySearch(row, normalizedQuery)),
        [archivedRows, normalizedQuery],
    );

    // Every Home that has not contributed is simply not finished. A failure
    // must not keep a spinner on screen, so this is derived from the reasons
    // rather than from the absence of rows.
    const archivedPending = archived.unavailableHomes.length > 0
        && archived.unavailableHomes.every((home) => home.reason === 'loading');

    const showCreateTeam = active.scopes.some((scope) => {
        const snapshot = createEligibility.snapshotsByServerId.get(scope.serverId);
        return snapshot?.data?.teamsEnabled === true && snapshot.data.createTeam;
    });
    const offerArchived = archivedRows.length > 0
        || archived.unavailableHomes.some((home) => home.reason !== 'loading');

    // Only a current answer from a Home that offers Teams can explain creation.
    const createGuidance = React.useMemo(() => resolveTeamsCreateGuidance({
        homesInView: active.scopes.length,
        answers: active.scopes.flatMap((scope): TeamsCreateAnswer[] => {
            const snapshot = createEligibility.snapshotsByServerId.get(scope.serverId);
            if (snapshot?.status !== 'ready' || snapshot.stale || snapshot.data?.teamsEnabled !== true) return [];
            return [{
                serverId: scope.serverId,
                homeName: resolveHomeDisplayLabel(getServerProfileById(scope.serverId), scope.serverId),
                eligibility: snapshot.data,
            }];
        }),
    }), [active.scopes, createEligibility.snapshotsByServerId]);

    const canCreateTeam = active.scopes.some((scope) => {
        const snapshot = createEligibility.snapshotsByServerId.get(scope.serverId);
        return snapshot?.status === 'ready'
            && !snapshot.stale
            && snapshot.data?.teamsEnabled === true
            && snapshot.data.createTeam;
    });

    return {
        active,
        archived,
        visibleActiveRows,
        visibleArchivedRows,
        showArchived,
        offerArchived,
        toggleArchived,
        archivedPending,
        showCreateTeam,
        canCreateTeam,
        createGuidance,
        normalizedQuery,
        activeIncomplete: active.kind === 'loading' || active.hasMore || active.partial,
        searchable: active.rows.length > TEAMS_SEARCH_THRESHOLD || active.hasMore || normalizedQuery.length > 0,
    };
}
