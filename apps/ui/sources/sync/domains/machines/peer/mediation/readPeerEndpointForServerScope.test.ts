import { describe, expect, it, vi } from 'vitest';

const appliedState = vi.hoisted(() => ({ serverId: 'home_a' }));

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    getAppliedActiveServerId: () => appliedState.serverId,
}));

import { readPeerEndpointForServerScope } from './readPeerEndpointForServerScope';

const focusedEndpoint = { endpointId: 'focused-endpoint' };
const scopedEndpoint = { endpointId: 'scoped-endpoint' };

describe('readPeerEndpointForServerScope', () => {
    const state = {
        machines: {
            shared_machine: {
                id: 'shared_machine',
                daemonState: { peerMediation: { iroh: { endpoint: focusedEndpoint } } },
            },
        },
        machineListByServerId: {
            home_b: [{
                id: 'shared_machine',
                daemonState: { peerMediation: { iroh: { endpoint: scopedEndpoint } } },
            }],
            home_c: [],
        },
    };

    it('uses the focused projection only for the active Home', () => {
        expect(readPeerEndpointForServerScope({
            state,
            serverId: 'home_a',
            machineId: 'shared_machine',
            select: (machine) => machine.daemonState?.peerMediation?.iroh?.endpoint,
        })).toBe(focusedEndpoint);
    });

    it('uses only the target Home projection for a non-focused Home', () => {
        expect(readPeerEndpointForServerScope({
            state,
            serverId: 'home_b',
            machineId: 'shared_machine',
            select: (machine) => machine.daemonState?.peerMediation?.iroh?.endpoint,
        })).toBe(scopedEndpoint);

        expect(readPeerEndpointForServerScope({
            state,
            serverId: 'home_c',
            machineId: 'shared_machine',
            select: (machine) => machine.daemonState?.peerMediation?.iroh?.endpoint,
        })).toBeNull();
    });

    it('uses applied focus rather than a staged caller snapshot when machine ids overlap', () => {
        appliedState.serverId = 'home_a';

        expect(readPeerEndpointForServerScope({
            state,
            serverId: 'home_b',
            machineId: 'shared_machine',
            select: (machine) => machine.daemonState?.peerMediation?.iroh?.endpoint,
        })).toBe(scopedEndpoint);
    });
});
