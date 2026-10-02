import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import { loadSyncSingletonForTests } from '@/dev/testkit/harness/syncSingletonLoader';
import { storage } from '@/sync/domains/state/storageStore';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { installSessionSettingsCommonModuleMocks } from './sessionSettingsViewTestHelpers';

installSessionSettingsCommonModuleMocks({
    storage: async (importOriginal) => {
        return importOriginal();
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/lists/SegmentedChoiceItem', () => ({
    SegmentedChoiceItem: (props: Record<string, unknown>) => React.createElement('SegmentedChoiceItem', props),
}));

describe('SessionRuntimeSettingsView', () => {
    beforeEach(async () => {
        await loadSyncSingletonForTests();
        storage.setState({ settings: { ...settingsDefaults, sessionUseTmux: false, sessionTerminalHost: 'herdr' },
            settingsScope: { serverId: 'server-a', accountId: 'account-a' }, settingsVersion: 1 });
    });

    it('shows the existing account tmux settings only for tmux, retaining the saved values', async () => {
        storage.setState({ settings: { ...settingsDefaults, sessionUseTmux: true, sessionTerminalHost: 'tmux',
            sessionTmuxSessionName: 'work', sessionTmuxIsolated: true, sessionTmuxTmpDir: '/tmp/work-tmux' } });
        const { SessionRuntimeSettingsView } = await import('./SessionRuntimeSettingsView');
        const screen = await renderSettingsView(React.createElement(SessionRuntimeSettingsView));
        expect(screen.findByTestId('settings-session-tmux-name')?.props.value).toBe('work');
        expect(screen.findByTestId('settings-session-tmux-isolated')?.props.value).toBe(true);
        expect(screen.findByTestId('settings-session-tmux-tmpdir')?.props.value).toBe('/tmp/work-tmux');
        await act(async () => {
            screen.findByTestId('settings-session-tmux-name')!.props.onChangeText('renamed');
            screen.findByTestId('settings-session-tmux-tmpdir')!.props.onChangeText('/tmp/renamed');
        });
        expect(storage.getState().settings.sessionTmuxSessionName).toBe('renamed');
        expect(storage.getState().settings.sessionTmuxTmpDir).toBe('/tmp/renamed');
        await act(async () => { screen.findByTestId('settings-session-tmux-isolated')!.props.onValueChange(false); });
        expect(storage.getState().settings.sessionTmuxIsolated).toBe(false);
        expect(screen.findByTestId('settings-session-tmux-tmpdir')).toBeNull();
        await act(async () => {
            storage.setState({ settings: { ...storage.getState().settings, sessionTerminalHost: 'herdr', sessionUseTmux: false } });
        });
        expect(screen.findByTestId('settings-session-tmux-name')).toBeNull();
        expect(storage.getState().settings.sessionTmuxSessionName).toBe('renamed');
        await screen.unmount();
    });
    it('keeps the runtime control without offering obsolete legacy-secret issuance', async () => {
        const { SessionRuntimeSettingsView } = await import('./SessionRuntimeSettingsView');
        const screen = await renderSettingsView(React.createElement(SessionRuntimeSettingsView));

        const row = screen.findRowByTitle('settingsSessionPages.runtime.terminalHostTitle');
        expect(row).toBeTruthy();
        expect(row?.props.value).toBe('herdr');
        expect(screen.findRowByTitle('settingsSession.terminalConnect.legacySecretExportTitle')).toBeNull();
    });
});
