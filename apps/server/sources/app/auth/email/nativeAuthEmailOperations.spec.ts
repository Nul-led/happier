import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeVerifiedEmail } from "@happier-dev/protocol";

import {
    buildE2eePasswordRecoveryUrl,
    buildNativeEmailVerifyUrl,
    sendAccountAuthenticationChangedNotice,
    sendE2eePasswordRecoveryGuidance,
} from "./nativeAuthEmailOperations";

const warn = vi.hoisted(() => vi.fn());

vi.mock("@/utils/logging/log", () => ({ warn }));

describe("native authentication email application links", () => {
    beforeEach(() => warn.mockClear());

    it("fails closed when the Homes application origin is malformed", () => {
        expect(buildNativeEmailVerifyUrl({
            applicationOrigin: "not an application origin",
            homeTarget: "opaque-home-target",
            serverId: "home-a",
        }, "bearer")).toBeNull();
        expect(buildNativeEmailVerifyUrl({
            applicationOrigin: "ftp://app.example.test",
            homeTarget: "opaque-home-target",
            serverId: "home-a",
        }, "bearer")).toBeNull();
    });

    it("builds the bearer-free E2EE recovery entry for the exact Home target", () => {
        expect(buildE2eePasswordRecoveryUrl({
            applicationOrigin: "https://app.example.test/client/",
            homeTarget: '{"kind":"descriptor"}',
            serverId: "home-a",
        })).toBe("https://app.example.test/client/auth/password/recover?target=%7B%22kind%22%3A%22descriptor%22%7D");
    });

    it("delivers E2EE guidance through that exact entry without minting a reset bearer", async () => {
        let message: unknown = null;
        const recipient = normalizeVerifiedEmail("person@example.test");
        if (!recipient) throw new Error("invalid test recipient");
        await expect(sendE2eePasswordRecoveryGuidance({
            resolveApplicationLinkTarget: async () => ({
                applicationOrigin: "https://app.example.test",
                homeTarget: "opaque-home-target",
                serverId: "home-a",
            }),
            delivery: {
                isReady: true,
                deliver: async (next) => {
                    message = next;
                    return { status: "sent" as const };
                },
            },
        }, { recipient })).resolves.toEqual({
            status: "sent",
        });
        expect(message).toEqual({
            kind: "e2ee_password_recovery_guidance",
            to: recipient,
            recoveryEntryUrl: "https://app.example.test/auth/password/recover?target=opaque-home-target",
        });
    });

    it("routes an authentication-change notice to Account Security on the exact Home", async () => {
        let message: unknown = null;
        const recipient = normalizeVerifiedEmail("person@example.test");
        if (!recipient) throw new Error("invalid test recipient");

        await expect(sendAccountAuthenticationChangedNotice({
            resolveApplicationLinkTarget: async () => ({
                applicationOrigin: "https://app.example.test",
                homeTarget: "opaque-home-target",
                serverId: "home-a",
            }),
            delivery: {
                isReady: true,
                deliver: async (next) => {
                    message = next;
                    return { status: "sent" as const };
                },
            },
        }, {
            recipient,
            change: "password_changed",
            occurredAt: new Date("2026-09-08T10:00:00.000Z"),
        })).resolves.toEqual({ status: "sent" });

        expect(message).toEqual({
            kind: "account_authentication_changed_notice",
            to: recipient,
            change: "password_changed",
            occurredAt: new Date("2026-09-08T10:00:00.000Z"),
            accountSecurityUrl: "https://app.example.test/settings/account/security?serverId=home-a",
        });
    });

    it("still delivers a post-commit authentication notice when its optional application link is unavailable", async () => {
        let message: unknown = null;
        const recipient = normalizeVerifiedEmail("person@example.test");
        if (!recipient) throw new Error("invalid test recipient");

        await expect(sendAccountAuthenticationChangedNotice({
            resolveApplicationLinkTarget: async () => {
                throw new Error("application target unavailable");
            },
            delivery: {
                isReady: true,
                deliver: async (next) => {
                    message = next;
                    return { status: "sent" as const };
                },
            },
        }, {
            recipient,
            change: "password_changed",
            occurredAt: new Date("2026-09-08T10:00:00.000Z"),
        })).resolves.toEqual({ status: "sent" });
        expect(message).toMatchObject({
            kind: "account_authentication_changed_notice",
            accountSecurityUrl: null,
        });
    });

    it("observes notice delivery failures without logging recipient or capability URL data", async () => {
        const recipient = normalizeVerifiedEmail("private@example.test");
        if (!recipient) throw new Error("invalid test recipient");

        await expect(sendAccountAuthenticationChangedNotice({
            resolveApplicationLinkTarget: async () => ({
                applicationOrigin: "https://app.example.test",
                homeTarget: "secret-portable-target",
                serverId: "home-a",
            }),
            delivery: {
                isReady: true,
                deliver: async () => ({
                    status: "failed" as const,
                    reason: "transport_failed" as const,
                    detail: "provider detail containing private@example.test",
                }),
            },
        }, {
            recipient,
            change: "password_changed",
            occurredAt: new Date("2026-09-08T10:00:00.000Z"),
        })).resolves.toMatchObject({ status: "failed", reason: "transport_failed" });

        expect(warn).toHaveBeenCalledWith({
            module: "auth-email",
            messageKind: "account_authentication_changed_notice",
            reason: "transport_failed",
        }, "Authentication email delivery failed");
        expect(JSON.stringify(warn.mock.calls)).not.toContain("private@example.test");
        expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-portable-target");
        expect(JSON.stringify(warn.mock.calls)).not.toContain("provider detail");
    });

    it("contains an unexpected post-commit notice boundary failure as a secret-free delivery result", async () => {
        const recipient = normalizeVerifiedEmail("private-boundary@example.test");
        if (!recipient) throw new Error("invalid test recipient");

        await expect(sendAccountAuthenticationChangedNotice({
            resolveApplicationLinkTarget: async () => {
                throw new Error("private-boundary@example.test must not escape");
            },
            delivery: {
                isReady: true,
                deliver: async () => {
                    throw new Error("capability-bearing transport detail must not escape");
                },
            },
        }, {
            recipient,
            change: "password_changed",
            occurredAt: new Date("2026-09-08T10:00:00.000Z"),
        })).resolves.toEqual({
            status: "failed",
            reason: "transport_failed",
            detail: "Authentication email delivery threw",
        });

        expect(warn).toHaveBeenCalledWith({
            module: "auth-email",
            messageKind: "account_authentication_changed_notice",
            reason: "transport_failed",
        }, "Authentication email delivery failed");
        expect(JSON.stringify(warn.mock.calls)).not.toContain("private-boundary@example.test");
        expect(JSON.stringify(warn.mock.calls)).not.toContain("capability-bearing transport detail");
    });
});
