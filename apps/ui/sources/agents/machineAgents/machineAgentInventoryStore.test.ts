import { describe, expect, it, vi } from 'vitest';
import type { MachineAgentInventoryItem } from '@happier-dev/protocol/capabilities';
import { createMachineAgentInventoryStore } from './machineAgentInventoryStore';

const facts = (agentId: string): MachineAgentInventoryItem => ({ agentId, title: agentId, installed: true,
    version: '1.0.0', latestVersion: '1.0.0', update: { supported: true, command: null },
    signIn: { status: 'signedIn', loginSupport: 'login_terminal' }, platform: { supported: true },
    install: { available: true, mode: 'managed', sizeBytes: null, guideUrl: null }, dependencies: [] });

describe('machine agent inventory store', () => {
    it('retains offline facts and identities, suppresses no-op notifications, and isolates machine/account scopes', () => {
        const store = createMachineAgentInventoryStore();
        const listener = vi.fn();
        store.subscribe('account-a/machine', listener);
        const observation = { status: 'ready' as const, items: [facts('claude'), facts('codex')], lastCheckedAt: 1 };
        store.publish('account-a/machine', observation);
        const first = store.read('account-a/machine');
        const claudeListener = vi.fn();
        store.subscribeAgent('account-a/machine', 'claude', claudeListener);
        expect(first.agents.map((agent) => agent.state)).toEqual(['ready', 'ready']);
        store.publish('account-a/machine', observation);
        expect(store.read('account-a/machine')).toBe(first);
        expect(listener).toHaveBeenCalledTimes(1);
        store.publish('account-a/machine', { ...observation, items: [facts('claude'), { ...facts('codex'), latestVersion: '2.0.0' }], lastCheckedAt: 2 });
        expect(store.read('account-a/machine').agents[0]).toBe(first.agents[0]);
        expect(claudeListener).not.toHaveBeenCalled();
        store.publish('account-a/machine', { status: 'offline', items: [], lastCheckedAt: null });
        expect(store.read('account-a/machine')).toMatchObject({ status: 'offline', lastCheckedAt: 2, agents: [{ installed: true, stale: true }, { installed: true, stale: true }] });
        expect(store.read('account-b/machine').agents).toEqual([]);
        expect(claudeListener).toHaveBeenCalledTimes(1);
    });
});
