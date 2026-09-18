import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { normalizeVerifiedEmail } from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    accountOwnsVerifiedMailboxInTx,
    upsertVerifiedMailboxEvidenceInTx,
} from "./verifiedMailboxEvidence";

/**
 * The verified-mailbox reader is the question every email-bound admission asks:
 * does *this* Account own *this* exact normalized address? It is deliberately a
 * reader of the same fact the admission writer records, not a second email truth.
 */
describe("verified mailbox ownership", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-verified-mailbox-", initAuth: true,
        });
    }, 180_000);
    afterEach(async () => { await db.account.deleteMany(); });
    afterAll(async () => { if (harness) await harness.close(); });

    async function accountWithMailbox(address: string) {
        const account = await db.account.create({
            data: { publicKey: randomUUID(), encryptionMode: "plain" },
        });
        const email = normalizeVerifiedEmail(address);
        if (!email) throw new Error("fixture address must normalize");
        await inTx((tx) => upsertVerifiedMailboxEvidenceInTx(tx, { accountId: account.id, email }));
        return { account, email };
    }

    it("confirms only the exact normalized address recorded for that exact Account", async () => {
        const owner = await accountWithMailbox("Person@Example.test");
        const other = await db.account.create({
            data: { publicKey: randomUUID(), encryptionMode: "plain" },
        });

        expect(await inTx((tx) => accountOwnsVerifiedMailboxInTx(tx, {
            accountId: owner.account.id,
            normalizedEmail: owner.email.normalizedEmail,
        }))).toBe(true);

        // A different Account holding no evidence must never inherit the answer.
        expect(await inTx((tx) => accountOwnsVerifiedMailboxInTx(tx, {
            accountId: other.id,
            normalizedEmail: owner.email.normalizedEmail,
        }))).toBe(false);

        expect(await inTx((tx) => accountOwnsVerifiedMailboxInTx(tx, {
            accountId: owner.account.id,
            normalizedEmail: "someone-else@example.test",
        }))).toBe(false);
    });

    it("refuses an unnormalized or empty address instead of matching loosely", async () => {
        const owner = await accountWithMailbox("person@example.test");

        // The stored fact is normalized; comparing a raw display address here
        // would let a differently cased submission pass an ownership check the
        // normalization owner never granted.
        for (const probe of ["Person@Example.test", " person@example.test ", ""]) {
            expect(await inTx((tx) => accountOwnsVerifiedMailboxInTx(tx, {
                accountId: owner.account.id,
                normalizedEmail: probe,
            }))).toBe(false);
        }
    });
});
