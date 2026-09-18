import * as React from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { VirtualizedList } from '@/components/ui/lists/virtualized';
import { TeamRow } from '@/components/settings/teams/TeamRow';
import { teamDetailPath, teamsCreatePath } from '@/components/settings/teams/teamsRoutes';
import { useTeamsDirectory } from '@/hooks/teams/useTeamsDirectory';
import { t } from '@/text';

import { HomeAdministrationSection } from './HomeAdministrationSection';
import type { HomeAdministrationContext } from './homeAdministrationContext';
import { segmentHomeAdministrationRows } from './homeAdministrationVirtualizedSegments';

type HomeTeamsVirtualizedRow = Readonly<{
    key: string;
    render: () => React.ReactElement;
}>;

const HOME_TEAMS_CHUNK_SIZE = 12;

/**
 * The Teams a Home administrator governs on one exact Home.
 *
 * This is the governance scope, not the viewer's own membership list: a Home
 * owner administers Teams they have never joined, and joining is not what put
 * them here. It therefore asks for `administered` — which the Home authorizes
 * against `manageAllTeams` — restricted to this Home alone, even when the app is
 * showing several Homes elsewhere.
 *
 * Administering a Team is not access to its Sessions, and nothing here implies
 * otherwise. Team detail, membership and settings remain the Team surface's own
 * destinations, reached by the Home-qualified address.
 */
const HomeTeams = React.memo(function HomeTeams(
    props: Readonly<{ context: HomeAdministrationContext; header?: React.ReactNode }>,
) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { context } = props;
    const serverId = context.scope.serverId;
    const [showArchived, setShowArchived] = React.useState(false);

    const mayGovern = context.projection.capabilities.manageAllTeams;
    const teamsEnabled = context.projection.teamsEnabled;
    // A Home that has told us it has no Teams is not asked for them, and a
    // viewer with no Team-governance authority is not asked on their behalf.
    const enabled = mayGovern && teamsEnabled;

    const serverIds = React.useMemo(() => [serverId], [serverId]);
    const directory = useTeamsDirectory({ scope: 'administered', serverIds, enabled });
    const archived = useTeamsDirectory({
        scope: 'administered',
        serverIds,
        archived: 'archived',
        enabled: enabled && showArchived,
    });
    const archivedRetryable = archived.unavailableHomes.some((home) => home.retryable);
    const archivedLoading = archived.kind === 'loading'
        && archived.unavailableHomes.some((home) => home.reason === 'loading');
    const rows = React.useMemo<readonly HomeTeamsVirtualizedRow[]>(() => {
        const result: HomeTeamsVirtualizedRow[] = [];
        const add = (key: string, render: () => React.ReactElement) => result.push({ key, render });

        if (!teamsEnabled) {
            add('disabled', () => (
                <ItemGroup footer={t('homeGovernance.teamsDisabled')}>
                    <Item testID="home-teams-disabled" title={t('homeGovernance.teams')} subtitle={t('homeGovernance.teamsDisabled')} mode="info" showChevron={false} />
                </ItemGroup>
            ));
            return result;
        }
        if (!mayGovern) {
            add('forbidden', () => (
                <ItemGroup footer={t('homeGovernance.forbiddenBody')}>
                    <Item testID="home-teams-forbidden" title={t('homeGovernance.forbiddenTitle')} mode="info" showChevron={false} />
                </ItemGroup>
            ));
            return result;
        }

        if (context.projection.capabilities.createTeam) {
            add('create', () => (
                <ItemGroup>
                    <Item
                        testID="home-teams-create"
                        title={t('teams.directory.newTeam')}
                        onPress={() => router.push(teamsCreatePath({ administrationServerId: serverId }))}
                    />
                </ItemGroup>
            ));
        }

        if (directory.kind === 'loading' && directory.rows.length === 0) {
            add('loading', () => (
                <ItemGroup>
                    <Item testID="home-teams-loading" title={t('homeGovernance.loading')} loading showChevron={false} />
                </ItemGroup>
            ));
            return result;
        }

        if (directory.rows.length === 0 && !directory.partial) {
            add('empty', () => (
                <ItemGroup footer={t('homeGovernance.manageTeamsSubtitle')}>
                    <Item testID="home-teams-empty" title={t('homeGovernance.teamsEmpty')} mode="info" showChevron={false} />
                </ItemGroup>
            ));
        } else {
            for (const segment of segmentHomeAdministrationRows(directory.rows, HOME_TEAMS_CHUNK_SIZE)) {
                const chunk = segment.items;
                const { first, last } = segment;
                add(`active:${chunk[0]!.address.teamId}`, () => (
                    <ItemGroup
                        title={first ? t('homeGovernance.teams') : undefined}
                        footer={last ? t('homeGovernance.manageTeamsSubtitle') : undefined}
                        virtualizedSegment={{ first, last }}
                    >
                        {chunk.map((row) => (
                            <TeamRow
                                key={row.address.teamId}
                                row={row}
                                showHome={false}
                                onPress={() => router.push(teamDetailPath(row.address))}
                            />
                        ))}
                    </ItemGroup>
                ));
            }
        }

        add('toggle-archived', () => (
            <ItemGroup>
                <Item
                    testID="home-teams-toggle-archived"
                    title={showArchived ? t('teams.directory.hideArchived') : t('teams.directory.showArchived')}
                    accessibilityExpanded={showArchived}
                    onPress={() => setShowArchived((current) => !current)}
                    showChevron={false}
                />
            </ItemGroup>
        ));

        if (showArchived) {
            if (archivedLoading && archived.archivedRows.length === 0) {
                add('archived-loading', () => (
                    <ItemGroup title={t('teams.directory.archivedSection')}>
                        <Item testID="home-teams-archived-loading" title={t('homeGovernance.loading')} loading accessibilityLiveRegion="polite" showChevron={false} />
                    </ItemGroup>
                ));
            }
            for (const segment of segmentHomeAdministrationRows(archived.archivedRows, HOME_TEAMS_CHUNK_SIZE)) {
                const chunk = segment.items;
                const { first, last } = segment;
                add(`archived:${chunk[0]!.address.teamId}`, () => (
                    <ItemGroup
                        title={first ? t('teams.directory.archivedSection') : undefined}
                        virtualizedSegment={{ first, last }}
                    >
                        {chunk.map((row) => (
                            <TeamRow
                                key={`archived:${row.address.teamId}`}
                                row={row}
                                showHome={false}
                                onPress={() => router.push(teamDetailPath(row.address))}
                            />
                        ))}
                    </ItemGroup>
                ));
            }
            if (archived.partial && !archivedLoading) {
                add('archived-failure', () => (
                    <ItemGroup title={archived.archivedRows.length === 0 ? t('teams.directory.archivedSection') : undefined}>
                        <Item
                            testID={archivedRetryable ? 'home-teams-archived-retry' : 'home-teams-archived-unavailable'}
                            title={archivedRetryable ? t('homeGovernance.retry') : t('homeGovernance.unavailableTitle')}
                            subtitle={t('homeGovernance.unavailableBody')}
                            icon={archivedRetryable ? <Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} /> : undefined}
                            mode={archivedRetryable ? 'interactive' : 'info'}
                            onPress={archivedRetryable ? archived.refresh : undefined}
                            accessibilityLiveRegion="assertive"
                            showChevron={false}
                        />
                    </ItemGroup>
                ));
            }
        }

        if (directory.partial) {
            add('retry', () => (
                <ItemGroup footer={t('homeGovernance.unavailableBody')}>
                    <Item testID="home-teams-retry" title={t('homeGovernance.retry')} icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />} onPress={directory.refresh} showChevron={false} />
                </ItemGroup>
            ));
        } else if (directory.hasMore) {
            add('load-more', () => (
                <ItemGroup>
                    <Item testID="home-teams-load-more" title={t('homeGovernance.loadMore')} onPress={directory.loadMore} showChevron={false} />
                </ItemGroup>
            ));
        }
        return result;
    }, [archived, archivedLoading, archivedRetryable, context.projection.capabilities.createTeam, directory, mayGovern, router, serverId, showArchived, teamsEnabled, theme.colors.text.secondary]);

    const renderRow = React.useCallback(({ item }: Readonly<{ item: HomeTeamsVirtualizedRow }>) => item.render(), []);

    return (
        <VirtualizedList
            testID="home-teams-virtualized-list"
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={renderRow}
            ListHeaderComponent={props.header == null ? null : <>{props.header}</>}
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

export const HomeAdministrationTeamsScreen = React.memo(function HomeAdministrationTeamsScreen(
    props: Readonly<{ serverId: string }>,
) {
    return (
        <HomeAdministrationSection
            serverId={props.serverId}
            title={t('homeGovernance.teams')}
            presentation="virtualized-list"
        >
            {(context, header) => <HomeTeams context={context} header={header} />}
        </HomeAdministrationSection>
    );
});
