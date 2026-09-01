import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION } from '@happier-dev/protocol';

import type { ScopedSocketClient } from './serverScopedRpcTypes';
import { createServerScopedRpcSocketPool } from './serverScopedRpcSocketPool';

type Listener = (...args: any[]) => void;

function createFakeSocket(options: Readonly<{ disconnectEventDelayMs?: number; connectionId?: string }> = {}): Readonly<{
    socket: any;
    connectSpy: ReturnType<typeof vi.fn>;
    disconnectSpy: ReturnType<typeof vi.fn>;
}> {
    const listeners = new Map<string, Set<Listener>>();

    const on = (event: string, cb: Listener) => {
        const set = listeners.get(event) ?? new Set<Listener>();
        set.add(cb);
        listeners.set(event, set);
    };

    const off = (event: string, cb: Listener) => {
        const set = listeners.get(event);
        set?.delete(cb);
    };

    const emit = (event: string, ...args: any[]) => {
        const set = listeners.get(event);
        if (!set) return;
        for (const cb of Array.from(set)) {
            cb(...args);
        }
    };

    const connectSpy = vi.fn(() => {
        socket.connected = true;
        // socket.io-client assigns `id` once the handshake completes.
        if (typeof options.connectionId === 'string') {
            socket.id = options.connectionId;
        }
        emit('connect');
    });

    const disconnectSpy = vi.fn(() => {
        socket.connected = false;
        if (typeof options.disconnectEventDelayMs === 'number') {
            setTimeout(() => emit('disconnect', 'io client disconnect'), Math.max(0, options.disconnectEventDelayMs));
            return;
        }
        emit('disconnect', 'io client disconnect');
    });

    const socket: any = {
        connected: false,
        on,
        off,
        connect: connectSpy,
        disconnect: disconnectSpy,
        timeout: (_ms: number) => ({
            emitWithAck: async () => ({ ok: true }),
        }),
        emit: vi.fn((event: string, ...args: any[]) => {
            emit(event, ...args);
        }),
    };

    return { socket, connectSpy, disconnectSpy };
}

describe('serverScopedRpcSocketPool', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses the canonical Socket.IO updates path', async () => {
        vi.resetModules();
        const { socket } = createFakeSocket();
        const ioSpy = vi.fn(() => socket);
        vi.doMock('socket.io-client', () => ({
            io: ioSpy,
        }));

        const { createServerScopedRpcSocketPool } = await import('./serverScopedRpcSocketPool');
        const pool = createServerScopedRpcSocketPool({
            reachability: {
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 0,
        });

        const client: ScopedSocketClient = await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-a',
            timeoutMs: 1000,
        });
        client.disconnect();

        expect(ioSpy).toHaveBeenCalledWith(
            'https://server.example.test',
            expect.objectContaining({
                path: '/v1/updates/',
                withCredentials: false,
                auth: expect.objectContaining({
                    // Assert the canonical declaration rather than a copied literal: the
                    // protocol owns this version and bumping it must not fail this test.
                    accountStoredContentCompatibility:
                        CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
                }),
            }),
        );

        await pool.stopAll();
        pool.resetForTests();
    });

    it('uses WebSocket-only for Iroh and does not pool it with HTTPS at the same origin', async () => {
        vi.resetModules();
        const first = createFakeSocket();
        const second = createFakeSocket();
        const ioSpy = vi.fn()
            .mockReturnValueOnce(first.socket)
            .mockReturnValueOnce(second.socket);
        vi.doMock('socket.io-client', () => ({ io: ioSpy }));

        const { createServerScopedRpcSocketPool } = await import('./serverScopedRpcSocketPool');
        const pool = createServerScopedRpcSocketPool({
            reachability: {
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 5_000,
        });

        const irohClient = await pool.acquire({
            serverUrl: 'http://127.0.0.1:4312',
            reachabilityServerUrl: 'https://home.example.test',
            carrier: 'iroh',
            token: 'token-a',
            timeoutMs: 1_000,
        });
        const httpsClient = await pool.acquire({
            serverUrl: 'http://127.0.0.1:4312',
            reachabilityServerUrl: 'https://home.example.test',
            carrier: 'https',
            token: 'token-a',
            timeoutMs: 1_000,
        });

        expect(ioSpy).toHaveBeenCalledTimes(2);
        expect(ioSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ transports: ['websocket'] }));
        expect(ioSpy.mock.calls[1]?.[1]).not.toHaveProperty('transports');

        irohClient.disconnect();
        httpsClient.disconnect();
        await pool.stopAll();
        pool.resetForTests();
    });

    it('keeps one live socket entry for the same private credential regardless of unrelated tokens', async () => {
        const createdTokens: string[] = [];
        const pool = createServerScopedRpcSocketPool({
            createSocket: ({ token }) => {
                createdTokens.push(token);
                return createFakeSocket().socket;
            },
            reachability: {
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 60_000,
        });

        const retained = await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'retained-token',
            timeoutMs: 1_000,
        });
        for (let index = 0; index < 520; index += 1) {
            const client = await pool.acquire({
                serverUrl: 'https://server.example.test',
                token: `unrelated-token-${index}`,
                timeoutMs: 1_000,
            });
            client.disconnect();
        }
        const sameCredential = await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'retained-token',
            timeoutMs: 1_000,
        });

        expect(createdTokens.filter((token) => token === 'retained-token')).toHaveLength(1);

        retained.disconnect();
        sameCredential.disconnect();
        await pool.stopAll();
        pool.resetForTests();
    });

    it('surfaces the underlying socket.io connection id so per-tab transports can target this socket', async () => {
        const ioSpy = vi.fn();
        const { socket } = createFakeSocket({ connectionId: 'conn-xyz' });
        ioSpy.mockReturnValue(socket);

        const pool = createServerScopedRpcSocketPool({
            createSocket: () => ioSpy(),
            reachability: {
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 0,
        });

        const client: ScopedSocketClient = await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-id',
            timeoutMs: 1000,
        });

        expect(client.getSocketId()).toBe('conn-xyz');

        client.disconnect();
        await pool.stopAll();
        pool.resetForTests();
    });

    it('returns an empty connection id when the socket has not completed a handshake', async () => {
        const ioSpy = vi.fn();
        const { socket } = createFakeSocket();
        // A fake socket whose connect handshake never assigns `id`.
        ioSpy.mockReturnValue(socket);

        const pool = createServerScopedRpcSocketPool({
            createSocket: () => ioSpy(),
            reachability: {
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 0,
        });

        const client: ScopedSocketClient = await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-noid',
            timeoutMs: 1000,
        });

        expect(client.getSocketId()).toBe('');

        client.disconnect();
        await pool.stopAll();
        pool.resetForTests();
    });

    it('reuses a single underlying socket across sequential acquires within the idle window', async () => {
        const ioSpy = vi.fn();
        const { socket, disconnectSpy } = createFakeSocket();
        ioSpy.mockReturnValue(socket);

	        const pool = createServerScopedRpcSocketPool({
	            createSocket: () => ioSpy(),
	            reachability: {
	                waitForReachable: async () => {},
	                startReachability: async () => {},
	                reportUnreachable: () => {},
	                subscribeNetworkAllowed: () => () => {},
	            },
	            readIdleDisconnectMs: () => 5_000,
	        });

        vi.useFakeTimers();

        const c1: ScopedSocketClient = await pool.acquire({ serverUrl: 'https://server.example.test', token: 't', timeoutMs: 1000 });
        expect(ioSpy).toHaveBeenCalledTimes(1);
        c1.disconnect();

        // No immediate disconnect; should remain cached/connected for the idle window.
        expect(disconnectSpy).toHaveBeenCalledTimes(0);

        const c2: ScopedSocketClient = await pool.acquire({ serverUrl: 'https://server.example.test', token: 't', timeoutMs: 1000 });
        expect(ioSpy).toHaveBeenCalledTimes(1);
        c2.disconnect();

        vi.advanceTimersByTime(5_000);
        expect(disconnectSpy).toHaveBeenCalledTimes(1);

        await pool.stopAll();
        pool.resetForTests();
    });

	    it('disconnects pooled sockets when reachability network becomes disallowed', async () => {
	        const ioSpy = vi.fn();
	        const { socket, disconnectSpy } = createFakeSocket();
	        ioSpy.mockReturnValue(socket);

	        let capturedListener: ((allowed: boolean) => void) | null = null;
	        const pool = createServerScopedRpcSocketPool({
	            createSocket: () => ioSpy(),
	            reachability: {
	                waitForReachable: async () => {},
	                startReachability: async () => {},
	                reportUnreachable: () => {},
	                subscribeNetworkAllowed: (listener: (allowed: boolean) => void) => {
	                    capturedListener = listener;
	                    return () => {
	                        if (capturedListener === listener) {
	                            capturedListener = null;
	                        }
	                    };
	                },
	            },
	            readIdleDisconnectMs: () => 5_000,
	        });

        const c1: ScopedSocketClient = await pool.acquire({ serverUrl: 'https://server.example.test', token: 't', timeoutMs: 1000 });
	        c1.disconnect();

	        expect(disconnectSpy).toHaveBeenCalledTimes(0);
	        if (!capturedListener) {
	            throw new Error('Expected reachability.subscribeNetworkAllowed to capture a listener');
	        }
	        const listenerFn: (allowed: boolean) => void = capturedListener as unknown as (allowed: boolean) => void;
	        listenerFn(false);
	        await vi.waitFor(() => {
	            expect(disconnectSpy).toHaveBeenCalledTimes(1);
	        });

	        await pool.stopAll();
	        pool.resetForTests();
	    });

    it('does not report unreachable when an intentional disconnect emits asynchronously', async () => {
        vi.useFakeTimers();
        const ioSpy = vi.fn();
        const { socket } = createFakeSocket({ disconnectEventDelayMs: 0 });
        ioSpy.mockReturnValue(socket);
        const reportUnreachableSpy = vi.fn();

        const pool = createServerScopedRpcSocketPool({
            createSocket: () => ioSpy(),
            reachability: {
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: reportUnreachableSpy,
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 5_000,
        });

        const c1: ScopedSocketClient = await pool.acquire({ serverUrl: 'https://server.example.test', token: 't', timeoutMs: 1000 });
        c1.disconnect();

        await pool.stopAll();
        await vi.runAllTimersAsync();
        expect(reportUnreachableSpy).not.toHaveBeenCalled();

        pool.resetForTests();
    });

    it('exposes raw socket event subscription on acquired scoped clients', async () => {
        const { socket } = createFakeSocket();
        const pool = createServerScopedRpcSocketPool({
            createSocket: () => socket,
            reachability: {
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 5_000,
        });

        const client: ScopedSocketClient = await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-a',
            timeoutMs: 1_000,
        });
        const listener = vi.fn();

        client.on('custom-event', listener);
        socket.emit('custom-event', { ok: true });
        expect(listener).toHaveBeenCalledWith({ ok: true });

        client.off('custom-event', listener);
        socket.emit('custom-event', { ok: false });
        expect(listener).toHaveBeenCalledTimes(1);

        client.disconnect();
        await pool.stopAll();
        pool.resetForTests();
    });

    it('removes and destroys the exact idle entry so token rotation cannot accumulate stale sockets', async () => {
        const first = createFakeSocket();
        const second = createFakeSocket();
        const createdSockets: unknown[] = [];
        const createSocketSpy = vi.fn(() => {
            const next = createdSockets.length === 0 ? first.socket : second.socket;
            createdSockets.push(next);
            return next;
        });

        const pool = createServerScopedRpcSocketPool({
            createSocket: () => createSocketSpy(),
            reachability: {
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 0,
        });

        const client: ScopedSocketClient = await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-a',
            timeoutMs: 1_000,
        });
        expect(first.connectSpy).toHaveBeenCalledTimes(1);

        // Idle teardown must detach the socket AND remove the exact pool entry, so the
        // next acquire for the same Home constructs a fresh entry instead of reusing a
        // torn-down socket (which is how token rotation accumulated stale entries).
        client.disconnect();
        await vi.waitFor(() => {
            expect(first.disconnectSpy).toHaveBeenCalled();
        });

        await pool.acquire({ serverUrl: 'https://server.example.test', token: 'token-a', timeoutMs: 1_000 });
        expect(createSocketSpy).toHaveBeenCalledTimes(2);
        expect(second.connectSpy).toHaveBeenCalledTimes(1);

        // stopAll must clear the exact map: a later acquire starts from a fresh entry.
        await pool.stopAll();
        await pool.acquire({ serverUrl: 'https://server.example.test', token: 'token-a', timeoutMs: 1_000 });
        expect(createSocketSpy).toHaveBeenCalledTimes(3);
        expect(second.connectSpy).toHaveBeenCalledTimes(2);

        pool.resetForTests();
    });

    it('does not reuse a same-key entry while its reachability release is still in flight', async () => {
        const first = createFakeSocket();
        const second = createFakeSocket();
        const createSocketSpy = vi.fn()
            .mockReturnValueOnce(first.socket)
            .mockReturnValueOnce(second.socket);
        let signalReleaseStarted!: () => void;
        const releaseStarted = new Promise<void>((resolve) => {
            signalReleaseStarted = resolve;
        });
        let finishFirstRelease!: () => void;
        const firstReleaseFinished = new Promise<void>((resolve) => {
            finishFirstRelease = resolve;
        });
        const releaseSpy = vi.fn()
            .mockImplementationOnce(async () => {
                signalReleaseStarted();
                await firstReleaseFinished;
            })
            .mockResolvedValue(undefined);
        const pool = createServerScopedRpcSocketPool({
            createSocket: () => createSocketSpy(),
            reachability: {
                acquireReachability: async () => ({ release: releaseSpy }),
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 0,
        });

        const firstClient = await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-a',
            timeoutMs: 1_000,
        });
        firstClient.disconnect();
        await releaseStarted;

        let secondAcquireSettled = false;
        const secondAcquire = pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-a',
            timeoutMs: 1_000,
        }).finally(() => {
            secondAcquireSettled = true;
        });
        for (let index = 0; index < 6; index += 1) {
            await Promise.resolve();
        }

        expect(secondAcquireSettled).toBe(false);
        expect(first.connectSpy).toHaveBeenCalledTimes(1);
        expect(createSocketSpy).toHaveBeenCalledTimes(1);

        finishFirstRelease();
        const secondClient = await secondAcquire;
        expect(createSocketSpy).toHaveBeenCalledTimes(2);
        expect(second.connectSpy).toHaveBeenCalledTimes(1);

        secondClient.disconnect();
        await pool.stopAll();
        pool.resetForTests();
    });

    it('retains failed reachability release custody and surfaces stopAll failure', async () => {
        const first = createFakeSocket();
        const second = createFakeSocket();
        const createSocketSpy = vi.fn()
            .mockReturnValueOnce(first.socket)
            .mockReturnValueOnce(second.socket);
        const releaseError = new Error('release failed');
        const releaseSpy = vi.fn()
            .mockRejectedValueOnce(releaseError)
            .mockResolvedValue(undefined);
        const pool = createServerScopedRpcSocketPool({
            createSocket: () => createSocketSpy(),
            reachability: {
                acquireReachability: async () => ({ release: releaseSpy }),
                waitForReachable: async () => {},
                startReachability: async () => {},
                reportUnreachable: () => {},
                subscribeNetworkAllowed: () => () => {},
            },
            readIdleDisconnectMs: () => 5_000,
        });

        await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-a',
            timeoutMs: 1_000,
        });

        await expect(pool.stopAll()).rejects.toBe(releaseError);
        expect(releaseSpy).toHaveBeenCalledTimes(1);

        await pool.stopAll();
        expect(releaseSpy).toHaveBeenCalledTimes(2);

        await pool.acquire({
            serverUrl: 'https://server.example.test',
            token: 'token-a',
            timeoutMs: 1_000,
        });
        expect(createSocketSpy).toHaveBeenCalledTimes(2);

        pool.resetForTests();
    });
});
