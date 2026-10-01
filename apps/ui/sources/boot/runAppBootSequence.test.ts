import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';

import { runAppBootSequence, type AppBootReadyState } from './runAppBootSequence';

type Deferred<T> = Readonly<{
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}>;

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

const CREDENTIALS: AuthCredentials = { token: 'token-1', secret: 'secret-1' };

/** Lets pending microtask chains settle without advancing fake timers. */
async function flushMicrotasks(): Promise<void> {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
    }
}

describe('runAppBootSequence', () => {
    it('boots an embed without opening credential, cache or draft storage or restoring the account', async () => {
        const events: string[] = [];
        const ready: AppBootReadyState[] = [];
        await runAppBootSequence({
            context: 'embed',
            loadFonts: async () => { events.push('fonts'); },
            sodiumReady: Promise.resolve(),
            resolveCredentials: async () => { events.push('stored-credentials'); return CREDENTIALS; },
            prepareWarmCache: async () => { events.push('warm-cache'); },
            prepareSessionDrafts: async () => { events.push('draft-storage'); },
            restoreSync: async () => { events.push('account-restore'); },
            onReady: (state) => ready.push(state),
        });
        expect(events).toEqual(['fonts']);
        expect(ready).toEqual([{ credentials: null, authGeneration: 0 }]);
    });
    it.each(['authenticated', 'signed-out', 'deferred'] as const)('waits for authoritative drafts before restore or first paint: %s', async (mode) => {
        const drafts = createDeferred<void>();
        const credentials = createDeferred<AuthCredentials | null>();
        const events: string[] = [];
        const run = runAppBootSequence({
            loadFonts: async () => {},
            sodiumReady: Promise.resolve(),
            resolveCredentials: () => mode === 'deferred' ? credentials.promise : Promise.resolve(mode === 'authenticated' ? CREDENTIALS : null),
            prepareWarmCache: async () => {},
            prepareSessionDrafts: () => drafts.promise,
            restoreSync: async () => { events.push('restore'); },
            onReady: () => { events.push('ready'); },
        });
        await vi.runAllTimersAsync();
        expect(events).toEqual([]);
        drafts.resolve();
        await flushMicrotasks();
        if (mode === 'deferred') credentials.resolve(CREDENTIALS);
        await run;
        expect(events).toEqual(mode === 'authenticated' ? ['restore', 'ready'] : mode === 'deferred' ? ['ready', 'restore', 'ready'] : ['ready']);
    });

    it('rejects failed authoritative draft preparation without restoring or painting empty state', async () => {
        const failure = new Error('IndexedDB unavailable');
        const events: string[] = [];
        await expect(runAppBootSequence({
            loadFonts: async () => {},
            sodiumReady: Promise.resolve(),
            resolveCredentials: async () => CREDENTIALS,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => { throw failure; },
            restoreSync: async () => { events.push('restore'); },
            onReady: () => { events.push('ready'); },
        })).rejects.toBe(failure);
        expect(events).toEqual([]);
    });

    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('starts fonts, libsodium and the credential read together instead of chaining them', async () => {
        const fonts = createDeferred<void>();
        const sodium = createDeferred<void>();
        const started: string[] = [];

        const run = runAppBootSequence({
            loadFonts: () => {
                started.push('fonts');
                return fonts.promise;
            },
            sodiumReady: (() => {
                started.push('sodium');
                return sodium.promise;
            })(),
            resolveCredentials: async () => {
                started.push('credentials');
                return CREDENTIALS;
            },
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: async () => {},
            onReady: () => {},
        });

        // Fonts are still pending. Every other leg already being in flight is what proves the gate
        // costs the maximum of the legs rather than their sum.
        await flushMicrotasks();
        expect([...started].sort()).toEqual(['credentials', 'fonts', 'sodium']);

        fonts.resolve();
        sodium.resolve();
        await vi.runAllTimersAsync();
        await run;
    });

    it('reaches first paint when font loading stalls forever', async () => {
        const fonts = createDeferred<void>();
        const ready: AppBootReadyState[] = [];

        const run = runAppBootSequence({
            loadFonts: () => fonts.promise,
            sodiumReady: Promise.resolve(),
            resolveCredentials: async () => CREDENTIALS,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: async () => {},
            onReady: (state) => ready.push(state),
        });

        await vi.runAllTimersAsync();
        await run;

        expect(ready).toEqual([{ credentials: CREDENTIALS, authGeneration: 0 }]);
    });

    it('reaches first paint when the keychain read stalls forever, without signing the user out', async () => {
        const credentials = createDeferred<AuthCredentials | null>();
        const ready: AppBootReadyState[] = [];
        const restored: AuthCredentials[] = [];

        const run = runAppBootSequence({
            loadFonts: async () => {},
            sodiumReady: Promise.resolve(),
            resolveCredentials: () => credentials.promise,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: async (value) => {
                restored.push(value);
            },
            onReady: (state) => ready.push(state),
        });

        await vi.runAllTimersAsync();
        expect(ready).toEqual([{ credentials: null, authGeneration: 0 }]);
        expect(restored).toEqual([]);

        // A slow keychain must become a late sign-in, never a silent sign-out.
        credentials.resolve(CREDENTIALS);
        await vi.runAllTimersAsync();
        await run;

        expect(restored).toEqual([CREDENTIALS]);
        expect(ready).toEqual([
            { credentials: null, authGeneration: 0 },
            { credentials: CREDENTIALS, authGeneration: 1 },
        ]);
    });

    it('starts restore (its synchronous local phase) before first paint, but never waits for its transport', async () => {
        const events: string[] = [];
        const transport = createDeferred<void>();
        const ready: AppBootReadyState[] = [];

        const run = runAppBootSequence({
            loadFonts: async () => {},
            sodiumReady: Promise.resolve(),
            resolveCredentials: async () => CREDENTIALS,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: () => {
                // The warm cache reaches the store here, synchronously, before the carrier.
                events.push('local-restore');
                return transport.promise;
            },
            onReady: (state) => {
                events.push('ready');
                ready.push(state);
            },
        });

        // An unreachable Home's carrier never settles: the cached rows must still paint.
        await vi.runAllTimersAsync();
        await run;
        expect(events).toEqual(['local-restore', 'ready']);
        expect(ready).toEqual([{ credentials: CREDENTIALS, authGeneration: 0 }]);
        transport.resolve();
    });

    it('keeps a transport restore that rejects after first paint from escaping as an unhandled rejection', async () => {
        const transport = createDeferred<void>();
        const ready: AppBootReadyState[] = [];

        await runAppBootSequence({
            loadFonts: async () => {},
            sodiumReady: Promise.resolve(),
            resolveCredentials: async () => CREDENTIALS,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: () => transport.promise,
            onReady: (state) => ready.push(state),
        });

        transport.reject(new Error('carrier unreachable'));
        await flushMicrotasks();
        expect(ready).toEqual([{ credentials: CREDENTIALS, authGeneration: 0 }]);
        expect(console.error).toHaveBeenCalledWith(
            'Failed to restore sync during init, continuing startup:',
            expect.any(Error),
        );
    });

    it('boots with fallback fonts when font loading rejects', async () => {
        const ready: AppBootReadyState[] = [];

        await runAppBootSequence({
            loadFonts: async () => {
                throw new Error('font registry unavailable');
            },
            sodiumReady: Promise.resolve(),
            resolveCredentials: async () => CREDENTIALS,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: async () => {},
            onReady: (state) => ready.push(state),
        });

        expect(ready).toEqual([{ credentials: CREDENTIALS, authGeneration: 0 }]);
    });

    it('boots when sync restore rejects', async () => {
        const ready: AppBootReadyState[] = [];

        await runAppBootSequence({
            loadFonts: async () => {},
            sodiumReady: Promise.resolve(),
            resolveCredentials: async () => CREDENTIALS,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: async () => {
                throw new Error('restore failed');
            },
            onReady: (state) => ready.push(state),
        });

        expect(ready).toEqual([{ credentials: CREDENTIALS, authGeneration: 0 }]);
    });

    it('does not re-key the auth tree when a deferred read confirms there is no session', async () => {
        const credentials = createDeferred<AuthCredentials | null>();
        const ready: AppBootReadyState[] = [];

        const run = runAppBootSequence({
            loadFonts: async () => {},
            sodiumReady: Promise.resolve(),
            resolveCredentials: () => credentials.promise,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: async () => {},
            onReady: (state) => ready.push(state),
        });

        await vi.runAllTimersAsync();
        credentials.resolve(null);
        await vi.runAllTimersAsync();
        await run;

        expect(ready).toEqual([{ credentials: null, authGeneration: 0 }]);
    });

    it('skips sync restore when the host has no restore owner (desktop activity overlay)', async () => {
        const ready: AppBootReadyState[] = [];

        await runAppBootSequence({
            loadFonts: async () => {},
            sodiumReady: Promise.resolve(),
            resolveCredentials: async () => CREDENTIALS,
            prepareWarmCache: async () => {},
            prepareSessionDrafts: async () => {},
            restoreSync: null,
            onReady: (state) => ready.push(state),
        });

        expect(ready).toEqual([{ credentials: CREDENTIALS, authGeneration: 0 }]);
    });
});
