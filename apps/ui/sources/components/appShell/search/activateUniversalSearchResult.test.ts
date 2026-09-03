import { describe, expect, it, vi } from 'vitest';

import { activateUniversalSearchResult } from './activateUniversalSearchResult';
import type { UniversalSearchTarget } from './universalSearchResult';

async function expectSavedWorkspaceResourceOpensInProject(
    target: UniversalSearchTarget,
    initialResource: Readonly<{ kind: 'file'; path: string }> | Readonly<{ kind: 'commit'; sha: string }>,
): Promise<void> {
    const openProject = vi.fn(() => true);
    const outcome = await activateUniversalSearchResult(target, {
        navigateToSession: vi.fn(),
        push: vi.fn(),
        openProject,
    });

    expect(outcome).toEqual({ ok: true });
    expect(openProject).toHaveBeenCalledWith('wr_1', {
        activeRootPath: '/repo',
        initialResource,
    });
}

describe('activateUniversalSearchResult', () => {
    it('opens project results through the canonical project-opening owner', async () => {
        const push = vi.fn();
        const openProject = vi.fn(() => true);

        const outcome = await activateUniversalSearchResult({
            kind: 'project',
            workspaceRefId: 'wr_1',
            serverId: 'home-a',
            machineId: 'machine-a',
            rootPath: '/repo',
        }, {
            navigateToSession: vi.fn(),
            push,
            openProject,
        });

        expect(outcome).toEqual({ ok: true });
        expect(openProject).toHaveBeenCalledWith('wr_1');
        expect(push).not.toHaveBeenCalled();
    });

    it('reports a project that the canonical opener can no longer resolve as unavailable', async () => {
        const outcome = await activateUniversalSearchResult({
            kind: 'project',
            workspaceRefId: 'retired',
            serverId: 'home-a',
            machineId: 'machine-a',
            rootPath: '/gone',
        }, {
            navigateToSession: vi.fn(),
            push: vi.fn(),
            openProject: () => false,
        });

        expect(outcome).toEqual({ ok: false, reason: 'unavailable' });
    });

    it('opens a saved workspace file through the canonical project opener without a Session', async () => {
        await expectSavedWorkspaceResourceOpensInProject({
            kind: 'workspaceFile',
            path: 'src/index.ts',
            scope: { serverId: 'home-a', machineId: 'machine-a', rootPath: '/repo' },
            workspaceRefId: 'wr_1',
            sessionId: null,
            serverId: 'home-a',
        }, { kind: 'file', path: 'src/index.ts' });
    });

    it('opens a saved workspace commit through the canonical project opener without a Session', async () => {
        await expectSavedWorkspaceResourceOpensInProject({
            kind: 'workspaceCommit',
            sha: 'abc123',
            scope: { serverId: 'home-a', machineId: 'machine-a', rootPath: '/repo' },
            workspaceRefId: 'wr_1',
            sessionId: null,
            serverId: 'home-a',
        }, { kind: 'commit', sha: 'abc123' });
    });
});
