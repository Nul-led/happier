import type { MemorySearchQueryV1, MemorySearchResultV1 } from '@happier-dev/protocol';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
    registerSessionTranscriptMutationObserver,
    type SessionTranscriptMutation,
} from '@/app/session/sessionTranscriptMutationObserver';
import {
    isPlainHomeStoragePolicy,
    resolveHomeSearchCapability,
    type HomeSearchCapability,
} from './homeSearchCapability';
import { openHomeSearchDb, type HomeSearchDb } from './homeSearchDb';
import { createHomeSearchIndexer, type HomeSearchCanonicalPageReader, type HomeSearchIndexer } from './homeSearchIndexer';
import { createHomeSearchService } from './homeSearchService';

type HomeSearchInvalidationReason = 'restore' | 'erase' | 'corruption' | 'explicit-repair';

export type HomeSearchLifecycle = Readonly<{
    capability(): HomeSearchCapability;
    search(query: MemorySearchQueryV1, context?: Readonly<{ visibleSessionIds?: readonly string[] }>): MemorySearchResultV1;
    start(): void;
    whenReady(): Promise<void>;
    invalidateAndRebuild(reason: HomeSearchInvalidationReason): Promise<void>;
    stop(): Promise<void>;
}>;

function isRebuildableIndexError(error: unknown): boolean {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const message = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : String(error);
    return code === 'SQLITE_CORRUPT'
        || code === 'SQLITE_NOTADB'
        || /malformed|not a database|SQLITE_CORRUPT|SQLITE_NOTADB|Unsupported Personal Home search schema version/iu.test(message);
}

async function removeDerivedIndexFiles(dbPath: string): Promise<void> {
    const exactPath = resolve(dbPath);
    await Promise.all([
        rm(exactPath, { force: true }),
        rm(`${exactPath}-wal`, { force: true }),
        rm(`${exactPath}-shm`, { force: true }),
    ]);
}

/** Owns the one derived FTS database, startup projection, live observer, rebuild, and shutdown. */
export function startHomeSearchLifecycle(params: Readonly<{
    dbPath: string;
    homeServerIdentityId: string | (() => Promise<string>);
    storagePolicy: string;
    readCanonicalMessagesPage: HomeSearchCanonicalPageReader;
    openDb?: typeof openHomeSearchDb;
}>): HomeSearchLifecycle {
    const plainHome = isPlainHomeStoragePolicy(params.storagePolicy);
    const pendingMutations: SessionTranscriptMutation[] = [];
    let homeServerIdentityId = typeof params.homeServerIdentityId === 'string' ? params.homeServerIdentityId : '';
    let db: HomeSearchDb | null = null;
    let indexer: HomeSearchIndexer | null = null;
    let started = false;
    let stopped = false;
    let failed = false;
    let readyPromise: Promise<void> = Promise.resolve();
    let rebuildPromise: Promise<void> | null = null;

    const deliverMutation = (target: HomeSearchIndexer, mutation: SessionTranscriptMutation) => {
        if (mutation.kind === 'upsert') target.notify(mutation.message);
        else if (mutation.kind === 'remove-messages') target.removeMessages(mutation.messageIds);
        else target.removeSession(mutation.sessionId);
    };
    const flushPendingMutations = (target: HomeSearchIndexer) => {
        for (const mutation of pendingMutations.splice(0)) deliverMutation(target, mutation);
    };
    const applyMutation = (mutation: SessionTranscriptMutation) => {
        if (stopped || !plainHome) return;
        if (!indexer || rebuildPromise) {
            pendingMutations.push(mutation);
            return;
        }
        deliverMutation(indexer, mutation);
    };

    let unregisterObserver: (() => void) | null = plainHome
        ? registerSessionTranscriptMutationObserver(applyMutation)
        : null;

    const beginRebuild = (reason: HomeSearchInvalidationReason): Promise<void> => {
        if (stopped || !plainHome) return Promise.resolve();
        if (rebuildPromise) return rebuildPromise;
        failed = true;
        const work = Promise.resolve().then(async () => {
            const previousIndexer = indexer;
            indexer = null;
            await previousIndexer?.stop();
            db?.close();
            db = null;
            await removeDerivedIndexFiles(params.dbPath);
            if (!stopped) await openAndStart(false);
        }).catch(() => {
            failed = true;
        }).finally(() => {
            if (rebuildPromise === work) rebuildPromise = null;
        });
        rebuildPromise = work;
        readyPromise = work;
        void reason;
        return work;
    };

    const handleFailure = (error: unknown) => {
        failed = true;
        if (!stopped && started && isRebuildableIndexError(error)) {
            queueMicrotask(() => { void beginRebuild('corruption'); });
        }
    };

    const attach = (nextDb: HomeSearchDb) => {
        db = nextDb;
        const nextIndexer = createHomeSearchIndexer({
            db: nextDb,
            readCanonicalMessagesPage: params.readCanonicalMessagesPage,
            onFailure: handleFailure,
        });
        indexer = nextIndexer;
        flushPendingMutations(nextIndexer);
        nextIndexer.start();
        return nextIndexer;
    };

    async function openDatabase(repairCorruption: boolean): Promise<HomeSearchDb> {
        const opener = params.openDb ?? openHomeSearchDb;
        try {
            return await opener({ dbPath: params.dbPath });
        } catch (error) {
            if (!repairCorruption || !isRebuildableIndexError(error)) throw error;
            await removeDerivedIndexFiles(params.dbPath);
            return await opener({ dbPath: params.dbPath });
        }
    }

    async function openAndStart(repairCorruption: boolean): Promise<void> {
        try {
            if (typeof params.homeServerIdentityId === 'function') {
                homeServerIdentityId = await params.homeServerIdentityId();
            }
            const nextDb = await openDatabase(repairCorruption);
            if (stopped) {
                nextDb.close();
                return;
            }
            failed = false;
            const nextIndexer = attach(nextDb);
            await nextIndexer.whenReady();
            // Reconciliation can overlap canonical commits. Apply anything buffered
            // after attach before advertising the rebuilt projection as settled.
            if (indexer === nextIndexer) flushPendingMutations(nextIndexer);
            if (indexer === nextIndexer && nextIndexer.ready()) failed = false;
        } catch (error) {
            handleFailure(error);
        }
    }

    const currentService = () => createHomeSearchService({
        db,
        homeServerIdentityId,
        storagePolicy: params.storagePolicy,
        isReady: () => !failed && Boolean(indexer?.ready()),
        onFailure: handleFailure,
    });

    return {
        capability() {
            if (!plainHome) return resolveHomeSearchCapability({ storagePolicy: params.storagePolicy, indexReady: false });
            if (stopped || failed || rebuildPromise) {
                return { enabled: false, provider: null, reason: 'index_unavailable' };
            }
            return resolveHomeSearchCapability({
                storagePolicy: params.storagePolicy,
                indexReady: db !== null,
                indexing: !indexer?.ready(),
            });
        },
        search(query, context) {
            if (stopped || failed || rebuildPromise) {
                return { v: 1, ok: false, errorCode: 'memory_index_missing', error: 'Personal Home search index is unavailable' };
            }
            return currentService().search(query, context);
        },
        start() {
            if (started || stopped || !plainHome) return;
            started = true;
            readyPromise = Promise.resolve().then(() => openAndStart(true));
        },
        whenReady() { return readyPromise; },
        invalidateAndRebuild(reason) { return beginRebuild(reason); },
        async stop() {
            if (stopped) return;
            stopped = true;
            unregisterObserver?.();
            unregisterObserver = null;
            await readyPromise.catch(() => undefined);
            await indexer?.stop();
            indexer = null;
            db?.close();
            db = null;
        },
    };
}
