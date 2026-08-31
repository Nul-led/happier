import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

const credentialState = vi.hoisted(() => ({
    present: true,
    listener: null as null | ((event: Readonly<{ kind: 'credentials_set' | 'credentials_removed'; serverId: string; serverUrl: string }>) => void),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: vi.fn(async () => credentialState.present ? { token: 'token', secret: 'secret' } : null),
    },
    subscribeHomeCredentialMutations: (listener: typeof credentialState.listener) => {
        credentialState.listener = listener;
        return () => {
            credentialState.listener = null;
        };
    },
}));

describe('useServerAuthStatusByServerId', () => {
    beforeEach(() => {
        credentialState.present = true;
        credentialState.listener = null;
    });

    it('refreshes the canonical Home auth status after a credential mutation', async () => {
        const { useServerAuthStatusByServerId } = await import('./useServerAuthStatusByServerId');
        const servers = [{ id: 'profile-a', serverIdentityId: 'home-a', serverUrl: 'https://a.example.test' }];
        const hook = await renderHook(() => useServerAuthStatusByServerId(servers));

        await vi.waitFor(() => expect(hook.getCurrent()['home-a']).toBe('signedIn'));

        credentialState.present = false;
        await act(async () => {
            credentialState.listener?.({
                kind: 'credentials_removed',
                serverId: 'home-a',
                serverUrl: 'https://a.example.test',
            });
        });

        await vi.waitFor(() => expect(hook.getCurrent()['home-a']).toBe('signedOut'));
        expect(hook.getCurrent()['home-a']).toBe('signedOut');
    });
});
