import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const select = vi.hoisted(() => vi.fn(async () => Object.freeze({
    kind: 'selected' as const,
    intent: {
        pluginId: 'example.tasks',
        desiredVersion: '2.0.0',
        enabled: true,
        offlineUiHosting: 'disabled' as const,
        writableCollections: [],
        revision: 'intent-1',
    },
})));
const retire = vi.hoisted(() => vi.fn());
const alert = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn(async () => true));
const readHostedArtifactStatus = vi.hoisted(() => vi.fn(() => 'unavailable' as 'unavailable' | 'hosted'));
const setHostedArtifactsEnabled = vi.hoisted(() => vi.fn(async () => ({ kind: 'updated' as const })));
const disableAndRemoveHostedArtifacts = vi.hoisted(() => vi.fn(async () => ({ kind: 'updated' as const })));
const clearHostedArtifactCache = vi.hoisted(() => vi.fn(async () => ({ kind: 'updated' as const })));
const createController = vi.hoisted(() => vi.fn(() => ({
    select,
    readHostedArtifactStatus,
    setHostedArtifactsEnabled,
    disableAndRemoveHostedArtifacts,
    clearHostedArtifactCache,
    retire,
    isPending: () => false,
})));

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: React.PropsWithChildren) => React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/icons/Icon', () => ({ Icon: 'Icon' }));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@/modal', () => ({
    Modal: { alert, confirm },
}));

vi.mock('./pluginAccountReleaseSelectionController', () => ({
    createPluginAccountReleaseSelectionController: createController,
}));

afterEach(() => {
    standardCleanup();
    select.mockClear();
    retire.mockClear();
    alert.mockClear();
    confirm.mockClear();
    createController.mockClear();
    readHostedArtifactStatus.mockReset();
    readHostedArtifactStatus.mockReturnValue('unavailable');
    setHostedArtifactsEnabled.mockClear();
    disableAndRemoveHostedArtifacts.mockClear();
    clearHostedArtifactCache.mockClear();
});

describe('PluginAccountReleaseSelectionSection', () => {
    it('keeps the Account-only action available without daemon execution or machine install authority', async () => {
        const { PluginAccountReleaseSelectionSection } = await import('./PluginAccountReleaseSelectionSection');
        const screen = await renderScreen(
            <PluginAccountReleaseSelectionSection
                pluginId="example.tasks"
                version="2.0.0"
                reader={null}
                projection={null}
                daemon={{ serverId: null, serverIdentityId: null, machineId: null }}
                testID="settings.plugins.detail.example.tasks.accountRelease"
            />,
        );

        const row = screen.findByTestId('settings.plugins.detail.example.tasks.accountRelease');
        expect(row?.props.title).toBe('settingsPlugins.accountReleaseSelection.entryTitle');
        expect(row?.props.destructive).not.toBe(true);
        expect(row?.props.disabled).toBe(false);
        await act(async () => {
            row?.props.onPress();
            await Promise.resolve();
        });

        expect(select).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            pluginId: 'example.tasks',
            version: '2.0.0',
            reader: null,
            projection: null,
            daemon: { serverId: null, serverIdentityId: null, machineId: null },
        }));
        // The selected Account release is already the visible state owner; a
        // second success modal adds no information and interrupts focus.
        expect(alert).not.toHaveBeenCalled();
    });

    it.each([
        [
            Object.freeze({ kind: 'conflict' as const, code: 'intent_revision_conflict' as const }),
            'settingsPlugins.accountReleaseSelection.conflictTitle',
            'settingsPlugins.accountReleaseSelection.conflictBody',
        ],
        [
            Object.freeze({ kind: 'unavailable' as const, code: 'target_release_unavailable' as const }),
            'settingsPlugins.accountReleaseSelection.unavailableTitle',
            'settingsPlugins.accountReleaseSelection.unavailableBody',
        ],
    ])('presents %s as its typed release-selection result', async (result, title, body) => {
        select.mockResolvedValueOnce(result as never);
        const { PluginAccountReleaseSelectionSection } = await import('./PluginAccountReleaseSelectionSection');
        const screen = await renderScreen(
            <PluginAccountReleaseSelectionSection
                pluginId="example.tasks"
                version="2.0.0"
                reader={null}
                projection={null}
                daemon={{ serverId: null, serverIdentityId: null, machineId: null }}
                testID="plugin.release"
            />,
        );

        await act(async () => {
            screen.findByTestId('plugin.release')?.props.onPress();
            await Promise.resolve();
        });

        expect(alert).toHaveBeenCalledWith(title, body);
    });

    it('shows current hosted status and exposes removal plus exact local cache clear actions', async () => {
        readHostedArtifactStatus.mockReturnValue('hosted');
        const { PluginAccountReleaseSelectionSection } = await import('./PluginAccountReleaseSelectionSection');
        const reader = { subscribe: () => () => {} } as never;
        const screen = await renderScreen(
            <PluginAccountReleaseSelectionSection
                pluginId="example.tasks"
                version="2.0.0"
                reader={reader}
                projection={null}
                daemon={{ serverId: null, serverIdentityId: null, machineId: null }}
                testID="plugin.release"
            />,
        );

        expect(screen.findByTestId('plugin.release.hosting')?.props.subtitle).toBe(
            'settingsPlugins.accountReleaseSelection.hostedStatusReady',
        );
        await act(async () => {
            screen.findByTestId('plugin.release.clearCache')?.props.onPress();
            await Promise.resolve();
        });
        expect(clearHostedArtifactCache).toHaveBeenCalledWith({ pluginId: 'example.tasks', reader });
        await act(async () => {
            screen.findByTestId('plugin.release.removeHosted')?.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(disableAndRemoveHostedArtifacts).toHaveBeenCalledWith({ pluginId: 'example.tasks', reader });
    });

    it.each([
        ['conflict', 'settingsPlugins.accountReleaseSelection.conflictTitle', 'settingsPlugins.accountReleaseSelection.conflictBody'],
        ['unavailable', 'settingsPlugins.accountReleaseSelection.unavailableTitle', 'settingsPlugins.accountReleaseSelection.unavailableBody'],
    ] as const)('presents a hosted-artifact %s with its typed recovery copy', async (kind, title, body) => {
        readHostedArtifactStatus.mockReturnValue('notOptedIn' as never);
        setHostedArtifactsEnabled.mockResolvedValueOnce({ kind } as never);
        const { PluginAccountReleaseSelectionSection } = await import('./PluginAccountReleaseSelectionSection');
        const reader = { subscribe: () => () => {} } as never;
        const screen = await renderScreen(
            <PluginAccountReleaseSelectionSection
                pluginId="example.tasks"
                version="2.0.0"
                reader={reader}
                projection={null}
                daemon={{ serverId: null, serverIdentityId: null, machineId: null }}
                testID="plugin.release"
            />,
        );

        await act(async () => {
            screen.findByTestId('plugin.release.hosting')?.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(alert).toHaveBeenCalledWith(title, body);
    });

    it('keeps the Account hosting lifecycle reachable without a machine-selectable release version', async () => {
        readHostedArtifactStatus.mockReturnValue('hosted');
        const { PluginAccountReleaseSelectionSection } = await import('./PluginAccountReleaseSelectionSection');
        const reader = { subscribe: () => () => {} } as never;
        const screen = await renderScreen(
            <PluginAccountReleaseSelectionSection
                pluginId="example.tasks"
                version={null}
                reader={reader}
                projection={null}
                daemon={{ serverId: null, serverIdentityId: null, machineId: null }}
                testID="plugin.release"
            />,
        );

        // The Account-hosted archive outlives every machine installation, so
        // its status and removal must not depend on a current machine release.
        expect(
            screen.findAllByType('Item')
                .some((item) => item.props.testID === 'plugin.release'),
        ).toBe(false);
        expect(screen.findByTestId('plugin.release.hosting')?.props.subtitle).toBe(
            'settingsPlugins.accountReleaseSelection.hostedStatusReady',
        );
        expect(screen.findByTestId('plugin.release.removeHosted')).not.toBeNull();
        await act(async () => {
            screen.findByTestId('plugin.release.clearCache')?.props.onPress();
            await Promise.resolve();
        });
        expect(clearHostedArtifactCache).toHaveBeenCalledWith({ pluginId: 'example.tasks', reader });
        expect(select).not.toHaveBeenCalled();
    });

    it('renders nothing when neither a release selection nor Account hosting is current', async () => {
        const { PluginAccountReleaseSelectionSection } = await import('./PluginAccountReleaseSelectionSection');
        const screen = await renderScreen(
            <PluginAccountReleaseSelectionSection
                pluginId="example.tasks"
                version={null}
                reader={{ subscribe: () => () => {} } as never}
                projection={null}
                daemon={{ serverId: null, serverIdentityId: null, machineId: null }}
                testID="plugin.release"
            />,
        );

        expect(screen.findAllByType('ItemGroup')).toHaveLength(0);
    });
});
