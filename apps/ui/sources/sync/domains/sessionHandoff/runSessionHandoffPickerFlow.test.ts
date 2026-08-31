import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';
import { installSessionHandoffCommonModuleMocks } from '@/components/sessions/handoff/sessionHandoffTestHelpers';

const openSessionHandoffPickerMock = vi.hoisted(() => vi.fn());
const executeSessionHandoffActionMock = vi.hoisted(() => vi.fn());
const modalConfirmMock = vi.hoisted(() => vi.fn());
const readSessionHandoffSessionActivityMock = vi.hoisted(() => vi.fn());
const releaseUserRequestLeaseMock = vi.hoisted(() => vi.fn());
const acquireUserRequestLeaseMock = vi.hoisted(() => vi.fn(() => releaseUserRequestLeaseMock));
const mutateAccountSettingsMock = vi.hoisted(() => vi.fn());
const mutateAccountSettingsOnceMock = vi.hoisted(() => vi.fn());
const settingsState = vi.hoisted(() => ({
    settingsVersion: 7 as number | null,
    raw: {} as Record<string, unknown>,
}));

vi.mock('@/components/sessions/handoff/openSessionHandoffPicker', () => ({
    openSessionHandoffPicker: (...args: unknown[]) => openSessionHandoffPickerMock(...args),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            confirm: (...args: unknown[]) => modalConfirmMock(...args),
        },
    }).module;
});

vi.mock('./readSessionHandoffSessionActivity', () => ({
    readSessionHandoffSessionActivity: (...args: unknown[]) => readSessionHandoffSessionActivityMock(...args),
}));

vi.mock('./executeSessionHandoffAction', () => ({
    executeSessionHandoffAction: (...args: unknown[]) => executeSessionHandoffActionMock(...args),
}));
vi.mock('@/sync/sync', () => ({
    sync: {
        acquireUserRequestLease: acquireUserRequestLeaseMock,
        mutateAccountSettings: mutateAccountSettingsMock,
        mutateAccountSettingsOnce: mutateAccountSettingsOnceMock,
    },
}));
vi.mock('@/sync/domains/state/storageStore', () => ({
    storage: { getState: () => ({ settingsVersion: settingsState.settingsVersion }) },
}));

installSessionHandoffCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                confirm: (...args: unknown[]) => modalConfirmMock(...args),
            },
        }).module;
    },
});

describe('runSessionHandoffPickerFlow', () => {
    beforeEach(() => {
        openSessionHandoffPickerMock.mockReset();
        executeSessionHandoffActionMock.mockReset();
        modalConfirmMock.mockReset();
        readSessionHandoffSessionActivityMock.mockReset();
        readSessionHandoffSessionActivityMock.mockReturnValue({ active: false });
        acquireUserRequestLeaseMock.mockClear();
        releaseUserRequestLeaseMock.mockClear();
        settingsState.settingsVersion = 7;
        settingsState.raw = {};
        mutateAccountSettingsMock.mockReset();
        mutateAccountSettingsOnceMock.mockReset();
        mutateAccountSettingsMock.mockImplementation(async (mutate: (raw: Readonly<Record<string, unknown>>) => Record<string, unknown>) => {
            settingsState.raw = mutate(settingsState.raw);
            settingsState.settingsVersion = (settingsState.settingsVersion ?? 0) + 1;
        });
        mutateAccountSettingsOnceMock.mockImplementation(async (input: Readonly<{
            expectedSettingsVersion: number;
            mutate: (raw: Readonly<Record<string, unknown>>) => Readonly<{
                settings: Record<string, unknown>;
                value: unknown;
            }>;
        }>) => {
            if (input.expectedSettingsVersion !== settingsState.settingsVersion) {
                return {
                    status: 'conflict' as const,
                    currentSettingsVersion: settingsState.settingsVersion ?? 0,
                };
            }
            const mutation = input.mutate(settingsState.raw);
            settingsState.raw = mutation.settings;
            settingsState.settingsVersion = (settingsState.settingsVersion ?? 0) + 1;
            return {
                status: 'applied' as const,
                settingsVersion: settingsState.settingsVersion,
                value: mutation.value,
            };
        });
    });

    it('returns null when the picker is dismissed', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce(null);

        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        const result = await runSessionHandoffPickerFlow({
            execute: vi.fn() as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_info',
        });

        expect(openSessionHandoffPickerMock).toHaveBeenCalledWith({
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
        });
        expect(modalConfirmMock).not.toHaveBeenCalled();
        expect(executeSessionHandoffActionMock).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('submits one canonical handoff request without running a UI-owned lifecycle', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
            targetSessionStorageMode: 'persisted',
            workspaceAction: { kind: 'relationship', relationshipId: 'relationship_1', flushBeforeCommit: true },
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: true, handoffId: 'handoff_1' });

        const execute = vi.fn();
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        const result = await runSessionHandoffPickerFlow({
            execute: execute as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_action_menu',
        });

        expect(modalConfirmMock).not.toHaveBeenCalled();
        expect(executeSessionHandoffActionMock).toHaveBeenCalledWith({
            execute,
            sessionId: 'sess_1',
            targetMachineId: 'machine_target',
            targetSessionStorageMode: 'persisted',
            workspaceAction: { kind: 'relationship', relationshipId: 'relationship_1', flushBeforeCommit: true },
            context: {
                actionRequestId: expect.any(String),
                defaultSessionId: 'sess_1',
                serverId: 'server_a',
                surface: 'ui',
                placement: 'session_action_menu',
            },
        });
        expect(executeSessionHandoffActionMock).toHaveBeenCalledTimes(1);
        expect(mutateAccountSettingsOnceMock).not.toHaveBeenCalled();
        expect(mutateAccountSettingsMock).not.toHaveBeenCalled();
        expect(acquireUserRequestLeaseMock).toHaveBeenCalledTimes(1);
        expect(releaseUserRequestLeaseMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true, handoffId: 'handoff_1' });
    });

    it('persists exact source and target WorkspaceRefs before dispatching copy_once', async () => {
        settingsState.raw = {
            workspaceRefsV1: [{
                id: 'workspace-source', serverId: 'server_a', machineId: 'machine_source',
                rootPath: '/source/repo', label: null, createdAtMs: 1, lastOpenedAtMs: null,
            }],
        };
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
            targetPath: '/target/repo',
            sourceRootPath: '/source/repo',
            targetSessionStorageMode: 'persisted',
            workspaceAction: {
                kind: 'copy_once',
                contentPolicy: {
                    v: 1, selection: 'all_files', extraIgnorePatterns: [], extraIncludePatterns: [],
                    includeGitDirectory: false, policyDigest: 'a'.repeat(64),
                },
            },
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: true, handoffId: 'handoff-copy' });

        const execute = vi.fn();
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        await runSessionHandoffPickerFlow({
            execute: execute as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_action_menu',
        });

        expect(mutateAccountSettingsOnceMock).toHaveBeenCalledTimes(1);
        const refs = settingsState.raw.workspaceRefsV1 as readonly Readonly<Record<string, unknown>>[];
        expect(refs).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'workspace-source', machineId: 'machine_source', rootPath: '/source/repo' }),
            expect.objectContaining({ machineId: 'machine_target', rootPath: '/target/repo' }),
        ]));
        const targetRef = refs.find((ref) => ref.machineId === 'machine_target');
        expect(executeSessionHandoffActionMock).toHaveBeenCalledWith(expect.objectContaining({
            execute,
            sessionId: 'sess_1',
            workspaceSyncSourceWorkspaceRefId: 'workspace-source',
            workspaceSyncTargetWorkspaceRefId: targetRef?.id,
            workspaceSyncSettingsVersion: 8,
        }));
    });

    it('creates the first persistent relationship in Account Settings before dispatching handoff', async () => {
        const policyFields = {
            v: 1 as const,
            selection: 'git_worktree' as const,
            extraIgnorePatterns: [],
            extraIncludePatterns: [],
            includeGitDirectory: false,
        };
        settingsState.raw = {};
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
            targetPath: '/target/repo',
            sourceRootPath: '/source/repo',
            targetSessionStorageMode: 'persisted',
            workspaceSyncRelationshipIntent: {
                mode: 'keep_synced',
                contentPolicy: {
                    ...policyFields,
                    policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
                },
            },
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: true, handoffId: 'handoff-sync' });

        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        await runSessionHandoffPickerFlow({
            execute: vi.fn() as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_action_menu',
        });

        expect(mutateAccountSettingsOnceMock).toHaveBeenCalledTimes(1);
        const refs = settingsState.raw.workspaceRefsV1 as readonly Readonly<Record<string, unknown>>[];
        const sourceRef = refs.find((ref) => ref.machineId === 'machine_source');
        const targetRef = refs.find((ref) => ref.machineId === 'machine_target');
        const relationships = settingsState.raw.workspaceSyncRelationshipsV1 as readonly Readonly<Record<string, unknown>>[];
        expect(relationships).toEqual([
            expect.objectContaining({
                relationshipId: expect.any(String),
                controllerMachineId: 'machine_source',
                alphaWorkspaceRefId: sourceRef?.id,
                betaWorkspaceRefId: targetRef?.id,
                mode: 'keep_synced',
                enabled: true,
            }),
        ]);
        expect(executeSessionHandoffActionMock).toHaveBeenCalledWith(expect.objectContaining({
            workspaceAction: {
                kind: 'relationship',
                relationshipId: relationships[0]?.relationshipId,
                flushBeforeCommit: true,
            },
            workspaceSyncSourceWorkspaceRefId: sourceRef?.id,
            workspaceSyncTargetWorkspaceRefId: targetRef?.id,
            workspaceSyncSettingsVersion: 8,
        }));
    });

    it('does not replay or dispatch an effectful workspace relationship mutation after a Settings conflict', async () => {
        const policyFields = {
            v: 1 as const,
            selection: 'git_worktree' as const,
            extraIgnorePatterns: [],
            extraIncludePatterns: [],
            includeGitDirectory: false,
        };
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
            targetPath: '/target/repo',
            sourceRootPath: '/source/repo',
            targetSessionStorageMode: 'persisted',
            workspaceSyncRelationshipIntent: {
                mode: 'keep_synced',
                contentPolicy: {
                    ...policyFields,
                    policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
                },
            },
        });
        mutateAccountSettingsOnceMock.mockResolvedValueOnce({
            status: 'conflict',
            currentSettingsVersion: 8,
        });

        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        await expect(runSessionHandoffPickerFlow({
            execute: vi.fn() as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_action_menu',
        })).rejects.toMatchObject({ code: 'workspace_ref_not_ready' });

        expect(mutateAccountSettingsOnceMock).toHaveBeenCalledOnce();
        expect(mutateAccountSettingsMock).not.toHaveBeenCalled();
        expect(executeSessionHandoffActionMock).not.toHaveBeenCalled();
    });

    it('re-enables and reuses the exact existing relationship instead of creating a duplicate', async () => {
        const policyFields = {
            v: 1 as const,
            selection: 'git_worktree' as const,
            extraIgnorePatterns: [],
            extraIncludePatterns: [],
            includeGitDirectory: false,
        };
        const contentPolicy = {
            ...policyFields,
            policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
        };
        settingsState.raw = {
            workspaceRefsV1: [
                { id: 'workspace-source', serverId: 'server_a', machineId: 'machine_source', rootPath: '/source/repo', label: null, createdAtMs: 1, lastOpenedAtMs: null },
                { id: 'workspace-target', serverId: 'server_a', machineId: 'machine_target', rootPath: '/target/repo', label: null, createdAtMs: 1, lastOpenedAtMs: null },
            ],
            workspaceSyncRelationshipsV1: [{
                v: 1,
                relationshipId: 'relationship-existing',
                controllerMachineId: 'machine_source',
                alphaWorkspaceRefId: 'workspace-source',
                betaWorkspaceRefId: 'workspace-target',
                mode: 'keep_synced',
                contentPolicy,
                enabled: false,
                createdAtMs: 1,
                updatedAtMs: 2,
            }],
        };
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
            targetPath: '/target/repo',
            sourceRootPath: '/source/repo',
            targetSessionStorageMode: 'persisted',
            workspaceSyncRelationshipIntent: { mode: 'keep_synced', contentPolicy },
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: true, handoffId: 'handoff-reuse' });

        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        await runSessionHandoffPickerFlow({
            execute: vi.fn() as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_action_menu',
        });

        expect(settingsState.raw.workspaceSyncRelationshipsV1).toEqual([
            expect.objectContaining({ relationshipId: 'relationship-existing', enabled: true, createdAtMs: 1 }),
        ]);
        expect(executeSessionHandoffActionMock).toHaveBeenCalledWith(expect.objectContaining({
            workspaceAction: { kind: 'relationship', relationshipId: 'relationship-existing', flushBeforeCommit: true },
        }));
    });

    it('does not persist or dispatch a competing relationship for the same endpoint pair', async () => {
        const policyFields = {
            v: 1 as const,
            selection: 'git_worktree' as const,
            extraIgnorePatterns: [],
            extraIncludePatterns: [],
            includeGitDirectory: false,
        };
        const contentPolicy = {
            ...policyFields,
            policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
        };
        settingsState.raw = {
            workspaceRefsV1: [
                { id: 'workspace-source', serverId: 'server_a', machineId: 'machine_source', rootPath: '/source/repo', label: null, createdAtMs: 1, lastOpenedAtMs: null },
                { id: 'workspace-target', serverId: 'server_a', machineId: 'machine_target', rootPath: '/target/repo', label: null, createdAtMs: 1, lastOpenedAtMs: null },
            ],
            workspaceSyncRelationshipsV1: [{
                v: 1,
                relationshipId: 'relationship-existing',
                controllerMachineId: 'machine_source',
                alphaWorkspaceRefId: 'workspace-source',
                betaWorkspaceRefId: 'workspace-target',
                mode: 'keep_synced',
                contentPolicy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            }],
        };
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
            targetPath: '/target/repo',
            sourceRootPath: '/source/repo',
            targetSessionStorageMode: 'persisted',
            workspaceSyncRelationshipIntent: { mode: 'mirror_exactly', contentPolicy },
        });

        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        await expect(runSessionHandoffPickerFlow({
            execute: vi.fn() as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_action_menu',
        })).rejects.toMatchObject({ code: 'workspace_sync_relationship_replacement_required' });

        expect(settingsState.raw.workspaceSyncRelationshipsV1).toEqual([
            expect.objectContaining({ relationshipId: 'relationship-existing', mode: 'keep_synced' }),
        ]);
        expect(executeSessionHandoffActionMock).not.toHaveBeenCalled();
    });

    it('requires destination-specific confirmation before persisting a mirror relationship', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
            targetMachineLabel: 'Build machine',
            targetPath: '/target/repo',
            sourceRootPath: '/source/repo',
            targetSessionStorageMode: 'persisted',
            workspaceSyncRelationshipIntent: {
                mode: 'mirror_exactly',
                contentPolicy: {
                    v: 1,
                    selection: 'git_worktree',
                    extraIgnorePatterns: [],
                    extraIncludePatterns: [],
                    includeGitDirectory: false,
                    policyDigest: computeWorkspaceSyncPolicyDigest({
                        v: 1,
                        selection: 'git_worktree',
                        extraIgnorePatterns: [],
                        extraIncludePatterns: [],
                        includeGitDirectory: false,
                    }),
                },
            },
        });
        modalConfirmMock.mockResolvedValueOnce(false);

        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        await expect(runSessionHandoffPickerFlow({
            execute: vi.fn() as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_action_menu',
        })).resolves.toEqual({ ok: false, handled: true });

        expect(modalConfirmMock).toHaveBeenCalledWith(
            'sessionHandoff.mirrorConfirmation.title',
            'sessionHandoff.mirrorConfirmation.message',
            expect.objectContaining({
                confirmText: 'sessionHandoff.mirrorConfirmation.confirm',
                destructive: true,
            }),
        );
        expect(mutateAccountSettingsOnceMock).not.toHaveBeenCalled();
        expect(executeSessionHandoffActionMock).not.toHaveBeenCalled();
    });

    it('reuses a two-way relationship on handoff-back without reversing its fixed controller or endpoints', async () => {
        const policyFields = {
            v: 1 as const,
            selection: 'git_worktree' as const,
            extraIgnorePatterns: [],
            extraIncludePatterns: [],
            includeGitDirectory: false,
        };
        const contentPolicy = {
            ...policyFields,
            policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
        };
        settingsState.raw = {
            workspaceRefsV1: [
                { id: 'workspace-alpha', serverId: 'server_a', machineId: 'machine_alpha', rootPath: '/alpha/repo', label: 'Alpha', createdAtMs: 1, lastOpenedAtMs: null },
                { id: 'workspace-beta', serverId: 'server_a', machineId: 'machine_beta', rootPath: '/beta/repo', label: 'Beta', createdAtMs: 1, lastOpenedAtMs: null },
            ],
            workspaceSyncRelationshipsV1: [{
                v: 1,
                relationshipId: 'relationship-two-way',
                controllerMachineId: 'machine_alpha',
                alphaWorkspaceRefId: 'workspace-alpha',
                betaWorkspaceRefId: 'workspace-beta',
                mode: 'keep_both_in_sync',
                contentPolicy,
                enabled: true,
                createdAtMs: 1,
                updatedAtMs: 2,
            }],
        };
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_alpha',
            targetPath: '/alpha/repo',
            sourceRootPath: '/beta/repo',
            targetSessionStorageMode: 'persisted',
            workspaceSyncRelationshipIntent: { mode: 'keep_both_in_sync', contentPolicy },
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: true, handoffId: 'handoff-back' });

        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        await runSessionHandoffPickerFlow({
            execute: vi.fn() as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_beta',
            serverId: 'server_a',
            placement: 'session_action_menu',
        });

        expect(settingsState.raw.workspaceSyncRelationshipsV1).toEqual([
            expect.objectContaining({
                relationshipId: 'relationship-two-way',
                controllerMachineId: 'machine_alpha',
                alphaWorkspaceRefId: 'workspace-alpha',
                betaWorkspaceRefId: 'workspace-beta',
                mode: 'keep_both_in_sync',
            }),
        ]);
        expect(executeSessionHandoffActionMock).toHaveBeenCalledWith(expect.objectContaining({
            workspaceAction: { kind: 'relationship', relationshipId: 'relationship-two-way', flushBeforeCommit: true },
            workspaceSyncSourceWorkspaceRefId: 'workspace-beta',
            workspaceSyncTargetWorkspaceRefId: 'workspace-alpha',
        }));
    });

    it('shows a stop-first confirmation before handing off an active session and continues when confirmed', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
        });
        readSessionHandoffSessionActivityMock.mockReturnValueOnce({ active: true });
        modalConfirmMock.mockResolvedValueOnce(true);
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: true, handoffId: 'handoff_2' });

        const execute = vi.fn();
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        const result = await runSessionHandoffPickerFlow({
            execute: execute as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_info',
        });

        expect(modalConfirmMock).toHaveBeenCalledWith(
            'sessionHandoff.activeWarning.title',
            'sessionHandoff.activeWarning.message',
            {
                cancelText: 'common.cancel',
                confirmText: 'sessionHandoff.activeWarning.confirm',
                destructive: true,
            },
        );
        expect(executeSessionHandoffActionMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true, handoffId: 'handoff_2' });
    });

    it('cancels an active-session handoff when the stop-first confirmation is declined', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'machine_target',
        });
        readSessionHandoffSessionActivityMock.mockReturnValueOnce({ active: true });
        modalConfirmMock.mockResolvedValueOnce(false);

        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');
        const result = await runSessionHandoffPickerFlow({
            execute: vi.fn() as any,
            sessionId: 'sess_1',
            sourceMachineId: 'machine_source',
            serverId: 'server_a',
            placement: 'session_info',
        });

        expect(modalConfirmMock).toHaveBeenCalledTimes(1);
        expect(executeSessionHandoffActionMock).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: false, handled: true });
    });

});
