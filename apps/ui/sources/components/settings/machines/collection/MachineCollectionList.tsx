import * as React from 'react';
import { useGlobalSearchParams, usePathname, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { MachineCliGlyphs } from '@/components/sessions/new/components/MachineCliGlyphs';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { CompactSearchField } from '@/components/ui/forms/CompactSearchField';
import { SelectionTiles } from '@/components/ui/forms/SelectionTiles';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { useMachinesSettingsViewModel, type MachinesSettingsViewModel } from '../machinesSettingsViewModel';
import { MachinePoolsSection } from '../sections/MachinePoolsSection';
import { machinePoolDraftTitle } from '../pools/machinePoolDraftTitle';
import {
    MACHINES_ADD_ROUTE,
    MACHINES_THIS_COMPUTER_ROUTE,
    buildMachineCollection,
    isMachineCollectionRowSelected,
    machineCollectionHref,
    resolveSelectedMachineCollectionKey,
    type MachineCollectionRow,
    type MachineCollectionSection,
} from './machineCollectionModel';
import { recordMachineCollectionVisit } from './machineCollectionVisit';
import { useMachineAddOptions, type MachineAddOption } from './useMachineAddOptions';
import { useMachineAddDraftRow } from '@/components/machines/add/useMachineAddFlow';
import { CollectionDraftRow, CollectionList, CollectionListGroupLabel, collectionListStyles } from '@/components/ui/lists/collection/CollectionList';
import { HappierCollectionListMark } from '@happier-dev/plugin-ui/presentation';
import { StatusDot } from '@/components/ui/status/StatusDot';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { sync } from '@/sync/sync';

/** The collection offers a search field only once it no longer fits at a glance. */
const SEARCH_THRESHOLD = 8;

function readParam(value: string | string[] | undefined): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    return trimmed.length > 0 ? trimmed : null;
}

/** Presence first, as every machine row reads (K1 picker anatomy), then the row's own facts. */
function statusLine(row: MachineCollectionRow, withHost: boolean): string {
    return [row.presence, row.reason, withHost ? row.host : null, row.platformLabel].filter(Boolean).join(' · ');
}

function openHref(router: ReturnType<typeof useRouter>, href: string, replace: boolean, tag: string) {
    const result = runGuardedNavigation(() => (replace ? router.replace(href as never) : router.push(href as never)));
    if (result !== true) fireAndForget(result, { tag });
}

/**
 * The Machines collection's "+": the ways this device can add to it (`useMachineAddOptions`). Setup
 * opens the setup wizard; a new pool opens its draft in the collection.
 */
export const AddMachineMenu = React.memo(function AddMachineMenu(props: Readonly<{
    options: readonly MachineAddOption[];
    /** Beside a detail, an option inside the collection replaces the open detail. */
    replaceInCollection: boolean;
}>) {
    const router = useRouter();
    const [open, setOpen] = React.useState(false);
    const items = React.useMemo((): ReadonlyArray<DropdownMenuItem> => props.options.map((option) => ({
        id: option.id,
        title: option.title,
        subtitle: option.subtitle,
    })), [props.options]);
    if (props.options.length === 0) return null;
    return (
        <DropdownMenu
            testID="settings.machines.addMenu"
            open={open}
            onOpenChange={setOpen}
            items={items}
            onSelect={(id) => {
                setOpen(false);
                const option = props.options.find((candidate) => candidate.id === id);
                if (!option) return;
                openHref(router, option.href, option.inCollection && props.replaceInCollection, 'AddMachineMenu.select');
            }}
            placement="bottom"
            popoverAnchorAlign="end"
            matchTriggerWidth={false}
            maxWidthCap={320}
            showCategoryTitles={false}
            popoverPortalWebTarget="body"
            trigger={({ toggle }) => (
                <IconButton
                    testID="settings.machines.addMenu.trigger"
                    iconName="plus"
                    accessibilityLabel={t('settings.addMachine')}
                    tooltip={t('settings.addMachine')}
                    variant="plain"
                    onPress={toggle}
                />
            )}
        />
    );
});

/**
 * The ways to add a machine as action tiles: the Machines page when there is nothing to list yet,
 * and the Add a machine page.
 */
export const MachineAddOptionTiles = React.memo(function MachineAddOptionTiles(props: Readonly<{
    options: readonly MachineAddOption[];
    testIdPrefix: string;
}>) {
    const router = useRouter();
    if (props.options.length === 0) return null;
    return (
        <SelectionTiles
            variant="action"
            accessibilityLabel={t('settings.addMachine')}
            testIdPrefix={props.testIdPrefix}
            options={props.options.map((option) => ({
                id: option.id,
                title: option.title,
                subtitle: option.subtitle,
                icon: option.icon,
            }))}
            onPress={(id) => {
                const option = props.options.find((candidate) => candidate.id === id);
                if (option) openHref(router, option.href, false, 'MachineAddOptionTiles.press');
            }}
        />
    );
});

/**
 * The Machines collection: this computer (desktop app), the machines of each Home the app shows, then
 * their machine pools. `rail` is the narrow list beside the open detail; `page` is the same list as
 * page sections where no rail shows. Selection comes from the route.
 */
export const MachineCollectionList = React.memo(function MachineCollectionList(props: Readonly<{
    variant: 'rail' | 'page';
    viewModel: MachinesSettingsViewModel;
    addOptions: readonly MachineAddOption[];
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const pathname = usePathname().replace(/\/+$/, '');
    const params = useGlobalSearchParams<{ serverId?: string | string[] }>();
    const { viewModel, addOptions } = props;
    const isDesktop = isDesktopHost();
    const rail = props.variant === 'rail';
    const onDetailRoute = pathname.startsWith('/settings/machines/');
    const selectedKey = rail ? resolveSelectedMachineCollectionKey(pathname, { serverId: readParam(params.serverId) }) : null;

    const [query, setQuery] = React.useState('');
    const total = React.useMemo(
        () => viewModel.visibleMachineGroups.reduce((count, group) => count + group.machines.length, 0),
        [viewModel.visibleMachineGroups],
    );
    const searchable = total > SEARCH_THRESHOLD;
    const collection = React.useMemo(() => buildMachineCollection({
        groups: viewModel.visibleMachineGroups,
        groupedByHome: viewModel.showMachinesGroupedByServer,
        query: searchable ? query : '',
    }), [query, searchable, viewModel.showMachinesGroupedByServer, viewModel.visibleMachineGroups]);

    React.useEffect(() => {
        if (!selectedKey?.startsWith('machine:')) return;
        const [, serverId, machineId] = selectedKey.split(':');
        if (machineId) recordMachineCollectionVisit({ machineId, serverId: serverId ?? '' });
    }, [selectedKey]);

    const openMachine = (row: MachineCollectionRow) => {
        // Beside a detail, switching machines replaces the shown detail instead of stacking history.
        openHref(router, machineCollectionHref(row), rail && onDetailRoute, 'MachineCollectionList.openMachine');
    };

    const renderMachineRow = (row: MachineCollectionRow) => (
        <Item
            key={`${row.serverId}:${row.machineId}`}
            testID={`settings.machines.row.${row.serverId}.${row.machineId}`}
            title={row.title}
            subtitle={statusLine(row, !rail)}
            subtitleLeading={(
                <StatusDot
                    testID={`settings.machines.row.${row.serverId}.${row.machineId}.presence`}
                    color={row.online ? theme.colors.status.connected : theme.colors.status.disconnected}
                />
            )}
            subtitleAccessory={rail ? undefined : (
                <MachineCliGlyphs machineId={row.machineId} serverId={row.serverId} isOnline={row.online} />
            )}
            icon={(
                <HappierCollectionListMark>
                    <Icon name="desktop" size={20} color={theme.colors.text.secondary} />
                </HappierCollectionListMark>
            )}
            selected={rail ? isMachineCollectionRowSelected(selectedKey, row) : undefined}
            density={rail ? 'compact' : undefined}
            showChevron={!rail}
            pressableStyle={rail ? collectionListStyles.row : undefined}
            onPress={() => openMachine(row)}
        />
    );

    const thisComputerRow = isDesktop ? (
        <Item
            testID="settings.machines.thisComputer"
            title={t('settingsMachines.thisComputerTitle')}
            subtitle={t('settingsMachines.thisComputerRowSubtitle')}
            icon={(
                <HappierCollectionListMark>
                    <Icon name="laptop" size={20} color={theme.colors.text.secondary} />
                </HappierCollectionListMark>
            )}
            selected={rail ? selectedKey === 'thisComputer' : undefined}
            density={rail ? 'compact' : undefined}
            showChevron={!rail}
            pressableStyle={rail ? collectionListStyles.row : undefined}
            onPress={() => openHref(router, MACHINES_THIS_COMPUTER_ROUTE, rail && onDetailRoute, 'MachineCollectionList.thisComputer')}
        />
    ) : null;

    const loading = viewModel.isLoadingMachines;
    const empty = !loading && !viewModel.hasMachines;
    // A Home whose machine list could not be read ends in that fact, not in "no machines" or "Loading…".
    const unreadableGroup = empty
        ? viewModel.visibleMachineGroups.find((group) => group.status === 'error') ?? null
        : null;
    const renderUnreadable = (group: Readonly<{ serverId: string; serverName: string }>, compact: boolean) => {
        // Retry reads the focused Home again; another Home recovers through its own connection.
        const canRetry = group.serverId === viewModel.activeServerId;
        return (
            <Item
                key={`unreadable:${group.serverId}`}
                testID="settings.machines.unreadable"
                title={t('settingsMachines.unreadableTitle', { home: group.serverName })}
                titleLines={0}
                density={compact ? 'compact' : undefined}
                showChevron={false}
                mode="info"
                rightElement={canRetry ? (
                    <RoundButton
                        testID="settings.machines.unreadable.retry"
                        size="small"
                        display="secondary"
                        title={t('common.retry')}
                        onPress={() => fireAndForget(sync.refreshMachines(), { tag: 'MachineCollectionList.retry' })}
                    />
                ) : undefined}
            />
        );
    };
    const noMatches = searchable && query.trim().length > 0 && collection.count === 0;
    const sectionStatusLabel = (section: MachineCollectionSection): string | undefined => {
        switch (section.status) {
            case 'signedOut': return t('server.signedOut');
            case 'loading': return t('status.connecting');
            case 'error': return t('status.error');
            default: return undefined;
        }
    };

    if (!rail) {
        return (
            <>
                {searchable ? (
                    <CompactSearchField
                        testID="settings.machines.search"
                        value={query}
                        onChangeText={setQuery}
                        placeholder={t('settingsMachines.searchPlaceholder')}
                        placement="page"
                    />
                ) : null}
                {thisComputerRow ? <ItemGroup>{thisComputerRow}</ItemGroup> : null}
                {loading ? (
                    <ItemGroup title={t('settings.machines')}>
                        <Item title={t('common.loading')} showChevron={false} mode="info" />
                    </ItemGroup>
                ) : unreadableGroup ? (
                    <ItemGroup title={t('settings.machines')}>
                        {renderUnreadable(unreadableGroup, false)}
                    </ItemGroup>
                ) : empty ? (
                    <ItemGroup
                        title={t('settings.addMachine')}
                        description={t('settingsMachines.addPageDescription')}
                        surface="none"
                    >
                        {/* Pools have their own section below, with its own add row. */}
                        <MachineAddOptionTiles options={addOptions.filter((option) => option.id !== 'pool')} testIdPrefix="settings.machines.add" />
                    </ItemGroup>
                ) : collection.sections.map((section) => (
                    <ItemGroup
                        key={section.serverId}
                        // One Home: the page title already names the list.
                        title={section.title ?? undefined}
                        description={section.title ? [
                            t('settingsMachines.count', { count: section.rows.length }),
                            sectionStatusLabel(section),
                        ].filter(Boolean).join(' · ') : undefined}
                    >
                        {section.rows.length === 0 && !noMatches && section.status === 'error' ? (
                            renderUnreadable({ serverId: section.serverId, serverName: section.title ?? '' }, false)
                        ) : section.rows.length === 0 ? (
                            <Item
                                title={noMatches ? t('common.noMatches') : t('newSession.noMachinesFound')}
                                subtitle={noMatches ? undefined : sectionStatusLabel(section)}
                                showChevron={false}
                                mode="info"
                            />
                        ) : section.rows.map(renderMachineRow)}
                    </ItemGroup>
                ))}
                <MachinePoolsSection groups={viewModel.visibleMachineGroups} />
            </>
        );
    }

    return (
        <CollectionList
            testID="settings.machines.rail"
            title={t('settings.machines')}
            count={loading ? null : total}
            headerAction={<AddMachineMenu options={addOptions} replaceInCollection={onDetailRoute} />}
            search={searchable ? {
                value: query,
                onChangeText: setQuery,
                placeholder: t('settingsMachines.searchPlaceholder'),
                testID: 'settings.machines.rail.search',
            } : null}
        >
            <MachineDraftRow selected={selectedKey === 'machineDraft'} replace={onDetailRoute} />
            {selectedKey?.startsWith('poolDraft:') ? <MachinePoolDraftRow /> : null}
            {thisComputerRow}
            {loading ? (
                <Item title={t('common.loading')} density="compact" showChevron={false} mode="info" />
            ) : unreadableGroup ? (
                renderUnreadable(unreadableGroup, true)
            ) : empty ? (
                <Item
                    testID="settings.machines.rail.empty"
                    title={t('newSession.noMachinesFound')}
                    density="compact"
                    showChevron={false}
                    mode="info"
                />
            ) : collection.sections.map((section, index) => (
                <React.Fragment key={section.serverId}>
                    {section.title ? (
                        <CollectionListGroupLabel
                            title={section.title}
                            count={section.rows.length}
                            first={index === 0 && !thisComputerRow}
                        />
                    ) : null}
                    {section.rows.length === 0 && !noMatches && section.status === 'error' ? (
                        renderUnreadable({ serverId: section.serverId, serverName: section.title ?? '' }, true)
                    ) : section.rows.length === 0 ? (
                        <Item
                            title={noMatches ? t('common.noMatches') : (sectionStatusLabel(section) ?? t('newSession.noMachinesFound'))}
                            density="compact"
                            showChevron={false}
                            mode="info"
                        />
                    ) : section.rows.map(renderMachineRow)}
                </React.Fragment>
            ))}
            <MachinePoolsSection groups={viewModel.visibleMachineGroups} variant="rail" selectedKey={selectedKey} />
        </CollectionList>
    );
});

/**
 * The machine being added (lab `add-flows` M4/M5), at the top of the rail while its form is open or its
 * setup is still running elsewhere: titled by its host once typed, with the live step. Pressing it
 * opens the form again. It reads only the flow's narrow row projection.
 */
const MachineDraftRow = React.memo(function MachineDraftRow(props: Readonly<{ selected: boolean; replace: boolean }>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const row = useMachineAddDraftRow();
    if (!row && !props.selected) return null;
    const tone = row?.tone ?? 'waiting';
    return (
        <Item
            testID="settings.machines.rail.draft"
            title={row?.title ?? t('machineAdd.newMachine')}
            subtitle={row?.status ?? t('common.draft')}
            subtitleLeading={row ? (
                <StatusDot
                    color={tone === 'failed' ? theme.colors.status.error : tone === 'arrived' ? theme.colors.status.connected : theme.colors.status.connecting}
                    isPulsing={tone === 'waiting' || tone === 'running'}
                />
            ) : undefined}
            icon={(
                <HappierCollectionListMark>
                    <Icon name="plus" size={20} color={theme.colors.text.secondary} />
                </HappierCollectionListMark>
            )}
            selected={props.selected}
            density="compact"
            showChevron={false}
            pressableStyle={collectionListStyles.row}
            onPress={() => openHref(router, MACHINES_ADD_ROUTE, props.replace, 'MachineCollectionList.draft')}
        />
    );
});

/** The pool being added, at the top of the rail while its editor is open. */
const MachinePoolDraftRow = React.memo(function MachinePoolDraftRow() {
    const { theme } = useUnistyles();
    return (
        <CollectionDraftRow
            testID="settings.machines.rail.poolDraft"
            titles={machinePoolDraftTitle}
            placeholder={t('machinePools.newPoolTitle')}
            mark={(
                <HappierCollectionListMark>
                    <Icon name="stack" size={20} color={theme.colors.text.secondary} />
                </HappierCollectionListMark>
            )}
        />
    );
});

/** The rail beside a machine's detail. */
export const MachineCollectionRail = React.memo(function MachineCollectionRail() {
    const viewModel = useMachinesSettingsViewModel();
    const addOptions = useMachineAddOptions(viewModel.visibleMachineGroups);
    return <MachineCollectionList variant="rail" viewModel={viewModel} addOptions={addOptions} />;
});

const stylesheet = StyleSheet.create(() => ({
}));
