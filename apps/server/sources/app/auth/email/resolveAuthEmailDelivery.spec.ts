import { describe, expect, it } from "vitest";

import {
    isAuthEmailDeliveryReady,
    resolveAuthEmailDelivery,
    resolveAuthEmailSmtpConfig,
} from "./resolveAuthEmailDelivery";
import type { AuthEmailMessage } from "./authEmailDelivery";
import { resolveTeamJoinLinkTarget } from "@/app/teams/invitations/joinScreenHome";

const configuredEnv = {
    HAPPIER_AUTH_EMAIL_SMTP_HOST: "smtp.example.com",
    HAPPIER_AUTH_EMAIL_FROM_ADDRESS: "no-reply@happier.dev",
} as const;

const message: AuthEmailMessage = {
    kind: "plain_password_reset",
    to: { address: "alice@example.com", normalizedEmail: "alice@example.com" },
    resetUrl: "https://app.happier.dev/auth/password/reset/BBBB",
    expiresAt: new Date("2026-09-05T01:00:00.000Z"),
};

const transport = { async send() { /* accepted */ } };

describe("resolveAuthEmailDelivery", () => {
    it("does not activate invitation links from SMTP and an application origin without the Homes target producer", async () => {
        const env = { ...configuredEnv, HAPPIER_WEBAPP_URL: "https://app.example.test" };
        expect(isAuthEmailDeliveryReady(env)).toBe(true);
        await expect(resolveTeamJoinLinkTarget(env)).resolves.toMatchObject({ applicationOrigin: null });
    });
    it("treats a deployment without a host or sender as unconfigured", () => {
        expect(resolveAuthEmailSmtpConfig({})).toBeNull();
        expect(resolveAuthEmailSmtpConfig({ HAPPIER_AUTH_EMAIL_SMTP_HOST: "smtp.example.com" })).toBeNull();
        expect(resolveAuthEmailSmtpConfig({ HAPPIER_AUTH_EMAIL_FROM_ADDRESS: "a@b.dev" })).toBeNull();
    });

    it("defaults the submission port from the transport security mode", () => {
        expect(resolveAuthEmailSmtpConfig(configuredEnv)?.port).toBe(587);
        expect(resolveAuthEmailSmtpConfig({
            ...configuredEnv,
            HAPPIER_AUTH_EMAIL_SMTP_SECURE: "true",
        })?.port).toBe(465);
        expect(resolveAuthEmailSmtpConfig({
            ...configuredEnv,
            HAPPIER_AUTH_EMAIL_SMTP_PORT: "2525",
        })?.port).toBe(2525);
    });

    it("uses the disabled adapter when no transport is configured", async () => {
        const delivery = resolveAuthEmailDelivery({});
        expect(delivery.isReady).toBe(false);
        const result = await delivery.deliver(message);

        expect(result).toMatchObject({ status: "failed", reason: "not_configured" });
        expect(isAuthEmailDeliveryReady({})).toBe(false);
    });

    it("publishes readiness for the production SMTP binding when configured", () => {
        expect(isAuthEmailDeliveryReady(configuredEnv)).toBe(true);
    });

    it("delivers through SMTP once a transport binding exists", async () => {
        const deps = { createSmtpTransport: () => transport };

        const delivery = resolveAuthEmailDelivery(configuredEnv, deps);
        expect(delivery.isReady).toBe(true);
        expect(await delivery.deliver(message)).toEqual({ status: "sent" });
        expect(isAuthEmailDeliveryReady(configuredEnv)).toBe(true);
        expect(isAuthEmailDeliveryReady({})).toBe(false);
    });
});
