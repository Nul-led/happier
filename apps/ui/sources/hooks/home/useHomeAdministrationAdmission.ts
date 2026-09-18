import * as React from 'react';

import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import {
    resolveHomeAdministrationAdmission,
    type HomeAdministrationAdmission,
} from '@/sync/domains/home/governance/homeAdministrationAdmission';
import type {
    HomeGovernanceSnapshotError,
    HomeGovernanceSnapshotStatus,
} from '@/sync/store/home/governance/homeGovernanceSnapshots';

import { useHomeGovernanceSnapshot } from './useHomeGovernanceSnapshot';

export type HomeAdministrationAdmissionState = Readonly<{
    admission: HomeAdministrationAdmission;
    /** `unobserved` means this Home has never answered, so nothing is claimed. */
    status: HomeGovernanceSnapshotStatus | 'unobserved';
    /** True when the decision rests on a projection known to be behind. */
    stale: boolean;
    error: HomeGovernanceSnapshotError | null;
}>;

const UNOBSERVED: HomeAdministrationAdmissionState = Object.freeze({
    admission: Object.freeze({ state: 'denied' as const }),
    status: 'unobserved' as const,
    stale: false,
    error: null,
});

/**
 * The Settings admission decision for the Home Administration destination of
 * one exact Home and Account.
 *
 * It is offered for an effective projected Home capability or for a truthful
 * owner-setup-required state, and for nothing else. An unreachable or not yet
 * observed Home is reported as such rather than guessed at, and the returned
 * status/stale/error facts let the surface explain itself without inventing a
 * second interpretation of the Home's authorization.
 */
export function useHomeAdministrationAdmission(
    scope: ServerAccountScope | null | undefined,
): HomeAdministrationAdmissionState {
    const snapshot = useHomeGovernanceSnapshot(scope);

    return React.useMemo(() => {
        if (!snapshot) return UNOBSERVED;
        return Object.freeze({
            admission: resolveHomeAdministrationAdmission(snapshot.data),
            status: snapshot.status,
            stale: snapshot.stale,
            error: snapshot.error,
        });
    }, [snapshot]);
}
