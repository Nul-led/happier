import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderHook, renderScreen, standardCleanup } from '@/dev/testkit';
import type { PersonalHomeFacts } from './personalHomeBootstrapTypes';

// The real `useThisComputerSetupTask` resolves its runner through the shared system-tasks
// runtime. Keep that real path but select the deterministic dev bridge: the test's process
// boundary is the system-task bridge, and the Tauri bridge does not exist in this environment.
process.env.EXPO_PUBLIC_SYSTEM_TASKS_RUNNER_MODE = 'dev';

const harness = vi.hoisted(() => {
    const canonicalServerUrl = 'http://127.0.0.1:43123';
    const runtime = {
        installed: false,
        healthy: false,
        dataPresent: false,
        signupEnabled: true,
        purpose: null as null | { kind: 'personal-home'; canonicalServerUrl: string } | { kind: 'generic' },
    };
    const endpoint = {
        storagePolicy: 'plaintext_only' as 'required_e2ee' | 'optional' | 'plaintext_only',
        reachable: true,
    };
    let credentials: Readonly<{ token: string }> | null = null;
    let segments: readonly string[] = ['(app)', 'index'];
    const taskCalls: Array<{ kind: string; options: Record<string, unknown> }> = [];
    let failNextRelayTask: string | null = null;
    const routerPush = vi.fn();
    const useLocalRelayRuntimeControl = vi.fn(() => ({
        activeTaskSnapshot: null,
        isUnavailable: false,
        lastErrorMessage: null,
        status: statusData(),
        runTaskAndWait: async (kind: string, options: Record<string, unknown> = {}) => {
            taskCalls.push({ kind, options });
            if (failNextRelayTask === kind) {
                failNextRelayTask = null;
                return {
                    protocolVersion: 1,
                    taskId: `task-${taskCalls.length}`,
                    ok: false,
                    error: { code: 'relay_task_injected_failure', message: 'transient relay task failure' },
                };
            }
            if (kind === 'relay.runtime.installOrUpdate.v1') {
                runtime.installed = true;
                runtime.healthy = true;
                runtime.purpose = options.purpose as typeof runtime.purpose;
                runtime.signupEnabled = options.anonymousSignupEnabled !== false;
            } else if (kind === 'relay.runtime.start.v1' || kind === 'relay.runtime.restart.v1') {
                runtime.healthy = true;
            }
            return {
                protocolVersion: 1,
                taskId: `task-${taskCalls.length}`,
                ok: true,
                data: statusData(),
            };
        },
    }));
    const useLocalDaemonControl = vi.fn(() => ({
        activeTaskSnapshot: null,
        canInstall: false,
        canStart: false,
        status: null,
        readStatus: async () => null,
        refreshStatus: async () => null,
        installBackgroundService: () => {},
        startDaemonService: () => {},
    }));
    const isDesktopHost = vi.fn(() => true);
    const desktopHostKind = vi.fn<() => 'tauri' | 'electron' | null>(() => 'tauri');
    const isDesktopOverlayWindowContext = vi.fn(() => false);

    // Pending Personal Home bootstrap-seed custody boundary state (native storage beneath the
    // Home-scoped token-storage owner). `lastPersistedSeed` is what the verified custody held
    // at the moment the account-creating network call fired.
    const pendingSeedStore = new Map<string, Uint8Array>();
    let lastPersistedSeed: Uint8Array | null = null;
    const authCallSecrets: Uint8Array[] = [];

    function seedCustodyKey(serverUrl: string, options: Readonly<{ serverId?: string }> | undefined): string {
        return `${serverUrl}|${options?.serverId ?? ''}`;
    }

    const authGetTokenAtEndpoint = vi.fn(async (params: { secret?: Uint8Array } = {}) => {
        if (!runtime.signupEnabled) {
            throw Object.assign(new Error('signup disabled'), { code: 'signup-disabled' });
        }
        if (params.secret) {
            authCallSecrets.push(new Uint8Array(params.secret));
            if (!lastPersistedSeed || lastPersistedSeed.length !== params.secret.length
                || lastPersistedSeed.some((byte, index) => byte !== params.secret![index])) {
                throw new Error('account-creating endpoint call ran without verified pending seed custody');
            }
        }
        return { token: 'home-b-token' };
    });
    const focusedAuthGetToken = vi.fn(async () => {
        throw new Error('focused auth must not be used');
    });

    // Status identity is stable while the underlying runtime state is unchanged (mirroring the
    // real hook's memoized state), so consumers depending on status identity do not churn.
    let cachedStatusData: Record<string, unknown> | null = null;
    let cachedStatusKey = '';
    function statusData(): Record<string, unknown> {
        const purposeKey = runtime.purpose?.kind === 'personal-home'
            ? `personal-home:${runtime.purpose.canonicalServerUrl}`
            : (runtime.purpose?.kind ?? 'none');
        const key = `${runtime.installed}|${runtime.healthy}|${runtime.dataPresent}|${runtime.signupEnabled}|${purposeKey}`;
        if (key !== cachedStatusKey || cachedStatusData == null) {
            cachedStatusKey = key;
            cachedStatusData = {
                installed: runtime.installed,
                version: runtime.installed ? '0.3.0-test' : null,
                relayUrl: canonicalServerUrl,
                healthy: runtime.healthy,
                dataPresent: runtime.dataPresent,
                service: {
                    active: runtime.installed ? runtime.healthy : null,
                    enabled: runtime.installed ? true : null,
                },
                purpose: runtime.purpose,
                anonymousSignupEnabled: runtime.purpose?.kind === 'personal-home' ? runtime.signupEnabled : null,
            };
        }
        return cachedStatusData!;
    }

    return {
        canonicalServerUrl,
        runtime,
        endpoint,
        taskCalls,
        setFailNextRelayTask(next: string | null) {
            failNextRelayTask = next;
        },
        routerPush,
        useLocalRelayRuntimeControl,
        useLocalDaemonControl,
        isDesktopHost,
        desktopHostKind,
        isDesktopOverlayWindowContext,
        authGetTokenAtEndpoint,
        focusedAuthGetToken,
        getCredentials: () => credentials,
        setCredentials(value: Readonly<{ token: string }> | null) {
            credentials = value;
        },
        segments: () => segments,
        setSegments(value: readonly string[]) {
            segments = value;
        },
        pendingSeedStore: () => [...pendingSeedStore.entries()].map(([key, seed]) => ({ key, seed })),
        authCallSecrets: () => authCallSecrets.map((seed) => new Uint8Array(seed)),
        readPendingSeed: (serverUrl: string, options?: Readonly<{ serverId?: string }>) => {
            const seed = pendingSeedStore.get(seedCustodyKey(serverUrl, options));
            return seed ? new Uint8Array(seed) : null;
        },
        setPendingSeed: (serverUrl: string, options: Readonly<{ serverId?: string }> | undefined, seed: Uint8Array) => {
            pendingSeedStore.set(seedCustodyKey(serverUrl, options), new Uint8Array(seed));
            lastPersistedSeed = new Uint8Array(seed);
            return Promise.resolve(true);
        },
        clearPendingSeed: (serverUrl: string, options?: Readonly<{ serverId?: string }>) => {
            pendingSeedStore.delete(seedCustodyKey(serverUrl, options));
            return Promise.resolve(true);
        },
        statusData,
        reset() {
            runtime.installed = false;
            runtime.healthy = false;
            runtime.dataPresent = false;
            runtime.signupEnabled = true;
            runtime.purpose = null;
            endpoint.storagePolicy = 'plaintext_only';
            endpoint.reachable = true;
            credentials = null;
            segments = ['(app)', 'index'];
            taskCalls.length = 0;
            failNextRelayTask = null;
            pendingSeedStore.clear();
            lastPersistedSeed = null;
            authCallSecrets.length = 0;
            routerPush.mockClear();
            useLocalRelayRuntimeControl.mockClear();
            useLocalDaemonControl.mockClear();
            authGetTokenAtEndpoint.mockClear();
            focusedAuthGetToken.mockClear();
            isDesktopHost.mockReturnValue(true);
            desktopHostKind.mockReturnValue('tauri');
            isDesktopOverlayWindowContext.mockReturnValue(false);
        },
    };
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await vi.importActual<typeof import('@/dev/testkit/mocks/router')>(
        '@/dev/testkit/mocks/router',
    );
    const routerMock = createExpoRouterMock({
        router: { push: harness.routerPush },
        segments: ['(app)', 'index'],
    }).module;
    return {
        ...routerMock,
        useSegments: () => harness.segments(),
    };
});

vi.mock('@/utils/platform/desktopHost', () => ({
    isDesktopHost: () => harness.isDesktopHost(),
    desktopHostKind: () => harness.desktopHostKind(),
}));

vi.mock('@/desktop/window/isDesktopOverlayWindowContext', () => ({
    isDesktopOverlayWindowContext: () => harness.isDesktopOverlayWindowContext(),
}));

vi.mock('@/components/settings/server/localControl/useLocalRelayRuntimeControl', () => ({
    useLocalRelayRuntimeControl: () => harness.useLocalRelayRuntimeControl(),
}));

vi.mock('@/components/settings/machines/localControl/useLocalDaemonControl', () => ({
    useLocalDaemonControl: () => harness.useLocalDaemonControl(),
}));

vi.mock('@/auth/flows/getToken', () => ({
    authGetToken: harness.focusedAuthGetToken,
    authGetTokenAtEndpoint: harness.authGetTokenAtEndpoint,
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: vi.fn(async () => harness.getCredentials()),
        setCredentialsForServerUrl: vi.fn(async (
            _url: string,
            _options: Readonly<{ serverId?: string }>,
            credentials: Readonly<{ token: string }>,
        ) => {
            harness.setCredentials(credentials);
            return true;
        }),
        getPendingPersonalHomeBootstrapSeed: vi.fn(async (
            serverUrl: string,
            options?: Readonly<{ serverId?: string }>,
        ) => harness.readPendingSeed(serverUrl, options)),
        setPendingPersonalHomeBootstrapSeed: vi.fn(async (
            serverUrl: string,
            options: Readonly<{ serverId?: string }> | undefined,
            seed: Uint8Array,
        ) => harness.setPendingSeed(serverUrl, options, seed)),
        clearPendingPersonalHomeBootstrapSeed: vi.fn(async (
            serverUrl: string,
            options?: Readonly<{ serverId?: string }>,
        ) => harness.clearPendingSeed(serverUrl, options)),
    },
}));

vi.mock('@/platform/cryptoRandom', () => ({
    getRandomBytes: vi.fn(() => new Uint8Array(32).fill(7)),
    getRandomBytesAsync: vi.fn(async () => new Uint8Array(32).fill(7)),
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    probeServerFeaturesAtUrl: vi.fn(async () => !harness.endpoint.reachable || !harness.runtime.installed || !harness.runtime.healthy
        ? { status: 'error', reason: 'network' }
        : {
            status: 'ready',
            serverIdentityId: 'srv_home_b_identity',
            features: {
                capabilities: {
                    auth: {
                        signup: {
                            methods: [{ id: 'anonymous', enabled: harness.runtime.signupEnabled }],
                        },
                    },
                    encryption: { storagePolicy: harness.endpoint.storagePolicy },
                    serverIdentity: { serverIdentityId: 'srv_home_b_identity' },
                },
            },
        }),
}));

vi.mock('@/sync/api/capabilities/probeAuthenticatedServerAuthPingEndpoint', () => ({
    probeAuthenticatedServerAuthPingEndpoint: vi.fn(async ({ token }: { token: string }) => {
        if (!harness.endpoint.reachable) return { status: 'server_unreachable' };
        return token === 'home-b-token' && harness.runtime.healthy
            ? { status: 'ready' }
            : { status: 'auth_failed', statusCode: 401, errorMessage: 'unauthorized' };
    }),
}));

const initialFacts: PersonalHomeFacts = {
    hostIsDesktop: true,
    isDesktopMainWindow: true,
    explicitlySelectedOtherHome: false,
    completedPersonalHomeProfile: null,
    candidateLocalProfile: null,
    relayRuntime: null,
    localHomeReachability: 'unknown',
    localHomeIdentity: null,
    localHomeAuth: 'missing',
    anonymousSignup: 'unknown',
    daemon: null,
    activeTask: null,
};

describe('usePersonalHomeBootstrapRuntime production composition', () => {
    afterEach(async () => {
        standardCleanup();
        harness.reset();
        const profiles = await import('@/sync/domains/server/serverProfiles');
        profiles.clearTabActiveServerId();
        for (const profile of profiles.listServerProfiles()) profiles.removeServerProfile(profile.id);
    });

    it('runs the canonical bootstrap through system tasks, persists token-only credentials, adopts only after verification, and preserves focus', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        for (const profile of profiles.listServerProfiles()) profiles.removeServerProfile(profile.id);
        const focusedHome = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.example',
            name: 'Focused Home A',
            source: 'manual',
        });
        profiles.setActiveServerId(focusedHome.id);

        const { usePersonalHomeBootstrapRuntime } = await import('./usePersonalHomeBootstrapRuntime');
        const hook = await renderHook(() => usePersonalHomeBootstrapRuntime());

        await hook.getCurrent().operations['prepare-home']?.(initialFacts);

        expect(harness.taskCalls.map((call) => call.kind)).toEqual([
            'relay.runtime.status.v1',
            'relay.runtime.installOrUpdate.v1',
            'relay.runtime.start.v1',
            'relay.runtime.installOrUpdate.v1',
            'relay.runtime.restart.v1',
            'relay.runtime.status.v1',
        ]);
        expect(harness.runtime.signupEnabled).toBe(false);
        expect(harness.getCredentials()).toEqual({ token: 'home-b-token' });
        // The account-creating call carried the deterministic 32-byte seed, taken from verified
        // pending custody, and the custody was released after the verified credential persisted.
        expect(harness.authCallSecrets()).toHaveLength(1);
        expect([...harness.authCallSecrets()[0]!]).toEqual(new Array(32).fill(7));
        expect(harness.pendingSeedStore()).toEqual([]);
        expect(harness.authGetTokenAtEndpoint).toHaveBeenCalledWith(expect.objectContaining({
            endpointUrl: harness.canonicalServerUrl,
            canonicalServerUrl: harness.canonicalServerUrl,
            serverIdentityId: 'srv_home_b_identity',
            requireKeyChallengeV2: true,
        }));
        expect(profiles.listServerProfiles()).toContainEqual(expect.objectContaining({
            source: 'desktop-personal-home',
            serverUrl: harness.canonicalServerUrl,
            canonicalServerUrl: harness.canonicalServerUrl,
            serverIdentityId: 'srv_home_b_identity',
        }));
        expect(profiles.getActiveServerSnapshot().serverId).toBe(focusedHome.id);
        expect(harness.focusedAuthGetToken).not.toHaveBeenCalled();
    });

    it('activates the adopted first local Home only when the existing selection remains implicit', async () => {
        const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = `personal-home-implicit-${Date.now()}`;
        try {
            const profiles = await import('@/sync/domains/server/serverProfiles');
            const initialSelection = profiles.getActiveServerSnapshot();
            expect(initialSelection.isSelectionExplicit).toBe(false);

            const { usePersonalHomeBootstrapRuntime } = await import('./usePersonalHomeBootstrapRuntime');
            const hook = await renderHook(() => usePersonalHomeBootstrapRuntime());
            await hook.getCurrent().operations['prepare-home']?.(initialFacts);

            const selected = profiles.getActiveServerSnapshot();
            expect(selected).toMatchObject({ isSelectionExplicit: false });
            expect(profiles.getServerProfileById(selected.serverId)).toMatchObject({
                source: 'desktop-personal-home',
                serverIdentityId: 'srv_home_b_identity',
            });
            await hook.unmount();
        } finally {
            if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
            else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        }
    });

    it('surfaces retained data as existing-Home recovery before installing or creating an account', async () => {
        harness.runtime.dataPresent = true;

        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 6, turns: 4 });

        expect(screen.findByTestId('personal-home-use-existing')).not.toBeNull();
        expect(screen.findByTestId('personal-home-use-another')).not.toBeNull();
        // The canonical status projection carries retained-data state into the gate, so the
        // recovery decision appears without invoking the bootstrap runner at all.
        expect(harness.taskCalls).toEqual([]);
        expect(harness.runtime.installed).toBe(false);
        expect(harness.authGetTokenAtEndpoint).not.toHaveBeenCalled();
        expect(harness.getCredentials()).toBeNull();
        const profiles = await import('@/sync/domains/server/serverProfiles');
        expect(profiles.listServerProfiles().filter((profile) => profile.source === 'desktop-personal-home')).toEqual([]);

        await screen.pressByTestIdAsync('personal-home-use-existing');
        await flushHookEffects({ cycles: 4, turns: 4 });
        expect(harness.routerPush).toHaveBeenCalledWith(`/server?url=${encodeURIComponent(harness.canonicalServerUrl)}&auto=1`);
        expect(harness.taskCalls.map((call) => call.kind)).toEqual(['relay.runtime.status.v1']);
        expect(harness.runtime.installed).toBe(false);
        expect(harness.getCredentials()).toBeNull();
    });

    it('keeps explicit recovery/callback routes reachable without bypassing the ordinary shell route', async () => {
        const { shouldBypassPersonalHomeBootstrapForSegments } = await import('./usePersonalHomeBootstrapRuntime');

        expect(shouldBypassPersonalHomeBootstrapForSegments(['(app)', 'server'])).toBe(true);
        expect(shouldBypassPersonalHomeBootstrapForSegments(['(app)', 'setup', 'wizard'])).toBe(true);
        expect(shouldBypassPersonalHomeBootstrapForSegments(['(app)', 'oauth', 'github'])).toBe(true);
        expect(shouldBypassPersonalHomeBootstrapForSegments(['(app)', 'restore', 'lost-access'])).toBe(true);
        expect(shouldBypassPersonalHomeBootstrapForSegments(['(app)', 'index'])).toBe(false);
        expect(shouldBypassPersonalHomeBootstrapForSegments(['(app)', 'settings'])).toBe(false);
    });

    it("recovers a valid plaintext generic Home in place through 'Use this local Home' without routing", async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const focusedHome = profiles.upsertServerProfile({
            serverUrl: 'https://home-a.example',
            name: 'Focused Home A',
            source: 'manual',
        });
        profiles.setActiveServerId(focusedHome.id);
        harness.runtime.installed = true;
        harness.runtime.healthy = true;
        harness.runtime.purpose = { kind: 'generic' };
        harness.setCredentials({ token: 'home-b-token' });

        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 6, turns: 4 });

        await screen.pressByTestIdAsync('personal-home-use-existing');
        await flushHookEffects({ cycles: 8, turns: 6 });

        // The existing runtime was recovered through the canonical system-task caller in place.
        expect(harness.taskCalls.map((call) => call.kind)).toEqual([
            'relay.runtime.status.v1',
            'relay.runtime.installOrUpdate.v1',
            'relay.runtime.start.v1',
            'relay.runtime.installOrUpdate.v1',
            'relay.runtime.restart.v1',
            'relay.runtime.status.v1',
        ]);
        expect(harness.runtime.purpose).toEqual({ kind: 'personal-home', canonicalServerUrl: harness.canonicalServerUrl });
        expect(harness.runtime.signupEnabled).toBe(false);
        // Token-only recovery: the existing verified credential is kept, no account is created
        // (no call passes the signup-open gate), and no pending bootstrap seed is ever
        // generated or consumed by recovery.
        expect(harness.getCredentials()).toEqual({ token: 'home-b-token' });
        expect(harness.authCallSecrets()).toEqual([]);
        expect(harness.pendingSeedStore()).toEqual([]);
        expect(profiles.listServerProfiles()).toContainEqual(expect.objectContaining({
            source: 'desktop-personal-home',
            canonicalServerUrl: harness.canonicalServerUrl,
            serverIdentityId: 'srv_home_b_identity',
        }));
        expect(profiles.getActiveServerSnapshot().serverId).toBe(focusedHome.id);
        // In-place recovery: no route is pushed.
        expect(harness.routerPush).not.toHaveBeenCalled();
        expect(screen.findByTestId('normal-shell')).not.toBeNull();
        expect(screen.findByTestId('personal-home-setup-surface')).toBeNull();
    });

    it('keeps a required_e2ee existing Home generic and routes to the generic login path without mutation', async () => {
        harness.runtime.installed = true;
        harness.runtime.healthy = true;
        harness.runtime.purpose = { kind: 'generic' };
        harness.endpoint.storagePolicy = 'required_e2ee';
        harness.setCredentials({ token: 'home-b-token' });

        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 6, turns: 4 });

        await screen.pressByTestIdAsync('personal-home-use-existing');
        await flushHookEffects({ cycles: 8, turns: 6 });

        // The decision is routed to the established generic login path for this local Home.
        expect(harness.routerPush).toHaveBeenCalledWith(`/server?url=${encodeURIComponent(harness.canonicalServerUrl)}&auto=1`);
        // The canonical caller preflighted through the read-only status task and mutated nothing.
        expect(harness.taskCalls.map((call) => call.kind)).toEqual(['relay.runtime.status.v1']);
        expect(harness.runtime.purpose).toEqual({ kind: 'generic' });
        const profiles = await import('@/sync/domains/server/serverProfiles');
        expect(profiles.listServerProfiles().filter((profile) => profile.source === 'desktop-personal-home')).toEqual([]);
    });

    it('keeps a generic Home without verified credentials generic and routes to the generic login path without mutation', async () => {
        harness.runtime.installed = true;
        harness.runtime.healthy = true;
        harness.runtime.purpose = { kind: 'generic' };

        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 6, turns: 4 });

        await screen.pressByTestIdAsync('personal-home-use-existing');
        await flushHookEffects({ cycles: 8, turns: 6 });

        expect(harness.routerPush).toHaveBeenCalledWith(`/server?url=${encodeURIComponent(harness.canonicalServerUrl)}&auto=1`);
        expect(harness.taskCalls.map((call) => call.kind)).toEqual(['relay.runtime.status.v1']);
        expect(harness.runtime.purpose).toEqual({ kind: 'generic' });
        expect(harness.getCredentials()).toBeNull();
        const profiles = await import('@/sync/domains/server/serverProfiles');
        expect(profiles.listServerProfiles().filter((profile) => profile.source === 'desktop-personal-home')).toEqual([]);
    });

    it("routes with 'Use another Home' without mutating the runtime, credentials, or profiles", async () => {
        harness.runtime.installed = true;
        harness.runtime.healthy = true;
        harness.runtime.purpose = { kind: 'generic' };
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profilesBefore = profiles.listServerProfiles().map(({ id, serverUrl, source }) => ({ id, serverUrl, source }));

        const {
            PersonalHomeBootstrapRuntimeMount,
            usePersonalHomeBootstrapRuntime,
        } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 6, turns: 4 });

        await screen.pressByTestIdAsync('personal-home-use-another');
        await flushHookEffects({ cycles: 4, turns: 4 });

        expect(harness.routerPush).toHaveBeenCalledTimes(1);
        expect(harness.routerPush).toHaveBeenCalledWith('/server');
        expect(harness.taskCalls).toEqual([]);
        expect(harness.getCredentials()).toBeNull();
        expect(harness.runtime.purpose).toEqual({ kind: 'generic' });
        expect(profiles.listServerProfiles().map(({ id, serverUrl, source }) => ({ id, serverUrl, source }))).toEqual(profilesBefore);

        // The server picker owns the actual decision. Once it records an explicit unrelated
        // Home, the same durable selection releases this first-run gate on a later read/remount.
        const otherHome = profiles.upsertServerProfile({
            serverUrl: 'https://chosen-home.example',
            source: 'manual',
        });
        profiles.setActiveServerId(otherHome.id);
        const runtimeHook = await renderHook(() => usePersonalHomeBootstrapRuntime());
        const facts = await runtimeHook.getCurrent().readFacts();
        expect(facts.explicitlySelectedOtherHome).toBe(true);
    });

    it('keeps a transient recovery failure retryable at the decision surface', async () => {
        harness.runtime.installed = true;
        harness.runtime.healthy = true;
        harness.runtime.purpose = { kind: 'generic' };
        harness.setCredentials({ token: 'home-b-token' });
        harness.setFailNextRelayTask('relay.runtime.installOrUpdate.v1');

        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 6, turns: 4 });

        await screen.pressByTestIdAsync('personal-home-use-existing');
        await flushHookEffects({ cycles: 8, turns: 6 });

        // Transient failure: no route, the runtime stays generic and untouched.
        expect(harness.routerPush).not.toHaveBeenCalled();
        expect(harness.runtime.purpose).toEqual({ kind: 'generic' });
        // The decision surface remains available and the failure is observable as retryable.
        expect(screen.findByTestId('personal-home-use-existing')).not.toBeNull();
        expect(screen.findByTestId('personal-home-bootstrap-failure')).not.toBeNull();

        harness.setFailNextRelayTask(null);
        await screen.pressByTestIdAsync('personal-home-use-existing');
        await flushHookEffects({ cycles: 8, turns: 6 });

        expect(harness.runtime.purpose).toEqual({ kind: 'personal-home', canonicalServerUrl: harness.canonicalServerUrl });
        expect(harness.runtime.signupEnabled).toBe(false);
        const profiles = await import('@/sync/domains/server/serverProfiles');
        expect(profiles.listServerProfiles()).toContainEqual(expect.objectContaining({ source: 'desktop-personal-home' }));
        expect(harness.routerPush).not.toHaveBeenCalled();
    });

    it('completes a verified-but-unadopted Personal Home automatically mutation-free after Home readiness', async () => {
        harness.runtime.installed = true;
        harness.runtime.healthy = true;
        harness.runtime.signupEnabled = false;
        harness.runtime.purpose = { kind: 'personal-home', canonicalServerUrl: harness.canonicalServerUrl };
        harness.setCredentials({ token: 'home-b-token' });

        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 8, turns: 6 });

        // Shell is usable and never gated for profile completion.
        expect(screen.findByTestId('normal-shell')).not.toBeNull();
        expect(screen.findByTestId('personal-home-setup-surface')).toBeNull();
        expect(harness.routerPush).not.toHaveBeenCalled();
        // Completion reuses the canonical caller mutation-free: read-only verification only.
        expect(harness.taskCalls.map((call) => call.kind)).toEqual([
            'relay.runtime.status.v1',
            'relay.runtime.status.v1',
        ]);
        expect(harness.getCredentials()).toEqual({ token: 'home-b-token' });
        const profiles = await import('@/sync/domains/server/serverProfiles');
        expect(profiles.listServerProfiles()).toContainEqual(expect.objectContaining({
            source: 'desktop-personal-home',
            serverIdentityId: 'srv_home_b_identity',
        }));
    });

    it('renders off-Desktop and overlay windows without constructing the bootstrap runtime hooks', async () => {
        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');

        harness.isDesktopHost.mockReturnValue(false);
        harness.desktopHostKind.mockReturnValue(null);
        const offDesktopScreen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(offDesktopScreen.findByTestId('normal-shell')).not.toBeNull();
        expect(harness.useLocalRelayRuntimeControl).not.toHaveBeenCalled();
        expect(harness.useLocalDaemonControl).not.toHaveBeenCalled();

        standardCleanup();
        harness.reset();

        harness.isDesktopOverlayWindowContext.mockReturnValue(true);
        const overlayScreen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(overlayScreen.findByTestId('normal-shell')).not.toBeNull();
        expect(harness.useLocalRelayRuntimeControl).not.toHaveBeenCalled();
        expect(harness.useLocalDaemonControl).not.toHaveBeenCalled();
    });

    it('renders Electron without constructing the Tauri-only Personal Home runtime hooks', async () => {
        harness.desktopHostKind.mockReturnValue('electron');
        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="electron-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findByTestId('electron-shell')).not.toBeNull();
        expect(harness.useLocalRelayRuntimeControl).not.toHaveBeenCalled();
        expect(harness.useLocalDaemonControl).not.toHaveBeenCalled();
    });

    it('renders Desktop callback routes without constructing the bootstrap runtime hooks', async () => {
        harness.setSegments(['(app)', 'oauth', 'github']);
        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="callback-route" />
            </PersonalHomeBootstrapRuntimeMount>,
        );
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findByTestId('callback-route')).not.toBeNull();
        expect(harness.useLocalRelayRuntimeControl).not.toHaveBeenCalled();
        expect(harness.useLocalDaemonControl).not.toHaveBeenCalled();
    });

    it('releases a durable returning Personal Home synchronously while the existing recovery owner runs inside the shell', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        profiles.upsertServerProfile({
            serverUrl: harness.canonicalServerUrl,
            name: 'Personal Home',
            source: 'desktop-personal-home',
        });

        const { PersonalHomeBootstrapRuntimeMount } = await import('./usePersonalHomeBootstrapRuntime');
        const screen = await renderScreen(
            <PersonalHomeBootstrapRuntimeMount>
                <div data-testid="normal-shell" />
            </PersonalHomeBootstrapRuntimeMount>,
        );

        expect(screen.findByTestId('normal-shell')).not.toBeNull();
        expect(screen.findByTestId('personal-home-setup-surface')).toBeNull();
        expect(harness.useLocalRelayRuntimeControl).toHaveBeenCalledTimes(1);
        expect(harness.useLocalDaemonControl).toHaveBeenCalledTimes(1);

        await flushHookEffects({ cycles: 6, turns: 4 });

        // Background daemon/account recovery can fail without replacing the already-released
        // shell with first-run setup.
        expect(screen.findByTestId('normal-shell')).not.toBeNull();
        expect(screen.findByTestId('personal-home-setup-surface')).toBeNull();
        expect(screen.findByTestId('personal-home-recovery-strip')).not.toBeNull();
    });
});
