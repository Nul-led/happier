import { act } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storage';

const credentials = vi.hoisted(() => ({
    accountId: 'viewer-a' as string | null,
    listeners: new Set<(event: { kind: 'credentials_set' | 'credentials_removed'; serverId: string; serverUrl: string }) => void>(),
}));

// Device credential storage is the boundary; identity parsing and scope lifecycle stay real.
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: async () => credentials.accountId ? {
                token: `header.${Buffer.from(JSON.stringify({ sub: credentials.accountId })).toString('base64')}.signature`,
            } : null,
        },
        subscribeHomeCredentialMutations: (listener: Parameters<typeof credentials.listeners.add>[0]) => {
            credentials.listeners.add(listener);
            return () => { credentials.listeners.delete(listener); };
        },
    });
});

afterEach(() => {
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
    credentials.listeners.clear();
    credentials.accountId = 'viewer-a';
});

it('resolves an inactive Home viewer without clearing its Session rows and retires changed credentials', async () => {
    const home = await upsertServerProfile({ serverUrl: 'https://transcript-viewer.example.test' });
    const rows = {};
    storage.setState({
        profileScope: { serverId: 'another-home', accountId: 'another-account' },
        sessions: { transcript: createSessionFixture({ id: 'transcript', serverId: home.id }) },
        sessionListRowsByServerId: { [home.id]: rows },
        sessionListIndexByServerId: { [home.id]: [] },
    });
    const { useSessionMessageViewerScope } = await import('./useSessionMessageViewerScope');
    const hook = await renderHook(() => useSessionMessageViewerScope('transcript'));
    await vi.waitFor(() => expect(hook.getCurrent()).toEqual({ serverId: home.id, accountId: 'viewer-a' }));
    expect(storage.getState().sessionListRowsByServerId[home.id]).toBe(rows);

    credentials.accountId = 'viewer-b';
    await act(async () => {
        for (const listener of credentials.listeners) listener({ kind: 'credentials_set', serverId: home.id, serverUrl: home.serverUrl });
    });
    await vi.waitFor(() => expect(hook.getCurrent()).toEqual({ serverId: home.id, accountId: 'viewer-b' }));
    expect(storage.getState().sessionListRowsByServerId[home.id]).toBe(rows);

    credentials.accountId = null;
    await act(async () => {
        for (const listener of credentials.listeners) listener({ kind: 'credentials_removed', serverId: home.id, serverUrl: home.serverUrl });
    });
    await vi.waitFor(() => expect(hook.getCurrent()).toBeNull());
});
