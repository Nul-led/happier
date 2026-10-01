import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { createActionExecutor, createUnavailableRuntimeActionExecutor, type ComputerControlStatusResponseV1 } from '@happier-dev/protocol';

import { createDeferred, renderHook } from '@/dev/testkit';
import { createComputerRuntimeActionExecutor, type ComputerMachineRpc } from '@/sync/domains/computer/actions/runtimeActionExecutor';
import { createComputerControlClient } from '@/sync/domains/computer/computerControlClient';

import { useComputerSessionControl } from './useComputerSessionControl';

const target = { kind: 'window', displayId: ':77', pid: 123, windowId: 456 } as const;
const identity = { target, sourceId: 'computer:1' };
const selection = {
    consentGranted: true,
    selectedTarget: target,
    sourceId: 'computer:1',
    approvalDisplay: { machineDisplayName: 'Studio laptop', requiresTargetSelection: false, target: { kind: 'window', title: 'Sign in to Lumen' } },
};
const status = (controller: 'agent' | 'human' | 'idle', extra: Partial<{ stopping: boolean; uncertain: boolean; controlEpoch: number }> = {}) => ({
    ...identity, controller, controlEpoch: extra.controlEpoch ?? 1, stopping: extra.stopping ?? false, uncertain: extra.uncertain ?? false,
});
const capture = {
    ...identity, status: 'captured', captureId: 'capture_2',
    geometry: { captureWidth: 10, captureHeight: 10, nativeWidth: 10, nativeHeight: 10, originX: 0, originY: 0, scaleX: 1, scaleY: 1, crop: { x: 0, y: 0, width: 10, height: 10 } },
    media: { mediaId: 'm', mediaKind: 'image', width: 10, height: 10, sizeBytes: 1,
        file: { sessionId: 'session_1', storage: 'daemon', path: 'p.png', sha256: 'a'.repeat(64), mimeType: 'image/png' } },
};

/** A machine whose computer owner answers like W7's: the stop is pending until its interrupt settles. */
function createMachine() {
    let current = status('agent');
    const interrupt = createDeferred<'known' | 'unknown'>();
    const calls: string[] = [];
    const machine: ComputerMachineRpc = async ({ actionId }) => {
        calls.push(actionId);
        switch (actionId) {
            case 'computer.target.get': return selection;
            case 'computer.control.status': return current;
            case 'computer.control.interrupt': {
                current = status('human', { stopping: true, controlEpoch: 2 });
                const completion = await interrupt.promise;
                current = status('human', { controlEpoch: 2, uncertain: completion === 'unknown' });
                return { ...identity, status: 'interrupted', completion };
            }
            case 'computer.capture':
                current = status('human', { controlEpoch: 2 });
                return capture;
            case 'computer.control.handBack':
                current = status('idle', { controlEpoch: 3 });
                return { ...identity, status: 'dispatched' };
            default: return { ok: false, errorCode: 'unexpected', error: 'unexpected' };
        }
    };
    return { machine: vi.fn(machine), interrupt, calls };
}

async function renderControl(machine: ComputerMachineRpc) {
    const executor = createActionExecutor({
        runtimeActionExecute: createComputerRuntimeActionExecutor({ executeOnMachine: machine, fallback: createUnavailableRuntimeActionExecutor() }),
    });
    return await renderHook(() => useComputerSessionControl({
        scope: { sessionId: 'session_1', machineId: 'machine_1' },
        execute: executor.execute,
    }));
}

describe('useComputerSessionControl', () => {
    it('sends see-only access through the real Action front door to the computer owner', async () => {
        const machine = vi.fn<ComputerMachineRpc>(async () => ({ ...selection, access: 'see' }));
        const executor = createActionExecutor({ runtimeActionExecute: createComputerRuntimeActionExecutor({
            executeOnMachine: machine, fallback: createUnavailableRuntimeActionExecutor(),
        }) });
        const client = createComputerControlClient({ sessionId: 'session_1', machineId: 'machine_1' }, executor.execute);
        expect(await client.selectTarget(target, 'see')).toMatchObject({ ok: true, value: { access: 'see' } });
        expect(machine).toHaveBeenCalledWith(expect.objectContaining({ input: { machineId: 'machine_1', target, access: 'see' } }));
    });

    it('refreshes activity and the shared cursor even when controller and epoch are unchanged', async () => {
        let current: ComputerControlStatusResponseV1 = status('agent');
        const machine: ComputerMachineRpc = async ({ actionId }) => actionId === 'computer.target.get' ? selection : current;
        const hook = await renderControl(machine);
        expect(hook.getCurrent().agentActing).toBe(false);
        current = { ...status('agent'), activity: { kind: 'click', targetLabel: 'Sign in' }, activeTarget: { x: 0.4, y: 0.2, width: 0.1, height: 0.1, label: 'Sign in' } };
        await act(async () => { hook.getCurrent().refresh(); });
        await hook.rerender();
        expect(hook.getCurrent().agentActing).toBe(true);
        expect(hook.getCurrent().presence).toMatchObject({ kind: 'agent', activity: 'click', target: { x: 0.4, y: 0.2, label: 'Sign in' } });
        current = status('agent');
        await act(async () => { hook.getCurrent().refresh(); });
        await hook.rerender();
        expect(hook.getCurrent().presence).toMatchObject({ kind: 'agent', activity: null, target: null });
        expect(hook.getCurrent().agentActing).toBe(false);
    });

    it('shows stopping until the machine answers, and never “you have control” on an unconfirmed stop', async () => {
        const { machine, interrupt } = createMachine();
        const hook = await renderControl(machine);
        expect(hook.getCurrent().presence.kind).toBe('agent');
        expect(hook.getCurrent().targetTitle).toBe('Sign in to Lumen');

        await act(async () => { hook.getCurrent().takeControl(); });
        expect(hook.getCurrent().presence.kind).toBe('stopping');

        await act(async () => { interrupt.resolve('unknown'); });
        await hook.rerender();
        expect(hook.getCurrent().presence.kind).toBe('unconfirmed');
    });

    it('confirms the stop with a fresh look, then hands back', async () => {
        const { machine, interrupt, calls } = createMachine();
        const hook = await renderControl(machine);
        await act(async () => { hook.getCurrent().takeControl(); interrupt.resolve('unknown'); });
        await hook.rerender();
        expect(hook.getCurrent().presence.kind).toBe('unconfirmed');

        await act(async () => { hook.getCurrent().checkAgain(); });
        await hook.rerender();
        expect(calls).toContain('computer.capture');
        expect(hook.getCurrent().presence).toMatchObject({ kind: 'human', interruptedCompletion: null });

        await act(async () => { hook.getCurrent().handBack(); });
        await hook.rerender();
        expect(calls).toContain('computer.control.handBack');
        expect(hook.getCurrent().presence.kind).toBe('agent');
    });
});
