import { describe, expect, it, vi } from 'vitest';

import {
    SESSION_CHANGED_BACKGROUND_WAKE_TASK_NAME,
    applySessionChangedBackgroundWakePayload,
    defineSessionChangedBackgroundWakeTask,
    readSessionChangedBackgroundWakePayload,
    syncSessionChangedBackgroundWakeTaskRegistration,
} from './defineSessionChangedBackgroundWakeTask';

const BackgroundNotificationTaskResult = { Failed: 2, NewData: 1, NoData: 0 } as const;

function createTaskManager(defined = new Set<string>()) {
    const tasks = new Map<string, (payload: unknown) => Promise<unknown>>();
    return {
        tasks,
        defineTask: ((taskName: string, executor: (payload: unknown) => Promise<unknown>) => {
            defined.add(taskName);
            tasks.set(taskName, executor);
        }) as never,
        isTaskDefined: (taskName: string) => defined.has(taskName),
    };
}

describe('session_changed background wake consumer', () => {
    it('reads the wake out of the Expo and Android data-message envelopes', () => {
        const wake = { type: 'session_changed', serverId: 'srv_a', sessionId: 'session-1' };
        expect(readSessionChangedBackgroundWakePayload(wake)).toEqual(wake);
        expect(readSessionChangedBackgroundWakePayload({ data: wake })).toEqual(wake);
        expect(readSessionChangedBackgroundWakePayload({ data: { dataString: JSON.stringify(wake) } }))
            .toEqual(wake);
    });

    it('ignores every payload that is not exactly this wake', () => {
        expect(readSessionChangedBackgroundWakePayload({ data: { type: 'badge_refresh' } })).toBeNull();
        expect(readSessionChangedBackgroundWakePayload({
            data: { type: 'activity_alert', v: 2, sessionId: 'session-1' },
        })).toBeNull();
        expect(readSessionChangedBackgroundWakePayload({ data: { dataString: 'not json' } })).toBeNull();
        expect(readSessionChangedBackgroundWakePayload(undefined)).toBeNull();
    });

    it('reconciles exactly the woken Home and Session, and nothing else', async () => {
        const reconcile = vi.fn(async () => true);
        expect(await applySessionChangedBackgroundWakePayload({
            payload: { data: { type: 'session_changed', serverId: 'srv_a', sessionId: 'session-1' } },
            reconcile,
        })).toEqual({ action: 'reconciled', serverId: 'srv_a', sessionId: 'session-1' });
        expect(reconcile).toHaveBeenCalledWith({
            type: 'session_changed', serverId: 'srv_a', sessionId: 'session-1',
        });
    });

    it('never reconciles for a foreign payload', async () => {
        const reconcile = vi.fn(async () => true);
        expect(await applySessionChangedBackgroundWakePayload({
            payload: { data: { type: 'badge_refresh' } },
            reconcile,
        })).toEqual({ action: 'ignore', reason: 'not_a_session_changed_wake' });
        expect(reconcile).not.toHaveBeenCalled();
    });

    it('reports no data when the exact Home cannot produce the Session', async () => {
        expect(await applySessionChangedBackgroundWakePayload({
            payload: { type: 'session_changed', sessionId: 'session-1' },
            reconcile: async () => false,
        })).toEqual({ action: 'ignore', reason: 'session_unavailable' });
    });

    it('defines exactly one task, and only where the platform can deliver it', () => {
        const ios = createTaskManager();
        expect(defineSessionChangedBackgroundWakeTask({
            taskManager: ios, notifications: { BackgroundNotificationTaskResult }, platformOS: 'ios',
        })).toEqual({ status: 'defined' });
        expect([...ios.tasks.keys()]).toEqual([SESSION_CHANGED_BACKGROUND_WAKE_TASK_NAME]);

        // Android's Firebase entry point runs in an isolated process with its own
        // task registry, so a task defined here could never run there.
        for (const platformOS of ['android', 'web'] as const) {
            const other = createTaskManager();
            expect(defineSessionChangedBackgroundWakeTask({
                taskManager: other, notifications: { BackgroundNotificationTaskResult }, platformOS,
            })).toEqual({ status: 'skipped_platform' });
            expect(other.tasks.size).toBe(0);
        }
    });

    it('maps the task outcome onto the background task result contract', async () => {
        const taskManager = createTaskManager();
        defineSessionChangedBackgroundWakeTask({
            taskManager, notifications: { BackgroundNotificationTaskResult }, platformOS: 'ios',
        });
        const executor = taskManager.tasks.get(SESSION_CHANGED_BACKGROUND_WAKE_TASK_NAME);
        expect(executor).toBeDefined();
        expect(await executor?.({ error: new Error('boom') })).toBe(BackgroundNotificationTaskResult.Failed);
        expect(await executor?.({ data: { data: { type: 'badge_refresh' } } }))
            .toBe(BackgroundNotificationTaskResult.NoData);
    });

    it('registers once where it can run and unregisters a stale registration elsewhere', async () => {
        const registerTaskAsync = vi.fn(async () => undefined);
        const unregisterTaskAsync = vi.fn(async () => undefined);
        const notifications = { registerTaskAsync, unregisterTaskAsync };

        expect(await syncSessionChangedBackgroundWakeTaskRegistration({
            platformOS: 'ios', notifications, taskManager: { isTaskRegisteredAsync: async () => false },
        })).toEqual({ status: 'registered' });
        expect(registerTaskAsync).toHaveBeenCalledWith(SESSION_CHANGED_BACKGROUND_WAKE_TASK_NAME);

        expect(await syncSessionChangedBackgroundWakeTaskRegistration({
            platformOS: 'ios', notifications, taskManager: { isTaskRegisteredAsync: async () => true },
        })).toEqual({ status: 'already_registered' });
        expect(registerTaskAsync).toHaveBeenCalledTimes(1);

        expect(await syncSessionChangedBackgroundWakeTaskRegistration({
            platformOS: 'android', notifications, taskManager: { isTaskRegisteredAsync: async () => true },
        })).toEqual({ status: 'unregistered', reason: 'platform_unsupported' });
        expect(unregisterTaskAsync).toHaveBeenCalledWith(SESSION_CHANGED_BACKGROUND_WAKE_TASK_NAME);
    });
});
