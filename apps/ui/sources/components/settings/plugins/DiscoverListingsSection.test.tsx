import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';
import type { PluginMarketplaceCatalogEntry } from './readPluginMarketplaceCatalog';
import type { InstalledPluginEntry } from './model/pluginMarketplaceModel';

const modal = vi.hoisted(() => ({ show: vi.fn(() => 'catalog-detail'), hide: vi.fn(), update: vi.fn() }));
installSettingsViewCommonModuleMocks({
    modal: async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock({ spies: modal }).module,
});
vi.mock('react-native-reanimated', async () => (await import('@/dev/testkit/mocks/reanimated')).createReanimatedModuleMock());

const entry: PluginMarketplaceCatalogEntry = {
    id: 'acme.plugin', sourceId: 'community', sourceKind: 'community-npm', sourceTitle: 'Community',
    reviewStatus: 'unreviewed', updatePolicy: 'pinned', publisher: { id: 'acme', displayName: 'Acme' },
    categories: ['tools'], contributions: ['tools'], links: {}, executableRealms: ['daemon'], platforms: ['linux'],
    title: 'Acme plugin', description: 'Organize your work', version: '1.0.0', packageName: '@acme/plugin',
    installable: true, registrySelectionOrigin: null, warning: 'unreviewed',
};
const installed: InstalledPluginEntry = {
    pluginId: entry.id, title: entry.title, description: entry.description, version: '1.0.0', enabled: true,
    source: { kind: 'npm', locator: entry.packageName }, install: { mode: 'copy', manifestVersion: '1.0.0' },
    compatibility: { status: 'compatible', diagnostics: [] }, diagnostics: [],
};

describe('DiscoverListingsSection', () => {
    beforeEach(() => { modal.show.mockClear(); modal.hide.mockClear(); modal.update.mockClear(); });
    afterEach(standardCleanup);

    it('keeps an open listing current and closes it when the administration target changes', async () => {
        const { DiscoverListingsSection } = await import('./PluginMarketplaceSections');
        const props = {
            entries: [entry], loading: false, loadingMore: false, canLoadMore: false,
            installedPluginById: new Map<string, InstalledPluginEntry>(), canRunActions: true,
            isPluginActionInFlight: () => false, onAction: vi.fn(), onLoadMore: () => {}, onNavigateToPlugin: vi.fn(),
            administrationTargetKey: 'server:machine-1', administrationTargetLabel: { machine: 'Machine 1', server: 'Server' },
        };
        const screen = await renderScreen(<DiscoverListingsSection {...props} />);
        await screen.pressByTestIdAsync('settings.plugins.marketplace.entry.community.acme.plugin');
        expect(modal.show).toHaveBeenCalledOnce();
        expect(props.onAction).not.toHaveBeenCalled();
        await act(async () => { screen.update(<DiscoverListingsSection {...props} loading />); });
        expect(modal.update).toHaveBeenLastCalledWith('catalog-detail', expect.objectContaining({ disabled: true }));
        await act(async () => { screen.update(<DiscoverListingsSection {...props} administrationTargetKey="server:machine-2" />); });
        expect(modal.hide).toHaveBeenCalledWith('catalog-detail');
        expect(props.onAction).not.toHaveBeenCalled();
    });

    it('keeps benefit, source and trust visible and manages installed listings without installation', async () => {
        const { DiscoverListingsSection } = await import('./PluginMarketplaceSections');
        const navigate = vi.fn();
        const action = vi.fn();
        const screen = await renderScreen(<DiscoverListingsSection administrationTargetKey="target" administrationTargetLabel={null} entries={[entry]} loading={false} loadingMore={false}
            canLoadMore={false} installedPluginById={new Map([[entry.id, installed]])} canRunActions={false}
            isPluginActionInFlight={() => false} onAction={action} onLoadMore={() => {}} onNavigateToPlugin={navigate} />);
        const rowId = 'settings.plugins.marketplace.entry.community.acme.plugin';
        expect(screen.findAllByTestId(rowId).some((node) => node.props.subtitle === entry.description)).toBe(true);
        expect(screen.findByTestId('settings.plugins.marketplace.reviewStatus.community.acme.plugin')).not.toBeNull();
        expect(screen.findByTestId('settings.plugins.marketplace.source.community.acme.plugin')).not.toBeNull();
        await screen.pressByTestIdAsync('settings.plugins.marketplace.action.manage.community.acme.plugin');
        expect(navigate).toHaveBeenCalledWith(entry.id);
        expect(action).not.toHaveBeenCalled();
    });

    it('keeps install review reachable without expanding details and blocks new withdrawn installs', async () => {
        const { DiscoverListingsSection } = await import('./PluginMarketplaceSections');
        const action = vi.fn();
        const screen = await renderScreen(<DiscoverListingsSection administrationTargetKey="target" administrationTargetLabel={null}
            entries={[entry, { ...entry, id: 'withdrawn.plugin', installable: false, warning: 'withdrawn', reviewStatus: 'withdrawn' }]}
            loading={false} loadingMore={false} canLoadMore={false} installedPluginById={new Map()} canRunActions
            isPluginActionInFlight={() => false} onAction={action} onLoadMore={() => {}} onNavigateToPlugin={() => {}} />);
        expect(screen.findByTestId('settings.plugins.marketplace.action.install.community.withdrawn.plugin')).toBeNull();
        expect(screen.findByTestId('settings.plugins.marketplace.source.community.acme.plugin')).not.toBeNull();
        await screen.pressByTestIdAsync('settings.plugins.marketplace.action.install.community.acme.plugin');
        expect(action).toHaveBeenCalledWith({ method: 'install', pluginId: entry.id, sourceId: entry.sourceId });
    });
});
