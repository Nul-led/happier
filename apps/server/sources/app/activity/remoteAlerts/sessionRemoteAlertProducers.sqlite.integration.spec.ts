import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_ATTENTION_DELIVERY_POLICY_V1,
    deriveAccountRemoteAlertPolicyV1,
    type ActivityRemoteAlertV2,
    type DeviceRemoteAlertPolicyV1,
} from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createPresentUserSessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication.testkit";
import { createFakeSocket, getSocketHandler } from "@/app/api/testkit/socketHarness";
import { createSessionPublisherPresence, type CurrentSessionPublisherAuthority } from "@/app/presence/sessionPublisherPresence";

const sendPushNotificationsAsyncSpy = vi.hoisted(() => vi.fn(async (messages: unknown[]) => messages.map(() => ({ status: "ok" }))));

vi.mock("expo-server-sdk", () => {
    class Expo {
        static isExpoPushToken() { return true; }
        chunkPushNotifications(messages: unknown[]) { return [messages]; }
        async sendPushNotificationsAsync(chunk: unknown[]) { return await sendPushNotificationsAsyncSpy(chunk); }
        async getPushNotificationReceiptsAsync() { return {}; }
    }
    return { __esModule: true, Expo };
});

const { setSessionResponsibility: setSessionResponsibilityWithAuthentication } = await import("@/app/session/access/sessionResponsibilityService");
const { publishSessionReadyProjectionUpdate } = await import("@/app/session/ready/publishSessionReadyProjectionUpdate");
const {
    applySessionTurnMutation: applySessionTurnMutationWithAuthentication,
    createSessionMessage,
    updateSessionAgentState,
} = await import("@/app/session/sessionWriteService");
const {
    createSessionDiscussion,
    postSessionDiscussionMessage,
    postSessionDiscussionMessageInTx,
} = await import("@/app/session/discussions/mutations");
const { machineUpdateHandler } = await import("@/app/api/socket/machineUpdateHandler");

const discussionAuthentication = createPresentUserSessionAccessAuthentication();
const plainDiscussionTitle = (title: string) => ({ t: "plain" as const, v: { v: 1 as const, title } });
const plainDiscussionBody = (text: string) => ({
    t: "plain" as const,
    v: { v: 1 as const, parts: [{ t: "text" as const, text }] },
});

async function setSessionResponsibility(
    input: Omit<Parameters<typeof setSessionResponsibilityWithAuthentication>[0], "authentication">,
) {
    return await setSessionResponsibilityWithAuthentication({
        ...input,
        authentication: { env: process.env, authority: "present_user", authenticationEvidence: [] },
    });
}

async function applySessionTurnMutation(
    input: Omit<Parameters<typeof applySessionTurnMutationWithAuthentication>[0], "authentication">,
) {
    return await applySessionTurnMutationWithAuthentication({
        ...input,
        authentication: { env: process.env, authority: "present_user", authenticationEvidence: [] },
    });
}

const DEVICE_POLICY: DeviceRemoteAlertPolicyV1 = {
    v: 1, enabled: true, nativeConsumer: "ios_service_extension_v1",
    quietHoursOverride: { mode: "account" }, foregroundBehavior: "account",
    previewCeiling: "account", soundVolume: 1,
};

async function enrollRemoteAlerts(accountId: string): Promise<string> {
    const settings = JSON.stringify({
        sessionRemoteAlertsEnabled: true,
        attentionDeliveryPolicyV1: DEFAULT_ATTENTION_DELIVERY_POLICY_V1,
    });
    const policy = deriveAccountRemoteAlertPolicyV1(JSON.parse(settings));
    const account = await db.account.update({
        where: { id: accountId }, data: { settings, settingsVersion: { increment: 1 } },
        select: { settingsVersion: true },
    });
    await db.account.update({
        where: { id: accountId },
        data: { remoteAlertPolicy: { settingsVersion: account.settingsVersion, policy } },
    });
    const token = `ExponentPushToken[${accountId}]`;
    await db.accountPushToken.create({ data: { accountId, token, remoteAlerts: DEVICE_POLICY } });
    return token;
}

async function registerRuntimePublisher(params: Readonly<{
    accountId: string;
    machineId: string;
    sessionId: string;
}>): Promise<CurrentSessionPublisherAuthority> {
    await db.accessKey.create({ data: { ...params, data: "encrypted" } });
    const registration = await createSessionPublisherPresence().registerPublisher({
        socket: {},
        binding: params,
        completeActivitySnapshot: { state: "unknown", activeCount: 0 },
    });
    if (registration.status !== "registered") throw new Error("expected publisher registration");
    return { ...params, committedFence: registration.committedFence };
}

async function submittedAlerts(): Promise<ActivityRemoteAlertV2[]> {
    // Producers schedule the transport after commit and a single committed
    // Discussion can schedule both its all-messages and mention legs. Wait for
    // the call set to settle instead of returning after the first transport.
    let lastCount = -1;
    let stablePasses = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const count = sendPushNotificationsAsyncSpy.mock.calls.length;
        stablePasses = count === lastCount ? stablePasses + 1 : 0;
        if (count > 0 && stablePasses >= 3) break;
        lastCount = count;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return sendPushNotificationsAsyncSpy.mock.calls
        .flatMap(([chunk]) => chunk as Array<{ data: ActivityRemoteAlertV2 }>)
        .map((message) => message.data)
        .filter((data): data is ActivityRemoteAlertV2 => data?.type === "activity_alert" && data.v === 2);
}

function submittedBodies(): string[] {
    return sendPushNotificationsAsyncSpy.mock.calls.flatMap(([messages]) =>
        (messages as Array<{ body?: string }>).flatMap((message) =>
            typeof message.body === "string" ? [message.body] : []));
}

function submittedTokens(): string[] {
    return sendPushNotificationsAsyncSpy.mock.calls
        .flatMap(([chunk]) => chunk as Array<{ to: string; data?: { type?: string } }>)
        .filter((message) => message.data?.type === "activity_alert")
        .map((message) => message.to);
}

describe("committed session mutations produce Home remote alerts", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "remote-alert-producers-", initAuth: false,
            env: {
                HAPPIER_SERVER_IDENTITY_ID: "srv_home_a",
                HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: "true",
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            },
        });
    }, 120_000);
    afterAll(async () => { await harness?.close(); });
    afterEach(() => { sendPushNotificationsAsyncSpy.mockClear(); });

    it("alerts the assignment target from the committed responsibility transition", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const assignee = await db.account.create({ data: { publicKey: randomUUID() } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: assignee.id, accessLevel: "view",
        } });
        await enrollRemoteAlerts(owner.id);
        await enrollRemoteAlerts(assignee.id);

        const result = await setSessionResponsibility({
            actorAccountId: owner.id, sessionId: session.id, responsibleAccountId: assignee.id,
        });
        expect(result).toMatchObject({ ok: true, changed: true, autoFollowed: true });
        expect(await submittedAlerts()).toEqual([expect.objectContaining({
            sessionId: session.id, accountId: assignee.id, event: { type: "assigned" },
        })]);
        expect(submittedBodies()).toEqual(["Following because you were assigned."]);

        // Re-submitting the current desired state is a no-op and alerts nobody.
        sendPushNotificationsAsyncSpy.mockClear();
        await setSessionResponsibility({ actorAccountId: owner.id, sessionId: session.id, responsibleAccountId: assignee.id });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsyncSpy.mock.calls).toEqual([]);
    });

    it("does not claim assignment caused Follow when the assignee already followed", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const assignee = await db.account.create({ data: { publicKey: randomUUID() } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: assignee.id, accessLevel: "view",
        } });
        await db.accountSessionFollow.create({ data: {
            sessionId: session.id, accountId: assignee.id, following: true, notificationLevel: "important",
        } });
        await enrollRemoteAlerts(assignee.id);

        const result = await setSessionResponsibility({
            actorAccountId: owner.id, sessionId: session.id, responsibleAccountId: assignee.id,
        });
        expect(result).toMatchObject({ ok: true, changed: true, autoFollowed: false });
        expect(await submittedAlerts()).toHaveLength(1);
        expect(submittedBodies()).toEqual(["A session was assigned to you."]);
    });

    it.each([
        ["disabled auto-Follow", false],
        ["explicit Unfollow", true],
    ] as const)("keeps assignment in-app but sends no remote alert after %s", async (_scenario, explicitUnfollow) => {
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const assignee = await db.account.create({
            data: {
                publicKey: randomUUID(),
                sessionAutoFollowAssigned: explicitUnfollow,
            },
        });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: assignee.id, accessLevel: "view",
        } });
        if (explicitUnfollow) {
            await db.accountSessionFollow.create({ data: {
                sessionId: session.id,
                accountId: assignee.id,
                following: false,
                notificationLevel: "none",
            } });
        }
        await enrollRemoteAlerts(assignee.id);

        const result = await setSessionResponsibility({
            actorAccountId: owner.id,
            sessionId: session.id,
            responsibleAccountId: assignee.id,
        });
        expect(result).toMatchObject({ ok: true, changed: true, autoFollowed: false });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsyncSpy.mock.calls).toEqual([]);
        expect(await db.session.findUnique({
            where: { id: session.id },
            select: { responsibleAccountId: true },
        })).toEqual({ responsibleAccountId: assignee.id });
    });

    it("does not notify the actor about their own self-assignment, but still applies auto-Follow", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await enrollRemoteAlerts(owner.id);

        const result = await setSessionResponsibility({
            actorAccountId: owner.id, sessionId: session.id, responsibleAccountId: owner.id,
        });
        expect(result).toMatchObject({ ok: true, changed: true, autoFollowed: true });
        // Self-assignment is distinct from auto-Follow: no one-shot self notification.
        // The canonical badge coalescer may still publish its content-free
        // projection wake for the responsibility change; that is not an
        // Activity alert and must not be suppressed by this producer contract.
        expect(await submittedAlerts()).toEqual([]);
        const follow = await db.accountSessionFollow.findUnique({
            where: { accountId_sessionId: { accountId: owner.id, sessionId: session.id } },
        });
        expect(follow).toMatchObject({ following: true });
    });

    it("alerts a follower on ready and leaves the owner to a trusted persistent runtime's rich sender", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const follower = await db.account.create({ data: { publicKey: randomUUID() } });
        const machine = await db.machine.create({ data: {
            id: `machine-${randomUUID()}`, accountId: owner.id, metadata: "{}", kind: "persistent",
        } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: follower.id, accessLevel: "view",
        } });
        await db.accountSessionFollow.create({ data: {
            sessionId: session.id, accountId: follower.id, following: true, notificationLevel: "important",
        } });
        await enrollRemoteAlerts(owner.id);
        await enrollRemoteAlerts(follower.id);
        const publisherAuthority = await registerRuntimePublisher({
            accountId: owner.id, machineId: machine.id, sessionId: session.id,
        });

        await publishSessionReadyProjectionUpdate({
            sessionId: session.id,
            readyProjection: { latestReadyEventSeq: 9, latestReadyEventAt: Date.now() },
            runtimeComposition: {
                publisherAuthority,
                ownerActivityDelivery: "rich_sender",
            },
        });

        expect(await submittedAlerts()).toEqual([expect.objectContaining({
            sessionId: session.id, accountId: follower.id,
            event: { type: "ready", sequenceDomain: "session_transcript", messageSeq: 9 },
        })]);
    });

    it.each(["ephemeral_session_runner", null] as const)(
        "keeps the Session owner and eligible collaborator on the Home leg when the committed ready event has %s rich-sender custody",
        async (machineKind) => {
            const owner = await db.account.create({ data: { publicKey: randomUUID() } });
            const follower = await db.account.create({ data: { publicKey: randomUUID() } });
            const machine = machineKind === null ? null : await db.machine.create({ data: {
                id: `machine-${randomUUID()}`, accountId: owner.id, metadata: "{}", kind: machineKind,
            } });
            const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
            await db.sessionShare.create({ data: {
                sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: follower.id, accessLevel: "view",
            } });
            await db.accountSessionFollow.create({ data: {
                sessionId: session.id, accountId: follower.id, following: true, notificationLevel: "important",
            } });
            const [ownerToken, followerToken] = await Promise.all([
                enrollRemoteAlerts(owner.id),
                enrollRemoteAlerts(follower.id),
            ]);

            await publishSessionReadyProjectionUpdate({
                sessionId: session.id,
                readyProjection: { latestReadyEventSeq: 10, latestReadyEventAt: Date.now() },
                ...(machine ? { runtimeComposition: {
                    publisherAuthority: {
                        accountId: owner.id, machineId: machine.id, sessionId: session.id,
                        committedFence: session.lastActiveAt,
                    },
                    ownerActivityDelivery: "rich_sender" as const,
                } } : {}),
            });

            expect(await submittedAlerts()).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    sessionId: session.id, accountId: owner.id,
                    event: { type: "ready", sequenceDomain: "session_transcript", messageSeq: 10 },
                }),
                expect.objectContaining({
                    sessionId: session.id, accountId: follower.id,
                    event: { type: "ready", sequenceDomain: "session_transcript", messageSeq: 10 },
                }),
            ]));
            expect(submittedTokens().sort()).toEqual([ownerToken, followerToken].sort());
        },
    );

    it.each(["permission", "user_action"] as const)("alerts an eligible follower after a new %s occurrence commits", async (requestKind) => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const follower = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        const machine = await db.machine.create({ data: {
            id: `machine-${randomUUID()}`, accountId: owner.id, metadata: "{}", kind: "persistent",
        } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: follower.id,
            accessLevel: "edit", canApprovePermissions: true,
        } });
        await db.accountSessionFollow.create({ data: {
            sessionId: session.id, accountId: follower.id, following: true, notificationLevel: "important",
        } });
        await Promise.all([enrollRemoteAlerts(owner.id), enrollRemoteAlerts(follower.id)]);
        const publisherAuthority = await registerRuntimePublisher({
            accountId: owner.id, machineId: machine.id, sessionId: session.id,
        });
        const turnId = `turn-${randomUUID()}`;
        expect(await applySessionTurnMutation({
            actorUserId: owner.id,
            mutation: {
                v: 1, sessionId: session.id, mutationId: randomUUID(), action: "begin",
                turnId, observedAt: Date.now(),
            },
        })).toMatchObject({ ok: true });
        const current = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        const occurrence = {
            requestId: randomUUID(), sourceTurnId: turnId, requestKind, occurredAt: Date.now(),
        };
        const update = {
            actorUserId: owner.id, sessionId: session.id,
            expectedVersion: current.agentStateVersion, agentStateCiphertext: "new-request-state",
            pendingPermissionRequestCount: requestKind === "permission" ? 1 : 0,
            pendingUserActionRequestCount: requestKind === "user_action" ? 1 : 0,
            userActionRequiredOccurrences: [occurrence],
            runtimeComposition: {
                publisherAuthority,
                ownerActivityDelivery: "rich_sender" as const,
            },
        };
        expect(await updateSessionAgentState(update)).toMatchObject({ ok: true, version: current.agentStateVersion + 1 });

        expect(await submittedAlerts()).toEqual([expect.objectContaining({
            sessionId: session.id, accountId: follower.id,
            event: { type: requestKind === "permission" ? "permission_request" : "user_action_request" },
        })]);

        sendPushNotificationsAsyncSpy.mockClear();
        // A lost acknowledgement retries the same CAS. A refreshed producer
        // sends no occurrence for an already known request, even if state or
        // summary counts change. Neither path establishes a new alert.
        expect(await updateSessionAgentState(update)).toMatchObject({ ok: false, error: "version-mismatch" });
        expect(await updateSessionAgentState({
            ...update, expectedVersion: current.agentStateVersion + 1,
            agentStateCiphertext: "refreshed-request-state", userActionRequiredOccurrences: [],
            pendingPermissionRequestCount: 2, pendingUserActionRequestCount: 2,
        })).toMatchObject({ ok: true });
        expect(await submittedAlerts()).toEqual([]);

        // A schema-valid request for a missing or superseded turn is not a
        // current main-turn occurrence, regardless of its pending summary.
        expect(await updateSessionAgentState({
            ...update, expectedVersion: current.agentStateVersion + 2,
            userActionRequiredOccurrences: [{ ...occurrence, sourceTurnId: "missing-turn" }],
        })).toMatchObject({ ok: true });
        expect(await submittedAlerts()).toEqual([]);

        const nextTurnId = `turn-${randomUUID()}`;
        expect(await applySessionTurnMutation({
            actorUserId: owner.id,
            mutation: {
                v: 1, sessionId: session.id, mutationId: randomUUID(), action: "begin",
                turnId: nextTurnId, observedAt: Date.now(),
            },
        })).toMatchObject({ ok: true });
        const nextTurn = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(await updateSessionAgentState({
            ...update, expectedVersion: nextTurn.agentStateVersion,
            userActionRequiredOccurrences: [{ ...occurrence, requestId: randomUUID() }],
        })).toMatchObject({ ok: true });
        expect(await submittedAlerts()).toEqual([]);

        expect(await applySessionTurnMutation({
            actorUserId: owner.id,
            mutation: {
                v: 1, sessionId: session.id, mutationId: randomUUID(), action: "complete",
                turnId: nextTurnId, observedAt: Date.now(),
            },
        })).toMatchObject({ ok: true });
        const settled = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(await updateSessionAgentState({
            ...update, expectedVersion: settled.agentStateVersion,
            userActionRequiredOccurrences: [{ ...occurrence, sourceTurnId: nextTurnId, requestId: randomUUID() }],
        })).toMatchObject({ ok: true });
        expect(await submittedAlerts()).toEqual([]);
    });

    it.each(["permission", "user_action"] as const)(
        "keeps a Runner-owned %s occurrence on the Home leg for the owner and eligible collaborator",
        async (requestKind) => {
            const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
            const follower = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
            const machine = await db.machine.create({ data: {
                id: `runner-${randomUUID()}`, accountId: owner.id, metadata: "{}", kind: "ephemeral_session_runner",
            } });
            const session = await db.session.create({ data: {
                accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
            } });
            await db.sessionShare.create({ data: {
                sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: follower.id,
                accessLevel: "edit", canApprovePermissions: true,
            } });
            await db.accountSessionFollow.create({ data: {
                sessionId: session.id, accountId: follower.id, following: true, notificationLevel: "important",
            } });
            const [ownerToken, followerToken] = await Promise.all([
                enrollRemoteAlerts(owner.id),
                enrollRemoteAlerts(follower.id),
            ]);
            const turnId = `turn-${randomUUID()}`;
            expect(await applySessionTurnMutation({ actorUserId: owner.id, mutation: {
                v: 1, sessionId: session.id, mutationId: randomUUID(), action: "begin", turnId, observedAt: Date.now(),
            } })).toMatchObject({ ok: true });
            const current = await db.session.findUniqueOrThrow({ where: { id: session.id } });
            expect(await updateSessionAgentState({
                actorUserId: owner.id,
                sessionId: session.id,
                expectedVersion: current.agentStateVersion,
                agentStateCiphertext: "runner-request-state",
                pendingPermissionRequestCount: requestKind === "permission" ? 1 : 0,
                pendingUserActionRequestCount: requestKind === "user_action" ? 1 : 0,
                userActionRequiredOccurrences: [{
                    requestId: randomUUID(), sourceTurnId: turnId, requestKind, occurredAt: Date.now(),
                }],
                runtimeComposition: {
                    publisherAuthority: {
                        accountId: owner.id, machineId: machine.id, sessionId: session.id,
                        committedFence: session.lastActiveAt,
                    },
                    ownerActivityDelivery: "rich_sender",
                },
            })).toMatchObject({ ok: true });

            const eventType = requestKind === "permission" ? "permission_request" : "user_action_request";
            expect(await submittedAlerts()).toEqual(expect.arrayContaining([
                expect.objectContaining({ accountId: owner.id, sessionId: session.id, event: { type: eventType } }),
                expect.objectContaining({ accountId: follower.id, sessionId: session.id, event: { type: eventType } }),
            ]));
            expect(submittedTokens().sort()).toEqual([ownerToken, followerToken].sort());
        },
    );

    it.each([
        { action: "fail", machineKind: "persistent", expectedOwnerAlert: false },
        { action: "cancel", machineKind: "persistent", expectedOwnerAlert: false },
        { action: "fail", machineKind: "ephemeral_session_runner", expectedOwnerAlert: true },
        { action: "cancel", machineKind: "ephemeral_session_runner", expectedOwnerAlert: true },
    ] as const)(
        "routes a committed $action turn through the $machineKind runtime's actual delivery composition",
        async ({ action, machineKind, expectedOwnerAlert }) => {
            const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
            const follower = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
            const machine = await db.machine.create({ data: {
                id: `machine-${randomUUID()}`, accountId: owner.id, metadata: "{}", kind: machineKind,
            } });
            const session = await db.session.create({ data: {
                accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
            } });
            await db.sessionShare.create({ data: {
                sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: follower.id, accessLevel: "view",
            } });
            await db.accountSessionFollow.create({ data: {
                sessionId: session.id, accountId: follower.id, following: true, notificationLevel: "important",
            } });
            const [ownerToken, followerToken] = await Promise.all([
                enrollRemoteAlerts(owner.id),
                enrollRemoteAlerts(follower.id),
            ]);
            const publisherAuthority = await registerRuntimePublisher({
                accountId: owner.id, machineId: machine.id, sessionId: session.id,
            });
            const turnId = `turn-${randomUUID()}`;
            expect(await applySessionTurnMutation({ actorUserId: owner.id, mutation: {
                v: 1, sessionId: session.id, mutationId: randomUUID(), action: "begin", turnId, observedAt: Date.now(),
            } })).toMatchObject({ ok: true, didApply: true });
            const observedAt = Date.now();
            expect(await applySessionTurnMutation({ actorUserId: owner.id, mutation: {
                v: 1, sessionId: session.id, mutationId: randomUUID(), action, turnId, observedAt,
                ...(action === "fail" ? { issue: {
                    v: 1 as const, scope: "primary_session" as const, status: "failed" as const,
                    code: "opencode_prompt_submission_failed" as const, source: "agent_session_error" as const,
                    occurredAt: observedAt, provider: "opencode", sanitizedPreview: "test",
                } } : {}),
            }, runtimeComposition: {
                publisherAuthority,
                ownerActivityDelivery: "rich_sender",
            } })).toMatchObject({ ok: true, didApply: true });

            const alerts = await submittedAlerts();
            expect(alerts).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    sessionId: session.id, accountId: follower.id,
                    event: { type: action === "fail" ? "failed" : "cancelled", turnId },
                }),
                ...(expectedOwnerAlert
                    ? [expect.objectContaining({
                        sessionId: session.id, accountId: owner.id,
                        event: { type: action === "fail" ? "failed" : "cancelled", turnId },
                    })]
                    : []),
            ]));
            expect(submittedTokens().sort()).toEqual(
                (expectedOwnerAlert ? [ownerToken, followerToken] : [followerToken]).sort(),
            );
        },
    );

    it("alerts all_messages followers after an authenticated human post but never alerts the author", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const author = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const allMessages = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const important = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        await db.sessionShare.createMany({ data: [author, allMessages, important].map((account) => ({
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: account.id, accessLevel: "edit" as const,
        })) });
        await db.accountSessionFollow.createMany({ data: [
            { sessionId: session.id, accountId: author.id, following: true, notificationLevel: "all_messages" },
            { sessionId: session.id, accountId: allMessages.id, following: true, notificationLevel: "all_messages" },
            { sessionId: session.id, accountId: important.id, following: true, notificationLevel: "important" },
        ] });
        const [authorToken, allMessagesToken, importantToken] = await Promise.all(
            [author, allMessages, important].map((account) => enrollRemoteAlerts(account.id)),
        );

        const result = await createSessionMessage({
            inputAdmission: "authenticatedAccount",
            authentication: discussionAuthentication,
            actorUserId: author.id,
            sessionId: session.id,
            localId: `human-${randomUUID()}`,
            messageRole: "user",
            content: { t: "plain", v: { role: "user", content: { type: "text", text: "Review this" } } },
        });
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true, didWrite: true });

        expect(await submittedAlerts()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sessionId: session.id,
                accountId: allMessages.id,
                event: { type: "human_message", sequenceDomain: "session_transcript", messageSeq: 1 },
            }),
            expect.objectContaining({
                sessionId: session.id,
                accountId: important.id,
                event: { type: "human_message", sequenceDomain: "session_transcript", messageSeq: 1 },
            }),
        ]));
        expect(submittedTokens().sort()).toEqual([allMessagesToken, importantToken].sort());
        expect(submittedTokens()).not.toContain(authorToken);
    });

    it("alerts all_messages followers for a newly committed attention-bearing Agent message", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const allMessages = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const important = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        await db.sessionShare.createMany({ data: [allMessages, important].map((account) => ({
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: account.id, accessLevel: "view" as const,
        })) });
        await db.accountSessionFollow.createMany({ data: [
            { sessionId: session.id, accountId: allMessages.id, following: true, notificationLevel: "all_messages" },
            { sessionId: session.id, accountId: important.id, following: true, notificationLevel: "important" },
        ] });
        await Promise.all([allMessages, important].map((account) => enrollRemoteAlerts(account.id)));

        const result = await createSessionMessage({
            inputAdmission: "authenticatedAccount",
            authentication: discussionAuthentication,
            actorUserId: owner.id,
            sessionId: session.id,
            localId: `agent-${randomUUID()}`,
            messageRole: "agent",
            content: { t: "plain", v: { role: "agent", content: { type: "text", text: "Implemented" } } },
        });
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true, didWrite: true });

        expect(await submittedAlerts()).toEqual([expect.objectContaining({
            sessionId: session.id,
            accountId: allMessages.id,
            event: { type: "message", sequenceDomain: "session_transcript", messageSeq: 1 },
        })]);
    });

    it("accepts source-unavailable only from the exact current Session Machine binding", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const follower = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const machine = await db.machine.create({ data: { id: `machine-${randomUUID()}`, accountId: owner.id, metadata: "{}" } });
        const unboundMachine = await db.machine.create({ data: { id: `machine-${randomUUID()}`, accountId: owner.id, metadata: "{}" } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        await db.accessKey.create({ data: { accountId: owner.id, machineId: machine.id, sessionId: session.id, data: "opaque" } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: follower.id, accessLevel: "view",
        } });
        await db.accountSessionFollow.create({ data: {
            sessionId: session.id, accountId: follower.id, following: true, notificationLevel: "important",
        } });
        await enrollRemoteAlerts(follower.id);
        const options = { operationSocketBatchLimits: { ok: true as const, limits: { maxItems: 200, maxSerializedBytes: 524_288 } } };

        const forgedSocket = createFakeSocket({ data: { clientType: "machine-scoped", machineId: unboundMachine.id } });
        machineUpdateHandler(owner.id, forgedSocket as never, options);
        await getSocketHandler(forgedSocket, "external-session-source-unavailable")({
            v: 1, type: "external-session-source-unavailable", sessionId: session.id,
            machineId: unboundMachine.id, observedAtMs: Date.now(),
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsyncSpy).not.toHaveBeenCalled();

        const sourceSocket = createFakeSocket({ data: { clientType: "machine-scoped", machineId: machine.id } });
        machineUpdateHandler(owner.id, sourceSocket as never, options);
        await getSocketHandler(sourceSocket, "external-session-source-unavailable")({
            v: 1, type: "external-session-source-unavailable", sessionId: session.id,
            machineId: machine.id, observedAtMs: Date.now(),
        });
        expect(await submittedAlerts()).toEqual([expect.objectContaining({
            sessionId: session.id, accountId: follower.id, event: { type: "source_unavailable" },
        })]);
    });

    it("alerts exactly the current mentioned Accounts after a human Discussion commit and not on replay", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const mentionedA = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const mentionedB = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const revoked = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        await db.sessionShare.createMany({ data: [mentionedA, mentionedB, revoked].map((account) => ({
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: account.id, accessLevel: "view" as const,
        })) });
        await db.sessionShare.deleteMany({ where: { sessionId: session.id, sharedWithUserId: revoked.id } });
        const tokenA = await enrollRemoteAlerts(mentionedA.id);
        const tokenB = await enrollRemoteAlerts(mentionedB.id);
        await enrollRemoteAlerts(revoked.id);

        const request = {
            creationLocalId: `discussion-${randomUUID()}`,
            titleContent: plainDiscussionTitle("Release readiness"),
            firstMessage: {
                localId: `message-${randomUUID()}`,
                content: plainDiscussionBody("Please review"),
                mentionedAccountIds: [mentionedA.id, mentionedB.id, mentionedA.id],
            },
        };
        const created = await createSessionDiscussion({
            authentication: discussionAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request,
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        const alerts = await submittedAlerts();
        expect(alerts).toHaveLength(2);
        expect(alerts).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sessionId: session.id, accountId: mentionedA.id,
                event: {
                    type: "discussion_mention", sequenceDomain: "discussion",
                    discussionId: created.value.discussion.id, messageSeq: 1,
                },
            }),
            expect.objectContaining({
                sessionId: session.id, accountId: mentionedB.id,
                event: {
                    type: "discussion_mention", sequenceDomain: "discussion",
                    discussionId: created.value.discussion.id, messageSeq: 1,
                },
            }),
        ]));
        expect(submittedTokens().sort()).toEqual([tokenA, tokenB].sort());

        sendPushNotificationsAsyncSpy.mockClear();
        expect((await createSessionDiscussion({
            authentication: discussionAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request,
        })).ok).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsyncSpy.mock.calls).toEqual([]);

        const denied = await postSessionDiscussionMessage({
            authentication: discussionAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: {
                localId: `message-${randomUUID()}`,
                content: plainDiscussionBody("No stale alert"),
                mentionedAccountIds: [revoked.id],
            },
        });
        expect(denied).toEqual({ ok: false, error: "session_discussion_invalid_mention" });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsyncSpy.mock.calls).toEqual([]);
    });

    it("alerts important followers for a committed human Discussion post without duplicating mention recipients", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const allMessages = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const mentionedAllMessages = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const important = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        await db.sessionShare.createMany({ data: [allMessages, mentionedAllMessages, important].map((account) => ({
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: account.id, accessLevel: "view" as const,
        })) });
        await db.accountSessionFollow.createMany({ data: [
            { sessionId: session.id, accountId: allMessages.id, following: true, notificationLevel: "all_messages" },
            { sessionId: session.id, accountId: mentionedAllMessages.id, following: true, notificationLevel: "all_messages" },
            { sessionId: session.id, accountId: important.id, following: true, notificationLevel: "important" },
        ] });
        await Promise.all([allMessages, mentionedAllMessages, important].map((account) => enrollRemoteAlerts(account.id)));

        const created = await createSessionDiscussion({
            authentication: discussionAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: {
                creationLocalId: `discussion-${randomUUID()}`,
                titleContent: plainDiscussionTitle("Every message"),
                firstMessage: {
                    localId: `message-${randomUUID()}`,
                    content: plainDiscussionBody("A committed discussion message"),
                    mentionedAccountIds: [mentionedAllMessages.id],
                },
            },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const alerts = await submittedAlerts();
        expect(alerts).toEqual(expect.arrayContaining([
            expect.objectContaining({ accountId: allMessages.id, event: {
                type: "human_message", sequenceDomain: "discussion",
                discussionId: created.value.discussion.id, messageSeq: 1,
            } }),
            expect.objectContaining({ accountId: mentionedAllMessages.id, event: {
                type: "discussion_mention", sequenceDomain: "discussion",
                discussionId: created.value.discussion.id, messageSeq: 1,
            } }),
            expect.objectContaining({ accountId: important.id, event: {
                type: "human_message", sequenceDomain: "discussion",
                discussionId: created.value.discussion.id, messageSeq: 1,
            } }),
        ]));
        expect(alerts).toHaveLength(3);
    });

    it("keeps equal first-message sequences distinct across Discussions in one Session", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const mentioned = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: mentioned.id, accessLevel: "view",
        } });
        await enrollRemoteAlerts(mentioned.id);

        const created = await Promise.all(["first", "second"].map(async (label) => await createSessionDiscussion({
            authentication: discussionAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: {
                creationLocalId: `discussion-${label}-${randomUUID()}`,
                titleContent: plainDiscussionTitle(label),
                firstMessage: {
                    localId: `message-${label}-${randomUUID()}`,
                    content: plainDiscussionBody(label),
                    mentionedAccountIds: [mentioned.id],
                },
            },
        })));
        expect(created.every((result) => result.ok)).toBe(true);
        if (!created[0]?.ok || !created[1]?.ok) return;

        const discussionIds = [
            created[0].value.discussion.id,
            created[1].value.discussion.id,
        ];
        expect(discussionIds[0]).not.toBe(discussionIds[1]);
        const alerts = await submittedAlerts();
        expect(alerts).toHaveLength(2);
        expect(alerts.map((alert) => alert.event)).toEqual(expect.arrayContaining(discussionIds.map((discussionId) => ({
            type: "discussion_mention",
            sequenceDomain: "discussion",
            discussionId,
            messageSeq: 1,
        }))));
    });

    it("uses the same committed mention producer for trusted Agent posts and discards rollback callbacks", async () => {
        const owner = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const mentioned = await db.account.create({ data: { publicKey: randomUUID(), encryptionMode: "plain" } });
        const session = await db.session.create({ data: {
            accountId: owner.id, tag: randomUUID(), metadata: "{}", encryptionMode: "plain",
        } });
        await db.sessionShare.create({ data: {
            sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: mentioned.id, accessLevel: "view",
        } });
        await enrollRemoteAlerts(mentioned.id);
        const created = await createSessionDiscussion({
            authentication: discussionAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            request: {
                creationLocalId: `discussion-${randomUUID()}`,
                titleContent: plainDiscussionTitle("Agent follow-up"),
                firstMessage: {
                    localId: `message-${randomUUID()}`,
                    content: plainDiscussionBody("Initial"),
                    mentionedAccountIds: [],
                },
            },
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const agentRequest = {
            localId: `agent-message-${randomUUID()}`,
            content: plainDiscussionBody("Agent asks for review"),
            mentionedAccountIds: [mentioned.id],
        };
        const producer = { v: 1 as const, kind: "agent" as const, sessionId: session.id, runId: randomUUID() };
        expect((await postSessionDiscussionMessage({
            authentication: discussionAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: agentRequest,
            producer,
        })).ok).toBe(true);
        expect(await submittedAlerts()).toEqual([expect.objectContaining({
            sessionId: session.id,
            accountId: mentioned.id,
            event: {
                type: "discussion_mention", sequenceDomain: "discussion",
                discussionId: created.value.discussion.id, messageSeq: 2,
            },
        })]);

        sendPushNotificationsAsyncSpy.mockClear();
        expect((await postSessionDiscussionMessage({
            authentication: discussionAuthentication,
            actorAccountId: owner.id,
            sessionId: session.id,
            discussionId: created.value.discussion.id,
            request: agentRequest,
            producer,
        })).ok).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsyncSpy.mock.calls).toEqual([]);

        const rolledBackLocalId = `rolled-back-${randomUUID()}`;
        await expect(inTx(async (tx) => {
            const result = await postSessionDiscussionMessageInTx(tx, {
                authentication: discussionAuthentication,
                actorAccountId: owner.id,
                sessionId: session.id,
                discussionId: created.value.discussion.id,
                request: {
                    localId: rolledBackLocalId,
                    content: plainDiscussionBody("This transaction rolls back"),
                    mentionedAccountIds: [mentioned.id],
                },
            });
            expect(result.ok).toBe(true);
            throw new Error("force rollback");
        })).rejects.toThrow("force rollback");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(sendPushNotificationsAsyncSpy.mock.calls).toEqual([]);
        expect(await db.sessionDiscussionMessage.count({ where: {
            discussionId: created.value.discussion.id,
            localId: rolledBackLocalId,
        } })).toBe(0);
    });
});
