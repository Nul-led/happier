import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSystemTaskRunner } from '@/components/systemTasks/createSystemTaskRunner';
import { disconnectThisComputerBeforeForgettingHome } from './disconnectThisComputerFromHome';

const modal = vi.hoisted(() => ({ confirms: 0, alerts: 0 }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            confirm: async () => { modal.confirms += 1; return true; },
            alert: () => { modal.alerts += 1; },
        },
    }).module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

describe('disconnect permission before forgetting a Home', () => {
    beforeEach(() => { modal.confirms = 0; modal.alerts = 0; });

    it.each([
        { code: 'cancelled', mayForget: false, confirms: 0, alerts: 0 },
        { code: 'execution_failed', mayForget: false, confirms: 0, alerts: 1 },
        { code: 'service_inventory_unavailable', mayForget: true, confirms: 1, alerts: 0 },
    ])('preserves the $code result from the task owner', async ({ code, mayForget, confirms, alerts }) => {
        const taskId = `disconnect_${code}`;
        const runner = createSystemTaskRunner({
            mode: 'tauri',
            bridge: {
                async start() { return taskId; },
                async subscribe(id, listeners) {
                    queueMicrotask(() => listeners.onResult({ protocolVersion: 1, taskId: id, ok: false, error: { code, message: 'disconnect interrupted' } }));
                    return () => {};
                },
                async cancel() {},
                async respond() {},
            },
        });
        await expect(disconnectThisComputerBeforeForgettingHome({ serverUrl: 'https://work.example.test', label: 'Work' }, runner)).resolves.toBe(mayForget);
        expect(modal.confirms).toBe(confirms);
        expect(modal.alerts).toBe(alerts);
    });
});
