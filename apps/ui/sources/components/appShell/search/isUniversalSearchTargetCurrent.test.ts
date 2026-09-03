import { describe, expect, it } from 'vitest';

import type { WorkspaceTargetForSession } from '@/sync/domains/session/resolveWorkspaceTargetForSession';

import { isUniversalSearchTargetCurrent } from './isUniversalSearchTargetCurrent';
import type { UniversalSearchTarget } from './universalSearchResult';

describe('isUniversalSearchTargetCurrent', () => {
    it('keeps an exact scoped transcript target current when its session is not hydrated', () => {
        expect(isUniversalSearchTargetCurrent({
            target: { kind: 'session', serverId: 'home-b', sessionId: 'archived-unloaded', seq: 42 },
            accountScope: { serverId: 'home-b', current: true },
            workspaces: [],
            settingsPages: new Map(),
            resolveSessionWorkspaceTarget: () => null,
        })).toBe(true);
    });

    it('rejects the same unloaded result after its producing Home scope retires', () => {
        expect(isUniversalSearchTargetCurrent({
            target: { kind: 'session', serverId: 'home-b', sessionId: 'archived-unloaded' },
            accountScope: { serverId: 'home-a', current: true },
            workspaces: [],
            settingsPages: new Map(),
            resolveSessionWorkspaceTarget: () => null,
        })).toBe(false);
    });

    it.each(['workspaceFile', 'workspaceCommit'] as const)(
        're-resolves an ordinary session before activating a %s target',
        (kind) => {
            const target: UniversalSearchTarget = kind === 'workspaceFile'
                ? {
                    kind,
                    scope: { serverId: 'server-a', machineId: 'machine-a', rootPath: 'C:\\Repo\\' },
                    path: 'C:\\Repo\\src\\index.ts',
                    workspaceRefId: null,
                    sessionId: 'session-a',
                    serverId: 'server-a',
                }
                : {
                    kind,
                    scope: { serverId: 'server-a', machineId: 'machine-a', rootPath: 'C:\\Repo\\' },
                    sha: 'abc123',
                    workspaceRefId: null,
                    sessionId: 'session-a',
                    serverId: 'server-a',
                };
            const originalScope: WorkspaceTargetForSession = {
                serverId: 'server-a',
                machineId: 'machine-a',
                rootPath: 'c:/repo',
                workspaceCacheKey: 'server-a:machine-a:c:/repo',
            };
            let currentScope: WorkspaceTargetForSession | null = originalScope;
            const isCurrent = () => isUniversalSearchTargetCurrent({
                target,
                accountScope: { serverId: 'server-a', current: true },
                workspaces: [],
                settingsPages: new Map(),
                resolveSessionWorkspaceTarget: () => currentScope,
                isWorkspaceScopeReachable: () => true,
            });

            expect(isCurrent()).toBe(true);

            for (const staleScope of [
                { ...originalScope, serverId: 'server-b' },
                { ...originalScope, machineId: 'machine-b' },
                { ...originalScope, rootPath: 'c:/other-repo' },
            ]) {
                currentScope = staleScope;
                expect(isCurrent()).toBe(false);
            }

            currentScope = null;
            expect(isCurrent()).toBe(false);
        },
    );

    it('keeps project currentness owned by workspace refs', () => {
        expect(isUniversalSearchTargetCurrent({
            target: {
                kind: 'project',
                workspaceRefId: 'workspace-a',
                serverId: 'server-a',
                machineId: 'machine-a',
                rootPath: 'C:\\Repo\\',
            },
            accountScope: null,
            workspaces: [{
                id: 'workspace-a',
                serverId: 'server-a',
                machineId: 'machine-a',
                rootPath: 'c:/repo',
                label: null,
                createdAtMs: 1,
                lastOpenedAtMs: null,
            }],
            settingsPages: new Map(),
            resolveSessionWorkspaceTarget: () => {
                throw new Error('project currentness must not resolve a session target');
            },
            isWorkspaceScopeReachable: () => true,
        })).toBe(true);
    });

    it('keeps a saved workspace file current without requiring a Session', () => {
        expect(isUniversalSearchTargetCurrent({
            target: {
                kind: 'workspaceFile',
                scope: { serverId: 'server-a', machineId: 'machine-a', rootPath: '/repo' },
                path: 'README.md',
                workspaceRefId: 'workspace-a',
                sessionId: null,
                serverId: 'server-a',
            },
            accountScope: { serverId: 'server-a', current: true },
            workspaces: [{
                id: 'workspace-a',
                serverId: 'server-a',
                machineId: 'machine-a',
                rootPath: '/repo',
                label: null,
                createdAtMs: 1,
                lastOpenedAtMs: null,
            }],
            settingsPages: new Map(),
            resolveSessionWorkspaceTarget: () => {
                throw new Error('saved workspace currentness must not require a Session');
            },
            isWorkspaceScopeReachable: () => true,
        })).toBe(true);
    });

    it('rejects a saved workspace target when its exact machine binding is no longer reachable', () => {
        expect(isUniversalSearchTargetCurrent({
            target: {
                kind: 'workspaceCommit',
                scope: { serverId: 'server-a', machineId: 'machine-a', rootPath: '/repo' },
                sha: 'abc123',
                workspaceRefId: 'workspace-a',
                sessionId: null,
                serverId: 'server-a',
            },
            accountScope: { serverId: 'server-a', current: true },
            workspaces: [{
                id: 'workspace-a',
                serverId: 'server-a',
                machineId: 'machine-a',
                rootPath: '/repo',
                label: null,
                createdAtMs: 1,
                lastOpenedAtMs: null,
            }],
            settingsPages: new Map(),
            resolveSessionWorkspaceTarget: () => null,
            isWorkspaceScopeReachable: () => false,
        })).toBe(false);
    });
});
