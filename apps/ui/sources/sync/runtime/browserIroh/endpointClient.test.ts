import { describe, expect, it, vi } from 'vitest';

import {
    createBrowserIrohEndpointClient,
    resolveBrowserIrohEndpointClient,
    resolvePackagedBrowserIrohEndpointClient,
    resetPackagedBrowserIrohEndpointClientForTests,
    type BrowserIrohWorkerConnection,
} from './endpointClient';
import type { BrowserIrohPageLifecycle } from './pageLifecycleRelease';

function createSilentPort(): BrowserIrohWorkerConnection {
    return {
        port: { postMessage: () => {}, addEventListener: () => {} },
        onFailure: () => {},
    };
}

function createRecordingPort(): BrowserIrohWorkerConnection & { sent: unknown[] } {
    const sent: unknown[] = [];
    return {
        sent,
        port: {
            postMessage: (message) => {
                sent.push(message);
            },
            addEventListener: () => {},
        },
        onFailure: () => {},
    };
}

function createPageLifecycleStub() {
    const listeners = new Set<() => void>();
    return {
        lifecycle: {
            addEventListener: (_type: 'pagehide', listener: () => void) => {
                listeners.add(listener);
            },
            removeEventListener: (_type: 'pagehide', listener: () => void) => {
                listeners.delete(listener);
            },
        } satisfies BrowserIrohPageLifecycle,
        fire: () => {
            for (const listener of [...listeners]) listener();
        },
        listenerCount: () => listeners.size,
    };
}

describe('sync/runtime/browserIroh/endpointClient', () => {
    it('cancels a pending stream open promptly through the existing worker request id', async () => {
        const sent: Array<Record<string, unknown>> = [];
        let receive: ((event: { data: unknown }) => void) | null = null;
        const connection: BrowserIrohWorkerConnection = {
            port: {
                postMessage: (message) => {
                    const command = message as Record<string, unknown>;
                    sent.push(command);
                    if (command.kind === 'acquireLease') {
                        queueMicrotask(() => receive?.({ data: {
                            v: 1,
                            kind: 'leaseAcquired',
                            requestId: command.requestId,
                            leaseId: 'lease-1',
                            endpointId: 'local-endpoint',
                            appliedRelayUrls: ['https://relay.happier.test'],
                        } }));
                    }
                },
                addEventListener: (_type, listener) => {
                    receive = listener;
                },
            },
            onFailure: () => {},
        };
        const client = createBrowserIrohEndpointClient(() => connection, null);
        const lease = await client.acquireLease(['https://relay.happier.test']);
        const controller = new AbortController();
        const reason = new Error('request cancelled');
        const opening = lease.openStream({
            streamKind: 'home',
            endpointId: 'remote-endpoint',
            relayUrls: ['https://relay.happier.test'],
            signal: controller.signal,
        });
        const openCommand = sent.find((command) => command.kind === 'openStream');
        if (!openCommand) throw new Error('expected open command');

        controller.abort(reason);
        const promptly = await Promise.race([
            opening.then(() => 'resolved', (error: unknown) => error),
            new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 20)),
        ]);
        expect(promptly).toBe(reason);
        expect(sent).toContainEqual(expect.objectContaining({
            kind: 'cancelRequest',
            targetRequestId: openCommand.requestId,
        }));

    });

    it('does not connect a worker or load an asset on an HTTPS-only startup', () => {
        // An ineligible host resolves to unavailable without touching the
        // SharedWorker at all: the packaged wasm assets are never requested.
        const connect = vi.fn(createSilentPort);

        const availability = resolveBrowserIrohEndpointClient(connect, {
            eligible: false,
            reason: 'shared_worker_unsupported',
        });

        expect(availability.available).toBe(false);
        expect(connect).not.toHaveBeenCalled();
    });

    it('defers the worker connection until a caller actually asks for a lease', async () => {
        const connect = vi.fn(createSilentPort);

        const availability = resolveBrowserIrohEndpointClient(connect, { eligible: true });
        expect(availability.available).toBe(true);
        // Resolving availability is a host-capability decision only. Nothing has
        // been fetched, constructed, or connected yet.
        expect(connect).not.toHaveBeenCalled();

        if (!availability.available) throw new Error('expected an available client');
        // The reply never arrives from this silent port; the observable fact is
        // that asking is what connects.
        void availability.client.status();
        expect(connect).toHaveBeenCalledTimes(1);
    });

    it('reuses one port for every later command from this tab', async () => {
        const connect = vi.fn(createSilentPort);
        const availability = resolveBrowserIrohEndpointClient(connect, { eligible: true });
        if (!availability.available) throw new Error('expected an available client');

        void availability.client.status();
        void availability.client.acquireLease(['https://relay.happier.test']);

        expect(connect).toHaveBeenCalledTimes(1);
    });

    it('attaches no page-lifecycle listener until a caller connects the worker', () => {
        // Same rule as the port itself: resolving availability and holding an
        // unused client cost the page nothing.
        const pagehide = createPageLifecycleStub();
        const connection = createRecordingPort();

        const client = createBrowserIrohEndpointClient(() => connection, pagehide.lifecycle);

        expect(pagehide.listenerCount()).toBe(0);
        void client.status();
        expect(pagehide.listenerCount()).toBe(1);
    });

    it('releases this tab’s leases best-effort when the page goes away', async () => {
        // `pagehide` is the ordinary end of a page — reload, navigation, tab
        // close. The worker outlives it, so the leases have to be handed back
        // there or they stay held by a client id no port answers for. It is
        // best-effort by construction: nothing is awaited, because the page may
        // not be alive to hear the reply.
        const pagehide = createPageLifecycleStub();
        const connection = createRecordingPort();
        const client = createBrowserIrohEndpointClient(() => connection, pagehide.lifecycle);
        void client.status();
        connection.sent.length = 0;

        pagehide.fire();

        expect(connection.sent).toHaveLength(1);
        expect(connection.sent[0]).toMatchObject({ v: 1, kind: 'releaseClient' });
        expect((connection.sent[0] as { requestId: string }).requestId).toEqual(expect.any(String));
    });

    it('detaches the page-lifecycle listener when the client is closed', () => {
        const pagehide = createPageLifecycleStub();
        const connection = createRecordingPort();
        const client = createBrowserIrohEndpointClient(() => connection, pagehide.lifecycle);
        void client.status();
        connection.sent.length = 0;

        client.close();

        expect(pagehide.listenerCount()).toBe(0);
        pagehide.fire();
        expect(connection.sent).toEqual([]);
    });

    it('fails an in-flight and a later request when the packaged worker cannot load', async () => {
        // An app built without the browser Iroh assets still looks eligible: the
        // browser has SharedWorker and IndexedDB. The worker script 404s, the
        // port never answers, and without this the caller would wait forever.
        const failListeners: ((reason: string) => void)[] = [];
        const connect = vi.fn(
            (): BrowserIrohWorkerConnection => ({
                port: { postMessage: () => {}, addEventListener: () => {} },
                onFailure: (listener) => {
                    failListeners.push(listener);
                },
            }),
        );

        const availability = resolveBrowserIrohEndpointClient(connect, { eligible: true });
        if (!availability.available) throw new Error('expected an available client');

        const inFlight = availability.client.status();
        for (const listener of failListeners) listener('worker script failed to load');

        await expect(inFlight).rejects.toMatchObject({ code: 'endpoint_unavailable' });
        // A later request fails fast rather than reconnecting to a broken script.
        await expect(availability.client.status()).rejects.toMatchObject({
            code: 'endpoint_unavailable',
        });
        expect(connect).toHaveBeenCalledTimes(1);
    });

    it('keeps the packaged SharedWorker a lazy per-tab singleton for every resolution', async () => {
        // The packaged SharedWorker boundary, observed through the real
        // `connectPackagedBrowserIrohWorker` path: constructions and posted
        // commands are recorded, and every command is answered with a canned
        // error reply so no caller hangs on a silent port.
        const constructions: { url: string }[] = [];
        const commandsByPort: { kind: string }[][] = [];
        class RecordingSharedWorker {
            onerror: ((event: unknown) => void) | null = null;
            readonly port: {
                postMessage: (message: unknown) => void;
                addEventListener: (
                    type: string,
                    listener: (event: { data: unknown }) => void,
                ) => void;
            };

            constructor(scriptUrl: string, _options?: { type?: 'module'; name?: string }) {
                constructions.push({ url: scriptUrl });
                const commands: { kind: string }[] = [];
                commandsByPort.push(commands);
                let listener: ((event: { data: unknown }) => void) | null = null;
                this.port = {
                    postMessage: (message) => {
                        const command = message as { kind: string; requestId: string };
                        commands.push({ kind: command.kind });
                        listener?.({
                            data: {
                                v: 1,
                                kind: 'error',
                                requestId: command.requestId,
                                code: 'endpoint_unavailable',
                                message: 'recording stub has no endpoint',
                            },
                        });
                    },
                    addEventListener: (_type, attached) => {
                        listener = attached;
                    },
                };
            }
        }
        vi.stubGlobal('SharedWorker', RecordingSharedWorker);
        vi.stubGlobal('location', { href: 'https://app.example.test/session' });
        resetPackagedBrowserIrohEndpointClientForTests();
        try {
            // Merely resolving the singleton — like merely importing the
            // module — must construct no worker and open no port.
            const first = resolvePackagedBrowserIrohEndpointClient();
            expect(constructions).toEqual([]);

            const second = resolvePackagedBrowserIrohEndpointClient();
            expect(second).toBe(first);
            expect(constructions).toEqual([]);

            // The first operation is what connects, exactly once, through the
            // packaged asset URL resolved from the document base.
            await expect(first.status()).rejects.toMatchObject({ name: 'BrowserIrohClientError' });
            expect(constructions).toHaveLength(1);
            expect(constructions[0]?.url).toBe(
                'https://app.example.test/vendor/iroh/happier-iroh-worker.js',
            );

            // Repeated resolution and later operations reuse the same client
            // and never construct a second SharedWorker port.
            await expect(resolvePackagedBrowserIrohEndpointClient().status())
                .rejects.toMatchObject({ name: 'BrowserIrohClientError' });
            await expect(first.acquireLease(['https://relay.happier.test']))
                .rejects.toMatchObject({ name: 'BrowserIrohClientError' });
            expect(constructions).toHaveLength(1);
            expect(commandsByPort[0]?.map((command) => command.kind)).toEqual([
                'status',
                'status',
                'acquireLease',
            ]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('fails the first command when the worker fails to load before any command was sent', async () => {
        // The failure listener is wired at construction, so a script that 404s
        // immediately — before this tab ever sent a command — still cannot turn
        // the first call into a silent hang.
        let fail: ((reason: string) => void) | null = null;
        const connect = vi.fn(
            (): BrowserIrohWorkerConnection => ({
                port: { postMessage: () => {}, addEventListener: () => {} },
                onFailure: (listener) => {
                    fail = listener;
                },
            }),
        );

        const availability = resolveBrowserIrohEndpointClient(connect, { eligible: true });
        if (!availability.available) throw new Error('expected an available client');

        const first = availability.client.acquireLease(['https://relay.happier.test']);
        fail!('browser Iroh worker script failed to load: vendor/iroh/happier-iroh-worker.js');

        await expect(first).rejects.toMatchObject({
            code: 'endpoint_unavailable',
            message: /failed to load/u,
        });
        // And the failure is remembered: later commands do not retry a broken
        // script.
        await expect(availability.client.releaseAll()).rejects.toMatchObject({
            code: 'endpoint_unavailable',
        });
        expect(connect).toHaveBeenCalledTimes(1);
    });
});
