import * as React from 'react';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { SearchHeader } from '@/components/ui/forms/SearchHeader';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { VirtualizedList } from '@/components/ui/lists/virtualized';
import { useHomeGovernanceEligibilitySnapshots } from '@/hooks/home/useHomeGovernanceEligibilitySnapshots';
import { useTeamsDirectory } from '@/hooks/teams/useTeamsDirectory';
import { teamAddressKey } from '@/sync/domains/teams/teamAddress';
import { t } from '@/text';

import { TeamRow } from './TeamRow';
import { firstRouteParam } from './teamRouteParams';
import { teamCredentialCreatePath, teamDetailPath, teamsCreatePath } from './teamsRoutes';
import type {
    TeamsDirectoryRow,
    TeamsDirectoryUnavailableHome,
} from './teamsDirectoryViewState';

const TEAM_DIRECTORY_CHUNK_SIZE = 12;

type TeamsDirectoryVirtualizedRow = Readonly<{
    key: string;
    render: () => React.ReactElement;
}>;

function matchesDirectorySearch(row: TeamsDirectoryRow, normalizedQuery: string): boolean {
    if (normalizedQuery.length === 0) return true;
    return row.team.name.toLocaleLowerCase().includes(normalizedQuery)
        || row.homeName.toLocaleLowerCase().includes(normalizedQuery);
}

/**
 * The Teams destination.
 *
 * It is one calm list across the exact Home set, not a per-Home dashboard. A
 * Home that answered keeps its rows through every refresh and failure, and a
 * Home that could not answer is named at the bottom with its own reason instead
 * of quietly shrinking the list — so "no Teams" is only ever shown when every
 * admitted Home actually said so.
 */

function unavailableHomeBody(home: TeamsDirectoryUnavailableHome): string {
    switch (home.reason) {
        case 'loading':
            return t('teams.unavailable.offline');
        case 'denied':
            return t('teams.errors.forbidden');
        case 'unsupported':
            return t('teams.unavailable.updateRequired');
        case 'offline':
            return t('teams.unavailable.offline');
    }
}

const UnavailableHomes = React.memo(function UnavailableHomes(props: Readonly<{
    homes: readonly TeamsDirectoryUnavailableHome[];
    onRetry: () => void;
    /**
     * Distinguishes the active list's report from the archived list's, because
     * both can name the same Home and a surface that identified them the same
     * way could not say which read a person was being told about.
     */
    testIDPrefix?: string;
    retryTestID?: string;
}>) {
    const { theme } = useUnistyles();
    if (props.homes.length === 0) return null;

    const prefix = props.testIDPrefix ?? 'teams-home-unavailable';
    const retryable = props.homes.some((home) => home.retryable);
    return (
        <ItemGroup footer={t('teams.directory.partialHomes')}>
            {props.homes.map((home) => (
                <Item
                    key={home.serverId}
                    testID={`${prefix}:${home.serverId}`}
                    title={home.homeName}
                    subtitle={unavailableHomeBody(home)}
                    icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                    loading={home.reason === 'loading'}
                    showChevron={false}
                />
            ))}
            {retryable ? (
                <Item
                    testID={props.retryTestID ?? 'teams-directory-retry'}
                    title={t('teams.unavailable.retry')}
                    icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                    onPress={props.onRetry}
                    showChevron={false}
                />
            ) : null}
        </ItemGroup>
    );
});

export const TeamsDirectoryScreen = React.memo(function TeamsDirectoryScreen() {
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const router = useRouter();
    const params = useLocalSearchParams<{
        credentialSourceServerId?: string | string[];
        credentialSourceKind?: string | string[];
        credentialSourcePluginId?: string | string[];
        credentialSourceLocalId?: string | string[];
        credentialSourceAccountId?: string | string[];
        credentialSourceGroupId?: string | string[];
        credentialSourceConnectionId?: string | string[];
        credentialSourceSlotId?: string | string[];
        credentialSourceMachineId?: string | string[];
        credentialSourceConnectionSecurityFingerprint?: string | string[];
    }>();
    const sourceServerId = firstRouteParam(params.credentialSourceServerId).trim();
    const sourceKind = firstRouteParam(params.credentialSourceKind).trim();
    const sourcePluginId = firstRouteParam(params.credentialSourcePluginId).trim();
    const sourceLocalId = firstRouteParam(params.credentialSourceLocalId).trim();
    const sourceAccountId = firstRouteParam(params.credentialSourceAccountId).trim();
    const sourceGroupId = firstRouteParam(params.credentialSourceGroupId).trim();
    const sourceConnectionId = firstRouteParam(params.credentialSourceConnectionId).trim();
    const sourceSlotId = firstRouteParam(params.credentialSourceSlotId).trim();
    const sourceMachineId = firstRouteParam(params.credentialSourceMachineId).trim();
    const sourceConnectionSecurityFingerprint = firstRouteParam(params.credentialSourceConnectionSecurityFingerprint).trim();
    const sourceHint = React.useMemo(() => (
        sourceServerId && sourceKind === 'provider_connection' && sourceConnectionId && sourceSlotId && sourceMachineId && sourceConnectionSecurityFingerprint
            ? {
                kind: 'provider_connection' as const,
                serverId: sourceServerId,
                machineId: sourceMachineId,
                connectionId: sourceConnectionId,
                credentialSlotId: sourceSlotId,
                connectionSecurityFingerprint: sourceConnectionSecurityFingerprint,
            }
            : sourceServerId && sourcePluginId && sourceLocalId
            ? sourceKind === 'connected_pool' && sourceGroupId
                ? {
                    kind: 'connected_pool' as const,
                    serverId: sourceServerId,
                    service: { pluginId: sourcePluginId, localId: sourceLocalId },
                    groupId: sourceGroupId,
                }
                : sourceAccountId
                    ? {
                        kind: 'connected_account' as const,
                        serverId: sourceServerId,
                        account: { service: { pluginId: sourcePluginId, localId: sourceLocalId }, accountId: sourceAccountId },
                    }
                    : null
            : null
    ), [sourceAccountId, sourceConnectionId, sourceConnectionSecurityFingerprint, sourceGroupId, sourceKind, sourceLocalId, sourceMachineId, sourcePluginId, sourceServerId, sourceSlotId]);
    const [showArchived, setShowArchived] = React.useState(false);
    const [query, setQuery] = React.useState('');

    const active = useTeamsDirectory({
        archived: 'active',
        ...(sourceHint ? { serverIds: [sourceHint.serverId] } : {}),
    });
    const createEligibility = useHomeGovernanceEligibilitySnapshots(active.scopes);
    // The archived query is a separate page sequence with its own ordering, so
    // it is only asked for once the viewer opens that section.
    const archived = useTeamsDirectory({ archived: 'archived', enabled: showArchived });

    React.useEffect(() => {
        navigation.setOptions({ title: t('teams.title') });
    }, [navigation]);

    const openTeam = React.useCallback(
        (serverId: string, teamId: string) => {
            const address = { serverId, teamId };
            router.push(sourceHint
                ? teamCredentialCreatePath(address, sourceHint)
                : teamDetailPath(address));
        },
        [router, sourceHint],
    );

    const toggleArchived = React.useCallback(() => {
        setShowArchived((current) => !current);
    }, []);

    // A Team archived from this device is already in the active sequence's own
    // answer, and the archived sequence returns it again once it has been read.
    // Both are kept — the local one so the section is never empty on arrival —
    // but one Team is one row, in the order it was first known here.
    const archivedRows = React.useMemo(() => {
        if (!showArchived) return active.archivedRows;
        const seen = new Set<string>();
        const merged: TeamsDirectoryRow[] = [];
        for (const row of [...active.archivedRows, ...archived.archivedRows]) {
            const key = teamAddressKey(row.address);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(row);
        }
        return merged;
    }, [showArchived, active.archivedRows, archived.archivedRows]);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const visibleActiveRows = React.useMemo(
        () => active.rows.filter((row) => matchesDirectorySearch(row, normalizedQuery)),
        [active.rows, normalizedQuery],
    );
    const visibleArchivedRows = React.useMemo(
        () => archivedRows.filter((row) => matchesDirectorySearch(row, normalizedQuery)),
        [archivedRows, normalizedQuery],
    );

    // Still being read, as opposed to read and refused: every Home that has not
    // contributed is simply not finished. A failure must not keep a spinner on
    // screen, so this is derived from the reasons rather than from the absence
    // of rows.
    const archivedPending = archived.unavailableHomes.length > 0
        && archived.unavailableHomes.every((home) => home.reason === 'loading');

    const showCreateTeam = active.scopes.some((scope) => {
        const snapshot = createEligibility.snapshotsByServerId.get(scope.serverId);
        return snapshot?.data?.teamsEnabled === true && snapshot.data.createTeam;
    });
    const canCreateTeam = active.scopes.some((scope) => {
        const snapshot = createEligibility.snapshotsByServerId.get(scope.serverId);
        return snapshot?.status === 'ready'
            && !snapshot.stale
            && snapshot.data?.teamsEnabled === true
            && snapshot.data.createTeam;
    });

    const rows = React.useMemo<readonly TeamsDirectoryVirtualizedRow[]>(() => {
        const result: TeamsDirectoryVirtualizedRow[] = [];
        const add = (key: string, render: () => React.ReactElement) => result.push({ key, render });

        if (active.kind === 'loading' && active.unavailableHomes.length === 0) {
            add('loading', () => (
                <ItemGroup>
                    <Item testID="teams-directory-loading" title={t('teams.title')} loading showChevron={false} />
                </ItemGroup>
            ));
            return result;
        }

        if (active.stale) {
            add('stale', () => (
                <ItemGroup footer={t('teams.stale.label')}>
                    <Item
                        testID="teams-directory-stale"
                        title={t('teams.stale.label')}
                        icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                        detail={t('teams.unavailable.retry')}
                        accessibilityLiveRegion="polite"
                        onPress={active.refresh}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
        }

        if (active.kind === 'empty') {
            add('empty', () => (
                <ItemGroup footer={t('teams.directory.emptyBody')}>
                    <Item testID="teams-directory-empty" title={t('teams.directory.emptyTitle')} showChevron={false} />
                </ItemGroup>
            ));
        } else {
            for (let start = 0; start < visibleActiveRows.length; start += TEAM_DIRECTORY_CHUNK_SIZE) {
                const chunk = visibleActiveRows.slice(start, start + TEAM_DIRECTORY_CHUNK_SIZE);
                const first = start === 0;
                const last = start + TEAM_DIRECTORY_CHUNK_SIZE >= visibleActiveRows.length;
                const firstAddress = chunk[0]!.address;
                add(`active:${teamAddressKey(firstAddress)}`, () => (
                    <ItemGroup
                        title={first ? t('teams.title') : undefined}
                        virtualizedSegment={{ first, last }}
                    >
                        {chunk.map((row) => (
                            <TeamRow
                                key={teamAddressKey(row.address)}
                                row={row}
                                showHome={active.multiHome}
                                onPress={() => openTeam(row.address.serverId, row.address.teamId)}
                            />
                        ))}
                    </ItemGroup>
                ));
            }
            if (active.rows.length > 0 && visibleActiveRows.length === 0) {
                add('search-empty', () => (
                    <ItemGroup>
                        <Item
                            testID="teams-directory-search-empty"
                            title={t('teams.directory.emptyTitle')}
                            subtitle={t('teams.directory.searchPlaceholder')}
                            showChevron={false}
                        />
                    </ItemGroup>
                ));
            }
        }

        if (active.hasMore) {
            add('load-more', () => (
                <ItemGroup>
                    <Item testID="teams-directory-load-more" title={t('homeGovernance.loadMore')} onPress={active.loadMore} showChevron={false} />
                </ItemGroup>
            ));
        }

        if (active.unavailableHomes.length > 0) {
            add('unavailable-homes', () => (
                <UnavailableHomes homes={active.unavailableHomes} onRetry={active.refresh} />
            ));
        }

        if (showCreateTeam && sourceHint === null) {
            add('create', () => (
                <ItemGroup>
                    <Item
                        testID="teams-directory-new"
                        title={t('teams.directory.newTeam')}
                        disabled={!canCreateTeam}
                        onPress={canCreateTeam ? () => router.push(teamsCreatePath()) : undefined}
                    />
                </ItemGroup>
            ));
        }

        if (sourceHint === null) {
            add('toggle-archived', () => (
                <ItemGroup>
                    <Item
                        testID="teams-directory-toggle-archived"
                        title={showArchived ? t('teams.directory.hideArchived') : t('teams.directory.showArchived')}
                        accessibilityExpanded={showArchived}
                        onPress={toggleArchived}
                        showChevron={false}
                    />
                </ItemGroup>
            ));
        }

        if (showArchived && sourceHint === null) {
            if (visibleArchivedRows.length > 0) {
                for (let start = 0; start < visibleArchivedRows.length; start += TEAM_DIRECTORY_CHUNK_SIZE) {
                    const chunk = visibleArchivedRows.slice(start, start + TEAM_DIRECTORY_CHUNK_SIZE);
                    const first = start === 0;
                    const last = start + TEAM_DIRECTORY_CHUNK_SIZE >= visibleArchivedRows.length;
                    const firstAddress = chunk[0]!.address;
                    add(`archived:${teamAddressKey(firstAddress)}`, () => (
                        <ItemGroup
                            title={first ? t('teams.directory.archivedSection') : undefined}
                            virtualizedSegment={{ first, last }}
                        >
                            {chunk.map((row) => (
                                <TeamRow
                                    key={`archived:${teamAddressKey(row.address)}`}
                                    row={row}
                                    showHome={active.multiHome}
                                    onPress={() => openTeam(row.address.serverId, row.address.teamId)}
                                />
                            ))}
                        </ItemGroup>
                    ));
                }
            } else if (archivedPending) {
                add('archived-loading', () => (
                    <ItemGroup title={t('teams.directory.archivedSection')}>
                        <Item testID="teams-directory-archived-loading" title={t('teams.directory.archivedSection')} loading showChevron={false} />
                    </ItemGroup>
                ));
            } else if (archived.unavailableHomes.length === 0 && normalizedQuery.length === 0) {
                add('archived-empty', () => (
                    <ItemGroup title={t('teams.directory.archivedSection')} footer={t('teams.directory.archivedEmptyBody')}>
                        <Item testID="teams-directory-archived-empty" title={t('teams.directory.archivedEmpty')} showChevron={false} />
                    </ItemGroup>
                ));
            }

            if (!archivedPending && archived.unavailableHomes.length > 0) {
                add('archived-unavailable-homes', () => (
                    <UnavailableHomes
                        homes={archived.unavailableHomes}
                        onRetry={archived.refresh}
                        testIDPrefix="teams-archived-home-unavailable"
                        retryTestID="teams-directory-archived-retry"
                    />
                ));
            }

            if (archived.hasMore) {
                add('archived-load-more', () => (
                    <ItemGroup>
                        <Item testID="teams-directory-archived-load-more" title={t('homeGovernance.loadMore')} onPress={archived.loadMore} showChevron={false} />
                    </ItemGroup>
                ));
            }
        }

        return result;
    }, [active, archived, archivedPending, canCreateTeam, normalizedQuery, openTeam, router, showArchived, showCreateTeam, sourceHint, theme.colors.state.warning.foreground, toggleArchived, visibleActiveRows, visibleArchivedRows]);

    const renderRow = React.useCallback(
        ({ item }: Readonly<{ item: TeamsDirectoryVirtualizedRow }>) => item.render(),
        [],
    );

    return (
        <VirtualizedList
            testID="teams-directory-virtualized-list"
            data={rows}
            keyExtractor={(item) => item.key}
            renderItem={renderRow}
            ListHeaderComponent={(
                <SearchHeader
                    testID="teams-directory-search"
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t('teams.directory.searchPlaceholder')}
                />
            )}
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
