import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { createDeferred, flushHookEffects, renderHook } from '@/dev/testkit';

import {
    usePersonalHomeBootstrapController,
    type PersonalHomeBootstrapOperationRunner,
} from './usePersonalHomeBootstrapController';
import type { PersonalHomeFacts } from './personalHomeBootstrapTypes';

function facts(overrides: Partial<PersonalHomeFacts> = {}): PersonalHomeFacts {
    return {
        hostIsDesktop: true,
        isDesktopMainWindow: true,
        explicitlySelectedOtherHome: false,
        completedPersonalHomeProfile: null,
        candidateLocalProfile: {
            id: 'local', name: 'Personal Home', serverUrl: 'http://127.0.0.1:43123',
            serverIdentityId: 'home-1', createdAt: 1, updatedAt: 1, lastUsedAt: 1,
        },
        relayRuntime: {
            relayUrl: 'http://127.0.0.1:43123',
            installed: true,
            healthy: true,
            status: 'healthy',
            purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
        },
        localHomeReachability: 'reachable',
        localHomeIdentity: 'home-1',
        localHomeAuth: 'present',
        anonymousSignup: 'enabled',
        daemon: null,
        activeTask: null,
        ...overrides,
    };
}

const completedProfile = {
    id: 'local', name: 'Personal Home', serverUrl: 'http://127.0.0.1:43123',
    createdAt: 1, updatedAt: 1, lastUsedAt: 1, source: 'desktop-personal-home' as const,
};

describe('usePersonalHomeBootstrapController', () => {
    it('uses optimistic completion only to release the shell and waits for verified Home facts before daemon setup', async () => {
        const profile = {
            id: 'local', name: 'Personal Home', serverUrl: 'http://127.0.0.1:43123',
            createdAt: 1, updatedAt: 1, lastUsedAt: 1, source: 'desktop-personal-home' as const,
        };
        const optimistic = facts({
            completedPersonalHomeProfile: profile,
            localHomeReachability: 'unknown',
            localHomeIdentity: 'home-1',
            localHomeAuth: 'unknown',
            anonymousSignup: 'unknown',
        });
        let authoritativeFacts = facts({
            completedPersonalHomeProfile: profile,
            localHomeReachability: 'unreachable',
            localHomeIdentity: null,
            localHomeAuth: 'unknown',
            anonymousSignup: 'unknown',
        });
        const firstRead = createDeferred<PersonalHomeFacts>();
        const readFacts = vi.fn(async () => await firstRead.promise);
        const prepareComputer = vi.fn(async () => {});

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            initialFacts: optimistic,
            operations: { 'prepare-computer': prepareComputer },
        }));
        await flushHookEffects({ cycles: 1, turns: 1 });

        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
        expect(prepareComputer).not.toHaveBeenCalled();

        await act(async () => {
            firstRead.resolve(authoritativeFacts);
        });
        await flushHookEffects({ cycles: 4, turns: 2 });
        expect(prepareComputer).not.toHaveBeenCalled();

        authoritativeFacts = facts({
            completedPersonalHomeProfile: profile,
            localHomeReachability: 'reachable',
            localHomeIdentity: 'home-1',
            localHomeAuth: 'present',
            anonymousSignup: 'disabled',
        });
        readFacts.mockImplementation(async () => authoritativeFacts);
        await act(async () => {
            hook.getCurrent().refresh();
        });
        await flushHookEffects({ cycles: 5, turns: 2 });

        expect(prepareComputer).toHaveBeenCalledTimes(1);
    });

    it('re-reads authoritative facts after each idempotent operation', async () => {
        let current = facts();
        const readFacts = vi.fn(async () => current);
        const ensureHomeReady = vi.fn(async () => {
            current = facts({
                anonymousSignup: 'disabled',
                completedPersonalHomeProfile: completedProfile,
            });
        });
        const prepareComputer = vi.fn(async () => {});

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: {
                'ensure-home-ready': ensureHomeReady,
                'prepare-computer': prepareComputer,
            },
        }));
        await flushHookEffects();

        expect(ensureHomeReady).toHaveBeenCalledTimes(1);
        expect(readFacts.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
    });

    it('turns operation failures into a retryable blocked snapshot', async () => {
        const readFacts = vi.fn(async () => facts({ relayRuntime: null }));
        const ensureHomeReady = vi.fn(async () => { throw new Error('download failed'); });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'ensure-home-ready': ensureHomeReady },
        }));
        await flushHookEffects();

        expect(ensureHomeReady).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().snapshot).toMatchObject({
            phase: 'blocked',
            action: 'retry',
            shouldGateShell: true,
        });
        expect(hook.getCurrent().error?.message).toContain('download failed');
    });

    it('surfaces an existing-runtime conflict through the recovery callbacks instead of an endless retry', async () => {
        const readFacts = vi.fn(async () => facts({ localHomeAuth: 'missing' }));
        const ensureHomeReady = vi.fn(async () => {
            throw Object.assign(new Error('existing runtime needs a choice'), {
                code: 'personal_home_existing_runtime_conflict',
            });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'ensure-home-ready': ensureHomeReady },
        }));
        await flushHookEffects();

        expect(hook.getCurrent().snapshot).toMatchObject({
            phase: 'blocked',
            action: 'choose-existing-runtime',
            shouldGateShell: true,
            detail: { retryable: false },
        });
    });

    it('routes invalid persisted Personal Home credentials to the existing recovery path', async () => {
        const readFacts = vi.fn(async () => facts({ localHomeAuth: 'missing' }));
        const ensureHomeReady = vi.fn(async () => {
            throw Object.assign(new Error('saved credentials no longer authenticate'), {
                code: 'personal_home_credentials_unverified',
            });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'ensure-home-ready': ensureHomeReady },
        }));
        await flushHookEffects();

        expect(hook.getCurrent().snapshot).toMatchObject({
            phase: 'blocked',
            action: 'choose-existing-runtime',
            shouldGateShell: true,
            detail: { retryable: false },
        });
    });

    it('publishes an operation failure only after refreshed facts and releases the shell when Home readiness holds', async () => {
        const adopt = {
            id: 'local', name: 'Personal Home', serverUrl: 'http://127.0.0.1:43123',
            createdAt: 1, updatedAt: 1, lastUsedAt: 1,
        };
        let current = facts({ anonymousSignup: 'disabled' });
        let failNext = true;
        const readFacts = vi.fn(async () => current);
        const ensureHomeReady = vi.fn(async () => {
            if (failNext) throw new Error('profile store unavailable');
            current = facts({
                anonymousSignup: 'disabled',
                completedPersonalHomeProfile: adopt as PersonalHomeFacts['completedPersonalHomeProfile'],
            });
        });
        const prepareComputer = vi.fn(async () => {});

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: {
                'ensure-home-ready': ensureHomeReady,
                'prepare-computer': prepareComputer,
            },
        }));
        await flushHookEffects();

        // The failure snapshot was published only after an authoritative facts refresh, so the
        // shell is released even while the retry state remains visible.
        expect(readFacts.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(hook.getCurrent().error?.message).toContain('profile store unavailable');
        expect(hook.getCurrent().snapshot.homeReady).toBe(true);
        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
        expect(hook.getCurrent().snapshot.action).toBe('retry');

        failNext = false;
        await act(async () => {
            hook.getCurrent().retry();
        });
        await flushHookEffects();

        expect(ensureHomeReady).toHaveBeenCalledTimes(2);
        expect(prepareComputer).toHaveBeenCalledTimes(1);
        expect(ensureHomeReady.mock.invocationCallOrder[1]).toBeLessThan(prepareComputer.mock.invocationCallOrder[0]!);
        expect(hook.getCurrent().error).toBeNull();
        expect(hook.getCurrent().snapshot.action).toBe('none');
        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
    });

    it('prevents double execution while an operation is in flight', async () => {
        let release!: () => void;
        const inFlight = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ensureHomeReady = vi.fn(async () => {
            await inFlight;
        });
        const readFacts = vi.fn(async () => facts({ anonymousSignup: 'disabled' }));

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
        }));
        await flushHookEffects();

        // Manual actions enter the same controller-owned executor. The in-flight guard is set
        // synchronously, so a second press cannot start the runner again.
        let first!: Promise<boolean>;
        let second!: Promise<boolean>;
        await act(async () => {
            first = hook.getCurrent().execute(ensureHomeReady);
            second = hook.getCurrent().execute(ensureHomeReady);
        });
        await flushHookEffects();
        expect(ensureHomeReady).toHaveBeenCalledTimes(1);
        await expect(second).resolves.toBe(false);

        await act(async () => {
            release();
            await first;
        });
        await flushHookEffects();
    });

    it('keeps a partially completed existing-runtime failure on its retryable decision surface', async () => {
        let current = facts({
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:43123',
                installed: true,
                healthy: true,
                status: 'healthy',
                purpose: { kind: 'generic' },
            },
            localHomeAuth: 'present',
            anonymousSignup: 'disabled',
        });
        const readFacts = vi.fn(async () => current);
        const useExisting = vi.fn(async () => {
            current = facts({
                relayRuntime: {
                    relayUrl: 'http://127.0.0.1:43123',
                    installed: true,
                    healthy: true,
                    status: 'healthy',
                    purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
                },
                localHomeAuth: 'present',
                anonymousSignup: 'disabled',
            });
            throw new Error('restart readback unavailable');
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({ readFacts }));
        await flushHookEffects();
        expect(hook.getCurrent().snapshot.action).toBe('choose-existing-runtime');

        await act(async () => {
            await hook.getCurrent().execute(useExisting);
        });
        await flushHookEffects();

        expect(readFacts).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().facts?.relayRuntime?.purpose?.kind).toBe('personal-home');
        expect(hook.getCurrent().snapshot).toMatchObject({
            phase: 'blocked',
            action: 'choose-existing-runtime',
            detail: { retryable: true },
        });
    });

    it('re-runs the snapshot operation through the shared executor on explicit retry', async () => {
        let current = facts({ relayRuntime: null });
        let failFirst = true;
        const readFacts = vi.fn(async () => current);
        const ensureHomeReady = vi.fn(async () => {
            if (failFirst) throw new Error('download failed');
            current = facts({
                anonymousSignup: 'disabled',
                completedPersonalHomeProfile: completedProfile,
            });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'ensure-home-ready': ensureHomeReady },
        }));
        await flushHookEffects();

        expect(hook.getCurrent().snapshot).toMatchObject({ phase: 'blocked', action: 'retry' });

        failFirst = false;
        await act(async () => {
            hook.getCurrent().retry();
        });
        await flushHookEffects();

        expect(ensureHomeReady).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().error).toBeNull();
        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
    });

    it('does not automatically recreate an erased Personal Home, but passes an explicit retry trigger to the canonical runner', async () => {
        let current = facts({
            candidateLocalProfile: null,
            localHomeIdentity: null,
            localHomeAuth: 'missing',
            anonymousSignup: 'unknown',
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:43123',
                installed: true,
                dataPresent: false,
                healthy: false,
                status: 'stopped',
                purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
                anonymousSignupEnabled: null,
            },
        });
        const readFacts = vi.fn(async () => current);
        const ensureHomeReady = vi.fn(async (
            _facts: PersonalHomeFacts,
            context?: Parameters<PersonalHomeBootstrapOperationRunner>[1],
        ) => {
            expect(context).toEqual({ trigger: 'retry' });
            current = facts({
                anonymousSignup: 'disabled',
                completedPersonalHomeProfile: completedProfile,
            });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'ensure-home-ready': ensureHomeReady },
        }));
        await flushHookEffects();

        expect(hook.getCurrent().snapshot).toMatchObject({ phase: 'blocked', action: 'retry' });
        expect(ensureHomeReady).not.toHaveBeenCalled();

        await act(async () => {
            hook.getCurrent().retry();
        });
        await flushHookEffects();

        expect(ensureHomeReady).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
    });

    it('retries post-ready daemon recovery through prepare-computer', async () => {
        let failFirst = true;
        const readyWithoutDaemon = facts({
            completedPersonalHomeProfile: completedProfile,
            anonymousSignup: 'disabled',
        });
        const readFacts = vi.fn(async () => readyWithoutDaemon);
        const prepareComputer = vi.fn(async () => {
            if (failFirst) throw new Error('daemon unavailable');
        });
        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'prepare-computer': prepareComputer },
        }));
        await flushHookEffects();

        expect(hook.getCurrent().snapshot).toMatchObject({ phase: 'blocked', action: 'retry', homeReady: true });
        failFirst = false;
        await act(async () => {
            hook.getCurrent().retry();
        });
        await flushHookEffects();

        expect(prepareComputer).toHaveBeenCalledTimes(2);
    });

    it('never auto-runs either operation while an existing runtime awaits a decision', async () => {
        const readFacts = vi.fn(async () => facts({
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:43123',
                installed: true,
                dataPresent: true,
                healthy: true,
                status: 'healthy',
                purpose: { kind: 'generic' },
            },
        }));
        const ensureHomeReady = vi.fn(async () => {});
        const prepareComputer = vi.fn(async () => {});
        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: {
                'ensure-home-ready': ensureHomeReady,
                'prepare-computer': prepareComputer,
            },
        }));
        await flushHookEffects();

        expect(hook.getCurrent().snapshot.action).toBe('choose-existing-runtime');
        expect(ensureHomeReady).not.toHaveBeenCalled();
        expect(prepareComputer).not.toHaveBeenCalled();
    });
});
