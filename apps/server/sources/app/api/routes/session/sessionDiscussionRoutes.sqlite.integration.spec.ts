import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyRequest } from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import { SESSION_DISCUSSION_HTTP_PATHS_V1 } from "@happier-dev/protocol";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createSessionDiscussion } from "@/app/session/discussions/mutations";
import { registerSessionDiscussionRoutes } from "./registerSessionDiscussionRoutes";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";

const authentication = createPresentUserSessionAccessAuthentication();

const plainTitle = (title: string) => ({ t: "plain" as const, v: { v: 1, title } });
const plainBody = (text: string) => ({ t: "plain" as const, v: { v: 1, parts: [{ t: "text", text }] } });

/**
 * Transport-level contract for the mounted Session discussion family.
 *
 * The service owns authorization, idempotency and encryption-mode decisions and
 * proves them at its own boundary; this suite proves the parts only the real
 * HTTP entry can establish — the fail-closed server feature gate, the strict
 * request schema that keeps Agent provenance unforgeable from a public caller,
 * the typed failure → status mapping, and querystring paging coercion.
 */
describe("Session discussion HTTP transport (SQLite)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-discussion-routes-", initAuth: false });
    }, 120_000);
    afterAll(async () => { await harness?.close(); });

    const featureEnvKeys = [
        "HAPPIER_FEATURE_SESSIONS__ENABLED",
        "HAPPIER_FEATURE_SESSIONS_COLLABORATION__ENABLED",
        "HAPPIER_FEATURE_SESSIONS_CONVERSATIONS__ENABLED",
    ] as const;
    const savedEnv = new Map<string, string | undefined>();

    beforeEach(() => {
        for (const key of featureEnvKeys) {
            savedEnv.set(key, process.env[key]);
            process.env[key] = "1";
        }
    });
    afterEach(() => {
        for (const key of featureEnvKeys) {
            const previous = savedEnv.get(key);
            if (previous === undefined) delete process.env[key];
            else process.env[key] = previous;
        }
    });

    /**
     * Authentication is the one genuine boundary: the real decorator verifies a
     * credential and stamps `userId`/`authAuthority`. Everything below it — the
     * feature gate, schemas, access, service and storage — stays real.
     */
    function createApp(
        initialAccountId: string,
        authenticationKind: "present_user" | "api_token" | "external_action" = "present_user",
        externalAction?: Readonly<{
            effectActionId: string;
            targetSessionId: string;
        }>,
    ) {
        const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        const actor = { accountId: initialAccountId };
        app.decorate("authenticate", async (request: FastifyRequest) => {
            request.userId = actor.accountId;
            request.authAuthority = authenticationKind === "present_user"
                ? "present_user"
                : "account_automation";
            request.authTokenKind = authenticationKind === "present_user"
                ? "account"
                : "api_token";
            if (authenticationKind === "external_action") {
                request.externalActionExecutionAuthorized = true;
                request.externalActionEffectActionId = externalAction?.effectActionId;
                request.externalActionExecutionTarget = externalAction
                    ? { kind: "session", sessionId: externalAction.targetSessionId }
                    : undefined;
            }
        });
        registerSessionDiscussionRoutes(app);
        return { app, actor };
    }

    async function fixture(params: Readonly<{ level?: "view" | "edit" | "admin" }> = {}) {
        const account = async () => await db.account.create({
            data: { publicKey: crypto.randomUUID(), encryptionMode: "plain" },
        });
        const owner = await account();
        const collaborator = await account();
        const outsider = await account();
        const session = await db.session.create({
            data: {
                accountId: owner.id,
                tag: crypto.randomUUID(),
                encryptionMode: "plain",
                metadata: JSON.stringify({ t: "plain", v: {} }),
            },
        });
        await db.sessionShare.create({
            data: {
                sessionId: session.id,
                sharedByUserId: owner.id,
                sharedWithUserId: collaborator.id,
                accessLevel: params.level ?? "edit",
            },
        });
        return { owner, collaborator, outsider, session };
    }

    async function seedDiscussion(params: Readonly<{
        ownerId: string;
        sessionId: string;
        creationLocalId: string;
        localId: string;
    }>) {
        const created = await createSessionDiscussion({
            authentication,
            actorAccountId: params.ownerId,
            sessionId: params.sessionId,
            request: {
                creationLocalId: params.creationLocalId,
                titleContent: plainTitle("Rollout"),
                firstMessage: { localId: params.localId, content: plainBody("Start"), mentionedAccountIds: [] },
            },
        });
        if (!created.ok) throw new Error(`discussion seed failed: ${created.error}`);
        return created.value.discussion;
    }

    function collectionUrl(sessionId: string): string {
        return SESSION_DISCUSSION_HTTP_PATHS_V1.collection.replace(":sessionId", sessionId);
    }
    function messagesUrl(sessionId: string, discussionId: string): string {
        return SESSION_DISCUSSION_HTTP_PATHS_V1.messages
            .replace(":sessionId", sessionId)
            .replace(":discussionId", discussionId);
    }
    function discussionUrl(sessionId: string, discussionId: string): string {
        return SESSION_DISCUSSION_HTTP_PATHS_V1.discussion
            .replace(":sessionId", sessionId)
            .replace(":discussionId", discussionId);
    }
    function archiveUrl(sessionId: string, discussionId: string): string {
        return SESSION_DISCUSSION_HTTP_PATHS_V1.archive
            .replace(":sessionId", sessionId)
            .replace(":discussionId", discussionId);
    }
    function restoreUrl(sessionId: string, discussionId: string): string {
        return SESSION_DISCUSSION_HTTP_PATHS_V1.restore
            .replace(":sessionId", sessionId)
            .replace(":discussionId", discussionId);
    }

    it("keeps the whole family unavailable while the conversations server feature is off", async () => {
        const { owner, session } = await fixture();
        const discussion = await seedDiscussion({
            ownerId: owner.id, sessionId: session.id, creationLocalId: "gate-c", localId: "gate-m",
        });
        delete process.env.HAPPIER_FEATURE_SESSIONS_CONVERSATIONS__ENABLED;
        const { app } = createApp(owner.id);
        try {
            const listed = await app.inject({ method: "GET", url: collectionUrl(session.id) });
            expect(listed.statusCode).toBe(404);
            // The refusal stays inside this family's declared error union, so a
            // client parses it exactly like any other discussion failure.
            expect(listed.json()).toEqual({ error: "session_discussions_unavailable" });

            const posted = await app.inject({
                method: "POST",
                url: messagesUrl(session.id, discussion.id),
                payload: { localId: "gate-p", content: plainBody("blocked"), mentionedAccountIds: [] },
            });
            expect(posted.statusCode).toBe(404);
            expect(await db.sessionDiscussionMessage.count({ where: { localId: "gate-p" } })).toBe(0);
        } finally {
            await app.close();
        }
    });

    it("refuses a caller-asserted Agent producer on the public post transport", async () => {
        const { owner, session } = await fixture();
        const discussion = await seedDiscussion({
            ownerId: owner.id, sessionId: session.id, creationLocalId: "forge-c", localId: "forge-m",
        });
        const { app } = createApp(owner.id);
        try {
            const forged = await app.inject({
                method: "POST",
                url: messagesUrl(session.id, discussion.id),
                payload: {
                    localId: "forge-p",
                    content: plainBody("I am the Agent"),
                    mentionedAccountIds: [],
                    // Host-stamped provenance is derived only behind the
                    // authenticated current-publisher socket fence.
                    producerV1: { v: 1, kind: "agent", sessionId: session.id, runId: "run-forged" },
                },
            });
            expect(forged.statusCode).toBe(400);
            expect(await db.sessionDiscussionMessage.count({ where: { localId: "forge-p" } })).toBe(0);

            // The same body without the forged field is accepted and stays human.
            const honest = await app.inject({
                method: "POST",
                url: messagesUrl(session.id, discussion.id),
                payload: { localId: "forge-p", content: plainBody("I am the Agent"), mentionedAccountIds: [] },
            });
            expect(honest.statusCode, honest.body).toBe(200);
            expect(honest.json().message).toMatchObject({
                authorAccountId: owner.id,
                producerV1: null,
            });
        } finally {
            await app.close();
        }
    });

    it("rejects aliased creation and first-message retry identities before mutation", async () => {
        const { owner, session } = await fixture();
        const { app } = createApp(owner.id);
        try {
            const response = await app.inject({
                method: "POST",
                url: collectionUrl(session.id),
                payload: {
                    creationLocalId: "same-local-id",
                    titleContent: plainTitle("Distinct retry identities"),
                    firstMessage: {
                        localId: "same-local-id",
                        content: plainBody("Do not alias these operations"),
                        mentionedAccountIds: [],
                    },
                },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ error: "session_discussion_invalid_content" });
            expect(await db.sessionDiscussion.count({
                where: { sessionId: session.id, creationLocalId: "same-local-id" },
            })).toBe(0);
        } finally {
            await app.close();
        }
    });

    it("returns the canonical present-user refusal for PAT mutation calls", async () => {
        const { owner, session } = await fixture();
        const discussion = await seedDiscussion({
            ownerId: owner.id, sessionId: session.id, creationLocalId: "pat-c", localId: "pat-m",
        });
        const { app } = createApp(owner.id, "api_token");
        try {
            const posted = await app.inject({
                method: "POST",
                url: messagesUrl(session.id, discussion.id),
                payload: { localId: "pat-p", content: plainBody("blocked"), mentionedAccountIds: [] },
            });
            expect(posted.statusCode).toBe(403);
            expect(posted.json()).toEqual({ error: "present_user_required" });
            expect(await db.sessionDiscussionMessage.count({ where: { localId: "pat-p" } })).toBe(0);

            const restored = await app.inject({
                method: "POST",
                url: restoreUrl(session.id, discussion.id),
            });
            expect(restored.statusCode).toBe(403);
            expect(restored.json()).toEqual({ error: "present_user_required" });
        } finally {
            await app.close();
        }
    });

    it("admits only an exact proof-bound external Discussion post", async () => {
        const { owner, session } = await fixture();
        const discussion = await seedDiscussion({
            ownerId: owner.id, sessionId: session.id, creationLocalId: "external-c", localId: "external-m",
        });
        const postUrl = messagesUrl(session.id, discussion.id);
        const payload = { localId: "external-p", content: plainBody("from the public Action"), mentionedAccountIds: [] };

        const { app: admitted } = createApp(owner.id, "external_action", {
            effectActionId: "session.discussion.post",
            targetSessionId: session.id,
        });
        try {
            const response = await admitted.inject({ method: "POST", url: postUrl, payload });
            expect(response.statusCode, response.body).toBe(200);
            // The server derives Agent provenance from its own verified
            // automation authority; the public body still carries none.
            expect(response.json().message).toMatchObject({
                authorAccountId: owner.id,
                producerV1: { v: 1, kind: "agent", sessionId: session.id },
            });
        } finally {
            await admitted.close();
        }

        for (const [suffix, effectActionId, targetSessionId] of [
            ["wrong-action", "session.discussion.read", session.id],
            ["wrong-target", "session.discussion.post", "another-session"],
        ] as const) {
            const { app } = createApp(owner.id, "external_action", { effectActionId, targetSessionId });
            try {
                const response = await app.inject({
                    method: "POST",
                    url: postUrl,
                    payload: { ...payload, localId: `external-${suffix}` },
                });
                expect(response.statusCode).toBe(403);
                expect(response.json()).toEqual({ error: "present_user_required" });
                expect(await db.sessionDiscussionMessage.count({
                    where: { localId: `external-${suffix}` },
                })).toBe(0);
            } finally {
                await app.close();
            }
        }
    });

    it("rejoins a lost post retry and conflicts a changed one under the same localId", async () => {
        const { owner, session } = await fixture();
        const discussion = await seedDiscussion({
            ownerId: owner.id, sessionId: session.id, creationLocalId: "retry-c", localId: "retry-m",
        });
        const { app } = createApp(owner.id);
        try {
            const url = messagesUrl(session.id, discussion.id);
            const payload = { localId: "retry-p", content: plainBody("only once"), mentionedAccountIds: [] };

            const first = await app.inject({ method: "POST", url, payload });
            expect(first.statusCode).toBe(200);
            // A lost acknowledgement is retried verbatim: the same durable row
            // is reported rather than a second message.
            const retried = await app.inject({ method: "POST", url, payload });
            expect(retried.statusCode).toBe(200);
            expect(retried.json().message.id).toBe(first.json().message.id);
            expect(retried.json().message.seq).toBe(first.json().message.seq);
            expect(await db.sessionDiscussionMessage.count({ where: { localId: "retry-p" } })).toBe(1);

            const changed = await app.inject({
                method: "POST",
                url,
                payload: { localId: "retry-p", content: plainBody("different text"), mentionedAccountIds: [] },
            });
            expect(changed.statusCode).toBe(409);
            expect(changed.json()).toEqual({ error: "session_discussion_idempotency_conflict" });
        } finally {
            await app.close();
        }
    });

    it("maps discussion denial to an absence for a caller without Session access", async () => {
        const { owner, outsider, session } = await fixture();
        const discussion = await seedDiscussion({
            ownerId: owner.id, sessionId: session.id, creationLocalId: "acl-c", localId: "acl-m",
        });
        const { app } = createApp(outsider.id);
        try {
            const details = await app.inject({ method: "GET", url: discussionUrl(session.id, discussion.id) });
            expect(details.statusCode).toBe(404);
            expect(details.json()).toEqual({ error: "session_discussion_not_found" });

            const listed = await app.inject({ method: "GET", url: collectionUrl(session.id) });
            expect(listed.statusCode).toBe(404);
            expect(listed.json()).toEqual({ error: "session_discussion_read_denied" });
        } finally {
            await app.close();
        }
    });

    it("blocks posting into an archived discussion and accepts again after restore", async () => {
        const { owner, session } = await fixture();
        const discussion = await seedDiscussion({
            ownerId: owner.id, sessionId: session.id, creationLocalId: "arch-c", localId: "arch-m",
        });
        const { app } = createApp(owner.id);
        try {
            expect((await app.inject({ method: "POST", url: archiveUrl(session.id, discussion.id) })).statusCode).toBe(200);

            const blocked = await app.inject({
                method: "POST",
                url: messagesUrl(session.id, discussion.id),
                payload: { localId: "arch-p", content: plainBody("too late"), mentionedAccountIds: [] },
            });
            expect(blocked.statusCode).toBe(409);
            expect(blocked.json()).toEqual({ error: "session_discussion_archived" });
            expect(await db.sessionDiscussionMessage.count({ where: { localId: "arch-p" } })).toBe(0);

            expect((await app.inject({ method: "POST", url: restoreUrl(session.id, discussion.id) })).statusCode).toBe(200);
            const accepted = await app.inject({
                method: "POST",
                url: messagesUrl(session.id, discussion.id),
                payload: { localId: "arch-p", content: plainBody("too late"), mentionedAccountIds: [] },
            });
            expect(accepted.statusCode).toBe(200);
        } finally {
            await app.close();
        }
    });

    it("coerces and bounds the message paging querystring", async () => {
        const { owner, session } = await fixture();
        const discussion = await seedDiscussion({
            ownerId: owner.id, sessionId: session.id, creationLocalId: "page-c", localId: "page-m",
        });
        const { app } = createApp(owner.id);
        try {
            const url = messagesUrl(session.id, discussion.id);
            for (const text of ["second", "third"]) {
                expect((await app.inject({
                    method: "POST",
                    url,
                    payload: { localId: `page-${text}`, content: plainBody(text), mentionedAccountIds: [] },
                })).statusCode).toBe(200);
            }

            // `limit` arrives as a string on the wire; the route's schema is the
            // only place that can turn it into the number the service bounds.
            const page = await app.inject({ method: "GET", url: `${url}?limit=2` });
            expect(page.statusCode).toBe(200);
            const body = page.json();
            expect(body.messages).toHaveLength(2);
            expect(body.hasMoreOlder).toBe(true);
            expect(body.messageSeq).toBe(3);

            const older = await app.inject({
                method: "GET",
                url: `${url}?limit=2&beforeSeq=${body.messages[0].seq}`,
            });
            expect(older.statusCode).toBe(200);
            expect(older.json().hasMoreOlder).toBe(false);
        } finally {
            await app.close();
        }
    });
});
