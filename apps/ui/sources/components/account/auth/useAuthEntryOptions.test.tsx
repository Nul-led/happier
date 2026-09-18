import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act } from 'react-test-renderer';

import { createDeferred, flushHookEffects, renderHook } from '@/dev/testkit';

const getServerFeaturesSnapshotMock = vi.hoisted(() => vi.fn());
const getCachedServerFeaturesSnapshotMock = vi.hoisted(() => vi.fn());
const subscribeServerFeaturesSnapshotMock = vi.hoisted(() => vi.fn());
const getActiveServerSnapshotMock = vi.hoisted(() => vi.fn());
const getActiveServerHomeCarrierMock = vi.hoisted(() => vi.fn());
const subscribeActiveServerMock = vi.hoisted(() => vi.fn());
const getAuthProviderMock = vi.hoisted(() => vi.fn());
const getServerRetentionPolicyMock = vi.hoisted(() => vi.fn());
const fetchHomeAuthEntryMock = vi.hoisted(() => vi.fn());

vi.mock('@/auth/entry/authEntryClient', () => ({
    fetchHomeAuthEntry: fetchHomeAuthEntryMock,
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getCachedServerFeaturesSnapshot: getCachedServerFeaturesSnapshotMock,
    getServerFeaturesSnapshot: getServerFeaturesSnapshotMock,
    subscribeServerFeaturesSnapshot: subscribeServerFeaturesSnapshotMock,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: getActiveServerSnapshotMock,
    getActiveServerHomeCarrier: getActiveServerHomeCarrierMock,
    subscribeActiveServer: subscribeActiveServerMock,
}));

vi.mock('@/auth/providers/registry', () => ({
    getAuthProvider: getAuthProviderMock,
}));

vi.mock('@/sync/api/capabilities/serverRetentionPolicyClient', () => ({
    getServerRetentionPolicy: getServerRetentionPolicyMock,
}));

const textMock = vi.hoisted(() => {
    const translate = (key: string, params?: Record<string, unknown>) => {
        if (key === 'welcome.signUpWithProvider' && typeof params?.provider === 'string') {
            return `Sign up with ${params.provider}`;
        }
        if (key === 'welcome.signInWithCertificate') return 'Sign in with certificate';
        if (key === 'welcome.createAccount') return 'Create account';
        if (key === 'status.unknown') return 'Unknown';
        return key;
    };
    return {
        t: translate,
        tLoose: translate,
        getPreferredLanguage: () => 'en',
        hasTranslation: () => false,
    };
});

vi.mock('@/text', () => textMock);

describe('useAuthEntryOptions', () => {
    type TestActiveServerSnapshot = Readonly<{
        serverId: string;
        serverUrl: string;
        generation: number;
        isSelectionExplicit?: boolean;
    }>;
    let activeServerListener: ((snapshot: TestActiveServerSnapshot) => void) | null = null;
    let serverFeaturesSnapshotListener: (() => void) | null = null;
    let currentActiveServerSnapshot: TestActiveServerSnapshot;

    beforeEach(() => {
        getServerFeaturesSnapshotMock.mockReset();
        getCachedServerFeaturesSnapshotMock.mockReset();
        subscribeServerFeaturesSnapshotMock.mockReset();
        getActiveServerSnapshotMock.mockReset();
        getActiveServerHomeCarrierMock.mockReset();
        getActiveServerHomeCarrierMock.mockReturnValue(null);
        subscribeActiveServerMock.mockReset();
        getAuthProviderMock.mockReset();
        getServerRetentionPolicyMock.mockReset();
        getServerRetentionPolicyMock.mockResolvedValue(null);
        fetchHomeAuthEntryMock.mockReset();
        fetchHomeAuthEntryMock.mockResolvedValue({ kind: 'unsupported' });
        currentActiveServerSnapshot = {
            serverId: 'server-example',
            serverUrl: 'http://api.example.test',
            generation: 1,
        };
        getActiveServerSnapshotMock.mockImplementation(() => currentActiveServerSnapshot);
        activeServerListener = null;
        serverFeaturesSnapshotListener = null;
        getCachedServerFeaturesSnapshotMock.mockReturnValue(null);
        subscribeServerFeaturesSnapshotMock.mockImplementation((listener: () => void) => {
            serverFeaturesSnapshotListener = listener;
            return () => {
                if (serverFeaturesSnapshotListener === listener) {
                    serverFeaturesSnapshotListener = null;
                }
            };
        });
        subscribeActiveServerMock.mockImplementation((listener: (snapshot: TestActiveServerSnapshot) => void) => {
            activeServerListener = listener;
            return () => {
                if (activeServerListener === listener) {
                    activeServerListener = null;
                }
            };
        });
        getAuthProviderMock.mockImplementation((id: string) => (
            id === 'github' ? { id, displayName: 'GitHub' } : null
        ));
    });

    it('uses current auth-entry presentation for a dynamic provider absent from static features', async () => {
        getServerFeaturesSnapshotMock.mockResolvedValue({
            status: 'ready',
            features: {
                capabilities: {
                    serverIdentity: { serverIdentityId: 'srv_current' },
                    auth: { methods: [], keyChallenge: { v2: true } },
                    oauth: { providers: {} },
                },
            },
        });
        fetchHomeAuthEntryMock.mockResolvedValue({
            kind: 'ready',
            projection: {
                v: 1,
                state: 'ready',
                scope: { kind: 'home' },
                actions: [{
                    kind: 'authenticate',
                    methodId: 'acme',
                    action: 'login',
                    mode: 'keyless',
                    origin: 'home',
                    presentation: { displayName: 'Acme Workforce' },
                }],
                autoRedirect: null,
            },
        });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().serverAvailability).toBe('ready');
        expect(hook.getCurrent().authenticationActions).toEqual([expect.objectContaining({
            execution: { kind: 'oauth', providerId: 'acme', mode: 'keyless' },
            method: expect.objectContaining({ presentation: { displayName: 'Acme Workforce' } }),
        })]);
        expect(hook.getCurrent().providerKeylessTitle).toContain('Acme Workforce');
        expect(hook.getCurrent().keyChallengeV2Available).toBe(true);
    });

    it('derives ready-state auth options from server features', async () => {
        getServerFeaturesSnapshotMock.mockResolvedValue({
            status: 'ready',
            features: {
                capabilities: {
                    oauth: { providers: { github: { configured: true } } },
                    auth: {
                        methods: [
                            {
                                id: 'key_challenge',
                                actions: [
                                    { id: 'login', enabled: true, mode: 'keyed' },
                                    { id: 'provision', enabled: true, mode: 'keyed' },
                                ],
                            },
                            {
                                id: 'mtls',
                                actions: [{ id: 'login', enabled: true, mode: 'keyless' }],
                            },
                            {
                                id: 'github',
                                actions: [{ id: 'provision', enabled: true, mode: 'keyed' }],
                            },
                        ],
                        signup: { methods: [{ id: 'anonymous', enabled: true }, { id: 'github', enabled: true }] },
                        login: { methods: [{ id: 'key_challenge', enabled: true }, { id: 'mtls', enabled: true }], requiredProviders: [] },
                        ui: { autoRedirect: { enabled: false, providerId: null } },
                    },
                },
            },
        });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        const options = hook.getCurrent();
        expect(options.serverAvailability).toBe('ready');
        expect(options.serverUrlForCopy).toBe('http://api.example.test');
        expect(options.showAuthActions).toBe(true);
        expect(options.showProviderSignup).toBe(true);
        expect(options.showAnonymousSignup).toBe(true);
        expect(options.showMtlsLogin).toBe(true);
        expect(options.providerSignupTitle).toContain('GitHub');
        expect(options.mtlsTitle).toBe('Sign in with certificate');
    });

    it('projects the active Home carrier as the exact authentication transport', async () => {
        const homeCarrier = {
            endpointId: 'home-carrier-a',
            readObservedPath: vi.fn(),
            request: vi.fn(),
            createWebSocket: vi.fn(),
        };
        getActiveServerHomeCarrierMock.mockReturnValue(homeCarrier);
        getServerFeaturesSnapshotMock.mockResolvedValue({ status: 'unsupported', reason: 'legacy' });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().homeTransport).toEqual({ homeCarrier });
    });

    it('distinguishes a seeded fallback Home from an explicitly requested Home', async () => {
        getServerFeaturesSnapshotMock.mockResolvedValue({ status: 'unsupported', reason: 'legacy' });
        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().homeTarget).toEqual({ kind: 'saved_profile', profileRef: 'server-example' });
        expect(hook.getCurrent().requestedHomeTarget).toBeUndefined();

        await act(async () => {
            currentActiveServerSnapshot = { ...currentActiveServerSnapshot, isSelectionExplicit: true, generation: 2 };
            activeServerListener?.(currentActiveServerSnapshot);
        });
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(hook.getCurrent().requestedHomeTarget).toEqual({ kind: 'saved_profile', profileRef: 'server-example' });
    });

    it('clears target A policy and identity as soon as target B observation starts', async () => {
        let resolveTargetB: ((value: unknown) => void) | null = null;
        getServerFeaturesSnapshotMock
            .mockResolvedValueOnce({
                status: 'ready',
                features: {
                    signInService: { v: 1, mode: 'external', endpoint: 'https://accounts-a.example.test' },
                    capabilities: {
                        serverIdentity: { serverIdentityId: 'srv_a' },
                        auth: { methods: [] },
                    },
                },
            })
            .mockImplementationOnce(() => new Promise((resolve) => { resolveTargetB = resolve; }));
        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(hook.getCurrent().observedHomeServerIdentityId).toBe('srv_a');
        expect(hook.getCurrent().signInServicePolicy).toBeTruthy();

        await act(async () => {
            currentActiveServerSnapshot = { serverId: 'server-b', serverUrl: 'https://home-b.example.test', generation: 2 };
            activeServerListener?.(currentActiveServerSnapshot);
        });
        await flushHookEffects({ cycles: 1, turns: 1 });
        expect(hook.getCurrent()).toMatchObject({ serverAvailability: 'loading', showAuthActions: false });
        expect(hook.getCurrent().observedHomeServerIdentityId).toBeUndefined();
        expect(hook.getCurrent().signInServicePolicy).toBeUndefined();

        await act(async () => resolveTargetB?.({ status: 'unsupported', reason: 'invalid_payload' }));
    });

    it('converges a stale enabled signup action to an explicit empty primary action after a forced policy refresh', async () => {
        getServerFeaturesSnapshotMock
            .mockResolvedValueOnce({
                status: 'ready',
                features: {
                    capabilities: {
                        auth: {
                            methods: [
                                {
                                    id: 'key_challenge',
                                    actions: [
                                        { id: 'login', enabled: true, mode: 'keyed' },
                                        { id: 'provision', enabled: true, mode: 'keyed' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            })
            .mockResolvedValueOnce({
                status: 'ready',
                features: {
                    capabilities: {
                        auth: {
                            methods: [
                                {
                                    id: 'key_challenge',
                                    actions: [
                                        { id: 'login', enabled: true, mode: 'keyed' },
                                        { id: 'provision', enabled: false, mode: 'keyed' },
                                    ],
                                },
                            ],
                        },
                    },
                },
            });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().primaryAction).toEqual({
            kind: 'anonymous',
            title: 'Create account',
        });

        await act(async () => {
            hook.getCurrent().retryServerCheck();
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(2);
        expect(getServerFeaturesSnapshotMock.mock.calls[1]?.[0]?.force).toBe(true);
        expect(hook.getCurrent().showAnonymousSignup).toBe(false);
        expect(hook.getCurrent().showProviderSignup).toBe(false);
        expect(hook.getCurrent().primaryAction).toBeNull();
    });

    it('marks invalid server payloads as incompatible and hides auth actions', async () => {
        getServerFeaturesSnapshotMock.mockResolvedValue({ status: 'unsupported', reason: 'invalid_payload' });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        const options = hook.getCurrent();
        expect(options.serverAvailability).toBe('incompatible');
        expect(options.showAuthActions).toBe(false);
        expect(options.retryServerCheck).toEqual(expect.any(Function));
    });

    it('re-checks auth options when the active server changes', async () => {
        getServerFeaturesSnapshotMock
            .mockResolvedValueOnce({
                status: 'ready',
                features: {
                    capabilities: {
                        auth: {
                            methods: [
                                {
                                    id: 'key_challenge',
                                    actions: [
                                        { id: 'login', enabled: true, mode: 'keyed' },
                                        { id: 'provision', enabled: true, mode: 'keyed' },
                                    ],
                                },
                            ],
                            signup: { methods: [] },
                            login: { methods: [], requiredProviders: [] },
                            ui: { autoRedirect: { enabled: false, providerId: null } },
                        },
                    },
                },
            })
            .mockResolvedValueOnce({ status: 'unsupported', reason: 'invalid_payload' });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().serverAvailability).toBe('ready');
        expect(hook.getCurrent().serverUrlForCopy).toBe('http://api.example.test');
        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            currentActiveServerSnapshot = {
                serverId: 'server-other',
                serverUrl: 'http://api.other.test',
                generation: 2,
            };
            activeServerListener?.(currentActiveServerSnapshot);
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        const options = hook.getCurrent();
        expect(options.serverUrlForCopy).toBe('http://api.other.test');
        expect(options.serverAvailability).toBe('incompatible');
        expect(options.showAuthActions).toBe(false);
        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(2);
    });

    it('re-checks an unavailable relay when the same active URL is restored with a new generation', async () => {
        getServerFeaturesSnapshotMock.mockResolvedValue({ status: 'error', reason: 'network' });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        await act(async () => {
            hook.getCurrent().retryServerCheck();
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().serverAvailability).toBe('unavailable');
        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(2);

        getServerFeaturesSnapshotMock.mockResolvedValue({
            status: 'ready',
            features: { capabilities: { auth: { methods: [] } } },
        });
        await act(async () => {
            currentActiveServerSnapshot = {
                ...currentActiveServerSnapshot,
                generation: currentActiveServerSnapshot.generation + 1,
            };
            activeServerListener?.(currentActiveServerSnapshot);
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(3);
        expect(hook.getCurrent().serverAvailability).toBe('ready');
        expect(hook.getCurrent().showAuthActions).toBe(true);
        expect(hook.getCurrent().authenticationActions).toEqual([]);
        expect(hook.getCurrent().primaryAction).toBeNull();
    });

    it('does not schedule an automatic retry and reconciles only when the canonical feature cache reports recovery', async () => {
        vi.useFakeTimers();
        try {
            const readySnapshot = {
                status: 'ready' as const,
                features: {
                    capabilities: {
                        auth: {
                            methods: [
                                {
                                    id: 'key_challenge',
                                    actions: [
                                        { id: 'login', enabled: true, mode: 'keyed' },
                                        { id: 'provision', enabled: true, mode: 'keyed' },
                                    ],
                                },
                            ],
                            signup: { methods: [] },
                            login: { methods: [], requiredProviders: [] },
                            ui: { autoRedirect: { enabled: false, providerId: null } },
                        },
                    },
                },
            };
            getServerFeaturesSnapshotMock.mockResolvedValue({ status: 'error', reason: 'network' });

            const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
            const hook = await renderHook(() => useAuthEntryOptions());
            await flushHookEffects({ cycles: 2, turns: 2 });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000);
            });
            await flushHookEffects({ cycles: 2, turns: 2 });

            expect(hook.getCurrent().serverAvailability).toBe('unavailable');
            expect(hook.getCurrent().showAuthActions).toBe(false);
            expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(1);

            getCachedServerFeaturesSnapshotMock.mockReturnValue(readySnapshot);
            getServerFeaturesSnapshotMock.mockResolvedValue(readySnapshot);
            await act(async () => {
                serverFeaturesSnapshotListener?.();
            });
            await flushHookEffects({ cycles: 2, turns: 2 });

            expect(hook.getCurrent().serverAvailability).toBe('ready');
            expect(hook.getCurrent().showAuthActions).toBe(true);
            expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(2);
            expect(getServerFeaturesSnapshotMock.mock.calls[1]?.[0]?.force).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('bounds the auth-entry request with the same Welcome attempt timeout', async () => {
        vi.useFakeTimers();
        try {
            getServerFeaturesSnapshotMock.mockResolvedValue({
                status: 'ready',
                features: { capabilities: { auth: { methods: [] } } },
            });
            fetchHomeAuthEntryMock.mockImplementationOnce(async (input?: { signal?: AbortSignal }) => {
                if (!input?.signal) return { kind: 'unavailable' } as const;
                return await new Promise<{ kind: 'unavailable' }>((resolve) => {
                    input.signal!.addEventListener('abort', () => resolve({ kind: 'unavailable' }), { once: true });
                });
            });

            const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
            const hook = await renderHook(() => useAuthEntryOptions());
            await flushHookEffects({ cycles: 1, turns: 2 });

            expect(fetchHomeAuthEntryMock).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
            expect(getServerFeaturesSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 6_000 }));
            expect(hook.getCurrent().serverAvailability).toBe('loading');

            await act(async () => {
                await vi.advanceTimersByTimeAsync(6_000);
            });
            await flushHookEffects({ cycles: 2, turns: 2 });
            // A timed-out auth-entry probe degrades to the observed feature
            // catalog with a notice; it never hides the usable Home.
            expect(hook.getCurrent().serverAvailability).toBe('ready');
            expect(hook.getCurrent().showAuthActions).toBe(true);
            expect(hook.getCurrent().authEntryUnavailable).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('issues both probes concurrently and keeps the observed feature catalog when auth-entry is unavailable', async () => {
        const features = createDeferred<{ status: 'ready'; features: unknown }>();
        getServerFeaturesSnapshotMock.mockReturnValue(features.promise);
        fetchHomeAuthEntryMock.mockResolvedValue({ kind: 'unavailable' });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 1, turns: 2 });

        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(1);
        expect(fetchHomeAuthEntryMock).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().serverAvailability).toBe('loading');

        features.resolve({
            status: 'ready',
            features: {
                capabilities: {
                    oauth: { providers: { github: { configured: true } } },
                    auth: {
                        methods: [{ id: 'github', actions: [{ id: 'provision', enabled: true, mode: 'keyed' }] }],
                        signup: { methods: [{ id: 'github', enabled: true }] },
                        login: { methods: [], requiredProviders: [] },
                        ui: { autoRedirect: { enabled: false, providerId: null } },
                    },
                },
            },
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        const options = hook.getCurrent();
        expect(options.serverAvailability).toBe('ready');
        expect(options.authEntryUnavailable).toBe(true);
        expect(options.showAuthActions).toBe(true);
        expect(options.showProviderSignup).toBe(true);
        expect(options.providerId).toBe('github');
    });

    it('keeps a Home-denied auth entry blocked instead of substituting the feature catalog', async () => {
        getServerFeaturesSnapshotMock.mockResolvedValue({
            status: 'ready',
            features: { capabilities: { auth: { methods: [] } } },
        });
        fetchHomeAuthEntryMock.mockResolvedValue({ kind: 'ready', projection: { v: 1, scope: { kind: 'home' }, state: 'denied' } });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().serverAvailability).toBe('unavailable');
        expect(hook.getCurrent().showAuthActions).toBe(false);
    });

    it('consumes a forced retry once when a successful identity-bearing response advances the server generation', async () => {
        let allowReadyResponse = false;
        let identityGenerationBumpsRemaining = 3;
        getServerFeaturesSnapshotMock.mockImplementation(async (params?: { force?: boolean }) => {
            if (!allowReadyResponse) {
                return { status: 'error', reason: 'network' };
            }

            if (params?.force === true && identityGenerationBumpsRemaining > 0) {
                identityGenerationBumpsRemaining -= 1;
                currentActiveServerSnapshot = {
                    ...currentActiveServerSnapshot,
                    generation: currentActiveServerSnapshot.generation + 1,
                };
                activeServerListener?.(currentActiveServerSnapshot);
            }
            return {
                status: 'ready',
                features: { capabilities: { auth: { methods: [] } } },
            };
        });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        await act(async () => {
            hook.getCurrent().retryServerCheck();
        });
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(hook.getCurrent().serverAvailability).toBe('unavailable');

        allowReadyResponse = true;
        await act(async () => {
            hook.getCurrent().retryServerCheck();
        });
        await flushHookEffects({ cycles: 8, turns: 4 });

        expect(hook.getCurrent().serverAvailability).toBe('ready');
        expect(hook.getCurrent().showAuthActions).toBe(true);
        expect(hook.getCurrent().authenticationActions).toEqual([]);
        expect(hook.getCurrent().primaryAction).toBeNull();
        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(4);
        expect(getServerFeaturesSnapshotMock.mock.calls.map(([params]) => params?.force)).toEqual([
            false,
            true,
            true,
            false,
        ]);
        expect(identityGenerationBumpsRemaining).toBe(2);
    });

    it('syncs to the latest active server on mount when the server changed before the subscription effect attached', async () => {
        let currentSnapshot: TestActiveServerSnapshot = {
            serverId: 'server-example',
            serverUrl: 'http://api.example.test',
            generation: 1,
        };
        getActiveServerSnapshotMock.mockImplementation(() => currentSnapshot);
        subscribeActiveServerMock.mockImplementationOnce((_listener: (snapshot: TestActiveServerSnapshot) => void) => {
            currentSnapshot = {
                serverId: 'server-override',
                serverUrl: 'http://api.override.test',
                generation: 2,
            };
            return () => {};
        });
        getServerFeaturesSnapshotMock.mockResolvedValue({
            status: 'ready',
            features: {
                capabilities: {
                    auth: {
                        methods: [
                            {
                                id: 'key_challenge',
                                actions: [
                                    { id: 'login', enabled: true, mode: 'keyed' },
                                    { id: 'provision', enabled: true, mode: 'keyed' },
                                ],
                            },
                        ],
                        signup: { methods: [] },
                        login: { methods: [], requiredProviders: [] },
                        ui: { autoRedirect: { enabled: false, providerId: null } },
                    },
                },
            },
        });

        const { useAuthEntryOptions } = await import('./useAuthEntryOptions');
        const hook = await renderHook(() => useAuthEntryOptions());
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(hook.getCurrent().serverUrlForCopy).toBe('http://api.override.test');
    });
});
