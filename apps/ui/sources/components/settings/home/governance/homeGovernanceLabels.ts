import type {
    AccountStatusV1,
    HomeAdmissionModeV1,
    HomeRoleV1,
    TeamCreationPolicyV1,
} from '@happier-dev/protocol/home/governance';

import type { HomeDomainFailure } from '@/sync/api/home/homeServerActionTransport';
import { resolveHomeAccountStatusPresentation } from '@/sync/domains/home/governance/homeAccountAdministration';
import type { HomeAccountActionUnavailableReason } from '@/sync/domains/home/governance/homeAccountAdministration';
import type { HomeAdministrationHomeEntry } from '@/sync/domains/home/governance/homeAdministrationSettingsAdmission';
import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { t } from '@/text';
import { HappyError } from '@/utils/errors/errors';

/**
 * The one place a Home-governance enum becomes words.
 *
 * Keeping these together is what stops the lifecycle vocabulary from drifting:
 * the reversible hold must read as **Disabled** and the terminal state as
 * **Retired** on every surface that shows an Account, not just the one where the
 * distinction was first written.
 */

type HomeUnresolvedReason = Extract<HomeAdministrationHomeEntry, { state: 'unresolved' }>['reason'];

/**
 * How one Home is named to the person administering it.
 *
 * The app's one Home namer decides first (the name they chose, else "Personal Home" for this
 * device's own Home). Only a Home with no name falls back to what tells Homes apart — its saved
 * label or address — and the opaque id is used only when this device knows nothing else about it.
 */
export function homeDisplayName(serverId: string): string {
    return resolveHomeDisplayLabel(getServerProfileById(serverId), serverId);
}

/** Why a Home in the exact set has not yet said whether it admits this device. */
export function homeUnresolvedReasonLabel(reason: HomeUnresolvedReason): string {
    switch (reason) {
        case 'loading':
            return t('homeGovernance.loading');
        case 'signed_out':
            return t('homeGovernance.signedOutBody');
        case 'unknown_home':
            return t('homeGovernance.notObservedBody');
        case 'unreachable':
            return t('homeGovernance.offlineNotice');
    }
}

export function homeRoleLabel(role: HomeRoleV1): string {
    switch (role) {
        case 'owner':
            return t('homeGovernance.roleOwner');
        case 'admin':
            return t('homeGovernance.roleAdmin');
        case 'member':
            return t('homeGovernance.roleMember');
    }
}

export function homeRoleDescription(role: HomeRoleV1): string {
    switch (role) {
        case 'owner':
            return t('homeGovernance.roleOwnerDescription');
        case 'admin':
            return t('homeGovernance.roleAdminDescription');
        case 'member':
            return t('homeGovernance.roleMemberDescription');
    }
}

export function homeAccountStatusLabel(status: AccountStatusV1): string {
    switch (resolveHomeAccountStatusPresentation(status).label) {
        case 'active':
            return t('homeGovernance.statusActive');
        case 'disabled':
            return t('homeGovernance.statusDisabled');
        case 'retired':
            return t('homeGovernance.statusRetired');
    }
}

/**
 * The extra sentence a lifecycle state deserves on a detail surface. An active
 * Account gets none: there is nothing unusual to explain. Neither ever claims a
 * cause or a timestamp, because neither is stored.
 */
export function homeAccountStatusDetail(status: AccountStatusV1): string | null {
    switch (resolveHomeAccountStatusPresentation(status).label) {
        case 'active':
            return null;
        case 'disabled':
            return t('homeGovernance.statusDisabledDetail');
        case 'retired':
            return t('homeGovernance.statusRetiredDetail');
    }
}

export function homeActionUnavailableReasonLabel(reason: HomeAccountActionUnavailableReason): string {
    switch (reason) {
        case 'last_active_owner':
            return t('homeGovernance.reasonLastActiveOwner');
        case 'target_inactive':
        case 'target_not_active':
        case 'target_not_suspended':
        case 'target_retired':
            return t('homeGovernance.reasonTargetInactive');
        case 'team_owner_transfer_required':
            return t('homeGovernance.errorTeamOwnerTransferRequired');
        case 'home_unreachable':
            return t('homeGovernance.reasonHomeUnreachable');
    }
}

/**
 * What a refused Home-governance mutation is called, in one place.
 *
 * The Home's own typed code comes first, because it names the actual obstacle.
 * Only when it sent none does the transport's own verdict speak — and the two
 * that matter most are the ones a code can never carry: a request that never
 * left, and a request that left and whose answer was lost.
 *
 * That last one is why this returns a title as well as a body. Every other
 * outcome can be introduced as "the change did not go through"; an unconfirmed
 * one cannot, because the Home may well have applied it. Saying otherwise
 * invites a second press, and a second press is a second non-idempotent
 * governance mutation.
 */
export function homeGovernanceFailureNotice(
    failure: HomeDomainFailure,
): Readonly<{ title: string; body: string }> {
    if (failure.code === null && failure.kind === 'outcome_unknown') {
        return Object.freeze({
            title: t('homeGovernance.errorOutcomeUnknownTitle'),
            body: t('homeGovernance.errorOutcomeUnknown'),
        });
    }
    return Object.freeze({
        title: t('homeGovernance.changeFailedTitle'),
        body: homeGovernanceFailureBody(failure),
    });
}

/**
 * What a refused self-deletion is called.
 *
 * The Home answers the last active Home owner, or the last owner of a staffed
 * Team, with the same typed ownership-transfer verdicts it gives an
 * administrator, so they are shown with the same words: the deletion was
 * answered, repeating it cannot succeed, and the actionable step is to make
 * someone else an owner first. Only an answer that carries no such verdict — a
 * request that never left, or one whose answer was lost — keeps the "not
 * confirmed" notice, because that is the one case in which the deletion may
 * still have happened.
 */
export function accountErasureFailureNotice(error: unknown): Readonly<{ title: string; body: string }> {
    if (error instanceof HappyError
        && (error.code === 'home_owner_transfer_required' || error.code === 'team_owner_transfer_required')) {
        return homeGovernanceFailureNotice({ kind: 'conflict', retryable: false, code: error.code });
    }
    return Object.freeze({
        title: t('settingsAccount.deleteAccountFailedTitle'),
        body: t('settingsAccount.deleteAccountFailed'),
    });
}

function homeGovernanceFailureBody(failure: HomeDomainFailure): string {
    switch (failure.code) {
        case 'home_governance_forbidden':
            return t('homeGovernance.errorForbidden');
        case 'home_owner_transfer_required':
            return t('homeGovernance.errorOwnerTransferRequired');
        case 'team_owner_transfer_required':
            return t('homeGovernance.errorTeamOwnerTransferRequired');
        case 'home_account_not_found':
            return t('homeGovernance.errorAccountNotFound');
        case 'home_account_inactive':
            return t('homeGovernance.errorAccountInactive');
        case 'home_policy_revision_conflict':
            return t('homeGovernance.revisionConflictBody');
        default:
            break;
    }
    switch (failure.kind) {
        case 'unreachable':
            return t('homeGovernance.reasonHomeUnreachable');
        case 'unauthorized':
        case 'forbidden':
            return t('homeGovernance.errorForbidden');
        case 'unsupported':
            return t('homeGovernance.unsupportedBody');
        case 'conflict':
            return t('homeGovernance.errorConflict');
        default:
            return t('homeGovernance.errorGeneric');
    }
}

export function teamCreationPolicyLabel(policy: TeamCreationPolicyV1): string {
    switch (policy) {
        case 'self_service':
            return t('homeGovernance.teamCreationSelfService');
        case 'managed_only':
            return t('homeGovernance.teamCreationManagedOnly');
        case 'disabled':
            return t('homeGovernance.teamCreationDisabled');
    }
}

export function teamCreationPolicyDescription(policy: TeamCreationPolicyV1): string {
    switch (policy) {
        case 'self_service':
            return t('homeGovernance.teamCreationSelfServiceDescription');
        case 'managed_only':
            return t('homeGovernance.teamCreationManagedOnlyDescription');
        case 'disabled':
            return t('homeGovernance.teamCreationDisabledDescription');
    }
}

export function homeAdmissionModeLabel(mode: HomeAdmissionModeV1): string {
    switch (mode) {
        case 'self_service':
            return t('homeGovernance.admissionSelfService');
        case 'invitation_only':
            return t('homeGovernance.admissionInvitationOnly');
        case 'closed':
            return t('homeGovernance.admissionClosed');
    }
}
