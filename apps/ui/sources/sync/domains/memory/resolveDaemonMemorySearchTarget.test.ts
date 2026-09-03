import { describe, expect, it, vi } from 'vitest';

import { resolveDaemonMemorySearchTarget } from './resolveDaemonMemorySearchTarget';

describe('resolveDaemonMemorySearchTarget', () => {
    it('uses the explicitly selected memory machine and its own server scope', () => {
        const resolveExecutionTarget = vi.fn(() => ({
            kind: 'resolved' as const,
            serverId: 'server-b',
            machine: { id: 'machine-b' },
        }));

        expect(resolveDaemonMemorySearchTarget({ resolveExecutionTarget } as never)).toEqual({
            serverId: 'server-b',
            machineId: 'machine-b',
        });
    });

    it('has no arbitrary first-machine fallback when no usable target is selected', () => {
        expect(resolveDaemonMemorySearchTarget({ resolveExecutionTarget: () => null } as never)).toBeNull();
    });

    it('rejects a target whose machine or server identity is blank', () => {
        expect(resolveDaemonMemorySearchTarget({
            resolveExecutionTarget: () => ({ kind: 'resolved', serverId: '  ', machine: { id: 'machine-b' } }),
        } as never)).toBeNull();
        expect(resolveDaemonMemorySearchTarget({
            resolveExecutionTarget: () => ({ kind: 'resolved', serverId: 'server-b', machine: { id: '' } }),
        } as never)).toBeNull();
    });
});
