import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderSettingsView, standardCleanup } from '@/dev/testkit';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
    sessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionSettingsEntryModuleMocks();

beforeEach(() => {
    sessionSettingsEntryState.settingsState = {
        agentInputEnterToSend: true,
        agentInputEnterToSendNative: false,
        sessionMessageSendMode: 'server_pending',
        sessionBusySteerSendPolicy: 'steer_immediately',
        sessionPendingQueueDrainMode: 'one_at_a_time',
        sessionPendingQueueDeliveryTiming: 'after_foreground_ready',
        alwaysShowContextSize: true,
    };
});

afterEach(() => {
    standardCleanup();
    resetSessionSettingsEntryState();
});

type SettingsScreen = Awaited<ReturnType<typeof renderSettingsView>>;

/** A segmented-choice row: `Item` is a host element here, its segmented control is the row's `rightElement`. */
function segmentedRow(screen: SettingsScreen, testID: string) {
    const row = screen.findAll((node) => (node.type as unknown) === 'Item' && node.props?.testID === testID)[0];
    if (!row) throw new Error(`Missing segmented row ${testID}`);
    return row;
}

function segmentIds(screen: SettingsScreen, testID: string): string[] {
    return segmentedRow(screen, testID).props.rightElement.props.tabs.map((tab: { id: string }) => tab.id);
}

async function renderComposerSettings(): Promise<SettingsScreen> {
    const mod = await import('@/app/(app)/settings/session/composer');
    return renderSettingsView(React.createElement(mod.default));
}

describe('Session composer settings pending queue drain mode', () => {
    it('renders one-at-a-time and drain-all choices when Pending can be used', async () => {
        const screen = await renderComposerSettings();

        expect(screen.findGroup('settingsSessionPages.composer.pendingSection')?.props.description)
            .toBe('settingsSessionPages.composer.pendingDescription');

        const drain = segmentedRow(screen, 'settings-composer-pending-drain');
        expect(drain.props.title).toBe('settingsSession.messageSending.pendingDrainModeTitle');
        expect(drain.props.disabled).toBeFalsy();
        expect(segmentIds(screen, 'settings-composer-pending-drain')).toEqual(['one_at_a_time', 'drain_all']);
        expect(drain.props.rightElement.props.activeTabId).toBe('one_at_a_time');

        const timing = segmentedRow(screen, 'settings-composer-pending-timing');
        expect(timing.props.title).toBe('settingsSession.messageSending.pendingDeliveryTimingTitle');
        expect(timing.props.disabled).toBeFalsy();
        expect(segmentIds(screen, 'settings-composer-pending-timing')).toEqual(['after_foreground_ready', 'after_runtime_idle']);
        expect(timing.props.rightElement.props.activeTabId).toBe('after_foreground_ready');
    });

    it('updates pending queue delivery timing independently from drain mode', async () => {
        const screen = await renderComposerSettings();

        await act(async () => {
            segmentedRow(screen, 'settings-composer-pending-timing').props.rightElement.props.onSelectTab('after_runtime_idle');
        });

        expect(sessionSettingsEntryState.settingsState.sessionPendingQueueDeliveryTiming).toBe('after_runtime_idle');
        expect(sessionSettingsEntryState.settingsState.sessionPendingQueueDrainMode).toBe('one_at_a_time');
    });

    // The rows stay (so search never lands on a missing row) but offer no choice, and the section says why.
    it('disables the pending queue choices and says why when the pending queue cannot be used', async () => {
        sessionSettingsEntryState.settingsState.sessionMessageSendMode = 'interrupt';
        sessionSettingsEntryState.settingsState.sessionBusySteerSendPolicy = 'steer_immediately';

        const screen = await renderComposerSettings();

        expect(screen.findGroup('settingsSessionPages.composer.pendingSection')?.props.description)
            .toBe('settingsSessionPages.composer.pendingInactive');
        for (const testID of ['settings-composer-pending-drain', 'settings-composer-pending-timing']) {
            const row = segmentedRow(screen, testID);
            expect(row.props.disabled).toBe(true);
            expect(row.props.rightElement.props.disabled).toBe(true);
        }
    });
});
