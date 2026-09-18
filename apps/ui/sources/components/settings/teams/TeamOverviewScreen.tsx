import * as React from 'react';
import { useRouter } from 'expo-router';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useTeamCredentialResources } from '@/hooks/teams/useTeamCredentialResources';
import { t } from '@/text';

import { TeamSection } from './TeamSection';
import type { TeamSectionContext } from './teamSectionContext';
import { teamRoleDescription, teamRoleLabel } from './teamLabels';
import { TeamOwnerRequiredNotice } from './members/TeamOwnerRequiredNotice';
import {
    teamAuthenticationPath,
    teamCredentialsPath,
    teamGroupsPath,
    teamInvitationsPath,
    teamMembersPath,
    teamSessionsPath,
    teamSettingsPath,
} from './teamsRoutes';
import { resolveTeamOverviewDestinationIds } from './teamOverviewDestinations';

/** Matches the directory row, so one Team reads the same size in both places. */
const TEAM_AVATAR_SIZE = 36;

/**
 * The shared-credentials entry, offered only once this exact Home has said both
 * that it has the feature and that this viewer may administer resources or
 * offer one of their own there.
 *
 * The capability is not in the Team projection — it deliberately carries no
 * resource authority — so it comes from the resource projection itself. That
 * read is the same one the destination uses, so opening it costs nothing extra,
 * and a viewer the Home has denied never sees an entry it would refuse.
 */
const CredentialsDestination = React.memo(function CredentialsDestination(props: Readonly<{
    context: TeamSectionContext;
}>) {
    const router = useRouter();
    const { context } = props;
    const featureEnabled = useFeatureEnabled('teams.credentialResources', {
        scopeKind: 'spawn',
        serverId: context.scope.serverId,
    });
    const projection = useTeamCredentialResources({
        scope: context.scope,
        address: context.address,
        enabled: featureEnabled,
    });

    if (!featureEnabled || (projection.viewer?.manageCredentials !== true
        && projection.viewer?.offerOwnCredential !== true)) return null;

    return (
        <ItemGroup>
            <Item
                testID="team-overview-credentials"
                title={t('teams.credentials.title')}
                onPress={() => router.push(teamCredentialsPath(context.address))}
            />
        </ItemGroup>
    );
});

/**
 * The Team entry surface.
 *
 * It answers "which Team am I in, on which Home, as what" before offering any
 * destination, and it offers only the destinations this viewer's server-projected
 * capabilities actually back — an absent producer or a withheld capability omits
 * the row rather than rendering a control that would fail.
 */
export const TeamOverviewScreen = React.memo(function TeamOverviewScreen(props: Readonly<{
    serverId: string;
    teamId: string;
}>) {
    const router = useRouter();

    return (
        <TeamSection serverId={props.serverId} teamId={props.teamId}>
            {(context) => {
                const { team, address, homeName } = context;
                const { capabilities } = team;
                const destinations = resolveTeamOverviewDestinationIds(capabilities);
                return (
                    <>
                        <ItemGroup>
                            {/* The Team's own identity is the anchor here, the same
                                lockup the directory row and the join screen show, so
                                somebody arriving from either recognizes where they
                                are. The avatar owner derives the monogram and accent
                                from the immutable Team id, never from the name — two
                                Teams may legitimately share a name. */}
                            <Item
                                testID="team-overview-identity"
                                title={team.name}
                                subtitle={team.description ?? undefined}
                                leftElement={(
                                    <Avatar
                                        id={address.teamId}
                                        square
                                        size={TEAM_AVATAR_SIZE}
                                        imageUrl={team.logo?.url ?? null}
                                        thumbhash={team.logo?.thumbhash ?? null}
                                    />
                                )}
                                showChevron={false}
                            />
                            <Item
                                testID="team-overview-home"
                                title={t('teams.homeLabel')}
                                detail={homeName}
                                showChevron={false}
                            />
                            {team.viewerRole ? (
                                <Item
                                    testID="team-overview-role"
                                    title={t('teams.role.member')}
                                    detail={teamRoleLabel(team.viewerRole)}
                                    subtitle={teamRoleDescription(team.viewerRole)}
                                    showChevron={false}
                                />
                            ) : null}
                        </ItemGroup>

                        {/* Sessions is the Team's daily work, so it leads the
                            destinations rather than sitting among administration.
                            It is offered to anyone who can see the Team: the
                            destination itself renders this Home's real listing
                            state — loading, unreachable, unsupported or ready —
                            instead of this row guessing on its behalf. */}
                        <ItemGroup>
                            <Item
                                testID="team-overview-sessions"
                                title={t('teams.tabs.sessions')}
                                onPress={() => router.push(teamSessionsPath(address))}
                            />
                        </ItemGroup>

                        {/* The Team's own condition, published by the Home. The
                            recovery itself happens on the roster, which is the
                            only surface that knows who may be promoted. */}
                        <TeamOwnerRequiredNotice
                            context={context}
                            onChooseOwner={() => router.push(teamMembersPath(address))}
                        />

                        <ItemGroup>
                            {destinations.includes('members') ? (
                                <Item
                                    testID="team-overview-members"
                                    title={t('teams.tabs.members')}
                                    onPress={() => router.push(teamMembersPath(address))}
                                />
                            ) : null}
                            {destinations.includes('groups') ? (
                                <Item
                                    testID="team-overview-groups"
                                    title={t('teams.tabs.groups')}
                                    onPress={() => router.push(teamGroupsPath(address))}
                                />
                            ) : null}
                            {destinations.includes('invitations') ? (
                                <Item
                                    testID="team-overview-invitations"
                                    title={t('teams.tabs.invitations')}
                                    onPress={() => router.push(teamInvitationsPath(address))}
                                />
                            ) : null}
                            {destinations.includes('authentication') ? (
                                <Item
                                    testID="team-overview-authentication"
                                    title={t('teams.tabs.authentication')}
                                    onPress={() => router.push(teamAuthenticationPath(address))}
                                />
                            ) : null}
                            {destinations.includes('settings') ? (
                                <Item
                                    testID="team-overview-settings"
                                    title={t('teams.tabs.settings')}
                                    onPress={() => router.push(teamSettingsPath(address))}
                                />
                            ) : null}
                        </ItemGroup>

                        <CredentialsDestination context={context} />
                    </>
                );
            }}
        </TeamSection>
    );
});
