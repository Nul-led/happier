import type { TeamGroupV1, TeamMembershipV1, TeamRoleV1 } from '@happier-dev/protocol/teams';

import { t } from '@/text';

/**
 * The one place a Team role becomes user-visible text.
 *
 * Role copy is a projection of the fixed enum, never a capability statement: a
 * row labelled Owner may still have every management control withdrawn by an
 * archived Team, a suspended membership or an inactive Account, and only the
 * server-projected capabilities decide that.
 */
export function teamRoleLabel(role: TeamRoleV1): string {
    switch (role) {
        case 'owner':
            return t('teams.role.owner');
        case 'admin':
            return t('teams.role.admin');
        case 'member':
            return t('teams.role.member');
        case 'guest':
            return t('teams.role.guest');
    }
}

/**
 * The one sentence of consequence that accompanies a role wherever it can be
 * chosen or read.
 *
 * The plan requires the role picker to always state what the role actually
 * means, and add, invitation and member detail each ask the same question — so
 * the answer lives here once. Like the label it is a projection of the enum and
 * never a capability statement: what this viewer may do to a member stays with
 * the server-projected per-membership capabilities.
 */
export function teamRoleDescription(role: TeamRoleV1): string {
    switch (role) {
        case 'owner':
            return t('teams.roleHelp.owner');
        case 'admin':
            return t('teams.roleHelp.admin');
        case 'member':
            return t('teams.roleHelp.member');
        case 'guest':
            return t('teams.roleHelp.guest');
    }
}

/** The externally owned lifetime of one membership, when applicable. */
export function membershipManagementLabel(membership: TeamMembershipV1): string | null {
    return membership.management.kind === 'native'
        ? null
        : t('teams.members.managedBy', { source: membership.management.label });
}

/** The externally owned metadata lifecycle of one Group, when applicable. */
export function groupManagementLabel(group: TeamGroupV1): string | null {
    return group.management.kind === 'native'
        ? null
        : t('teams.groups.managedBy', { source: group.management.label });
}
