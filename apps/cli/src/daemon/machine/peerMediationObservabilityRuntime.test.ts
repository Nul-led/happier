import { describe, expect, it } from 'vitest';

import { createDaemonPeerMediationObservabilityRuntime } from './peerMediationObservabilityRuntime';
import { createDaemonPeerMediationFlowEvent } from '../peer/mediation/observability/events';

describe('createDaemonPeerMediationObservabilityRuntime', () => {
    it('does not retain events while collection is disabled or its setting is unknown', () => {
        for (const isEnabled of [undefined, () => false]) {
            const runtime = createDaemonPeerMediationObservabilityRuntime({ isEnabled, nowMs: () => 1_000 });
            runtime.emitter.emit(createDaemonPeerMediationFlowEvent({
                accountId: 'account_1', machineId: 'machine_1', flowKind: 'live_stream',
                flowId: 'stream_1', kind: 'flow.started', nowMs: 1_000,
            }));
            expect(runtime.store.snapshot('machine_1', 'account_1').flows).toEqual([]);
        }
    });

    it('uses the live collection setting without replacing the runtime', () => {
        let enabled = true;
        const runtime = createDaemonPeerMediationObservabilityRuntime({ isEnabled: () => enabled, nowMs: () => 1_000 });
        const emit = (flowId: string) => runtime.emitter.emit(createDaemonPeerMediationFlowEvent({
            accountId: 'account_1', machineId: 'machine_1', flowKind: 'live_stream',
            flowId, kind: 'flow.started', nowMs: 1_000,
        }));
        emit('enabled_1');
        enabled = false;
        emit('disabled');
        enabled = true;
        emit('enabled_2');
        expect(runtime.store.snapshot('machine_1', 'account_1').flows.map((entry) => entry.flow.flowId))
            .toEqual(['enabled_1', 'enabled_2']);
    });

    it('feeds emitted relay flow events into the store snapshot (counters go live)', () => {
        let now = 1_000;
        const runtime = createDaemonPeerMediationObservabilityRuntime({ nowMs: () => now, isEnabled: () => true });

        // The snapshot starts empty (no flows observed yet → dark counters).
        expect(runtime.store.snapshot('machine_1', 'account_1').flows).toEqual([]);

        // A relay terminator would emit through `runtime.emitter`; simulate a live-stream flow start.
        runtime.emitter.emit(createDaemonPeerMediationFlowEvent({
            accountId: 'account_1',
            machineId: 'machine_1',
            flowKind: 'live_stream',
            flowId: 'stream_1',
            kind: 'flow.started',
            nowMs: now,
        }));
        now = 1_500;
        runtime.emitter.emit(createDaemonPeerMediationFlowEvent({
            accountId: 'account_1',
            machineId: 'machine_1',
            flowKind: 'live_stream',
            flowId: 'stream_1',
            kind: 'flow.closed',
            nowMs: now,
            reasonCode: 'normal_closure',
        }));

        const snapshot = runtime.store.snapshot('machine_1', 'account_1');
        expect(snapshot.flows.length).toBe(1);
        expect(snapshot.flows[0]).toMatchObject({
            flow: { flowId: 'stream_1', flowKind: 'live_stream' },
            closeReasonCode: 'normal_closure',
        });
        expect(snapshot.sequence).toBeGreaterThan(0);
    });

    it('scopes snapshots per machine/account (no cross-scope leakage)', () => {
        const runtime = createDaemonPeerMediationObservabilityRuntime({ nowMs: () => 2_000, isEnabled: () => true });
        runtime.emitter.emit(createDaemonPeerMediationFlowEvent({
            accountId: 'account_1',
            machineId: 'machine_1',
            flowKind: 'tcp_tunnel',
            flowId: 'tunnel_1',
            kind: 'flow.started',
            nowMs: 2_000,
        }));
        expect(runtime.store.snapshot('machine_1', 'account_1').flows.length).toBe(1);
        expect(runtime.store.snapshot('machine_2', 'account_1').flows).toEqual([]);
        expect(runtime.store.snapshot('machine_1', 'account_2').flows).toEqual([]);
    });
});
