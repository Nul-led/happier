import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text, TextInput } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Typography } from '@/constants/Typography';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { Modal } from '@/modal';
import { t } from '@/text';
import type { PluginScaffoldUiMode } from '@happier-dev/protocol';
import { MachineAdministrationTargetSelector } from '@/components/settings/machines/MachineAdministrationTargetSelector';
import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';

import {
    DevelopmentPluginsSection,
    DiscoverListingsSection,
    DiscoverStatusSummary,
    InstalledPluginsSection,
    PendingPluginChangesSection,
    PluginDiagnosticsSnapshotSection,
} from './PluginMarketplaceSections';
import { PluginMachineMatrixSection } from './machines/PluginMachineMatrixSection';
import { buildPluginDetailRoute } from './model/pluginDetailRoute';
import { createPluginSettingsViews } from './model/pluginMarketplaceModel';
import { usePluginSettingsScreenState } from './model/usePluginSettingsScreenState';
import { PluginAccountDataEraseRecoverySection } from './PluginAccountDataEraseRecoverySection';
import { PluginReadOnlySnapshotNotice } from './PluginReadOnlySnapshotNotice';
import { NativeAppPluginPanelsSettingsEntry } from './NativeAppPluginPanelsSettingsEntry';
import { PluginAppPagesSettingsEntry } from './PluginAppPagesSettingsEntry';
import { Icon } from '@/components/ui/icons/Icon';

const stylesheet = StyleSheet.create((theme) => ({
    viewSelector: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    inputBlock: {
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 12,
    },
    label: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: 14,
        marginBottom: 8,
    },
    input: {
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.text.primary,
        borderRadius: 12,
        borderWidth: 1,
        minHeight: 44,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 12,
    },
    sourceFilter: {
        marginBottom: 12,
    },
}));

/**
 * The aggregate All segment. It is a presentation id for "no source filter",
 * which the state owner models as `null`; it is deliberately not a source id so
 * it can never collide with one the machine actually has configured.
 */
const DISCOVER_ALL_SOURCES_TAB_ID = 'all';

/** Associates the visible Discover search label with its input on the web. */
const DISCOVER_SEARCH_LABEL_ID = 'settings-plugins-discover-search-label';

export const PluginSettingsHomeScreen = React.memo(function PluginSettingsHomeScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const minimumInteractiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
    const state = usePluginSettingsScreenState();
    // The webhook administration screen and its account API are both behind the
    // server's public-webhook feature, so the entry only exists where it leads
    // somewhere the server will answer.
    const webhooksAvailable = useFeatureEnabled('plugins.webhooks');
    // Names the source a running search is narrowed to, so the pane's single
    // status line can say what is being searched instead of a generic spinner.
    const selectedDiscoverSourceTitle = state.selectedDiscoverSourceId === null
        ? null
        : state.discoverSources.find((source) => source.id === state.selectedDiscoverSourceId)?.title ?? null;
    const views = createPluginSettingsViews((key) => t(key));
    const createDevelopmentPlugin = React.useCallback(async () => {
        if (!state.daemonOperationsAvailable || !state.developmentCreateAvailable) return;
        const targetDir = (await Modal.prompt(
            t('settingsPlugins.developmentCreateDirectoryTitle'),
            t('settingsPlugins.developmentCreateDirectoryBody'),
            { confirmText: t('common.next'), cancelText: t('common.cancel') },
        ))?.trim();
        if (!targetDir) return;
        const displayName = (await Modal.prompt(
            t('settingsPlugins.developmentCreateNameTitle'),
            t('settingsPlugins.developmentCreateNameBody'),
            { confirmText: t('common.next'), cancelText: t('common.cancel') },
        ))?.trim();
        if (!displayName) return;
        const pluginId = (await Modal.prompt(
            t('settingsPlugins.developmentCreateIdTitle'),
            t('settingsPlugins.developmentCreateIdBody'),
            { placeholder: 'com.example.my-plugin', confirmText: t('common.next'), cancelText: t('common.cancel') },
        ))?.trim();
        if (!pluginId) return;
        // The scaffold's UI mode is part of what the author is creating, so the
        // in-app lifecycle asks for it. Without this step every plugin created
        // from the app is a non-UI plugin and no later in-app step can add a
        // surface to it.
        let ui: PluginScaffoldUiMode | undefined;
        let uiChosen = false;
        await Modal.alertAsync(
            t('settingsPlugins.developmentCreateSurfaceTitle'),
            t('settingsPlugins.developmentCreateSurfaceBody'),
            [
                {
                    text: t('settingsPlugins.developmentCreateSurfaceReactNative'),
                    onPress: () => { ui = 'reactNative'; uiChosen = true; },
                },
                {
                    text: t('settingsPlugins.developmentCreateSurfaceHostedWeb'),
                    onPress: () => { ui = 'hostedWeb'; uiChosen = true; },
                },
                {
                    text: t('settingsPlugins.developmentCreateSurfaceNone'),
                    onPress: () => { ui = undefined; uiChosen = true; },
                },
            ],
        );
        if (!uiChosen) return;
        const confirmed = await Modal.confirm(
            t('settingsPlugins.developmentCreateConfirmTitle'),
            t('settingsPlugins.developmentCreateConfirmBody', { pluginId, targetDir }),
            { confirmText: t('settingsPlugins.developmentCreate'), cancelText: t('common.cancel') },
        );
        if (!confirmed) return;
        state.runDevelopmentCreate({ targetDir, displayName, pluginId, ...(ui ? { ui } : {}) });
    }, [state]);
    // Adopting an existing folder is the step that turns a created (or cloned)
    // plugin project into a running development source. The path the user types
    // here is the exact thing the daemon will be asked to trust, so it is echoed
    // back verbatim in the trust decision rather than being summarised.
    const developPluginSourceRoot = React.useCallback(async () => {
        if (!state.daemonOperationsAvailable || !state.developmentSourceInstallAvailable) return;
        const sourceRootPath = (await Modal.prompt(
            t('settingsPlugins.developmentSourceInstallTitle'),
            t('settingsPlugins.developmentSourceInstallBody'),
            { confirmText: t('common.continue'), cancelText: t('common.cancel') },
        ))?.trim();
        if (!sourceRootPath) return;
        state.runDevelopmentSourceInstall(sourceRootPath);
    }, [state]);

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {state.readOnlySnapshotNotice ? (
                <PluginReadOnlySnapshotNotice
                    testID="settings.plugins.marketplace.readOnlySnapshot"
                    reason={state.readOnlySnapshotNotice.reason}
                    onRetry={state.refreshPluginTruth}
                />
            ) : null}

            {/*
              * Before everything it governs: every consequential action on this
              * screen — including the approve/reject decisions below — routes
              * to the exact server and machine disclosed here, so the target
              * is the first fact the reader establishes.
              */}
            <MachineAdministrationTargetSelector
                selection={state.administrationTargetSelection}
                testIDPrefix="settings.plugins.administration.target"
            />

            {/*
              * Directly under the target it acts on: a change waiting on this
              * user is attention, not one tab's content, and a change an Agent
              * prepared has no other route into the app at all. Its review and
              * reject flows name the same exact machine and server disclosed
              * above.
              */}
            <PendingPluginChangesSection
                pendingChanges={state.pendingPluginChanges}
                canRunActions={state.daemonOperationsAvailable}
                isPluginActionInFlight={state.isPluginActionInFlight}
                onDecide={state.decidePendingPluginChange}
            />

            <PluginAccountDataEraseRecoverySection
                testID="settings.plugins.accountDataErase"
            />

            {webhooksAvailable ? (
                <ItemGroup>
                    <Item
                        testID="settings.plugins.webhooks"
                        title={t('settingsPlugins.webhookAdministration.title')}
                        subtitle={t('settingsPlugins.webhookAdministration.footer')}
                        icon={<Icon name="link" size={29} color={theme.colors.accent.indigo} />}
                        onPress={() => router.push(SETTINGS_ROUTES.pluginWebhooks)}
                    />
                </ItemGroup>
            ) : null}

            <ItemGroup>
                <Item
                    testID="settings.plugins.sources"
                    title={t('settingsPlugins.sourceAdministration.title')}
                    subtitle={t('settingsPlugins.sourceAdministration.subtitle')}
                    icon={<Icon name="globe" size={29} color={theme.colors.accent.indigo} />}
                    onPress={() => router.push(SETTINGS_ROUTES.pluginSources)}
                />
            </ItemGroup>

            <NativeAppPluginPanelsSettingsEntry />

            <PluginAppPagesSettingsEntry />

            <View style={styles.viewSelector}>
                <ScrollView
                    testID="settings.plugins.management.viewScroller"
                    horizontal
                    showsHorizontalScrollIndicator={false}
                >
                    <SegmentedTabBar
                        tabs={views}
                        activeTabId={state.activeView}
                        onSelectTab={state.setActiveView}
                        testIDPrefix="settings.plugins.management.view"
                        accessibilityLabel={t('settingsPlugins.viewSelectorLabel')}
                        segmentSizing="content"
                        // The bar owns a horizontal scroller of its own, so the
                        // platform floor costs a wider track rather than an
                        // overflowing row or an overlapped neighbour.
                        targetSize="platform"
                    />
                </ScrollView>
            </View>

            {state.activeView === 'installed' ? (
                <>
                    <InstalledPluginsSection
                        installedPlugins={state.installedPlugins}
                        canRunActions={state.canRefreshInstalledPlugins}
                        isPluginActionInFlight={state.isPluginActionInFlight}
                        onNavigateToPlugin={(pluginId) => router.push(buildPluginDetailRoute(pluginId))}
                        onRunAction={state.runInstalledPluginAction}
                    />
                    {/*
                      * The list above is the selected machine's truth. This
                      * matrix is the Account-wide one: where the plugin is
                      * installed, and where it is missing or broken, without
                      * walking each machine's settings screen. It is read-only
                      * on purpose — every action still targets the machine
                      * selected above.
                      */}
                    <PluginMachineMatrixSection />
                </>
            ) : null}

            {state.activeView === 'discover' ? (
                <>
                    <ItemGroup title={t('settingsPlugins.discoverTitle')} footer={t('settingsPlugins.subtitle')}>
                        <View style={styles.inputBlock}>
                            <Text style={styles.label} nativeID={DISCOVER_SEARCH_LABEL_ID}>
                                {t('settingsPlugins.discoverSearchLabel')}
                            </Text>
                            <TextInput
                                testID="settings.plugins.marketplace.search"
                                value={state.discoverSearchText}
                                accessibilityLabel={t('settingsPlugins.discoverSearchLabel')}
                                aria-labelledby={DISCOVER_SEARCH_LABEL_ID}
                                editable={state.daemonOperationsAvailable}
                                onChangeText={state.daemonOperationsAvailable
                                    ? state.setDiscoverSearchText
                                    : undefined}
                                placeholder={t('settingsPlugins.discoverSearchPlaceholder')}
                                placeholderTextColor={theme.colors.input.placeholder}
                                style={[styles.input, { minHeight: minimumInteractiveTargetSize }]}
                                autoCapitalize="none"
                                autoCorrect={false}
                                returnKeyType="search"
                                onSubmitEditing={state.canRefreshDiscover
                                    ? state.refreshDiscover
                                    : undefined}
                            />
                        </View>
                        <Item
                            testID="settings.plugins.marketplace.refreshDiscover"
                            title={t('settingsPlugins.discoverSearch')}
                            subtitle={state.discoverStale
                                ? t('settingsPlugins.discover.status.stale')
                                : undefined}
                            subtitleLines={0}
                            icon={<Icon name="magnifying-glass" size={29} color={theme.colors.accent.blue} />}
                            onPress={state.refreshDiscover}
                            disabled={!state.canRefreshDiscover}
                            loading={state.loadingDiscover}
                            showChevron={false}
                        />
                        {/*
                          * The source filter uses the same segmented control as
                          * the view selector above rather than a second chip
                          * language: All is one aggregate query over every
                          * enabled source, and a segment narrows that same query
                          * before acquisition. It is never a second index.
                          */}
                        <View style={styles.sourceFilter}>
                            <ScrollView
                                testID="settings.plugins.marketplace.sourceFilterScroller"
                                horizontal
                                showsHorizontalScrollIndicator={false}
                            >
                                <SegmentedTabBar
                                    tabs={[
                                        { id: DISCOVER_ALL_SOURCES_TAB_ID, label: t('settingsPlugins.discoverSourceAll') },
                                        ...state.discoverSources.map((source) => ({
                                            id: source.id,
                                            label: source.title,
                                        })),
                                    ]}
                                    activeTabId={state.selectedDiscoverSourceId ?? DISCOVER_ALL_SOURCES_TAB_ID}
                                    onSelectTab={(tabId) => state.setSelectedDiscoverSourceId(
                                        tabId === DISCOVER_ALL_SOURCES_TAB_ID ? null : tabId,
                                    )}
                                    testIDPrefix="settings.plugins.marketplace.sourceFilter"
                                    accessibilityLabel={t('settingsPlugins.discoverSourceFilterLabel')}
                                    segmentSizing="content"
                                    targetSize="platform"
                                />
                            </ScrollView>
                        </View>
                    </ItemGroup>

                    {/*
                      * One status region for the whole pane. Results, source
                      * health, index diagnostics and listings this machine
                      * cannot install are all facts about the same search, so
                      * they are announced once, together, in that order.
                      */}
                    <DiscoverStatusSummary
                        loading={state.loadingDiscover}
                        error={state.discoverError}
                        stale={state.discoverStale}
                        entryCount={state.discoverEntries.length}
                        sourceStatuses={state.discoverSourceStatuses}
                        diagnostics={state.discoverDiagnostics}
                        nonInstallable={state.discoverNonInstallable}
                        selectedSourceTitle={selectedDiscoverSourceTitle}
                    />

                    <DiscoverListingsSection
                        entries={state.discoverEntries}
                        loading={state.loadingDiscover}
                        loadingMore={state.loadingMoreDiscover}
                        canLoadMore={state.discoverNextCursor !== null}
                        installedPluginById={state.installedPluginById}
                        canRunActions={state.canRunDiscoverActions}
                        isPluginActionInFlight={state.isPluginActionInFlight}
                        onAction={state.runCatalogAction}
                        onLoadMore={state.loadMoreDiscover}
                    />
                </>
            ) : null}

            {state.activeView === 'development' ? (
                <DevelopmentPluginsSection
                    developmentPlugins={state.developmentPlugins}
                    createAvailable={state.developmentCreateAvailable}
                    sourceInstallAvailable={state.developmentSourceInstallAvailable}
                    canRunActions={state.daemonOperationsAvailable}
                    isPluginActionInFlight={state.isPluginActionInFlight}
                    onCreate={() => {
                        void createDevelopmentPlugin();
                    }}
                    onDevelopSourceRoot={() => {
                        void developPluginSourceRoot();
                    }}
                    onRunAction={state.runDevelopmentAction}
                />
            ) : null}

            {state.activeView === 'diagnostics' ? (
                <PluginDiagnosticsSnapshotSection diagnostics={state.currentDiagnostics} />
            ) : null}
        </ItemList>
    );
});

export default PluginSettingsHomeScreen;
