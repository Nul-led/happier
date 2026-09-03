import { describe, expect, it } from 'vitest';

import { isWorkspaceScopeReachableFromState } from './workspaceReachability';

describe('workspaceReachability', () => {
    it('requires the exact server-scoped machine to be currently online', () => {
        const activeMachine = { id: 'shared-machine', active: true, updatedAt: Date.now() };
        const offlineOtherServerMachine = { id: 'shared-machine', active: false, updatedAt: 0 };
        const state = {
            isDataReady: true,
            machines: { shared: activeMachine },
            machineListByServerId: { 'server-b': [offlineOtherServerMachine] },
        };

        expect(isWorkspaceScopeReachableFromState(state as never, {
            serverId: 'server-a',
            machineId: 'shared-machine',
            rootPath: '/repo',
        }, 'server-a')).toBe(true);
        expect(isWorkspaceScopeReachableFromState(state as never, {
            serverId: 'server-b',
            machineId: 'shared-machine',
            rootPath: '/repo',
        }, 'server-a')).toBe(false);
    });
});
