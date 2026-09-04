import { describe, expect, it } from 'vitest';

import {
    resolveMachineControlTargetForSessionFromState,
    resolveMachineTargetForSessionFromState,
} from './resolveMachineTargetForSessionFromState';

function activeMachine(id: string, host: string) {
    return {
        id,
        active: true,
        activeAt: 1,
        metadata: { host },
    };
}

describe('resolveMachineTargetForSessionFromState', () => {
    it('reads the exact Home projection when duplicate Session ids exist', () => {
        const row = (machineId: string, path: string) => ({
            id: 'same-session',
            seq: 1,
            createdAt: 1,
            updatedAt: 1,
            active: true,
            activeAt: 1,
            metadataVersion: 1,
            agentStateVersion: 1,
            metadata: { machineId, path },
            thinking: false,
            thinkingAt: 0,
            presence: 'online' as const,
        });
        const state = {
            sessions: {
                'same-session': {
                    id: 'same-session',
                    serverId: 'home-a',
                    active: true,
                    updatedAt: 1,
                    metadata: { machineId: 'machine-a', path: '/repo/a' },
                },
            },
            sessionListRowStateByServerId: {
                'home-a': { 'same-session': row('machine-a', '/repo/a') },
                'home-b': { 'same-session': row('machine-b', '/repo/b') },
            },
            machines: {
                'machine-a': activeMachine('machine-a', 'a.local'),
                'machine-b': activeMachine('machine-b', 'b.local'),
            },
            getProjectForSession: () => ({ key: { machineId: 'machine-a', rootPath: '/repo/a' } }),
        } as any;

        expect(resolveMachineControlTargetForSessionFromState(state, {
            serverId: 'home-b',
            accountId: 'account-b',
            sessionId: 'same-session',
        })).toEqual({
            machineId: 'machine-b',
            basePath: '/repo/b',
            confidence: 'reachable',
        });
    });

    it('does not use layout-v1 shared metadata as a private machine control fallback', () => {
        const state = {
            sessions: {
                s1: {
                    active: false,
                    updatedAt: 1,
                    metadataLayoutVersion: 1,
                    metadata: {
                        machineId: 'shared-machine',
                        path: '/shared/private-path',
                    },
                    ownerMetadataView: null,
                },
            },
            machines: {
                'shared-machine': {
                    ...activeMachine('shared-machine', 'shared.local'),
                    metadata: { host: 'shared.local', homeDir: '/shared' },
                },
            },
            getProjectForSession: () => null,
        } as any;

        expect(resolveMachineTargetForSessionFromState(state, 's1')).toBeNull();
        expect(resolveMachineControlTargetForSessionFromState(state, 's1')).toBeNull();
    });

    it('uses the layout-v1 owner compatibility view for private machine controls', () => {
        const state = {
            sessions: {
                s1: {
                    active: false,
                    updatedAt: 1,
                    metadataLayoutVersion: 1,
                    metadata: {
                        machineId: 'shared-machine',
                        path: '/shared/private-path',
                    },
                    ownerMetadataView: {
                        machineId: 'owner-machine',
                        path: '/owner/repo',
                        host: 'owner.local',
                        homeDir: '/owner',
                    },
                },
            },
            machines: {
                'owner-machine': {
                    ...activeMachine('owner-machine', 'owner.local'),
                    metadata: { host: 'owner.local', homeDir: '/owner' },
                },
            },
            getProjectForSession: () => null,
        } as any;

        expect(resolveMachineTargetForSessionFromState(state, 's1')).toEqual({
            machineId: 'owner-machine',
            basePath: '/owner/repo',
        });
        expect(resolveMachineControlTargetForSessionFromState(state, 's1')).toEqual({
            machineId: 'owner-machine',
            basePath: '/owner/repo',
            confidence: 'reachable',
        });
    });

    it('falls back to the unique active host machine when project machine id is the unknown sentinel', () => {
        const state = {
            sessions: {
                s1: {
                    active: false,
                    updatedAt: 1,
                    metadata: {
                        path: '/repo',
                        host: 'workstation.local',
                    },
                },
            },
            machines: {
                'machine-active': activeMachine('machine-active', 'workstation.local'),
            },
            getProjectForSession: () => ({
                key: {
                    machineId: 'unknown',
                    rootPath: '/repo',
                },
            }),
        } as any;

        expect(resolveMachineTargetForSessionFromState(state, 's1')).toEqual({
            machineId: 'machine-active',
            basePath: '/repo',
        });
        expect(resolveMachineControlTargetForSessionFromState(state, 's1')).toEqual({
            machineId: 'machine-active',
            basePath: '/repo',
            confidence: 'reachable',
        });
    });

    it('does not return the unknown sentinel as a control target when host fallback is ambiguous', () => {
        const state = {
            sessions: {
                s1: {
                    active: false,
                    updatedAt: 1,
                    metadata: {
                        path: '/repo',
                        host: 'workstation.local',
                    },
                },
            },
            machines: {
                'machine-a': activeMachine('machine-a', 'workstation.local'),
                'machine-b': activeMachine('machine-b', 'workstation.local'),
            },
            getProjectForSession: () => ({
                key: {
                    machineId: 'unknown',
                    rootPath: '/repo',
                },
            }),
        } as any;

        expect(resolveMachineTargetForSessionFromState(state, 's1')).toBeNull();
        expect(resolveMachineControlTargetForSessionFromState(state, 's1')).toBeNull();
    });
});
