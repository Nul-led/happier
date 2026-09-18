import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { PluginProjectionDiagnostic } from '@/agents/backendCatalog/daemonContributionRegistryProjectionAdapters';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { buildActionRowAccessibilityLabel } from '@/components/ui/lists/actionRowAccessibility';
import { Text } from '@/components/ui/text/Text';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { t } from '@/text';

import { PluginDiagnosticsSection } from './diagnostics/PluginDiagnosticsSection';
import type {
    PluginMarketplaceCatalogEntry,
    PluginMarketplaceDiscoverDiagnostic,
    PluginMarketplaceDiscoverSourceStatus,
    PluginMarketplaceNonInstallableListing,
} from './readPluginMarketplaceCatalog';
import { Icon } from '@/components/ui/icons/Icon';
import type { InstalledPluginActionId } from './model/usePluginSettingsScreenState';
import {
    formatCatalogEntryVersion,
    formatDevelopmentPluginSubtitle,
    formatInstalledSubtitle,
    formatPendingPluginChangeSubtitle,
    formatPendingPluginChangeTitle,
    projectInstalledPluginLifecycleCapabilities,
    readPendingPluginChangeListingId,
    type DevelopmentPluginEntry,
    type InstalledPluginEntry,
    type PendingPluginChangeListing,
    type PluginMarketplaceActionRequest,
} from './model/pluginMarketplaceModel';

export function InstalledPluginsSection(props: Readonly<{
    installedPlugins: readonly InstalledPluginEntry[];
    truthSettled: boolean;
    unavailable: boolean;
    onDiscover: () => void;
    canRunActions: boolean;
    isPluginActionInFlight: (pluginId: string) => boolean;
    onNavigateToPlugin: (pluginId: string) => void;
    onRunAction: (action: InstalledPluginActionId, pluginId: string) => void;
}>) {
    const { theme } = useUnistyles();
    return (
        <ItemGroup title={t('deps.ui.installed')}>
            {props.installedPlugins.length > 0 ? props.installedPlugins.map((entry) => {
                const capabilities = projectInstalledPluginLifecycleCapabilities(entry);
                const toggleAction = entry.enabled ? 'disable' : 'enable';
                const canToggle = entry.enabled ? capabilities.canDisable : capabilities.canEnable;
                const busy = props.isPluginActionInFlight(entry.pluginId);
                // Update sits beside the enable/disable toggle because it acts
                // on this installed record, not on a marketplace listing: the
                // daemon update owner reads the record's own trusted channel,
                // so it is answerable here whether or not Discover is loaded.
                const actions = [
                    ...(canToggle ? [{
                        id: toggleAction,
                        title: entry.enabled ? t('common.disable') : t('common.enable'),
                        subtitle: entry.enabled ? t('common.enabled') : t('common.disabled'),
                        icon: entry.enabled ? 'x-circle' as const : 'check-circle' as const,
                        inlineTestID: `settings.plugins.marketplace.installed.${entry.pluginId}.action.${toggleAction}`,
                        disabled: !props.canRunActions || busy,
                        onPress: () => props.onRunAction(toggleAction, entry.pluginId),
                    }] : []),
                    ...(capabilities.canUpdate ? [{
                        id: 'update',
                        title: t('common.update'),
                        subtitle: t('settingsPlugins.updateFromInstalledRecordSubtitle'),
                        icon: 'arrow-circle-up' as const,
                        inlineTestID: `settings.plugins.marketplace.installed.${entry.pluginId}.action.update`,
                        disabled: !props.canRunActions || busy,
                        onPress: () => props.onRunAction('update', entry.pluginId),
                    }] : []),
                ];
                return (
                    <Item
                        key={entry.pluginId}
                        testID={`settings.plugins.marketplace.installed.${entry.pluginId}`}
                        title={entry.title}
                        subtitle={formatInstalledSubtitle(entry)}
                        detail={entry.version}
                        icon={<Icon name="archive" size={29} color={theme.colors.text.secondary} />}
                        onPress={() => props.onNavigateToPlugin(entry.pluginId)}
                        rightElementOutsidePressable={actions.length > 0}
                        rightElement={actions.length > 0 ? (
                            <ItemRowActions
                                title={entry.title}
                                compactActionIds={canToggle ? [toggleAction] : ['update']}
                                overflowTriggerTestID={`settings.plugins.marketplace.installed.${entry.pluginId}.actions.overflow`}
                                actions={actions}
                            />
                        ) : null}
                    />
                );
            }) : props.unavailable ? null : !props.truthSettled ? (
                <Item
                    testID="settings.plugins.marketplace.installed.loading"
                    title={t('common.loading')}
                    loading
                    mode="info"
                    showChevron={false}
                />
            ) : (
                <Item
                    testID="settings.plugins.marketplace.installed.empty"
                    title={t('settingsPlugins.installedEmpty')}
                    detail={t('settingsPlugins.views.discover')}
                    icon={<Icon name="archive" size={29} color={theme.colors.text.secondary} />}
                    onPress={props.onDiscover}
                />
            )}
        </ItemGroup>
    );
}

/**
 * The decisions this machine's daemon is holding for the present user.
 *
 * This is the app half of the agent-authored plugin loop: an Agent can prepare
 * a plugin change but cannot approve source-root or package trust, so without
 * this section its change is invisible and expires unanswered. The section is
 * rendered only when something is actually waiting, so it reads as attention
 * rather than as permanent furniture.
 */
export function PendingPluginChangesSection(props: Readonly<{
    pendingChanges: readonly PendingPluginChangeListing[];
    canRunActions: boolean;
    isPluginActionInFlight: (pendingChangeId: string) => boolean;
    onDecide: (pendingChangeId: string, decision: 'approve' | 'reject') => void;
}>) {
    const { theme } = useUnistyles();
    if (props.pendingChanges.length === 0) return null;
    return (
        <View
            testID="settings.plugins.management.pendingChanges"
            accessibilityLiveRegion="polite"
        >
            <ItemGroup
                title={t('settingsPlugins.pendingChangesTitle')}
                footer={t('settingsPlugins.pendingChangesFooter')}
            >
                {props.pendingChanges.map((entry) => {
                    const pendingChangeId = readPendingPluginChangeListingId(entry);
                    const busy = props.isPluginActionInFlight(pendingChangeId);
                    const decidable = entry.kind !== 'applying';
                    return (
                        <Item
                            key={pendingChangeId}
                            testID={`settings.plugins.management.pendingChanges.${pendingChangeId}`}
                            title={formatPendingPluginChangeTitle(entry)}
                            subtitle={formatPendingPluginChangeSubtitle(entry)}
                            subtitleLines={0}
                            icon={<Icon
                                name={decidable ? 'shield-check' : 'arrow-clockwise'}
                                size={29}
                                color={decidable ? theme.colors.accent.indigo : theme.colors.text.secondary}
                            />}
                            showChevron={false}
                            mode="info"
                            rightElementOutsidePressable
                            rightElement={decidable ? (
                                // The row action opens the full install-and-trust
                                // review (or, for a source-root change, the folder
                                // trust confirmation) before anything is decided;
                                // nothing has been approved yet, so the label says
                                // Review, and the reject action — which discards
                                // without ever opening the review — does not claim
                                // that it shows one.
                                <ItemRowActions
                                    title={formatPendingPluginChangeTitle(entry)}
                                    compactActionIds={['review', 'reject']}
                                    overflowTriggerTestID={`settings.plugins.management.pendingChanges.${pendingChangeId}.actions.overflow`}
                                    actions={[
                                        {
                                            id: 'review',
                                            title: t('settingsPlugins.pendingChangeReviewAction'),
                                            subtitle: t('settingsPlugins.pendingChangesReviewHint'),
                                            icon: 'eye',
                                            inlineTestID: `settings.plugins.management.pendingChanges.${pendingChangeId}.action.review`,
                                            disabled: !props.canRunActions || busy,
                                            onPress: () => props.onDecide(pendingChangeId, 'approve'),
                                        },
                                        {
                                            id: 'reject',
                                            title: t('approvals.reject'),
                                            subtitle: t('settingsPlugins.pendingChangeRejectHint'),
                                            icon: 'x-circle',
                                            destructive: true,
                                            inlineTestID: `settings.plugins.management.pendingChanges.${pendingChangeId}.action.reject`,
                                            disabled: !props.canRunActions || busy,
                                            onPress: () => props.onDecide(pendingChangeId, 'reject'),
                                        },
                                    ]}
                                />
                            ) : undefined}
                        />
                    );
                })}
            </ItemGroup>
        </View>
    );
}

export function RegistryDiagnosticsSection(props: Readonly<{
    diagnostics: readonly PluginProjectionDiagnostic[];
}>) {
    return (
        <PluginDiagnosticsSection
            title={t('settingsPlugins.registryDiagnosticsTitle')}
            diagnostics={props.diagnostics}
            testIDPrefix="settings.plugins.registryDiagnostic"
        />
    );
}

export function DevelopmentPluginsSection(props: Readonly<{
    developmentPlugins: readonly DevelopmentPluginEntry[];
    createAvailable: boolean;
    sourceInstallAvailable: boolean;
    canRunActions: boolean;
    isPluginActionInFlight: (pluginId: string) => boolean;
    onCreate: () => void;
    onCreateWithAgent: () => void;
    onDevelopSourceRoot: () => void;
    onEditWithAgent: (pluginId: string) => void;
    onRunAction: (action: 'test' | 'pack', pluginId: string) => void;
}>) {
    const { theme } = useUnistyles();
    return (
        <ItemGroup title={t('settingsPlugins.developmentTitle')} footer={t('settingsPlugins.developmentFooter')}>
            <Item
                testID="settings.plugins.management.development.action.create"
                title={t('settingsPlugins.developmentCreate')}
                subtitle={t('settingsPlugins.developmentCreateSubtitle')}
                icon={<Icon name="plus-circle" size={29} color={theme.colors.text.secondary} />}
                onPress={props.onCreate}
                disabled={!props.canRunActions || !props.createAvailable}
                showChevron={false}
            />
            <Item
                testID="settings.plugins.management.development.action.createWithAgent"
                title={t('settingsPlugins.developmentCreateWithAgent')}
                subtitle={t('settingsPlugins.developmentCreateWithAgentSubtitle')}
                icon={<Icon name="magic-wand" size={29} color={theme.colors.text.secondary} />}
                onPress={props.onCreateWithAgent}
                disabled={!props.canRunActions || !props.createAvailable}
                showChevron={false}
            />
            <Item
                testID="settings.plugins.management.development.action.develop"
                title={t('settingsPlugins.developmentSourceInstall')}
                subtitle={t('settingsPlugins.developmentSourceInstallSubtitle')}
                subtitleLines={0}
                icon={<Icon name="folder" size={29} color={theme.colors.text.secondary} />}
                onPress={props.onDevelopSourceRoot}
                disabled={!props.canRunActions || !props.sourceInstallAvailable}
                showChevron={false}
            />
            {props.developmentPlugins.length > 0 ? props.developmentPlugins.map((entry) => (
                <React.Fragment key={entry.installed.pluginId}>
                    <Item
                        testID={`settings.plugins.management.development.${entry.installed.pluginId}`}
                        title={entry.installed.title}
                        subtitle={(
                            <Text
                                testID={`settings.plugins.management.development.${entry.installed.pluginId}.details`}
                                selectable
                            >
                                {formatDevelopmentPluginSubtitle(entry)}
                                {' | '}
                                {t('settingsPlugins.developmentWatchConfigured')}
                                {' | '}
                                {entry.reload.state === 'clear'
                                    ? t('settingsPlugins.developmentReloadClear')
                                    : t('settingsPlugins.developmentReloadAttention')}
                            </Text>
                        )}
                        detail={entry.installed.version}
                        icon={<Icon name="code" size={29} color={theme.colors.text.secondary} />}
                        showChevron={false}
                        mode="info"
                    />
                    <Item
                        testID={`settings.plugins.management.development.${entry.installed.pluginId}.action.editWithAgent`}
                        title={t('settingsPlugins.developmentEditWithAgent')}
                        subtitle={t('settingsPlugins.developmentEditWithAgentSubtitle')}
                        icon={<Icon name="sparkle" size={29} color={theme.colors.text.secondary} />}
                        onPress={() => props.onEditWithAgent(entry.installed.pluginId)}
                        disabled={!props.canRunActions}
                        showChevron={false}
                    />
                    <Item
                        testID={`settings.plugins.management.development.${entry.installed.pluginId}.action.test`}
                        title={t('settingsPlugins.developmentTest')}
                        subtitle={t('settingsPlugins.developmentTestSubtitle')}
                        icon={<Icon name="checks" size={29} color={theme.colors.text.secondary} />}
                        onPress={() => props.onRunAction('test', entry.installed.pluginId)}
                        disabled={!props.canRunActions || !entry.actions.test || props.isPluginActionInFlight(entry.installed.pluginId)}
                        showChevron={false}
                    />
                    <Item
                        testID={`settings.plugins.management.development.${entry.installed.pluginId}.action.pack`}
                        title={t('settingsPlugins.developmentPack')}
                        subtitle={t('settingsPlugins.developmentPackSubtitle')}
                        icon={<Icon name="cube" size={29} color={theme.colors.text.secondary} />}
                        onPress={() => props.onRunAction('pack', entry.installed.pluginId)}
                        disabled={!props.canRunActions || !entry.actions.pack || props.isPluginActionInFlight(entry.installed.pluginId)}
                        showChevron={false}
                    />
                </React.Fragment>
            )) : (
                <Item
                    testID="settings.plugins.management.development.empty"
                    title={t('settingsPlugins.developmentEmpty')}
                    subtitle={t('settingsPlugins.developmentEmptySubtitle')}
                    icon={<Icon name="code" size={29} color={theme.colors.text.secondary} />}
                    showChevron={false}
                    mode="info"
                />
            )}
        </ItemGroup>
    );
}

export function PluginDiagnosticsSnapshotSection(props: Readonly<{
    diagnostics: readonly PluginProjectionDiagnostic[];
}>) {
    const { theme } = useUnistyles();
    return (
        <View
            testID="settings.plugins.management.diagnostics.live"
            accessibilityLiveRegion="polite"
        >
            {props.diagnostics.length > 0 ? (
                <RegistryDiagnosticsSection diagnostics={props.diagnostics} />
            ) : (
                <ItemGroup title={t('settingsPlugins.diagnosticsSnapshotTitle')} footer={t('settingsPlugins.diagnosticsSnapshotFooter')}>
                    <Item
                        testID="settings.plugins.management.diagnostics.empty"
                        title={t('settingsPlugins.diagnosticsSnapshotEmpty')}
                        subtitle={t('settingsPlugins.diagnosticsSnapshotEmptySubtitle')}
                        icon={<Icon name="pulse" size={29} color={theme.colors.text.secondary} />}
                        showChevron={false}
                        mode="info"
                    />
                </ItemGroup>
            )}
        </View>
    );
}


/**
 * One aggregate status line for the whole Discover pane, plus the detailed
 * rows behind its counts.
 *
 * Discover is a list of independently sourced results, and giving each result
 * its own live region turned one search into a burst of announcements — source
 * disclosure, warning, and loading row all speaking over each other. Assistive
 * technology gets exactly one polite status here, composed from the same facts
 * the pane shows visually, and nothing below it announces on its own.
 *
 * Only the compact summary row is that accessible announcement. The degraded
 * source rows, index diagnostics, and non-installable listings render outside
 * it: an accessible parent aggregates its whole subtree, so nesting the detail
 * rows inside it would hide them from VoiceOver and TalkBack traversal and
 * leave users hearing counts they can never inspect.
 */
export function DiscoverStatusSummary(props: Readonly<{
    loading: boolean;
    error: string | null;
    stale: boolean;
    entryCount: number;
    sourceStatuses: readonly PluginMarketplaceDiscoverSourceStatus[];
    diagnostics: readonly PluginMarketplaceDiscoverDiagnostic[];
    nonInstallable: readonly PluginMarketplaceNonInstallableListing[];
    selectedSourceTitle: string | null;
}>) {
    const { theme } = useUnistyles();
    const degradedSources = props.sourceStatuses.filter((source) => source.freshness !== 'fresh');
    const detailedDiagnostics = [
        ...props.sourceStatuses.flatMap((source) => source.diagnostics),
        ...props.diagnostics,
    ];
    const message = props.loading
        ? props.selectedSourceTitle === null
            ? t('settingsPlugins.discover.status.loading')
            : t('settingsPlugins.discover.status.loadingSource', { source: props.selectedSourceTitle })
        : props.error !== null
            ? t('settingsPlugins.discover.status.errorTitle')
            : props.entryCount === 0 && props.nonInstallable.length > 0
                ? t('settingsPlugins.discover.status.nonInstallable', { count: props.nonInstallable.length })
                : props.entryCount === 0
                    ? t('settingsPlugins.discover.status.empty')
                    : t('settingsPlugins.discover.status.results', {
                        count: props.entryCount,
                        sources: props.sourceStatuses.length,
                    });
    // Qualifiers, in the order a reader needs them: what they are looking at is
    // out of date, then what was missing, then what could not be acted on.
    const qualifiers = [
        ...(props.error !== null && !props.loading ? [props.error] : []),
        ...(props.stale && !props.loading ? [t('settingsPlugins.discover.status.stale')] : []),
        ...(degradedSources.length > 0
            ? [t('settingsPlugins.discover.status.partial', { count: degradedSources.length })]
            : []),
        ...(props.nonInstallable.length > 0 && props.entryCount > 0
            ? [t('settingsPlugins.discover.status.nonInstallable', { count: props.nonInstallable.length })]
            : []),
    ];

    return (
        <View testID="settings.plugins.marketplace.discover.status">
            <View
                accessible
                accessibilityRole={props.error === null ? 'text' : 'alert'}
                accessibilityLiveRegion="polite"
                accessibilityLabel={[message, ...qualifiers].join(' ')}
            >
                <Item
                    testID="settings.plugins.marketplace.discover.status.summary"
                    title={message}
                    subtitle={qualifiers.length > 0 ? qualifiers.join('\n') : undefined}
                    subtitleLines={0}
                    icon={(
                        <Icon
                            name={props.error === null ? 'info' : 'warning'}
                            size={29}
                            color={props.error === null
                                ? theme.colors.text.secondary
                                : theme.colors.state.warning.foreground}
                        />
                    )}
                    loading={props.loading}
                    showChevron={false}
                    mode="info"
                />
            </View>
            {degradedSources.map((source) => (
                <Item
                    key={source.id}
                    testID={`settings.plugins.marketplace.discover.sourceHealth.${source.id}`}
                    title={source.title}
                    subtitle={[
                        t(`settingsPlugins.discover.sourceFreshness.${source.freshness}` as
                            'settingsPlugins.discover.sourceFreshness.stale'),
                        t('settingsPlugins.discover.diagnostic.recovery'),
                    ].join('\n')}
                    subtitleLines={0}
                    icon={<Icon name="globe" size={29} color={theme.colors.state.warning.foreground} />}
                    showChevron={false}
                    mode="info"
                />
            ))}
            {detailedDiagnostics.map((diagnostic) => (
                <Item
                    key={diagnostic.id}
                    testID={`settings.plugins.marketplace.discover.diagnostic.${diagnostic.id}`}
                    title={diagnostic.sourceTitle === null
                        ? t('settingsPlugins.discover.diagnostic.title')
                        : `${diagnostic.sourceTitle} · ${t('settingsPlugins.discover.diagnostic.title')}`}
                    subtitle={`${t('settingsPlugins.discover.diagnostic.recovery')}\n${diagnostic.message}\n${t('settingsPlugins.diagnosticsTechnicalCode', { code: diagnostic.code })}`}
                    subtitleLines={0}
                    icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                    showChevron={false}
                    mode="info"
                />
            ))}
            {props.nonInstallable.map((listing) => (
                <Item
                    key={`${listing.sourceId}:${listing.pluginId}`}
                    testID={`settings.plugins.marketplace.discover.nonInstallable.${listing.sourceId}.${listing.pluginId}`}
                    title={listing.title}
                    subtitle={`${t('settingsPlugins.discoveredVia', { source: listing.sourceTitle })}\n${
                        t(`settingsPlugins.discover.nonInstallableReason.${listing.reason}` as
                            'settingsPlugins.discover.nonInstallableReason.sourceStale')
                    }`}
                    subtitleLines={0}
                    icon={<Icon name="cloud-slash" size={29} color={theme.colors.text.secondary} />}
                    showChevron={false}
                    mode="info"
                />
            ))}
        </View>
    );
}

/**
 * The Discover results themselves.
 *
 * One listing is one row. Source disclosure, trust status and the Install and
 * Trust action all belong to the same result, so they are carried by that
 * result's row instead of multiplying it into a listing row, a warning row and
 * an action row that a reader has to reassemble — and that assistive
 * technology has to traverse three times for one plugin.
 *
 * The row states the trust status concisely; the full disclosure is not
 * dropped, it stays where a decision is actually made — the Install and Trust
 * review, which restates the unreviewed-code and executable-authority facts
 * before anything is installed. A withdrawn listing carries no install action
 * at all, so "new installs are blocked" is shown as the absent affordance
 * rather than as prose next to a button that is not there.
 */
export function DiscoverListingsSection(props: Readonly<{
    entries: readonly PluginMarketplaceCatalogEntry[];
    loading: boolean;
    loadingMore: boolean;
    canLoadMore: boolean;
    installedPluginById: ReadonlyMap<string, InstalledPluginEntry>;
    canRunActions: boolean;
    isPluginActionInFlight: (pluginId: string) => boolean;
    onAction: (request: PluginMarketplaceActionRequest) => void;
    onLoadMore: () => void;
    onNavigateToPlugin: (pluginId: string) => void;
}>) {
    const { theme } = useUnistyles();
    const [expandedListings, setExpandedListings] = React.useState<ReadonlySet<string>>(() => new Set());

    return (
        <ItemGroup title={t('settingsPlugins.discoverTitle')}>
            {props.entries.map((entry) => {
                const listingTestID = `settings.plugins.marketplace.entry.${entry.sourceId}.${entry.id}`;
                const installed = props.installedPluginById.get(entry.id) ?? null;
                // Installed results navigate to their record; lifecycle actions stay there.
                const canInstall = installed === null && entry.installable;
                const executableRealms = entry.executableRealms.map((realm) => {
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
                const reviewStatusLabel = entry.warning === 'withdrawn'
                    ? t('settingsPlugins.discover.reviewStatus.withdrawn')
                    : entry.sourceKind === 'curated' && entry.reviewStatus === 'approved'
                        ? t('settingsPlugins.discover.reviewStatus.curated')
                        : t('settingsPlugins.discover.reviewStatus.unreviewed');
                const metadata = (
                    <Text testID={`settings.plugins.marketplace.source.${entry.sourceId}.${entry.id}`}>
                        {t('settingsPlugins.discover.publisherLabel', {
                            displayName: entry.publisher.displayName,
                            id: entry.publisher.id,
                        })}
                        {entry.categories.length > 0 ? (
                            <>
                                {' · '}
                                {t('settingsPlugins.discover.categories', {
                                    values: entry.categories.join(', '),
                                })}
                            </>
                        ) : null}
                        {'\n'}
                        {(executableRealms.length > 0 || platforms.length > 0)
                            ? (
                                <>
                                    {t('settingsPlugins.discover.runtimeSummary', {
                                        realms: executableRealms.join(', ') || t('settingsPlugins.installReviewSections.none'),
                                        platforms: platforms.join(', ') || t('settingsPlugins.installReviewSections.none'),
                                    })}
                                    {' · '}
                                </>
                            )
                            : null}
                        {t('settingsPlugins.discoveredVia', { source: entry.sourceTitle })}
                    </Text>
                );
                return (
                    <React.Fragment key={`${entry.sourceId}:${entry.id}`}>
                        <Item
                            testID={listingTestID}
                            title={entry.title}
                            subtitle={entry.description}
                            subtitleLines={0}
                            subtitleAccessory={(
                                <StatusPill
                                    testID={`settings.plugins.marketplace.reviewStatus.${entry.sourceId}.${entry.id}`}
                                    chrome="plain"
                                    labelVariant="phrase"
                                    variant={entry.warning === undefined ? 'info' : 'warning'}
                                    label={reviewStatusLabel}
                                />
                            )}
                            detail={formatCatalogEntryVersion(entry.version)}
                            icon={entry.warning !== undefined
                                ? (
                                    <Icon
                                        name={entry.warning === 'withdrawn' ? 'warning' : 'shield'}
                                        size={29}
                                        color={theme.colors.state.warning.foreground}
                                    />
                                )
                                : <Icon name="stack" size={29} color={theme.colors.text.secondary} />}
                            showChevron={false}
                            mode="info"
                            rightElementOutsidePressable={canInstall || installed !== null}
                            rightElement={installed ? (
                                <ItemRowActions
                                    title={entry.title}
                                    compactActionIds={['manage']}
                                    overflowTriggerTestID={`${listingTestID}.actions.overflow`}
                                    actions={[{
                                        id: 'manage',
                                        title: t('settingsPlugins.managePlugin'),
                                        accessibilityLabel: buildActionRowAccessibilityLabel([t('settingsPlugins.managePlugin'), entry.title]),
                                        icon: 'gear',
                                        inlineTestID: `settings.plugins.marketplace.action.manage.${entry.sourceId}.${entry.id}`,
                                        onPress: () => props.onNavigateToPlugin(entry.id),
                                    }]}
                                />
                            ) : canInstall ? (
                                <ItemRowActions
                                    title={entry.title}
                                    compactActionIds={['install']}
                                    overflowTriggerTestID={`${listingTestID}.actions.overflow`}
                                    actions={[{
                                        id: 'install',
                                        title: t('settingsPlugins.installAndTrust'),
                                        // The control is an icon in a list of
                                        // near-identical rows, so its accessible
                                        // name names the listing it installs.
                                        accessibilityLabel: buildActionRowAccessibilityLabel([
                                            t('settingsPlugins.installAndTrust'),
                                            entry.title,
                                            entry.sourceTitle,
                                        ]),
                                        subtitle: t('settingsPlugins.discover.installSubtitle', { source: entry.sourceTitle }),
                                        icon: 'download',
                                        color: theme.colors.accent.blue,
                                        inlineTestID: `settings.plugins.marketplace.action.install.${entry.sourceId}.${entry.id}`,
                                        disabled: !props.canRunActions
                                            || props.isPluginActionInFlight(entry.id)
                                            || props.loading,
                                        onPress: () => props.onAction({
                                            method: 'install',
                                            pluginId: entry.id,
                                            sourceId: entry.sourceId,
                                        }),
                                    }]}
                                />
                            ) : null}
                        />
                        <ExpandableItem
                            expanded={expandedListings.has(listingTestID)}
                            onExpandedChange={(expanded) => setExpandedListings((current) => {
                                const next = new Set(current);
                                if (expanded) next.add(listingTestID);
                                else next.delete(listingTestID);
                                return next;
                            })}
                            header={({ headerProps, expanded }) => (
                                <Item
                                    {...headerProps}
                                    testID={`${listingTestID}.details`}
                                    title={t('common.details')}
                                    accessibilityLabel={buildActionRowAccessibilityLabel([t('common.details'), entry.title, entry.sourceTitle])}
                                    showChevron={false}
                                    rightElement={<Icon name={expanded ? 'caret-up' : 'caret-down'} size={20} color={theme.colors.text.secondary} />}
                                />
                            )}
                        >
                            <Item title={t('settingsPlugins.provenanceTitle')} subtitle={metadata} subtitleLines={0} mode="info" showChevron={false} />
                        </ExpandableItem>
                    </React.Fragment>
                );
            })}
            {props.canLoadMore ? (
                <Item
                    testID="settings.plugins.marketplace.loadMore"
                    title={t('settingsPlugins.discoverLoadMore')}
                    icon={<Icon name="arrow-down" size={29} color={theme.colors.text.secondary} />}
                    onPress={props.onLoadMore}
                    disabled={props.loadingMore || props.loading}
                    loading={props.loadingMore}
                    showChevron={false}
                />
            ) : null}
        </ItemGroup>
    );
}
