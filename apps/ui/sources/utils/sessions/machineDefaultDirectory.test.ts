import { describe, expect, it } from 'vitest';

import type { Machine } from '@/sync/domains/state/storageTypes';

import { resolveDefaultDirectoryForMachine } from './machineDefaultDirectory';

const machines = [
    { id: 'machine-1', metadata: { homeDir: '/home/dev' } },
    { id: 'machine-2', metadata: {} },
] as unknown as readonly Machine[];

describe('default directory for a Machine', () => {
    it('prefers the most recent folder over the home directory', () => {
        expect(resolveDefaultDirectoryForMachine({
            machineId: 'machine-1',
            machines,
            recentPaths: ['/home/dev/repo', '/home/dev/other'],
        })).toBe('/home/dev/repo');
    });

    it('falls back to the home directory for a Machine with no history', () => {
        expect(resolveDefaultDirectoryForMachine({
            machineId: 'machine-1',
            machines,
            recentPaths: ['   '],
        })).toBe('/home/dev');
    });

    it('stays visibly unresolved when neither is known', () => {
        expect(resolveDefaultDirectoryForMachine({
            machineId: 'machine-2',
            machines,
            recentPaths: [],
        })).toBe('');
        expect(resolveDefaultDirectoryForMachine({
            machineId: null,
            machines,
            recentPaths: ['/home/dev/repo'],
        })).toBe('');
    });
});
