import { describe, expect, it } from 'vitest';

import {
    createMachinePoolEditorTierState,
    isMachinePoolHomeOffline,
    isMachinePoolRefreshFailed,
    moveMachinePoolEditorTier,
    normalizeMachinePoolEditorMembers,
    normalizeMachinePoolEditorTierState,
} from './machinePoolEditorModel';

describe('machinePoolEditorModel', () => {
    it('serializes occupied fallback tiers as contiguous ordinals', () => {
        expect(normalizeMachinePoolEditorMembers([
            { machineId: 'machine-c', priorityTier: 5, enabled: true },
            { machineId: 'machine-a', priorityTier: 2, enabled: true },
            { machineId: 'machine-b', priorityTier: 5, enabled: false },
        ])).toEqual([
            { machineId: 'machine-c', priorityTier: 1, enabled: true },
            { machineId: 'machine-a', priorityTier: 0, enabled: true },
            { machineId: 'machine-b', priorityTier: 1, enabled: false },
        ]);
    });


    it('hydrates a hostile sparse priority without allocating empty tiers', () => {
        expect(createMachinePoolEditorTierState([
            { machineId: 'machine-a', priorityTier: 2_147_483_647, enabled: true },
        ])).toEqual({
            members: [{ machineId: 'machine-a', priorityTier: 0, enabled: true }],
            tierCount: 1,
        });
    });

    it('moves an occupied tier as a unit while preserving unordered member order', () => {
        expect(moveMachinePoolEditorTier([
            { machineId: 'machine-a', priorityTier: 0, enabled: true },
            { machineId: 'machine-c', priorityTier: 1, enabled: true },
            { machineId: 'machine-b', priorityTier: 1, enabled: false },
        ], 1, 0)).toEqual([
            { machineId: 'machine-a', priorityTier: 1, enabled: true },
            { machineId: 'machine-c', priorityTier: 0, enabled: true },
            { machineId: 'machine-b', priorityTier: 0, enabled: false },
        ]);
    });

    it('renumbers visible fallback tiers as soon as an intermediate tier empties', () => {
        // Primary and "Fallback 2" are occupied while "Fallback 1" was just emptied: the form must
        // show Primary + Fallback 1 immediately, not reveal that structure for the first time on Save.
        expect(normalizeMachinePoolEditorTierState([
            { machineId: 'machine-a', priorityTier: 0, enabled: true },
            { machineId: 'machine-b', priorityTier: 2, enabled: true },
        ], 3)).toEqual({
            members: [
                { machineId: 'machine-a', priorityTier: 0, enabled: true },
                { machineId: 'machine-b', priorityTier: 1, enabled: true },
            ],
            tierCount: 2,
        });
    });

    it('preserves a deliberately added trailing fallback tier the user has not filled in yet', () => {
        expect(normalizeMachinePoolEditorTierState([
            { machineId: 'machine-a', priorityTier: 0, enabled: true },
        ], 2)).toEqual({
            members: [{ machineId: 'machine-a', priorityTier: 0, enabled: true }],
            tierCount: 2,
        });
    });

    it('keeps at least the primary tier for a pool with no members', () => {
        expect(normalizeMachinePoolEditorTierState([], 1)).toEqual({ members: [], tierCount: 1 });
    });

    it('blocks writes only while the Home is signed out', () => {
        expect(isMachinePoolHomeOffline('signedOut')).toBe(true);
        expect(isMachinePoolHomeOffline('error')).toBe(false);
    });

    it.each(['idle', 'loading'] as const)('does not classify %s as offline', (status) => {
        expect(isMachinePoolHomeOffline(status)).toBe(false);
    });

    it('reports a failed read as a refresh failure rather than an offline Home', () => {
        expect(isMachinePoolRefreshFailed('error')).toBe(true);
        expect(isMachinePoolRefreshFailed('signedOut')).toBe(false);
        expect(isMachinePoolRefreshFailed('idle')).toBe(false);
    });
});
