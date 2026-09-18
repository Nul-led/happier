import { describe, expect, it, vi } from 'vitest';
import { createMachineFixture, createSessionFixture, renderHook } from '@/dev/testkit';
import { createLiveStorageStoreMock, createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';

const state = vi.hoisted(() => ({ value: {} }));
vi.mock('@/sync/domains/state/storage', () => {
    const store = createLiveStorageStoreMock(() => state.value);
    return createStorageModuleStub({ storage: store, getStorage: () => store });
});

import { useSessionMachineTarget } from './useSessionMachineTarget';

describe('Session machine target binding', () => {
    it('uses the captured Home instead of a same-id active Session', async () => {
        const machineA = createMachineFixture({ id: 'machine-a', active: true });
        const machineB = createMachineFixture({ id: 'machine-b', active: true });
        const sessionA = createSessionFixture({ id: 'same-session', serverId: 'home-a', active: true, metadata: { machineId: 'machine-a', path: '/a' } });
        const sessionB = createSessionFixture({ id: 'same-session', serverId: 'home-b', active: true, metadata: { machineId: 'machine-b', path: '/b' } });
        state.value = { machineListByServerId: { 'home-a': [machineA], 'home-b': [machineB] }, sessions: { 'same-session': sessionA }, machines: { 'machine-a': machineA, 'machine-b': machineB },
            sessionListRowsByServerId: { 'home-a': { 'same-session': buildSessionListRenderableFromSession(sessionA) }, 'home-b': { 'same-session': buildSessionListRenderableFromSession(sessionB) } } };
        // Existing canonical resolver accepts this identity; the hook must preserve it.
        const target = { serverId: 'home-b', sessionId: 'same-session' };
        const hook = await renderHook(() => useSessionMachineTarget(target));
        expect(hook.getCurrent()).toMatchObject({ machineId: 'machine-b', basePath: '/b' });
        await hook.unmount();
    });
});
