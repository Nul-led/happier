import { DaemonComputerActionExecuteResponseV1Schema } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { describe, expect, it } from 'vitest';

import type { RpcHandler, RpcHandlerRegistrar } from '@/api/rpc/types';
import { createComputerRoutes } from '@/daemon/computer/routes';
import { createComputerCaptureSource } from '@/daemon/computer/source';
import { createMachineLiveStreamCaptureRegistry } from '@/daemon/peer/mediation/stream/captureRegistry';

import { registerDaemonComputerHandler } from './daemonComputer';

function createCapturingRegistrar() {
    const handlers = new Map<string, RpcHandler>();
    const registrar: RpcHandlerRegistrar = {
        registerHandler: (method, handler) => { handlers.set(method, handler as RpcHandler); },
    };
    const invoke = async (raw: unknown) => {
        const handler = handlers.get(RPC_METHODS.DAEMON_COMPUTER_ACTION_EXECUTE);
        if (!handler) throw new Error('No computer handler registered');
        return DaemonComputerActionExecuteResponseV1Schema.parse(await handler(raw)).result;
    };
    return { registrar, invoke };
}

function selectTarget(registry: ReturnType<typeof createMachineLiveStreamCaptureRegistry>, sessionId: string) {
    const source = createComputerCaptureSource({ sessionId, title: 'Sign in to Lumen',
        target: { kind: 'window', displayId: ':not-an-x11-display', pid: 42, windowId: 7 } });
    registry.register({ sourceId: source.sourceId, streamFamily: 'screen', computer: source, adapter: source.adapter,
        capabilities: { v: 1, sourceId: source.sourceId, sourceKind: 'screen', supportedCodecs: ['image.frame.v1'],
            inputMode: 'shared', sidebands: [], health: { status: 'available' } } });
    return source;
}

describe('daemon computer present-user RPC', () => {
    it('runs a person’s stop as the present user of the named Session, on this machine’s computer owner', async () => {
        const registry = createMachineLiveStreamCaptureRegistry();
        const source = selectTarget(registry, 'session_1');
        const routes = createComputerRoutes({ machineId: 'machine_1', machineDisplayName: 'Studio laptop', registry });
        const { registrar, invoke } = createCapturingRegistrar();
        registerDaemonComputerHandler(registrar, { resolveComputer: () => routes });

        // A present-user-only Action succeeds: the route is the person's, never the payload's claim.
        expect(await invoke({ sessionId: 'session_1', actionId: 'computer.control.interrupt', input: { machineId: 'machine_1' } }))
            .toEqual({ target: source.target, sourceId: source.sourceId, status: 'interrupted', completion: 'known' });
        expect(await invoke({ sessionId: 'session_1', actionId: 'computer.control.status', input: { machineId: 'machine_1' } }))
            .toMatchObject({ controller: 'human', stopping: false, uncertain: false });
        // The Session scope is the request's: another Session sees no selection and display facts only.
        expect(await invoke({ sessionId: 'session_2', actionId: 'computer.target.get', input: { machineId: 'machine_1' } }))
            .toEqual({ consentGranted: false, approvalDisplay: { machineDisplayName: 'Studio laptop', requiresTargetSelection: true } });
        await routes.dispose();
    });

    it('never carries agent input and refuses when the machine has no computer owner', async () => {
        const { registrar, invoke } = createCapturingRegistrar();
        registerDaemonComputerHandler(registrar, { resolveComputer: () => null });
        await expect(invoke({ sessionId: 'session_1', actionId: 'computer.input',
            input: { machineId: 'machine_1', captureId: 'c', operation: { kind: 'type', text: 'x' } } })).rejects.toThrow();
        expect(await invoke({ sessionId: 'session_1', actionId: 'computer.control.status', input: { machineId: 'machine_1' } }))
            .toEqual({ ok: false, errorCode: 'computer_unavailable', error: 'computer_unavailable' });
    });
});
