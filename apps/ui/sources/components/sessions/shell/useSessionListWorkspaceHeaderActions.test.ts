import { describe, expect, it, vi } from 'vitest';

import { useSessionListWorkspaceHeaderActions } from './useSessionListWorkspaceHeaderActions';
import {
    buildSessionProjectGroupingIdentity,
    sessionProjectGroupingIdentityKey,
} from '@/sync/domains/session/listing/sessionListProjectGroupingKeys';
import type * as WorkspaceRefOperations from '@/sync/ops/workspaceRefs';

const addWorkspaceRefToAccountSpy = vi.hoisted(() => vi.fn<typeof WorkspaceRefOperations.addWorkspaceRefToAccount>(
    async () => ({ ok: true, workspaceRefId: 'workspace-ref-id' }),
));
const resetWorkspaceRefNameInAccountSpy = vi.hoisted(() => vi.fn<typeof WorkspaceRefOperations.resetWorkspaceRefNameInAccount>(
    async () => ({ ok: true }),
));

vi.mock('@/sync/ops/workspaceRefs', () => ({
    addWorkspaceRefToAccount: addWorkspaceRefToAccountSpy,
    resetWorkspaceRefNameInAccount: resetWorkspaceRefNameInAccountSpy,
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            prompt: vi.fn(async () => 'Repo'),
        },
    }).module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => key,
        translateLoose: (key: string) => key,
        getPreferredLanguage: () => 'en',
    });
});

describe('useSessionListWorkspaceHeaderActions', () => {
    it('renames through the semantic WorkspaceRef Account Settings owner', async () => {
        const actions = useSessionListWorkspaceHeaderActions({
            workspaceRefs: [],
            collapsedGroupKeys: {},
            setCollapsedGroupKeys: vi.fn(),
        });

        await actions.handleRenameWorkspace({
            legacyWorkspaceKey: 'legacy-key',
            scopeHint: { serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo' },
            currentLabel: 'Before',
        });

        expect(addWorkspaceRefToAccountSpy).toHaveBeenCalledWith(expect.objectContaining({
            scope: { serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo' },
            patch: { label: 'Repo' },
        }));
    });

    it('resets through the semantic WorkspaceRef Account Settings owner', async () => {
        const actions = useSessionListWorkspaceHeaderActions({
            workspaceRefs: [{
                id: 'workspace-ref-id', serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo',
                label: 'Repo', createdAtMs: 1, lastOpenedAtMs: null,
            }],
            collapsedGroupKeys: {},
            setCollapsedGroupKeys: vi.fn(),
        });

        await actions.handleResetWorkspaceName({
            legacyWorkspaceKey: 'legacy-key',
            scopeHint: { serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo' },
        });

        expect(resetWorkspaceRefNameInAccountSpy).toHaveBeenCalledWith({
            serverId: 'server_a', workspaceRefId: 'workspace-ref-id',
        });
    });

    it('skips rewriting workspace refs when resetting an already unlabelled workspace', async () => {
        resetWorkspaceRefNameInAccountSpy.mockClear();
        const actions = useSessionListWorkspaceHeaderActions({
            workspaceRefs: [
                {
                    id: 'workspace-ref-id',
                    serverId: 'server_a',
                    machineId: 'machine_a',
                    rootPath: '/repo',
                    label: null,
                    createdAtMs: 1,
                    lastOpenedAtMs: null,
                },
            ],
            collapsedGroupKeys: {},
            setCollapsedGroupKeys: vi.fn(),
        });

        await actions.handleResetWorkspaceName({
            legacyWorkspaceKey: 'legacy-key',
            scopeHint: { serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo' },
        });

        expect(resetWorkspaceRefNameInAccountSpy).not.toHaveBeenCalled();
    });

    it('skips rewriting workspace refs when renaming to the current workspace label', async () => {
        addWorkspaceRefToAccountSpy.mockClear();
        const actions = useSessionListWorkspaceHeaderActions({
            workspaceRefs: [
                {
                    id: 'workspace-ref-id',
                    serverId: 'server_a',
                    machineId: 'machine_a',
                    rootPath: '/repo',
                    label: 'Repo',
                    createdAtMs: 1,
                    lastOpenedAtMs: null,
                },
            ],
            collapsedGroupKeys: {},
            setCollapsedGroupKeys: vi.fn(),
        });

        await actions.handleRenameWorkspace({
            legacyWorkspaceKey: 'legacy-key',
            scopeHint: { serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo' },
            currentLabel: 'Repo',
        });

        expect(addWorkspaceRefToAccountSpy).not.toHaveBeenCalled();
    });

    it('stores an explicit expanded tombstone when expanding a collapsed group', () => {
        const setCollapsedGroupKeys = vi.fn();

        const { handleToggleCollapse } = useSessionListWorkspaceHeaderActions({
            workspaceRefs: [],
            collapsedGroupKeys: {
                existing: true,
                alreadyExpanded: false,
            },
            setCollapsedGroupKeys,
        });

        handleToggleCollapse('existing');

        expect(setCollapsedGroupKeys).toHaveBeenCalledWith({
            existing: false,
            alreadyExpanded: false,
        });
    });

    it('toggles only the selected exact project tuple when legacy FNV values collide', () => {
        const keyForMachine = (machineId: string) => sessionProjectGroupingIdentityKey(
            buildSessionProjectGroupingIdentity('home-a', { machineId, pathKey: '/repo' }),
        );
        const groupA = keyForMachine('m29645');
        const groupB = keyForMachine('m41845');
        const setCollapsedGroupKeys = vi.fn();
        const { handleToggleCollapse } = useSessionListWorkspaceHeaderActions({
            workspaceRefs: [],
            collapsedGroupKeys: { [groupA]: true, [groupB]: true },
            setCollapsedGroupKeys,
        });

        handleToggleCollapse(groupA);

        expect(setCollapsedGroupKeys).toHaveBeenCalledWith({
            [groupA]: false,
            [groupB]: true,
        });
    });
});
