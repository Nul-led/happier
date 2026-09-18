import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPluginsFeatureEnv } from "@/app/features/catalog/readFeatureEnv";
import { db, initDbMysql, initDbPostgres } from "@/storage/db";
import { inTx } from "@/storage/inTx";

import { applyCandidatePromotionRowUpdatesSetwiseInTx } from "./candidatePreparationPromotion";

type ContractProvider = "postgres" | "mysql";

function provider(): ContractProvider {
    const value = String(process.env.HAPPIER_DB_PROVIDER ?? process.env.HAPPY_DB_PROVIDER ?? "postgres")
        .trim()
        .toLowerCase();
    if (value === "postgres" || value === "postgresql") return "postgres";
    if (value === "mysql") return "mysql";
    throw new Error(`Unsupported candidate-promotion contract provider: ${value}`);
}

async function seedPromotionRows(rowCount: number): Promise<Readonly<{
    accountId: string;
    source: Readonly<{ contractId: string; schemaVersion: number; contractDigest: string }>;
    target: Readonly<{ contractId: string; schemaVersion: number; contractDigest: string }>;
    rows: readonly Readonly<{
        id: string;
        expectedRevision: number;
        nextRevision: number;
        contentEnvelopeJson: string;
    }>[];
}>> {
    const suffix = randomUUID();
    const accountId = `candidate-promotion-${suffix}`;
    const pluginId = `example.candidate-promotion.${suffix}`;
    const collectionId = "tasks";
    const sourceContract = await db.pluginCollectionContract.create({
        data: {
            pluginId,
            collectionId,
            schemaVersion: 1,
            contractDigest: `source-${suffix}`,
            normalizedSchema: {},
            indexes: [],
            relations: [],
            privacyProjection: {},
        },
    });
    const targetContract = await db.pluginCollectionContract.create({
        data: {
            pluginId,
            collectionId,
            schemaVersion: 2,
            contractDigest: `target-${suffix}`,
            normalizedSchema: {},
            indexes: [],
            relations: [],
            privacyProjection: {},
        },
    });
    await db.account.create({ data: { id: accountId, publicKey: null, encryptionMode: "plain" } });
    await db.pluginCollectionRow.createMany({
        data: Array.from({ length: rowCount }, (_, index) => ({
            accountId,
            pluginId,
            collectionId,
            rowId: `task-${index}`,
            schemaVersion: 1,
            revision: 1,
            contractId: sourceContract.id,
            contractDigest: sourceContract.contractDigest,
            contentEnvelope: { t: "plain", v: { value: index } },
        })),
    });
    const persistedRows = await db.pluginCollectionRow.findMany({
        where: { accountId },
        orderBy: { rowId: "asc" },
        select: { id: true },
    });
    return {
        accountId,
        source: {
            contractId: sourceContract.id,
            schemaVersion: sourceContract.schemaVersion,
            contractDigest: sourceContract.contractDigest,
        },
        target: {
            contractId: targetContract.id,
            schemaVersion: targetContract.schemaVersion,
            contractDigest: targetContract.contractDigest,
        },
        rows: persistedRows.map((row, index) => ({
            id: row.id,
            expectedRevision: 1,
            nextRevision: 2,
            contentEnvelopeJson: JSON.stringify({ t: "plain", v: { value: index, migrated: true } }),
        })),
    };
}

describe("Collection candidate-promotion native database contract", () => {
    const current = provider();
    const accountIds: string[] = [];
    const contractIds: string[] = [];
    const maximumBatchRows = readPluginsFeatureEnv(process.env).collectionLimits.maxBatchRows;

    beforeAll(async () => {
        if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
        if (current === "mysql") await initDbMysql(); else initDbPostgres();
        await db.$connect();
    });

    afterAll(async () => {
        await db.account.deleteMany({ where: { id: { in: accountIds } } });
        await db.pluginCollectionContract.deleteMany({ where: { id: { in: contractIds } } });
        await db.$disconnect();
    });

    it(`promotes one configured maximum batch atomically on ${current}`, async () => {
        const fixture = await seedPromotionRows(maximumBatchRows);
        accountIds.push(fixture.accountId);
        contractIds.push(fixture.source.contractId, fixture.target.contractId);

        await expect(inTx(async (tx) => applyCandidatePromotionRowUpdatesSetwiseInTx({
            tx,
            provider: current,
            accountId: fixture.accountId,
            source: fixture.source,
            target: fixture.target,
            rows: fixture.rows,
        }))).resolves.toBe(true);

        await expect(db.pluginCollectionRow.count({
            where: {
                accountId: fixture.accountId,
                contractId: fixture.target.contractId,
                schemaVersion: fixture.target.schemaVersion,
                contractDigest: fixture.target.contractDigest,
                revision: 2,
            },
        })).resolves.toBe(maximumBatchRows);
    });

    it(`rolls back one configured maximum batch after an injected late failure on ${current}`, async () => {
        const fixture = await seedPromotionRows(maximumBatchRows);
        accountIds.push(fixture.accountId);
        contractIds.push(fixture.source.contractId, fixture.target.contractId);

        await expect(inTx(async (tx) => {
            const promoted = await applyCandidatePromotionRowUpdatesSetwiseInTx({
                tx,
                provider: current,
                accountId: fixture.accountId,
                source: fixture.source,
                target: fixture.target,
                rows: fixture.rows,
            });
            expect(promoted).toBe(true);
            throw new Error("injected late candidate-promotion failure");
        })).rejects.toThrow("injected late candidate-promotion failure");

        await expect(db.pluginCollectionRow.count({
            where: {
                accountId: fixture.accountId,
                contractId: fixture.source.contractId,
                schemaVersion: fixture.source.schemaVersion,
                contractDigest: fixture.source.contractDigest,
                revision: 1,
            },
        })).resolves.toBe(maximumBatchRows);
        await expect(db.pluginCollectionRow.count({
            where: { accountId: fixture.accountId, contractId: fixture.target.contractId },
        })).resolves.toBe(0);
    });
});
