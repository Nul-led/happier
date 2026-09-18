import type { PrincipalRefV1, SessionAccessLevelV1 } from '@happier-dev/protocol';
import { t } from '@/text';

import type { SessionAccessDirectoryTeamContext } from './useSessionAccessDirectory';

type CurrentGrant = Readonly<{
    subject: PrincipalRefV1;
    accessLevel: SessionAccessLevelV1;
}>;

/**
 * Presentation-only preview of server-projected Team policy facts.
 *
 * It intentionally does not classify Account recipients as internal/external,
 * decide whether the actor is a Team admin, or claim the mutation will succeed.
 * The canonical context mutation repeats those decisions in its transaction.
 */
export function projectSessionAccessContextChange(input: Readonly<{
    target: SessionAccessDirectoryTeamContext | null;
    current: SessionAccessDirectoryTeamContext | null;
    grants: readonly CurrentGrant[];
}>): readonly string[] {
    const consequences: string[] = [];
    if (input.target?.sessionCreationPolicy === 'team_required') {
        const targetGrant = input.grants.find((grant) => grant.subject.kind === 'team'
            && grant.subject.teamId === input.target?.teamId);
        if (!targetGrant || targetGrant.accessLevel === 'view') {
            consequences.push(t('session.access.required'));
        }
    }

    const previousPolicy = input.current?.externalSharingPolicy ?? 'allowed';
    const nextPolicy = input.target?.externalSharingPolicy ?? 'allowed';
    const changesTeam = input.target?.teamId !== input.current?.teamId;
    // Moving between two Teams can reclassify the same current audience even
    // when both Teams publish the same restrictive policy. The editor does not
    // duplicate the server's membership/public-link classification, so it
    // reviews the target restriction whenever the Team changes.
    if (previousPolicy !== nextPolicy || (changesTeam && nextPolicy !== 'allowed')) {
        consequences.push(`${t('teams.settings.externalSharingSection')}: ${t(nextPolicy === 'disabled'
            ? 'teams.policy.externalSharingDisabled'
            : nextPolicy === 'team_admins_only'
                ? 'teams.policy.externalSharingAdmins'
                : 'teams.policy.externalSharingAllowed')}`);
    }
    return consequences;
}
