import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useTeamCredentialResources } from '@/hooks/teams/useTeamCredentialResources';
import { t } from '@/text';

import { TeamSection } from './TeamSection';
import type { TeamSectionContext } from './teamSectionContext';
import { teamRoleLabel } from './teamLabels';
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
import { Icon } from '@/components/ui/icons/Icon';

/** The size of an entity mark at the head of its page. */
const TEAM_HEADER_AVATAR_SIZE = 44;

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
        <Item
            testID="team-overview-credentials"
            icon={<Icon name="key" />}
            title={t('teams.credentials.title')}
            onPress={() => router.push(teamCredentialsPath(context.address))}
        />
    );
});

/**
 * The Team's own identity heads its page, the same lockup the directory row and the join screen
 * show, so somebody arriving from either recognizes where they are. The avatar owner derives the
 * monogram and accent from the immutable Team id, never from the name — two Teams may share a name.
 */
const TeamOverviewHeader = React.memo(function TeamOverviewHeader(props: Readonly<{
    context: TeamSectionContext;
}>) {
    const { team, address, homeName } = props.context;
    return (
        <PageHeader
            testID="team-overview-identity"
            alwaysShowTitle
            title={team.name}
            description={team.description ?? undefined}
            leading={(
                <Avatar
                    id={address.teamId}
                    square
                    size={TEAM_HEADER_AVATAR_SIZE}
                    imageUrl={team.logo?.url ?? null}
                    thumbhash={team.logo?.thumbhash ?? null}
                />
            )}
            meta={[
                ...(team.viewerRole ? [{
                    key: 'role',
                    testID: 'team-overview-role',
                    text: teamRoleLabel(team.viewerRole),
                }] : []),
                { key: 'home', testID: 'team-overview-home', icon: 'house' as const, text: homeName },
            ]}
        />
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
        <TeamSection
            serverId={props.serverId}
            teamId={props.teamId}
            renderHeader={(context) => <TeamOverviewHeader context={context} />}
        >
            {(context) => {
                const { team, address } = context;
                const destinations = resolveTeamOverviewDestinationIds(team.capabilities);
                return (
                    <>
                        {/* The Team's own condition, published by the Home. The
                            recovery itself happens on the roster, which is the
                            only surface that knows who may be promoted. */}
                        <TeamOwnerRequiredNotice
                            context={context}
                            onChooseOwner={() => router.push(teamMembersPath(address))}
                        />

                        {/* Sessions is the Team's daily work, so it leads the
                            destinations rather than sitting among administration.
                            It is offered to anyone who can see the Team: the
                            destination itself renders this Home's real listing
                            state — loading, unreachable, unsupported or ready —
                            instead of this row guessing on its behalf. */}
                        <ItemGroup>
                            <Item
                                testID="team-overview-sessions"
                                icon={<Icon name="chats-circle" />}
                                title={t('teams.tabs.sessions')}
                                subtitle={t('teams.overview.sessionsSubtitle')}
                                onPress={() => router.push(teamSessionsPath(address))}
                            />
                        </ItemGroup>

                        <ItemGroup>
                            {destinations.includes('members') ? (
                                <Item
                                    testID="team-overview-members"
                                    icon={<Icon name="users" />}
                                    title={t('teams.tabs.members')}
                                    subtitle={t('teams.pages.members')}
                                    onPress={() => router.push(teamMembersPath(address))}
                                />
                            ) : null}
                            {destinations.includes('groups') ? (
                                <Item
                                    testID="team-overview-groups"
                                    icon={<Icon name="tree-structure" />}
                                    title={t('teams.tabs.groups')}
                                    subtitle={t('teams.pages.groups')}
                                    onPress={() => router.push(teamGroupsPath(address))}
                                />
                            ) : null}
                            {destinations.includes('invitations') ? (
                                <Item
                                    testID="team-overview-invitations"
                                    icon={<Icon name="envelope" />}
                                    title={t('teams.tabs.invitations')}
                                    subtitle={t('teams.pages.invitations')}
                                    onPress={() => router.push(teamInvitationsPath(address))}
                                />
                            ) : null}
                            {destinations.includes('authentication') ? (
                                <Item
                                    testID="team-overview-authentication"
                                    icon={<Icon name="fingerprint" />}
                                    title={t('teams.tabs.authentication')}
                                    subtitle={t('teams.pages.authentication')}
                                    onPress={() => router.push(teamAuthenticationPath(address))}
                                />
                            ) : null}
                            <CredentialsDestination context={context} />
                            {destinations.includes('settings') ? (
                                <Item
                                    testID="team-overview-settings"
                                    icon={<Icon name="gear" />}
                                    title={t('teams.tabs.settings')}
                                    subtitle={t('teams.pages.settings')}
                                    onPress={() => router.push(teamSettingsPath(address))}
                                />
                            ) : null}
                        </ItemGroup>
                    </>
                );
            }}
        </TeamSection>
    );
});
