import { randomUUID } from "node:crypto";

import { createPlainSessionOwnerMetadataEnvelopeV1, projectSessionSharedMetadataV1 } from "@happier-dev/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { backfillSessionMessageAuthorProjection } from "@/app/session/messages/backfillSessionMessageAuthorProjection";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";
import { createSessionMessageFromPending } from "@/app/session/pending/pendingMessageTranscriptCommit";
import { enqueuePendingMessage } from "@/app/session/pending/pendingMessageService";
import { writeSessionTranscriptMessageInTx } from "@/app/session/sessionTranscriptWrite";
import { createSessionMessage } from "@/app/session/sessionWriteService";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

const STORED_PLAIN_OWNER_METADATA_ENVELOPE = JSON.stringify(
    createPlainSessionOwnerMetadataEnvelopeV1({ v: 1 }),
);
const STORED_SHARED_METADATA = JSON.stringify(projectSessionSharedMetadataV1({ metadata: {} }));

function accountReceipt(actorAccountId: string) {
    return {
        v: 1 as const,
        issuer: "authenticatedAccount" as const,
        actorAccountId,
        sessionRelationship: "sharedEditor" as const,
    };
}

const MACHINE_RECEIPT = { v: 1 as const, issuer: "authenticatedMachine" as const };

const PLAIN_CONTENT = {
    t: "plain",
    v: { role: "user", content: { type: "text", text: "hello" } },
} satisfies PrismaJson.SessionMessageContent;

async function createAccount(prefix: string): Promise<string> {
    const account = await db.account.create({
        data: { publicKey: `${prefix}-${randomUUID()}`, encryptionMode: "plain" },
        select: { id: true },
    });
    return account.id;
}

async function createPlainSession(ownerId: string): Promise<string> {
    const session = await db.session.create({
        data: {
            id: `author-projection-${randomUUID()}`,
            tag: `author-projection-tag-${randomUUID()}`,
            accountId: ownerId,
            encryptionMode: "plain",
            metadata: STORED_SHARED_METADATA,
            metadataLayoutVersion: 1,
            ownerMetadata: STORED_PLAIN_OWNER_METADATA_ENVELOPE,
            currentStorageState: "hosted",
        },
        select: { id: true },
    });
    return session.id;
}

describe("SessionMessage author projection on SQLite", () => {
    let harness: LightSqliteHarness;
    let previousStoragePolicy: string | undefined;

    beforeAll(async () => {
        previousStoragePolicy = process.env.HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY;
        process.env.HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY = "optional";
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-session-message-author-projection-",
            initAuth: false,
        });
    }, 120_000);

    afterAll(async () => {
        if (previousStoragePolicy === undefined) {
            delete process.env.HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY;
        } else {
            process.env.HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY = previousStoragePolicy;
        }
        await harness.close();
    });

    it("derives the committed projection only from a valid authenticated-Account receipt", async () => {
        const owner = await createAccount("author-owner");
        const author = await createAccount("author-actor");
        const sessionId = await createPlainSession(owner);

        const written = await inTx(async (tx) => {
            const rows = [] as { localId: string; id: string }[];
            for (const [localId, messageRole, inputAdmissionReceipt] of [
                ["human", "user", accountReceipt(author)],
                ["machine", "user", MACHINE_RECEIPT],
                ["legacy", "user", undefined],
                ["agent-role", "agent", accountReceipt(author)],
            ] as const) {
                const persisted = await writeSessionTranscriptMessageInTx(tx, {
                    sessionId,
                    writeAuthority: "hosted",
                    sessionEncryptionMode: "plain",
                    storagePolicy: "optional",
                    content: PLAIN_CONTENT,
                    localId,
                    sidechainId: null,
                    messageRole,
                    ...(inputAdmissionReceipt ? { inputAdmissionReceipt } : {}),
                });
                if (!persisted.ok) throw new Error(`write failed for ${localId}`);
                rows.push({ localId, id: persisted.message.id });
            }
            return rows;
        });

        const stored = await db.sessionMessage.findMany({
            where: { id: { in: written.map((row) => row.id) } },
            select: { localId: true, authorAccountId: true, inputAdmissionReceipt: true },
        });
        const byLocalId = new Map(stored.map((row) => [row.localId, row]));
        expect(byLocalId.get("human")?.authorAccountId).toBe(author);
        expect(byLocalId.get("machine")?.authorAccountId).toBeNull();
        expect(byLocalId.get("legacy")?.authorAccountId).toBeNull();
        expect(byLocalId.get("agent-role")?.authorAccountId).toBeNull();
        // The receipt bytes remain the immutable authority.
        expect(byLocalId.get("human")?.inputAdmissionReceipt).toEqual(accountReceipt(author));
    });

    it("selects authored Sessions through the indexed relation without parsing receipt JSON", async () => {
        const owner = await createAccount("predicate-owner");
        const author = await createAccount("predicate-actor");
        const bystander = await createAccount("predicate-bystander");
        const authoredSessionId = await createPlainSession(owner);
        const unauthoredSessionId = await createPlainSession(owner);

        await inTx(async (tx) => {
            for (const localId of ["authored-1", "authored-2"]) {
                const persisted = await writeSessionTranscriptMessageInTx(tx, {
                    sessionId: authoredSessionId,
                    writeAuthority: "hosted",
                    sessionEncryptionMode: "plain",
                    storagePolicy: "optional",
                    content: PLAIN_CONTENT,
                    localId,
                    sidechainId: null,
                    messageRole: "user",
                    inputAdmissionReceipt: accountReceipt(author),
                });
                if (!persisted.ok) throw new Error("write failed");
            }
            const machineWrite = await writeSessionTranscriptMessageInTx(tx, {
                sessionId: unauthoredSessionId,
                writeAuthority: "hosted",
                sessionEncryptionMode: "plain",
                storagePolicy: "optional",
                content: PLAIN_CONTENT,
                localId: "unauthored-1",
                sidechainId: null,
                messageRole: "user",
                inputAdmissionReceipt: MACHINE_RECEIPT,
            });
            if (!machineWrite.ok) throw new Error("write failed");
        });

        const authoredSessions = await db.session.findMany({
            where: {
                id: { in: [authoredSessionId, unauthoredSessionId] },
                messages: { some: { authorAccountId: author } },
            },
            select: { id: true },
        });
        // Many authored messages still yield exactly one Session; no aggregate exists.
        expect(authoredSessions.map((row) => row.id)).toEqual([authoredSessionId]);

        const bystanderSessions = await db.session.findMany({
            where: {
                id: { in: [authoredSessionId, unauthoredSessionId] },
                messages: { some: { authorAccountId: bystander } },
            },
            select: { id: true },
        });
        expect(bystanderSessions).toEqual([]);
    });

    it("fills the projection when a Pending commit backfills a provider-written anchor's receipt", async () => {
        const owner = await createAccount("rejoin-owner");
        const author = await createAccount("rejoin-actor");
        const sessionId = await createPlainSession(owner);

        const anchor = await inTx(async (tx) => {
            const persisted = await writeSessionTranscriptMessageInTx(tx, {
                sessionId,
                writeAuthority: "hosted",
                sessionEncryptionMode: "plain",
                storagePolicy: "optional",
                content: PLAIN_CONTENT,
                localId: "rejoin-local",
                sidechainId: null,
                messageRole: null,
            });
            if (!persisted.ok) throw new Error("anchor write failed");
            return persisted.message;
        });
        expect((await db.sessionMessage.findUniqueOrThrow({
            where: { id: anchor.id },
            select: { authorAccountId: true },
        })).authorAccountId).toBeNull();

        const rejoined = await inTx((tx) => createSessionMessageFromPending(tx, {
            sessionId,
            sessionEncryptionMode: "plain",
            storagePolicy: "optional",
            localId: "rejoin-local",
            content: PLAIN_CONTENT,
            messageRole: "user",
            inputAdmissionReceipt: accountReceipt(author),
        }));
        expect(rejoined.ok).toBe(true);

        expect((await db.sessionMessage.findUniqueOrThrow({
            where: { id: anchor.id },
            select: { authorAccountId: true },
        })).authorAccountId).toBe(author);
    });

    it.each(["receipt", "projection"] as const)("refuses a Pending rejoin with a contradictory %s without repairing history", async (contradiction) => {
        const owner = await createAccount("conflict-owner");
        const author = await createAccount("conflict-actor");
        const other = await createAccount("conflict-other");
        const sessionId = await createPlainSession(owner);

        await inTx((tx) => createSessionMessageFromPending(tx, {
            sessionId,
            sessionEncryptionMode: "plain",
            storagePolicy: "optional",
            localId: "conflict-local",
            content: PLAIN_CONTENT,
            messageRole: "user",
            inputAdmissionReceipt: accountReceipt(author),
        }));

        if (contradiction === "projection") {
            await db.sessionMessage.update({
                where: { sessionId_localId: { sessionId, localId: "conflict-local" } },
                data: { authorAccountId: other },
            });
        }
        const beforeRejoin = await db.sessionMessage.findFirstOrThrow({
            where: { sessionId, localId: "conflict-local" },
        });
        try {
            const conflicted = await inTx((tx) => createSessionMessageFromPending(tx, {
                sessionId,
                sessionEncryptionMode: "plain",
                storagePolicy: "optional",
                localId: "conflict-local",
                content: PLAIN_CONTENT,
                messageRole: "user",
                inputAdmissionReceipt: accountReceipt(contradiction === "receipt" ? other : author),
            }));
            expect(conflicted).toMatchObject({ ok: false, error: "transcript-conflict", conflict: "input-admission" });
            expect(await db.sessionMessage.findUniqueOrThrow({ where: { id: beforeRejoin.id } })).toEqual(beforeRejoin);
        } finally {
            // Remove only this deliberately corrupted fixture before the suite's
            // database-wide backfill audit; the production operation must not repair it.
            if (contradiction === "projection") {
                await db.sessionMessage.update({ where: { id: beforeRejoin.id }, data: { authorAccountId: author } });
            }
        }
    });

    it("refuses a terminal Pending replay when the derived author projection conflicts with its receipt", async () => {
        const owner = await createAccount("terminal-conflict-owner");
        const other = await createAccount("terminal-conflict-other");
        const sessionId = await createPlainSession(owner);

        const persisted = await inTx((tx) => writeSessionTranscriptMessageInTx(tx, {
            sessionId,
            writeAuthority: "hosted",
            sessionEncryptionMode: "plain",
            storagePolicy: "optional",
            content: PLAIN_CONTENT,
            localId: "terminal-conflict-local",
            sidechainId: null,
            messageRole: "user",
            inputAdmissionReceipt: accountReceipt(owner),
        }));
        expect(persisted).toMatchObject({ ok: true });

        await db.sessionMessage.update({
            where: { sessionId_localId: { sessionId, localId: "terminal-conflict-local" } },
            data: { authorAccountId: other },
        });
        try {
            await expect(enqueuePendingMessage({
                actorUserId: owner,
                sessionId,
                localId: "terminal-conflict-local",
                content: PLAIN_CONTENT,
                messageRole: "user",
                requestedAction: { v: 1, kind: "enqueue" },
                authentication: createPresentUserSessionAccessAuthentication(),
            })).resolves.toMatchObject({
                ok: false,
                error: "invalid-params",
                admissionRejectionCode: "session_input_idempotency_conflict",
            });
        } finally {
            // Repair only the deliberately corrupted fixture so the suite-wide
            // author-projection audit remains a check of production behavior.
            await db.sessionMessage.update({
                where: { sessionId_localId: { sessionId, localId: "terminal-conflict-local" } },
                data: { authorAccountId: owner },
            });
        }
    });

    it.each(["foreign-key", "account-erasure"] as const)("preserves the receipt and permits Pending replay after %s deletion", async (deletion) => {
        const owner = await createAccount("deleted-owner");
        const author = await createAccount("deleted-actor");
        const sessionId = await createPlainSession(owner);

        const message = await inTx(async (tx) => {
            const persisted = await writeSessionTranscriptMessageInTx(tx, {
                sessionId,
                writeAuthority: "hosted",
                sessionEncryptionMode: "plain",
                storagePolicy: "optional",
                content: PLAIN_CONTENT,
                localId: "deleted-local",
                sidechainId: null,
                messageRole: "user",
                inputAdmissionReceipt: accountReceipt(author),
            });
            if (!persisted.ok) throw new Error("write failed");
            return persisted.message;
        });

        if (deletion === "account-erasure") {
            const { deleteAccountForErasure } = await import("@/app/plugins/data/accountDataErase");
            expect(await deleteAccountForErasure({ accountId: author })).toMatchObject({ status: "deleted" });
        } else {
            await db.account.delete({ where: { id: author } });
        }

        const stored = await db.sessionMessage.findUniqueOrThrow({
            where: { id: message.id },
            select: { authorAccountId: true, inputAdmissionReceipt: true },
        });
        expect(stored.authorAccountId).toBeNull();
        expect(stored.inputAdmissionReceipt).toEqual(accountReceipt(author));

        const beforeReplay = await db.sessionMessage.findUniqueOrThrow({ where: { id: message.id } });
        const replayed = await inTx((tx) => createSessionMessageFromPending(tx, {
            sessionId,
            sessionEncryptionMode: "plain",
            storagePolicy: "optional",
            localId: "deleted-local",
            content: PLAIN_CONTENT,
            messageRole: "user",
            inputAdmissionReceipt: accountReceipt(author),
        }));
        expect(replayed).toMatchObject({
            ok: true,
            didWrite: false,
            didUpdate: false,
            message: { id: message.id, authorAccountId: null, inputAdmissionReceipt: accountReceipt(author) },
        });
        expect(await db.sessionMessage.findUniqueOrThrow({ where: { id: message.id } })).toEqual(beforeReplay);
        expect(await db.account.findUnique({ where: { id: author } })).toBeNull();
    });

    it("retains erased authorship during an identical transcript-only direct replay", async () => {
        const owner = await createAccount("pending-erased-owner");
        const author = await createAccount("pending-erased-actor");
        const sessionId = await createPlainSession(owner);
        const materialized = await inTx((tx) => createSessionMessageFromPending(tx, {
            sessionId, sessionEncryptionMode: "plain", storagePolicy: "optional",
            localId: "pending-erased-local", content: PLAIN_CONTENT, messageRole: "user",
            inputAdmissionReceipt: accountReceipt(author),
        }));
        expect(materialized).toMatchObject({ ok: true, didWrite: true });
        await db.account.delete({ where: { id: author } });
        expect(await createSessionMessage({
            actorUserId: owner, sessionId, localId: "pending-erased-local",
            content: PLAIN_CONTENT, messageRole: "user", inputAdmission: "transcriptOnly",
            localIdConflictPolicy: "identical-or-conflict",
        })).toMatchObject({
            ok: true, didWrite: false,
            message: { authorAccountId: null, inputAdmissionReceipt: accountReceipt(author) },
        });
        expect(await db.account.findUnique({ where: { id: author } })).toBeNull();
        expect(await db.sessionMessage.findUniqueOrThrow({
            where: { sessionId_localId: { sessionId, localId: "pending-erased-local" } },
        })).toMatchObject({ authorAccountId: null, inputAdmissionReceipt: accountReceipt(author) });
    });

    it("backfills only still-null projections from exact valid receipts and audits disagreements", async () => {
        const owner = await createAccount("backfill-owner");
        const author = await createAccount("backfill-actor");
        const sessionId = await createPlainSession(owner);

        const ids = await inTx(async (tx) => {
            const written: Record<string, string> = {};
            for (const [localId, messageRole, inputAdmissionReceipt] of [
                ["backfill-human", "user", accountReceipt(author)],
                ["backfill-machine", "user", MACHINE_RECEIPT],
                ["backfill-legacy", "user", undefined],
            ] as const) {
                const persisted = await writeSessionTranscriptMessageInTx(tx, {
                    sessionId,
                    writeAuthority: "hosted",
                    sessionEncryptionMode: "plain",
                    storagePolicy: "optional",
                    content: PLAIN_CONTENT,
                    localId,
                    sidechainId: null,
                    messageRole,
                    ...(inputAdmissionReceipt ? { inputAdmissionReceipt } : {}),
                });
                if (!persisted.ok) throw new Error("write failed");
                written[localId] = persisted.message.id;
            }
            return written;
        });

        // Simulate the pre-cutover state the expand phase leaves behind.
        await db.sessionMessage.update({
            where: { id: ids["backfill-human"]! },
            data: { authorAccountId: null },
        });

        const first = await backfillSessionMessageAuthorProjection({ batchSize: 2 });
        expect(first).toMatchObject({ ok: true, disagreements: 0 });
        expect(first.filled).toBeGreaterThanOrEqual(1);
        expect((await db.sessionMessage.findUniqueOrThrow({
            where: { id: ids["backfill-human"]! },
            select: { authorAccountId: true },
        })).authorAccountId).toBe(author);
        for (const localId of ["backfill-machine", "backfill-legacy"]) {
            expect((await db.sessionMessage.findUniqueOrThrow({
                where: { id: ids[localId]! },
                select: { authorAccountId: true },
            })).authorAccountId).toBeNull();
        }

        // Idempotent: a rerun after an interrupted upgrade fills nothing new.
        const second = await backfillSessionMessageAuthorProjection({ batchSize: 2 });
        expect(second).toMatchObject({ ok: true, filled: 0, disagreements: 0 });
    });

    it.each(["account", "machine", "legacy", "non-user"] as const)("reports a non-null %s projection disagreement without repairing the receipt", async (receiptKind) => {
        const previousAudit = await backfillSessionMessageAuthorProjection({ batchSize: 50 });
        const owner = await createAccount("audit-owner");
        const author = await createAccount("audit-actor");
        const other = await createAccount("audit-other");
        const sessionId = await createPlainSession(owner);

        const message = await inTx(async (tx) => {
            const persisted = await writeSessionTranscriptMessageInTx(tx, {
                sessionId,
                writeAuthority: "hosted",
                sessionEncryptionMode: "plain",
                storagePolicy: "optional",
                content: PLAIN_CONTENT,
                localId: "audit-local",
                sidechainId: null,
                messageRole: receiptKind === "non-user" ? "agent" : "user",
                ...(receiptKind === "legacy" ? {} : {
                    inputAdmissionReceipt: receiptKind === "machine" ? MACHINE_RECEIPT : accountReceipt(author),
                }),
            });
            if (!persisted.ok) throw new Error("write failed");
            return persisted.message;
        });
        await db.sessionMessage.update({
            where: { id: message.id },
            data: { authorAccountId: other },
        });

        const result = await backfillSessionMessageAuthorProjection({ batchSize: 50 });
        expect(result.ok).toBe(false);
        expect(result.disagreements).toBe(previousAudit.disagreements + 1);
        const stored = await db.sessionMessage.findUniqueOrThrow({
            where: { id: message.id },
            select: { authorAccountId: true, inputAdmissionReceipt: true },
        });
        expect(stored.authorAccountId).toBe(other);
        expect(stored.inputAdmissionReceipt).toEqual(receiptKind === "legacy" ? null
            : receiptKind === "machine" ? MACHINE_RECEIPT : accountReceipt(author));
    });
});
