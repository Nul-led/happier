import { describe, expect, it } from 'vitest';

import { resolvePendingActivationWakeOwner, shouldDelegatePendingActivationToDaemon } from './pendingActivationWakeDecision';

describe('pending activation wake ownership', () => {
    it.each([
        [2, true, 'daemon'],
        [2, false, 'ui'],
        [2, undefined, 'ui'],
        [1, true, 'ui'],
        [undefined, true, 'ui'],
    ] as const)('delegates only for exact server V2 plus the exact machine bit', (protocolVersion, daemonSupported, expected) => {
        expect(resolvePendingActivationWakeOwner({
            pendingInputProtocolVersion: protocolVersion,
            daemonPendingSessionActivationSupported: daemonSupported,
        })).toBe(expected);
    });

    it('queries the session server and exact wake target machine', async () => {
        const requestedMachines: string[] = [];
        const delegated = await shouldDelegatePendingActivationToDaemon({
            session: { serverId: 'server-owned', ownerMetadataView: { machineId: 'old-machine' } } as any,
            machineId: 'exact-target',
            getServerFeaturesSnapshot: async (params) => {
                expect(params).toEqual({ serverId: 'server-owned' });
                return { status: 'ready', features: { capabilities: { session: { pendingInput: { protocolVersion: 2 } } }, features: {} } } as any;
            },
            getMachine: (machineId) => {
                requestedMachines.push(machineId);
                return { daemonState: { daemonPendingSessionActivationSupported: machineId === 'exact-target' } } as any;
            },
        });

        expect(delegated).toBe(true);
        expect(requestedMachines).toEqual(['exact-target']);
    });

    it('ignores a sticky metadata bit when the current daemon state does not advertise support', async () => {
        const base = {
            session: { serverId: 'server-owned', ownerMetadataView: { machineId: 'exact-target' } } as any,
            machineId: 'exact-target',
            getServerFeaturesSnapshot: async () => ({
                status: 'ready',
                features: { capabilities: { session: { pendingInput: { protocolVersion: 2 } } }, features: {} },
            } as any),
        };
        await expect(shouldDelegatePendingActivationToDaemon({
            ...base,
            getMachine: () => ({ metadata: { daemonPendingSessionActivationSupported: true }, daemonState: null } as any),
        })).resolves.toBe(false);
        await expect(shouldDelegatePendingActivationToDaemon({
            ...base,
            getMachine: () => ({ daemonState: { daemonPendingSessionActivationSupported: true } } as any),
        })).resolves.toBe(true);
    });
});
