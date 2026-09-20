import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    admitTeamCredentialBrokerPoolForBrokeredUseInTx,
    resolveTeamCredentialBrokerPoolForSaveInTx,
} from "./brokerPlacementResolver";

describe("Team credential broker Pool placement save", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-broker-pool-", initAuth: false });
    }, 180_000);
    afterAll(async () => { await harness?.close(); });

    async function fixture(options?: Readonly<{ withEligibleMember?: boolean }>) {
        const custodian = await db.account.create({ data: { encryptionMode: "plain" } });
        const machine = await db.machine.create({ data: {
            id: `pool-broker-${custodian.id}`,
            accountId: custodian.id,
            metadata: "{}",
            kind: "persistent",
            operationProtocolCapabilities: { providerBrokerIngress: { protocolVersions: [1] } },
            operationProtocolCapabilitiesRevision: 1,
        } });
        const pool = await db.machinePool.create({ data: {
            id: crypto.randomUUID(),
            accountId: custodian.id,
            name: "Broker pool",
            ...(options?.withEligibleMember === false
                ? {}
                : { members: { create: { machineId: machine.id, priorityTier: 0, enabled: true } } }),
        } });
        return {
            pool,
            save: () => inTx(tx => resolveTeamCredentialBrokerPoolForSaveInTx(tx, {
                custodianAccountId: custodian.id,
                poolId: pool.id,
            })),
            admit: () => inTx(tx => admitTeamCredentialBrokerPoolForBrokeredUseInTx(tx, {
                custodianAccountId: custodian.id,
                poolId: pool.id,
            })),
        };
    }

    it("saves a Pool that carries one eligible persistent broker member", async () => {
        const f = await fixture();
        await expect(f.save()).resolves.toEqual({ ok: true, poolId: f.pool.id });
        await expect(f.admit()).resolves.toEqual({ ok: true, poolId: f.pool.id });
    });

    // Saving a placement validates ownership, not that some member can run the
    // source today. An empty or offline Pool stays a repairable placement the
    // custodian can fix; brokered use is what must then find a ready member.
    it("saves an owned Pool with no enabled members and refuses it only at brokered admission", async () => {
        const f = await fixture({ withEligibleMember: false });
        await expect(f.save()).resolves.toEqual({ ok: true, poolId: f.pool.id });
        await expect(f.admit()).resolves.toEqual({ ok: false, error: "broker_unavailable" });
    });

    // A Home whose operator opted out of Machine Pools offers no Pool broker
    // location at all, so the credential placement write path must refuse one
    // exactly as the Pool routes do — otherwise an opted-out Home keeps
    // accepting and resolving Pool placements it does not serve.
    it("refuses a Pool placement when the operator opted this Home out of Machine Pools", async () => {
        const f = await fixture();
        const previous = process.env.HAPPIER_FEATURE_MACHINES_POOLS__ENABLED;
        process.env.HAPPIER_FEATURE_MACHINES_POOLS__ENABLED = "false";
        try {
            await expect(f.save()).resolves.toEqual({ ok: false, error: "broker_unavailable" });
        } finally {
            if (previous === undefined) delete process.env.HAPPIER_FEATURE_MACHINES_POOLS__ENABLED;
            else process.env.HAPPIER_FEATURE_MACHINES_POOLS__ENABLED = previous;
        }
    });
});
