import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { useOpenProject } from './useOpenProject';

const routerPush = vi.hoisted(() => vi.fn());
const paneDispatch = vi.hoisted(() => vi.fn());

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { push: routerPush } }).module;
});
vi.mock('@/utils/platform/responsive', () => ({ useDeviceType: () => 'phone' }));
vi.mock('@/components/workspaceCockpit/useMobileWorkspaceExperienceState', () => ({
    useMobileWorkspaceExperienceState: () => ({ cockpitEnabled: true }),
}));
vi.mock('@/components/appShell/panes/AppPaneProvider', () => ({
    useOptionalAppPaneContext: () => ({ state: { scopes: {} }, dispatch: paneDispatch }),
}));
vi.mock('@/sync/domains/state/storage', () => ({
    useSetting: () => [{
        id: 'wr_1',
        serverId: 'server-a',
        machineId: 'machine-a',
        rootPath: '/repo',
        label: null,
        createdAtMs: 1,
        lastOpenedAtMs: null,
    }],
    useProjectLastMobileSurfacesByWorkspaceRefId: () => ({}),
    useLocalSetting: () => ({}),
}));

describe('useOpenProject', () => {
    beforeEach(() => {
        standardCleanup();
        routerPush.mockReset();
        paneDispatch.mockReset();
    });

    it('opens an initial saved-workspace file in the project details owner', async () => {
        const hook = await renderHook(() => useOpenProject());

        expect(hook.getCurrent()('wr_1', {
            activeRootPath: '/repo',
            initialResource: { kind: 'file', path: 'src/index.ts' },
        })).toBe(true);
        expect(paneDispatch).toHaveBeenCalledWith({
            type: 'openDetailsTab',
            scopeId: 'project:wr_1',
            openAs: 'pinned',
            tab: {
                key: 'file:src/index.ts',
                kind: 'file',
                title: 'index.ts',
                resource: { kind: 'file', path: 'src/index.ts' },
            },
        });
        expect(routerPush).toHaveBeenCalledWith('/projects/wr_1/details?worktreeId=%40root&sourceSurface=browse');
    });
});
