import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { act } from 'react-test-renderer';
import { installSessionSettingsCommonModuleMocks } from './sessionSettingsViewTestHelpers';
import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';

const setNewSessionDraftEntryMode = vi.fn();
const setSessionInactiveResumePolicy = vi.fn();
const setSessionUsageGaugeLabels = vi.fn();

installSessionSettingsCommonModuleMocks({ storage: async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useSettingMutable: (name: string) => {
            if (name === 'sessionUsageGaugeLabels') return [false, setSessionUsageGaugeLabels];
            if (name === 'newSessionDraftEntryMode') {
                return ['resumePrevious', setNewSessionDraftEntryMode];
            }
            if (name === 'sessionInactiveResumePolicy') {
                return ['online_only', setSessionInactiveResumePolicy];
            }
            const defaults: Record<string, unknown> = {
                sessionMessageSendMode: 'agent_queue',
                sessionBusySteerSendPolicy: 'steer_immediately',
                sessionNonSteerableSendPrompt: 'ask',
                sessionPendingQueueDrainMode: 'one_at_a_time',
                sessionPendingQueueDeliveryTiming: 'after_foreground_ready',
                agentInputEnterToSend: true,
                agentInputEnterToSendNative: false,
                agentInputHistoryScope: 'perSession',
                agentInputActionBarLayout: 'auto',
                agentInputChipDensity: 'auto',
                alwaysShowContextSize: true,
                composerSurfaceStyle: 'standard',
                sessionComposerRememberBannerVisibility: false,
            };
            return [defaults[name], vi.fn()];
        },
    });
} });

// Icon rendering is a native boundary; settings rows, menus and switches remain real.
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});

describe('SessionComposerSettingsView', () => {
    it('exposes the shared usage label preference in ordinary composer settings', async () => {
        const { SessionComposerSettingsView } = await import('./SessionComposerSettingsView');
        const screen = await renderSettingsView(React.createElement(SessionComposerSettingsView));
        const toggle = screen.findByTestId('settings-session-usage-gauge-labels-toggle');
        expect(toggle).toBeTruthy();
        expect(toggle?.props.value).toBe(false);
        await act(async () => toggle?.props.onValueChange(true));
        expect(setSessionUsageGaugeLabels).toHaveBeenCalledWith(true);
    });

    it('shows explicit resume and fresh ordinary-entry choices and persists the selection', async () => {
        const { SessionComposerSettingsView } = await import('./SessionComposerSettingsView');
        const screen = await renderSettingsView(React.createElement(SessionComposerSettingsView));

        expect(screen.findRow('settings-new-session-draft-entry-resume')).toBeTruthy();
        expect(screen.findRowByTitle('settingsSession.newSessionDraftEntry.resumeTitle')).toBeTruthy();
        expect(screen.findRowByTitle('settingsSession.newSessionDraftEntry.freshTitle')).toBeTruthy();

        screen.pressRowByTitle('settingsSession.newSessionDraftEntry.freshTitle');
        expect(setNewSessionDraftEntryMode).toHaveBeenCalledWith('alwaysFresh');
    });

    it('renders the inactive-session resume policy dropdown and persists changes', async () => {
        const { SessionComposerSettingsView } = await import('./SessionComposerSettingsView');
        const screen = await renderSettingsView(React.createElement(SessionComposerSettingsView));
        const menu = screen.findAll((candidate) => (
            candidate.props.itemTrigger?.title === 'settingsSession.messageSending.inactiveResumePolicyTitle'
        ))[0];

        expect(menu?.props).toMatchObject({
            selectedId: 'online_only',
            itemTrigger: {
                title: 'settingsSession.messageSending.inactiveResumePolicyTitle',
            },
        });
        expect(menu?.props.items.map((item: { id: string }) => item.id)).toEqual([
            'when_available',
            'online_only',
            'manual',
        ]);

        menu?.props.onSelect('when_available');
        expect(setSessionInactiveResumePolicy).toHaveBeenCalledWith('when_available');
    });
});
