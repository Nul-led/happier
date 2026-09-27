import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionSettingsEntryModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            useWindowDimensions: () => ({ width: 1280, height: 800 }),
        });
    },
});

sessionSettingsEntryState.settingsState = {
    agentInputEnterToSend: false,
    agentInputHistoryScope: 'perSession',
    sessionMessageSendMode: 'agent_queue',
    sessionBusySteerSendPolicy: 'steer_immediately',
    terminalConnectLegacySecretExportEnabled: false,
    sessionReplayEnabled: false,
    sessionReplayStrategy: 'recent_messages',
    sessionReplayRecentMessagesCount: 100,
    sessionUseTmux: false,
    sessionTmuxSessionName: null,
    sessionTmuxIsolated: false,
    sessionTmuxTmpDir: null,
    sessionsRightPaneDefaultOpen: false,
    uiMultiPanePanelsEnabled: true,
};

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
});

describe('Session composer settings (web features moved)', () => {
    it('shows Enter-to-send and Message history inside Session composer settings (web)', async () => {
        const mod = await import('@/app/(app)/settings/session/composer');
        const SessionComposerSettingsScreen = mod.default;
        const screen = await renderSettingsView(React.createElement(SessionComposerSettingsScreen));

        const items = screen.findAllByType('Item' as any);
        const titles = items.map((item) => item.props.title);

        expect(titles).toContain('settingsSessionPages.composer.enterToSendTitle');
        expect(titles).toContain('settingsFeatures.historyScope');

        // Message history is a web-only segmented choice between per-session and global history.
        const historyRow = items.find((item) => item.props.testID === 'settings-composer-history-scope');
        expect(historyRow?.props.title).toBe('settingsFeatures.historyScope');
        const historyIds = (historyRow?.props.rightElement?.props.tabs ?? []).map((tab: { id?: string }) => tab.id);
        expect(historyIds).toEqual(['perSession', 'global']);
    });
});
