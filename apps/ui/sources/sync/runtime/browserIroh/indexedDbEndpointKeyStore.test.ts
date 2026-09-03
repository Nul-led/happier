import { describe, expect, it } from 'vitest';

import { BROWSER_IROH_ENDPOINT_KEY_BYTES, BrowserIrohEndpointKeyError } from './endpointKey';
import {
    BROWSER_IROH_KEY_DATABASE,
    BROWSER_IROH_KEY_OBJECT_STORE,
    BROWSER_IROH_KEY_RECORD_ID,
    BrowserIrohEndpointKeyStoreBlockedError,
    createIndexedDbBrowserIrohEndpointKeyStore,
} from './indexedDbEndpointKeyStore';

/**
 * IndexedDB is a genuine platform boundary and Node has none, so this is the
 * smallest faithful stand-in: one named database holding one object store, with
 * the request, transaction, and lifecycle-event shape the adapter actually
 * drives. Like the real thing, a request that succeeds is not yet a completed
 * transaction, a stored or returned value is a structured clone rather than
 * the caller's own object, and a `deleteDatabase` that is blocked by another
 * connection never completes. Everything below the boundary — the record encoding, the
 * length rules, the read-or-mint decision — is the real implementation.
 */
type FakeRequest<T> = IDBRequest<T> & {
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onupgradeneeded: (() => void) | null;
    onblocked: (() => void) | null;
};

/**
 * A request in its pre-settled state. Like the platform's, it carries the
 * handler slots its caller assigns after it is returned and never fires before
 * that caller has had its synchronous chance to attach them.
 */
function createRequest<T>(result: T, error: Error | null = null): FakeRequest<T> {
    const request = { result, error } as unknown as FakeRequest<T>;
    request.onsuccess = null;
    request.onerror = null;
    request.onupgradeneeded = null;
    request.onblocked = null;
    return request;
}

function createFakeIndexedDb(options: {
    /** The `put` request fails instead of succeeding. */
    failPutRequest?: boolean;
    /** The `put` request succeeds but the transaction aborts instead of committing. */
    abortTransactionAfterPut?: boolean;
    /** The `deleteDatabase` request is blocked by another connection and never completes. */
    blockDelete?: boolean;
} = {}) {
    const databases = new Map<string, Map<string, Map<unknown, unknown>>>();
    /** The exact objects handed to `put`, kept by identity. */
    const putValues: unknown[] = [];
    /** The exact clones handed back from `get`, kept by identity. */
    const readValues: unknown[] = [];

    /**
     * The transaction shape the adapter awaits, with commit-time application:
     * a mutating request stages its change and only a transaction `complete`
     * applies it, while an abort — a scripted commit failure or a failed
     * request — drops the staged change, as IndexedDB rolls the write back.
     * One request per transaction in this adapter, so the transaction reaches
     * its outcome one microtask after its request settles, matching the real
     * event order (request success → complete, request error → abort).
     */
    function fakeTransaction(store: Map<unknown, unknown>) {
        const staged: (() => void)[] = [];
        let settled = false;
        const transaction = {
            error: null as Error | null,
            oncomplete: null as (() => void) | null,
            onabort: null as (() => void) | null,
            onerror: null as (() => void) | null,
            objectStore: () => objectStore,
            abort: () => finish('abort'),
        };
        const finish = (outcome: 'commit' | 'abort', error?: Error) => {
            if (settled) return;
            settled = true;
            queueMicrotask(() => {
                if (outcome === 'commit') {
                    for (const mutation of staged) mutation();
                }
                staged.length = 0;
                transaction.error = error ?? null;
                if (outcome === 'commit') transaction.oncomplete?.();
                else transaction.onabort?.();
            });
        };
        /**
         * Issues one request against this transaction: it settles a microtask
         * later through whichever handler the adapter attached, and the
         * transaction then reaches its own outcome.
         */
        const issue = <T>(
            result: T,
            input: {
                /** Applied to the store only if the transaction commits. */
                stage?: () => void;
                /** The request itself fails, which aborts the transaction. */
                failWith?: Error;
                /** The request succeeds but the commit fails. */
                commitFailure?: Error;
            } = {},
        ): IDBRequest<T> => {
            const request = createRequest(result, input.failWith ?? null);
            queueMicrotask(() => {
                if (input.failWith) {
                    request.onerror?.();
                    finish('abort', input.failWith);
                    return;
                }
                if (input.stage) staged.push(input.stage);
                request.onsuccess?.();
                if (input.commitFailure) finish('abort', input.commitFailure);
                else finish('commit');
            });
            return request;
        };
        const objectStore = {
            get: (key: unknown) => {
                // A read deserializes its own value; the caller never receives
                // the stored object itself.
                const deserialized = structuredClone(store.get(key));
                readValues.push(deserialized);
                return issue(deserialized);
            },
            put: (value: unknown, key: unknown) => {
                // `put` clones its value synchronously, so what the caller does
                // with its own object afterwards cannot change what is stored.
                putValues.push(value);
                const cloned = structuredClone(value);
                return options.failPutRequest
                    ? issue(undefined, { failWith: new Error('put refused') })
                    : issue(key, {
                        stage: () => {
                            store.set(key, cloned);
                        },
                        commitFailure: options.abortTransactionAfterPut
                            ? new Error('commit failed')
                            : undefined,
                    });
            },
            delete: (key: unknown) =>
                issue(undefined, {
                    stage: () => {
                        store.delete(key);
                    },
                }),
        } as unknown as IDBObjectStore;
        return transaction as unknown as IDBTransaction;
    }

    const factory = {
        open: (name: string) => {
            const stores = databases.get(name) ?? new Map<string, Map<unknown, unknown>>();
            databases.set(name, stores);

            const database = {
                objectStoreNames: {
                    contains: (storeName: string) => stores.has(storeName),
                },
                createObjectStore: (storeName: string) => {
                    stores.set(storeName, new Map());
                },
                transaction: (_storeName: string, _mode: IDBTransactionMode) =>
                    fakeTransaction(stores.get(BROWSER_IROH_KEY_OBJECT_STORE)!),
                close: () => {},
            } as unknown as IDBDatabase;

            const request = createRequest(database);
            queueMicrotask(() => {
                // A database missing its store upgrades before it opens, so the
                // store exists by the time a transaction starts — the real
                // ordering the adapter's `onupgradeneeded` depends on.
                if (!stores.has(BROWSER_IROH_KEY_OBJECT_STORE)) request.onupgradeneeded?.();
                request.onsuccess?.();
            });
            return request as unknown as IDBOpenDBRequest;
        },
        deleteDatabase: (name: string) => {
            const request = createRequest(undefined);
            queueMicrotask(() => {
                if (options.blockDelete) {
                    // Another connection still holds the database: the request
                    // fires `blocked` and never completes, so the database
                    // survives.
                    request.onblocked?.();
                    return;
                }
                databases.delete(name);
                request.onsuccess?.();
            });
            return request as unknown as IDBOpenDBRequest;
        },
    } as unknown as IDBFactory;

    return {
        factory,
        putValues,
        readValues,
        peek: () =>
            databases.get(BROWSER_IROH_KEY_DATABASE)?.get(BROWSER_IROH_KEY_OBJECT_STORE)
                ?.get(BROWSER_IROH_KEY_RECORD_ID),
        hasDatabase: () => databases.has(BROWSER_IROH_KEY_DATABASE),
        seed: (record: unknown) => {
            const stores = databases.get(BROWSER_IROH_KEY_DATABASE) ?? new Map();
            const store = stores.get(BROWSER_IROH_KEY_OBJECT_STORE) ?? new Map();
            store.set(BROWSER_IROH_KEY_RECORD_ID, record);
            stores.set(BROWSER_IROH_KEY_OBJECT_STORE, store);
            databases.set(BROWSER_IROH_KEY_DATABASE, stores);
        },
    };
}

const KEY = new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(23);

/** The seed bytes inside a record the adapter handed to, or took from, the fake. */
function seedBytesOf(record: unknown): Uint8Array {
    const key = (record as { key?: unknown } | undefined)?.key;
    if (!(key instanceof Uint8Array)) throw new Error('record carries no seed bytes');
    return key;
}

function isWiped(bytes: Uint8Array): boolean {
    return bytes.every((byte) => byte === 0);
}

describe('sync/runtime/browserIroh/indexedDbEndpointKeyStore', () => {
    it('round-trips the one endpoint key across store instances, as a reload does', async () => {
        const fake = createFakeIndexedDb();

        await createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).write(KEY);
        // A reload builds a new adapter over the same origin database.
        const read = await createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).read();

        expect(read).toEqual(KEY);
    });

    it('reports an empty store as missing rather than as an error', async () => {
        const fake = createFakeIndexedDb();

        await expect(createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).read()).resolves.toBeNull();
    });

    it('rejects a stored record it did not write', async () => {
        const fake = createFakeIndexedDb();
        fake.seed({ v: 1, key: new Uint8Array(8) });

        await expect(
            createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).read(),
        ).rejects.toBeInstanceOf(BrowserIrohEndpointKeyError);
    });

    it('removes the record and the database on an explicit clear', async () => {
        const fake = createFakeIndexedDb();
        const store = createIndexedDbBrowserIrohEndpointKeyStore(fake.factory);
        await store.write(KEY);

        await store.clear();

        expect(fake.hasDatabase()).toBe(false);
        await expect(createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).read()).resolves.toBeNull();
    });

    it('resolves a write only after its transaction has committed, not when the request succeeds', async () => {
        // A successful `put` request whose transaction then aborts must not be
        // reported as a persisted key: the caller would trust identity material
        // that was never written.
        const fake = createFakeIndexedDb({ abortTransactionAfterPut: true });

        await expect(
            createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).write(KEY),
        ).rejects.toThrow(/commit failed/u);
        expect(fake.peek()).toBeUndefined();
    });

    it('rejects a write whose request fails instead of reporting it persisted', async () => {
        const fake = createFakeIndexedDb({ failPutRequest: true });

        await expect(
            createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).write(KEY),
        ).rejects.toThrow(/put refused/u);
        expect(fake.peek()).toBeUndefined();
    });

    it('reports a blocked database deletion as a failure, not as a completed clear', async () => {
        // Another tab still holds the database open. The record is already
        // gone, but the explicit application-data clear has not fully happened,
        // and reporting it as completed would hide exactly the state it exists
        // to remove.
        const fake = createFakeIndexedDb({ blockDelete: true });
        const store = createIndexedDbBrowserIrohEndpointKeyStore(fake.factory);
        await store.write(KEY);

        await expect(store.clear()).rejects.toBeInstanceOf(BrowserIrohEndpointKeyStoreBlockedError);
        // What did complete stays observable: the record itself is gone.
        expect(fake.peek()).toBeUndefined();
    });

    it('wipes the record it handed to IndexedDB once the write has committed', async () => {
        const fake = createFakeIndexedDb();
        const caller = new Uint8Array(BROWSER_IROH_ENDPOINT_KEY_BYTES).fill(23);

        await createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).write(caller);

        // The encoded record is this adapter's own copy and does not outlive
        // the commit that made the database's clone durable.
        expect(fake.putValues).toHaveLength(1);
        expect(isWiped(seedBytesOf(fake.putValues[0]))).toBe(true);
        // Wiping happened after the database took its clone, not before.
        expect(seedBytesOf(fake.peek())).toEqual(KEY);
        // The caller keeps custody of the buffer it passed in.
        expect(isWiped(caller)).toBe(false);
    });

    it('wipes the record it handed to IndexedDB when the write is rolled back', async () => {
        const fake = createFakeIndexedDb({ abortTransactionAfterPut: true });

        await expect(
            createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).write(KEY),
        ).rejects.toThrow(/commit failed/u);

        // Nothing was persisted, so nothing keeps this copy of the seed alive.
        expect(isWiped(seedBytesOf(fake.putValues[0]))).toBe(true);
        expect(fake.peek()).toBeUndefined();
    });

    it('wipes the deserialized record once the read has copied the key out', async () => {
        const fake = createFakeIndexedDb();
        const store = createIndexedDbBrowserIrohEndpointKeyStore(fake.factory);
        await store.write(KEY);

        const read = await store.read();

        expect(read).toEqual(KEY);
        // The buffer handed to the caller is independent of the deserialized
        // record, which is wiped as soon as that copy exists.
        expect(fake.readValues).toHaveLength(1);
        expect(isWiped(seedBytesOf(fake.readValues[0]))).toBe(true);
        expect(read).not.toBe(seedBytesOf(fake.readValues[0]));
        // Wiping a deserialized copy never reaches the durable record.
        await expect(store.read()).resolves.toEqual(KEY);
    });

    it('wipes the deserialized record it rejects as corrupt', async () => {
        const fake = createFakeIndexedDb();
        fake.seed({ v: 1, key: new Uint8Array(8).fill(4) });

        await expect(
            createIndexedDbBrowserIrohEndpointKeyStore(fake.factory).read(),
        ).rejects.toBeInstanceOf(BrowserIrohEndpointKeyError);

        // No caller received these bytes, and the failed read does not leave
        // them live either.
        expect(isWiped(seedBytesOf(fake.readValues[0]))).toBe(true);
    });
});
