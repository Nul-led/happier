import { describe, expect, it, vi } from 'vitest';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';

import {
    applyWorkspaceRefMutationToAccountSettings,
    applyWorkspaceRefRemovalToAccountSettings,
    findWorkspaceRefByScope,
    resolveWorkspaceRefRemoval,
    upsertWorkspaceRefByScope,
} from './workspaceRefs';

vi.mock('@/platform/randomUUID', () => ({
    randomUUID: () => 'workspace-ref-id',
}));

describe('workspaceRefs', () => {
    it('upserts by normalized scope and preserves id', () => {
        const refs = [
            {
                id: 'id-1',
                serverId: 'server',
                machineId: 'm1',
                rootPath: '/tmp/repo/',
                label: null,
                createdAtMs: 1,
                lastOpenedAtMs: null,
            },
        ];

        const next = upsertWorkspaceRefByScope(refs, {
            scope: { serverId: 'server', machineId: 'm1', rootPath: '/tmp/repo' },
            nowMs: 10,
            patch: { label: 'My Repo' },
        });

        expect(next).toHaveLength(1);
        expect(next[0]!.id).toBe('id-1');
        expect(next[0]!.label).toBe('My Repo');
    });

    it('creates a new ref when missing', () => {
        const next = upsertWorkspaceRefByScope([], {
            scope: { serverId: 'server', machineId: 'm1', rootPath: '/tmp/repo' },
            nowMs: 10,
            patch: { label: 'Repo' },
        });

        expect(next).toHaveLength(1);
        expect(next[0]!.id).toBe('workspace-ref-id');
        expect(next[0]!.rootPath).toBe('/tmp/repo');
    });

    it('finds ref by normalized scope', () => {
        const refs = [
            {
                id: 'id-1',
                serverId: 'server',
                machineId: 'm1',
                rootPath: 'C:\\\\Repo\\\\',
                label: 'X',
                createdAtMs: 1,
                lastOpenedAtMs: null,
            },
        ];

        const found = findWorkspaceRefByScope(refs, { serverId: 'server', machineId: 'm1', rootPath: 'c:/repo' });
        expect(found?.id).toBe('id-1');
    });

    describe('resolveWorkspaceRefRemoval', () => {
        const refs = [
            { id: 'source-ref', serverId: 'server', machineId: 'm1', rootPath: '/source', label: null, createdAtMs: 1, lastOpenedAtMs: null },
            { id: 'target-ref', serverId: 'server', machineId: 'm2', rootPath: '/target', label: null, createdAtMs: 1, lastOpenedAtMs: null },
        ];
        const relationship = {
            relationshipId: 'relationship-1',
            alphaWorkspaceRefId: 'source-ref',
            betaWorkspaceRefId: 'target-ref',
        };

        it('refuses to remove a ref any workspace-sync relationship still references', () => {
            expect(resolveWorkspaceRefRemoval(refs, {
                serverId: 'server',
                workspaceRefId: 'target-ref',
                relationships: [relationship],
            })).toEqual({ ok: false, code: 'workspace_ref_in_use', relationshipIds: ['relationship-1'] });
        });

        it('removes the ref once no relationship references it', () => {
            const removal = resolveWorkspaceRefRemoval(refs, {
                serverId: 'server',
                workspaceRefId: 'target-ref',
                relationships: [],
            });

            expect(removal.ok).toBe(true);
            expect(removal.ok && removal.workspaceRefs.map((ref) => ref.id)).toEqual(['source-ref']);
        });

        it('leaves refs owned by another server untouched', () => {
            const removal = resolveWorkspaceRefRemoval(refs, {
                serverId: 'other-server',
                workspaceRefId: 'target-ref',
                relationships: [],
            });

            expect(removal.ok && removal.workspaceRefs.map((ref) => ref.id)).toEqual(['source-ref', 'target-ref']);
        });
    });

    describe('applyWorkspaceRefRemovalToAccountSettings', () => {
        const contentPolicyBase = {
            v: 1 as const,
            selection: 'all_files' as const,
            extraIgnorePatterns: [],
            extraIncludePatterns: [],
        };
        const target = {
            id: 'target-ref',
            serverId: 'server',
            machineId: 'm2',
            rootPath: '/target',
            label: null,
            createdAtMs: 1,
            lastOpenedAtMs: null,
        };
        const concurrentlyAdded = {
            id: 'concurrent-ref',
            serverId: 'server',
            machineId: 'm3',
            rootPath: '/concurrent',
            label: null,
            createdAtMs: 2,
            lastOpenedAtMs: null,
        };

        it('rechecks the winning relationship set and refuses a concurrently referenced ref', () => {
            const raw = {
                workspaceRefsV1: [target, concurrentlyAdded],
                pinnedWorkspaceRefIdsV1: ['target-ref', 'concurrent-ref'],
                workspaceSyncRelationshipsV1: [{
                    v: 1,
                    relationshipId: 'relationship-new',
                    alphaWorkspaceRefId: 'concurrent-ref',
                    betaWorkspaceRefId: 'target-ref',
                    controllerMachineId: 'm3',
                    mode: 'keep_synced',
                    enabled: true,
                    contentPolicy: {
                        ...contentPolicyBase,
                        policyDigest: computeWorkspaceSyncPolicyDigest(contentPolicyBase),
                    },
                    createdAtMs: 2,
                    updatedAtMs: 2,
                }],
                unrelated: { retained: true },
            };

            const result = applyWorkspaceRefRemovalToAccountSettings(raw, {
                serverId: 'server',
                workspaceRefId: 'target-ref',
            });

            expect(result.value).toEqual({
                ok: false,
                code: 'workspace_ref_in_use',
                relationshipIds: ['relationship-new'],
            });
            expect(result.settings).toBe(raw);
        });

        it('removes only the requested ref and pin while preserving a concurrent ref', () => {
            const raw = {
                workspaceRefsV1: [target, concurrentlyAdded],
                pinnedWorkspaceRefIdsV1: ['target-ref', 'concurrent-ref'],
                workspaceSyncRelationshipsV1: [],
                unrelated: { retained: true },
            };

            const result = applyWorkspaceRefRemovalToAccountSettings(raw, {
                serverId: 'server',
                workspaceRefId: 'target-ref',
            });

            expect(result.value).toEqual({ ok: true });
            expect(result.settings).toEqual({
                workspaceRefsV1: [concurrentlyAdded],
                pinnedWorkspaceRefIdsV1: ['concurrent-ref'],
                workspaceSyncRelationshipsV1: [],
                unrelated: { retained: true },
            });
        });

        it('treats an omitted optional pin collection as its canonical empty default', () => {
            const result = applyWorkspaceRefRemovalToAccountSettings({
                workspaceRefsV1: [target],
                workspaceSyncRelationshipsV1: [],
            }, {
                serverId: 'server',
                workspaceRefId: 'target-ref',
            });

            expect(result.value).toEqual({ ok: true });
            expect(result.settings.workspaceRefsV1).toEqual([]);
            expect(result.settings.pinnedWorkspaceRefIdsV1).toEqual([]);
        });
    });

    describe('applyWorkspaceRefMutationToAccountSettings', () => {
        const target = {
            id: 'target-ref',
            serverId: 'server',
            machineId: 'm1',
            rootPath: '/target',
            label: 'Before',
            createdAtMs: 1,
            lastOpenedAtMs: null,
        };
        const concurrent = {
            id: 'concurrent-ref',
            serverId: 'server',
            machineId: 'm2',
            rootPath: '/concurrent',
            label: 'Concurrent',
            createdAtMs: 2,
            lastOpenedAtMs: null,
        };

        it('adds against the current winner without replacing a concurrently-created ref or pin', () => {
            const result = applyWorkspaceRefMutationToAccountSettings({
                workspaceRefsV1: [concurrent],
                pinnedWorkspaceRefIdsV1: ['concurrent-ref'],
                workspaceSyncRelationshipsV1: [],
            }, {
                kind: 'upsert',
                scope: { serverId: 'server', machineId: 'm3', rootPath: '/added' },
                nowMs: 3,
                patch: { lastOpenedAtMs: 3 },
            });

            expect(result.value).toEqual({ ok: true, workspaceRefId: 'workspace-ref-id' });
            expect(result.settings.workspaceRefsV1).toEqual([
                concurrent,
                expect.objectContaining({ id: 'workspace-ref-id', rootPath: '/added' }),
            ]);
            expect(result.settings.pinnedWorkspaceRefIdsV1).toEqual(['concurrent-ref']);
        });

        it('renames only the requested ref from the current winner', () => {
            const result = applyWorkspaceRefMutationToAccountSettings({
                workspaceRefsV1: [{ ...target, label: null }, concurrent],
                pinnedWorkspaceRefIdsV1: ['concurrent-ref'],
                workspaceSyncRelationshipsV1: [],
            }, {
                kind: 'set_label',
                serverId: 'server',
                workspaceRefId: 'target-ref',
                label: 'After',
            });

            expect(result.value).toEqual({ ok: true });
            expect(result.settings.workspaceRefsV1).toEqual([
                { ...target, label: 'After' },
                concurrent,
            ]);
            expect(result.settings.pinnedWorkspaceRefIdsV1).toEqual(['concurrent-ref']);
        });

        it('resets only the requested label from the current winner', () => {
            const result = applyWorkspaceRefMutationToAccountSettings({
                workspaceRefsV1: [target, concurrent],
                pinnedWorkspaceRefIdsV1: ['concurrent-ref'],
                workspaceSyncRelationshipsV1: [],
            }, {
                kind: 'set_label',
                serverId: 'server',
                workspaceRefId: 'target-ref',
                label: null,
            });

            expect(result.value).toEqual({ ok: true });
            expect(result.settings.workspaceRefsV1).toEqual([
                { ...target, label: null },
                concurrent,
            ]);
        });

        it.each([
            { pinned: true, before: ['concurrent-ref'], after: ['concurrent-ref', 'target-ref'] },
            { pinned: false, before: ['target-ref', 'concurrent-ref'], after: ['concurrent-ref'] },
        ])('sets pinned=$pinned without replacing concurrent pins', ({ pinned, before, after }) => {
            const result = applyWorkspaceRefMutationToAccountSettings({
                workspaceRefsV1: [target, concurrent],
                pinnedWorkspaceRefIdsV1: before,
                workspaceSyncRelationshipsV1: [],
            }, {
                kind: 'set_pinned',
                serverId: 'server',
                workspaceRefId: 'target-ref',
                pinned,
            });

            expect(result.value).toEqual({ ok: true });
            expect(result.settings.workspaceRefsV1).toEqual([target, concurrent]);
            expect(result.settings.pinnedWorkspaceRefIdsV1).toEqual(after);
        });

        it('does not overwrite a canonical label that appeared before legacy migration committed', () => {
            const result = applyWorkspaceRefMutationToAccountSettings({
                workspaceRefsV1: [{ ...target, label: 'Concurrent winner' }, concurrent],
                workspaceLabelsV1: { legacy_target: 'Legacy' },
                pinnedWorkspaceRefIdsV1: [],
                workspaceSyncRelationshipsV1: [],
            }, {
                kind: 'migrate_label',
                scope: { serverId: 'server', machineId: 'm1', rootPath: '/target' },
                legacyKey: 'legacy_target',
                label: 'Legacy',
                nowMs: 3,
            });

            expect(result.value).toEqual({ ok: true, workspaceRefId: 'target-ref', migrated: false });
            expect(result.settings.workspaceRefsV1).toEqual([{ ...target, label: 'Concurrent winner' }, concurrent]);
        });

        it('atomically removes only the migrated legacy key from the current label winner', () => {
            const result = applyWorkspaceRefMutationToAccountSettings({
                workspaceRefsV1: [{ ...target, label: null }, concurrent],
                workspaceLabelsV1: {
                    legacy_target: 'Legacy',
                    concurrent_workspace: 'Concurrent',
                },
                pinnedWorkspaceRefIdsV1: [],
                workspaceSyncRelationshipsV1: [],
            }, {
                kind: 'migrate_label',
                scope: { serverId: 'server', machineId: 'm1', rootPath: '/target' },
                legacyKey: 'legacy_target',
                label: 'Legacy',
                nowMs: 3,
            });

            expect(result.value).toEqual({ ok: true, workspaceRefId: 'target-ref', migrated: true });
            expect(result.settings.workspaceRefsV1).toHaveLength(2);
            expect(result.settings.workspaceRefsV1).toEqual(expect.arrayContaining([
                { ...target, label: 'Legacy' },
                concurrent,
            ]));
            expect(result.settings.workspaceLabelsV1).toEqual({ concurrent_workspace: 'Concurrent' });
        });

        it('does not delete or apply a legacy label that changed before commit', () => {
            const raw = {
                workspaceRefsV1: [{ ...target, label: null }, concurrent],
                workspaceLabelsV1: { legacy_target: 'Concurrent legacy winner' },
                pinnedWorkspaceRefIdsV1: [],
                workspaceSyncRelationshipsV1: [],
            };
            const result = applyWorkspaceRefMutationToAccountSettings(raw, {
                kind: 'migrate_label',
                scope: { serverId: 'server', machineId: 'm1', rootPath: '/target' },
                legacyKey: 'legacy_target',
                label: 'Rendered legacy label',
                nowMs: 3,
            });

            expect(result.value).toEqual({ ok: true, workspaceRefId: 'target-ref', migrated: false });
            expect(result.settings).toBe(raw);
        });
    });
});
