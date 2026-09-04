import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

const harness = vi.hoisted(() => ({
    tokenByServerId: new Map<string, string>(),
    credentialLookups: [] as string[],
    listeners: new Set<(event: { serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }) => void>(),
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({ useServerProfilesGeneration: () => 1 }));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        areServerProfileIdentifiersEquivalent: (left: string, right: string) => (
            left === right || [left, right].sort().join(':') === 'local-home-b:srv-home-b'
        ),
        getServerProfileById: (serverId: string) => serverId === 'srv-home-b' || serverId === 'local-home-b'
            ? { id: 'local-home-b', serverIdentityId: 'srv-home-b', serverUrl: 'https://home-b.example.test' }
            : { id: serverId, serverUrl: `https://${serverId}.example.test` },
        resolveServerProfileScopeIdForIdentifier: (serverId: string) => serverId === 'local-home-b' ? 'srv-home-b' : serverId,
    };
});
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: async (_serverUrl: string, options: { serverId?: string }) => {
            harness.credentialLookups.push(options.serverId ?? '');
            const token = harness.tokenByServerId.get(options.serverId ?? '');
            return token ? { token } : null;
        },
    },
    subscribeHomeCredentialMutations: (listener: (event: { serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }) => void) => {
        harness.listeners.add(listener);
        return () => harness.listeners.delete(listener);
    },
}));
vi.mock('@/utils/auth/parseToken', () => ({ parseToken: (token: string) => token }));

afterEach(() => {
    harness.tokenByServerId.clear();
    harness.credentialLookups = [];
    harness.listeners.clear();
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
});

describe('useServerCredentialAccountScopes', () => {
    it('resolves each Home Account from that Home credential and immediately retires it on mutation', async () => {
        harness.tokenByServerId.set('home-a', 'account-a');
        harness.tokenByServerId.set('home-b', 'account-b');
        const { useServerCredentialAccountScopes } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopes(['home-a', 'home-b']));

        await vi.waitFor(() => expect(hook.getCurrent().get('home-b')?.accountId).toBe('account-b'));
        const oldBinding = hook.getCurrent().get('home-b')!;
        storage.setState((state) => ({
            ...state,
            sessionListRowStateByServerId: { ...state.sessionListRowStateByServerId, 'home-b': {} },
            sessionListIndexByServerId: { ...state.sessionListIndexByServerId, 'home-b': [] },
        }));

        harness.tokenByServerId.set('home-b', 'account-b-next');
        await act(async () => {
            for (const listener of harness.listeners) {
                listener({ kind: 'credentials_set', serverId: 'home-b', serverUrl: 'https://home-b.example.test' });
            }
            expect(oldBinding.isCurrent()).toBe(false);
            expect(storage.getState().sessionListRowStateByServerId['home-b']).toBeUndefined();
            expect(storage.getState().sessionListIndexByServerId['home-b']).toBeUndefined();
        });

        await vi.waitFor(() => expect(hook.getCurrent().get('home-b')?.accountId).toBe('account-b-next'));
        expect(hook.getCurrent().get('home-a')?.accountId).toBe('account-a');
    });

    it('keys a local profile request and its credential lookup by portable server identity', async () => {
        harness.tokenByServerId.set('srv-home-b', 'account-b');
        const { useServerCredentialAccountScopes } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopes(['local-home-b']));

        await vi.waitFor(() => expect(hook.getCurrent().get('srv-home-b')?.accountId).toBe('account-b'));
        expect(hook.getCurrent().has('local-home-b')).toBe(false);
        expect(harness.credentialLookups).toContain('srv-home-b');
    });
});
