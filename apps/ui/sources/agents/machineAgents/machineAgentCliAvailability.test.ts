import { describe, expect, it } from 'vitest';
import type { CapabilitiesDetectResponse, MachineAgentInventoryItem } from '@happier-dev/protocol/capabilities';

import { createMachineAgentInventoryStore } from './machineAgentInventoryStore';
import { projectMachineAgentsToCliAvailability } from './machineAgentCliAvailability';

function inventory() {
    const item: MachineAgentInventoryItem = {
        agentId: 'codex', title: 'Codex', installed: false, version: null, latestVersion: null,
        update: { supported: false, command: null },
        signIn: { status: 'unknown', loginSupport: 'status_only' },
        platform: { supported: true },
        install: { available: false, mode: 'manual', sizeBytes: null, guideUrl: null }, dependencies: [],
    };
    const store = createMachineAgentInventoryStore();
    store.publish('machine', { status: 'ready', items: [item], lastCheckedAt: 12 });
    return { ...store.read('machine'), refresh: async () => {} };
}

describe('machine-agent CLI display adapter', () => {
    it.each([false, true])('preserves loaded tmux availability (%s) without reading Agent facts from tool capabilities', (available) => {
        const systemToolCapabilities: CapabilitiesDetectResponse = {
            protocolVersion: 1,
            results: {
                'tool.tmux': { ok: true, checkedAt: 13, data: { available } },
                'cli.codex': { ok: true, checkedAt: 13, data: { available: true } },
            },
        };
        const input = { ...inventory(), systemToolCapabilities };
        const display = projectMachineAgentsToCliAvailability(input);

        expect(display.tmux).toBe(available);
        expect(display.available.codex).toBe(false);
    });

    it('keeps tmux unknown when no successful tool observation exists', () => {
        expect(projectMachineAgentsToCliAvailability(inventory()).tmux).toBeNull();
        const input = { ...inventory(), systemToolCapabilities: {
            protocolVersion: 1,
            results: { 'tool.tmux': { ok: false, checkedAt: 13, error: { message: 'offline' } } },
        } satisfies CapabilitiesDetectResponse };
        expect(projectMachineAgentsToCliAvailability(input).tmux).toBeNull();
    });
});
