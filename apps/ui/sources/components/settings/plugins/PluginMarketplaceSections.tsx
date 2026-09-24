import * as React from 'react';
import { Platform, View } from 'react-native';
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
import { CardGrid, CardGridColumn } from '@/components/ui/cards/CardGrid';
import { SurfaceCard } from '@/components/ui/cards/SurfaceCard';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { useLayoutMaxWidthStyle } from '@/components/ui/layout/layout';
import { ITEM_GROUP_COLUMN_MIN_WIDTH_PX } from '@/components/ui/lists/itemGroupColumnLayout';
import { ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { resolveItemGroupContentHorizontalInsetPx } from '@/components/ui/lists/itemGroupSpacing';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { catalogReviewStatusLabel, usePluginCatalogDetails } from './PluginCatalogDetailsDialog';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';

import { PluginDiagnosticsSection } from './diagnostics/PluginDiagnosticsSection';
import type {
    PluginMarketplaceCatalogEntry,
    PluginMarketplaceDiscoverDiagnostic,
    PluginMarketplaceDiscoverSourceStatus,
    PluginMarketplaceNonInstallableListing,
} from './readPluginMarketplaceCatalog';
import { Icon } from '@/components/ui/icons/Icon';
import type { InstalledPluginActionId, PluginRoutineOperationSettlement } from './model/usePluginSettingsScreenState';
import {
    formatCatalogEntryVersion,
    formatPendingPluginChangeSubtitle,
    formatPendingPluginChangeTitle,
    projectDevelopmentPluginPresentation,
    projectInstalledPluginLifecycleCapabilities,
    projectInstalledPluginPresentation,
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
                const presentation = projectInstalledPluginPresentation(entry);
                return (
                    <Item
                        key={entry.pluginId}
                        testID={`settings.plugins.marketplace.installed.${entry.pluginId}`}
                        title={entry.title}
                        subtitle={[entry.description, presentation.attentionLabel].filter(Boolean).join('\n') || undefined}
                        subtitleLines={0}
                        subtitleAccessory={(
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                                <Text style={{ ...ITEM_SUBTITLE_TEXT_METRICS.comfortable, color: theme.colors.text.secondary }}>{presentation.sourceLabel}</Text>
                                <StatusPill
                                    testID={`settings.plugins.marketplace.installed.${entry.pluginId}.status`}
                                    chrome="plain"
                                    labelVariant="phrase"
                                    variant={presentation.status.variant}
                                    label={presentation.status.label}
                                />
                            </View>
                        )}
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
                    detail={t('settingsPlugins.catalog.browse')}
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

export function PluginRoutineOperationSettlementRow(props: Readonly<{
    settlement: PluginRoutineOperationSettlement | null;
    scope: PluginRoutineOperationSettlement['scope'];
}>) {
    const { theme } = useUnistyles();
    if (props.settlement?.scope !== props.scope) return null;
    return (
        <View
            testID={`settings.plugins.${props.scope}.operationSettlement`}
            accessibilityLiveRegion="polite"
            aria-live="polite"
        >
            <Item
                testID={`settings.plugins.${props.scope}.operationSettlement.row`}
                title={props.settlement.message}
                subtitle={props.settlement.detail}
                subtitleLines={0}
                icon={<Icon name="check-circle" size={29} color={theme.colors.state.success.foreground} />}
                showChevron={false}
                mode="info"
            />
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
    /**
     * The selected machine's home directory, so a development root reads
     * `~/projects/...` exactly like an ordinary Session working directory.
     * Absent home simply shows the canonical absolute root.
     */
    machineHomeDir?: string;
    createdPlugin: Readonly<{ pluginId: string; sourceRootPath: string }> | null;
    operationSettlement: PluginRoutineOperationSettlement | null;
    isPluginActionInFlight: (pluginId: string) => boolean;
    onCreate: () => void;
    onCreateWithAgent: () => void;
    onStartCreatedDevelopment: (sourceRootPath: string) => void;
    onCreateWithAgentFromCreated: (created: Readonly<{ pluginId: string; sourceRootPath: string }>) => void;
    onDevelopSourceRoot: () => void;
    onEditWithAgent: (pluginId: string) => void;
    onRunAction: (action: 'test' | 'pack' | 'unregister', pluginId: string) => void;
}>) {
    const { theme } = useUnistyles();
    const createdPlugin = props.createdPlugin;
    return (
        <ItemGroup title={t('settingsPlugins.developmentTitle')} footer={t('settingsPlugins.developmentFooter')}>
            {createdPlugin ? (
                <View
                    testID="settings.plugins.management.development.createSettlement"
                    accessibilityLiveRegion="polite"
                    aria-live="polite"
                >
                    <Item
                        testID="settings.plugins.management.development.createSettlement.row"
                        title={t('settingsPlugins.developmentCreateSucceeded')}
                        subtitle={formatPathRelativeToHome(createdPlugin.sourceRootPath, props.machineHomeDir)}
                        subtitleLines={0}
                        detail={createdPlugin.pluginId}
                        icon={<Icon name="check-circle" size={29} color={theme.colors.state.success.foreground} />}
                        showChevron={false}
                        mode="info"
                        rightElementOutsidePressable
                        rightElement={(
                            <ItemRowActions
                                title={createdPlugin.pluginId}
                                compactActionIds={['startDevelopment', 'createWithAgent']}
                                overflowTriggerTestID="settings.plugins.management.development.createSettlement.actions.overflow"
                                actions={[
                                    {
                                        id: 'startDevelopment',
                                        title: t('settingsPlugins.developmentSourceInstall'),
                                        icon: 'play',
                                        inlineTestID: 'settings.plugins.management.development.createSettlement.action.startDevelopment',
                                        disabled: !props.canRunActions || !props.sourceInstallAvailable,
                                        onPress: () => props.onStartCreatedDevelopment(createdPlugin.sourceRootPath),
                                    },
                                    {
                                        id: 'createWithAgent',
                                        title: t('settingsPlugins.developmentCreateWithAgent'),
                                        icon: 'magic-wand',
                                        inlineTestID: 'settings.plugins.management.development.createSettlement.action.createWithAgent',
                                        disabled: !props.canRunActions,
                                        onPress: () => props.onCreateWithAgentFromCreated(createdPlugin),
                                    },
                                ]}
                            />
                        )}
                    />
                </View>
            ) : null}
            <PluginRoutineOperationSettlementRow
                settlement={props.operationSettlement}
                scope="development"
            />
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
            {/*
              * One plugin is one row. Edit with Agent, Test and Pack all act on
              * the same development source, so they are that row's actions
              * rather than three more rows a reader — and assistive technology —
              * has to traverse and reassemble per plugin.
              */}
            {props.developmentPlugins.length > 0 ? props.developmentPlugins.map((entry) => {
                const pluginId = entry.installed.pluginId;
                const presentation = projectDevelopmentPluginPresentation(entry, props.machineHomeDir);
                const busy = props.isPluginActionInFlight(pluginId);
                return (
                    <Item
                        key={pluginId}
                        testID={`settings.plugins.management.development.${pluginId}`}
                        title={entry.installed.title}
                        subtitle={(
                            <Text
                                testID={`settings.plugins.management.development.${pluginId}.details`}
                                selectable
                            >
                                {presentation.sourcePathLabel}
                                {presentation.attentionLabel === null ? null : `\n${presentation.attentionLabel}`}
                            </Text>
                        )}
                        subtitleLines={0}
                        subtitleAccessory={(
                            <StatusPill
                                testID={`settings.plugins.management.development.${pluginId}.status`}
                                chrome="plain"
                                labelVariant="phrase"
                                variant={presentation.status.variant}
                                label={presentation.status.label}
                            />
                        )}
                        detail={entry.installed.version}
                        icon={<Icon name="code" size={29} color={theme.colors.text.secondary} />}
                        showChevron={false}
                        mode="info"
                        rightElementOutsidePressable
                        rightElement={(
                            <ItemRowActions
                                title={entry.installed.title}
                                compactActionIds={['editWithAgent']}
                                overflowTriggerTestID={`settings.plugins.management.development.${pluginId}.actions.overflow`}
                                actions={[
                                    {
                                        id: 'editWithAgent',
                                        title: t('settingsPlugins.developmentEditWithAgent'),
                                        accessibilityLabel: buildActionRowAccessibilityLabel([
                                            t('settingsPlugins.developmentEditWithAgent'),
                                            entry.installed.title,
                                        ]),
                                        subtitle: t('settingsPlugins.developmentEditWithAgentSubtitle'),
                                        icon: 'sparkle',
                                        inlineTestID: `settings.plugins.management.development.${pluginId}.action.editWithAgent`,
                                        disabled: !props.canRunActions,
                                        onPress: () => props.onEditWithAgent(pluginId),
                                    },
                                    {
                                        id: 'test',
                                        title: t('settingsPlugins.developmentTest'),
                                        subtitle: t('settingsPlugins.developmentTestSubtitle'),
                                        icon: 'checks',
                                        inlineTestID: `settings.plugins.management.development.${pluginId}.action.test`,
                                        disabled: !props.canRunActions || !entry.actions.test || busy,
                                        onPress: () => props.onRunAction('test', pluginId),
                                    },
                                    {
                                        id: 'pack',
                                        title: t('settingsPlugins.developmentPack'),
                                        subtitle: t('settingsPlugins.developmentPackSubtitle'),
                                        icon: 'cube',
                                        inlineTestID: `settings.plugins.management.development.${pluginId}.action.pack`,
                                        disabled: !props.canRunActions || !entry.actions.pack || busy,
                                        onPress: () => props.onRunAction('pack', pluginId),
                                    },
                                    ...(entry.actions.unregister ? [{
                                        id: 'unregister',
                                        title: t('common.remove'),
                                        subtitle: entry.sourceRootPath,
                                        icon: 'trash' as const,
                                        destructive: true,
                                        inlineTestID: `settings.plugins.management.development.${pluginId}.action.unregister`,
                                        disabled: !props.canRunActions || busy,
                                        onPress: () => props.onRunAction('unregister', pluginId),
                                    }] : []),
                                ]}
                            />
                        )}
                    />
                );
            }) : (
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

/** Source and trust belong to each result; the full trust decision stays in the install review. */
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
    administrationTargetKey: string;
    administrationTargetLabel: Readonly<{ machine: string; server: string }> | null;
}>) {
    const { theme } = useUnistyles();
    const maxWidthStyle = useLayoutMaxWidthStyle();
    const openDetails = usePluginCatalogDetails(props);
    return (
        <View style={[{ width: '100%', alignSelf: 'center', paddingHorizontal: resolveItemGroupContentHorizontalInsetPx(), paddingBottom: 16 }, maxWidthStyle]}>
            <CardGrid columns={2} minColumnWidthPx={ITEM_GROUP_COLUMN_MIN_WIDTH_PX}>
                {props.entries.map((entry) => {
                    const installed = props.installedPluginById.has(entry.id);
                    const action = installed ? 'manage' : 'install';
                    return (
                        <CardGridColumn key={`${entry.sourceId}:${entry.id}`}>
                            <SurfaceCard padding="none" style={{ flex: 1, overflow: 'hidden' }}>
                                <Item
                                    testID={`settings.plugins.marketplace.entry.${entry.sourceId}.${entry.id}`}
                                    title={entry.title}
                                    titleLines={2}
                                    subtitle={entry.description}
                                    subtitleLines={3}
                                    icon={<Icon name="stack" size={29} color={theme.colors.text.secondary} />}
                                    onPress={() => openDetails(entry)}
                                    accessibilityLabel={buildActionRowAccessibilityLabel([entry.title, t('common.details'), entry.sourceTitle])}
                                    showChevron={false}
                                    showDivider={false}
                                />
                                <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12, flex: 1 }}>
                                    <Text testID={`settings.plugins.marketplace.source.${entry.sourceId}.${entry.id}`}
                                        style={{ ...ITEM_SUBTITLE_TEXT_METRICS.comfortable, color: theme.colors.text.secondary }}>
                                        {t('settingsPlugins.catalog.byPublisher', { publisher: entry.publisher.displayName })}
                                        {' · '}{entry.sourceTitle}
                                    </Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                                        <StatusPill testID={`settings.plugins.marketplace.reviewStatus.${entry.sourceId}.${entry.id}`}
                                            chrome="plain" labelVariant="phrase"
                                            variant={entry.warning === undefined ? 'info' : 'warning'} label={catalogReviewStatusLabel(entry)} />
                                        <Text style={{ ...ITEM_SUBTITLE_TEXT_METRICS.comfortable, color: theme.colors.text.secondary }}>
                                            {formatCatalogEntryVersion(entry.version)}
                                        </Text>
                                    </View>
                                    {!installed && entry.registrySelectionOrigin !== null ? (
                                        <Text testID={`settings.plugins.marketplace.registrySelection.${entry.sourceId}.${entry.id}`}
                                            style={{ ...ITEM_SUBTITLE_TEXT_METRICS.comfortable, color: theme.colors.text.secondary }}>
                                            {t('settingsPlugins.discover.registrySelectionRequired', { origin: entry.registrySelectionOrigin })}
                                        </Text>
                                    ) : null}
                                    {installed || entry.installable ? (
                                        <View style={{ marginTop: 'auto', alignItems: 'flex-start' }}>
                                            <RoundButton size="small" titleNumberOfLines="complete"
                                                display="inverted"
                                                style={{ minHeight: resolveMinimumInteractiveTargetSize(Platform.OS) }}
                                                testID={`settings.plugins.marketplace.action.${action}.${entry.sourceId}.${entry.id}`}
                                                title={installed ? t('settingsPlugins.managePlugin') : t('settingsPlugins.installAndTrust')}
                                                accessibilityLabel={buildActionRowAccessibilityLabel([
                                                    installed ? t('settingsPlugins.managePlugin') : t('settingsPlugins.installAndTrust'),
                                                    entry.title, entry.sourceTitle,
                                                ])}
                                                accessibilityHint={installed ? undefined : t('settingsPlugins.discover.installSubtitle', { source: entry.sourceTitle })}
                                                disabled={!installed && (!props.canRunActions || props.isPluginActionInFlight(entry.id) || props.loading)}
                                                onPress={() => installed ? props.onNavigateToPlugin(entry.id) : props.onAction({
                                                    method: 'install', pluginId: entry.id, sourceId: entry.sourceId,
                                                })}
                                            />
                                        </View>
                                    ) : null}
                                </View>
                            </SurfaceCard>
                        </CardGridColumn>
                    );
                })}
            </CardGrid>
            {props.canLoadMore ? (
                <View style={{ alignItems: 'center', paddingTop: 16 }}>
                    <RoundButton testID="settings.plugins.marketplace.loadMore" size="normal" display="inverted"
                        title={t('settingsPlugins.discoverLoadMore')} onPress={props.onLoadMore}
                        disabled={props.loadingMore || props.loading} loading={props.loadingMore} />
                </View>
            ) : null}
        </View>
    );
}
