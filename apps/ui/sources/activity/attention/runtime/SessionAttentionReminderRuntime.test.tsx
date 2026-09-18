import * as React from 'react';
import { AppState } from 'react-native';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createReactNativeAppStateEmitter, renderHook, standardCleanup } from '@/dev/testkit';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import {
    resolveSessionAttentionReminderDeadline,
    resolveSessionAttentionReminderRefreshPlan,
    useSessionAttentionReminderRefresh,
} from './sessionAttentionReminderScheduler';

describe('SessionAttentionReminderRuntime', () => {
    afterEach(() => {
        vi.useRealTimers();
        standardCleanup();
    });

    it('schedules a persisted reminder independently of durable attention standing', () => {
        expect(resolveSessionAttentionReminderDeadline('home-a', {
            sessionId: 'session-a',
            standing: false,
            remindAt: 2_000,
            updatedAt: 1,
        })).toEqual({
            address: { serverId: 'home-a', sessionId: 'session-a' },
            remindAt: 2_000,
        });
    });

    it('selects every due qualified Session and only the nearest future deadline', () => {
        expect(resolveSessionAttentionReminderRefreshPlan({
            nowMs: 2_000,
            reminders: [
                { address: { serverId: 'home-b', sessionId: 'same-session' }, remindAt: 2_000 },
                { address: { serverId: 'home-a', sessionId: 'same-session' }, remindAt: 2_500 },
                { address: { serverId: 'home-c', sessionId: 'later-session' }, remindAt: 4_000 },
            ],
        })).toEqual({
            due: [{ address: { serverId: 'home-b', sessionId: 'same-session' }, remindAt: 2_000 }],
            nextDeadlineAt: 2_500,
        });
    });

    it('wakes at the nearest deadline and refreshes the exact Home-qualified Session', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const refreshSession = vi.fn(async (_address: SessionAddress) => undefined);
        const invalidateSessionListQueryHome = vi.fn(async (_serverId: string) => undefined);

        await renderHook(() => useSessionAttentionReminderRefresh({
            connectedByServerId: { 'home-a': true, 'home-b': true },
            invalidateSessionListQueryHome,
            refreshReminderInventory: async () => undefined,
            refreshSession,
            reminders: [
                { address: { serverId: 'home-a', sessionId: 'same-session' }, remindAt: 3_000 },
                { address: { serverId: 'home-b', sessionId: 'same-session' }, remindAt: 2_000 },
            ],
        }));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(999);
        });
        expect(refreshSession).not.toHaveBeenCalled();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(refreshSession).toHaveBeenCalledWith({ serverId: 'home-b', sessionId: 'same-session' });
        expect(refreshSession).not.toHaveBeenCalledWith({ serverId: 'home-a', sessionId: 'same-session' });
        expect(invalidateSessionListQueryHome).toHaveBeenCalledWith('home-b');
        expect(invalidateSessionListQueryHome).not.toHaveBeenCalledWith('home-a');
    });

    it('retries a due reminder when its Home reconnects and when the app returns to foreground', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(2_000);
        const appState = createReactNativeAppStateEmitter('active');
        const restoreAppState = appState.install(AppState);
        const refreshSession = vi.fn(async (_address: SessionAddress) => undefined);
        let connectedByServerId: Readonly<Record<string, boolean>> = { 'home-a': false };

        try {
            const hook = await renderHook(() => useSessionAttentionReminderRefresh({
                connectedByServerId,
                invalidateSessionListQueryHome: async () => undefined,
                refreshReminderInventory: async () => undefined,
                refreshSession,
                reminders: [{ address: { serverId: 'home-a', sessionId: 'session-a' }, remindAt: 1_000 }],
            }));

            expect(refreshSession).not.toHaveBeenCalled();

            connectedByServerId = { 'home-a': true };
            await hook.rerender();
            expect(refreshSession).toHaveBeenCalledTimes(1);

            connectedByServerId = { 'home-a': false };
            await hook.rerender();
            connectedByServerId = { 'home-a': true };
            await hook.rerender();
            expect(refreshSession).toHaveBeenCalledTimes(2);

            await act(async () => {
                appState.emit('background');
                appState.emit('active');
                await Promise.resolve();
            });
            expect(refreshSession).toHaveBeenCalledTimes(3);
        } finally {
            restoreAppState();
        }
    });

    it('loads reminder inventories for all known Homes on mount and retries on reconnect and foreground', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(2_000);
        const appState = createReactNativeAppStateEmitter('active');
        const restoreAppState = appState.install(AppState);
        const refreshReminderInventory = vi.fn(async (_serverId: string) => undefined);
        let connectedByServerId: Readonly<Record<string, boolean>> = {
            'home-a': true,
            'home-b': false,
        };

        try {
            const hook = await renderHook(() => useSessionAttentionReminderRefresh({
                connectedByServerId,
                invalidateSessionListQueryHome: async () => undefined,
                refreshReminderInventory,
                refreshSession: async () => undefined,
                reminders: [],
            }));

            await act(async () => Promise.resolve());
            expect(refreshReminderInventory).toHaveBeenCalledTimes(2);
            expect(refreshReminderInventory).toHaveBeenCalledWith('home-a');
            expect(refreshReminderInventory).toHaveBeenCalledWith('home-b');

            connectedByServerId = { 'home-a': true, 'home-b': true };
            await hook.rerender();
            await act(async () => Promise.resolve());
            expect(refreshReminderInventory).toHaveBeenCalledTimes(3);
            expect(refreshReminderInventory).toHaveBeenLastCalledWith('home-b');

            await act(async () => {
                appState.emit('background');
                appState.emit('active');
                await Promise.resolve();
            });
            expect(refreshReminderInventory).toHaveBeenCalledTimes(5);
            expect(refreshReminderInventory.mock.calls.slice(-2).map(([serverId]) => serverId).sort())
                .toEqual(['home-a', 'home-b']);
        } finally {
            restoreAppState();
        }
    });

    it('cancels a scheduled wake when the persisted reminder is cleared', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const refreshSession = vi.fn(async (_address: SessionAddress) => undefined);
        const invalidateSessionListQueryHome = vi.fn(async (_serverId: string) => undefined);
        let reminders = [{ address: { serverId: 'home-a', sessionId: 'session-a' }, remindAt: 2_000 }];
        const hook = await renderHook(() => useSessionAttentionReminderRefresh({
            connectedByServerId: { 'home-a': true },
            invalidateSessionListQueryHome,
            refreshReminderInventory: async () => undefined,
            refreshSession,
            reminders,
        }));

        reminders = [];
        await hook.rerender();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
        });

        expect(invalidateSessionListQueryHome).not.toHaveBeenCalled();
        expect(refreshSession).not.toHaveBeenCalled();
    });

    it('tracks delimiter-bearing Home and Session pairs independently across reconnect', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(2_000);
        const first = { serverId: 'https://home.example/a', sessionId: 'b:c' };
        const second = { serverId: 'https://home.example/a:b', sessionId: 'c' };
        const refreshSession = vi.fn(async (_address: SessionAddress) => undefined);
        let connectedByServerId: Readonly<Record<string, boolean>> = {
            [first.serverId]: true,
            [second.serverId]: true,
        };
        const reminders = [
            { address: first, remindAt: 1_000 },
            { address: second, remindAt: 1_000 },
        ];

        const hook = await renderHook(() => useSessionAttentionReminderRefresh({
            connectedByServerId,
            invalidateSessionListQueryHome: async () => undefined,
            refreshReminderInventory: async () => undefined,
            refreshSession,
            reminders,
        }));
        await act(async () => Promise.resolve());
        expect(refreshSession).toHaveBeenCalledTimes(2);

        connectedByServerId = { [first.serverId]: false, [second.serverId]: true };
        await hook.rerender();
        connectedByServerId = { [first.serverId]: true, [second.serverId]: true };
        await hook.rerender();
        await act(async () => Promise.resolve());

        expect(refreshSession).toHaveBeenCalledTimes(3);
        expect(refreshSession.mock.calls.filter(([address]) => address.serverId === first.serverId)).toHaveLength(2);
        expect(refreshSession.mock.calls.filter(([address]) => address.serverId === second.serverId)).toHaveLength(1);
    });
});
