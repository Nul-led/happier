import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { db } from "@/storage/db";
import type { AuthEmailMessage } from "./authEmailDelivery";
import { requestNativeEmailVerification, requestPlainPasswordReset } from "./nativeAuthEmailOperations";

describe("native bearer email readiness", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-email-readiness-", initAuth: false });
    }, 180_000);
    afterAll(async () => { if (harness) await harness.close(); });
    it("refuses verification and reset before persistence or delivery without the Homes link producer", async () => {
        const deps = {
            resolveApplicationLinkTarget: async () => ({ applicationOrigin: null, homeTarget: null, serverId: null }),
            delivery: { isReady: true, async deliver() { return { status: "sent" as const }; } },
        };
        const recipient = { address: "recipient@example.test", normalizedEmail: "recipient@example.test" };
        expect(await requestNativeEmailVerification(deps, {
            recipient, consumer: { kind: "fresh_account", continuationId: null },
        })).toEqual({ status: "unavailable" });
        expect(await db.repeatKey.count()).toBe(0);
        expect(await requestPlainPasswordReset(deps, {
            recipient, accountId: "account", credentialRevision: 1, expectedNativeIdentity: recipient.normalizedEmail,
        })).toEqual({ status: "unavailable" });
    });

    it("uses the Homes portable target and permits independent live links", async () => {
        const messages: string[] = [];
        const deps = {
            env: {},
            resolveApplicationLinkTarget: async () => ({
                applicationOrigin: "https://app.example.test",
                homeTarget: JSON.stringify({ kind: "descriptor", descriptor: { v: 1 }, authority: "trusted_enrollment" }),
                serverId: "home-a",
            }),
            delivery: {
                isReady: true,
                async deliver(message: AuthEmailMessage) {
                    if (message.kind === "native_email_verification" && message.verifyUrl) messages.push(message.verifyUrl);
                    return { status: "sent" as const };
                },
            },
        };
        const recipient = { address: "recipient@example.test", normalizedEmail: "recipient@example.test" };

        await requestNativeEmailVerification(deps, {
            recipient, consumer: { kind: "fresh_account", continuationId: null },
        });
        await requestNativeEmailVerification(deps, {
            recipient, consumer: { kind: "fresh_account", continuationId: null },
        });

        expect(messages).toHaveLength(2);
        expect(messages[0]).not.toBe(messages[1]);
        for (const message of messages) {
            const url = new URL(message);
            expect(url.pathname).toMatch(/^\/auth\/email\/verify\/[A-Za-z0-9_-]{43}$/);
            expect(JSON.parse(url.searchParams.get("target")!)).toMatchObject({
                kind: "descriptor",
                authority: "trusted_enrollment",
            });
        }
        expect(await db.repeatKey.count()).toBe(2);
    });
});
