import * as React from 'react';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { renderScreen } from '@/dev/testkit';
import { createModalModuleMock } from '@/dev/testkit/mocks/modal';

import { installServerSettingsHooksCommonModuleMocks } from './serverSettingsHooksTestHelpers';

const modalSpies = vi.hoisted(() => ({
    alert: vi.fn(),
    confirm: vi.fn(),
    prompt: vi.fn(),
    show: vi.fn(),
}));

const credentialLifecycleSpies = vi.hoisted(() => ({
    present: vi.fn(async (params: {
        run: () => Promise<
            | { kind: 'completed' }
            | { kind: 'finish_encryption_setup'; recovery: unknown }
            | { kind: 'recovery_failed' }
        >;
        onCompleted?: () => void | Promise<void>;
    }) => {
        const result = await params.run();
        if (result.kind === 'completed') {
            await params.onCompleted?.();
        }
    }),
}));

installServerSettingsHooksCommonModuleMocks({
    modal: () => createModalModuleMock({ spies: modalSpies }).module,
});

vi.mock('@/components/account/presentFirstKeyCredentialLifecycle', () => ({
    presentFirstKeyCredentialLifecycle: credentialLifecycleSpies.present,
}));

const pendingTerminalConnectMock = vi.hoisted(() => ({
    current: null as { publicKeyB64Url: string; serverUrl: string; serverIdentityId: string } | null,
    set: vi.fn((value: { publicKeyB64Url: string; serverUrl: string; serverIdentityId: string }) => {
        pendingTerminalConnectMock.current = value;
    }),
    retarget: vi.fn(),
}));

vi.mock('@/sync/domains/pending/pendingTerminalConnect', () => ({
    getPendingTerminalConnect: () => pendingTerminalConnectMock.current,
    setPendingTerminalConnect: pendingTerminalConnectMock.set,
    retargetPendingTerminalConnectToServerUrl: pendingTerminalConnectMock.retarget,
}));

vi.mock('expo-secure-store', () => ({}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function randomScope(): string {
    return `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function renderHook<T>(useValue: () => T): Promise<T> {
    let current: T | null = null;

    function Test() {
        current = useValue();
        return null;
    }

    await renderScreen(React.createElement(Test));

    if (!current) throw new Error('Hook did not render');
    return current;
}

afterEach(async () => {
    vi.unstubAllGlobals();
    pendingTerminalConnectMock.current = null;
    credentialLifecycleSpies.present.mockClear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Reset profile runtime caches instead of reloading the whole module graph
    // per test (each reload retained ~0.8GB and exhausted the default heap).
    (await import('@/sync/domains/server/serverProfiles')).resetServerProfilesRuntimeForTests();
});

describe('useServerSettingsServerProfileActions (remove server)', () => {
    it('clears server-scoped credentials so re-adding the server does not resurrect auth', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();

        const { Modal } = await import('@/modal');
        (Modal.confirm as any).mockResolvedValueOnce(true);

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = await profiles.upsertServerProfile({
            serverUrl: 'https://server-a.example.test',
            name: 'Server A',
        });
        await profiles.setActiveServerId(profile.id, { scope: 'device' });

        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await expect(TokenStorage.setCredentials({ token: 'token-a', secret: 'secret-a' })).resolves.toBe(true);
        await expect(TokenStorage.getCredentialsForServerUrl(profile.serverUrl)).resolves.toEqual({
            token: 'token-a',
            secret: 'secret-a',
        });

        let revision = 0;
        const setRevision = (next: any) => {
            revision = typeof next === 'function' ? next(revision) : next;
        };

        const { useServerSettingsServerProfileActions } = await import('./useServerSettingsServerProfileActions');
        const actions = await renderHook(() =>
            useServerSettingsServerProfileActions({
                authStatusByServerId: {},
                selectionScope: 'tab',
                onSwitchServerById: vi.fn(async () => 'switched' as const),
                onAfterSignedOutSwitch: vi.fn(),
                setRevision: setRevision as any,
            }),
        );

        await actions.onRemoveServer(profile);
        expect(revision).toBeGreaterThan(0);

        const readded = await profiles.upsertServerProfile({ serverUrl: profile.serverUrl, name: 'Server A (again)' });
        expect(readded.id).toBe(profile.id);
        await expect(TokenStorage.getCredentialsForServerUrl(profile.serverUrl)).resolves.toBeNull();

        localStorageHandle.restore();
    });

    it('routes marked nonactive profile removal through shared recovery without mutating credentials or profile', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();

        const profiles = await import('@/sync/domains/server/serverProfiles');
        const targetProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://marked.example.test',
            name: 'Marked',
        });
        const activeProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        await profiles.setActiveServerId(targetProfile.id, { scope: 'device' });

        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await expect(TokenStorage.setCredentials({
            token: 'marked-token',
            secret: 'marked-secret',
        })).resolves.toBe(true);
        const createdAt = Date.now();
        await expect(TokenStorage.setPendingExternalAuth({
            provider: 'github',
            proof: 'proof',
            secret: 'marked-secret',
            serverId: targetProfile.id,
            serverUrl: targetProfile.serverUrl,
            returnTo: '/settings/account',
            accountEncryptionFirstKey: {
                accountId: 'account-1',
                requestDigest: `aemrb1_${'A'.repeat(43)}`,
                requestJson: '{"toMode":"e2ee"}',
                createdAt,
                expiresAt: createdAt + 10 * 60 * 1000,
                pending: 'oauth-pending',
                migrationSubmissionAttempted: true,
            },
        })).resolves.toBe(true);
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });
        const { Modal } = await import('@/modal');
        (Modal.confirm as any).mockResolvedValueOnce(true);

        let revision = 0;
        const { useServerSettingsServerProfileActions } = await import('./useServerSettingsServerProfileActions');
        const actions = await renderHook(() =>
            useServerSettingsServerProfileActions({
                authStatusByServerId: {},
                selectionScope: 'tab',
                onSwitchServerById: vi.fn(async () => 'switched' as const),
                onAfterSignedOutSwitch: vi.fn(),
                setRevision: ((next: React.SetStateAction<number>) => {
                    revision = typeof next === 'function'
                        ? next(revision)
                        : next;
                }) as React.Dispatch<React.SetStateAction<number>>,
            }),
        );

        await actions.onRemoveServer(targetProfile);

        expect(Modal.confirm).toHaveBeenCalledTimes(1);
        expect(revision).toBe(0);
        expect(profiles.getServerProfileById(targetProfile.id)).not.toBeNull();
        await expect(TokenStorage.getCredentialsForServerUrl(
            targetProfile.serverUrl,
            { serverId: targetProfile.id },
        )).resolves.toEqual({
            token: 'marked-token',
            secret: 'marked-secret',
        });

        localStorageHandle.restore();
    });

    it('retargets a pending terminal connect when the user manually switches relays', async () => {
        pendingTerminalConnectMock.current = {
            publicKeyB64Url: 'abc123',
            serverUrl: 'https://wrong.example.test',
            serverIdentityId: 'srv_original_home',
        };
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const setRevision = vi.fn();
        const profile = {
            id: 'server-correct',
            name: 'Correct',
            serverUrl: 'https://correct.example.test',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        };

        const { useServerSettingsServerProfileActions } = await import('./useServerSettingsServerProfileActions');
        const actions = await renderHook(() =>
            useServerSettingsServerProfileActions({
                authStatusByServerId: { 'server-correct': 'signedIn' },
                selectionScope: 'tab',
                onSwitchServerById,
                onAfterSignedOutSwitch: vi.fn(),
                setRevision: setRevision as any,
            }),
        );

        await actions.onSwitchServer(profile);

        expect(pendingTerminalConnectMock.retarget).toHaveBeenCalledWith('https://correct.example.test');
        expect(onSwitchServerById).toHaveBeenCalledWith('server-correct', 'tab');
    });

    it('selects a signed-out Home and continues to target-specific auth without another prompt', async () => {
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const onAfterSignedOutSwitch = vi.fn();
        const setRevision = vi.fn();
        const profile = {
            id: 'server-signed-out',
            name: 'Signed out',
            serverUrl: 'https://signed-out.example.test',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        };

        const { useServerSettingsServerProfileActions } = await import('./useServerSettingsServerProfileActions');
        const actions = await renderHook(() =>
            useServerSettingsServerProfileActions({
                authStatusByServerId: { 'server-signed-out': 'signedOut' },
                selectionScope: 'tab',
                onSwitchServerById,
                onAfterSignedOutSwitch,
                setRevision: setRevision as any,
            }),
        );

        await actions.onSwitchServer(profile);

        expect(modalSpies.confirm).not.toHaveBeenCalled();
        expect(onSwitchServerById).toHaveBeenCalledWith('server-signed-out', 'tab');
        expect(onAfterSignedOutSwitch).toHaveBeenCalledTimes(1);
    });

    it('does not route a Home whose credential store cannot be read to sign-in', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const localStorageHandle = installLocalStorageMock();
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = await profiles.upsertServerProfile({
            serverUrl: 'https://unreadable.example.test',
            name: 'Unreadable',
        });
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        // Secure-storage boundary: an unreadable store reads as absent unless
        // the caller asks for the failure to surface, as the real owner does.
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockImplementation(async (_serverUrl, options) => {
            if (options?.storageReadFailure === 'surface') throw new Error('secure_storage_unavailable');
            return null;
        });
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const onAfterSignedOutSwitch = vi.fn();

        const { useServerSettingsServerProfileActions } = await import('./useServerSettingsServerProfileActions');
        const actions = await renderHook(() =>
            useServerSettingsServerProfileActions({
                authStatusByServerId: {},
                selectionScope: 'tab',
                onSwitchServerById,
                onAfterSignedOutSwitch,
                setRevision: vi.fn() as any,
            }),
        );

        await actions.onSwitchServer(profile);

        expect(onSwitchServerById).toHaveBeenCalledWith(profiles.resolveServerProfileScopeId(profile), 'tab');
        expect(onAfterSignedOutSwitch).not.toHaveBeenCalled();
        localStorageHandle.restore();
    });

    it('does not retarget pending terminal state when custody blocks the server switch', async () => {
        pendingTerminalConnectMock.current = {
            publicKeyB64Url: 'abc123',
            serverUrl: 'https://active.example.test',
            serverIdentityId: 'srv_original_home',
        };
        const onSwitchServerById = vi.fn(async () => 'blocked' as const);
        const setRevision = vi.fn();
        const profile = {
            id: 'server-blocked',
            name: 'Blocked',
            serverUrl: 'https://blocked.example.test',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        };

        const { useServerSettingsServerProfileActions } = await import('./useServerSettingsServerProfileActions');
        const actions = await renderHook(() =>
            useServerSettingsServerProfileActions({
                authStatusByServerId: { 'server-blocked': 'signedIn' },
                selectionScope: 'tab',
                onSwitchServerById,
                onAfterSignedOutSwitch: vi.fn(),
                setRevision: setRevision as any,
            }),
        );

        await actions.onSwitchServer(profile);

        expect(onSwitchServerById).toHaveBeenCalledWith('server-blocked', 'tab');
        expect(pendingTerminalConnectMock.retarget).not.toHaveBeenCalled();
        expect(setRevision).not.toHaveBeenCalled();
    });

    it('switches by server identity id after the profile learns a stable server identity', async () => {
        pendingTerminalConnectMock.current = {
            publicKeyB64Url: 'abc123',
            serverUrl: 'https://wrong.example.test',
            serverIdentityId: 'srv_original_home',
        };
        const onSwitchServerById = vi.fn(async () => 'switched' as const);
        const setRevision = vi.fn();
        const profile = {
            id: 'server-host-derived',
            name: 'Correct',
            serverUrl: 'https://correct.example.test',
            serverIdentityId: 'srv_identity_correct',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
        };

        const { useServerSettingsServerProfileActions } = await import('./useServerSettingsServerProfileActions');
        const actions = await renderHook(() =>
            useServerSettingsServerProfileActions({
                authStatusByServerId: { srv_identity_correct: 'signedIn' },
                selectionScope: 'tab',
                onSwitchServerById,
                onAfterSignedOutSwitch: vi.fn(),
                setRevision: setRevision as any,
            }),
        );

        await actions.onSwitchServer(profile);

        expect(pendingTerminalConnectMock.retarget).toHaveBeenCalledWith('https://correct.example.test');
        expect(onSwitchServerById).toHaveBeenCalledWith('srv_identity_correct', 'tab');
    });
});
