import { describe, expect, it } from 'vitest';

import { createMachineFixture } from '@/dev/testkit';
import type { MachinePoolViewV1 } from '@happier-dev/protocol';
import type { Machine } from '@/sync/domains/state/storageTypes';

import {
    buildMachineDestinationModel,
    resolveMachinePoolRowUnavailableReason,
} from './buildMachineDestinationModel';

function machine(id: string, overrides: Partial<Machine> = {}): Machine & { serverId: string; serverName: string } {
    return {
        ...createMachineFixture({ id }),
        active: true,
        activeAt: Date.now(),
        ...overrides,
        serverId: 'server-a',
        serverName: 'Server A',
    } as Machine & { serverId: string; serverName: string };
}

function group(overrides: Partial<Parameters<typeof buildMachineDestinationModel>[0]['groups'][number]> = {}) {
    return {
        serverId: 'server-a',
        serverName: 'Server A',
        loading: false,
        signedOut: false,
        machines: [machine('machine-1')],
        ...overrides,
    } as Parameters<typeof buildMachineDestinationModel>[0]['groups'][number];
}

function pool(id: string): MachinePoolViewV1 {
    return {
        pool: {
            id,
            name: 'Development',
            description: null,
            revision: 1,
            createdAt: 1,
            updatedAt: 1,
            members: [],
        },
        availability: { state: 'known', connectedCount: 1, enabledCount: 1 },
    };
}

describe('resolveMachinePoolRowUnavailableReason', () => {
    it('keeps a current Home selectable even when its cached connection summary reports zero', () => {
        const zeroConnected: MachinePoolViewV1 = {
            ...pool('pool-a'),
            availability: { state: 'known', connectedCount: 0, enabledCount: 2 },
        };
        expect(resolveMachinePoolRowUnavailableReason({
            group: { loading: false, signedOut: false },
            poolGroup: { serverId: 'server-a', pools: [zeroConnected], status: 'idle', projectionReady: true },
        })).toBeNull();
    });

    it('reports the Home fact that blocks activation instead of a generic unavailable state', () => {
        const poolGroup = { serverId: 'server-a', pools: [pool('pool-a')], status: 'idle' as const, projectionReady: true };
        const failedHome = { loading: false, signedOut: false, error: true };
        expect(resolveMachinePoolRowUnavailableReason({
            group: failedHome, poolGroup,
        })).toBe('homeFailed');
        expect(resolveMachinePoolRowUnavailableReason({
            group: { loading: false, signedOut: true }, poolGroup,
        })).toBe('homeSignedOut');
        expect(resolveMachinePoolRowUnavailableReason({
            group: { loading: true, signedOut: false }, poolGroup,
        })).toBe('homeLoading');
        expect(resolveMachinePoolRowUnavailableReason({
            group: { loading: false, signedOut: false },
            poolGroup: { ...poolGroup, status: 'error', projectionReady: false },
        })).toBe('poolsFailed');
        expect(resolveMachinePoolRowUnavailableReason({
            group: { loading: false, signedOut: false },
            poolGroup: { ...poolGroup, status: 'signedOut', projectionReady: false },
        })).toBe('poolsSignedOut');
        expect(resolveMachinePoolRowUnavailableReason({
            group: { loading: false, signedOut: false },
            poolGroup: { ...poolGroup, projectionReady: false },
        })).toBe('poolsLoading');
    });
});

describe('buildMachineDestinationModel', () => {
    it('offers the single admissible Machine only when the whole choice set is settled', () => {
        const model = buildMachineDestinationModel({
            groups: [group()],
            poolGroups: [{ serverId: 'server-a', pools: [], status: 'idle', projectionReady: true }],
        });

        expect(model.destinationRowCount).toBe(1);
        expect(model.destinationSetSettled).toBe(true);
        expect(model.soleSelectableDestination).toEqual({
            serverId: 'server-a',
            machine: expect.objectContaining({ id: 'machine-1' }),
        });
    });

    it('counts a Machine Pool row as a destination, so one Machine plus one Pool is not a shortcut', () => {
        const model = buildMachineDestinationModel({
            groups: [group()],
            poolGroups: [{ serverId: 'server-a', pools: [pool('pool-a')], status: 'idle', projectionReady: true }],
        });

        expect(model.destinationRowCount).toBe(2);
        expect(model.poolRowCount).toBe(1);
        expect(model.soleSelectableDestination).toBeNull();
    });

    it('counts every available Temporary computer artifact in the same destination set', () => {
        const model = buildMachineDestinationModel({
            groups: [group()],
            poolGroups: [{ serverId: 'server-a', pools: [], status: 'idle', projectionReady: true }],
            temporaryComputerProjection: { state: 'available', rowCount: 2 },
        });

        expect(model.destinationRowCount).toBe(3);
        expect(model.temporaryComputerRowCount).toBe(2);
        expect(model.destinationSetSettled).toBe(true);
        expect(model.soleSelectableDestination).toBeNull();
    });

    it('keeps destination completeness pending until Temporary computer availability settles', () => {
        const model = buildMachineDestinationModel({
            groups: [group()],
            poolGroups: [{ serverId: 'server-a', pools: [], status: 'idle', projectionReady: true }],
            temporaryComputerProjection: { state: 'pending', rowCount: 0 },
        });

        expect(model.destinationRowCount).toBe(1);
        expect(model.temporaryComputerRowCount).toBe(0);
        expect(model.destinationSetSettled).toBe(false);
        expect(model.soleSelectableDestination).toBeNull();
    });

    it('treats a known unavailable Temporary computer as an empty settled destination source', () => {
        const model = buildMachineDestinationModel({
            groups: [group()],
            poolGroups: [{ serverId: 'server-a', pools: [], status: 'idle', projectionReady: true }],
            temporaryComputerProjection: { state: 'empty', rowCount: 0 },
        });

        expect(model.destinationRowCount).toBe(1);
        expect(model.destinationSetSettled).toBe(true);
        expect(model.soleSelectableDestination?.machine.id).toBe('machine-1');
    });

    it('treats an unresolved Pool answer as an incomplete set rather than a known-empty one', () => {
        const model = buildMachineDestinationModel({
            groups: [group()],
            poolGroups: [{ serverId: 'server-a', pools: [], status: 'error', projectionReady: false }],
        });

        expect(model.destinationSetSettled).toBe(false);
        expect(model.soleSelectableDestination).toBeNull();
    });

    it.each([
        { label: 'missing', poolGroups: [] },
        {
            label: 'failed',
            poolGroups: [{ serverId: 'server-a', pools: [], status: 'error' as const, projectionReady: true }],
        },
    ])('does not treat a $label Pool projection as a known-empty destination set', ({ poolGroups }) => {
        const model = buildMachineDestinationModel({ groups: [group()], poolGroups });

        expect(model.destinationSetSettled).toBe(false);
        expect(model.soleSelectableDestination).toBeNull();
    });

    it('waits for a loading Home before deciding the set is complete', () => {
        const model = buildMachineDestinationModel({
            groups: [
                group(),
                group({ serverId: 'server-b', loading: true, machines: [] }),
            ],
            poolGroups: [
                { serverId: 'server-a', pools: [], status: 'idle', projectionReady: true },
                { serverId: 'server-b', pools: [], status: 'idle', projectionReady: true },
            ],
        });

        expect(model.destinationSetSettled).toBe(false);
        expect(model.soleSelectableDestination).toBeNull();
    });

    it('keeps a Home with a failed Machine-list refresh out of the settled destination set', () => {
        const failedGroup = { ...group(), error: true };
        const model = buildMachineDestinationModel({
            groups: [failedGroup],
            poolGroups: [{ serverId: 'server-a', pools: [pool('pool-a')], status: 'idle', projectionReady: true }],
        });

        expect(model.destinationSetSettled).toBe(false);
        expect(model.soleSelectableDestination).toBeNull();
    });

    it('excludes an offline-only Home from the shortcut while still counting its rendered row', () => {
        const model = buildMachineDestinationModel({
            groups: [group({ machines: [machine('machine-1', { active: false, activeAt: 0 })] })],
            poolGroups: [{ serverId: 'server-a', pools: [], status: 'idle', projectionReady: true }],
        });

        expect(model.destinationRowCount).toBe(1);
        expect(model.soleSelectableDestination).toBeNull();
    });

    it('does not count a revoked Machine that the single-Home list never renders', () => {
        const model = buildMachineDestinationModel({
            groups: [group({
                machines: [machine('machine-1'), machine('machine-revoked', { revokedAt: 5 })],
            })],
            poolGroups: [{ serverId: 'server-a', pools: [], status: 'idle', projectionReady: true }],
        });

        expect(model.machineRowCount).toBe(1);
        expect(model.soleSelectableDestination?.machine.id).toBe('machine-1');
    });
});
