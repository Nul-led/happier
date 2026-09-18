import { describe, expect, it, beforeEach } from "vitest";
import {
    createNativeAuthOneTimeOperationKeyV1,
    encodeNativeAuthOneTimeOperationV1,
    type NativeAuthOneTimeOperationV1,
} from "@happier-dev/protocol";

import {
    consumeNativeAuthOneTimeOperationInTx,
    issueNativeAuthOneTimeOperationInTx,
    readNativeAuthOneTimeOperation,
} from "./nativeAuthOneTimeOperations";
import type { Tx } from "@/storage/inTx";

type Row = { key: string; value: string; expiresAt: Date };

/**
 * `RepeatKey` is a genuine persistence boundary; this fake keeps its exact
 * key/value/expiry semantics so the guarded-consumption contract is exercised
 * without a database. Real provider behavior is covered by the integration lane.
 */
function createRepeatKeyTx(now: () => Date) {
    const rows = new Map<string, Row>();
    const tx = {
        repeatKey: {
            async findUnique({ where }: { where: { key: string; expiresAt?: { gte?: Date; gt?: Date } } }) {
                const row = rows.get(where.key);
                if (!row) return null;
                if (where.expiresAt?.gte && (where.expiresAt.gte && row.expiresAt < where.expiresAt.gte)) return null;
                if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) return null;
                return row;
            },
            async upsert({ create, update }: { create: Row; update: Partial<Row> }) {
                const row = rows.get(create.key);
                const result = row ? { ...row, ...update } : { ...create };
                rows.set(create.key, result);
                return result;
            },
            async updateMany({ where, data }: { where: { key: string; expiresAt: { lte: Date } }; data: Partial<Row> }) {
                const row = rows.get(where.key);
                if (!row || row.expiresAt > where.expiresAt.lte) return { count: 0 };
                rows.set(where.key, { ...row, ...data });
                return { count: 1 };
            },
            async deleteMany({ where }: { where: { key: string; value: string; expiresAt: { gte?: Date; gt?: Date } } }) {
                const row = rows.get(where.key);
                if (!row || row.value !== where.value || (where.expiresAt.gte && row.expiresAt < where.expiresAt.gte) || (where.expiresAt.gt && row.expiresAt <= where.expiresAt.gt)) {
                    return { count: 0 };
                }
                rows.delete(where.key);
                return { count: 1 };
            },
        },
    };
    return { tx: tx as unknown as Tx, rows, now };
}

const verifyOperation: NativeAuthOneTimeOperationV1 = {
    v: 1,
    purpose: "verify_native_email",
    normalizedEmail: "alice@example.com",
    consumer: { kind: "fresh_account", continuationId: null },
};

const resetOperation: NativeAuthOneTimeOperationV1 = {
    v: 1,
    purpose: "reset_plain_password",
    accountId: "acc_1",
    credentialRevision: 4,
    expectedNativeIdentity: "alice@example.com",
};

describe("native auth one-time operations", () => {
    let harness: ReturnType<typeof createRepeatKeyTx>;
    let clock: Date;

    beforeEach(() => {
        clock = new Date("2026-09-05T00:00:00.000Z");
        harness = createRepeatKeyTx(() => clock);
    });

    it("stores only a digest key and strict JSON, never the raw bearer", async () => {
        const issued = await issueNativeAuthOneTimeOperationInTx(harness.tx, verifyOperation, { now: () => clock });

        const stored = [...harness.rows.values()];
        expect(stored).toHaveLength(1);
        expect(stored[0].key).toBe(createNativeAuthOneTimeOperationKeyV1("verify_native_email", issued.rawBearer));
        expect(stored[0].value).toBe(encodeNativeAuthOneTimeOperationV1(verifyOperation));
        expect(JSON.stringify(stored[0])).not.toContain(issued.rawBearer);
    });

    it("writes the code-owned expiry per purpose", async () => {
        const verify = await issueNativeAuthOneTimeOperationInTx(harness.tx, verifyOperation, { now: () => clock });
        const reset = await issueNativeAuthOneTimeOperationInTx(harness.tx, resetOperation, { now: () => clock });

        expect(verify.expiresAt.getTime() - clock.getTime()).toBe(24 * 60 * 60 * 1000);
        expect(reset.expiresAt.getTime() - clock.getTime()).toBe(60 * 60 * 1000);
    });

    it("previews without consuming, so a scanner GET leaves the operation usable", async () => {
        const issued = await issueNativeAuthOneTimeOperationInTx(harness.tx, verifyOperation, { now: () => clock });

        expect(await readNativeAuthOneTimeOperation(harness.tx, {
            purpose: "verify_native_email",
            token: issued.rawBearer,
        }, { now: () => clock })).toEqual(verifyOperation);
        expect(harness.rows.size).toBe(1);
        expect(await consumeNativeAuthOneTimeOperationInTx(harness.tx, {
            purpose: "verify_native_email",
            token: issued.rawBearer,
        }, { now: () => clock })).toEqual(verifyOperation);
    });

    it("gives exactly one winner for repeated consumption and leaves no history", async () => {
        const issued = await issueNativeAuthOneTimeOperationInTx(harness.tx, resetOperation, { now: () => clock });

        const first = await consumeNativeAuthOneTimeOperationInTx(harness.tx, {
            purpose: "reset_plain_password",
            token: issued.rawBearer,
        }, { now: () => clock });
        const second = await consumeNativeAuthOneTimeOperationInTx(harness.tx, {
            purpose: "reset_plain_password",
            token: issued.rawBearer,
        }, { now: () => clock });

        expect(first).toEqual(resetOperation);
        expect(second).toBeNull();
        expect(harness.rows.size).toBe(0);
    });

    it("refuses to read or consume a bearer under another purpose namespace", async () => {
        const issued = await issueNativeAuthOneTimeOperationInTx(harness.tx, resetOperation, { now: () => clock });

        expect(await readNativeAuthOneTimeOperation(harness.tx, {
            purpose: "verify_native_email",
            token: issued.rawBearer,
        }, { now: () => clock })).toBeNull();
        expect(await consumeNativeAuthOneTimeOperationInTx(harness.tx, {
            purpose: "verify_native_email",
            token: issued.rawBearer,
        }, { now: () => clock })).toBeNull();
        expect(harness.rows.size).toBe(1);
    });

    it("treats expired, malformed, and unknown bearers as equally invalid", async () => {
        const issued = await issueNativeAuthOneTimeOperationInTx(harness.tx, resetOperation, { now: () => clock });
        clock = new Date(clock.getTime() + 60 * 60 * 1000 + 1);

        expect(await readNativeAuthOneTimeOperation(harness.tx, {
            purpose: "reset_plain_password",
            token: issued.rawBearer,
        }, { now: () => clock })).toBeNull();
        expect(await readNativeAuthOneTimeOperation(harness.tx, {
            purpose: "reset_plain_password",
            token: "not-a-canonical-bearer",
        }, { now: () => clock })).toBeNull();
        expect(await consumeNativeAuthOneTimeOperationInTx(harness.tx, {
            purpose: "reset_plain_password",
            token: issued.rawBearer,
        }, { now: () => clock })).toBeNull();
    });

    it("rejects a record whose stored value no longer parses strictly", async () => {
        const issued = await issueNativeAuthOneTimeOperationInTx(harness.tx, verifyOperation, { now: () => clock });
        const key = createNativeAuthOneTimeOperationKeyV1("verify_native_email", issued.rawBearer);
        harness.rows.set(key, { key, value: '{"v":1,"purpose":"verify_native_email"}', expiresAt: new Date(clock.getTime() + 1000) });

        expect(await readNativeAuthOneTimeOperation(harness.tx, {
            purpose: "verify_native_email",
            token: issued.rawBearer,
        }, { now: () => clock })).toBeNull();
    });

    it.each([verifyOperation, resetOperation])("expires $purpose exactly at its recorded deadline", async (operation) => {
        const issued = await issueNativeAuthOneTimeOperationInTx(harness.tx, operation, { now: () => clock });
        const params = { purpose: operation.purpose, token: issued.rawBearer };
        expect(await readNativeAuthOneTimeOperation(harness.tx, params, { now: () => new Date(issued.expiresAt.getTime() - 1) })).toEqual(operation);
        expect(await readNativeAuthOneTimeOperation(harness.tx, params, { now: () => issued.expiresAt })).toBeNull();
        expect(await consumeNativeAuthOneTimeOperationInTx(harness.tx, params, { now: () => issued.expiresAt })).toBeNull();
    });

});
