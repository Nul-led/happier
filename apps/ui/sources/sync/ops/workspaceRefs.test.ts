import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    addWorkspaceRefToAccount,
    migrateLegacyWorkspaceLabelInAccount,
    removeWorkspaceRefFromAccount,
    renameWorkspaceRefInAccount,
    resetWorkspaceRefNameInAccount,
    setWorkspaceRefPinnedInAccount,
} from './workspaceRefs';

const refreshAccountSettingsFromServerSpy = vi.hoisted(() => vi.fn());
const mutateAccountSettingsOnceSpy = vi.hoisted(() => vi.fn());
const getStateSpy = vi.hoisted(() => vi.fn());
const settingsScope = { serverId: 'server', accountId: 'account' } as const;

vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({
        refreshAccountSettingsFromServer: refreshAccountSettingsFromServerSpy,
        mutateAccountSettingsOnce: mutateAccountSettingsOnceSpy,
    }),
}));

vi.mock('@/sync/domains/state/storageStore', () => ({
    getStorage: () => ({ getState: getStateSpy }),
}));

describe('removeWorkspaceRefFromAccount', () => {
    beforeEach(() => {
        refreshAccountSettingsFromServerSpy.mockReset();
        mutateAccountSettingsOnceSpy.mockReset();
        getStateSpy.mockReset();
        getStateSpy
            .mockReturnValueOnce({ settingsVersion: 4, settingsScope })
            .mockReturnValue({ settingsVersion: 5, settingsScope });
        refreshAccountSettingsFromServerSpy.mockResolvedValue(undefined);
    });

    it('refreshes after relationship coordination and removes against the current CAS winner', async () => {
        const concurrentRef = {
            id: 'concurrent-ref',
            serverId: 'server',
            machineId: 'machine-c',
            rootPath: '/concurrent',
            label: null,
            createdAtMs: 2,
            lastOpenedAtMs: null,
        };
        mutateAccountSettingsOnceSpy.mockImplementationOnce(async (input) => {
            const result = input.mutate({
                workspaceRefsV1: [{
                    id: 'target-ref',
                    serverId: 'server',
                    machineId: 'machine-t',
                    rootPath: '/target',
                    label: null,
                    createdAtMs: 1,
                    lastOpenedAtMs: null,
                }, concurrentRef],
                workspaceSyncRelationshipsV1: [],
                pinnedWorkspaceRefIdsV1: ['target-ref', 'concurrent-ref'],
            });
            expect(result.settings.workspaceRefsV1).toEqual([concurrentRef]);
            return { status: 'applied', settingsVersion: 6, value: result.value };
        });

        await expect(removeWorkspaceRefFromAccount({
            serverId: 'server',
            workspaceRefId: 'target-ref',
        })).resolves.toEqual({ ok: true });

        expect(refreshAccountSettingsFromServerSpy).toHaveBeenCalledWith(4, settingsScope);
        expect(mutateAccountSettingsOnceSpy).toHaveBeenCalledWith(expect.objectContaining({
            expectedSettingsScope: settingsScope,
            expectedSettingsVersion: 5,
        }));
    });

    it('returns the current in-use decision when a relationship appears concurrently', async () => {
        mutateAccountSettingsOnceSpy.mockResolvedValueOnce({
            status: 'applied',
            settingsVersion: 6,
            value: {
                ok: false,
                code: 'workspace_ref_in_use',
                relationshipIds: ['relationship-new'],
            },
        });

        await expect(removeWorkspaceRefFromAccount({
            serverId: 'server',
            workspaceRefId: 'target-ref',
        })).resolves.toEqual({
            ok: false,
            code: 'workspace_ref_in_use',
            relationshipIds: ['relationship-new'],
        });
    });

    it('fails closed when another settings winner races the removal', async () => {
        mutateAccountSettingsOnceSpy.mockResolvedValueOnce({
            status: 'conflict',
            currentSettingsVersion: 6,
        });

        await expect(removeWorkspaceRefFromAccount({
            serverId: 'server',
            workspaceRefId: 'target-ref',
        })).resolves.toEqual({ ok: false, code: 'workspace_settings_changed' });
    });
});

describe('workspace ref semantic Account Settings mutations', () => {
    beforeEach(() => {
        refreshAccountSettingsFromServerSpy.mockReset();
        mutateAccountSettingsOnceSpy.mockReset();
        getStateSpy.mockReset();
        getStateSpy
            .mockReturnValueOnce({ settingsVersion: 10, settingsScope })
            .mockReturnValue({ settingsVersion: 11, settingsScope });
        refreshAccountSettingsFromServerSpy.mockResolvedValue(undefined);
    });

    it.each([
        ['rename', () => renameWorkspaceRefInAccount({ serverId: 'server', workspaceRefId: 'target-ref', label: 'Renamed' })],
        ['reset', () => resetWorkspaceRefNameInAccount({ serverId: 'server', workspaceRefId: 'target-ref' })],
        ['pin', () => setWorkspaceRefPinnedInAccount({ serverId: 'server', workspaceRefId: 'target-ref', pinned: true })],
        ['unpin', () => setWorkspaceRefPinnedInAccount({ serverId: 'server', workspaceRefId: 'target-ref', pinned: false })],
        ['legacy label migration', () => migrateLegacyWorkspaceLabelInAccount({
            scope: { serverId: 'server', machineId: 'machine-t', rootPath: '/target' },
            legacyKey: 'legacy-target',
            label: 'Legacy',
            nowMs: 3,
        })],
    ])('%s uses the refreshed winner and one CAS attempt', async (_name, mutate) => {
        mutateAccountSettingsOnceSpy.mockResolvedValueOnce({ status: 'applied', settingsVersion: 12, value: { ok: true } });

        await expect(mutate()).resolves.toEqual({ ok: true });

        expect(refreshAccountSettingsFromServerSpy).toHaveBeenCalledWith(10, settingsScope);
        expect(mutateAccountSettingsOnceSpy).toHaveBeenCalledTimes(1);
        expect(mutateAccountSettingsOnceSpy).toHaveBeenCalledWith(expect.objectContaining({
            expectedSettingsScope: settingsScope,
            expectedSettingsVersion: 11,
        }));
    });

    it('returns the winning ref identity when add commits after a rendered snapshot becomes stale', async () => {
        mutateAccountSettingsOnceSpy.mockImplementationOnce(async (input) => {
            const applied = input.mutate({
                workspaceRefsV1: [{
                    id: 'concurrent-ref',
                    serverId: 'server',
                    machineId: 'machine-c',
                    rootPath: '/concurrent',
                    label: null,
                    createdAtMs: 2,
                    lastOpenedAtMs: null,
                }],
                pinnedWorkspaceRefIdsV1: ['concurrent-ref'],
                workspaceSyncRelationshipsV1: [],
            });
            expect(applied.settings.workspaceRefsV1).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'concurrent-ref' }),
                expect.objectContaining({ rootPath: '/added' }),
            ]));
            expect(applied.settings.pinnedWorkspaceRefIdsV1).toEqual(['concurrent-ref']);
            return { status: 'applied', settingsVersion: 12, value: applied.value };
        });

        await expect(addWorkspaceRefToAccount({
            scope: { serverId: 'server', machineId: 'machine-a', rootPath: '/added' },
            nowMs: 3,
            patch: { lastOpenedAtMs: 3 },
        })).resolves.toEqual({ ok: true, workspaceRefId: expect.any(String) });
    });

    it.each([
        ['conflict', { status: 'conflict', currentSettingsVersion: 12 }, 'workspace_settings_changed'],
        ['unknown', { status: 'outcomeUnknown' }, 'workspace_settings_outcome_unknown'],
    ])('fails closed on a %s outcome', async (_name, result, code) => {
        mutateAccountSettingsOnceSpy.mockResolvedValueOnce(result);

        await expect(renameWorkspaceRefInAccount({
            serverId: 'server',
            workspaceRefId: 'target-ref',
            label: 'Renamed',
        })).resolves.toEqual({ ok: false, code });
    });
});
