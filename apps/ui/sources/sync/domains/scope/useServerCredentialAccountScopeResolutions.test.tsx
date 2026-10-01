import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

type CredentialMutationEvent = Readonly<{
    kind: 'credentials_set' | 'credentials_removed';
    serverId: string;
    serverUrl: string;
}>;

const harness = vi.hoisted(() => ({
    tokenByServerId: new Map<string, string>(),
    unreadableServerIds: new Set<string>(),
    profiles: new Map<string, { id: string; serverUrl: string }>(),
    listeners: new Set<(event: CredentialMutationEvent) => void>(),
    profilesGeneration: 1,
    credentialReadGate: null as Promise<void> | null,
}));
const captureExceptionIfEnabled = vi.hoisted(() => vi.fn());

vi.mock('@/utils/system/sentry', async (importOriginal) => ({
    ...(await (importOriginal as () => Promise<typeof import('@/utils/system/sentry')>)()),
    captureExceptionIfEnabled,
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({
    useServerProfilesGeneration: () => harness.profilesGeneration,
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await (importOriginal as () => Promise<typeof import('@/sync/domains/server/serverProfiles')>)();
    return {
        ...actual,
        areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
        getServerProfileById: (serverId: string) => harness.profiles.get(serverId) ?? null,
        resolveServerProfileScopeIdForIdentifier: (serverId: unknown) => String(serverId ?? '').trim(),
    };
});

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: async (
                _serverUrl: string,
                options: { serverId?: string | null; storageReadFailure?: 'absent' | 'surface' },
            ) => {
                await harness.credentialReadGate;
                // Mirrors the real owner (proven in serverCredentialAccountScope.test.ts):
                // an unreadable store throws only for a reader that asked to see it.
                if (harness.unreadableServerIds.has(options.serverId ?? '')) {
                    if (options.storageReadFailure === 'surface') throw new Error('secure_storage_unavailable');
                    return null;
                }
                const token = harness.tokenByServerId.get(options.serverId ?? '');
                return token ? {
                    token: token === 'malformed'
                        ? token
                        : `header.${Buffer.from(JSON.stringify({ sub: token })).toString('base64')}.signature`,
                } : null;
            },
        },
        subscribeHomeCredentialMutations: () => () => undefined,
    });
});
vi.mock('@/sync/runtime/orchestration/homeAccountChange', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/orchestration/homeAccountChange')>(),
    subscribeHomeCredentialChange: (listener: (event: CredentialMutationEvent) => void) => {
        harness.listeners.add(listener);
        return () => harness.listeners.delete(listener);
    },
}));


function emitCredentialMutation(event: CredentialMutationEvent): void {
    act(() => {
        for (const listener of [...harness.listeners]) listener(event);
    });
}

function saveProfile(serverId: string): void {
    harness.profiles.set(serverId, { id: serverId, serverUrl: `https://${serverId}.example.test` });
}

afterEach(() => {
    harness.tokenByServerId.clear();
    harness.unreadableServerIds.clear();
    harness.profiles.clear();
    harness.listeners.clear();
    harness.profilesGeneration = 1;
    harness.credentialReadGate = null;
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
});

describe('useServerCredentialAccountScopeResolutions', () => {
    it('binds each Home to the Account held by that Home own credential', async () => {
        saveProfile('home-a');
        saveProfile('home-b');
        harness.tokenByServerId.set('home-a', 'account-a');
        harness.tokenByServerId.set('home-b', 'account-b');
        const sessionRows = {};
        storage.setState((state) => ({
            ...state,
            sessionListRowsByServerId: { ...state.sessionListRowsByServerId, 'home-a': sessionRows },
            sessionListIndexByServerId: { ...state.sessionListIndexByServerId, 'home-a': [] },
        }));

        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['home-a', 'home-b']));

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({
                kind: 'bound',
                scope: { serverId: 'home-a', accountId: 'account-a' },
            });
            expect(hook.getCurrent().get('home-b')).toEqual({
                kind: 'bound',
                scope: { serverId: 'home-b', accountId: 'account-b' },
            });
        });
        expect(storage.getState().sessionListRowsByServerId['home-a']).toBe(sessionRows);
    });

    it('reports a Home this device has not saved as unknown rather than signed out', async () => {
        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['never-added']));

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('never-added')).toEqual({ kind: 'unknown_home' });
        });
    });

    it('reports a saved Home with no credential as signed out', async () => {
        saveProfile('home-a');

        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['home-a']));

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({ kind: 'signed_out' });
        });
    });

    it('treats a malformed credential as signed out, never as a bound Account', async () => {
        saveProfile('home-a');
        harness.tokenByServerId.set('home-a', 'malformed');

        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['home-a']));

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({ kind: 'signed_out' });
        });
    });

    it('keeps a secure-storage read failure distinct from a confirmed sign-out', async () => {
        captureExceptionIfEnabled.mockClear();
        saveProfile('home-a');
        harness.unreadableServerIds.add('home-a');

        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['home-a']));

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({ kind: 'unavailable' });
        });
        expect(captureExceptionIfEnabled).toHaveBeenCalledWith(expect.any(Error), {
            tags: { operation: 'resolve_server_credential_account_scope' },
            extra: { serverId: 'home-a' },
        });
    });

    it('re-reads an unreadable Home on request so its surfaces can settle once storage recovers', async () => {
        saveProfile('home-a');
        saveProfile('home-b');
        harness.unreadableServerIds.add('home-a');
        harness.tokenByServerId.set('home-b', 'account-b');

        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const { retryServerCredentialAccountScope } = await import('./serverCredentialAccountScope');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['home-a', 'home-b']));

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({ kind: 'unavailable' });
            expect(hook.getCurrent().get('home-b')?.kind).toBe('bound');
        });
        const settledSibling = hook.getCurrent().get('home-b');

        harness.unreadableServerIds.delete('home-a');
        harness.tokenByServerId.set('home-a', 'account-a');
        act(() => {
            retryServerCredentialAccountScope('home-a');
        });

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({
                kind: 'bound',
                scope: { serverId: 'home-a', accountId: 'account-a' },
            });
        });
        // A retry re-reads only the Home that was asked about.
        expect(hook.getCurrent().get('home-b')).toBe(settledSibling);
    });

    it('rebinds one Home when its credential changes and leaves its siblings alone', async () => {
        saveProfile('home-a');
        saveProfile('home-b');
        harness.tokenByServerId.set('home-a', 'account-a');
        harness.tokenByServerId.set('home-b', 'account-b');

        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['home-a', 'home-b']));
        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({
                kind: 'bound',
                scope: { serverId: 'home-a', accountId: 'account-a' },
            });
        });

        harness.tokenByServerId.set('home-a', 'account-a2');
        emitCredentialMutation({
            kind: 'credentials_set',
            serverId: 'home-a',
            serverUrl: 'https://home-a.example.test',
        });

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({
                kind: 'bound',
                scope: { serverId: 'home-a', accountId: 'account-a2' },
            });
        });
        expect(hook.getCurrent().get('home-b')).toEqual({
            kind: 'bound',
            scope: { serverId: 'home-b', accountId: 'account-b' },
        });
    });

    it('retains a settled Account projection while an unchanged Home profile is revalidated', async () => {
        saveProfile('home-a');
        harness.tokenByServerId.set('home-a', 'account-a');

        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['home-a']));
        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({
                kind: 'bound',
                scope: { serverId: 'home-a', accountId: 'account-a' },
            });
        });

        let releaseCredentialRead: (() => void) | undefined;
        harness.credentialReadGate = new Promise<void>((resolve) => {
            releaseCredentialRead = resolve;
        });
        harness.profilesGeneration += 1;
        await hook.rerender();

        expect(hook.getCurrent().get('home-a')).toEqual({
            kind: 'bound',
            scope: { serverId: 'home-a', accountId: 'account-a' },
        });

        await act(async () => {
            releaseCredentialRead?.();
            harness.credentialReadGate = null;
        });
        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({
                kind: 'bound',
                scope: { serverId: 'home-a', accountId: 'account-a' },
            });
        });
    });

    it('does not expose a retired binding while retaining its settled revalidation projection', async () => {
        saveProfile('home-a');
        harness.tokenByServerId.set('home-a', 'account-a');

        const {
            useServerCredentialAccountScopeBindings,
            useServerCredentialAccountScopeResolutions,
        } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => ({
            bindings: useServerCredentialAccountScopeBindings(['home-a']),
            resolutions: useServerCredentialAccountScopeResolutions(['home-a']),
        }));
        await vi.waitFor(() => {
            expect(hook.getCurrent().bindings.has('home-a')).toBe(true);
            expect(hook.getCurrent().resolutions.get('home-a')?.kind).toBe('bound');
        });

        let releaseCredentialRead: (() => void) | undefined;
        harness.credentialReadGate = new Promise<void>((resolve) => {
            releaseCredentialRead = resolve;
        });
        harness.profilesGeneration += 1;
        await hook.rerender();

        expect(hook.getCurrent().bindings.has('home-a')).toBe(false);
        expect(hook.getCurrent().resolutions.get('home-a')).toEqual({
            kind: 'bound',
            scope: { serverId: 'home-a', accountId: 'account-a' },
        });

        await act(async () => {
            releaseCredentialRead?.();
            harness.credentialReadGate = null;
        });
    });

    it('stops claiming an Account once that Home credential is removed', async () => {
        saveProfile('home-a');
        harness.tokenByServerId.set('home-a', 'account-a');

        const { useServerCredentialAccountScopeResolutions } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolutions(['home-a']));
        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')?.kind).toBe('bound');
        });

        harness.tokenByServerId.delete('home-a');
        emitCredentialMutation({
            kind: 'credentials_removed',
            serverId: 'home-a',
            serverUrl: 'https://home-a.example.test',
        });

        await vi.waitFor(() => {
            expect(hook.getCurrent().get('home-a')).toEqual({ kind: 'signed_out' });
        });
    });
});

describe('useServerCredentialAccountScopeResolution', () => {
    it('resolves the one requested Home without the caller assembling a set', async () => {
        saveProfile('home-a');
        harness.tokenByServerId.set('home-a', 'account-a');

        const { useServerCredentialAccountScopeResolution } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolution('home-a'));

        await vi.waitFor(() => {
            expect(hook.getCurrent()).toEqual({
                kind: 'bound',
                scope: { serverId: 'home-a', accountId: 'account-a' },
            });
        });
    });

    it('reports an empty Home id as unknown instead of resolving forever', async () => {
        const { useServerCredentialAccountScopeResolution } = await import('./useServerCredentialAccountScopes');
        const hook = await renderHook(() => useServerCredentialAccountScopeResolution('   '));

        await vi.waitFor(() => {
            expect(hook.getCurrent()).toEqual({ kind: 'unknown_home' });
        });
    });
});
