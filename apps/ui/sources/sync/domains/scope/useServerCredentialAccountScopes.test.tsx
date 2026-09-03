import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

const harness = vi.hoisted(() => ({
    tokenByServerId: new Map<string, string>(),
    listeners: new Set<(event: { serverId: string; serverUrl: string; kind: 'credentials_set' | 'credentials_removed' }) => void>(),
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({ useServerProfilesGeneration: () => 1 }));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
    getServerProfileById: (serverId: string) => ({ id: serverId, serverUrl: `https://${serverId}.example.test` }),
    resolveServerProfileScopeIdForIdentifier: (serverId: string) => serverId,
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: async (_serverUrl: string, options: { serverId?: string }) => {
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
    harness.listeners.clear();
    standardCleanup();
});

describe('useServerCredentialAccountScopes', () => {
    it('resolves each Home Account from that Home credential and immediately retires it on mutation', async () => {
        harness.tokenByServerId.set('home-a', 'account-a');
        harness.tokenByServerId.set('home-b', 'account-b');
        const { useServerCredentialAccountScopes } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopes(['home-a', 'home-b']));

        await vi.waitFor(() => expect(hook.getCurrent().get('home-b')?.accountId).toBe('account-b'));
        const oldBinding = hook.getCurrent().get('home-b')!;

        harness.tokenByServerId.set('home-b', 'account-b-next');
        await act(async () => {
            for (const listener of harness.listeners) {
                listener({ kind: 'credentials_set', serverId: 'home-b', serverUrl: 'https://home-b.example.test' });
            }
            expect(oldBinding.isCurrent()).toBe(false);
        });

        await vi.waitFor(() => expect(hook.getCurrent().get('home-b')?.accountId).toBe('account-b-next'));
        expect(hook.getCurrent().get('home-a')?.accountId).toBe('account-a');
    });
});
