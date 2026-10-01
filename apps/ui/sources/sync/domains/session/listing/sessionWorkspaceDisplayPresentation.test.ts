import { describe, expect, it } from 'vitest';

import { resolveSessionWorkspaceDisplayPresentation } from './sessionWorkspaceDisplayPresentation';

describe('resolveSessionWorkspaceDisplayPresentation', () => {
    it('matches workspace refs using the canonical expanded root path while displaying a home-relative fallback', () => {
        const presentation = resolveSessionWorkspaceDisplayPresentation({
            serverId: 'server-1',
            metadata: {
                machineId: 'machine-1',
                path: '~/repo',
                homeDir: '/home/u',
            },
            workspaceRefs: [{
                id: 'workspace-ref-1',
                serverId: 'server-1',
                machineId: 'machine-1',
                rootPath: '/home/u/repo',
                label: 'Main Repo',
                createdAtMs: 1,
                lastOpenedAtMs: null,
            }],
        });

        expect(presentation.workspaceScope).toEqual({
            serverId: 'server-1',
            machineId: 'machine-1',
            rootPath: '/home/u/repo',
        });
        expect(presentation.workspaceRefId).toBe('workspace-ref-1');
        expect(presentation.displayTitle).toBe('Main Repo');
        expect(presentation.hasCustomLabel).toBe(true);
    });

    it('never presents a no-folder session’s private folder as a workspace, even when a ref matches its path', () => {
        const privatePath = '/home/u/.happier/servers/s/session-directories/3f9a';
        const presentation = resolveSessionWorkspaceDisplayPresentation({
            serverId: 'server-1',
            metadata: {
                machineId: 'machine-1',
                path: privatePath,
                homeDir: '/home/u',
                sessionDirectoryV1: { v: 1, kind: 'managed' },
            },
            workspaceRefs: [{
                id: 'workspace-ref-1',
                serverId: 'server-1',
                machineId: 'machine-1',
                rootPath: privatePath,
                label: 'Leaked',
                createdAtMs: 1,
                lastOpenedAtMs: null,
            }],
        });

        expect(presentation.directoryKind).toBe('managed');
        expect(presentation.workspaceScope).toBeNull();
        expect(presentation.workspaceRefId).toBeNull();
        expect(presentation.displayTitle).not.toContain('3f9a');
        expect(presentation.displayTitle).not.toBe('Leaked');
    });

    it('reads a session without the marker (every 0.2 session) as a folder', () => {
        const presentation = resolveSessionWorkspaceDisplayPresentation({
            serverId: 'server-1',
            metadata: { machineId: 'machine-1', path: '/home/u/repo', homeDir: '/home/u', sessionDirectoryV1: { v: 2 } },
            workspaceRefs: [],
        });
        expect(presentation.directoryKind).toBe('path');
        expect(presentation.workspaceScope).not.toBeNull();
    });
});
