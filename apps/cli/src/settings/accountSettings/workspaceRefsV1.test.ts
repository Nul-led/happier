import { describe, expect, it } from 'vitest';

import type { AccountSettings } from '@happier-dev/protocol';

import { materializeWorkspaceRefForMachineRoot, resolveWorkspaceRefById, resolveWorkspaceRefForMachineRoot } from './workspaceRefsV1';

describe('workspace ref resolution', () => {
    it('resolves one canonical workspace identity from machine and normalized root', () => {
        const refs: AccountSettings['workspaceRefsV1'] = [
            { id: 'workspace_a', serverId: 'server_a', machineId: 'machine_a', rootPath: 'C:\\Repo\\', createdAtMs: 1 },
            { id: 'workspace_b', serverId: 'server_b', machineId: 'machine_b', rootPath: '/repo', createdAtMs: 1 },
        ];
        expect(resolveWorkspaceRefForMachineRoot(refs, { machineId: 'machine_a', rootPath: 'c:/repo' }))
            .toEqual(refs[0]);
        expect(resolveWorkspaceRefForMachineRoot([
            ...refs,
            { ...refs[0]!, id: 'ambiguous', serverId: 'server_other' },
        ], { machineId: 'machine_a', rootPath: 'c:/repo' })).toBeNull();
    });

    it('resolves an id only when exactly one current workspace ref owns it', () => {
        const refs: AccountSettings['workspaceRefsV1'] = [
            { id: 'workspace_a', serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo-a', createdAtMs: 1 },
            { id: 'workspace_b', serverId: 'server_b', machineId: 'machine_b', rootPath: '/repo-b', createdAtMs: 1 },
        ];

        expect(resolveWorkspaceRefById(refs, ' workspace_a ')).toEqual(refs[0]);
        expect(resolveWorkspaceRefById(refs, 'workspace_missing')).toBeNull();
        expect(resolveWorkspaceRefById([...refs, { ...refs[0]!, serverId: 'server_other' }], 'workspace_a')).toBeNull();
    });

    it('materializes one stable ref for a canonical machine/root scope', () => {
        const existing: AccountSettings['workspaceRefsV1'][number] = {
            id: 'workspace_a', serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo', createdAtMs: 1,
        };
        expect(materializeWorkspaceRefForMachineRoot([existing], {
            serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo/', nowMs: 2, createId: () => 'unused',
        })).toEqual({ workspaceRefs: [existing], workspaceRef: existing, created: false });

        expect(materializeWorkspaceRefForMachineRoot([], {
            serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo', nowMs: 2, createId: () => 'workspace_new',
        })).toEqual({
            workspaceRefs: [{ id: 'workspace_new', serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo', createdAtMs: 2 }],
            workspaceRef: { id: 'workspace_new', serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo', createdAtMs: 2 },
            created: true,
        });
    });

    it('does not reuse a machine/root identity from another Account Home', () => {
        const existing: AccountSettings['workspaceRefsV1'][number] = {
            id: 'workspace_a', serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo', createdAtMs: 1,
        };

        expect(materializeWorkspaceRefForMachineRoot([existing], {
            serverId: 'server_b', machineId: 'machine_a', rootPath: '/repo', nowMs: 2, createId: () => 'workspace_b',
        })).toEqual({
            workspaceRefs: [
                existing,
                { id: 'workspace_b', serverId: 'server_b', machineId: 'machine_a', rootPath: '/repo', createdAtMs: 2 },
            ],
            workspaceRef: { id: 'workspace_b', serverId: 'server_b', machineId: 'machine_a', rootPath: '/repo', createdAtMs: 2 },
            created: true,
        });
    });
});
