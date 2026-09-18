import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import {
    readHomeOwnerClaimRequest,
    runHomeOwnerClaimCommand,
} from "./claimHomeOwnerCommand";

let harness: LightSqliteHarness;
let sequence = 0;

async function createAccount(
    options: Readonly<{ homeRole?: "owner" | "admin" | "member"; status?: "active" | "suspended" | "disabled" }> = {},
): Promise<string> {
    sequence += 1;
    const account = await db.account.create({
        data: {
            publicKey: `pk_claim_home_owner_${sequence}`,
            encryptionMode: "plain",
            homeRole: options.homeRole ?? "member",
            status: options.status ?? "active",
        },
        select: { id: true },
    });
    return account.id;
}

async function readAccountChangeCount(accountId: string): Promise<number> {
    return await db.accountChange.count({ where: { accountId } });
}

beforeAll(async () => {
    harness = await createLightSqliteHarness({
        tempDirPrefix: "happier-claim-home-owner-",
        initAuth: true,
        initEncrypt: true,
    });
}, 120_000);
afterAll(async () => await harness.close());
afterEach(async () => {
    await db.accountChange.deleteMany({});
    await db.account.deleteMany({});
});

describe("deployment-local Home owner claim command", () => {
    it("parses the explicit target and the optional recovery intent", () => {
        expect(readHomeOwnerClaimRequest(["--claim-home-owner=acc_1"]))
            .toEqual({ targetAccountId: "acc_1", intent: "initial_claim" });
        expect(readHomeOwnerClaimRequest(["--claim-home-owner", "acc_2", "--recover-lost-owner"]))
            .toEqual({ targetAccountId: "acc_2", intent: "lost_owner_recovery" });
        expect(readHomeOwnerClaimRequest(["--migrate-only"])).toBeNull();
    });

    it("refuses a recovery flag that names no target and an empty target", () => {
        // `--recover-lost-owner` is a modifier on the claim, never a command of
        // its own: silently starting the server would be the worst outcome.
        expect(() => readHomeOwnerClaimRequest(["--recover-lost-owner"])).toThrow(/--claim-home-owner/);
        expect(() => readHomeOwnerClaimRequest(["--claim-home-owner="])).toThrow(/Account/);
    });

    it("claims an ownerless Home for the named active Account and publishes the refresh", async () => {
        const target = await createAccount();
        const admin = await createAccount({ homeRole: "admin" });

        const command = await runHomeOwnerClaimCommand({ targetAccountId: target, intent: "initial_claim" });

        expect(command.exitCode).toBe(0);
        expect(command.output).toMatchObject({
            v: 1,
            command: "claim-home-owner",
            intent: "initial_claim",
            targetAccountId: target,
            result: { status: "claimed", ownerAccountId: target },
        });
        // The operator must be able to tell which Home they just changed.
        expect(typeof command.output.homeServerIdentityId).toBe("string");
        expect(await db.account.findUniqueOrThrow({ where: { id: target }, select: { homeRole: true } }))
            .toEqual({ homeRole: "owner" });

        // The claim is an ordinary role update as far as clients are concerned:
        // the new owner refreshes itself exactly once, and the Home's existing
        // administrators are woken to reload their governance projection.
        expect(await readAccountChangeCount(target)).toBe(1);
        expect(await readAccountChangeCount(admin)).toBe(1);
    });

    it("reports an already-owned Home without mutating it and exits nonzero", async () => {
        const owner = await createAccount({ homeRole: "owner" });
        const target = await createAccount();

        const command = await runHomeOwnerClaimCommand({ targetAccountId: target, intent: "lost_owner_recovery" });

        expect(command.exitCode).toBe(1);
        expect(command.output.result).toEqual({ status: "already_owned", activeOwnerCount: 1 });
        expect(await db.account.findUniqueOrThrow({ where: { id: target }, select: { homeRole: true } }))
            .toEqual({ homeRole: "member" });
        expect(await readAccountChangeCount(target)).toBe(0);
        expect(await readAccountChangeCount(owner)).toBe(0);
    });

    it("distinguishes an inactive target from an absent one and never elects anybody", async () => {
        const suspended = await createAccount({ status: "suspended" });

        const inactive = await runHomeOwnerClaimCommand({ targetAccountId: suspended, intent: "initial_claim" });
        expect(inactive.exitCode).toBe(1);
        expect(inactive.output.result).toEqual({ status: "target_inactive" });

        const absent = await runHomeOwnerClaimCommand({ targetAccountId: "acc_missing", intent: "initial_claim" });
        expect(absent.exitCode).toBe(1);
        expect(absent.output.result).toEqual({ status: "target_not_found" });

        // A Home with no eligible owner stays ownerless; nothing is promoted.
        expect(await db.account.count({ where: { homeRole: "owner" } })).toBe(0);
    });
});
