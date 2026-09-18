import { describe, expect, it, vi } from 'vitest';

import { runDirectorySourceRemoval } from './directorySourceRemoval';

const impact = {
    v: 1 as const,
    status: 'allowed' as const,
    sourceId: 'source-1',
    sourceLabel: 'Acme directory',
    impact: {
        teamMembershipsRemoved: 2,
        groupMembershipsRemoved: 6,
        groupContributionsRemoved: 3,
        directoryCreatedGroupsRetained: 1,
        nativeMembershipsPreserved: 4,
        nativeGroupContributionsPreserved: 5,
    },
};

describe('runDirectorySourceRemoval', () => {
    it('uses a fresh impact read and does not mutate when the person cancels', async () => {
        const readImpact = vi.fn(async () => ({ ok: true as const, value: impact }));
        const confirm = vi.fn(async () => false);
        const remove = vi.fn();

        const result = await runDirectorySourceRemoval({
            sourceId: 'source-1',
            readImpact,
            confirm,
            remove,
        });

        expect(result).toEqual({ kind: 'cancelled' });
        expect(readImpact).toHaveBeenCalledTimes(1);
        expect(confirm).toHaveBeenCalledWith(impact);
        expect(remove).not.toHaveBeenCalled();
    });

    it('rejects a stale cross-source impact before confirmation or mutation', async () => {
        const confirm = vi.fn();
        const remove = vi.fn();

        const result = await runDirectorySourceRemoval({
            sourceId: 'source-2',
            readImpact: async () => ({ ok: true, value: impact }),
            confirm,
            remove,
        });

        expect(result).toEqual({ kind: 'failed', code: 'directory_source_changed' });
        expect(confirm).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it('mutates only after confirmed current-source impact', async () => {
        const remove = vi.fn(async () => ({ ok: true as const, value: { v: 1 as const, status: 'removed' as const, impact: impact.impact } }));

        const result = await runDirectorySourceRemoval({
            sourceId: 'source-1',
            readImpact: async () => ({ ok: true, value: impact }),
            confirm: async () => true,
            remove,
        });

        expect(result).toEqual({ kind: 'removed' });
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('fails closed without confirmation or mutation when the fresh impact read is unavailable', async () => {
        const confirm = vi.fn();
        const remove = vi.fn();

        const result = await runDirectorySourceRemoval({
            sourceId: 'source-1',
            readImpact: async () => ({
                ok: false as const,
                failure: { code: 'directory_source_not_found' as const, retryable: false as const },
            }),
            confirm,
            remove,
        });

        expect(result).toEqual({ kind: 'failed', code: 'directory_source_not_found' });
        expect(confirm).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });
});
