import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { applySessionTurnMutation } from "@/app/session/sessionWriteService";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";
import { applyReleasedUiV021SessionEnd } from "./applyReleasedUiV021SessionEnd";

const authentication = createPresentUserSessionAccessAuthentication();

describe("released UI v0.2.1 Stop lifecycle compatibility", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-released-ui-stop-",
            initAuth: false,
            initEncrypt: false,
            initFiles: false,
        });
    }, 120_000);

    afterAll(async () => harness.close());

    it("settles the current turn, publisher lifecycle, and Runtime Activity exactly once for the owner", async () => {
        // A Session-owning Account is current: terminal turn settlement takes
        // the canonical Account transition fence.
        const owner = await db.account.create({
            data: { publicKey: `owner-${randomUUID()}`, encryptionMode: "plain" },
        });
        const other = await db.account.create({
            data: { publicKey: `other-${randomUUID()}`, encryptionMode: "plain" },
        });
        const session = await db.session.create({
            data: {
                accountId: owner.id,
                tag: `tag-${randomUUID()}`,
                metadata: "{}",
                active: true,
                lastActiveAt: new Date(1_000),
                runtimeActivityState: "active",
                runtimeActivityActiveCount: 1,
                runtimeActivityObservedAt: BigInt(1_000),
                runtimeActivityRevision: BigInt(1),
            },
        });
        await expect(applySessionTurnMutation({
            actorUserId: owner.id,
            mutation: {
                v: 1,
                sessionId: session.id,
                mutationId: `begin-${randomUUID()}`,
                action: "begin",
                turnId: "turn-1",
                observedAt: 1_000,
            },
            authentication,
        })).resolves.toMatchObject({ ok: true, didApply: true });

        await expect(applyReleasedUiV021SessionEnd({
            accountId: other.id,
            sessionId: session.id,
            observedAt: 2_000,
        })).resolves.toEqual({ status: "rejected", reason: "unauthorized" });
        await expect(applyReleasedUiV021SessionEnd({
            accountId: owner.id,
            sessionId: session.id,
            observedAt: 2_000,
        })).resolves.toEqual({ status: "applied" });
        await expect(applyReleasedUiV021SessionEnd({
            accountId: owner.id,
            sessionId: session.id,
            observedAt: 2_000,
        })).resolves.toEqual({ status: "unchanged" });

        await expect(db.session.findUniqueOrThrow({
            where: { id: session.id },
            select: {
                active: true,
                lastActiveAt: true,
                latestTurnStatus: true,
                runtimeActivityState: true,
                runtimeActivityActiveCount: true,
                runtimeActivityRevision: true,
            },
        })).resolves.toEqual({
            active: false,
            lastActiveAt: new Date(2_000),
            latestTurnStatus: "cancelled",
            runtimeActivityState: "unknown",
            runtimeActivityActiveCount: 0,
            runtimeActivityRevision: BigInt(2),
        });
    });
});
