import * as React from 'react';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import type { TeamMembersListFilterV1, TeamMembershipV1 } from '@happier-dev/protocol/teams';
import { Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { VirtualizedList } from '@/components/ui/lists/virtualized';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { useTeamMembersRoster } from '@/hooks/teams/useTeamMembersRoster';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import { t } from '@/text';

import { TeamSection } from '../TeamSection';
import type { TeamSectionContext } from '../teamSectionContext';
import { teamMemberAddPath, teamMemberDetailPath } from '../teamsRoutes';
import { membershipManagementLabel, teamRoleLabel } from '../teamLabels';
import { TeamOwnerRequiredNotice } from './TeamOwnerRequiredNotice';

const MEMBER_AVATAR_SIZE = 36;
const MEMBER_CHUNK_SIZE = 12;

type MemberVirtualizedRow = Readonly<{
    key: string;
    render: () => React.ReactElement;
}>;

const FILTERS: readonly TeamMembersListFilterV1[] = Object.freeze([
    'all',
    'owners_admins',
    'members',
    'guests',
    'suspended',
]);

function filterLabel(filter: TeamMembersListFilterV1): string {
    switch (filter) {
        case 'all':
            return t('teams.members.filterAll');
        case 'owners_admins':
            return t('teams.members.filterOwnersAndAdmins');
        case 'members':
            return t('teams.members.filterMembers');
        case 'guests':
            return t('teams.members.filterGuests');
        case 'suspended':
            return t('teams.members.filterSuspended');
    }
}

const MemberRoster = React.memo(function MemberRoster(props: Readonly<{
    context: TeamSectionContext;
    header?: React.ReactNode;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { context } = props;
    const [filter, setFilter] = React.useState<TeamMembersListFilterV1>('all');

    // The Home authorizes this roster on `viewTeam`, so every viewer it would
    // answer sees it. Management is a separate question, asked per control and
    // per row below: an ordinary member reads the roster and is offered nothing.
    const canRead = context.team.capabilities.viewTeam;
    const canAdd = context.team.capabilities.manageMembers && context.canMutate;
    const roster = useTeamMembersRoster({
        scope: context.scope,
        address: context.address,
        filter,
        enabled: canRead,
    });
    const hasFocused = React.useRef(false);

    // The Add member route sits above this roster in the navigation stack. Its
    // successful mutation returns a canonical membership and then comes back;
    // re-reading this retained pager on that focus transition makes the new row
    // visible without waiting for the independent AccountChange catch-up. The
    // first focus is already covered by the pager's initial read, so it does not
    // issue a duplicate request.
    useFocusEffect(React.useCallback(() => {
        if (!hasFocused.current) {
            hasFocused.current = true;
            return;
        }
        void roster.reload();
    }, [roster.reload]));

    // The recovery candidates are exactly the rows the Home says may be given a
    // role — never a role comparison made here. "No candidate" is claimed only
    // once the whole sequence has been read: an unread page proves nothing.
    const ownerCandidateAvailable = roster.rows.some((membership) => membership.capabilities.setRole);
    const noOwnerCandidate = context.team.recovery?.kind === 'owner_required'
        && context.team.recovery.canAppointOwner
        && !ownerCandidateAvailable
        // A narrowed filter hides rows rather than proving they do not exist.
        && filter === 'all'
        && !roster.hasMore
        && roster.status === 'ready'
        && roster.error === null;

    const rows = React.useMemo<readonly MemberVirtualizedRow[]>(() => {
        const result: MemberVirtualizedRow[] = [];
        const add = (key: string, render: () => React.ReactElement) => result.push({ key, render });

        if (!canRead) {
            add('forbidden', () => (
                <ItemGroup footer={t('teams.errors.forbidden')}>
                    <Item
                        testID="team-members-forbidden"
                        title={t('homeGovernance.forbiddenTitle')}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
            return result;
        }

        if (context.team.recovery?.kind === 'owner_required') {
            add('owner-required', () => (
                <TeamOwnerRequiredNotice context={context} noCandidate={noOwnerCandidate} />
            ));
        }

        add('filters', () => (
            <ItemGroup accessibilityRole="radiogroup" accessibilityLabel={t('teams.tabs.members')}>
                {FILTERS.map((candidate) => (
                    <Item
                        key={candidate}
                        testID={`team-members-filter:${candidate}`}
                        title={filterLabel(candidate)}
                        accessibilityRole="radio"
                        webRole="radio"
                        accessibilityChecked={candidate === filter}
                        selected={candidate === filter}
                        onPress={() => setFilter(candidate)}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>
        ));

        if (roster.status === 'loading' && roster.rows.length === 0) {
            add('loading', () => (
                <ItemGroup>
                    <Item testID="team-members-loading" title={t('teams.tabs.members')} loading showChevron={false} />
                </ItemGroup>
            ));
        }

        if (roster.rows.length === 0 && roster.status === 'ready') {
            add('empty', () => (
                <ItemGroup footer={t('teams.members.emptyBody')}>
                    <Item testID="team-members-empty" title={t('teams.members.emptyTitle')} showChevron={false} />
                </ItemGroup>
            ));
        }

        for (let start = 0; start < roster.rows.length; start += MEMBER_CHUNK_SIZE) {
            const chunk = roster.rows.slice(start, start + MEMBER_CHUNK_SIZE);
            const first = start === 0;
            const last = start + MEMBER_CHUNK_SIZE >= roster.rows.length;
            add(`members:${chunk[0]!.id}`, () => (
                <ItemGroup
                    title={first ? t('teams.tabs.members') : undefined}
                    virtualizedSegment={{ first, last }}
                >
                    {chunk.map((membership) => {
                        const displayName = formatAccountDisplayName(membership.account) ?? membership.accountId;
                        const managedBy = membershipManagementLabel(membership);
                        return (
                            <Item
                                key={membership.id}
                                testID={`team-members-row:${membership.id}`}
                                title={displayName}
                                subtitle={[teamRoleLabel(membership.role), managedBy]
                                    .filter((part): part is string => part !== null)
                                    .join(' · ')}
                                leftElement={(
                                    <Avatar
                                        id={membership.accountId}
                                        size={MEMBER_AVATAR_SIZE}
                                        imageUrl={membership.account.avatarUrl}
                                    />
                                )}
                                rightElement={membership.status === 'suspended' ? (
                                    <StatusPill
                                        testID={`team-members-status:${membership.id}`}
                                        variant="warning"
                                        label={t('teams.status.suspended')}
                                        labelVariant="phrase"
                                    />
                                ) : undefined}
                                onPress={() => router.push(teamMemberDetailPath(context.address, membership.id))}
                            />
                        );
                    })}
                </ItemGroup>
            ));
        }

        if (roster.error) {
            add('retry', () => (
                <ItemGroup footer={t('teams.unavailable.offline')}>
                    <Item
                        testID="team-members-retry"
                        title={t('teams.unavailable.retry')}
                        icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                        onPress={roster.reload}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
        } else if (roster.hasMore && roster.rows.length > 0) {
            add('load-more', () => (
                <ItemGroup>
                    <Item
                        testID="team-members-load-more"
                        title={t('homeGovernance.loadMore')}
                        loading={roster.status === 'loading_more'}
                        disabled={roster.status === 'loading_more'}
                        onPress={roster.loadMore}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
        }

        if (canAdd) {
            add('add', () => (
                <ItemGroup>
                    <Item
                        testID="team-members-add"
                        title={t('teams.members.add')}
                        onPress={() => router.push(teamMemberAddPath(context.address))}
                    />
                </ItemGroup>
            ));
        }

        return result;
    }, [canAdd, canRead, context, filter, noOwnerCandidate, roster, router, theme.colors.text.secondary]);

    const renderRow = React.useCallback(
        ({ item }: Readonly<{ item: MemberVirtualizedRow }>) => item.render(),
        [],
    );

    return (
        <VirtualizedList
            testID="team-members-virtualized-list"
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={renderRow}
            ListHeaderComponent={props.header === undefined ? null : <>{props.header}</>}
            style={{
                flex: 1,
                backgroundColor: theme.colors.background.canvas,
                ...(Platform.OS === 'web' ? { minHeight: 0 } : {}),
            }}
            contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 34 : 16 }}
            backendPreference="auto"
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            windowSize={7}
            estimatedItemSize={120}
            maintainVisibleContentPosition
        />
    );
});

export const TeamMembersScreen = React.memo(function TeamMembersScreen(props: Readonly<{
    serverId: string;
    teamId: string;
}>) {
    return (
        <TeamSection
            serverId={props.serverId}
            teamId={props.teamId}
            title={t('teams.tabs.members')}
            presentation="virtualized-list"
        >
            {(context, header) => <MemberRoster context={context} header={header} />}
        </TeamSection>
    );
});
