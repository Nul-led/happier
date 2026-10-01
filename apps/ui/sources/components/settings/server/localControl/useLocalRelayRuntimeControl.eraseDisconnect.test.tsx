import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { createModalModuleMock } from '@/dev/testkit/mocks/modal';
import { createSystemTaskRunner } from '@/components/systemTasks/createSystemTaskRunner';
import type { SystemTaskRunner } from '@/components/systemTasks/types';

import { useLocalRelayRuntimeControl } from './useLocalRelayRuntimeControl';

/**
 * R15: erasing the Personal Home is a Home going away, so — once the person confirmed the erase and
 * before any data is destroyed — this computer stops serving it through the same disconnect owner
 * as removing a Home in Settings (`daemon.service.relay.disconnect.v1`). A failed uninstall answers
 * the erase prompt "not confirmed", so nothing is erased. The runner's bridge is the boundary.
 */

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

const modalSpies = vi.hoisted(() => ({ alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), show: vi.fn() }));
vi.mock('@/modal', () => createModalModuleMock({ spies: modalSpies }).module);

vi.mock('@/components/serverProfiles/removeServerProfileUiAction', () => ({
    removeServerProfileUiAction: vi.fn(async () => ({ kind: 'completed' as const })),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Reply = Readonly<{ ok: true; data: Record<string, unknown> } | { ok: false; code: string }>;

const HOME_URL = 'http://127.0.0.1:43123';
const ERASE_PROMPT_DATA = {
    kind: 'personal_home.confirm_erase.v1',
    paths: ['/data/home.sqlite'],
    estimatedBytes: 42,
    canonicalServerUrl: HOME_URL,
    homeServerIdentityId: 'home-identity-1',
    previewComplete: true,
    previewReason: null,
};

function createHarness(disconnectReply: Reply) {
    const listeners = new Map<string, { onEvent: (payload: unknown) => void; onResult: (payload: unknown) => void }>();
    const started: Array<{ kind: string; params: Record<string, unknown> }> = [];
    const responses: Array<{ taskId: string; answer: unknown }> = [];
    const runner: SystemTaskRunner = createSystemTaskRunner({
        mode: 'tauri',
        bridge: {
            async start(spec) {
                const parsed = spec as { kind: string; params: Record<string, unknown> };
                started.push(parsed);
                return `task_${started.length}:${parsed.kind}`;
            },
            async subscribe(taskId, listenerSet) {
                listeners.set(taskId, listenerSet);
                if (taskId.endsWith('relay.runtime.status.v1')) {
                    listenerSet.onResult({ protocolVersion: 1, taskId, ok: true, data: { installed: true, version: '1', relayUrl: HOME_URL, healthy: true, dataPresent: true, purpose: { kind: 'personal-home', canonicalServerUrl: HOME_URL }, anonymousSignupEnabled: false, service: { active: true, enabled: true } } });
                }
                if (taskId.endsWith('daemon.service.relay.disconnect.v1')) {
                    setTimeout(() => listenerSet.onResult(disconnectReply.ok
                        ? { protocolVersion: 1, taskId, ok: true, data: disconnectReply.data }
                        : { protocolVersion: 1, taskId, ok: false, error: { code: disconnectReply.code, message: 'failed' } }), 0);
                }
                return () => listeners.delete(taskId);
            },
            async cancel() {},
            async respond(taskId, answer) {
                responses.push({ taskId, answer });
            },
        },
    });
    return { runner, listeners, started, responses };
}

async function eraseAndConfirm(harness: ReturnType<typeof createHarness>, personConfirms = true) {
    const { getCurrent } = await renderHook(() => useLocalRelayRuntimeControl({ runner: harness.runner }));
    const continuation = vi.fn(async () => ({ confirmed: personConfirms }));
    let eraseTaskId = '';
    await act(async () => {
        void getCurrent().erasePersonalHomeData(continuation);
        await new Promise((resolve) => setTimeout(resolve, 0));
        eraseTaskId = harness.started.map((spec, index) => `task_${index + 1}:${spec.kind}`)
            .find((id) => id.endsWith('relay.runtime.personal_home.erase.v1')) ?? '';
    });
    await act(async () => {
        harness.listeners.get(eraseTaskId)?.onEvent({
            protocolVersion: 1,
            taskId: eraseTaskId,
            tsMs: 1,
            type: 'prompt',
            stepId: 'personal_home.confirm_erase',
            message: 'Confirm erase',
            data: ERASE_PROMPT_DATA,
        });
        for (let tick = 0; tick < 20 && !harness.responses.some((response) => response.taskId === eraseTaskId); tick += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    });
    return {
        answer: harness.responses.find((response) => response.taskId === eraseTaskId)?.answer,
        disconnects: harness.started.filter((spec) => spec.kind === 'daemon.service.relay.disconnect.v1'),
    };
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('erasing the Personal Home disconnects this computer from it first (R15)', () => {
    it('uninstalls this computer\'s service for the Home once the erase is confirmed, then lets the erase proceed', async () => {
        const { answer, disconnects } = await eraseAndConfirm(createHarness({ ok: true, data: { outcome: 'removed', label: 'happier-daemon.home' } }));
        expect(disconnects).toHaveLength(1);
        expect(disconnects[0]?.params).toMatchObject({ relayUrl: HOME_URL, serverIdentityId: 'home-identity-1' });
        expect(answer).toEqual({ confirmed: true });
    });

    it('stops the erase before any data is destroyed when the service could not be uninstalled', async () => {
        const { answer, disconnects } = await eraseAndConfirm(createHarness({ ok: false, code: 'service_uninstall_failed' }));
        expect(disconnects).toHaveLength(1);
        expect(modalSpies.alert).toHaveBeenCalledTimes(1);
        expect(answer).toEqual({ confirmed: false });
    });

    it('asks before erasing anyway when this computer\'s services could not be read', async () => {
        modalSpies.confirm.mockResolvedValueOnce(false);
        const { answer } = await eraseAndConfirm(createHarness({ ok: false, code: 'service_inventory_unavailable' }));
        expect(modalSpies.confirm).toHaveBeenCalledTimes(1);
        expect(answer).toEqual({ confirmed: false });
    });

    it('leaves a service the user installed, says so, and erases', async () => {
        const { answer } = await eraseAndConfirm(createHarness({ ok: true, data: { outcome: 'user_owned', label: 'happier-daemon.home' } }));
        expect(modalSpies.alert).toHaveBeenCalledTimes(1);
        expect(answer).toEqual({ confirmed: true });
    });

    it('disconnects nothing when the person does not confirm the erase', async () => {
        const { answer, disconnects } = await eraseAndConfirm(createHarness({ ok: true, data: { outcome: 'removed', label: null } }), false);
        expect(disconnects).toHaveLength(0);
        expect(answer).toEqual({ confirmed: false });
    });
});
