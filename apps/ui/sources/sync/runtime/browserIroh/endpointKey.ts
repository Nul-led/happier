/**
 * The persisted browser Iroh endpoint identity (Lane 06 amendment A7.2).
 *
 * One 32-byte seed identifies the browser application/profile's single Iroh
 * endpoint. It is not per Home, per tab, per request, or per transfer, and it
 * survives tab reload, browser reload, and Home logout. Only an explicit
 * application-data clear removes it.
 *
 * This module owns the record shape and the read-or-mint rule. The storage
 * medium is injected, because the one place that may hold this key — the
 * cross-tab endpoint owner — runs inside a SharedWorker, where the existing
 * `deviceLocalStorage` owner cannot run at all: it reaches `localStorage` and
 * `react-native`'s `Platform`, and neither exists in a worker global scope.
 *
 * Seed custody: exactly one owner holds each mutable seed buffer at a time.
 * Custody moves at the boundaries below, and the previous owner wipes its
 * buffer once the next one holds an independent copy or the bytes are durably
 * committed — including on the failure paths, where nobody received them. This
 * is bounded best-effort memory hygiene for the buffers this module creates,
 * not a claim that the browser VM, its garbage collector, or the storage
 * medium can erase every historical copy of these bytes.
 */

export const BROWSER_IROH_ENDPOINT_KEY_BYTES = 32;

/** Device-local custody for the one endpoint seed. */
export type BrowserIrohEndpointKeyStore = Readonly<{
    /**
     * Resolves the stored seed, whose custody passes to the caller: it is a
     * buffer the store no longer holds, and the caller wipes it when done.
     */
    read: () => Promise<Uint8Array | null>;
    /**
     * Persists a copy of `key`. Custody of `key` stays with the caller; the
     * store wipes only the copy it made once that copy is committed or lost.
     */
    write: (key: Uint8Array) => Promise<void>;
    /** Explicit application-data clear. Never used for logout or lease release. */
    clear: () => Promise<void>;
}>;

export type StoredBrowserIrohEndpointKeyV1 = Readonly<{
    v: 1;
    key: Uint8Array;
}>;

export type BrowserIrohEndpointKeyFailureCode = 'stored_key_corrupt' | 'random_source_unusable';

export class BrowserIrohEndpointKeyError extends Error {
    constructor(readonly code: BrowserIrohEndpointKeyFailureCode) {
        super(`Browser Iroh endpoint key is unavailable (${code})`);
        this.name = 'BrowserIrohEndpointKeyError';
    }
}

/**
 * Builds the record from an independent copy, so the caller keeps custody of
 * its own buffer and the record's copy becomes the store's to wipe.
 */
export function encodeStoredBrowserIrohEndpointKey(key: Uint8Array): StoredBrowserIrohEndpointKeyV1 {
    if (key.length !== BROWSER_IROH_ENDPOINT_KEY_BYTES) {
        throw new BrowserIrohEndpointKeyError('random_source_unusable');
    }
    return { v: 1, key: new Uint8Array(key) };
}

/**
 * Reads one stored record. A record that exists but cannot be trusted is a
 * typed failure rather than a silent re-mint: silently rotating would change
 * the EndpointId every load, which is the exact continuity this slice exists to
 * establish.
 *
 * The returned buffer is independent of `raw`, so the owner of `raw` — the
 * store that deserialized it — decides when to wipe it, and may do so as soon
 * as this returns.
 */
export function decodeStoredBrowserIrohEndpointKey(raw: unknown): Uint8Array | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'object') throw new BrowserIrohEndpointKeyError('stored_key_corrupt');

    const record = raw as Partial<StoredBrowserIrohEndpointKeyV1>;
    if (record.v !== 1) throw new BrowserIrohEndpointKeyError('stored_key_corrupt');

    const key = record.key;
    if (!(key instanceof Uint8Array) || key.length !== BROWSER_IROH_ENDPOINT_KEY_BYTES) {
        throw new BrowserIrohEndpointKeyError('stored_key_corrupt');
    }
    return new Uint8Array(key);
}

/**
 * The one read-or-mint step. A stored key always wins; a freshly minted one is
 * written back before it is used, so the next load reuses it.
 *
 * Custody of the resolved buffer moves to the caller, which wipes it once it
 * has handed the seed to the endpoint binding. This step therefore keeps no
 * copy of its own: the buffer it received or minted *is* the one it returns, so
 * a successful resolve leaves no second live seed behind. Every path that does
 * not reach the caller — a stored key it rejects, an unusable random buffer, a
 * write that never persisted — wipes the bytes it is abandoning.
 */
export async function resolvePersistentBrowserIrohEndpointKey(
    store: BrowserIrohEndpointKeyStore,
    randomBytes: (length: number) => Uint8Array,
): Promise<Uint8Array> {
    const existing = await store.read();
    if (existing !== null) {
        if (existing.length !== BROWSER_IROH_ENDPOINT_KEY_BYTES) {
            existing.fill(0);
            throw new BrowserIrohEndpointKeyError('stored_key_corrupt');
        }
        return existing;
    }

    const created = randomBytes(BROWSER_IROH_ENDPOINT_KEY_BYTES);
    if (!(created instanceof Uint8Array) || created.length !== BROWSER_IROH_ENDPOINT_KEY_BYTES) {
        if (created instanceof Uint8Array) created.fill(0);
        throw new BrowserIrohEndpointKeyError('random_source_unusable');
    }
    try {
        // The store copies these bytes; custody of `created` stays here until
        // the write has durably committed and the key can be handed on.
        await store.write(created);
    } catch (error) {
        created.fill(0);
        throw error;
    }
    return created;
}
