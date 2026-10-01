import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';

vi.mock('@react-navigation/native', async () => (await import('@/dev/testkit/mocks/reactNavigation')).createReactNavigationNativeMock());
vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

const route = vi.hoisted(() => ({ pathname: '/plugins', params: {} as Record<string, string>, replace: vi.fn(), setParams: vi.fn() }));
vi.mock('expo-router', () => ({
    useRouter: () => ({ replace: route.replace, push: vi.fn(), setParams: route.setParams }),
    usePathname: () => route.pathname,
    useGlobalSearchParams: () => route.params,
}));

// The administered machine (the machine-selection owner) and its daemon reads are the boundaries.
const machine = vi.hoisted(() => ({ id: 'machine-1', serverId: 'server-1' }));
vi.mock('@/sync/domains/machines/administration/scopedPluginSettingsTarget', () => ({
    useScopedPluginSettingsDaemonTargetBinding: () => ({
        executionTarget: { machine: { id: machine.id, daemonStateVersion: 3 }, serverId: machine.serverId },
        selection: {
            selectedTarget: { serverIdentityId: 'identity-1', machineId: machine.id },
            candidates: [{ target: { serverIdentityId: 'identity-1', machineId: machine.id }, displayName: 'MacBook Pro', serverLabel: 'Home' }],
        },
    }),
}));
const installedPlugins = vi.hoisted(() => ({
    value: [
        { pluginId: 'happier.codex', title: 'Codex', description: null, version: '1', enabled: true, source: { kind: 'bundled', locator: 'x' } },
        { pluginId: 'happier.claude', title: 'Claude', description: null, version: '1', enabled: true, source: { kind: 'bundled', locator: 'x' } },
        { pluginId: 'acme.notes', title: 'Notes', description: null, version: '1', enabled: false, source: { kind: 'npm', locator: 'y' } },
    ],
}));
vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({
    useMachineCapabilitiesCache: () => ({
        state: {
            status: 'loaded',
            snapshot: { response: { results: { 'tool.plugins': { ok: true, data: { installedPlugins: installedPlugins.value } } } } },
        },
        refresh: vi.fn(),
    }),
}));
vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => ({
        phase: 'ready',
        inputs: { pluginProjectionById: { 'happier.claude': { iconAgentId: 'claude' }, 'happier.codex': { iconAgentId: 'codex' } } },
    }),
}));

afterEach(() => {
    standardCleanup();
    route.replace.mockReset();
    route.setParams.mockReset();
    route.pathname = '/plugins';
    route.params = {};
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => false }));

const rowIds = (screen: Awaited<ReturnType<typeof renderSettingsView>>, prefix: string) => [...new Set(screen
    .findAll((node) => typeof node.props?.testID === 'string' && node.props.testID.startsWith(prefix) && typeof node.props.title === 'string')
    .map((node) => String(node.props.testID)))];

describe('PluginsNavigationColumn', () => {
    it('lists the plugins on the machine the page administers as Added, then Included with Happier, with their agent marks', async () => {
        const { PluginsNavigationColumn } = await import('./PluginsNavigationColumn');
        const screen = await renderSettingsView(<PluginsNavigationColumn />);

        expect(rowIds(screen, 'plugins-column:plugin:')).toEqual([
            'plugins-column:plugin:acme.notes',
            'plugins-column:plugin:happier.claude',
            'plugins-column:plugin:happier.codex',
        ]);
        const installedRow = screen.findAll((node) => node.props?.testID === 'plugins-column:installed' && typeof node.props.title === 'string')[0];
        expect(installedRow?.props.detail).toBe('3');
        const marks = screen.findAll((node) => node.props?.title === 'Claude' && 'iconAgentId' in node.props);
        expect(marks[0]?.props.iconAgentId).toBe('claude');
        expect(screen.findByTestId('plugins-column:developers.trigger')).not.toBeNull();
    });

    it('opens a plugin beside the Plugins page, and marks the open one', async () => {
        const { PluginsNavigationColumn } = await import('./PluginsNavigationColumn');
        route.params = { view: 'installed', plugin: 'happier.claude' };
        const screen = await renderSettingsView(<PluginsNavigationColumn />);

        const selected = (testID: string) => screen.findAll((node) => node.props?.testID === testID && typeof node.props.selected === 'boolean')[0]?.props.selected;
        expect(selected('plugins-column:plugin:happier.claude')).toBe(true);
        expect(selected('plugins-column:plugin:happier.codex')).toBe(false);
        // A plugin open beside the page is not a different view: Installed stays the current one.
        expect(selected('plugins-column:installed')).toBe(true);

        // On the Plugins page the selection changes in place; the grid, its filters and scroll stay.
        screen.pressByTestId('plugins-column:plugin:happier.codex');
        expect(route.setParams).toHaveBeenCalledWith({ plugin: 'happier.codex', source: undefined });
        expect(route.replace).not.toHaveBeenCalled();
    });

    it('returns to the Plugins page with the plugin open when pressed from another Plugins page', async () => {
        const { PluginsNavigationColumn } = await import('./PluginsNavigationColumn');
        route.pathname = '/plugins/listing';
        const screen = await renderSettingsView(<PluginsNavigationColumn />);
        screen.pressByTestId('plugins-column:plugin:acme.notes');
        expect(route.replace).toHaveBeenCalledWith('/plugins?view=installed&plugin=acme.notes');
    });

    it('writes its search to the one installed-plugins query the page filters by', async () => {
        const { PluginsNavigationColumn } = await import('./PluginsNavigationColumn');
        const { readPluginsInstalledQuery, setPluginsInstalledQuery } = await import('./model/pluginsInstalledSearch');
        const previous = installedPlugins.value;
        installedPlugins.value = Array.from({ length: 9 }, (_, index) => ({
            pluginId: `acme.p${index}`, title: `Plugin ${index}`, description: null, version: '1', enabled: true, source: { kind: 'npm', locator: `p${index}` },
        }));
        try {
            const screen = await renderSettingsView(<PluginsNavigationColumn />);
            const field = screen.findAll((node) => node.props?.testID === 'plugins-column:search' && typeof node.props.onChangeText === 'function')[0];
            await act(async () => { field?.props.onChangeText('Plugin 3'); });
            expect(readPluginsInstalledQuery()).toBe('Plugin 3');
            expect(rowIds(screen, 'plugins-column:plugin:')).toEqual(['plugins-column:plugin:acme.p3']);
        } finally {
            installedPlugins.value = previous;
            setPluginsInstalledQuery('');
        }
    });

    it('drives the Plugins page between Installed and Browse', async () => {
        const { PluginsNavigationColumn } = await import('./PluginsNavigationColumn');
        route.params = { view: 'browse' };
        const screen = await renderSettingsView(<PluginsNavigationColumn />);

        const row = (testID: string) => screen.findAll((node) => node.props?.testID === testID && typeof node.props.selected === 'boolean')[0];
        expect(row('plugins-column:discover')?.props.selected).toBe(true);
        expect(row('plugins-column:installed')?.props.selected).toBe(false);
        screen.pressByTestId('plugins-column:installed');
        expect(route.replace).toHaveBeenCalledWith('/plugins?view=installed');
        route.params = {};
    });
});
