import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { machineFilesystemListDirectory } from '@/sync/ops/machineFileBrowser';
import { useWorkspaceRepositoryTreeBrowser } from './useWorkspaceRepositoryTreeBrowser';

// Remote filesystem boundary: the directory parser, cache and lazy tree remain real.
vi.mock('@/sync/ops/machineFileBrowser', () => ({ machineFilesystemListDirectory: vi.fn() }));

const scope = { serverId: 'server-1', machineId: 'm1', rootPath: '/visibility-live' };

describe('Project workspace tree', () => {
    it('switches Project/All files locally and preserves revealed ignored targets', async () => {
        vi.mocked(machineFilesystemListDirectory).mockImplementation(async (_machine, request) => ({
            ok: true,
            path: request.path,
            truncated: false,
            gitIgnoreAvailable: true,
            entries: request.path !== '/visibility-live' ? [] : [
                { name: 'ignored.log', path: '/visibility-live/ignored.log', type: 'file', gitIgnored: true },
                { name: '.env.example', path: '/visibility-live/.env.example', type: 'file', gitIgnored: false },
            ],
        }));
        let api: ReturnType<typeof useWorkspaceRepositoryTreeBrowser> | undefined;
        function Test({ mode, preservedPaths = [] }: { mode: 'project' | 'all'; preservedPaths?: string[] }) {
            api = useWorkspaceRepositoryTreeBrowser({ scope, enabled: true, visibilityMode: mode, preservedPaths });
            return null;
        }
        const screen = await renderScreen(<Test mode="project" />);
        await act(async () => {});
        expect(api?.nodes.map(n => n.path)).toEqual(['.env.example']);
        expect(api?.gitIgnoreAvailable).toBe(true);
        vi.mocked(machineFilesystemListDirectory).mockClear();
        await act(async () => { screen.update(<Test mode="all" />); });
        expect(api?.nodes.map(n => n.path)).toEqual(['.env.example', 'ignored.log']);
        await act(async () => { screen.update(<Test mode="project" preservedPaths={['ignored.log']} />); });
        expect(api?.nodes.map(n => n.path)).toEqual(['.env.example', 'ignored.log']);
        expect(machineFilesystemListDirectory).not.toHaveBeenCalled();
    });
});
