import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { formatHomeClaimCodeV1, type AccountStatusV1, type HomeRoleV1 } from "@happier-dev/protocol";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import {
    HOME_CLAIM_CODE_CACHE_KEY,
    HOME_CLAIM_CODE_LIFETIME_MS,
    mintHomeClaimCode,
    redeemHomeClaimCode,
} from "./homeClaimCode";

let harness: LightSqliteHarness;
let sequence = 0;

async function createAccount(homeRole: HomeRoleV1 = "member", status: AccountStatusV1 = "active"): Promise<string> {
    sequence += 1;
    const created = await db.account.create({
        data: { publicKey: `home-claim-code-${sequence}`, homeRole, status },
        select: { id: true },
    });
    return created.id;
}

async function ownerIds(): Promise<string[]> {
    const rows = await db.account.findMany({ where: { homeRole: "owner", status: "active" }, select: { id: true } });
    return rows.map((row) => row.id);
}

async function mint(now: number): Promise<string> {
    const minted = await mintHomeClaimCode({ now });
    if (minted.status !== "minted") throw new Error(`expected a minted code, got ${minted.status}`);
    return minted.code;
}

beforeAll(async () => {
    harness = await createLightSqliteHarness({
        tempDirPrefix: "happier-home-claim-code-",
        initAuth: false,
        initEncrypt: false,
        initFiles: false,
    });
});
afterAll(async () => await harness.close());
afterEach(async () => {
    await db.simpleCache.deleteMany({});
    await db.homeAdministrationEvent.deleteMany({});
    await db.accountChange.deleteMany({});
    await db.account.deleteMany({});
});

describe("Home claim code", () => {
    it("mints a 15-minute code, stores only its hash, and claims the Home once", async () => {
        const now = 1_800_000_000_000;
        const claimant = await createAccount();

        const minted = await mintHomeClaimCode({ now });
        expect(minted).toMatchObject({ status: "minted", expiresAt: now + HOME_CLAIM_CODE_LIFETIME_MS });
        expect(HOME_CLAIM_CODE_LIFETIME_MS).toBe(15 * 60 * 1000);
        if (minted.status !== "minted") return;
        const stored = await db.simpleCache.findUniqueOrThrow({ where: { key: HOME_CLAIM_CODE_CACHE_KEY } });
        expect(stored.value).not.toContain(minted.code);

        // Pasted in its printed, dashed and lower-cased form.
        const pasted = formatHomeClaimCodeV1(minted.code).toLowerCase();
        await expect(redeemHomeClaimCode({ accountId: claimant, code: pasted, now: now + 60_000 }))
            .resolves.toEqual({ status: "claimed" });
        expect(await ownerIds()).toEqual([claimant]);
        await expect(db.simpleCache.count({ where: { key: HOME_CLAIM_CODE_CACHE_KEY } })).resolves.toBe(0);

        // The audit row was written by the claim: the claimant is the actor, marked as a code claim.
        const events = await db.homeAdministrationEvent.findMany({ where: { action: "home.owner.claim" } });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            actorKind: "account",
            actorAccountId: claimant,
            targetId: claimant,
            summary: { via: "claim_code" },
        });
    });

    it("is single use: the same code never claims twice", async () => {
        const now = 1_800_000_000_000;
        const first = await createAccount();
        const code = await mint(now);

        await expect(redeemHomeClaimCode({ accountId: first, code, now })).resolves.toEqual({ status: "claimed" });
        // Even after the first owner is demoted, the spent code cannot claim again.
        await db.account.update({ where: { id: first }, data: { homeRole: "member" } });
        const second = await createAccount();
        await expect(redeemHomeClaimCode({ accountId: second, code, now })).resolves.toEqual({ status: "refused" });
        expect(await ownerIds()).toEqual([]);
    });

    it("yields exactly one owner when two Accounts redeem the same code concurrently", async () => {
        const now = 1_800_000_000_000;
        const first = await createAccount();
        const second = await createAccount();
        const code = await mint(now);

        const outcomes = await Promise.all([
            redeemHomeClaimCode({ accountId: first, code, now }),
            redeemHomeClaimCode({ accountId: second, code, now }),
        ]);
        expect(outcomes.filter((outcome) => outcome.status === "claimed")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === "refused")).toHaveLength(1);
        expect(await ownerIds()).toHaveLength(1);
    });

    it("expires after 15 minutes and removes the expired code", async () => {
        const now = 1_800_000_000_000;
        const claimant = await createAccount();
        const code = await mint(now);

        await expect(redeemHomeClaimCode({ accountId: claimant, code, now: now + HOME_CLAIM_CODE_LIFETIME_MS }))
            .resolves.toEqual({ status: "refused" });
        expect(await ownerIds()).toEqual([]);
        await expect(db.simpleCache.count({ where: { key: HOME_CLAIM_CODE_CACHE_KEY } })).resolves.toBe(0);
    });

    it("answers every refusal identically and changes nothing", async () => {
        const now = 1_800_000_000_000;
        const claimant = await createAccount();
        const suspended = await createAccount("member", "suspended");

        // No code was ever printed.
        const noCode = await redeemHomeClaimCode({ accountId: claimant, code: "A".repeat(52), now });
        const code = await mint(now);
        const wrong = await redeemHomeClaimCode({ accountId: claimant, code: `${code.slice(0, -1)}${code.endsWith("A") ? "B" : "A"}`, now });
        const malformed = await redeemHomeClaimCode({ accountId: claimant, code: "not a code", now });
        const inactive = await redeemHomeClaimCode({ accountId: suspended, code, now });
        const missingAccount = await redeemHomeClaimCode({ accountId: "missing-account", code, now });

        for (const outcome of [noCode, wrong, malformed, inactive, missingAccount]) {
            expect(outcome).toEqual({ status: "refused" });
        }
        expect(await ownerIds()).toEqual([]);
        await expect(db.homeAdministrationEvent.count()).resolves.toBe(0);
        // A refused attempt with the right code for an inactive Account does not spend it.
        await expect(redeemHomeClaimCode({ accountId: claimant, code, now })).resolves.toEqual({ status: "claimed" });
    });

    it("cannot claim a Home that already has an owner, even with a valid code", async () => {
        const now = 1_800_000_000_000;
        const claimant = await createAccount();
        const code = await mint(now);
        const owner = await createAccount("owner");

        await expect(redeemHomeClaimCode({ accountId: claimant, code, now })).resolves.toEqual({ status: "refused" });
        expect(await ownerIds()).toEqual([owner]);
        await expect(mintHomeClaimCode({ now })).resolves.toEqual({ status: "already_owned" });
    });

    it("replaces a previously printed code", async () => {
        const now = 1_800_000_000_000;
        const claimant = await createAccount();
        const earlier = await mint(now);
        const later = await mint(now + 1_000);

        await expect(redeemHomeClaimCode({ accountId: claimant, code: earlier, now: now + 2_000 }))
            .resolves.toEqual({ status: "refused" });
        await expect(redeemHomeClaimCode({ accountId: claimant, code: later, now: now + 2_000 }))
            .resolves.toEqual({ status: "claimed" });
    });
});
