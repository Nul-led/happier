import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_ATTENTION_DELIVERY_POLICY_V1,
    deriveAccountRemoteAlertPolicyV1,
    type DeviceRemoteAlertPolicyV1,
} from "@happier-dev/protocol";
import { createSessionPublisherPresence } from "@/app/presence/sessionPublisherPresence";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

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

const { submitSessionActivityRemoteAlerts } = await import("./submitSessionActivityRemoteAlerts");

const DEVICE_POLICY: DeviceRemoteAlertPolicyV1 = {
    v: 1,
    enabled: true,
    nativeConsumer: "ios_service_extension_v1",
    quietHoursOverride: { mode: "account" },
    foregroundBehavior: "account",
    previewCeiling: "title_only",
    soundVolume: 1,
};

function accountSettingsWithRemoteAlerts(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        sessionRemoteAlertsEnabled: true,
        attentionDeliveryPolicyV1: { ...DEFAULT_ATTENTION_DELIVERY_POLICY_V1, ...overrides },
    });
}

async function enrollRemoteAlerts(accountId: string, settings: string, device: DeviceRemoteAlertPolicyV1 | null = DEVICE_POLICY) {
    const policy = deriveAccountRemoteAlertPolicyV1(JSON.parse(settings));
    const account = await db.account.update({
        where: { id: accountId },
        data: { settings, settingsVersion: { increment: 1 } },
        select: { settingsVersion: true },
    });
    await db.account.update({
        where: { id: accountId },
        data: { remoteAlertPolicy: { settingsVersion: account.settingsVersion, policy } },
    });
    const token = `ExponentPushToken[${accountId.slice(0, 12)}]`;
    await db.accountPushToken.create({
        data: { accountId, token, ...(device === null ? {} : { remoteAlerts: device }) },
    });
    return token;
}

function submittedTokens(): string[] {
    return sendPushNotificationsAsyncSpy.mock.calls
        .flatMap(([chunk]) => chunk as Array<{ to: string }>)
        .map((message) => message.to);
}

function submittedPayloads(): Array<Record<string, unknown>> {
    return sendPushNotificationsAsyncSpy.mock.calls
        .flatMap(([chunk]) => chunk as Array<Record<string, unknown>>);
}

describe("Home remote alert submission (SQLite)", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "remote-alerts-", initAuth: false,
            env: {
                HAPPIER_SERVER_IDENTITY_ID: "srv_home_a",
                HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED: "true",
            },
        });
    }, 120_000);
    afterAll(async () => { await harness?.close(); });
    afterEach(() => { sendPushNotificationsAsyncSpy.mockClear(); });

    async function fixture() {
        const owner = await db.account.create({ data: { publicKey: randomUUID() } });
        const follower = await db.account.create({ data: { publicKey: randomUUID() } });
        const reader = await db.account.create({ data: { publicKey: randomUUID() } });
        const session = await db.session.create({ data: { accountId: owner.id, tag: randomUUID(), metadata: "{}" } });
        await db.sessionShare.createMany({
            data: [follower, reader].map((account) => ({
                sessionId: session.id, sharedByUserId: owner.id, sharedWithUserId: account.id, accessLevel: "view" as const,
            })),
        });
        await db.accountSessionFollow.create({
            data: { sessionId: session.id, accountId: follower.id, following: true, notificationLevel: "important" },
        });
        return { owner, follower, reader, session };
    }

    it("submits nothing while the sole Session Follow feature is disabled", async () => {
        const { follower, session } = await fixture();
        await enrollRemoteAlerts(follower.id, accountSettingsWithRemoteAlerts());
        process.env.HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED = "false";
        try {
            expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id,
            event: "ready",
            committedMessage: { domain: "session_transcript", seq: 1 },
            })).toEqual([]);
            expect(submittedPayloads()).toEqual([]);
        } finally {
            process.env.HAPPIER_FEATURE_SESSIONS_FOLLOWING__ENABLED = "true";
        }
    });

    it("submits a content-free alert to an enrolled eligible recipient and to nobody else", async () => {
        const { owner, follower, reader, session } = await fixture();
        const ownerMachine = await db.machine.create({ data: {
            id: `machine-${randomUUID()}`,
            accountId: owner.id,
            metadata: "{}",
            kind: "persistent",
        } });
        await db.accessKey.create({ data: {
            accountId: owner.id,
            machineId: ownerMachine.id,
            sessionId: session.id,
            data: "encrypted",
        } });
        const followerToken = await enrollRemoteAlerts(follower.id, accountSettingsWithRemoteAlerts());
        await enrollRemoteAlerts(reader.id, accountSettingsWithRemoteAlerts());
        await enrollRemoteAlerts(owner.id, accountSettingsWithRemoteAlerts());
        const publisherBinding = { accountId: owner.id, machineId: ownerMachine.id, sessionId: session.id };
        const registration = await createSessionPublisherPresence().registerPublisher({
            socket: {},
            binding: publisherBinding,
            completeActivitySnapshot: { state: "unknown", activeCount: 0 },
        });
        if (registration.status !== "registered") throw new Error("expected publisher registration");

        const submitted = await submitSessionActivityRemoteAlerts({
            sessionId: session.id,
            event: "ready",
            committedMessage: { domain: "session_transcript", seq: 12 },
            // The runtime Account keeps its existing rich sender for this event.
            runtimeComposition: {
                publisherAuthority: { ...publisherBinding, committedFence: registration.committedFence },
                ownerActivityDelivery: "rich_sender",
            },
        });

        expect(submitted).toEqual([follower.id]);
        expect(submittedTokens()).toEqual([followerToken]);
        const payload = submittedPayloads()[0];
        expect(payload?.data).toEqual({
            type: "activity_alert", v: 2,
            serverId: "srv_home_a", sessionId: session.id, accountId: follower.id,
            event: { type: "ready", sequenceDomain: "session_transcript", messageSeq: 12 },
            previewBehavior: "title_only",
        });
        expect(JSON.stringify(payload)).not.toContain(session.tag);
        expect(payload?.title).toBe("Happier");
        expect(payload?.mutableContent).toBe(true);
    });

    it("includes the owner when an active persistent Machine's publisher authority was superseded", async () => {
        const { owner, session } = await fixture();
        const firstMachine = await db.machine.create({ data: {
            id: `machine-${randomUUID()}`,
            accountId: owner.id,
            metadata: "{}",
            kind: "persistent",
        } });
        const successorMachine = await db.machine.create({ data: {
            id: `machine-${randomUUID()}`,
            accountId: owner.id,
            metadata: "{}",
            kind: "persistent",
        } });
        await db.accessKey.createMany({ data: [firstMachine, successorMachine].map((machine) => ({
            accountId: owner.id,
            machineId: machine.id,
            sessionId: session.id,
            data: "encrypted",
        })) });
        const ownerToken = await enrollRemoteAlerts(owner.id, accountSettingsWithRemoteAlerts());
        const presence = createSessionPublisherPresence();
        const firstSocket = {};
        const firstBinding = { accountId: owner.id, machineId: firstMachine.id, sessionId: session.id };
        const firstRegistration = await presence.registerPublisher({
            socket: firstSocket,
            binding: firstBinding,
            completeActivitySnapshot: { state: "unknown", activeCount: 0 },
        });
        expect(firstRegistration.status).toBe("registered");
        if (firstRegistration.status !== "registered") throw new Error("expected publisher registration");
        await presence.registerPublisher({
            socket: {},
            binding: { accountId: owner.id, machineId: successorMachine.id, sessionId: session.id },
            completeActivitySnapshot: { state: "unknown", activeCount: 0 },
        });

        expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id,
            event: "ready",
            committedMessage: { domain: "session_transcript", seq: 13 },
            runtimeComposition: {
                publisherAuthority: { ...firstBinding, committedFence: firstRegistration.committedFence },
                ownerActivityDelivery: "rich_sender",
            },
        })).toContain(owner.id);
        expect(submittedTokens()).toContain(ownerToken);
        expect(await db.machine.findUniqueOrThrow({ where: { id: firstMachine.id } })).toMatchObject({
            active: true,
            replacedAt: null,
        });
    });

    it.each([
        ["default", "default", "default"],
        ["soft", "happier_soft.wav", "happier.default.soft.v1"],
        ["urgent", "happier_urgent.wav", "happier.default.urgent.v1"],
        ["none", undefined, "happier.default.silent.v1"],
        ["custom:private-file", undefined, "happier.default.silent.v1"],
    ] as const)("preserves %s sound policy at the Expo boundary", async (soundId, sound, channelId) => {
        const { follower, session } = await fixture();
        await enrollRemoteAlerts(follower.id, accountSettingsWithRemoteAlerts({
            sounds: { defaultSoundId: soundId, eventSoundIds: {}, volume: 1 },
        }));

        expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id, event: "ready", committedMessage: { domain: "session_transcript", seq: 5 },
        })).toEqual([follower.id]);
        const payload = submittedPayloads()[0];
        expect(payload?.sound).toBe(sound);
        expect(payload?.channelId).toBe(channelId);
        if (sound === undefined) expect(payload).not.toHaveProperty("sound");
        expect(JSON.stringify(payload)).not.toContain("custom:private-file");
    });

    it.each(["deliver", "silent", "suppress"] as const)("honors quiet-hours %s at submission", async (delivery) => {
        const { follower, session } = await fixture();
        await enrollRemoteAlerts(follower.id, accountSettingsWithRemoteAlerts({
            quietHours: { enabled: true, timezone: "UTC", windows: [{ startLocalTime: "22:00", endLocalTime: "07:00" }] },
            channels: {
                ...DEFAULT_ATTENTION_DELIVERY_POLICY_V1.channels,
                expo_push: { ...DEFAULT_ATTENTION_DELIVERY_POLICY_V1.channels.expo_push, quietHoursBehavior: delivery },
            },
        }));

        const submitted = await submitSessionActivityRemoteAlerts({
            sessionId: session.id, event: "ready", committedMessage: { domain: "session_transcript", seq: 6 },
            now: new Date("2026-09-06T23:00:00Z"),
        });
        if (delivery === "suppress") {
            expect(submitted).toEqual([]);
            expect(submittedPayloads()).toEqual([]);
            return;
        }
        expect(submitted).toEqual([follower.id]);
        expect(submittedPayloads()).toHaveLength(1);
        const payload = submittedPayloads()[0];
        expect(payload).toMatchObject({ title: "Happier", mutableContent: true });
        expect(payload?.sound).toBe(delivery === "silent" ? undefined : "happier_soft.wav");
        expect(payload?.channelId).toBe(delivery === "silent" ? "happier.default.silent.v1" : "happier.default.soft.v1");
        if (delivery === "silent") expect(payload).not.toHaveProperty("sound");
    });

    it.each([
        ["permission_required", "happier.permissionRequests.urgent.v1"],
        ["user_action_required", "happier.userActionRequests.urgent.v1"],
    ] as const)("uses the shared request sound/channel for %s", async (event, channelId) => {
        const { owner, session } = await fixture();
        await enrollRemoteAlerts(owner.id, accountSettingsWithRemoteAlerts());
        expect(await submitSessionActivityRemoteAlerts({ sessionId: session.id, event })).toEqual([owner.id]);
        expect(submittedPayloads()).toEqual([expect.objectContaining({
            sound: "happier_urgent.wav", channelId, mutableContent: true,
        })]);
    });

    it("never submits without a current Account projection or an enabled device registration", async () => {
        const { follower, session } = await fixture();
        await enrollRemoteAlerts(follower.id, accountSettingsWithRemoteAlerts());
        // A later settings write advances the version and retires the old binding.
        await db.account.update({ where: { id: follower.id }, data: { settingsVersion: { increment: 1 } } });
        expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id, event: "ready", committedMessage: { domain: "session_transcript", seq: 3 },
        })).toEqual([]);
        expect(submittedTokens()).toEqual([]);

        const fresh = await fixture();
        await enrollRemoteAlerts(fresh.follower.id, accountSettingsWithRemoteAlerts(), { ...DEVICE_POLICY, enabled: false });
        expect(await submitSessionActivityRemoteAlerts({
            sessionId: fresh.session.id, event: "ready", committedMessage: { domain: "session_transcript", seq: 3 },
        })).toEqual([]);

        const unregistered = await fixture();
        await enrollRemoteAlerts(unregistered.follower.id, accountSettingsWithRemoteAlerts(), null);
        expect(await submitSessionActivityRemoteAlerts({
            sessionId: unregistered.session.id, event: "ready", committedMessage: { domain: "session_transcript", seq: 3 },
        })).toEqual([]);
        expect(submittedTokens()).toEqual([]);
    });

    it("applies the recipient's own mute before submission rather than at an OS fallback", async () => {
        const { follower, session } = await fixture();
        await enrollRemoteAlerts(follower.id, accountSettingsWithRemoteAlerts({
            channels: {
                ...DEFAULT_ATTENTION_DELIVERY_POLICY_V1.channels,
                expo_push: { ...DEFAULT_ATTENTION_DELIVERY_POLICY_V1.channels.expo_push, enabled: false },
            },
        }));
        expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id, event: "ready", committedMessage: { domain: "session_transcript", seq: 4 },
        })).toEqual([]);
        expect(submittedTokens()).toEqual([]);
    });

    it("alerts an assignment target through the follow_update family, including the Session owner", async () => {
        const { owner, session } = await fixture();
        const ownerToken = await enrollRemoteAlerts(owner.id, accountSettingsWithRemoteAlerts());
        await db.session.update({ where: { id: session.id }, data: { responsibleAccountId: owner.id } });

        expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id, event: "assigned", targetAccountIds: [owner.id],
        })).toEqual([owner.id]);
        expect(submittedTokens()).toEqual([ownerToken]);
        expect(submittedPayloads()[0]?.data).toMatchObject({ event: { type: "assigned" } });
        expect(submittedPayloads()[0]).toMatchObject({
            sound: "happier_soft.wav", channelId: "happier.default.soft.v1", mutableContent: true,
        });
    });

    it("keeps direct-share candidacy in-app only and submits no OS alert", async () => {
        const { reader, session } = await fixture();
        await enrollRemoteAlerts(reader.id, accountSettingsWithRemoteAlerts());

        expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id,
            event: "directly_shared",
            targetAccountIds: [reader.id],
        })).toEqual([]);
        expect(submittedTokens()).toEqual([]);
        expect(submittedPayloads()).toEqual([]);
    });

    it("refuses an event kind whose content-free producer this Home does not own", async () => {
        const { follower, session } = await fixture();
        await enrollRemoteAlerts(follower.id, accountSettingsWithRemoteAlerts());
        expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id, event: "human_message",
        })).toEqual([]);
        expect(submittedTokens()).toEqual([]);
    });

    it("preserves the producer's sequence domain instead of treating a Discussion row as transcript content", async () => {
        const { follower, session } = await fixture();
        await enrollRemoteAlerts(follower.id, accountSettingsWithRemoteAlerts());

        expect(await submitSessionActivityRemoteAlerts({
            sessionId: session.id,
            event: "human_message",
            committedMessage: { domain: "discussion", discussionId: "discussion-a", seq: 7 },
        })).toEqual([follower.id]);
        expect(submittedPayloads()[0]?.data).toMatchObject({
            v: 2,
            event: {
                type: "human_message", sequenceDomain: "discussion", discussionId: "discussion-a", messageSeq: 7,
            },
        });
    });
});
