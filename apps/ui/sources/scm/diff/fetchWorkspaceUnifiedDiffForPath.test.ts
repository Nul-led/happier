import { describe, expect, it, vi } from 'vitest';

const machineScmDiffFileMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/scm/machineScm', () => ({
    machineScmDiffFile: (...args: unknown[]) => machineScmDiffFileMock(...args),
}));

vi.mock('@/sync/ops/workspaceFileSystem', () => ({
    workspaceReadFile: vi.fn(),
}));

describe('fetchWorkspaceUnifiedDiffForPath', () => {
    it('shares workspace patches and isolates server, machine, root and refresh', async () => {
        const { ScmDiffCache } = await import('../diffCache/scmDiffCache');
        const { fetchWorkspaceUnifiedDiffForPath } = await import('./fetchWorkspaceUnifiedDiffForPath');
        const diffCache = new ScmDiffCache({ maxEntries: 10, maxTotalBytes: 10_000, now: () => 1 });
        let requests = 0;
        machineScmDiffFileMock.mockImplementation(async () => ({ success: true, diff: `@@ -1 +1 @@\n-old\n+patch${++requests}\n` }));
        const request = { scope: { serverId: 'a', machineId: 'm', rootPath: '/repo' }, diffArea: 'pending' as const, path: 'a.ts', file: null, normalizeError: String, fallbackError: 'failed', snapshotSignature: 'fresh1', diffCache };
        const [first, second] = await Promise.all([fetchWorkspaceUnifiedDiffForPath(request), fetchWorkspaceUnifiedDiffForPath(request)]);
        expect(first).toEqual(second);
        expect(await fetchWorkspaceUnifiedDiffForPath(request)).toEqual(first);
        expect(requests).toBe(1);
        for (const scope of [{ ...request.scope, serverId: 'b' }, { ...request.scope, machineId: 'm2' }, { ...request.scope, rootPath: '/other' }]) {
            expect(await fetchWorkspaceUnifiedDiffForPath({ ...request, scope })).not.toEqual(first);
        }
        expect(await fetchWorkspaceUnifiedDiffForPath({ ...request, snapshotSignature: 'fresh2' })).not.toEqual(first);
        expect(requests).toBe(5);
    });

    it('keeps workspace server scope when requesting a machine SCM file diff', async () => {
        machineScmDiffFileMock.mockResolvedValue({
            success: true,
            diff: '',
        });

        const { fetchWorkspaceUnifiedDiffForPath } = await import('./fetchWorkspaceUnifiedDiffForPath');
        const response = await fetchWorkspaceUnifiedDiffForPath({
            scope: {
                serverId: 'server-a',
                machineId: 'machine-a',
                rootPath: '/repo',
            },
            diffArea: 'pending',
            path: 'src/app.ts',
            file: null,
            normalizeError: (input) => String(input),
            fallbackError: 'Failed to load diff',
        });

        expect(response).toEqual({ success: true, diff: '' });
        expect(machineScmDiffFileMock).toHaveBeenCalledWith(
            'machine-a',
            {
                cwd: '/repo',
                path: 'src/app.ts',
                area: 'pending',
            },
            { serverId: 'server-a' },
        );
    });
});
