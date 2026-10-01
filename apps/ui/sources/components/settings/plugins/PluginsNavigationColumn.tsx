import * as React from 'react';
import { View } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useDaemonMergedProjectionInputs } from '@/agents/backendCatalog/useDaemonMergedProjectionInputs';
import { destinationRowTestId, useColumnDestinations } from '@/components/appShell/destinations/ColumnDestinationRows';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import {
    CollectionList,
    CollectionListGroupLabel,
    CollectionNavigationRow,
} from '@/components/ui/lists/collection/CollectionList';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import {
    createPluginSettingsViews,
    filterInstalledPlugins,
    partitionInstalledPlugins,
    readInstalledPlugins,
    type InstalledPluginEntry,
} from './model/pluginMarketplaceModel';
import { listPluginsDeveloperLinks } from './model/pluginsDeveloperLinks';
import { usePluginsAdministrationTarget } from './model/usePluginsAdministrationTarget';
import { usePluginsOpenItem } from './model/usePluginsOpenItem';
import { setPluginsInstalledQuery, usePluginsInstalledQuery } from './model/pluginsInstalledSearch';
import { buildPluginsHomeRoute, PLUGINS_APP_ROUTE } from './model/pluginsSurfaceRoutes';
import { PluginMark } from './PluginMark';

type NavigationHref = Parameters<ReturnType<typeof useRouter>['replace']>[0];

/** The column offers a search field once the plugins no longer fit at a glance. */
const SEARCH_THRESHOLD = 8;

const byTitle = (left: InstalledPluginEntry, right: InstalledPluginEntry) => left.title.localeCompare(right.title);

/**
 * The Plugins destination's column: the Collection's `list` presentation on the navigation plane,
 * drawn with the navigation rows (flat, no sheets, the plane's selected chip). Installed (with its count) and Browse drive the page; below them the plugins installed on
 * the machine the page administers, grouped as "Added" and "Included with Happier"; "For developers"
 * sits at the foot. Selecting a plugin opens its detail beside the page (the same selection the grid
 * and list mark, `usePluginsOpenItem`).
 *
 * It reads the page's own owners — the administered machine, its marketplace snapshot and its
 * contribution projection (agent marks) — so column and page list and count the same plugins.
 */
export const PluginsNavigationColumn = React.memo(function PluginsNavigationColumn() {
    const styles = stylesheet;
    const router = useRouter();
    const pathname = usePathname().replace(/\/+$/, '');
    const { view } = useGlobalSearchParams<{ view?: string }>();
    const { openItem, open: openPlugin } = usePluginsOpenItem();
    const target = usePluginsAdministrationTarget();
    const installedPlugins = readInstalledPlugins(target.machineCapabilities.state);
    // The count is the machine's answer (or its last-known snapshot); never a "0" while it is asked.
    const countKnown = installedPlugins.length > 0 || target.machineCapabilities.state.status === 'loaded';
    // The one installed-plugins query: the page's grid and list filter by what is typed here.
    const query = usePluginsInstalledQuery();
    const { added, included } = React.useMemo(() => {
        const partition = partitionInstalledPlugins(filterInstalledPlugins(installedPlugins, { query, status: 'all' }));
        return { added: partition.added.slice().sort(byTitle), included: partition.included.slice().sort(byTitle) };
    }, [installedPlugins, query]);
    const projection = useDaemonMergedProjectionInputs({
        machineId: target.executionTarget?.machine.id ?? null,
        serverId: target.executionTarget?.serverId ?? null,
        enabled: target.executionTarget !== null,
    });
    const pluginProjectionById = projection.inputs?.pluginProjectionById;
    const views = createPluginSettingsViews(t);
    // Entries other destinations placed in this column, under its header (design §3.1).
    const placed = useColumnDestinations('plugins');
    const onHome = pathname === PLUGINS_APP_ROUTE;
    const openView = React.useCallback((next: 'installed' | 'browse') => {
        const result = runGuardedNavigation(() => router.replace(buildPluginsHomeRoute('app', { view: next }) as NavigationHref));
        if (result !== true) fireAndForget(result, { tag: 'PluginsNavigationColumn.openView' });
    }, [router]);
    const isOpen = (pluginId: string) => (openItem?.kind === 'installed' && openItem.pluginId === pluginId)
        || pathname === `${PLUGINS_APP_ROUTE}/${encodeURIComponent(pluginId)}`
        || pathname === `${PLUGINS_APP_ROUTE}/${pluginId}`;

    const pluginRow = (entry: InstalledPluginEntry) => (
        <CollectionNavigationRow
            key={entry.pluginId}
            testID={`plugins-column:plugin:${entry.pluginId}`}
            title={entry.title}
            icon={<PluginMark title={entry.title} iconAgentId={pluginProjectionById?.[entry.pluginId]?.iconAgentId ?? null} />}
            selected={isOpen(entry.pluginId)}
            onPress={() => openPlugin({ kind: 'installed', pluginId: entry.pluginId })}
        />
    );
    const noMatch = query.trim().length > 0 && added.length === 0 && included.length === 0;

    return (
        <View testID="plugins-column" style={styles.column}>
            <CollectionList
                testID="plugins-column:list"
                surface="plane"
                title={t('settingsPlugins.surfaces.navigationTitle')}
                search={installedPlugins.length > SEARCH_THRESHOLD ? {
                    testID: 'plugins-column:search',
                    value: query,
                    onChangeText: setPluginsInstalledQuery,
                    placeholder: t('settingsPlugins.surfaces.installedSearchPlaceholder'),
                } : null}
            >
                {placed.destinations.map((destination) => (
                    <CollectionNavigationRow
                        key={destination.id}
                        testID={destinationRowTestId(destination)}
                        title={destination.title}
                        icon={<Icon name={destination.icon} />}
                        selected={destination.id === placed.currentId}
                        // An unavailable page still opens: its route says why.
                        onPress={() => placed.activate(destination)}
                    />
                ))}
                {views.map((entry) => {
                    const browse = entry.id === 'discover';
                    return (
                        <CollectionNavigationRow
                            key={entry.id}
                            testID={`plugins-column:${entry.id}`}
                            title={entry.label}
                            icon={<Icon name={browse ? 'globe' : 'check'} />}
                            detail={browse || !countKnown ? undefined : String(installedPlugins.length)}
                            selected={onHome && (browse ? view === 'browse' : view !== 'browse')}
                            onPress={() => openView(browse ? 'browse' : 'installed')}
                        />
                    );
                })}
                {noMatch ? (
                    <Item title={t('settingsPlugins.surfaces.noMatch', { query: query.trim() })} mode="info" density="compact" />
                ) : null}
                {added.length > 0 ? (
                    <>
                        <CollectionListGroupLabel title={t('settingsPlugins.surfaces.addedGroup')} count={added.length} />
                        {added.map(pluginRow)}
                    </>
                ) : null}
                {included.length > 0 ? (
                    <>
                        <CollectionListGroupLabel title={t('settingsPlugins.rowSource.bundled')} count={included.length} />
                        {included.map(pluginRow)}
                    </>
                ) : null}
            </CollectionList>
            <PluginsDeveloperMenu />
        </View>
    );
});

/** "For developers", pinned at the column's foot: the developer pages in a menu. */
const PluginsDeveloperMenu = React.memo(function PluginsDeveloperMenu() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const [open, setOpen] = React.useState(false);
    const webhooksAvailable = useFeatureEnabled('plugins.webhooks');
    const links = listPluginsDeveloperLinks({ webhooksAvailable });
    const items = links.map((link): DropdownMenuItem => ({ id: link.testID, testID: `plugins-column:developer:${link.testID}`, title: t(link.setting.titleKey) }));
    return (
        <View style={styles.foot}>
            <DropdownMenu
                testID="plugins-column:developers"
                open={open}
                onOpenChange={setOpen}
                items={items}
                onSelect={(id) => {
                    setOpen(false);
                    const link = links.find((candidate) => candidate.testID === id);
                    if (!link) return;
                    const result = runGuardedNavigation(() => router.push(link.route as never));
                    if (result !== true) fireAndForget(result, { tag: 'PluginsNavigationColumn.developers' });
                }}
                placement="top"
                variant="slim"
                matchTriggerWidth={false}
                popoverPortalWebTarget="body"
                trigger={({ toggle }) => (
                    <CollectionNavigationRow
                        testID="plugins-column:developers.trigger"
                        title={t('settingsPlugins.surfaces.forDevelopers')}
                        icon={<Icon name="wrench" color={theme.colors.text.secondary} />}
                        selected={false}
                        onPress={toggle}
                    />
                )}
            />
        </View>
    );
});

const stylesheet = StyleSheet.create(() => ({
    column: {
        flex: 1,
        minHeight: 0,
    },
    foot: {
        paddingBottom: 8,
    },
}));
