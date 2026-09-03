import * as React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { flattenTestStyle, renderSettingsView, standardCleanup } from '@/dev/testkit';

const mocks = vi.hoisted(() => ({
    activeView: 'installed' as 'installed' | 'discover',
}));

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock({
    View: 'View',
    Text: 'Text',
    TextInput: 'TextInput',
    ScrollView: 'ScrollView',
    Pressable: React.forwardRef((props: Readonly<Record<string, unknown>>, ref: unknown) => (
        React.createElement('Pressable', { ...props, ref }, (props as { children?: React.ReactNode }).children)
    )),
}));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => false }));
// This lane owns the segmented controls' interactive targets, not the daemon
// administration environment beneath the screen's state facade, so the facade is
// replaced whole while the real SegmentedTabBar keeps rendering its own sizing.
vi.mock('./model/usePluginSettingsScreenState', () => ({
    usePluginSettingsScreenState: () => ({
        activeView: mocks.activeView,
        setActiveView: () => {},
        readOnlySnapshotNotice: null,
        pendingPluginChanges: [],
        daemonOperationsAvailable: true,
        isPluginActionInFlight: () => false,
        decidePendingPluginChange: () => {},
        administrationTargetSelection: { selectedTarget: null, canExecute: false, resolveExecutionTarget: () => null },
        installedPlugins: [],
        installedPluginById: new Map(),
        canRefreshInstalledPlugins: true,
        runInstalledPluginAction: () => {},
        discoverSources: [
            { id: 'marketplace:user', title: 'My source', kind: 'user' },
            { id: 'community-npm', title: 'Community npm', kind: 'community-npm' },
        ],
        selectedDiscoverSourceId: null,
        setSelectedDiscoverSourceId: () => {},
        discoverSearchText: '',
        setDiscoverSearchText: () => {},
        refreshDiscover: () => {},
        canRefreshDiscover: true,
        loadingDiscover: false,
        loadingMoreDiscover: false,
        discoverEntries: [],
        discoverError: null,
        discoverStale: false,
        discoverSourceStatuses: [],
        discoverDiagnostics: [],
        discoverNonInstallable: [],
        discoverNextCursor: null,
        loadMoreDiscover: () => {},
        runCatalogAction: () => {},
        canRunDiscoverActions: true,
        developmentPlugins: [],
        developmentCreateAvailable: false,
        developmentSourceInstallAvailable: false,
        runDevelopmentAction: () => {},
        runDevelopmentCreate: () => {},
        runDevelopmentSourceInstall: () => {},
        currentDiagnostics: [],
        refreshPluginTruth: () => {},
    }),
}));
vi.mock('@/components/settings/machines/MachineAdministrationTargetSelector', async () => ({
    MachineAdministrationTargetSelector: (await import('@/dev/testkit/mocks/components')).createPassThroughComponent('MachineAdministrationTargetSelector'),
}));
vi.mock('./machines/PluginMachineMatrixSection', async () => ({
    PluginMachineMatrixSection: (await import('@/dev/testkit/mocks/components')).createPassThroughComponent('PluginMachineMatrixSection'),
}));
vi.mock('./PluginAccountDataEraseRecoverySection', async () => ({
    PluginAccountDataEraseRecoverySection: (await import('@/dev/testkit/mocks/components')).createPassThroughComponent('PluginAccountDataEraseRecoverySection'),
}));
vi.mock('./NativeAppPluginPanelsSettingsEntry', async () => ({
    NativeAppPluginPanelsSettingsEntry: (await import('@/dev/testkit/mocks/components')).createPassThroughComponent('NativeAppPluginPanelsSettingsEntry'),
}));
vi.mock('./PluginAppPagesSettingsEntry', async () => ({
    PluginAppPagesSettingsEntry: (await import('@/dev/testkit/mocks/components')).createPassThroughComponent('PluginAppPagesSettingsEntry'),
}));
vi.mock('./PluginMarketplaceSections', async () => {
    const { createPassThroughComponent } = await import('@/dev/testkit/mocks/components');
    return {
        DevelopmentPluginsSection: createPassThroughComponent('DevelopmentPluginsSection'),
        DiscoverListingsSection: createPassThroughComponent('DiscoverListingsSection'),
        DiscoverStatusSummary: createPassThroughComponent('DiscoverStatusSummary'),
        InstalledPluginsSection: createPassThroughComponent('InstalledPluginsSection'),
        PendingPluginChangesSection: createPassThroughComponent('PendingPluginChangesSection'),
        PluginDiagnosticsSnapshotSection: createPassThroughComponent('PluginDiagnosticsSnapshotSection'),
    };
});
vi.mock('@/components/ui/lists/Item', async () => ({
    Item: (await import('@/dev/testkit/mocks/components')).createPassThroughComponent('Item'),
}));
vi.mock('@/components/ui/lists/ItemGroup', async () => ({
    ItemGroup: (await import('@/dev/testkit/mocks/components')).createPassThroughComponent('ItemGroup'),
}));
vi.mock('@/components/ui/lists/ItemList', async () => ({
    ItemList: (await import('@/dev/testkit/mocks/components')).createPassThroughComponent('ItemList'),
}));

import { PluginSettingsHomeScreen } from './PluginSettingsHomeScreen';

/**
 * Both plugin-management segmented bars sit inside their own horizontal
 * scroller, so the consumer genuinely owns the room the platform floor asks
 * for. A control the reader taps to change what the whole screen shows must
 * meet 44pt/48dp rather than the dense flush-row 24px WCAG floor.
 */
async function readSegmentMinimumWidths(testID: string): Promise<readonly string[]> {
    const { Platform } = await import('react-native');
    const previousPlatform = Platform.OS;
    const observed: string[] = [];
    try {
        for (const platform of ['ios', 'android'] as const) {
            (Platform as { OS: string }).OS = platform;
            const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
            observed.push(`${platform}: ${flattenTestStyle(screen.findByTestId(testID)?.props.style).minWidth}`);
        }
    } finally {
        (Platform as { OS: string }).OS = previousPlatform;
    }
    return observed;
}

describe('PluginSettingsHomeScreen segmented controls', () => {
    beforeEach(() => {
        mocks.activeView = 'installed';
    });

    afterEach(() => {
        standardCleanup();
    });

    it('meets the platform interactive target on the management view selector', async () => {
        expect(await readSegmentMinimumWidths('settings.plugins.management.view:installed'))
            .toEqual(['ios: 44', 'android: 48']);
    });

    it('meets the platform interactive target on the Discover source filter', async () => {
        mocks.activeView = 'discover';
        expect(await readSegmentMinimumWidths('settings.plugins.marketplace.sourceFilter:all'))
            .toEqual(['ios: 44', 'android: 48']);
    });

    it('discloses the administration target above the pending decision controls', async () => {
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        // An approve/reject is a consequential machine-scoped operation, so the
        // exact target it would land on is disclosed above the decision rows —
        // the screen reads target first, decision second, in traversal order.
        const ordered = screen
            .findAll((node) => node.type === 'MachineAdministrationTargetSelector'
                || node.type === 'PendingPluginChangesSection')
            .map((node) => String(node.type));
        expect(ordered).toEqual(['MachineAdministrationTargetSelector', 'PendingPluginChangesSection']);
    });
});
