import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    computeSessionMutationEqualityPlainDigestV1,
    deriveSessionMutationEqualityTagV1,
    SESSION_DISCUSSION_MUTATION_EQUALITY_HKDF_LABEL_V1,
    serializeSessionDiscussionMutationEqualityIntentV1,
    type SessionDiscussionCreateRequestV1,
    type SessionDiscussionProducerV1,
} from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";
import {
    archiveSessionDiscussion,
    createSessionDiscussion,
    postSessionDiscussionMessage,
    renameSessionDiscussion,
    restoreSessionDiscussion,
} from "./mutations";
import {
    getSessionDiscussion,
    listSessionDiscussions,
    readSessionDiscussionMessages,
} from "./queries";
import { setSessionDiscussionReadCursor } from "./readState";
import { initializeSessionOwnerReadStateInTx } from "@/app/session/personal/readState";
import {
    createSessionsWithDiscussionMentionWhere,
    createSessionsWithHumanDiscussionAuthorshipWhere,
    listSessionIdsWithDiscussionCursorsInTx,
    loadSessionDiscussionAttentionForAccounts,
    loadSessionDiscussionParticipationForAccountInTx,
} from "./attentionFacts";

const plainTitle = (title: string) => ({ t: "plain" as const, v: { v: 1, title } });
const plainBody = (text: string) => ({
    t: "plain" as const,
    v: { v: 1, parts: [{ t: "text", text }] },
});

function createRequest(params: Readonly<{
    creationLocalId: string;
    title: string;
    text: string;
    localId: string;
    mentionedAccountIds?: string[];
}>): SessionDiscussionCreateRequestV1 {
    return {
        creationLocalId: params.creationLocalId,
        titleContent: plainTitle(params.title),
        firstMessage: {
            localId: params.localId,
            content: plainBody(params.text),
            mentionedAccountIds: params.mentionedAccountIds ?? [],
        },
    } as SessionDiscussionCreateRequestV1;
}

async function startTogether<T>(operations: readonly (() => Promise<T>)[]): Promise<T[]> {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = operations.map(async (operation) => {
        await barrier;
        return await operation();
    });
    release();
    return await Promise.all(started);
}

describe("Session discussions service (SQLite)", () => {
    let harness: LightSqliteHarness;
    const authentication = createPresentUserSessionAccessAuthentication();
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-session-discussions-", initAuth: false });
    }, 120_000);
    afterAll(async () => { await harness?.close(); });

    async function fixture(params: Readonly<{ level?: "view" | "edit" | "admin"; encryptionMode?: "plain" | "e2ee" }> = {}) {
        const owner = await db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" } });
        const collaborator = await db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" } });
        const outsider = await db.account.create({ data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({
            data: {
                accountId: owner.id,
                tag: crypto.randomUUID(),
                encryptionMode: params.encryptionMode ?? "plain",
                metadata: JSON.stringify({ t: "plain", v: {} }),
            },
        });
        const share = await db.sessionShare.create({
            data: {
                sessionId: session.id,
                sharedByUserId: owner.id,
                sharedWithUserId: collaborator.id,
                accessLevel: params.level ?? "edit",
            },
        });
        return { owner, collaborator, outsider, session, share };
    }

    it("creates a discussion and its first message atomically, with a server-derived plain digest", async () => {
        const { owner, session } = await fixture();
        const result = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c1", title: "Release readiness", text: "Ship it", localId: "m1" }),
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.discussion.messageSeq).toBe(1);
        expect(result.value.firstMessage.seq).toBe(1);
        expect(result.value.firstMessage.accountActor).toMatchObject({ v: 1, accountId: owner.id });
        expect(result.value.discussion.latestMessage.accountActor).toMatchObject({ v: 1, accountId: owner.id });
        expect(result.value.firstMessage.producerV1).toBeNull();
        expect(result.value.discussion.creationLocalId).toBe("c1");

        const stored = await db.sessionDiscussion.findUniqueOrThrow({ where: { id: result.value.discussion.id } });
        const expectedDigest = computeSessionMutationEqualityPlainDigestV1(
            serializeSessionDiscussionMutationEqualityIntentV1({
                kind: "create",
                title: { v: 1, title: "Release readiness" },
                firstMessage: {
                    localId: "m1",
                    content: { v: 1, parts: [{ t: "text", text: "Ship it" }] },
                    mentionedAccountIds: [],
                },
            }),
        );
        expect(stored.creationEqualityEvidenceV1).toEqual({ kind: "plainDigest", digest: expectedDigest });
        expect(await db.sessionDiscussionMessage.count({ where: { discussionId: stored.id } })).toBe(1);
    });

    it("initializes a new Discussion for the implicitly tracked Session owner only", async () => {
        const { owner, collaborator, session } = await fixture();
        await inTx(tx => initializeSessionOwnerReadStateInTx(tx, {
            accountId: owner.id,
            sessionId: session.id,
        }));

        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({
                creationLocalId: "c-owner-tracking",
                title: "Owner tracking",
                text: "First",
                localId: "m-owner-tracking",
            }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        expect(await db.sessionDiscussionReadState.findMany({
            where: { discussionId: created.value.discussion.id },
            select: { accountId: true, lastReadSeq: true },
        })).toEqual([{ accountId: owner.id, lastReadSeq: 0 }]);
        expect(await db.sessionDiscussionReadState.count({
            where: { discussionId: created.value.discussion.id, accountId: collaborator.id },
        })).toBe(0);
    });

    it("rejoins an equal retry from the same author and refuses a different actor's duplicate local id", async () => {
        const { owner, collaborator, session } = await fixture();
        const request = createRequest({ creationLocalId: "c-dup", title: "Auth review", text: "Look here", localId: "m-dup" });
        const first = await createSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, request });
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        const retry = await createSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, request });
        expect(retry.ok).toBe(true);
        if (!retry.ok) return;
        expect(retry.value.discussion.id).toBe(first.value.discussion.id);
        expect(await db.sessionDiscussion.count({ where: { sessionId: session.id, creationLocalId: "c-dup" } })).toBe(1);

        const otherActor = await createSessionDiscussion({ authentication, actorAccountId: collaborator.id, sessionId: session.id, request });
        expect(otherActor).toEqual({ ok: false, error: "session_discussion_idempotency_conflict" });

        await db.sessionDiscussion.update({
            where: { id: first.value.discussion.id },
            data: { createdByAccountId: null },
        });
        const erasedCreator = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request,
        });
        expect(erasedCreator).toEqual({ ok: false, error: "session_discussion_idempotency_conflict" });

        const changed = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-dup", title: "Auth review", text: "Different", localId: "m-dup" }),
        });
        expect(changed).toEqual({ ok: false, error: "session_discussion_idempotency_conflict" });
    });

    it("converges simultaneous equal creates from the same actor to one discussion and first message", async () => {
        const { owner, session } = await fixture();
        const request = createRequest({
            creationLocalId: "c-concurrent-equal",
            title: "Concurrent",
            text: "Same request",
            localId: "m-concurrent-equal",
        });

        const results = await startTogether([
            () => createSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, request }),
            () => createSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, request }),
        ]);

        expect(results.every((result) => result.ok)).toBe(true);
        const discussionIds = results.flatMap((result) => result.ok ? [result.value.discussion.id] : []);
        expect(new Set(discussionIds).size).toBe(1);
        expect(await db.sessionDiscussion.count({
            where: { sessionId: session.id, creationLocalId: request.creationLocalId },
        })).toBe(1);
        expect(await db.sessionDiscussionMessage.count({
            where: { discussionId: discussionIds[0] },
        })).toBe(1);
    });

    it("adjudicates simultaneous cross-actor reuse with changed content as an idempotency conflict", async () => {
        const { owner, collaborator, session } = await fixture();
        const firstRequest = createRequest({
            creationLocalId: "c-concurrent-conflict",
            title: "Concurrent",
            text: "Owner body",
            localId: "m-concurrent-owner",
        });
        const secondRequest = createRequest({
            creationLocalId: firstRequest.creationLocalId,
            title: "Concurrent",
            text: "Collaborator body",
            localId: "m-concurrent-collaborator",
        });

        const results = await startTogether([
            () => createSessionDiscussion({
                authentication,
                actorAccountId: owner.id,
                sessionId: session.id,
                request: firstRequest,
            }),
            () => createSessionDiscussion({
                authentication,
                actorAccountId: collaborator.id,
                sessionId: session.id,
                request: secondRequest,
            }),
        ]);

        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toEqual([
            { ok: false, error: "session_discussion_idempotency_conflict" },
        ]);
        const stored = await db.sessionDiscussion.findUniqueOrThrow({
            where: {
                sessionId_creationLocalId: {
                    sessionId: session.id,
                    creationLocalId: firstRequest.creationLocalId,
                },
            },
            select: { id: true },
        });
        expect(await db.sessionDiscussionMessage.count({ where: { discussionId: stored.id } })).toBe(1);
    });

    it("refuses create rejoin when the stored first message no longer belongs to the direct human creator", async () => {
        const { owner, collaborator, session } = await fixture();
        const request = createRequest({ creationLocalId: "c-author", title: "Auth review", text: "Look here", localId: "m-author" });
        const first = await createSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, request });
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        await db.sessionDiscussionMessage.update({
            where: { id: first.value.firstMessage.id },
            data: { authorAccountId: collaborator.id },
        });

        const retry = await createSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, request });
        expect(retry).toEqual({ ok: false, error: "session_discussion_idempotency_conflict" });
    });

    it("never rejoins a message local id whose author was erased", async () => {
        const { owner, collaborator, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-erase", title: "Erasure", text: "First", localId: "m-erase" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const post = await postSessionDiscussionMessage({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: { localId: "p-erase", content: plainBody("Mine"), mentionedAccountIds: [] },
        });
        expect(post.ok).toBe(true);

        await db.sessionDiscussionMessage.updateMany({
            where: { discussionId: created.value.discussion.id, localId: "p-erase" },
            data: { authorAccountId: null },
        });

        const retry = await postSessionDiscussionMessage({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: { localId: "p-erase", content: plainBody("Mine"), mentionedAccountIds: [] },
        });
        expect(retry).toEqual({ ok: false, error: "session_discussion_idempotency_conflict" });
    });

    it("keeps the actual execution Account as the author of an Agent-produced post", async () => {
        const { owner, collaborator, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-agent", title: "Agent", text: "Start", localId: "m-agent" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const producer: SessionDiscussionProducerV1 = {
            v: 1,
            kind: "agent",
            sessionId: session.id,
            runId: "run-1",
        };
        const post = await postSessionDiscussionMessage({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: { localId: "p-agent", content: plainBody("Agent output"), mentionedAccountIds: [] },
            producer,
        });
        expect(post.ok).toBe(true);
        if (!post.ok) return;
        expect(post.value.message.authorAccountId).toBe(owner.id);
        expect(post.value.message.accountActor).toMatchObject({ v: 1, accountId: owner.id });
        expect(post.value.message.producerV1).toEqual(producer);
        expect(post.value.message.authorAccountId).not.toBe(collaborator.id);
    });

    it("rejects an Agent producer that names another Session", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-cross", title: "Cross", text: "Start", localId: "m-cross" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const post = await postSessionDiscussionMessage({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: { localId: "p-cross", content: plainBody("Nope"), mentionedAccountIds: [] },
            producer: { v: 1, kind: "agent", sessionId: "some-other-session" },
        });
        expect(post).toEqual({ ok: false, error: "session_discussion_invalid_content" });
    });

    it("stamps the default Agent producer for an automation post that carries no provenance", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-auto", title: "Automation", text: "Start", localId: "m-auto" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const automation: SessionAccessAuthentication = {
            env: process.env,
            authority: "account_automation",
            authenticationEvidence: undefined,
        };
        const request = { localId: "p-auto", content: plainBody("From the public Action"), mentionedAccountIds: [] };

        const post = await postSessionDiscussionMessage({
            authentication: automation,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request,
        });
        expect(post.ok).toBe(true);
        if (!post.ok) return;
        expect(post.value.message.authorAccountId).toBe(owner.id);
        expect(post.value.message.producerV1).toEqual({ v: 1, kind: "agent", sessionId: session.id });

        // A verbatim automation retry rejoins the stamped row instead of conflicting.
        const retried = await postSessionDiscussionMessage({
            authentication: automation,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request,
        });
        expect(retried.ok).toBe(true);
        if (!retried.ok) return;
        expect(retried.value.message.id).toBe(post.value.message.id);

        // The richer publisher-socket provenance is preserved as supplied.
        const runPost = await postSessionDiscussionMessage({
            authentication: automation,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: { localId: "p-auto-run", content: plainBody("From a run"), mentionedAccountIds: [] },
            producer: { v: 1, kind: "agent", sessionId: session.id, runId: "run-auto" },
        });
        expect(runPost.ok).toBe(true);
        if (!runPost.ok) return;
        expect(runPost.value.message.producerV1).toEqual({ v: 1, kind: "agent", sessionId: session.id, runId: "run-auto" });
    });

    it("fails a post transactionally when access was revoked after the discussion existed", async () => {
        const { owner, collaborator, session, share } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-rev", title: "Revocation", text: "Start", localId: "m-rev" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await db.sessionShare.delete({ where: { id: share.id } });

        const post = await postSessionDiscussionMessage({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: { localId: "p-rev", content: plainBody("Should fail"), mentionedAccountIds: [] },
        });
        expect(post).toEqual({ ok: false, error: "session_discussion_post_denied" });
        expect(await db.sessionDiscussionMessage.count({ where: { localId: "p-rev" } })).toBe(0);

        const read = await getSessionDiscussion({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
        });
        expect(read).toEqual({ ok: false, error: "session_discussion_not_found" });
    });

    it("does not disclose a discussion to an Account without Session access", async () => {
        const { owner, outsider, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-out", title: "Private", text: "Secret", localId: "m-out" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        expect(await listSessionDiscussions({ authentication, actorAccountId: outsider.id, sessionId: session.id }))
            .toEqual({ ok: false, error: "session_discussion_read_denied" });
        expect(await getSessionDiscussion({
            authentication,
            actorAccountId: outsider.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
        })).toEqual({ ok: false, error: "session_discussion_not_found" });
        expect(await readSessionDiscussionMessages({
            authentication,
            actorAccountId: outsider.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
        })).toEqual({ ok: false, error: "session_discussion_not_found" });

        const otherSession = await db.session.create({
            data: {
                accountId: owner.id,
                tag: crypto.randomUUID(),
                encryptionMode: "plain",
                metadata: JSON.stringify({ t: "plain", v: {} }),
            },
        });
        expect(await readSessionDiscussionMessages({
            authentication,
            actorAccountId: owner.id,
            sessionId: otherSession.id,
            discussionId: created.value.discussion.id,
        })).toEqual({ ok: false, error: "session_discussion_not_found" });
    });

    it("enforces the Session storage mode on both directions", async () => {
        const plain = await fixture({ encryptionMode: "plain" });
        expect(await createSessionDiscussion({
            authentication,
            actorAccountId: plain.owner.id,
            sessionId: plain.session.id,
            request: {
                creationLocalId: "c-mode",
                titleContent: { t: "encrypted", c: "Y2lwaGVy" },
                creationEqualityEvidenceV1: { kind: "e2eeTag", tag: "A".repeat(43) },
                firstMessage: {
                    localId: "m-mode",
                    content: { t: "encrypted", c: "Y2lwaGVy" },
                    requestEqualityEvidenceV1: { kind: "e2eeTag", tag: "B".repeat(43) },
                    mentionedAccountIds: [],
                },
            } as SessionDiscussionCreateRequestV1,
        })).toEqual({ ok: false, error: "session_discussion_encryption_mode_mismatch" });

        const e2ee = await fixture({ encryptionMode: "e2ee" });
        expect(await createSessionDiscussion({
            authentication,
            actorAccountId: e2ee.owner.id,
            sessionId: e2ee.session.id,
            request: createRequest({ creationLocalId: "c-mode2", title: "Plain in E2EE", text: "no", localId: "m-mode2" }),
        })).toEqual({ ok: false, error: "session_discussion_encryption_mode_mismatch" });
    });

    it("rejects malformed or mode-mismatched stored envelopes before projecting content", async () => {
        const { owner, session } = await fixture({ encryptionMode: "plain" });
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({
                creationLocalId: "c-corrupt",
                title: "Stored envelope",
                text: "Original",
                localId: "m-corrupt",
            }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await db.sessionDiscussion.update({
            where: { id: created.value.discussion.id },
            data: { titleContent: { t: "encrypted", c: "Y2lwaGVy" } },
        });
        await expect(getSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
        })).resolves.toEqual({ ok: false, error: "session_discussion_encryption_mode_mismatch" });

        await db.sessionDiscussion.update({
            where: { id: created.value.discussion.id },
            data: { titleContent: plainTitle("Stored envelope") },
        });
        await db.sessionDiscussionMessage.update({
            where: { id: created.value.firstMessage.id },
            data: { content: { t: "plain", v: { v: 1, parts: [] } } },
        });
        await expect(readSessionDiscussionMessages({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
        })).resolves.toEqual({ ok: false, error: "session_discussion_invalid_content" });

        await db.sessionDiscussionMessage.update({
            where: { id: created.value.firstMessage.id },
            data: {
                content: plainBody("Original"),
                producerV1: { v: 1, kind: "agent", sessionId: "another-session" },
            },
        });
        await expect(readSessionDiscussionMessages({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
        })).resolves.toEqual({ ok: false, error: "session_discussion_invalid_content" });
    });

    it("fails list and details closed when the latest message has an invalid Agent producer", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({
                creationLocalId: "c-invalid-latest-producer",
                title: "Producer integrity",
                text: "Original",
                localId: "m-invalid-latest-producer",
            }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const readListAndDetails = async () => Promise.all([
            listSessionDiscussions({
                authentication,
                actorAccountId: owner.id,
                sessionId: session.id,
            }),
            getSessionDiscussion({
                authentication,
                actorAccountId: owner.id,
                sessionId: session.id,
                discussionId: created.value.discussion.id,
            }),
        ]);

        await db.sessionDiscussionMessage.update({
            where: { id: created.value.firstMessage.id },
            data: {
                producerV1: {
                    v: 1,
                    kind: "agent",
                    // A malformed Session identity must not be presented as a human post.
                    sessionId: 42,
                },
            },
        });
        await expect(readListAndDetails()).resolves.toEqual([
            { ok: false, error: "session_discussion_invalid_content" },
            { ok: false, error: "session_discussion_invalid_content" },
        ]);

        await db.sessionDiscussionMessage.update({
            where: { id: created.value.firstMessage.id },
            data: {
                producerV1: {
                    v: 1,
                    kind: "agent",
                    sessionId: "another-session",
                    runId: "run-cross-session",
                },
            },
        });
        await expect(readListAndDetails()).resolves.toEqual([
            { ok: false, error: "session_discussion_invalid_content" },
            { ok: false, error: "session_discussion_invalid_content" },
        ]);
    });

    it("stores an E2EE discussion using the client-derived equality tag only", async () => {
        const { owner, session } = await fixture({ encryptionMode: "e2ee" });
        const keyMaterial = new Uint8Array(32).fill(3);
        const tag = deriveSessionMutationEqualityTagV1({
            keyMaterial,
            sessionId: session.id,
            purpose: SESSION_DISCUSSION_MUTATION_EQUALITY_HKDF_LABEL_V1,
            canonicalIntent: "irrelevant-to-the-server",
        });
        const request = {
            creationLocalId: "c-e2ee",
            titleContent: { t: "encrypted", c: "dGl0bGU" },
            creationEqualityEvidenceV1: { kind: "e2eeTag", tag },
            firstMessage: {
                localId: "m-e2ee",
                content: { t: "encrypted", c: "Ym9keQ" },
                requestEqualityEvidenceV1: { kind: "e2eeTag", tag },
                mentionedAccountIds: [],
            },
        } as SessionDiscussionCreateRequestV1;

        const created = await createSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, request });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        expect(created.value.discussion.titleContent).toEqual({ t: "encrypted", c: "dGl0bGU" });

        const retry = await createSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, request });
        expect(retry.ok).toBe(true);
        if (!retry.ok) return;
        expect(retry.value.discussion.id).toBe(created.value.discussion.id);

        const otherTag = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: { ...request, creationEqualityEvidenceV1: { kind: "e2eeTag", tag: "C".repeat(43) } },
        });
        expect(otherTag).toEqual({ ok: false, error: "session_discussion_idempotency_conflict" });

        const otherFirstMessageTag = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: {
                ...request,
                firstMessage: {
                    ...request.firstMessage,
                    requestEqualityEvidenceV1: { kind: "e2eeTag", tag: "D".repeat(43) },
                },
            },
        });
        expect(otherFirstMessageTag).toEqual({ ok: false, error: "session_discussion_idempotency_conflict" });
    });

    it("allocates unique increasing sequences for concurrent posts", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-seq", title: "Sequences", text: "One", localId: "m-seq" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const posts = await Promise.all([1, 2, 3, 4].map((n) => postSessionDiscussionMessage({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: { localId: `p-seq-${n}`, content: plainBody(`Body ${n}`), mentionedAccountIds: [] },
        })));
        const seqs = posts.map((post) => (post.ok ? post.value.message.seq : -1)).sort((a, b) => a - b);
        expect(seqs).toEqual([2, 3, 4, 5]);
        const discussion = await db.sessionDiscussion.findUniqueOrThrow({ where: { id: created.value.discussion.id } });
        expect(discussion.messageSeq).toBe(5);
    });

    it("only accepts mention targets that currently read the Session", async () => {
        const { owner, collaborator, outsider, session } = await fixture();
        expect(await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({
                creationLocalId: "c-mention-bad",
                title: "Mentions",
                text: "Hi",
                localId: "m-mention-bad",
                mentionedAccountIds: [outsider.id],
            }),
        })).toEqual({ ok: false, error: "session_discussion_invalid_mention" });

        const good = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({
                creationLocalId: "c-mention-ok",
                title: "Mentions",
                text: "Hi",
                localId: "m-mention-ok",
                mentionedAccountIds: [collaborator.id],
            }),
        });
        expect(good.ok).toBe(true);
        if (!good.ok) return;
        expect(good.value.firstMessage.mentionedAccountIds).toEqual([collaborator.id]);
    });

    it("keeps archive reversible and gated on the real capability", async () => {
        const { owner, collaborator, session } = await fixture({ level: "edit" });
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-arch", title: "Archive", text: "Body", localId: "m-arch" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const discussionId = created.value.discussion.id;

        // The creator may rename and archive their own discussion with current input access.
        expect((await renameSessionDiscussion({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId,
            titleContent: plainTitle("Archive renamed"),
        })).ok).toBe(true);
        expect((await archiveSessionDiscussion({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId,
        })).ok).toBe(true);

        // Archived discussions stay readable but refuse new posts and renames.
        expect(await postSessionDiscussionMessage({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId,
            request: { localId: "p-arch", content: plainBody("blocked"), mentionedAccountIds: [] },
        })).toEqual({ ok: false, error: "session_discussion_archived" });
        expect((await getSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, discussionId })).ok).toBe(true);

        // Restore requires manageAccess, which an editor does not have.
        expect(await restoreSessionDiscussion({ authentication, actorAccountId: collaborator.id, sessionId: session.id, discussionId }))
            .toEqual({ ok: false, error: "session_discussion_manage_denied" });
        expect((await restoreSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, discussionId })).ok).toBe(true);
    });

    it("blocks discussion mutations while the Session itself is archived", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-sarch", title: "Session archive", text: "Body", localId: "m-sarch" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await db.session.update({ where: { id: session.id }, data: { archivedAt: new Date() } });
        expect(await postSessionDiscussionMessage({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: { localId: "p-sarch", content: plainBody("blocked"), mentionedAccountIds: [] },
        })).toEqual({ ok: false, error: "session_discussion_session_archived" });
        expect((await getSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
        })).ok).toBe(true);
        await db.session.update({ where: { id: session.id }, data: { archivedAt: null } });
    });

    it("pages messages by keyset sequence in both directions", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-page", title: "Pages", text: "1", localId: "m-page" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const discussionId = created.value.discussion.id;
        for (let n = 2; n <= 6; n += 1) {
            await postSessionDiscussionMessage({
                authentication,
                actorAccountId: owner.id,
                sessionId: session.id,
                discussionId,
                request: { localId: `p-page-${n}`, content: plainBody(String(n)), mentionedAccountIds: [] },
            });
        }

        const latest = await readSessionDiscussionMessages({
            authentication,
            actorAccountId: owner.id, sessionId: session.id, discussionId, limit: 2,
        });
        expect(latest.ok).toBe(true);
        if (!latest.ok) return;
        expect(latest.value.messages.map((m) => m.seq)).toEqual([5, 6]);
        expect(latest.value.hasMoreOlder).toBe(true);
        expect(latest.value.messageSeq).toBe(6);

        const older = await readSessionDiscussionMessages({
            authentication,
            actorAccountId: owner.id, sessionId: session.id, discussionId, beforeSeq: 5, limit: 2,
        });
        expect(older.ok).toBe(true);
        if (!older.ok) return;
        expect(older.value.messages.map((m) => m.seq)).toEqual([3, 4]);

        const tail = await readSessionDiscussionMessages({
            authentication,
            actorAccountId: owner.id, sessionId: session.id, discussionId, afterSeq: 4,
        });
        expect(tail.ok).toBe(true);
        if (!tail.ok) return;
        expect(tail.value.messages.map((m) => m.seq)).toEqual([5, 6]);
    });

    it("projects a local request identity only to the Account that created it", async () => {
        const { owner, collaborator, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-local", title: "Locals", text: "Body", localId: "m-local" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const otherView = await getSessionDiscussion({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
        });
        expect(otherView.ok).toBe(true);
        if (!otherView.ok) return;
        expect(otherView.value.discussion.creationLocalId).toBeNull();
        expect(otherView.value.discussion.latestMessage.localId).toBeNull();
    });

    it("never creates a read-state row for an Account the tracking owner has not baselined", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-cursor", title: "Cursors", text: "Body", localId: "m-cursor" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        expect(await setSessionDiscussionReadCursor({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            lastReadSeq: 1,
        })).toEqual({ ok: false, error: "session_not_tracked" });
        expect(await db.sessionDiscussionReadState.count({ where: { discussionId: created.value.discussion.id } })).toBe(0);

        const attention = await loadSessionDiscussionAttentionForAccounts({
            accountIds: [owner.id],
            sessionIds: [session.id],
        });
        expect(attention.get(owner.id)?.get(session.id)?.unreadConversationCount ?? 0).toBe(0);
    });

    it("advances an existing baseline monotonically and refuses a future sequence", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-adv", title: "Advance", text: "Body", localId: "m-adv" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const discussionId = created.value.discussion.id;
        await db.sessionDiscussionReadState.create({
            data: { discussionId, accountId: owner.id, lastReadSeq: 0 },
        });

        const advanced = await setSessionDiscussionReadCursor({
            authentication,
            actorAccountId: owner.id, sessionId: session.id, discussionId, lastReadSeq: 1,
        });
        expect(advanced).toEqual({ ok: true, value: { discussionId, lastReadSeq: 1, didChange: true } });

        const backwards = await setSessionDiscussionReadCursor({
            authentication,
            actorAccountId: owner.id, sessionId: session.id, discussionId, lastReadSeq: 0,
        });
        expect(backwards).toEqual({ ok: true, value: { discussionId, lastReadSeq: 1, didChange: false } });

        expect(await setSessionDiscussionReadCursor({
            authentication,
            actorAccountId: owner.id, sessionId: session.id, discussionId, lastReadSeq: 99,
        })).toEqual({ ok: false, error: "session_discussion_read_cursor_invalid" });
    });

    it("derives unread facts from an established baseline and never from the viewer's own human posts", async () => {
        const { owner, collaborator, session } = await fixture();
        await db.accountSessionFollow.create({
            data: { accountId: collaborator.id, sessionId: session.id, following: true, notificationLevel: "important" },
        });
        await db.accountSessionReadState.create({
            data: { accountId: collaborator.id, sessionId: session.id, lastViewedSessionSeq: 0 },
        });
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-unread", title: "Unread", text: "Body", localId: "m-unread" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const discussionId = created.value.discussion.id;
        await db.sessionDiscussionReadState.update({
            where: { discussionId_accountId: { discussionId, accountId: collaborator.id } },
            data: { lastReadSeq: 1 },
        });

        await postSessionDiscussionMessage({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId,
            request: { localId: "p-self", content: plainBody("my own"), mentionedAccountIds: [] },
        });
        let facts = await loadSessionDiscussionAttentionForAccounts({
            accountIds: [collaborator.id], sessionIds: [session.id],
        });
        expect(facts.get(collaborator.id)?.get(session.id)?.unreadConversationCount ?? 0).toBe(0);

        await postSessionDiscussionMessage({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId,
            request: { localId: "p-other", content: plainBody("from owner"), mentionedAccountIds: [collaborator.id] },
        });
        facts = await loadSessionDiscussionAttentionForAccounts({
            accountIds: [collaborator.id], sessionIds: [session.id],
        });
        expect(facts.get(collaborator.id)?.get(session.id)?.unreadConversationCount).toBe(1);
        expect(facts.get(collaborator.id)?.get(session.id)?.unreadMentionCount).toBe(1);
    });

    it("never counts a viewer's own human mention as their unread attention", async () => {
        const { owner, collaborator, session } = await fixture();
        await db.accountSessionFollow.create({
            data: { accountId: collaborator.id, sessionId: session.id, following: true, notificationLevel: "important" },
        });
        await db.accountSessionReadState.create({
            data: { accountId: collaborator.id, sessionId: session.id, lastViewedSessionSeq: 0 },
        });
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({
                creationLocalId: "c-self-mention", title: "Self", text: "Kickoff", localId: "m-self-mention",
            }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const discussionId = created.value.discussion.id;
        await db.sessionDiscussionReadState.update({
            where: { discussionId_accountId: { discussionId, accountId: collaborator.id } },
            data: { lastReadSeq: 1 },
        });

        const unreadMentions = async () => (await loadSessionDiscussionAttentionForAccounts({
            accountIds: [collaborator.id], sessionIds: [session.id],
        })).get(collaborator.id)?.get(session.id)?.unreadMentionCount ?? 0;

        // The viewer's own directly authored mention is not their attention.
        expect((await postSessionDiscussionMessage({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId,
            request: {
                localId: "p-self-mention",
                content: plainBody("cc me"),
                mentionedAccountIds: [collaborator.id],
            },
        })).ok).toBe(true);
        expect(await unreadMentions()).toBe(0);

        // Someone else's mention of the same viewer still counts.
        expect((await postSessionDiscussionMessage({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId,
            request: {
                localId: "p-other-mention",
                content: plainBody("cc you"),
                mentionedAccountIds: [collaborator.id],
            },
        })).ok).toBe(true);
        expect(await unreadMentions()).toBe(1);

        // An Agent-produced post that mentions the execution Account stays the
        // same attention it is for everyone else.
        expect((await postSessionDiscussionMessage({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId,
            producer: { v: 1, kind: "agent", sessionId: session.id } satisfies SessionDiscussionProducerV1,
            request: {
                localId: "p-agent-self-mention",
                content: plainBody("agent cc"),
                mentionedAccountIds: [collaborator.id],
            },
        })).ok).toBe(true);
        expect(await unreadMentions()).toBe(2);
    });

    it("keeps retained cursors inert after Unfollow for summaries, attention and cursor writes", async () => {
        const { owner, collaborator, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-inert", title: "Inert", text: "First", localId: "m-inert" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const discussionId = created.value.discussion.id;
        await db.accountSessionFollow.create({
            data: { accountId: collaborator.id, sessionId: session.id, following: false, notificationLevel: "none" },
        });
        await db.accountSessionReadState.create({
            data: { accountId: collaborator.id, sessionId: session.id, lastViewedSessionSeq: 0 },
        });
        await db.sessionDiscussionReadState.create({
            data: { discussionId, accountId: collaborator.id, lastReadSeq: 0 },
        });

        const listed = await listSessionDiscussions({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
        });
        expect(listed.ok).toBe(true);
        if (!listed.ok) return;
        expect(listed.value.discussions[0]).toMatchObject({
            lastReadSeq: null,
            unreadCount: 0,
            unreadMentionCount: 0,
        });

        const attention = await loadSessionDiscussionAttentionForAccounts({
            accountIds: [collaborator.id],
            sessionIds: [session.id],
        });
        expect(attention.get(collaborator.id)?.get(session.id)?.unreadConversationCount ?? 0).toBe(0);
        expect(attention.get(collaborator.id)?.get(session.id)?.unreadMentionCount ?? 0).toBe(0);

        expect(await setSessionDiscussionReadCursor({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId,
            lastReadSeq: 1,
        })).toEqual({ ok: false, error: "session_not_tracked" });
        expect(await db.sessionDiscussionReadState.findUnique({
            where: { discussionId_accountId: { discussionId, accountId: collaborator.id } },
        })).toMatchObject({ lastReadSeq: 0 });
    });

    it("separates human-origin discussion participation from Agent production and bare mentions", async () => {
        const { owner, collaborator, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-part", title: "Participation", text: "Body", localId: "m-part" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const discussionId = created.value.discussion.id;

        // The collaborator's only row is Agent production recorded against its
        // own execution Account, and the owner names it in a human post.
        const agentPost = await postSessionDiscussionMessage({
            authentication,
            actorAccountId: collaborator.id,
            sessionId: session.id,
            discussionId,
            request: { localId: "p-agent", content: plainBody("agent output"), mentionedAccountIds: [] },
            producer: { v: 1, kind: "agent", sessionId: session.id } satisfies SessionDiscussionProducerV1,
        });
        expect(agentPost.ok).toBe(true);
        const mentionPost = await postSessionDiscussionMessage({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId,
            request: { localId: "p-mention", content: plainBody("look here"), mentionedAccountIds: [collaborator.id] },
        });
        expect(mentionPost.ok).toBe(true);

        const participation = await inTx(async (tx) => ({
            owner: await loadSessionDiscussionParticipationForAccountInTx(tx, {
                accountId: owner.id, sessionIds: [session.id],
            }),
            collaborator: await loadSessionDiscussionParticipationForAccountInTx(tx, {
                accountId: collaborator.id, sessionIds: [session.id],
            }),
        }));
        expect(participation.owner.get(session.id)).toEqual({ humanAuthored: true, mentioned: false });
        expect(participation.collaborator.get(session.id)).toEqual({ humanAuthored: false, mentioned: true });

        // The relational arms select the same membership before any page limit.
        const selectIds = async (where: Parameters<typeof db.session.findMany>[0]) =>
            (await db.session.findMany({ ...where, select: { id: true } })).map((row) => row.id);
        expect(await selectIds({ where: { AND: [{ id: session.id }, createSessionsWithHumanDiscussionAuthorshipWhere(owner.id)] } }))
            .toEqual([session.id]);
        expect(await selectIds({ where: { AND: [{ id: session.id }, createSessionsWithHumanDiscussionAuthorshipWhere(collaborator.id)] } }))
            .toEqual([]);
        expect(await selectIds({ where: { AND: [{ id: session.id }, createSessionsWithDiscussionMentionWhere(collaborator.id)] } }))
            .toEqual([session.id]);
        expect(await selectIds({ where: { AND: [{ id: session.id }, createSessionsWithDiscussionMentionWhere(owner.id)] } }))
            .toEqual([]);
    });

    it("narrows discussion-cursor candidates to the caller's Sessions", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-narrow", title: "Narrow", text: "Body", localId: "m-narrow" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        await db.sessionDiscussionReadState.create({
            data: { discussionId: created.value.discussion.id, accountId: owner.id, lastReadSeq: 0 },
        });

        const candidates = await inTx(async (tx) => ({
            all: await listSessionIdsWithDiscussionCursorsInTx(tx, { accountIds: [owner.id] }),
            narrowed: await listSessionIdsWithDiscussionCursorsInTx(tx, {
                accountIds: [owner.id], sessionIds: ["some-other-session"],
            }),
        }));
        expect(candidates.all).toContain(session.id);
        expect(candidates.narrowed).toEqual([]);
    });

    it("wakes every current Session reader for a discussion write", async () => {
        const { owner, collaborator, session } = await fixture();
        await db.accountChange.deleteMany({ where: { accountId: { in: [owner.id, collaborator.id] } } });
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-wake", title: "Wake", text: "Body", localId: "m-wake" }),
        });
        expect(created.ok).toBe(true);

        const changes = await db.accountChange.findMany({
            where: { kind: "session", entityId: session.id, accountId: { in: [owner.id, collaborator.id] } },
        });
        expect(changes.map((change) => change.accountId).sort()).toEqual([owner.id, collaborator.id].sort());
        for (const change of changes) {
            expect(change.hint).toEqual({ v: 1, sessionDiscussions: true });
        }
    });

    it("lists active and archived discussions separately with a stable keyset cursor", async () => {
        const { owner, session } = await fixture();
        const ids: string[] = [];
        for (const n of [1, 2, 3]) {
            const created = await createSessionDiscussion({
                authentication,
                actorAccountId: owner.id,
                sessionId: session.id,
                request: createRequest({ creationLocalId: `c-list-${n}`, title: `List ${n}`, text: "Body", localId: `m-list-${n}` }),
            });
            expect(created.ok).toBe(true);
            if (created.ok) ids.push(created.value.discussion.id);
        }
        await archiveSessionDiscussion({ authentication, actorAccountId: owner.id, sessionId: session.id, discussionId: ids[0]! });

        const page = await listSessionDiscussions({ authentication, actorAccountId: owner.id, sessionId: session.id, limit: 1 });
        expect(page.ok).toBe(true);
        if (!page.ok) return;
        expect(page.value.discussions).toHaveLength(1);
        expect(page.value.nextCursor).not.toBeNull();

        const next = await listSessionDiscussions({
            authentication,
            actorAccountId: owner.id, sessionId: session.id, limit: 5, cursor: page.value.nextCursor ?? undefined,
        });
        expect(next.ok).toBe(true);
        if (!next.ok) return;
        const listed = [...page.value.discussions, ...next.value.discussions].map((d) => d.id);
        expect(listed).not.toContain(ids[0]);
        expect(new Set(listed).size).toBe(listed.length);

        await expect(listSessionDiscussions({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            cursor: "not-a-discussion-cursor",
        })).resolves.toEqual({ ok: false, error: "session_discussion_invalid_content" });

        const archived = await listSessionDiscussions({ authentication, actorAccountId: owner.id, sessionId: session.id, state: "archived" });
        expect(archived.ok).toBe(true);
        if (!archived.ok) return;
        expect(archived.value.discussions.map((d) => d.id)).toContain(ids[0]);
    });

    it("cascades discussion content when its Session is deleted", async () => {
        const { owner, session } = await fixture();
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: createRequest({ creationLocalId: "c-del", title: "Delete", text: "Body", localId: "m-del" }),
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await db.sessionDiscussion.deleteMany({ where: { sessionId: session.id } });
        expect(await db.sessionDiscussionMessage.count({ where: { sessionId: session.id } })).toBe(0);
        expect(await db.sessionDiscussionMessageMention.count({
            where: { messageId: created.value.firstMessage.id },
        })).toBe(0);
    });
});
