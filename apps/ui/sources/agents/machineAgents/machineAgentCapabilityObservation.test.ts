import { describe, expect, it } from 'vitest';
import { projectMachineAgentCapabilityObservation } from './machineAgentCapabilityObservation';
import { createMachineAgentInventoryStore } from './machineAgentInventoryStore';

describe('machine agent capability observation', () => {
    it('uses installed rather than legacy available, fails closed on incomplete rows, and preserves the last-known offline facts', () => {
        const descriptors = [{ agentId: 'antigravity', title: 'Antigravity' }];
        const row = { available: true, installed: false, version: null, latestVersion: null, update: { supported: false, command: null }, signIn: { status: 'signedIn', loginSupport: 'manual_only' }, platform: { supported: true }, install: { available: true, mode: 'vendor_recipe', sizeBytes: null, guideUrl: null }, dependencies: [{ key: 'agy-helper', installed: true, version: '1' }] };
        const cache = { status: 'loaded' as const, snapshot: { response: { protocolVersion: 1 as const, results: { 'cli.antigravity': { ok: true as const, checkedAt: 12, data: row } } } } };
        const store = createMachineAgentInventoryStore();
        store.publish('machine', projectMachineAgentCapabilityObservation(descriptors, cache));
        expect(store.read('machine')).toMatchObject({ status: 'ready', lastCheckedAt: 12, agents: [{ installed: false, state: 'notInstalled' }] });
        store.publish('machine', projectMachineAgentCapabilityObservation(descriptors, { status: 'loaded', snapshot: { response: { protocolVersion: 1, results: { 'cli.antigravity': { ok: true, checkedAt: 13, data: { available: true } } } } } }));
        expect(store.read('machine')).toMatchObject({ status: 'error', agents: [{ installed: false, stale: true }] });
    });
});
