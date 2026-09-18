import type { TeamSummaryV1 } from '@happier-dev/protocol/teams';

import type { TeamsHomeAdmissionEntry } from '@/sync/domains/teams/teamsSettingsAdmission';
import type { TeamAddress } from '@/sync/domains/teams/teamAddress';
import type { TeamsDirectorySnapshot } from '@/sync/store/teams/teamsSnapshots';

/**
 * What the Teams directory should render for the exact Home set right now.
 *
 * The controlling rule is truthfulness across a partial multi-Home view: a Home
 * that answered keeps its rows on screen through every refresh and failure, and
 * a Home that did not answer is named rather than silently omitted. Claiming
 * "no Teams" while one Home is unreachable would be a false statement about
 * that Home, so emptiness requires every admitted Home to have actually said so.
 */

export type TeamsDirectoryRow = Readonly<{
    /** Navigation and cache identity. A Team ID alone is not addressable. */
    address: TeamAddress;
    team: TeamSummaryV1;
    homeName: string;
}>;

/** Why an admitted Home contributes nothing to the list right now. */
export type TeamsDirectoryUnavailableHome = Readonly<{
    serverId: string;
    homeName: string;
    reason: 'loading' | 'offline' | 'denied' | 'unsupported';
    retryable: boolean;
}>;

export type TeamsDirectoryViewState = Readonly<{
    /** `loading` only while nothing at all has been observed. */
    kind: 'loading' | 'empty' | 'ready';
    rows: readonly TeamsDirectoryRow[];
    archivedRows: readonly TeamsDirectoryRow[];
    /** Admitted Homes with nothing to show, each with its own honest reason. */
    unavailableHomes: readonly TeamsDirectoryUnavailableHome[];
    /** The list is known to be missing at least one admitted Home's Teams. */
    partial: boolean;
    /** At least one shown Home is known to be behind its Home. */
    stale: boolean;
    /** Whether rows should be labelled with their Home. */
    multiHome: boolean;
}>;

export type TeamsDirectoryViewStateInput = Readonly<{
    homes: readonly TeamsHomeAdmissionEntry[];
    homeNamesByServerId: Readonly<Record<string, string | undefined>>;
    snapshotsByServerId: Readonly<Record<string, TeamsDirectorySnapshot | undefined>>;
}>;

const EMPTY_ROWS: readonly TeamsDirectoryRow[] = Object.freeze([]);
const EMPTY_UNAVAILABLE: readonly TeamsDirectoryUnavailableHome[] = Object.freeze([]);

/**
 * Turns a snapshot failure into the reason a person can act on. `denied` and
 * `unsupported` are the Home's settled answers and are not offered a retry that
 * would ask the same question again.
 */
function unavailableReason(
    snapshot: TeamsDirectorySnapshot | undefined,
): Readonly<{ reason: TeamsDirectoryUnavailableHome['reason']; retryable: boolean }> {
    const error = snapshot?.error ?? null;
    if (!error) return { reason: 'loading', retryable: false };
    if (error.kind === 'forbidden' || error.kind === 'unauthorized') {
        return { reason: 'denied', retryable: false };
    }
    if (error.kind === 'unsupported') return { reason: 'unsupported', retryable: false };
    return { reason: 'offline', retryable: error.retryable };
}

export function resolveTeamsDirectoryViewState(
    input: TeamsDirectoryViewStateInput,
): TeamsDirectoryViewState {
    const rows: TeamsDirectoryRow[] = [];
    const archivedRows: TeamsDirectoryRow[] = [];
    const unavailableHomes: TeamsDirectoryUnavailableHome[] = [];

    let admittedHomes = 0;
    let answeredHomes = 0;
    let stale = false;

    for (const home of input.homes) {
        const homeName = (input.homeNamesByServerId[home.serverId] ?? '').trim() || home.serverId;

        if (home.state === 'disabled') {
            // A settled "no" from the feature decision. The destination itself
            // is admitted by another Home, so this one is simply not listed and
            // any snapshot left from before the change is not resurrected.
            continue;
        }

        admittedHomes += 1;

        if (home.state === 'unsupported') {
            unavailableHomes.push(Object.freeze({
                serverId: home.serverId,
                homeName,
                reason: 'unsupported' as const,
                retryable: false,
            }));
            continue;
        }

        if (home.state === 'unresolved') {
            unavailableHomes.push(Object.freeze({
                serverId: home.serverId,
                homeName,
                reason: home.reason === 'loading' ? 'loading' as const : 'offline' as const,
                retryable: home.reason === 'unreachable',
            }));
            continue;
        }

        const snapshot = input.snapshotsByServerId[home.serverId];
        const teams = snapshot?.data ?? null;

        if (!teams) {
            const { reason, retryable } = unavailableReason(snapshot);
            unavailableHomes.push(Object.freeze({ serverId: home.serverId, homeName, reason, retryable }));
            continue;
        }

        // The Home has content on screen. It counts as answered even while a
        // refresh is failing, because blanking it would lose real information.
        answeredHomes += 1;
        if (snapshot?.stale === true || snapshot?.error !== null) stale = true;

        for (const team of teams) {
            const row: TeamsDirectoryRow = Object.freeze({
                address: Object.freeze({ serverId: home.serverId, teamId: team.id }),
                team,
                homeName,
            });
            if (team.archivedAt === null) rows.push(row);
            else archivedRows.push(row);
        }
    }

    const partial = unavailableHomes.length > 0 || stale;
    const kind: TeamsDirectoryViewState['kind'] = answeredHomes === 0
        ? 'loading'
        : rows.length === 0 && archivedRows.length === 0 && answeredHomes === admittedHomes
            ? 'empty'
            : 'ready';

    return Object.freeze({
        kind,
        rows: rows.length > 0 ? Object.freeze(rows) : EMPTY_ROWS,
        archivedRows: archivedRows.length > 0 ? Object.freeze(archivedRows) : EMPTY_ROWS,
        unavailableHomes: unavailableHomes.length > 0 ? Object.freeze(unavailableHomes) : EMPTY_UNAVAILABLE,
        partial,
        stale,
        multiHome: admittedHomes > 1,
    });
}
