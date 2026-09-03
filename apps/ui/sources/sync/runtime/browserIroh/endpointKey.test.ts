import { describe, expect, it } from 'vitest';

import {
    BROWSER_IROH_ENDPOINT_KEY_BYTES,
    BrowserIrohEndpointKeyError,
    decodeStoredBrowserIrohEndpointKey,
    encodeStoredBrowserIrohEndpointKey,
    resolvePersistentBrowserIrohEndpointKey,
    type BrowserIrohEndpointKeyStore,
} from './endpointKey';

/**
 * A store that behaves like the real adapter at the custody boundary: a read
 * deserializes a fresh buffer the caller then owns, and a write copies the
 * bytes it is handed instead of retaining the caller's array. Every buffer it
 * hands out and every buffer handed to it is kept by identity, so a test can
 * see which intermediate arrays were still carrying seed bytes when the call
 * finished — the difference between wiping the whole chain and wiping only the
 * last buffer that reaches the binder.
 */
function createStore(initial: Uint8Array | null, options: { writeFailure?: Error } = {}) {
    let stored = initial === null ? null : new Uint8Array(initial);
    const handedOut: Uint8Array[] = [];
    const writes: Uint8Array[] = [];
    const store: BrowserIrohEndpointKeyStore = {
        read: async () => {
            if (stored === null) return null;
            const handed = new Uint8Array(stored);
            handedOut.push(handed);
            return handed;
        },
        write: async (key) => {
            writes.push(key);
            if (options.writeFailure) throw options.writeFailure;
            stored = new Uint8Array(key);
        },
        clear: async () => {
            stored = null;
        },
    };
    return { store, writes, handedOut, peek: () => stored };
}

function isWiped(bytes: Uint8Array): boolean {
    return bytes.every((byte) => byte === 0);
}

describe('sync/runtime/browserIroh/endpointKey', () => {
    it('mints and persists a key once, then reuses the persisted one', async () => {
        const { store, writes } = createStore(null);
        const randomBytes = (length: number) => new Uint8Array(length).fill(3);

        const first = await resolvePersistentBrowserIrohEndpointKey(store, randomBytes);
        expect(first).toHaveLength(BROWSER_IROH_ENDPOINT_KEY_BYTES);
        expect(writes).toHaveLength(1);

        const second = await resolvePersistentBrowserIrohEndpointKey(
            store,
            () => new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(9),
        );
        expect(second).toEqual(first);
        expect(writes).toHaveLength(1);
    });

    it('rejects a stored key of the wrong length rather than rotating the identity', async () => {
        const { store } = createStore(new Uint8Array(16).fill(1));

        await expect(
            resolvePersistentBrowserIrohEndpointKey(store, (length) => new Uint8Array(length)),
        ).rejects.toBeInstanceOf(BrowserIrohEndpointKeyError);
    });

    it('rejects an unusable random source instead of persisting a short key', async () => {
        const { store, peek } = createStore(null);

        await expect(
            resolvePersistentBrowserIrohEndpointKey(store, () => new Uint8Array(8)),
        ).rejects.toMatchObject({ code: 'random_source_unusable' });
        expect(peek()).toBeNull();
    });

    it('round-trips the stored record and rejects a corrupt one', () => {
        const key = new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(11);
        const record = encodeStoredBrowserIrohEndpointKey(key);

        expect(decodeStoredBrowserIrohEndpointKey(record)).toEqual(key);
        expect(decodeStoredBrowserIrohEndpointKey(null)).toBeNull();

        for (const corrupt of [
            { v: 2, key },
            { v: 1, key: new Uint8Array(4) },
            { v: 1, key: 'not-bytes' },
            'not-a-record',
        ]) {
            expect(() => decodeStoredBrowserIrohEndpointKey(corrupt)).toThrow(
                BrowserIrohEndpointKeyError,
            );
        }
    });

    it('encodes and decodes through independent buffers, each wiped by its own owner', () => {
        const key = new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(11);

        const record = encodeStoredBrowserIrohEndpointKey(key);
        expect(record.key).not.toBe(key);

        const decoded = decodeStoredBrowserIrohEndpointKey(record);
        expect(decoded).not.toBe(record.key);
        expect(decoded).toEqual(key);

        // Neither step wipes a buffer it does not own, and wiping the record's
        // copy cannot reach through to a buffer already handed to a caller.
        record.key.fill(0);
        expect(decoded).toEqual(key);
        expect(isWiped(key)).toBe(false);
    });

    it('hands the minted key to its caller without leaving a second live copy', async () => {
        const { store, writes, peek } = createStore(null);
        const minted = new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(3);

        const resolved = await resolvePersistentBrowserIrohEndpointKey(store, () => minted);

        // Custody moves to the caller: there is no leftover mint-time buffer
        // still holding the seed once this returns.
        expect(resolved).toBe(minted);
        expect(isWiped(resolved)).toBe(false);
        expect(writes[0]).toBe(minted);
        // The durable copy is the store's own, taken before any wipe.
        expect(peek()).toEqual(new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(3));
    });

    it('wipes the minted key when the write never persists it', async () => {
        const writeFailure = new Error('quota exceeded');
        const { store, peek } = createStore(null, { writeFailure });
        const minted = new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(3);

        await expect(
            resolvePersistentBrowserIrohEndpointKey(store, () => minted),
        ).rejects.toBe(writeFailure);

        // Nobody received this seed, so nothing keeps it alive.
        expect(isWiped(minted)).toBe(true);
        expect(peek()).toBeNull();
    });

    it('wipes an unusable random buffer instead of leaving short identity bytes live', async () => {
        const { store, peek } = createStore(null);
        const tooShort = new Uint8Array(8).fill(7);

        await expect(
            resolvePersistentBrowserIrohEndpointKey(store, () => tooShort),
        ).rejects.toMatchObject({ code: 'random_source_unusable' });

        expect(isWiped(tooShort)).toBe(true);
        expect(peek()).toBeNull();
    });

    it('takes custody of the stored key the store handed out, leaving no extra copy', async () => {
        const { store, handedOut } = createStore(
            new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(5),
        );

        const resolved = await resolvePersistentBrowserIrohEndpointKey(
            store,
            (length) => new Uint8Array(length),
        );

        expect(handedOut).toHaveLength(1);
        expect(resolved).toBe(handedOut[0]);
        expect(isWiped(resolved)).toBe(false);
    });

    it('wipes a rejected stored key rather than leaving corrupt identity bytes live', async () => {
        const { store, handedOut } = createStore(new Uint8Array(16).fill(1));

        await expect(
            resolvePersistentBrowserIrohEndpointKey(store, (length) => new Uint8Array(length)),
        ).rejects.toMatchObject({ code: 'stored_key_corrupt' });

        expect(handedOut).toHaveLength(1);
        expect(isWiped(handedOut[0]!)).toBe(true);
    });

    it('propagates a read rejection without minting a replacement identity', async () => {
        let mintCalls = 0;
        let writeCalls = 0;
        const store: BrowserIrohEndpointKeyStore = {
            read: async () => {
                throw new Error('indexeddb unavailable');
            },
            write: async () => {
                writeCalls += 1;
            },
            clear: async () => {},
        };

        await expect(
            resolvePersistentBrowserIrohEndpointKey(store, (length) => {
                mintCalls += 1;
                return new Uint8Array(length);
            }),
        ).rejects.toThrow('indexeddb unavailable');

        // A read that produced no buffer must never fall through to minting:
        // silently rotating would change the EndpointId on a storage failure,
        // which is the exact continuity this module exists to establish. And
        // with no buffer resolved, there is nothing to write or to wipe.
        expect(mintCalls).toBe(0);
        expect(writeCalls).toBe(0);
    });
});
