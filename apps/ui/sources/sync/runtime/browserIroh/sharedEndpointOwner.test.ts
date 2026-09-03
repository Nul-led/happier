import { describe, expect, it, vi } from 'vitest';

import { resolveWebSyncClientIdentity } from '@/sync/runtime/webSyncClientIdentity';

import {
    createBrowserIrohSharedEndpointOwner,
    type BrowserIrohEndpointBinder,
    type BrowserIrohEndpointHandle,
} from './sharedEndpointOwner';
import { BROWSER_IROH_ENDPOINT_KEY_BYTES, type BrowserIrohEndpointKeyStore } from './endpointKey';

const RELAY_A = 'https://relay-a.happier.test';
const RELAY_B = 'https://relay-b.happier.test';

/**
 * The device-local persistence boundary, kept in memory so a test can model the
 * three lifetimes the contract cares about: a tab reload (a new owner over the
 * same store), a browser reload (same), and an explicit application-data clear
 * (the store is emptied).
 */
function createMemoryKeyStore(initial?: Uint8Array | null) {
    let stored: Uint8Array | null = initial ? new Uint8Array(initial) : null;
    let clears = 0;
    const store: BrowserIrohEndpointKeyStore = {
        read: async () => (stored === null ? null : new Uint8Array(stored)),
        write: async (key) => {
            stored = new Uint8Array(key);
        },
        clear: async () => {
            clears += 1;
            stored = null;
        },
    };
    return {
        store,
        peek: () => stored,
        clears: () => clears,
    };
}

/**
 * Stands in for the wasm probe. Endpoint identity is derived from the seed the
 * owner supplies, which is exactly the property the singleton and continuity
 * rules depend on: a rotated key produces a different EndpointId, and a rebind
 * shows up as a second bind.
 */
/**
 * Relay sets this fake treats as invalid, so a test can script the core's
 * fail-closed validation of one contribution. The real grammar lives in
 * `happier-iroh-core`; here one marker entry stands in for it.
 */
const INVALID_RELAY = 'https://user:secret@relay.happier.invalid';

const unavailableTestStream: BrowserIrohEndpointHandle['openStream'] = async () => {
    throw new Error('stream boundary is not configured by this test');
};

function createRecordingBinder() {
    const binds: { secretKey: Uint8Array; relayUrls: readonly string[] }[] = [];
    const handles: (BrowserIrohEndpointHandle & { closed: () => boolean })[] = [];

    const bindEndpoint: BrowserIrohEndpointBinder = async ({ secretKey, relayUrls }) => {
        binds.push({ secretKey: new Uint8Array(secretKey), relayUrls: [...relayUrls] });
        // The core's `ensure_relay_urls` is a union: applying a contribution
        // never evicts what the endpoint already has. This fake mirrors that
        // one behavior so the owner is not tempted to union on its own side.
        let applied = [...relayUrls];
        let closed = false;
        const handle = {
            endpointId: `endpoint-${Array.from(secretKey.slice(0, 4)).join('-')}`,
            appliedRelayUrls: () => [...applied],
            applyRelayUrls: async (next: readonly string[]) => {
                // The core validates the whole contribution before applying
                // any of it; a malformed set fails without changing state.
                if (next.includes(INVALID_RELAY)) {
                    throw new Error('InvalidDescriptor');
                }
                for (const url of next) {
                    if (!applied.includes(url)) applied.push(url);
                }
            },
            openStream: unavailableTestStream,
            closeConnection: async () => {},
            close: async () => {
                closed = true;
            },
            closed: () => closed,
        };
        handles.push(handle);
        return handle;
    };

    return { bindEndpoint, binds, handles };
}

function createOwnerHarness(options?: { keyStore?: BrowserIrohEndpointKeyStore; seedByte?: number }) {
    const memory = createMemoryKeyStore();
    const keyStore = options?.keyStore ?? memory.store;
    const binder = createRecordingBinder();
    let leaseCounter = 0;
    const owner = createBrowserIrohSharedEndpointOwner({
        keyStore,
        randomBytes: (length) => new Uint8Array(length).fill(options?.seedByte ?? 7),
        bindEndpoint: binder.bindEndpoint,
        newLeaseId: () => `lease-${(leaseCounter += 1)}`,
    });
    return { owner, binder, memory, keyStore };
}

describe('sync/runtime/browserIroh/sharedEndpointOwner', () => {
    it('keeps stream custody with the owning client and bounds incremental I/O', async () => {
        const memory = createMemoryKeyStore();
        const calls: string[] = [];
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async (maxBytes) => {
                        calls.push(`read:${maxBytes}`);
                        return { bytes: new Uint8Array([1, 2]), done: false };
                    },
                    write: async (bytes) => {
                        calls.push(`write:${bytes.byteLength}`);
                    },
                    finishWrite: async () => {
                        calls.push('finish');
                    },
                    cancel: () => {
                        calls.push('cancel');
                    },
                    close: async () => {
                        calls.push('close');
                    },
                }),
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-1',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const stream = await owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'home',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });

        expect(stream).toEqual({
            streamId: 'stream-1',
            remoteEndpointId: 'endpoint-remote',
            observedPath: 'relay',
        });
        await expect(owner.readStream({ clientId: 'tab-b', streamId: stream.streamId, maxBytes: 16 }))
            .rejects.toMatchObject({ code: 'unknown_stream' });
        await expect(owner.readStream({ clientId: 'tab-a', streamId: stream.streamId, maxBytes: 0 }))
            .rejects.toMatchObject({ code: 'resource_limit' });
        await expect(owner.writeStream({
            clientId: 'tab-a',
            streamId: stream.streamId,
            bytes: new Uint8Array(1024 * 1024 + 1),
        })).rejects.toMatchObject({ code: 'resource_limit' });

        await expect(owner.readStream({ clientId: 'tab-a', streamId: stream.streamId, maxBytes: 16 }))
            .resolves.toEqual({ bytes: new Uint8Array([1, 2]), done: false });
        await owner.writeStream({ clientId: 'tab-a', streamId: stream.streamId, bytes: new Uint8Array([7]) });
        await owner.finishStreamWrite({ clientId: 'tab-a', streamId: stream.streamId });
        expect(calls).toEqual(['read:16', 'write:1', 'finish']);
    });

    it('cancels owned streams on lease release and clear, with idempotent close', async () => {
        const memory = createMemoryKeyStore();
        let cancels = 0;
        let closes = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => await new Promise<never>(() => {}),
                    write: async () => {},
                    finishWrite: async () => {},
                    cancel: () => { cancels += 1; },
                    close: async () => { closes += 1; },
                }),
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-1',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const stream = await owner.openStream({
            clientId: 'tab-a', leaseId: lease.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });
        const heldRead = owner.readStream({ clientId: 'tab-a', streamId: stream.streamId, maxBytes: 16 });

        await leaseRelease(owner, lease.leaseId);
        await expect(heldRead).rejects.toMatchObject({ code: 'cancelled' });
        await expect(owner.closeStream({ clientId: 'tab-a', streamId: stream.streamId })).resolves.toBeUndefined();
        await expect(owner.closeStream({ clientId: 'tab-a', streamId: stream.streamId })).resolves.toBeUndefined();
        expect(cancels).toBe(1);
        expect(closes).toBe(1);

        const secondLease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a', leaseId: secondLease.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });
        await owner.clearApplicationData();
        expect(cancels).toBe(2);
        expect(closes).toBe(2);

        async function leaseRelease(
            target: ReturnType<typeof createBrowserIrohSharedEndpointOwner>,
            leaseId: string,
        ): Promise<void> {
            await target.releaseLease({ clientId: 'tab-a', leaseId });
        }
    });

    it('cannot resurrect a stream whose open settles after endpoint clear', async () => {
        const memory = createMemoryKeyStore();
        let releaseOpen: (() => void) | null = null;
        const openGate = new Promise<void>((resolve) => {
            releaseOpen = resolve;
        });
        let openStarted = false;
        let cancels = 0;
        let closes = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => {
                    openStarted = true;
                    await openGate;
                    return {
                        remoteEndpointId: endpointId,
                        observedPath: 'relay',
                        read: async () => ({ bytes: new Uint8Array(), done: true }),
                        write: async () => {},
                        finishWrite: async () => {},
                        cancel: () => { cancels += 1; },
                        close: async () => { closes += 1; },
                    };
                },
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-must-not-exist',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const opening = owner.openStream({
            clientId: 'tab-a', leaseId: lease.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });
        const openingRejected = expect(opening).rejects.toMatchObject({ code: 'owner_cleared' });
        await vi.waitFor(() => expect(openStarted).toBe(true));

        await owner.clearApplicationData();
        releaseOpen!();

        await openingRejected;
        expect(cancels).toBe(1);
        expect(closes).toBe(1);
        await expect(owner.closeStream({ clientId: 'tab-a', streamId: 'stream-must-not-exist' }))
            .resolves.toBeUndefined();
    });

    it('retains a late-opened stream whose close fails and retries it on the next lease release', async () => {
        const memory = createMemoryKeyStore();
        let releaseOpen: (() => void) | null = null;
        const openGate = new Promise<void>((resolve) => {
            releaseOpen = resolve;
        });
        let openStarted = false;
        let cancels = 0;
        let closeAttempts = 0;
        let connectionCloses = 0;
        let connectionLive = false;
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => {
                    openStarted = true;
                    await openGate;
                    connectionLive = true;
                    return {
                        remoteEndpointId: endpointId,
                        observedPath: 'relay',
                        read: async () => ({ bytes: new Uint8Array(), done: true }),
                        write: async () => {},
                        finishWrite: async () => {},
                        cancel: () => { cancels += 1; },
                        close: async () => {
                            closeAttempts += 1;
                            if (closeAttempts === 1) throw new Error('stream close exploded');
                        },
                    };
                },
                closeConnection: async () => {
                    if (!connectionLive) return;
                    connectionLive = false;
                    connectionCloses += 1;
                },
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-late',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const opening = owner.openStream({
            clientId: 'tab-a', leaseId: lease.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });
        await vi.waitFor(() => expect(openStarted).toBe(true));

        await owner.releaseLease({ clientId: 'tab-a', leaseId: lease.leaseId });
        releaseOpen!();

        await expect(opening).rejects.toThrow('stream close exploded');
        expect(cancels).toBe(1);
        expect(closeAttempts).toBe(1);
        expect(connectionCloses).toBe(0);

        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: lease.leaseId }))
            .resolves.toBeUndefined();
        expect(cancels).toBe(1);
        expect(closeAttempts).toBe(2);
        expect(connectionCloses).toBe(1);
    });

    it('retries a failed late-open stream close at the next terminal clear attempt', async () => {
        const memory = createMemoryKeyStore();
        let releaseOpen: (() => void) | null = null;
        const openGate = new Promise<void>((resolve) => {
            releaseOpen = resolve;
        });
        let openStarted = false;
        let closeAttempts = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => {
                    openStarted = true;
                    await openGate;
                    return {
                        remoteEndpointId: endpointId,
                        observedPath: 'relay',
                        read: async () => ({ bytes: new Uint8Array(), done: true }),
                        write: async () => {},
                        finishWrite: async () => {},
                        cancel: () => {},
                        close: async () => {
                            closeAttempts += 1;
                            if (closeAttempts === 1) throw new Error('late clear close exploded');
                        },
                    };
                },
                closeConnection: async () => {},
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-late-clear',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const opening = owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'home',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });
        await vi.waitFor(() => expect(openStarted).toBe(true));

        await owner.clearApplicationData();
        releaseOpen!();
        await expect(opening).rejects.toThrow('late clear close exploded');

        await expect(owner.clearApplicationData()).resolves.toBeUndefined();
        expect(closeAttempts).toBe(2);
    });

    it('closes a target connection after its final owning lease and redials on later use', async () => {
        const memory = createMemoryKeyStore();
        let leaseCounter = 0;
        let streamCounter = 0;
        let dials = 0;
        let connectionLive = false;
        const connectionCloses: string[] = [];
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ streamKind, endpointId }) => {
                    if (!connectionLive) {
                        connectionLive = true;
                        dials += 1;
                    }
                    return {
                        remoteEndpointId: endpointId,
                        observedPath: 'relay',
                        read: async () => ({ bytes: new Uint8Array(), done: true }),
                        write: async () => {},
                        finishWrite: async () => {},
                        cancel: () => {},
                        close: async () => {},
                    };
                },
                closeConnection: async ({ streamKind, endpointId }) => {
                    connectionCloses.push(`${streamKind}:${endpointId}`);
                    connectionLive = false;
                },
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
            newStreamId: () => `stream-${(streamCounter += 1)}`,
        });
        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const sibling = await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });
        for (const [clientId, leaseId] of [['tab-a', first.leaseId], ['tab-b', sibling.leaseId]] as const) {
            await owner.openStream({
                clientId,
                leaseId,
                streamKind: 'home',
                endpointId: 'endpoint-remote',
                relayUrls: [RELAY_A],
            });
        }

        await owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId });
        expect(connectionCloses).toEqual([]);
        expect(dials).toBe(1);

        await owner.releaseLease({ clientId: 'tab-b', leaseId: sibling.leaseId });
        expect(connectionCloses).toEqual(['home:endpoint-remote']);

        const later = await owner.acquireLease({ clientId: 'tab-c', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-c',
            leaseId: later.leaseId,
            streamKind: 'home',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });
        expect(dials).toBe(2);
    });

    it('closes the connection when its final sibling leases release concurrently', async () => {
        const memory = createMemoryKeyStore();
        let leaseCounter = 0;
        let streamCounter = 0;
        let connectionCloses = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => ({ bytes: new Uint8Array(), done: true }),
                    write: async () => {},
                    finishWrite: async () => {},
                    cancel: () => {},
                    close: async () => {},
                }),
                closeConnection: async () => { connectionCloses += 1; },
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
            newStreamId: () => `stream-${(streamCounter += 1)}`,
        });
        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const second = await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a', leaseId: first.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });
        await owner.openStream({
            clientId: 'tab-b', leaseId: second.leaseId, streamKind: 'home', endpointId: 'endpoint-remote', relayUrls: [RELAY_A],
        });

        await Promise.all([
            owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId }),
            owner.releaseLease({ clientId: 'tab-b', leaseId: second.leaseId }),
        ]);

        expect(connectionCloses).toBe(1);
        expect(owner.status().leaseCount).toBe(0);
    });

    it('retains final-lease connection cleanup custody until close succeeds', async () => {
        const memory = createMemoryKeyStore();
        let closeAttempts = 0;
        const closedConnections: string[] = [];
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: async ({ endpointId }) => ({
                    remoteEndpointId: endpointId,
                    observedPath: 'relay',
                    read: async () => ({ bytes: new Uint8Array(), done: true }),
                    write: async () => {},
                    finishWrite: async () => {},
                    cancel: () => {},
                    close: async () => {},
                }),
                closeConnection: async ({ streamKind, endpointId }) => {
                    closeAttempts += 1;
                    closedConnections.push(`${streamKind}:${endpointId}`);
                    if (closeAttempts === 1) throw new Error('connection close exploded');
                },
                close: async () => {},
            }),
            newLeaseId: () => 'lease-1',
            newStreamId: () => 'stream-1',
        });
        const lease = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.openStream({
            clientId: 'tab-a',
            leaseId: lease.leaseId,
            streamKind: 'machine',
            endpointId: 'endpoint-remote',
            relayUrls: [RELAY_A],
        });

        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: lease.leaseId }))
            .rejects.toThrow('connection close exploded');
        expect(owner.status().leaseCount).toBe(1);

        await expect(owner.releaseLease({ clientId: 'tab-a', leaseId: lease.leaseId }))
            .resolves.toBeUndefined();
        expect(closeAttempts).toBe(2);
        expect(closedConnections).toEqual([
            'machine:endpoint-remote',
            'machine:endpoint-remote',
        ]);
        expect(owner.status().leaseCount).toBe(0);
    });

    it('is required because the existing per-tab sync identity diverges across tabs', () => {
        // Characterisation of the owner this slice must NOT reuse. `webSyncClientIdentity`
        // is deliberately session-scoped: two tabs of the same profile get two identities,
        // and a reload of one does not reunite them. That is correct for socket instance
        // accounting and disqualifying for a single browser Iroh endpoint.
        const localStorage = new Map<string, string>();
        const asStorage = (map: Map<string, string>) => ({
            getItem: (key: string) => map.get(key) ?? null,
            setItem: (key: string, value: string) => {
                map.set(key, value);
            },
            removeItem: (key: string) => {
                map.delete(key);
            },
        });
        let counter = 0;
        const randomUUID = () => `id-${(counter += 1)}`;
        const shared = asStorage(localStorage);

        const tabA = resolveWebSyncClientIdentity({
            sessionStorage: asStorage(new Map()),
            localStorage: shared,
            nowMs: 1_000,
            liveTtlMs: 60_000,
            randomUUID,
            navigationType: 'navigate',
        });
        const tabB = resolveWebSyncClientIdentity({
            sessionStorage: asStorage(new Map()),
            localStorage: shared,
            nowMs: 1_000,
            liveTtlMs: 60_000,
            randomUUID,
            navigationType: 'navigate',
        });

        expect(tabA.instanceId).not.toBe(tabB.instanceId);
    });

    it('serves two clients from one endpoint and one EndpointId', async () => {
        const { owner, binder } = createOwnerHarness();

        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const second = await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });

        expect(binder.binds).toHaveLength(1);
        expect(second.endpointId).toBe(first.endpointId);
        expect(first.leaseId).not.toBe(second.leaseId);
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 2 });
    });

    it('binds exactly one endpoint when two clients acquire concurrently', async () => {
        const { owner, binder } = createOwnerHarness();

        const [first, second] = await Promise.all([
            owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] }),
            owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_B] }),
        ]);

        expect(binder.binds).toHaveLength(1);
        expect(first.endpointId).toBe(second.endpointId);
    });

    it('keeps the sibling client live when one client releases', async () => {
        const { owner, binder } = createOwnerHarness();

        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });

        await owner.releaseClient('tab-a');

        expect(binder.handles[0]!.closed()).toBe(false);
        expect(owner.status()).toMatchObject({
            state: 'ready',
            endpointId: first.endpointId,
            leaseCount: 1,
        });
    });

    it('keeps the endpoint and the key after the last client releases, as a logout would', async () => {
        const { owner, binder, memory } = createOwnerHarness();

        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId });

        expect(binder.handles[0]!.closed()).toBe(false);
        expect(memory.clears()).toBe(0);
        expect(memory.peek()).not.toBeNull();
        expect(owner.status()).toMatchObject({
            state: 'ready',
            endpointId: first.endpointId,
            leaseCount: 0,
        });
    });

    it('adopts a second Home relay set without rotating the key or replacing the endpoint', async () => {
        const { owner, binder } = createOwnerHarness();

        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const configured = await owner.configureRelays([RELAY_B]);

        expect(binder.binds).toHaveLength(1);
        expect(configured.endpointId).toBe(first.endpointId);
        // A union: adopting a second Home never evicts the first Home's relay.
        expect(configured.appliedRelayUrls).toEqual([RELAY_A, RELAY_B]);
    });

    it('retains the EndpointId across a reload, which builds a new owner over the same store', async () => {
        const memory = createMemoryKeyStore();
        const before = createOwnerHarness({ keyStore: memory.store });
        const first = await before.owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        // A reload discards every in-memory owner but not the device-local record.
        const after = createOwnerHarness({ keyStore: memory.store, seedByte: 99 });
        const reloaded = await after.owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        expect(reloaded.endpointId).toBe(first.endpointId);
        // The fresh owner's random source was never consulted: the persisted key won.
        expect(after.binder.binds[0]!.secretKey).toEqual(before.binder.binds[0]!.secretKey);
    });

    it('persists a newly minted key so the next load reuses it', async () => {
        const memory = createMemoryKeyStore();
        const { owner } = createOwnerHarness({ keyStore: memory.store });

        await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        expect(memory.peek()).toHaveLength(BROWSER_IROH_ENDPOINT_KEY_BYTES);
    });

    it('closes the endpoint and deletes the key on an explicit application-data clear', async () => {
        const { owner, binder, memory } = createOwnerHarness();

        await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.clearApplicationData();

        expect(binder.handles[0]!.closed()).toBe(true);
        expect(memory.clears()).toBe(1);
        expect(memory.peek()).toBeNull();
        expect(owner.status()).toMatchObject({ state: 'cleared', endpointId: null, leaseCount: 0 });

        await expect(
            owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] }),
        ).rejects.toMatchObject({ code: 'owner_cleared' });
    });

    it('fails closed when a relay-only acquire supplies no relay', async () => {
        const { owner, binder } = createOwnerHarness();

        await expect(
            owner.acquireLease({ clientId: 'tab-a', relayUrls: [] }),
        ).rejects.toMatchObject({ code: 'relay_required' });
        expect(binder.binds).toHaveLength(0);
    });

    it('does not let an invalid relay contribution poison a later valid acquisition', async () => {
        // Relay grammar and validation are the core's, reached through the bound
        // endpoint. The owner must contribute each caller's relay facts as they
        // arrive and retain none of them itself: an entry the core rejected must
        // not be re-sent by the next, valid acquisition.
        const { owner, binder } = createOwnerHarness();

        await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        await expect(
            owner.acquireLease({ clientId: 'tab-b', relayUrls: [INVALID_RELAY] }),
        ).rejects.toThrow(/InvalidDescriptor/u);
        // The rejected contribution cost no endpoint state and no lease.
        expect(binder.handles[0]!.closed()).toBe(false);
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 1 });

        const valid = await owner.acquireLease({ clientId: 'tab-c', relayUrls: [RELAY_B] });
        // Monotonic valid growth, as the core defines it: A was never evicted by
        // the rejected B, and the later valid contribution joined the set.
        expect(valid.appliedRelayUrls).toEqual([RELAY_A, RELAY_B]);
        expect(binder.binds).toHaveLength(1);
    });

    it('reaches the endpoint with a contribution made while the first bind was in flight', async () => {
        const { owner } = createOwnerHarness();

        const [first, second] = await Promise.all([
            owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] }),
            owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_B] }),
        ]);

        expect(second.endpointId).toBe(first.endpointId);
        // Both contributions reached the one endpoint; which one is observed
        // first depends on apply order, but the union is deterministic.
        expect([...first.appliedRelayUrls].sort()).toEqual([RELAY_A, RELAY_B].sort());
        expect([...second.appliedRelayUrls].sort()).toEqual([RELAY_A, RELAY_B].sort());
    });

    it('waits out an in-flight key creation so a clear cannot be undone by it', async () => {
        // The regression: a clear that resolves while an acquire is still
        // minting the key lets that acquire re-write the record after the
        // clear, resurrecting the identity an explicit application-data clear
        // removed.
        const memory = createMemoryKeyStore();
        let releaseWrite: (() => void) | null = null;
        const gatedWrite = new Promise<void>((resolve) => {
            releaseWrite = resolve;
        });
        let writes = 0;
        const keyStore: BrowserIrohEndpointKeyStore = {
            read: async () => (memory.peek() === null ? null : new Uint8Array(memory.peek()!)),
            write: async (key) => {
                writes += 1;
                await gatedWrite;
                await memory.store.write(key);
            },
            clear: memory.store.clear,
        };
        const { owner, binder } = createOwnerHarness({ keyStore });

        const acquiring = owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await vi.waitFor(() => expect(writes).toBe(1));

        const clearing = owner.clearApplicationData();
        releaseWrite!();
        await clearing;

        // The clear resolved after the in-flight operation fully settled, so
        // nothing could re-write the key behind it.
        expect(memory.peek()).toBeNull();
        expect(memory.clears()).toBe(1);
        await expect(acquiring).rejects.toMatchObject({ code: 'owner_cleared' });
        // The bound endpoint was never allowed to become live state.
        expect(binder.handles[0]!.closed()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(memory.peek()).toBeNull();
    });

    it('awaits the release of an endpoint whose first bind settles during the clear', async () => {
        // Regression guard for the fire-and-forget shape: when a bind settles
        // after a clear began, the clear must not resolve while that endpoint's
        // close is still running in the background.
        const memory = createMemoryKeyStore();
        const trace: string[] = [];
        let releaseBind: (() => void) | null = null;
        const bindGate = new Promise<void>((resolve) => {
            releaseBind = resolve;
        });
        let releaseClose: (() => void) | null = null;
        const closeGate = new Promise<void>((resolve) => {
            releaseClose = resolve;
        });
        let closeRequested = false;
        const bindEndpoint: BrowserIrohEndpointBinder = async () => {
            await bindGate;
            return {
                endpointId: 'endpoint-raced',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: unavailableTestStream,
                closeConnection: async () => {},
                close: async () => {
                    closeRequested = true;
                    await closeGate;
                    trace.push('closed');
                },
            };
        };
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: {
                read: async () => (memory.peek() === null ? null : new Uint8Array(memory.peek()!)),
                write: memory.store.write,
                clear: async () => {
                    trace.push('cleared');
                    await memory.store.clear();
                },
            },
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint,
        });

        const acquiring = owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        // This acquire loses the race by design and rejects while the clear is
        // still running, so its expectation is attached now rather than at the
        // end of the test: nothing is swallowed — the exact failure is awaited
        // below — but the rejection is never momentarily unhandled.
        const acquireRejected = expect(acquiring).rejects.toMatchObject({ code: 'owner_cleared' });
        const clearing = owner.clearApplicationData();

        releaseBind!();
        await vi.waitFor(() => expect(closeRequested).toBe(true));
        releaseClose!();
        await clearing;

        // The clear resolved only after the raced bind's endpoint was fully
        // released — 'closed' strictly before the store was cleared.
        expect(trace.indexOf('closed')).toBeGreaterThanOrEqual(0);
        expect(trace.indexOf('closed')).toBeLessThan(trace.indexOf('cleared'));
        expect(memory.peek()).toBeNull();
        await acquireRejected;
    });

    it('does not add a lease or report success for endpoint work that finishes after a clear', async () => {
        // An acquire that passed the live check before the clear but completes
        // after it must fail closed, not hand out a lease on a cleared owner.
        const memory = createMemoryKeyStore();
        let gateApplies = false;
        let releaseApply: (() => void) | null = null;
        const applyGate = new Promise<void>((resolve) => {
            releaseApply = resolve;
        });
        let gatedApplyStarted = false;
        let closes = 0;
        const bindEndpoint: BrowserIrohEndpointBinder = async () => ({
            endpointId: 'endpoint-live',
            appliedRelayUrls: () => [RELAY_A],
            applyRelayUrls: async () => {
                if (!gateApplies) return;
                gatedApplyStarted = true;
                await applyGate;
            },
            openStream: unavailableTestStream,
            closeConnection: async () => {},
            close: async () => {
                closes += 1;
            },
        });
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint,
        });

        await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        gateApplies = true;
        const second = owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });
        await vi.waitFor(() => expect(gatedApplyStarted).toBe(true));

        // The clear wins the race while the second acquire is parked on the
        // apply step; it must still resolve.
        await owner.clearApplicationData();
        releaseApply!();

        await expect(second).rejects.toMatchObject({ code: 'owner_cleared' });
        expect(owner.status()).toMatchObject({ state: 'cleared', leaseCount: 0 });
        expect(memory.peek()).toBeNull();
        expect(closes).toBe(1);
    });

    it('reports a failed release of a raced bind truthfully while still clearing the key', async () => {
        // A clear whose endpoint release fails is not a completed clear. It
        // must still remove the persistent key — both teardown steps are
        // attempted — and it must reject instead of resolving over the failure.
        const memory = createMemoryKeyStore();
        let releaseBind: (() => void) | null = null;
        const bindGate = new Promise<void>((resolve) => {
            releaseBind = resolve;
        });
        let releaseClose: (() => void) | null = null;
        const closeGate = new Promise<never>((_resolve, reject) => {
            releaseClose = () => reject(new Error('endpoint close exploded'));
        });
        let closeRequested = false;
        const bindEndpoint: BrowserIrohEndpointBinder = async () => {
            await bindGate;
            return {
                endpointId: 'endpoint-raced',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: unavailableTestStream,
                closeConnection: async () => {},
                close: async () => {
                    closeRequested = true;
                    await closeGate;
                },
            };
        };
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint,
        });

        const acquiring = owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        // Same reason as the raced-release test above: the acquire rejects
        // while the clear is still running, so its expectation is attached at
        // the moment the promise exists and awaited at the end.
        const acquireRejected = expect(acquiring).rejects.toMatchObject({ code: 'owner_cleared' });
        const clearing = owner.clearApplicationData();

        releaseBind!();
        await vi.waitFor(() => expect(closeRequested).toBe(true));
        releaseClose!();

        await expect(clearing).rejects.toThrow('endpoint close exploded');
        // The key clear was still attempted after the failed release.
        expect(memory.clears()).toBe(1);
        expect(memory.peek()).toBeNull();
        await acquireRejected;
    });

    it('refuses to let one client release a sibling client’s lease', async () => {
        // A lease id is not a capability another port may spend. Ports are
        // reachable by any script on the origin, and a guessed or observed id
        // must not let one tab drop the lease another tab is relying on.
        const { owner, binder } = createOwnerHarness();
        const held = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });

        await expect(
            owner.releaseLease({ clientId: 'tab-b', leaseId: held.leaseId }),
        ).rejects.toMatchObject({ code: 'unknown_lease' });

        // The refusal cost the owner nothing: the lease is still held and the
        // endpoint was never touched.
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 2 });
        expect(binder.handles[0]!.closed()).toBe(false);
        await owner.releaseLease({ clientId: 'tab-a', leaseId: held.leaseId });
        expect(owner.status()).toMatchObject({ leaseCount: 1 });
    });

    it('treats releasing an absent lease as the success the caller asked for', async () => {
        // A reload, a repeated release, and a release after `releaseClient`
        // all arrive at the same place: this client holds no such lease. That
        // is the requested outcome, not a failure to report.
        const { owner, binder } = createOwnerHarness();
        const held = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        await expect(
            owner.releaseLease({ clientId: 'tab-a', leaseId: 'lease-does-not-exist' }),
        ).resolves.toBeUndefined();

        await owner.releaseLease({ clientId: 'tab-a', leaseId: held.leaseId });
        // Repeating the exact same release is idempotent.
        await expect(
            owner.releaseLease({ clientId: 'tab-a', leaseId: held.leaseId }),
        ).resolves.toBeUndefined();
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 0 });
        expect(binder.handles[0]!.closed()).toBe(false);
    });

    it('is idempotent in both release orderings for one client', async () => {
        const { owner } = createOwnerHarness();
        const first = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.acquireLease({ clientId: 'tab-b', relayUrls: [RELAY_A] });

        // release → releaseAll: the lease is already gone when the sweep runs.
        await owner.releaseLease({ clientId: 'tab-a', leaseId: first.leaseId });
        await owner.releaseClient('tab-a');
        expect(owner.status()).toMatchObject({ leaseCount: 1 });

        // releaseAll → release: the sweep already took the lease this release
        // names, and naming it again still succeeds.
        const second = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await owner.releaseClient('tab-a');
        await expect(
            owner.releaseLease({ clientId: 'tab-a', leaseId: second.leaseId }),
        ).resolves.toBeUndefined();
        expect(owner.status()).toMatchObject({ state: 'ready', leaseCount: 1 });
    });

    it('attempts every dead-client lease when one sibling release fails', async () => {
        const memory = createMemoryKeyStore();
        const connectionReleaseAttempts: string[] = [];
        let leaseCounter = 0;
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint: async () => ({
                endpointId: 'endpoint-local',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: unavailableTestStream,
                closeConnection: async ({ endpointId }) => {
                    connectionReleaseAttempts.push(endpointId);
                    if (endpointId === 'endpoint-failing') throw new Error('release failed');
                },
                close: async () => {},
            }),
            newLeaseId: () => `lease-${(leaseCounter += 1)}`,
        });
        const failing = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const sibling = await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        await expect(owner.openStream({
            clientId: 'tab-a', leaseId: failing.leaseId, streamKind: 'home', endpointId: 'endpoint-failing', relayUrls: [RELAY_A],
        })).rejects.toThrow('stream boundary is not configured');
        await expect(owner.openStream({
            clientId: 'tab-a', leaseId: sibling.leaseId, streamKind: 'home', endpointId: 'endpoint-sibling', relayUrls: [RELAY_A],
        })).rejects.toThrow('stream boundary is not configured');

        await expect(owner.releaseClient('tab-a')).rejects.toThrow('release failed');

        expect(connectionReleaseAttempts).toEqual(['endpoint-failing', 'endpoint-sibling']);
        expect(owner.status()).toMatchObject({ leaseCount: 1 });
    });

    it('retains custody of a live endpoint whose close failed and retries it on the next clear', async () => {
        // A clear that could not release the endpoint has not finished. If the
        // owner drops the handle anyway, the endpoint is leaked with no caller
        // able to retry — so custody survives the failure and the next clear
        // closes the same handle.
        const memory = createMemoryKeyStore();
        const closedHandles: string[] = [];
        let closeAttempts = 0;
        const bindEndpoint: BrowserIrohEndpointBinder = async () => ({
            endpointId: 'endpoint-live',
            appliedRelayUrls: () => [RELAY_A],
            applyRelayUrls: async () => {},
            openStream: unavailableTestStream,
            closeConnection: async () => {},
            close: async () => {
                closeAttempts += 1;
                if (closeAttempts === 1) throw new Error('endpoint close exploded');
                closedHandles.push('endpoint-live');
            },
        });
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint,
        });

        await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        await expect(owner.clearApplicationData()).rejects.toThrow('endpoint close exploded');
        // The key deletion is still attempted, and the failure is reported
        // rather than swallowed into a completed clear.
        expect(memory.clears()).toBe(1);
        expect(closedHandles).toEqual([]);

        await expect(owner.clearApplicationData()).resolves.toBeUndefined();
        expect(closeAttempts).toBe(2);
        expect(closedHandles).toEqual(['endpoint-live']);
    });

    it('retains custody of a raced bind whose close failed and retries it on the next clear', async () => {
        // Same custody rule for the endpoint whose first bind settles after a
        // clear began: a failed release keeps the handle, not a spent promise.
        const memory = createMemoryKeyStore();
        let releaseBind: (() => void) | null = null;
        const bindGate = new Promise<void>((resolve) => {
            releaseBind = resolve;
        });
        let closeAttempts = 0;
        let closed = false;
        const bindEndpoint: BrowserIrohEndpointBinder = async () => {
            await bindGate;
            return {
                endpointId: 'endpoint-raced',
                appliedRelayUrls: () => [RELAY_A],
                applyRelayUrls: async () => {},
                openStream: unavailableTestStream,
                closeConnection: async () => {},
                close: async () => {
                    closeAttempts += 1;
                    if (closeAttempts === 1) throw new Error('endpoint close exploded');
                    closed = true;
                },
            };
        };
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint,
        });

        const acquiring = owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });
        const acquireRejected = expect(acquiring).rejects.toMatchObject({ code: 'owner_cleared' });
        const clearing = owner.clearApplicationData();
        releaseBind!();

        await expect(clearing).rejects.toThrow('endpoint close exploded');
        await vi.waitFor(() => expect(closeAttempts).toBe(1));

        await expect(owner.clearApplicationData()).resolves.toBeUndefined();
        expect(closeAttempts).toBe(2);
        expect(closed).toBe(true);
        await acquireRejected;
    });

    it('joins concurrent clears into one attempt so none of them reports a premature success', async () => {
        // Two tabs can ask for an application-data clear at the same time. A
        // caller that observed an already-emptied field and returned success
        // while the real teardown was still failing would be reporting a clear
        // that did not happen.
        const memory = createMemoryKeyStore();
        let releaseClose: (() => void) | null = null;
        const closeGate = new Promise<void>((resolve) => {
            releaseClose = resolve;
        });
        let closeAttempts = 0;
        const bindEndpoint: BrowserIrohEndpointBinder = async () => ({
            endpointId: 'endpoint-live',
            appliedRelayUrls: () => [RELAY_A],
            applyRelayUrls: async () => {},
            openStream: unavailableTestStream,
            closeConnection: async () => {},
            close: async () => {
                closeAttempts += 1;
                await closeGate;
                throw new Error('endpoint close exploded');
            },
        });
        const owner = createBrowserIrohSharedEndpointOwner({
            keyStore: memory.store,
            randomBytes: (length) => new Uint8Array(length).fill(7),
            bindEndpoint,
        });

        await owner.acquireLease({ clientId: 'tab-a', relayUrls: [RELAY_A] });

        let settled = 0;
        const first = owner.clearApplicationData().finally(() => {
            settled += 1;
        });
        const second = owner.clearApplicationData().finally(() => {
            settled += 1;
        });
        const firstRejected = expect(first).rejects.toThrow('endpoint close exploded');
        const secondRejected = expect(second).rejects.toThrow('endpoint close exploded');

        await vi.waitFor(() => expect(closeAttempts).toBe(1));
        // Neither caller resolved behind the still-running teardown.
        expect(settled).toBe(0);

        releaseClose!();
        await firstRejected;
        await secondRejected;
        // One attempt, one endpoint release, one key deletion — not two.
        expect(closeAttempts).toBe(1);
        expect(memory.clears()).toBe(1);
    });
});
