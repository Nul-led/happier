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

    it('admits an explicit daemon target only through the live canonical machine inventory row', () => {
        const selection = {
            resolveExecutionTarget: () => {
                throw new Error('an explicit scope must not inherit the persisted memory target');
            },
            pickerRows: [{
                serverId: 'server-b',
                candidate: {
                    target: { serverIdentityId: 'server-identity-b', machineId: 'machine-b' },
                    availability: 'online',
                    observation: 'live',
                },
            }],
        };

        expect(resolveDaemonMemorySearchTarget(selection as never, {
            serverId: 'server-b',
            machineId: 'machine-b',
        })).toEqual({ serverId: 'server-b', machineId: 'machine-b' });
        expect(resolveDaemonMemorySearchTarget(selection as never, {
            serverId: 'server-a',
            machineId: 'machine-b',
        })).toBeNull();

        selection.pickerRows[0]!.candidate.availability = 'offline';
        expect(resolveDaemonMemorySearchTarget(selection as never, {
            serverId: 'server-b',
            machineId: 'machine-b',
        })).toBeNull();
    });
});
