import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    AccountEncryptionFirstKeyCredentialMutationResult,
    AccountEncryptionFirstKeyRecoveryHandle,
} from '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth';

const switchConnectionToActiveServerSpy = vi.hoisted(() => vi.fn(
    async (_params?: unknown): Promise<void | null> => null,
));
const guardCredentialMutationSpy = vi.hoisted(() => vi.fn<
    () => Promise<AccountEncryptionFirstKeyCredentialMutationResult>
>(async () => ({ kind: 'allowed' })));
const presentCredentialLifecycleSpy = vi.hoisted(() => vi.fn(async (params: {
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
}));

vi.mock('@/sync/http/client', () => ({
    abortServerFetches: vi.fn(),
}));

vi.mock('@/sync/sync', () => ({
    syncSwitchServer: vi.fn(async () => {}),
}));

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    switchConnectionToActiveServer: switchConnectionToActiveServerSpy,
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentials: vi.fn(async () => null),
        getCredentialsForServerUrl: vi.fn(async () => null),
    },
}));

vi.mock('@/sync/ops/account/accountEncryptionFirstKeyExternalAuth', () => ({
    guardAccountEncryptionFirstKeyCredentialMutation: guardCredentialMutationSpy,
}));

vi.mock('@/components/account/presentFirstKeyCredentialLifecycle', () => ({
    presentFirstKeyCredentialLifecycle: presentCredentialLifecycleSpy,
}));

function randomScope(): string {
    return `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function stubWebRuntime(origin: string) {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
        clear: () => void store.clear(),
    });
    vi.stubGlobal('window', { location: { origin } });
    vi.stubGlobal('document', {});
    const lockTails = new Map<string, Promise<void>>();
    vi.stubGlobal('navigator', {
        locks: {
            request: <T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> => {
                const previous = lockTails.get(name) ?? Promise.resolve();
                const result = previous.then(callback);
                lockTails.set(name, result.then(() => undefined, () => undefined));
                return result;
            },
        },
    });
}

async function importFreshServerModules() {
    vi.resetModules();
    const [profiles, switches] = await Promise.all([
        import('./serverProfiles'),
        import('./activeServerSwitch'),
    ]);
    return { profiles, switches };
}

describe('activeServerSwitch device scope', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        vi.unstubAllGlobals();
        guardCredentialMutationSpy.mockReset();
        guardCredentialMutationSpy.mockResolvedValue({ kind: 'allowed' });
        presentCredentialLifecycleSpy.mockClear();
        switchConnectionToActiveServerSpy.mockClear();
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
    });

    it('promotes the current tab active server to the device active server by id', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const { profiles, switches } = await importFreshServerModules();
        const deviceProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://device.example.test',
            name: 'Device',
        });
        const tabProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://tab.example.test',
            name: 'Tab',
        });
        await profiles.setActiveServerId(deviceProfile.id, { scope: 'device' });
        await profiles.setActiveServerId(tabProfile.id, { scope: 'tab' });

        const switched = await switches.setActiveServerAndSwitch({
            serverId: tabProfile.id,
            scope: 'device',
        });

        expect(switched).toBe('switched');
        expect(profiles.getTabActiveServerId()).toBeNull();
        expect(profiles.getDeviceDefaultServerId()).toBe(tabProfile.id);
        expect(profiles.getActiveServerId()).toBe(tabProfile.id);
    });

    it('opens the exact adopted Home separately from non-focusing adoption without changing groups', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const { profiles, switches } = await importFreshServerModules();
        const activeProfile = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_active_home',
                canonicalServerUrl: 'https://active.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://active.example.test' }],
            },
        });
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });
        await profiles.saveHomeViewState({
            version: 1,
            groups: [{
                id: 'saved-homes',
                name: 'Saved Homes',
                serverIds: [activeProfile.id],
                presentation: 'grouped',
            }],
            activeTargetKind: 'server',
            activeTargetId: activeProfile.id,
        });
        const groupsBefore = profiles.loadHomeViewState()?.groups;

        const adopted = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_adopted_home',
                canonicalServerUrl: 'https://adopted.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://adopted.example.test' }],
            },
        });

        expect(profiles.getServerProfileById(adopted.id)).toEqual(adopted);
        expect(profiles.getActiveServerId()).toBe(activeProfile.serverIdentityId);
        expect(profiles.loadHomeViewState()?.groups).toEqual(groupsBefore);
        expect(switchConnectionToActiveServerSpy).not.toHaveBeenCalled();

        await expect(switches.setActiveServerAndSwitch({
            serverId: adopted.id,
            scope: 'device',
        })).resolves.toBe('switched');

        expect(profiles.getActiveServerId()).toBe('srv_adopted_home');
        expect(profiles.getDeviceDefaultServerId()).toBe(adopted.id);
        expect(profiles.loadHomeViewState()?.groups).toEqual(groupsBefore);
        expect(switchConnectionToActiveServerSpy).toHaveBeenCalledOnce();
    });

    it('promotes the current tab active server to the device active server by url', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const { profiles, switches } = await importFreshServerModules();
        const deviceProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://device.example.test',
            name: 'Device',
        });
        const tabProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://tab.example.test',
            name: 'Tab',
        });
        await profiles.setActiveServerId(deviceProfile.id, { scope: 'device' });
        await profiles.setActiveServerId(tabProfile.id, { scope: 'tab' });

        const switched = await switches.upsertActivateAndSwitchServer({
            serverUrl: tabProfile.serverUrl,
            source: 'url',
            scope: 'device',
        });

        expect(switched).toBe('switched');
        expect(profiles.getTabActiveServerId()).toBeNull();
        expect(profiles.getDeviceDefaultServerId()).toBe(tabProfile.id);
        expect(profiles.getActiveServerUrl()).toBe('https://tab.example.test');
    });

    it('does not switch when the target id aliases the active server identity', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const { profiles, switches } = await importFreshServerModules();
        const profile = await profiles.upsertServerProfile({
            serverUrl: 'https://relay.example.test',
            name: 'Relay',
        });
        await profiles.setActiveServerId(profile.id, { scope: 'device' });
        await profiles.setServerProfileIdentityForUrl(profile.serverUrl, 'srv_identity_123');

        const switched = await switches.setActiveServerAndSwitch({
            serverId: profile.id,
            scope: 'device',
        });

        expect(switched).toBe('already_active');
        expect(profiles.getActiveServerId()).toBe('srv_identity_123');
        expect(profiles.getDeviceDefaultServerId()).toBe(profile.id);
    });

    it('reasserts an exact saved profile when its Home identity is already active', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const { profiles, switches } = await importFreshServerModules();
        const profile = await profiles.upsertServerProfile({
            serverUrl: 'https://relay.example.test',
            name: 'Relay',
        });
        await profiles.setActiveServerId(profile.id, { scope: 'device' });
        await profiles.setServerProfileIdentityForUrl(profile.serverUrl, 'srv_identity_123');
        const refreshAuth = vi.fn(async () => {});

        const switched = await switches.setActiveServerAndSwitch({
            serverId: profile.id,
            scope: 'device',
            refreshAuth,
            requireExactProfile: true,
        });

        expect(switched).toBe('switched');
        expect(profiles.getDeviceDefaultServerId()).toBe(profile.id);
        expect(switchConnectionToActiveServerSpy).toHaveBeenCalledOnce();
        expect(refreshAuth).toHaveBeenCalledOnce();
    });

    it('keeps active-server, connection, and auth refresh state unchanged until marked custody is adjudicated', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const recovery = {} as AccountEncryptionFirstKeyRecoveryHandle;
        guardCredentialMutationSpy.mockResolvedValue({
            kind: 'finish_encryption_setup',
            recovery,
        });
        const { profiles, switches } = await importFreshServerModules();
        const activeProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        const targetProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://target.example.test',
            name: 'Target',
        });
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });
        const refreshAuth = vi.fn(async () => {});

        const switched = await switches.setActiveServerAndSwitch({
            serverId: targetProfile.id,
            scope: 'device',
            refreshAuth,
        });

        expect(switched).toBe('blocked');
        expect(presentCredentialLifecycleSpy).toHaveBeenCalledTimes(1);
        expect(guardCredentialMutationSpy).toHaveBeenCalledTimes(1);
        expect(profiles.getActiveServerId()).toBe(activeProfile.id);
        expect(profiles.getDeviceDefaultServerId()).toBe(activeProfile.id);
        expect(switchConnectionToActiveServerSpy).not.toHaveBeenCalled();
        expect(refreshAuth).not.toHaveBeenCalled();
    });

    it('restores device and tab focus and reapplies the prior connection when target readiness rejects', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const targetFailure = new Error('iroh identity verification failed');
        switchConnectionToActiveServerSpy
            .mockRejectedValueOnce(targetFailure)
            .mockResolvedValueOnce(null);
        const { profiles, switches } = await importFreshServerModules();
        const deviceProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://device.example.test',
            name: 'Device',
        });
        const tabProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://tab.example.test',
            name: 'Tab',
        });
        const targetProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://target.example.test',
            name: 'Target',
        });
        await profiles.setActiveServerId(deviceProfile.id, { scope: 'device' });
        await profiles.setActiveServerId(tabProfile.id, { scope: 'tab' });
        const priorActive = profiles.getActiveServerSnapshot();
        const refreshAuth = vi.fn(async () => {});

        await expect(switches.setActiveServerAndSwitch({
            serverId: targetProfile.id,
            scope: 'device',
            refreshAuth,
        })).rejects.toBe(targetFailure);

        expect(profiles.getDeviceDefaultServerId()).toBe(deviceProfile.id);
        expect(profiles.getTabActiveServerId()).toBe(tabProfile.id);
        const { generation: priorGeneration, ...priorActiveTarget } = priorActive;
        const { generation: restoredGeneration, ...restoredActiveTarget } = profiles.getActiveServerSnapshot();
        expect(restoredActiveTarget).toEqual(priorActiveTarget);
        expect(restoredGeneration).toBeGreaterThan(priorGeneration);
        expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(2);
        expect(refreshAuth).not.toHaveBeenCalled();
    });

    it('restores device and tab focus and reapplies the prior connection when auth refresh rejects', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const refreshFailure = new Error('active server auth refresh failed');
        const { profiles, switches } = await importFreshServerModules();
        const deviceProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://device.example.test',
            name: 'Device',
        });
        const tabProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://tab.example.test',
            name: 'Tab',
        });
        const targetProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://target.example.test',
            name: 'Target',
        });
        await profiles.setActiveServerId(deviceProfile.id, { scope: 'device' });
        await profiles.setActiveServerId(tabProfile.id, { scope: 'tab' });
        const priorActive = profiles.getActiveServerSnapshot();
        const refreshAuth = vi.fn(async () => {
            throw refreshFailure;
        });

        await expect(switches.setActiveServerAndSwitch({
            serverId: targetProfile.id,
            scope: 'device',
            refreshAuth,
        })).rejects.toBe(refreshFailure);

        expect(refreshAuth).toHaveBeenCalledTimes(1);
        expect(profiles.getDeviceDefaultServerId()).toBe(deviceProfile.id);
        expect(profiles.getTabActiveServerId()).toBe(tabProfile.id);
        const { generation: priorGeneration, ...priorActiveTarget } = priorActive;
        const { generation: restoredGeneration, ...restoredActiveTarget } = profiles.getActiveServerSnapshot();
        expect(restoredActiveTarget).toEqual(priorActiveTarget);
        expect(restoredGeneration).toBeGreaterThan(priorGeneration);
        expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(2);
    });

    it('keeps the target failure visible when reapplying the prior connection also fails', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const targetFailure = new Error('target readiness failed');
        const rollbackFailure = new Error('prior connection reapply failed');
        switchConnectionToActiveServerSpy
            .mockRejectedValueOnce(targetFailure)
            .mockRejectedValueOnce(rollbackFailure);
        const { profiles, switches } = await importFreshServerModules();
        const activeProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        const targetProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://target.example.test',
            name: 'Target',
        });
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });

        const switchPromise = switches.setActiveServerAndSwitch({
            serverId: targetProfile.id,
            scope: 'tab',
        });

        await expect(switchPromise).rejects.toEqual(expect.objectContaining({
            name: 'AggregateError',
            errors: [targetFailure, rollbackFailure],
        }));
        expect(profiles.getDeviceDefaultServerId()).toBe(activeProfile.id);
        expect(profiles.getTabActiveServerId()).toBeNull();
        expect(profiles.getActiveServerId()).toBe(activeProfile.id);
    });

    it('surfaces retained marked custody after switching to its server', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const recovery = {} as AccountEncryptionFirstKeyRecoveryHandle;
        guardCredentialMutationSpy
            .mockResolvedValueOnce({ kind: 'allowed' })
            .mockResolvedValueOnce({
                kind: 'finish_encryption_setup',
                recovery,
            });
        const { profiles, switches } = await importFreshServerModules();
        const activeProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        const targetProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://retained.example.test',
            name: 'Retained',
        });
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });

        const switched = await switches.setActiveServerAndSwitch({
            serverId: targetProfile.id,
            scope: 'device',
        });

        expect(switched).toBe('switched');
        expect(profiles.getActiveServerId()).toBe(targetProfile.id);
        expect(presentCredentialLifecycleSpy).toHaveBeenCalledTimes(2);
        expect(guardCredentialMutationSpy).toHaveBeenNthCalledWith(2, {
            serverUrl: targetProfile.serverUrl,
            serverId: targetProfile.id,
        });
    });

    it('serializes overlapping device focus transactions before staging the next target', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        let releaseFirstSwitch!: () => void;
        const firstSwitchPending = new Promise<void>((resolve) => {
            releaseFirstSwitch = resolve;
        });
        switchConnectionToActiveServerSpy
            .mockImplementationOnce(async () => await firstSwitchPending)
            .mockResolvedValueOnce(null);
        const { profiles, switches } = await importFreshServerModules();
        const activeProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        const middleProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://middle.example.test',
            name: 'Middle',
        });
        const finalProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://final.example.test',
            name: 'Final',
        });
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });

        const first = switches.setActiveServerAndSwitch({
            serverId: middleProfile.id,
            scope: 'device',
        });
        await vi.waitFor(() => {
            expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(1);
        });
        const second = switches.setActiveServerAndSwitch({
            serverId: finalProfile.id,
            scope: 'device',
        });

        await Promise.resolve();
        expect(profiles.getDeviceDefaultServerId()).toBe(middleProfile.id);
        expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(1);

        releaseFirstSwitch();
        await expect(Promise.all([first, second])).resolves.toEqual(['switched', 'switched']);
        expect(profiles.getDeviceDefaultServerId()).toBe(finalProfile.id);
        expect(profiles.getActiveServerId()).toBe(finalProfile.id);
        expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(2);
    });

    it('finishes a failed tab focus rollback before applying the next tab request', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const targetFailure = new Error('middle target failed');
        let releaseRollback!: () => void;
        const rollbackPending = new Promise<void>((resolve) => {
            releaseRollback = resolve;
        });
        switchConnectionToActiveServerSpy
            .mockRejectedValueOnce(targetFailure)
            .mockImplementationOnce(async () => await rollbackPending)
            .mockResolvedValueOnce(null);
        const { profiles, switches } = await importFreshServerModules();
        const activeProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        const middleProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://middle.example.test',
            name: 'Middle',
        });
        const finalProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://final.example.test',
            name: 'Final',
        });
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });

        const first = switches.setActiveServerAndSwitch({
            serverId: middleProfile.id,
            scope: 'tab',
        });
        await vi.waitFor(() => {
            expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(2);
        });
        const second = switches.setActiveServerAndSwitch({
            serverId: finalProfile.id,
            scope: 'tab',
        });

        await Promise.resolve();
        expect(profiles.getTabActiveServerId()).toBeNull();
        expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(2);

        releaseRollback();
        await expect(first).rejects.toBe(targetFailure);
        await expect(second).resolves.toBe('switched');
        expect(profiles.getDeviceDefaultServerId()).toBe(activeProfile.id);
        expect(profiles.getTabActiveServerId()).toBe(finalProfile.id);
        expect(profiles.getActiveServerId()).toBe(finalProfile.id);
        expect(switchConnectionToActiveServerSpy).toHaveBeenCalledTimes(3);
    });

    it('fails closed without mutating focus when the requested profile does not exist', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        stubWebRuntime('https://origin.example.test');

        const { profiles, switches } = await importFreshServerModules();
        const activeProfile = await profiles.upsertServerProfile({
            serverUrl: 'https://active.example.test',
            name: 'Active',
        });
        await profiles.setActiveServerId(activeProfile.id, { scope: 'device' });

        await expect(switches.setActiveServerAndSwitch({
            serverId: 'missing-home',
            scope: 'tab',
        })).resolves.toBe('blocked');

        expect(profiles.getDeviceDefaultServerId()).toBe(activeProfile.id);
        expect(profiles.getTabActiveServerId()).toBeNull();
        expect(profiles.getActiveServerId()).toBe(activeProfile.id);
        expect(switchConnectionToActiveServerSpy).not.toHaveBeenCalled();
    });
});
