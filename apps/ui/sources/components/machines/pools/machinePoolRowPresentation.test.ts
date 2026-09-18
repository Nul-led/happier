import { describe, expect, it } from 'vitest';
import type { MachinePoolViewV1 } from '@happier-dev/protocol';

import {
    buildMachinePoolRowPresentations,
    resolveMachinePoolEnabledMemberLabels,
    resolveMachinePoolMemberLabel,
} from './machinePoolRowPresentation';

const POOL_A = '3a948f0c-bc30-491c-b764-37f0e6744d1f';
const POOL_B = '7c1d0e22-5f0b-4a7e-9d3a-2b6c8e4f1a05';

function pool(id: string, name: string, machineIds: readonly string[]): MachinePoolViewV1 {
    return {
        pool: {
            id,
            name,
            description: null,
            revision: 1,
            createdAt: 1,
            updatedAt: 1,
            members: machineIds.map((machineId, index) => ({
                machineId,
                priorityTier: index,
                enabled: true,
                state: 'connected' as const,
            })),
        },
        availability: { state: 'known', connectedCount: 1, enabledCount: 1 },
    };
}

const MACHINES = [
    { id: 'machine-a', metadata: { displayName: 'Mac Studio', host: 'studio.local' } },
    { id: 'machine-b', metadata: { displayName: null, host: 'linux-box' } },
];

const preview = (view: MachinePoolViewV1) => view.pool.members
    .map((member) => resolveMachinePoolMemberLabel(member.machineId, MACHINES))
    .join(', ');

describe('machine pool row presentation', () => {
    it('keeps duplicate names valid while making colliding rows distinct visually and accessibly', () => {
        const rows = buildMachinePoolRowPresentations([
            pool(POOL_A, 'Development', ['machine-a']),
            pool(POOL_B, 'Development', ['machine-a']),
        ], preview);

        expect(rows.map((row) => row.view.pool.name)).toEqual(['Development', 'Development']);
        expect(rows[0]?.identityDetail).toBe(POOL_A.slice(0, 8));
        expect(rows[1]?.identityDetail).toBe(POOL_B.slice(0, 8));
        expect(rows[0]?.accessibilityName).toContain(POOL_A);
        expect(rows[1]?.accessibilityName).toContain(POOL_B);
        expect(rows[0]?.accessibilityName).not.toBe(rows[1]?.accessibilityName);
    });

    it('extends identity hints to the shortest unique prefixes when colliding Pool IDs share eight characters', () => {
        const poolA = '3a948f0c-aaaa-491c-b764-37f0e6744d1f';
        const poolB = '3a948f0c-bbbb-4a7e-9d3a-2b6c8e4f1a05';
        const rows = buildMachinePoolRowPresentations([
            pool(poolA, 'Development', ['machine-a']),
            pool(poolB, 'Development', ['machine-a']),
        ], preview);

        expect(rows.map((row) => row.identityDetail)).toEqual([
            '3a948f0c-a',
            '3a948f0c-b',
        ]);
        expect(rows[0]?.accessibilityName).toContain(poolA);
        expect(rows[1]?.accessibilityName).toContain(poolB);
    });

    it('uses the full Pool ID when the final character is required to distinguish colliding rows', () => {
        const poolA = '3a948f0c-bc30-491c-b764-37f0e6744d1a';
        const poolB = '3a948f0c-bc30-491c-b764-37f0e6744d1b';
        const rows = buildMachinePoolRowPresentations([
            pool(poolA, 'Development', ['machine-a']),
            pool(poolB, 'Development', ['machine-a']),
        ], preview);

        expect(rows.map((row) => row.identityDetail)).toEqual([poolA, poolB]);
    });

    it('separates same-name pools by their readable member context before exposing identity', () => {
        const rows = buildMachinePoolRowPresentations([
            pool(POOL_A, 'Development', ['machine-a']),
            pool(POOL_B, 'Development', ['machine-b']),
        ], preview);

        expect(rows[0]?.memberPreview).toBe('Mac Studio');
        expect(rows[1]?.memberPreview).toBe('linux-box');
        expect(rows.every((row) => row.identityDetail === null)).toBe(true);
        expect(rows[0]?.accessibilityName).toBe('Development');
    });

    it('leaves a uniquely named pool undecorated', () => {
        const rows = buildMachinePoolRowPresentations([
            pool(POOL_A, 'Development', ['machine-a']),
            pool(POOL_B, 'Release', ['machine-a']),
        ], preview);

        expect(rows.map((row) => row.identityDetail)).toEqual([null, null]);
        expect(rows.map((row) => row.accessibilityName)).toEqual(['Development', 'Release']);
    });

    it('uses an honest short identifier for a member whose decrypted label is missing', () => {
        expect(resolveMachinePoolMemberLabel('machine-unknown-long-id', MACHINES)).toBe('machine-');
        expect(resolveMachinePoolMemberLabel('machine-b', MACHINES)).toBe('linux-box');
    });

    it('projects only enabled member labels before applying a presentation limit', () => {
        const base = pool(POOL_A, 'Development', [
            'disabled-a',
            'disabled-b',
            'machine-a',
            'machine-b',
        ]);
        const view: MachinePoolViewV1 = {
            ...base,
            pool: {
                ...base.pool,
                members: base.pool.members.map((member, index) => ({
                    ...member,
                    enabled: index >= 2,
                })),
            },
        };

        expect(resolveMachinePoolEnabledMemberLabels(view, MACHINES, { limit: 2 }))
            .toEqual(['Mac Studio', 'linux-box']);
        expect(resolveMachinePoolEnabledMemberLabels(view, MACHINES))
            .toEqual(['Mac Studio', 'linux-box']);
    });
});
