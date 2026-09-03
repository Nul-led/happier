/**
 * The narrow Iroh-owned IndexedDB adapter for the one browser endpoint seed
 * (Lane 06 amendment A7.2, which authorizes exactly this one adapter behind the
 * key-store interface).
 *
 * It exists because the existing `deviceLocalStorage` owner cannot run where
 * this key must live. The endpoint owner runs inside a SharedWorker so that one
 * endpoint serves every tab; a worker global scope has no `window`, no
 * `localStorage`, and no React Native `Platform`, all of which that owner
 * reaches for. IndexedDB is the one device-local store the worker can use.
 *
 * This is origin-scoped local custody, not encryption at rest, not hardware
 * backing, and not protection against script running on the origin. It is a
 * private endpoint identity, not an authentication credential, and clearing site
 * data removes it — which is the documented behavior, not a defect.
 *
 * This adapter is deliberately not a storage framework: one database, one store,
 * one record, three operations.
 *
 * It holds the seed only inside the record shapes IndexedDB clones in and out,
 * and wipes each of those once its side of the custody transfer is done: after
 * a read has been decoded into the caller's own buffer, and after a write's
 * transaction has settled. That is bounded best-effort hygiene for these
 * copies, not erasure of the durable record — only `clear` removes that.
 */

import {
    decodeStoredBrowserIrohEndpointKey,
    encodeStoredBrowserIrohEndpointKey,
    type BrowserIrohEndpointKeyStore,
} from './endpointKey';

export const BROWSER_IROH_KEY_DATABASE = 'happier-browser-iroh-endpoint';
export const BROWSER_IROH_KEY_DATABASE_VERSION = 1;
export const BROWSER_IROH_KEY_OBJECT_STORE = 'endpointKey';
export const BROWSER_IROH_KEY_RECORD_ID = 'browser-endpoint-v1';

/**
 * The database could not be opened or deleted because another connection on
 * this origin holds it. This is a real incomplete state, not a completed one:
 * a blocked operation is reported as failed so a caller never mistakes "some
 * of the clear happened" for "the clear happened".
 */
export class BrowserIrohEndpointKeyStoreBlockedError extends Error {
    constructor(readonly operation: 'open' | 'delete') {
        super(
            `IndexedDB ${operation} of ${BROWSER_IROH_KEY_DATABASE} is blocked by another connection`,
        );
        this.name = 'BrowserIrohEndpointKeyStoreBlockedError';
    }
}

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

/**
 * Runs one unit of work in a transaction and settles only with the
 * transaction's own outcome. A request that succeeded is not yet a
 * transaction that committed: a mutating operation resolves on
 * `transaction.oncomplete` — after the data is actually durable — and rejects
 * on `onabort`/`onerror`, so a key can never be treated as persisted when its
 * write rolled back.
 */
function runTransaction<T>(
    transaction: IDBTransaction,
    use: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let result: T | undefined;
        let settled = false;
        const settle = (outcome: () => void) => {
            if (settled) return;
            settled = true;
            outcome();
        };
        transaction.oncomplete = () => settle(() => resolve(result as T));
        transaction.onabort = () =>
            settle(() =>
                reject(transaction.error ?? new Error('IndexedDB transaction aborted')));
        use(transaction.objectStore(BROWSER_IROH_KEY_OBJECT_STORE)).then(
            (value) => {
                // Completion, not this promise, decides the outcome.
                result = value;
            },
            (error: unknown) => {
                settle(() => reject(error instanceof Error ? error : new Error(String(error))));
                try {
                    transaction.abort();
                } catch {
                    // The transaction already finished; `onabort` decided.
                }
            },
        );
    });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = factory.open(BROWSER_IROH_KEY_DATABASE, BROWSER_IROH_KEY_DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(BROWSER_IROH_KEY_OBJECT_STORE)) {
                database.createObjectStore(BROWSER_IROH_KEY_OBJECT_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
        request.onblocked = () => reject(new BrowserIrohEndpointKeyStoreBlockedError('open'));
    });
}

async function withStore<T>(
    factory: IDBFactory,
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
    const database = await openDatabase(factory);
    try {
        const transaction = database.transaction(BROWSER_IROH_KEY_OBJECT_STORE, mode);
        return await runTransaction(transaction, use);
    } finally {
        database.close();
    }
}

function deleteDatabase(factory: IDBFactory): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = factory.deleteDatabase(BROWSER_IROH_KEY_DATABASE);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
        // Another tab still holding the database open means the explicit clear
        // has NOT completed: the record is gone, but the database — and with it
        // the storage an application-data clear removes — survives. Blocking is
        // reported as the failure it is rather than resolved away into a hang
        // or a false completion.
        request.onblocked = () => reject(new BrowserIrohEndpointKeyStoreBlockedError('delete'));
    });
}

/**
 * Wipes the seed bytes of a record this adapter owns outright: the value one
 * `get` deserialized for this call, or the record this adapter encoded for one
 * `put`. Both are private copies — IndexedDB clones values in and out — so
 * clearing them never reaches the durable record or the caller's buffer. A
 * value carrying no seed bytes is simply nothing to wipe.
 */
function wipeRecordSeedBytes(record: unknown): void {
    if (typeof record !== 'object' || record === null) return;
    const key = (record as { key?: unknown }).key;
    if (key instanceof Uint8Array) key.fill(0);
}

export function createIndexedDbBrowserIrohEndpointKeyStore(
    factory: IDBFactory,
): BrowserIrohEndpointKeyStore {
    return {
        read: async () => {
            const raw = await withStore(factory, 'readonly', (store) =>
                awaitRequest<unknown>(store.get(BROWSER_IROH_KEY_RECORD_ID)));
            try {
                // Decoding copies the seed out, and custody of that copy passes
                // to the caller.
                return decodeStoredBrowserIrohEndpointKey(raw ?? null);
            } finally {
                // Either the caller now holds its own copy or the record was
                // rejected and nobody does; the deserialized one is spent.
                wipeRecordSeedBytes(raw);
            }
        },
        write: async (key) => {
            // The caller keeps custody of `key`. This record's copy is the
            // adapter's, and IndexedDB clones it synchronously at `put`, so it
            // is wiped once the transaction has settled — committed, so the
            // durable clone carries the seed, or rolled back, so nothing does.
            const record = encodeStoredBrowserIrohEndpointKey(key);
            try {
                await withStore(factory, 'readwrite', (store) =>
                    awaitRequest(store.put(record, BROWSER_IROH_KEY_RECORD_ID)));
            } finally {
                wipeRecordSeedBytes(record);
            }
        },
        clear: async () => {
            await withStore(factory, 'readwrite', (store) =>
                awaitRequest(store.delete(BROWSER_IROH_KEY_RECORD_ID)));
            await deleteDatabase(factory);
        },
    };
}
