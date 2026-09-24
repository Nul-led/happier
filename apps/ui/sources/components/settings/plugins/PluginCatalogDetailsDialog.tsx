import * as React from 'react';
import { Platform, View } from 'react-native';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Modal } from '@/modal';
import { t } from '@/text';
import { openExternalUrl } from '@/utils/url/openExternalUrl';

import type { InstalledPluginEntry, PluginMarketplaceActionRequest } from './model/pluginMarketplaceModel';
import { formatCatalogEntryVersion } from './model/pluginMarketplaceModel';
import type { PluginMarketplaceCatalogEntry } from './readPluginMarketplaceCatalog';

export function catalogReviewStatusLabel(entry: PluginMarketplaceCatalogEntry): string {
    if (entry.warning === 'withdrawn') return t('settingsPlugins.discover.reviewStatus.withdrawn');
    if (entry.sourceKind === 'curated' && entry.reviewStatus === 'approved') return t('settingsPlugins.discover.reviewStatus.curated');
    return t('settingsPlugins.discover.reviewStatus.unreviewed');
}

function catalogRuntimeSummary(entry: PluginMarketplaceCatalogEntry): string {
    const realms = entry.executableRealms.map((realm) => {
        if (realm === 'daemon') return t('settingsPlugins.discover.executableRealm.daemon');
        if (realm === 'client') return t('settingsPlugins.discover.executableRealm.client');
        return t('settingsPlugins.discover.executableRealm.hostedWeb');
    });
    const platforms = entry.platforms.map((platform) => {
        if (platform === 'darwin') return t('settingsPlugins.discover.platform.darwin');
        if (platform === 'linux') return t('settingsPlugins.discover.platform.linux');
        if (platform === 'windows') return t('settingsPlugins.discover.platform.windows');
        if (platform === 'web') return t('settingsPlugins.discover.platform.web');
        if (platform === 'ios') return t('settingsPlugins.discover.platform.ios');
        return t('settingsPlugins.discover.platform.android');
    });
    return t('settingsPlugins.discover.runtimeSummary', {
        realms: realms.join(', ') || t('settingsPlugins.installReviewSections.none'),
        platforms: platforms.join(', ') || t('settingsPlugins.installReviewSections.none'),
    });
}

type CatalogDetailsProps = Readonly<{
    entry: PluginMarketplaceCatalogEntry;
    installed: boolean;
    disabled: boolean;
    target: Readonly<{ machine: string; server: string }> | null;
    onProceed: () => void;
    onClose: () => void;
}>;

export function PluginCatalogDetailsDialog(props: CatalogDetailsProps) {
    const { entry } = props;
    const links = [
        { id: 'homepage', title: t('settingsPlugins.catalog.homepage'), url: entry.links.homepage },
        { id: 'repository', title: t('settingsPlugins.catalog.repository'), url: entry.links.repository },
        { id: 'support', title: t('settingsPlugins.catalog.support'), url: entry.links.support },
        { id: 'universal', title: t('settingsPlugins.catalog.pluginPage'), url: entry.links.universal },
    ].filter((link): link is typeof link & { url: string } => Boolean(link.url));

    return (
        <View>
            <ItemGroup>
                <Item
                    title={entry.title}
                    titleLines={0}
                    subtitle={entry.description}
                    subtitleLines={0}
                    detail={formatCatalogEntryVersion(entry.version)}
                    mode="info"
                    showChevron={false}
                    subtitleAccessory={<StatusPill chrome="plain" labelVariant="phrase"
                        variant={entry.warning === undefined ? 'info' : 'warning'} label={catalogReviewStatusLabel(entry)} />}
                />
                <Item title={t('settingsPlugins.discover.publisherLabel', { displayName: entry.publisher.displayName, id: entry.publisher.id })} titleLines={0}
                    subtitle={t('settingsPlugins.discoveredVia', { source: entry.sourceTitle })}
                    subtitleLines={0}
                    mode="info" showChevron={false} />
            </ItemGroup>
            {entry.contributions.length > 0 ? (
                <ItemGroup title={t('settingsPlugins.catalog.adds')}>
                    <Item title={entry.contributions.join(', ')} titleLines={0} mode="info" showChevron={false} />
                </ItemGroup>
            ) : null}
            <ItemGroup title={t('settingsPlugins.provenanceTitle')}>
                <Item title={catalogRuntimeSummary(entry)} titleLines={0} mode="info" showChevron={false} />
                {entry.categories.length > 0 ? <Item title={t('settingsPlugins.discover.categories', { values: entry.categories.join(', ') })}
                    titleLines={0} mode="info" showChevron={false} /> : null}
            </ItemGroup>
            {links.length > 0 ? (
                <ItemGroup title={t('settingsPlugins.catalog.links')}>
                    {links.map((link) => <Item key={link.id} title={link.title} subtitle={link.url}
                        testID={`settings.plugins.catalogDetails.link.${link.id}`}
                        onPress={async () => {
                            if (!await openExternalUrl(link.url)) Modal.alert(t('common.error'), t('common.requestFailed'));
                        }} />)}
                </ItemGroup>
            ) : null}
            <ItemGroup>
                {props.target ? <Item title={t('settingsPlugins.pluginChangeConfirmTarget', props.target)} titleLines={0} mode="info" showChevron={false} /> : null}
                {!props.installed && entry.registrySelectionOrigin !== null ? (
                    <Item testID="settings.plugins.catalogDetails.registrySelection"
                        title={t('settingsPlugins.discover.registrySelectionRequired', { origin: entry.registrySelectionOrigin })}
                        titleLines={0} mode="info" showChevron={false} />
                ) : null}
                {props.installed || entry.installable ? (
                    <View style={{ padding: 16, alignItems: 'flex-start' }}>
                        <RoundButton size="normal" titleNumberOfLines="complete"
                            style={{ minHeight: resolveMinimumInteractiveTargetSize(Platform.OS) }}
                            testID={props.installed ? 'settings.plugins.catalogDetails.manage' : 'settings.plugins.catalogDetails.install'}
                            title={props.installed ? t('settingsPlugins.managePlugin') : t('settingsPlugins.installAndTrust')}
                            disabled={!props.installed && props.disabled}
                            onPress={props.onProceed} />
                    </View>
                ) : null}
            </ItemGroup>
        </View>
    );
}

type CatalogDetailsOwnerProps = Readonly<{
    entries: readonly PluginMarketplaceCatalogEntry[];
    installedPluginById: ReadonlyMap<string, InstalledPluginEntry>;
    canRunActions: boolean;
    loading: boolean;
    isPluginActionInFlight: (pluginId: string) => boolean;
    administrationTargetKey: string;
    administrationTargetLabel: CatalogDetailsProps['target'];
    onAction: (request: PluginMarketplaceActionRequest) => void;
    onNavigateToPlugin: (pluginId: string) => void;
}>;

/** A selected view of the current query, never another catalog or action owner. */
export function usePluginCatalogDetails(props: CatalogDetailsOwnerProps) {
    const latest = React.useRef(props);
    latest.current = props;
    const modalId = React.useRef<string | null>(null);
    const [selection, setSelection] = React.useState<Readonly<{ id: string; sourceId: string; targetKey: string }> | null>(null);
    const close = React.useCallback(() => {
        const id = modalId.current;
        modalId.current = null;
        setSelection(null);
        if (id) Modal.hide(id);
    }, []);
    const selectedEntry = selection ? props.entries.find((entry) => entry.id === selection.id && entry.sourceId === selection.sourceId) : undefined;
    const installed = selectedEntry ? props.installedPluginById.has(selectedEntry.id) : false;
    const disabled = !props.canRunActions || props.loading || (selectedEntry ? props.isPluginActionInFlight(selectedEntry.id) : false);

    React.useLayoutEffect(() => {
        if (!modalId.current || !selection) return;
        if (!selectedEntry || selection.targetKey !== props.administrationTargetKey) {
            close();
            return;
        }
        Modal.update<CatalogDetailsProps>(modalId.current, {
            entry: selectedEntry, installed, disabled, target: props.administrationTargetLabel,
        });
    }, [selection, selectedEntry, installed, disabled, props.administrationTargetKey, props.administrationTargetLabel, close]);
    React.useEffect(() => () => {
        if (modalId.current) Modal.hide(modalId.current);
    }, []);

    return (entry: PluginMarketplaceCatalogEntry) => {
        if (modalId.current) close();
        const targetKey = props.administrationTargetKey;
        const onProceed = () => {
            const current = latest.current;
            if (current.administrationTargetKey !== targetKey) return;
            const currentEntry = current.entries.find((candidate) => candidate.id === entry.id && candidate.sourceId === entry.sourceId);
            if (!currentEntry) return;
            if (current.installedPluginById.has(entry.id)) {
                close();
                current.onNavigateToPlugin(entry.id);
            } else if (currentEntry.installable && current.canRunActions && !current.loading && !current.isPluginActionInFlight(entry.id)) {
                close();
                current.onAction({ method: 'install', pluginId: entry.id, sourceId: entry.sourceId });
            }
        };
        setSelection({ id: entry.id, sourceId: entry.sourceId, targetKey });
        modalId.current = Modal.show({
            component: PluginCatalogDetailsDialog,
            props: { entry, installed: props.installedPluginById.has(entry.id),
                disabled: !props.canRunActions || props.loading || props.isPluginActionInFlight(entry.id),
                target: props.administrationTargetLabel, onProceed },
            onRequestClose: () => { modalId.current = null; setSelection(null); },
            chrome: {
                kind: 'card', title: t('common.details'), testID: 'settings.plugins.catalogDetails',
                scrollHost: 'body', bodyScroll: 'auto', dimensions: { width: 640, maxHeightRatio: 0.9, size: 'lg' },
            },
            closeOnBackdrop: true,
        });
    };
}
