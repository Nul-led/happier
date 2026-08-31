import { describe, expect, it } from 'vitest';

import { computeNextSessionMcpSelectionMetadata } from './sessionMcpSelectionPublish';

describe('computeNextSessionMcpSelectionMetadata', () => {
    it('writes only the canonical mcpSelectionV1 metadata field', () => {
        const next = computeNextSessionMcpSelectionMetadata({
            path: '/repo',
            host: 'qa-host',
            mcpSelection: { forceIncludeServerIds: ['legacy'] },
        }, {
            v: 1,
            managedServersEnabled: false,
            forceIncludeServerIds: ['managed-1'],
            forceExcludeServerIds: ['managed-2'],
        });

        expect(next).toMatchObject({
            path: '/repo',
            mcpSelectionV1: {
                v: 1,
                managedServersEnabled: false,
                forceIncludeServerIds: ['managed-1'],
                forceExcludeServerIds: ['managed-2'],
            },
        });
        expect('mcpSelection' in next).toBe(false);
    });

    it('retains the applied baseline only while an active selection really differs', () => {
        const current = {
            path: '/repo',
            host: 'qa-host',
            mcpSelectionV1: {
                v: 1 as const,
                managedServersEnabled: true,
                forceIncludeServerIds: [],
                forceExcludeServerIds: [],
            },
        };
        const changed = computeNextSessionMcpSelectionMetadata(current, {
            v: 1,
            managedServersEnabled: true,
            forceIncludeServerIds: ['server-new'],
            forceExcludeServerIds: [],
        }, { sessionActive: true });
        expect(changed.mcpSelectionRestartRequiredV1).toEqual({
            v: 1,
            appliedSelection: current.mcpSelectionV1,
        });

        const reverted = computeNextSessionMcpSelectionMetadata(changed, current.mcpSelectionV1, {
            sessionActive: true,
        });
        expect(reverted.mcpSelectionRestartRequiredV1).toBeUndefined();

        const inactive = computeNextSessionMcpSelectionMetadata(changed, changed.mcpSelectionV1!, {
            sessionActive: false,
        });
        expect(inactive.mcpSelectionRestartRequiredV1).toBeUndefined();
    });
});
