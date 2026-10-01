import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { createAuthoringMemoryDomain, type AuthoringMemoryDomain } from './authoringMemory';

describe('Account authoring-memory materialization', () => {
    it('retains unchanged identities and suppresses duplicate row echoes in the real store', () => {
        const store = createStore<AuthoringMemoryDomain>()((set, get) => createAuthoringMemoryDomain({ set, get }));
        store.getState().applyAuthoringMemory({
            recentMachinePaths: [{ machineId: 'machine-a', path: '/repo' }],
            lastEngineSelectionsByScopeV1: {
                'server-a:backend:codex': { v: 1, modelId: 'gpt-5.4', updatedAt: 1 },
                'server-a:backend:future': { v: 2, opaque: true },
            },
        });
        const initial = store.getState();
        let notifications = 0;
        store.subscribe(() => { notifications += 1; });
        store.getState().applyAuthoringMemory({
            recentMachinePaths: [{ machineId: 'machine-a', path: '/repo' }],
        });
        expect(store.getState()).toBe(initial);
        expect(notifications).toBe(0);
        store.getState().applyAuthoringMemory({ lastUsedProfile: 'profile-a' });
        expect(store.getState().authoringMemory.recentMachinePaths).toBe(initial.authoringMemory.recentMachinePaths);
        expect(store.getState().authoringMemory.currentRememberedEngineSelectionsByScopeV1).toBe(
            initial.authoringMemory.currentRememberedEngineSelectionsByScopeV1,
        );
        expect(store.getState().authoringMemory.lastEngineSelectionsByScopeV1['server-a:backend:future']).toEqual({ v: 2, opaque: true });
        expect(notifications).toBe(1);
    });

    it('clears all materialized values on Account/Home retirement', () => {
        const store = createStore<AuthoringMemoryDomain>()((set, get) => createAuthoringMemoryDomain({ set, get }));
        store.getState().applyAuthoringMemory({ recentMachinePaths: [{ machineId: 'machine-a', path: '/repo' }], lastUsedProfile: 'profile-a' });
        store.getState().resetAuthoringMemory();
        expect(store.getState().authoringMemory).toMatchObject({ recentMachinePaths: [], lastUsedProfile: null, lastEngineSelectionsByScopeV1: {} });
    });
});
