import { describe, expect, it, vi } from 'vitest';

import { createDeferred, flushHookEffects, renderHook } from '@/dev/testkit';

import { usePersonalHomeBootstrapController } from './usePersonalHomeBootstrapController';
import type { PersonalHomeFacts } from './personalHomeBootstrapTypes';

function facts(overrides: Partial<PersonalHomeFacts> = {}): PersonalHomeFacts {
    return {
        hostIsDesktop: true,
        isDesktopMainWindow: true,
        explicitlySelectedOtherHome: false,
        completedPersonalHomeProfile: null,
        candidateLocalProfile: null,
        relayRuntime: {
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

        firstRead.resolve(authoritativeFacts);
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
        hook.getCurrent().refresh();
        await flushHookEffects({ cycles: 5, turns: 2 });

        expect(prepareComputer).toHaveBeenCalledTimes(1);
    });

    it('re-reads authoritative facts after each idempotent operation', async () => {
        let current = facts();
        const readFacts = vi.fn(async () => current);
        const closeSignup = vi.fn(async () => {
            current = facts({ anonymousSignup: 'disabled' });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'close-signup': closeSignup },
        }));
        await flushHookEffects();

        expect(closeSignup).toHaveBeenCalledTimes(1);
        expect(readFacts.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
    });

    it('turns operation failures into a retryable blocked snapshot', async () => {
        const readFacts = vi.fn(async () => facts({ relayRuntime: null }));
        const prepareHome = vi.fn(async () => { throw new Error('download failed'); });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'prepare-home': prepareHome },
        }));
        await flushHookEffects();

        expect(prepareHome).toHaveBeenCalledTimes(1);
        expect(hook.getCurrent().snapshot).toMatchObject({
            phase: 'blocked',
            action: 'retry',
            shouldGateShell: true,
        });
        expect(hook.getCurrent().error?.message).toContain('download failed');
    });

    it('surfaces an existing-runtime conflict through the recovery callbacks instead of an endless retry', async () => {
        const readFacts = vi.fn(async () => facts({ localHomeAuth: 'missing' }));
        const connectApp = vi.fn(async () => {
            throw Object.assign(new Error('existing runtime needs a choice'), {
                code: 'personal_home_existing_runtime_conflict',
            });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'connect-app': connectApp },
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
        const connectApp = vi.fn(async () => {
            throw Object.assign(new Error('saved credentials no longer authenticate'), {
                code: 'personal_home_credentials_unverified',
            });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'connect-app': connectApp },
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
        const connectApp = vi.fn(async () => {
            if (failNext) throw new Error('profile store unavailable');
            current = facts({
                anonymousSignup: 'disabled',
                completedPersonalHomeProfile: adopt as PersonalHomeFacts['completedPersonalHomeProfile'],
            });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'connect-app': connectApp },
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
        hook.getCurrent().retry();
        await flushHookEffects();

        expect(connectApp).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().error).toBeNull();
        expect(hook.getCurrent().snapshot.action).toBe('none');
        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
    });

    it('prevents double execution while an operation is in flight', async () => {
        let release!: () => void;
        const inFlight = new Promise<void>((resolve) => {
            release = resolve;
        });
        const connectApp = vi.fn(async () => {
            await inFlight;
        });
        const readFacts = vi.fn(async () => facts({ anonymousSignup: 'disabled' }));

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
        }));
        await flushHookEffects();

        // Manual actions enter the same controller-owned executor. The in-flight guard is set
        // synchronously, so a second press cannot start the runner again.
        const first = hook.getCurrent().execute(connectApp);
        const second = hook.getCurrent().execute(connectApp);
        await flushHookEffects();
        expect(connectApp).toHaveBeenCalledTimes(1);
        await expect(second).resolves.toBe(false);

        release();
        await first;
        await flushHookEffects();
    });

    it('keeps a partially completed existing-runtime failure on its retryable decision surface', async () => {
        let current = facts({
            relayRuntime: {
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

        await hook.getCurrent().execute(useExisting);
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
        const prepareHome = vi.fn(async () => {
            if (failFirst) throw new Error('download failed');
            current = facts({ anonymousSignup: 'disabled' });
        });

        const hook = await renderHook(() => usePersonalHomeBootstrapController({
            readFacts,
            operations: { 'prepare-home': prepareHome },
        }));
        await flushHookEffects();

        expect(hook.getCurrent().snapshot).toMatchObject({ phase: 'blocked', action: 'retry' });

        failFirst = false;
        hook.getCurrent().retry();
        await flushHookEffects();

        expect(prepareHome).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().error).toBeNull();
        expect(hook.getCurrent().snapshot.shouldGateShell).toBe(false);
    });
});
