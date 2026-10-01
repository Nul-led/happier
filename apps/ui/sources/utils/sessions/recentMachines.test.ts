import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Machine, Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { getServerUrl, setServerUrl } from '@/sync/domains/server/serverConfig';

function createMachine(id: string): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        revokedAt: null,
        metadata: {
            host: `${id}.local`,
            platform: 'darwin',
            happyCliVersion: '0.0.0-test',
            happyHomeDir: '/tmp/.happier',
            homeDir: '/Users/test',
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

function createSession(input: Readonly<{
    id: string;
    machineId: string;
    updatedAt?: number;
}>): Session {
    return {
        id: input.id,
        serverId: getActiveServerSnapshot().serverId,
        seq: 1,
        createdAt: 1,
        updatedAt: input.updatedAt ?? 1,
        active: true,
        activeAt: 1,
        metadata: {
            machineId: input.machineId,
            path: '/Users/test/workspace/rebound',
            homeDir: '/Users/test',
            host: 'host.local',
            flavor: 'claude',
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
    };
}

describe('getRecentMachinesFromSessions', () => {
    let previousState: ReturnType<typeof storage.getState>;
    let previousServerUrl: string;
    beforeAll(async () => {
        previousServerUrl = getServerUrl();
        await setServerUrl('https://recent-machines.example.test');
    });
    afterAll(async () => { await setServerUrl(previousServerUrl || null); });
    beforeEach(() => {
        previousState = storage.getState();
        storage.setState({
            sessions: {},
            machines: {
                'machine-target': createMachine('machine-target'),
            },
            sessionListRowsByServerId: {},
            machineListByServerId: {},
        });
    });
    afterEach(() => storage.setState(previousState, true));

    it('does not include a same-host machine when session metadata has no explicit replacement', async () => {
        const { getRecentMachinesFromSessions } = await import('./recentMachines');

        const targetMachine = createMachine('machine-target');
        const otherMachine = createMachine('machine-other');
        const reboundSession = createSession({
            id: 'session-1',
            machineId: 'machine-other',
            updatedAt: 25,
        });

        storage.setState({
            sessions: {
                'session-1': reboundSession,
            },
        });

        expect(getRecentMachinesFromSessions({
            machines: [otherMachine, targetMachine],
            sessions: [reboundSession],
        })).toEqual([otherMachine]);
    });

    it('includes the current machine for sessions from explicitly replaced machines', async () => {
        const { getRecentMachinesFromSessions } = await import('./recentMachines');

        const targetMachine = createMachine('machine-target');
        const oldMachine = {
            ...createMachine('machine-old'),
            active: false,
            replacedByMachineId: 'machine-target',
            replacedAt: 100,
            replacementReason: 'manual_repair',
            replacementSource: 'manual',
        };
        const reboundSession = createSession({
            id: 'session-1',
            machineId: 'machine-old',
            updatedAt: 25,
        });

        storage.setState({
            machines: {
                'machine-old': oldMachine,
                'machine-target': targetMachine,
            },
            sessions: {
                'session-1': {
                    ...reboundSession,
                    active: false,
                },
            },
        });

        expect(getRecentMachinesFromSessions({
            machines: [oldMachine, targetMachine],
            sessions: [reboundSession],
        })).toEqual([targetMachine]);
    });
});
