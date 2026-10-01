import * as React from 'react';
import { usePathname, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { useUnistyles } from 'react-native-unistyles';
import { HappierCollectionListMark } from '@happier-dev/plugin-ui/presentation';

import { useRoleCatalog } from '@/components/roles/catalog/useRoleCatalog';
import { useRoleEnginePresentation } from '@/components/roles/catalog/useRoleEnginePresentation';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { CollectionDraftRow, CollectionList, CollectionListGroupLabel, collectionListStyles } from '@/components/ui/lists/collection/CollectionList';
import type { RoleCatalogEntry } from '@/sync/domains/roles/roleCatalog';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { newRoleRoute, resolveRoleCollectionSelection, roleDraftTitle, roleRoute } from './roleCollectionRoutes';

/** The collection offers a search field only once it no longer fits at a glance. */
const SEARCH_THRESHOLD = 8;

export function openRoleCollectionHref(router: ReturnType<typeof useRouter>, href: string, replace: boolean, tag: string) {
    const result = runGuardedNavigation(() => (replace ? router.replace(href as never) : router.push(href as never)));
    if (result !== true) fireAndForget(result, { tag });
}

type RoleGroup = Readonly<{ id: RoleCatalogEntry['source']; title: string; entries: ReadonlyArray<RoleCatalogEntry> }>;

/** Built-in, yours, shared with you and from plugins, in that order; empty groups drop out. */
export function groupRoleCatalog(entries: ReadonlyArray<RoleCatalogEntry>, query: string): ReadonlyArray<RoleGroup> {
    const needle = query.trim().toLowerCase();
    const matches = (entry: RoleCatalogEntry) => !needle || entry.role.name.toLowerCase().includes(needle);
    const groups: RoleGroup[] = [
        { id: 'built_in', title: t('roles.settings.groupBuiltIn'), entries: [] },
        { id: 'user', title: t('roles.settings.groupYours'), entries: [] },
        { id: 'shared', title: t('roles.settings.groupShared'), entries: [] },
        { id: 'plugin', title: t('roles.settings.groupPlugins'), entries: [] },
    ];
    return groups
        .map((group) => ({ ...group, entries: entries.filter((entry) => entry.source === group.id && matches(entry)) }))
        .filter((group) => group.entries.length > 0);
}

/** "Opus 5.5 · session" — the engine and how the role runs, the two facts a list row needs. */
export function useDescribeRoleRow(): (entry: RoleCatalogEntry) => string {
    const presentEngine = useRoleEnginePresentation();
    return React.useCallback((entry) => {
        const engine = presentEngine(entry.role.engine).label ?? t('roles.rail.defaultEngine');
        const runsAs = entry.role.runsAs.kind === 'session'
            ? t('roles.settings.runsAsSession')
            : t('roles.settings.runsAsBackgroundRun');
        return `${engine} · ${runsAs}`;
    }, [presentEngine]);
}

/**
 * The rail beside a role's detail. Selection comes from the route; the draft of a new role sits on
 * top while its editor is open, and a note explains roles migrated from 0.2 sub-agents guidance.
 */
export const RoleCollectionRail = React.memo(function RoleCollectionRail() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const pathname = usePathname().replace(/\/+$/, '');
    const selection = resolveRoleCollectionSelection(pathname);
    const catalog = useRoleCatalog();
    const presentEngine = useRoleEnginePresentation();
    const describe = useDescribeRoleRow();
    const [query, setQuery] = React.useState('');
    const searchable = catalog.entries.length > SEARCH_THRESHOLD;
    const groups = groupRoleCatalog(catalog.entries, searchable ? query : '');
    const hasMigrated = catalog.entries.some((entry) => entry.migratedFromV0_2);
    const selectedRoleId = selection.kind === 'role' ? selection.roleId : null;

    return (
        <CollectionList
            testID="settings.roles.rail"
            title={t('roles.settings.count', { count: catalog.entries.length })}
            count={catalog.entries.length}
            headerAction={(
                <IconButton
                    testID="settings.roles.rail.add"
                    iconName="plus"
                    accessibilityLabel={t('roles.settings.newRole')}
                    tooltip={t('roles.settings.newRole')}
                    variant="plain"
                    onPress={() => openRoleCollectionHref(router, newRoleRoute(), selection.kind !== 'none', 'RoleCollectionRail.add')}
                />
            )}
            search={searchable ? {
                value: query,
                onChangeText: setQuery,
                placeholder: t('roles.rail.searchPlaceholder'),
                testID: 'settings.roles.rail.search',
            } : null}
        >
            {selection.kind === 'draft' ? (
                <CollectionDraftRow
                    testID="settings.roles.rail.draft"
                    titles={roleDraftTitle}
                    placeholder={t('roles.settings.newRoleName')}
                    mark={(
                        <HappierCollectionListMark>
                            <Icon name="person" size={20} color={theme.colors.text.secondary} />
                        </HappierCollectionListMark>
                    )}
                />
            ) : null}
            {groups.length === 0 ? (
                <Item
                    testID="settings.roles.rail.empty"
                    title={catalog.status === 'failed'
                        ? t('roles.settings.loadFailed')
                        : searchable && query.trim() ? t('common.noMatches') : t('roles.rail.empty')}
                    density="compact"
                    showChevron={false}
                    mode="info"
                />
            ) : groups.map((group, index) => (
                <React.Fragment key={group.id}>
                    <CollectionListGroupLabel
                        title={group.title}
                        count={group.entries.length}
                        first={index === 0 && selection.kind !== 'draft'}
                    />
                    {group.entries.map((entry) => {
                        const engine = presentEngine(entry.role.engine);
                        return (
                            <Item
                                key={entry.roleId}
                                testID={`settings.roles.row.${entry.roleId}`}
                                title={entry.role.name}
                                titleStyle={entry.role.enabled ? undefined : collectionListStyles.dimmedTitle}
                                subtitle={entry.override ? `${describe(entry)} · ${t('roles.settings.edited')}` : describe(entry)}
                                icon={(
                                    <HappierCollectionListMark dimmed={!entry.role.enabled}>
                                        {engine.icon ?? <Icon name="person" size={20} color={theme.colors.text.secondary} />}
                                    </HappierCollectionListMark>
                                )}
                                selected={selectedRoleId === entry.roleId}
                                density="compact"
                                showChevron={false}
                                pressableStyle={collectionListStyles.row}
                                onPress={() => openRoleCollectionHref(
                                    router,
                                    roleRoute(entry.roleId),
                                    selection.kind !== 'none',
                                    'RoleCollectionRail.open',
                                )}
                            />
                        );
                    })}
                </React.Fragment>
            ))}
            {hasMigrated ? (
                <Item
                    testID="settings.roles.rail.migratedNote"
                    title={t('roles.settings.migratedNote')}
                    titleLines={0}
                    density="compact"
                    showChevron={false}
                    mode="info"
                />
            ) : null}
        </CollectionList>
    );
});
