import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import type { HomeAccountRowV1 } from '@happier-dev/protocol/home/governance';
import { Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Avatar } from '@/components/ui/avatar/Avatar';
import { CompactSearchField } from '@/components/ui/forms/CompactSearchField';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { VirtualizedList } from '@/components/ui/lists/virtualized';
import { useHomeAccountRoster } from '@/hooks/home/useHomeAccountRoster';
import {
    useHomeAccountSearch,
} from '@/hooks/home/useHomeAccountSearch';
import { resolveAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import { t } from '@/text';

import { HomeAdministrationSection } from './HomeAdministrationSection';
import { HomeInvitePeopleButton } from './HomeInvitePeopleDialog';
import type { HomeAdministrationContext } from './homeAdministrationContext';
import { homeAdministrationAccountPath } from './homeAdministrationRoutes';
import { HomeAccountStatusPill } from './HomeAccountStatusPill';
import { homeRoleLabel } from './homeGovernanceLabels';
import { segmentHomeAdministrationRows } from './homeAdministrationVirtualizedSegments';

/**
 * Matches for a typed query, as the Home answered them.
 *
 * A picker row carries identity only — no Home role and no lifecycle status —
 * so this deliberately shows neither. Inventing a badge here would claim a
 * state the Home did not report; the account's own page shows the authoritative
 * role and status.
 */
type PeopleVirtualizedRow = Readonly<{
    key: string;
    render: () => React.ReactElement;
}>;

const PEOPLE_CHUNK_SIZE = 12;
/** The person's identity mark on the People list. */
const PEOPLE_AVATAR_SIZE = 32;

const PeopleRoster = React.memo(function PeopleRoster(
    props: Readonly<{ context: HomeAdministrationContext; header?: React.ReactNode }>,
) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { context } = props;
    const canList = context.projection.capabilities.manageAccounts;
    const [query, setQuery] = React.useState('');
    const roster = useHomeAccountRoster(context.scope, canList);
    const search = useHomeAccountSearch(context.scope, query, canList);
    const isSearching = query.trim().length > 0;

    const searchHeader = canList ? (
        <CompactSearchField
            testID="home-people-search"
            value={query}
            onChangeText={setQuery}
            placeholder={t('homeGovernance.searchPlaceholder')}
            placement="page"
        />
    ) : null;

    const rows = React.useMemo<readonly PeopleVirtualizedRow[]>(() => {
        if (!canList) {
            return [{
                key: 'forbidden',
                render: () => (
                    <ItemGroup description={t('homeGovernance.forbiddenBody')}>
                        <Item
                            testID="home-admin-viewer-forbidden"
                            title={t('homeGovernance.forbiddenTitle')}
                            mode="info"
                            showChevron={false}
                        />
                    </ItemGroup>
                ),
            }];
        }

        if (roster.error && roster.rows.length === 0 && roster.error.kind === 'unsupported') {
            return [{
                key: 'unsupported',
                render: () => (
                    <ItemGroup
                        title={t('homeGovernance.rosterUnavailableTitle')}
                        description={t('homeGovernance.rosterUnavailableBody')}
                    >
                        <Item
                            testID="home-people-unsupported"
                            title={t('homeGovernance.rosterUnavailableTitle')}
                            showChevron={false}
                        />
                    </ItemGroup>
                ),
            }];
        }

        // A typed query asks a different question than the page cursor does, so
        // the answers are never blended into one list.
        if (isSearching) {
            if (search.rows.length === 0) {
                if (search.searching) {
                    return [{
                        key: 'search-loading',
                        render: () => (
                            <ItemGroup>
                                <Item testID="home-people-search-loading" title={t('homeGovernance.loading')} loading mode="info" showChevron={false} />
                            </ItemGroup>
                        ),
                    }];
                }
                if (search.failure) {
                    const unsupported = search.failure.kind === 'unsupported';
                    // Read now: the row renders later, where the narrowing no longer holds.
                    const retryable = search.failure.retryable;
                    return [{
                        key: 'search-failure',
                        render: () => (
                            <ItemGroup description={unsupported ? t('homeGovernance.searchUnsupportedBody') : t('homeGovernance.searchFailedBody')}>
                                <Item
                                    testID={unsupported ? 'home-people-search-unsupported' : 'home-people-search-failed'}
                                    title={unsupported ? t('homeGovernance.searchUnsupported') : t('homeGovernance.searchFailed')}
                                    mode="info"
                                    showChevron={false}
                                />
                                {retryable ? (
                                    <Item
                                        testID="home-people-search-retry"
                                        title={t('homeGovernance.retry')}
                                        onPress={search.retry}
                                        showChevron={false}
                                    />
                                ) : null}
                            </ItemGroup>
                        ),
                    }];
                }
                return [{
                    key: 'search-empty',
                    render: () => (
                        <ItemGroup>
                            <Item testID="home-people-search-empty" title={t('homeGovernance.searchEmpty')} mode="info" showChevron={false} />
                        </ItemGroup>
                    ),
                }];
            }

            const result: PeopleVirtualizedRow[] = [];
            for (const segment of segmentHomeAdministrationRows(search.rows, PEOPLE_CHUNK_SIZE)) {
                const chunk = segment.items;
                const { first, last } = segment;
                result.push({
                    key: `search:${chunk[0]!.accountId}`,
                    render: () => (
                        <ItemGroup
                            title={first ? t('homeGovernance.searchResults') : undefined}
                            description={last ? t('homeGovernance.searchResultsFooter') : undefined}
                            virtualizedSegment={{ first, last }}
                        >
                            {chunk.map((row) => {
                                const person = resolveAccountDisplayName({ profile: row.profile, accountId: row.accountId, viewerAccountId: context.scope.accountId });
                                return (
                                    <Item
                                        key={row.accountId}
                                        testID={`home-people-search-row:${row.accountId}`}
                                        title={person.name}
                                        subtitle={person.hint ?? undefined}
                                        onPress={() => router.push(homeAdministrationAccountPath(context.scope.serverId, row.accountId))}
                                    />
                                );
                            })}
                        </ItemGroup>
                    ),
                });
            }
            return result;
        }

        if (roster.status === 'loading' && roster.rows.length === 0) {
            return [{
                key: 'loading',
                render: () => (
                    <ItemGroup>
                        <Item testID="home-people-loading" title={t('homeGovernance.loading')} loading showChevron={false} />
                    </ItemGroup>
                ),
            }];
        }

        if (roster.rows.length === 0 && roster.status === 'ready') {
            return [{
                key: 'empty',
                render: () => (
                    <ItemGroup>
                        <Item testID="home-people-empty" title={t('homeGovernance.peopleEmpty')} showChevron={false} />
                    </ItemGroup>
                ),
            }];
        }

        const result: PeopleVirtualizedRow[] = [];
        for (const segment of segmentHomeAdministrationRows(roster.rows, PEOPLE_CHUNK_SIZE)) {
            const chunk = segment.items;
            const { first, last } = segment;
            result.push({
                key: `roster:${chunk[0]!.accountId}`,
                render: () => (
                    <ItemGroup
                        title={first ? t('homeGovernance.people') : undefined}
                        virtualizedSegment={{ first, last }}
                    >
                        {chunk.map((row) => {
                            const person = resolveAccountDisplayName({
                                profile: row.profile,
                                accountId: row.accountId,
                                signInEmail: row.authentication.signInEmail,
                                viewerAccountId: context.scope.accountId,
                            });
                            return (
                                <Item
                                    key={row.accountId}
                                    testID={`home-people-row:${row.accountId}`}
                                    title={person.name}
                                    leftElement={<Avatar id={row.accountId} size={PEOPLE_AVATAR_SIZE} imageUrl={row.profile.avatarUrl ?? null} />}
                                    subtitle={[
                                        homeRoleLabel(row.homeRole),
                                        person.viewer && person.named ? t('homeGovernance.person.you') : null,
                                        person.hint,
                                    ].filter((part): part is string => part !== null).join(' · ')}
                                    rightElement={<HomeAccountStatusPill row={row} testID={`home-people-status:${row.accountId}`} />}
                                    onPress={() => router.push(homeAdministrationAccountPath(context.scope.serverId, row.accountId))}
                                />
                            );
                        })}
                    </ItemGroup>
                ),
            });
        }

        if (roster.error) {
            result.push({
                key: 'retry',
                render: () => (
                    <ItemGroup description={t('homeGovernance.unavailableBody')}>
                        <Item
                            testID="home-people-retry"
                            title={t('homeGovernance.retry')}
                            onPress={roster.reload}
                            showChevron={false}
                        />
                    </ItemGroup>
                ),
            });
        } else if (roster.hasMore) {
            result.push({
                key: 'load-more',
                render: () => (
                    <ItemGroup>
                        <Item
                            testID="home-people-load-more"
                            title={t('homeGovernance.loadMore')}
                            loading={roster.status === 'loading_more'}
                            disabled={roster.status === 'loading_more'}
                            onPress={roster.loadMore}
                            showChevron={false}
                        />
                    </ItemGroup>
                ),
            });
        }
        return result;
    }, [canList, context.scope.accountId, context.scope.serverId, isSearching, roster, router, search, theme.colors.text.secondary]);

    const renderRow = React.useCallback(({ item }: Readonly<{ item: PeopleVirtualizedRow }>) => item.render(), []);

    return (
        <VirtualizedList
            testID="home-people-virtualized-list"
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={renderRow}
            ListHeaderComponent={<>{props.header}{searchHeader}</>}
            style={{
                flex: 1,
                backgroundColor: theme.colors.surface.base,
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

export const HomeAdministrationPeopleScreen = React.memo(function HomeAdministrationPeopleScreen(
    props: Readonly<{ serverId: string }>,
) {
    return (
        <HomeAdministrationSection
            serverId={props.serverId}
            title={t('homeGovernance.people')}
            description={t('homeGovernance.pages.people')}
            presentation="virtualized-list"
            pageActions={(context) => ({
                actions: <HomeInvitePeopleButton context={context} testID="home-people-invite" />,
            })}
        >
            {/* A credential change here means a different roster and different
                search answers; the shell discards this section for the previous
                Home/Account scope so neither carries over. */}
            {(context, header) => <PeopleRoster context={context} header={header} />}
        </HomeAdministrationSection>
    );
});
