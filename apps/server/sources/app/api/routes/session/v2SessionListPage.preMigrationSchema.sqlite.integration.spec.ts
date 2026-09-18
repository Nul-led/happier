import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { findV2SessionListRows, mapV2SessionListRows, V2_SESSION_LIST_ORDER_BY } from "@/app/session/listing/page";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";

describe("session list on the pre-activation-authorization schema (SQLite integration)", () => {
    let harness: LightSqliteHarness;
    let ownerId = "";
    let sessionId = "";

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-session-list-pre-activation-sqlite-",
            initAuth: false,
            initEncrypt: false,
            initFiles: false,
        });
        const owner = await db.account.create({
            data: { publicKey: `pk-${randomUUID()}` },
            select: { id: true },
        });
        ownerId = owner.id;
        const session = await db.session.create({
            data: {
                accountId: ownerId,
                tag: `tag-${randomUUID()}`,
                metadata: "{}",
                meaningfulActivityAt: new Date(2_000),
            },
            select: { id: true },
        });
        sessionId = session.id;

        await db.$executeRawUnsafe(`ALTER TABLE "Session" DROP COLUMN "pendingActivationRequestId"`);
        await db.$executeRawUnsafe(`ALTER TABLE "Session" DROP COLUMN "pendingActivationRequestedAt"`);
        await db.$executeRawUnsafe(`ALTER TABLE "Session" DROP COLUMN "pendingActivationStatus"`);
        await db.$executeRawUnsafe(`ALTER TABLE "Session" DROP COLUMN "pendingActivationFailureCode"`);
    }, 180_000);

    beforeEach(() => harness.resetEnv());

    afterAll(async () => {
        await harness.close();
    });

    it("proves the primary column is physically absent", async () => {
        await expect(db.session.findMany({
            where: { accountId: ownerId },
            select: { pendingActivationRequestId: true },
        })).rejects.toThrow(/pendingActivationRequestId/);
    });

    it("serves the existing legacy projection and omits activation authorization", async () => {
        const rows = await findV2SessionListRows({
            userId: ownerId,
            authentication: createPresentUserSessionAccessAuthentication(),
            where: { archivedAt: null },
            orderBy: V2_SESSION_LIST_ORDER_BY,
            take: 10,
        });
        const sessions = mapV2SessionListRows({ rows, userId: ownerId });

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({ id: sessionId });
        expect(sessions[0]?.pendingActivationAuthorization).toBeUndefined();
    });
});
