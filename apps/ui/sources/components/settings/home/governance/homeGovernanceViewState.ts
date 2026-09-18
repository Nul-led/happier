import type { HomeGovernanceProjectionV1 } from '@happier-dev/protocol';

import { isAuthoritativeScopedSnapshotRefusal } from '@/sync/domains/scope/scopedSnapshotFacts';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type {
    HomeGovernanceSnapshot,
    HomeGovernanceSnapshotError,
} from '@/sync/store/home/governance/homeGovernanceSnapshots';

/**
 * What Home Administration should render for one exact Home right now.
 *
 * The controlling rule is continuity: once a Home has answered, its projection
 * keeps rendering through every refresh, wake and failure. A surface that
 * blanked on a dropped connection would make an administrator believe their
 * Home had lost its owners or their own authority.
 */
export type HomeGovernanceViewState =
    /** This Home has never answered. Nothing is claimed about it. */
    | Readonly<{ kind: 'unobserved' }>
    /** A first observation is in flight; there is nothing retained to show. */
    | Readonly<{ kind: 'loading' }>
    /** The Home refused or could not be reached, and nothing was retained. */
    | Readonly<{ kind: 'unavailable'; error: HomeGovernanceSnapshotError; retryable: boolean }>
    /** The Home has no active owner; only a deployment-local operator can recover it. */
    | Readonly<{ kind: 'setup_required' }>
    | Readonly<{
        kind: 'ready';
        scope: ServerAccountScope;
        projection: HomeGovernanceProjectionV1;
        /** A refresh is in flight over content that stays on screen. */
        refreshing: boolean;
        /** The shown projection is known to be behind the Home. */
        stale: boolean;
        /** When the shown projection was observed, for an honest freshness note. */
        lastObservedAt: number | null;
        /**
         * Whether a mutation may be offered. Reading a slightly old Home is
         * useful; writing from one is not, because the administrator would be
         * deciding against state the Home has already moved past.
         */
        mutationsAvailable: boolean;
        /** Retained so a stale surface can still explain why it went quiet. */
        error: HomeGovernanceSnapshotError | null;
    }>;

const UNOBSERVED: HomeGovernanceViewState = Object.freeze({ kind: 'unobserved' as const });
const LOADING: HomeGovernanceViewState = Object.freeze({ kind: 'loading' as const });

export function resolveHomeGovernanceViewState(
    snapshot: HomeGovernanceSnapshot | null | undefined,
): HomeGovernanceViewState {
    if (!snapshot) return UNOBSERVED;

    if (snapshot.error?.code === 'home_governance_setup_required') {
        return Object.freeze({ kind: 'setup_required' as const });
    }

    // An authoritative refusal supersedes retained content. Retention exists so
    // an offline Home stays readable, not so a surface can keep showing roles,
    // policies and actions after the Home said this account may not administer
    // it, that the credential no longer authenticates, or that it has no such
    // operation at all.
    if (isAuthoritativeScopedSnapshotRefusal(snapshot.error)) {
        return Object.freeze({
            kind: 'unavailable' as const,
            error: snapshot.error,
            retryable: snapshot.error.retryable,
        });
    }

    if (!snapshot.data) {
        if (snapshot.error) {
            return Object.freeze({
                kind: 'unavailable' as const,
                error: snapshot.error,
                retryable: snapshot.error.retryable,
            });
        }
        return LOADING;
    }

    return Object.freeze({
        kind: 'ready' as const,
        scope: snapshot.scope,
        projection: snapshot.data,
        refreshing: snapshot.status === 'refreshing' || snapshot.status === 'loading',
        stale: snapshot.stale,
        lastObservedAt: snapshot.lastObservedAt,
        // A wake marks the projection stale before the Home re-answers, so this
        // deliberately closes writes on the same signal that keeps reads open.
        mutationsAvailable: !snapshot.stale && snapshot.reachability === 'reachable',
        error: snapshot.error,
    });
}
