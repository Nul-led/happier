import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readTransactionDatabaseTime } from "./transactionDatabaseTime";

describe("transaction database time", () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

    it.each(["sqlite", "pglite"] as const)("uses %s time once per transaction attempt despite a skewed process clock", async (provider) => {
        const sqlite = provider === "sqlite" ? new DatabaseSync(":memory:") : null;
        // PGlite's WASM clock calls JavaScript Date.now. A separate worker keeps the
        // database clock independent from the deliberately skewed application realm.
        const postgres = provider === "pglite" ? new Worker(`
            const { parentPort } = require('node:worker_threads');
            const { PGlite } = require('@electric-sql/pglite');
            const db = new PGlite();
            db.waitReady.then(() => parentPort.postMessage({ ready: true }));
            parentPort.on('message', async (sql) => {
                try { parentPort.postMessage({ rows: (await db.query(sql)).rows }); }
                catch (error) { parentPort.postMessage({ error: String(error) }); }
            });
        `, { eval: true }) : null;
        vi.stubEnv("HAPPIER_DB_PROVIDER", provider);
        // SQL-driver boundary adapter: queries run on the real provider, without mocking domain logic.
        const tx = {
            async $queryRawUnsafe<T>(sql: string): Promise<T> {
                if (sqlite) return sqlite.prepare(sql).all() as T;
                const response = once(postgres!, "message");
                postgres!.postMessage(sql);
                const [result] = await response as [{ rows?: T; error?: string }];
                if (result.error) throw new Error(result.error);
                return result.rows as T;
            },
        };
        const before = Date.now();
        try {
            if (postgres) await once(postgres, "message");
            vi.useFakeTimers({ toFake: ["Date"] });
            vi.setSystemTime(new Date("2100-01-01T00:00:00.000Z"));
            const first = await readTransactionDatabaseTime(tx);
            expect(first.getTime()).toBeGreaterThanOrEqual(before);
            expect(first.getUTCFullYear()).toBeLessThan(2100);
            expect(Number.isSafeInteger(first.getTime())).toBe(true);
            await new Promise((resolve) => setTimeout(resolve, 15));
            const second = await readTransactionDatabaseTime(tx);
            expect(second).toBe(first);

            // A transaction retry supplies a new transaction client. That attempt
            // must read its own database timestamp rather than inheriting the
            // abandoned attempt's value.
            const retry = await readTransactionDatabaseTime({ ...tx });
            expect(retry.getTime()).toBeGreaterThan(first.getTime());
        } finally {
            vi.useRealTimers();
            sqlite?.close();
            await postgres?.terminate();
        }
    }, 60_000);
});
