import type { HomeDomainFailure } from '@/sync/api/home/homeServerActionTransport';
import { t } from '@/text';

/**
 * One truthful failure vocabulary for Team administration mutations.
 *
 * In particular, an Action dispatched before its carrier failed has an unknown
 * outcome. It must not reuse the generic “nothing changed” copy: callers refresh
 * their canonical reader and ask the person to review that state before acting
 * again.
 */
/**
 * The same vocabulary for a *read* that could not be completed.
 *
 * A read has no committed outcome to describe, so a repeatable failure is a
 * reachability fact and says so, exactly as every other Team read surface does.
 * Only a settled refusal by the Home falls through to the mutation vocabulary,
 * which is where `forbidden`, `conflict` and the typed codes belong.
 */
export function teamReadFailureLabel(failure: HomeDomainFailure): string {
    return failure.retryable && failure.code === null
        ? t('teams.unavailable.offline')
        : teamMutationFailureLabel(failure);
}

export function teamMutationFailureLabel(failure: HomeDomainFailure): string {
    if (failure.code === 'team_owner_transfer_required') return t('teams.members.lastOwnerBlocked');
    if (failure.code === 'managed_by_directory') return t('teams.members.managedReadOnly');
    if (failure.code === 'management_conflict') return t('teams.members.managementConflict');
    switch (failure.kind) {
        case 'outcome_unknown':
            return t('teams.errors.outcomeUnknown');
        case 'unreachable':
            return t('teams.errors.offline');
        case 'unsupported':
            // An operation this Home does not have is an age fact about the Home.
            // Never relabelled as a domain-specific failure such as mail delivery.
            return t('teams.unavailable.updateRequired');
        case 'forbidden':
        case 'unauthorized':
            return t('teams.errors.forbidden');
        case 'conflict':
            return t('teams.errors.conflict');
        default:
            return t('teams.errors.generic');
    }
}
