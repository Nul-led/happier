import { describe, expect, it } from "vitest";

import {
    createPerSendAuthEmailDelivery,
    isAuthEmailDeliveryReady,
    resolveAuthEmailDelivery,
    resolveAuthEmailReadiness,
    isAuthEmailTransportConfigured,
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
        await expect(resolveTeamJoinLinkTarget(env)).resolves.toMatchObject({ applicationOrigin: null });
    });

    it("is ready only when mail can be sent and the link it must carry can be built", async () => {
        const buildable = async () => ({
            applicationOrigin: "https://app.example.test",
            homeTarget: "opaque-home-target",
            serverId: "home",
        });
        const unbuildable = async () => ({ applicationOrigin: "https://app.example.test", homeTarget: null, serverId: null });
        await expect(resolveAuthEmailReadiness({ transportReady: true, resolveApplicationLinkTarget: buildable })).resolves.toBe(true);
        // SMTP alone is not readiness: without a Home link target no mail is ever created.
        await expect(resolveAuthEmailReadiness({ transportReady: true, resolveApplicationLinkTarget: unbuildable })).resolves.toBe(false);
        await expect(resolveAuthEmailReadiness({ transportReady: true, resolveApplicationLinkTarget: null })).resolves.toBe(false);
        await expect(resolveAuthEmailReadiness({ transportReady: false, resolveApplicationLinkTarget: buildable })).resolves.toBe(false);
        await expect(resolveAuthEmailReadiness({
            transportReady: true,
            resolveApplicationLinkTarget: async () => { throw new Error("descriptor read failed"); },
        })).resolves.toBe(false);
        // The process-wide answer reads the same owner with the startup-registered link target.
        await expect(isAuthEmailDeliveryReady({ env: configuredEnv })).resolves.toBe(false);
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

    it("reads mail settings through the registry: shared boolean spelling, declared defaults, sender kept as written", () => {
        expect(resolveAuthEmailSmtpConfig({ ...configuredEnv, HAPPIER_AUTH_EMAIL_SMTP_SECURE: "y" })).toMatchObject({ secure: true, port: 465 });
        expect(resolveAuthEmailSmtpConfig({ ...configuredEnv, HAPPIER_AUTH_EMAIL_SMTP_PORT: "70000" })?.port).toBe(587);
        expect(resolveAuthEmailSmtpConfig(configuredEnv)).toMatchObject({ fromName: "Happier", username: null, password: null });
        expect(resolveAuthEmailSmtpConfig({
            ...configuredEnv,
            HAPPIER_AUTH_EMAIL_FROM_ADDRESS: " Happier <no-reply@happier.dev> ",
        })?.fromAddress).toBe("Happier <no-reply@happier.dev>");
    });

    it("uses the disabled adapter when no transport is configured", async () => {
        const delivery = resolveAuthEmailDelivery({});
        await expect(delivery.isReady()).resolves.toBe(false);
        const result = await delivery.deliver(message);

        expect(result).toMatchObject({ status: "failed", reason: "not_configured" });
        await expect(isAuthEmailDeliveryReady({ env: {} })).resolves.toBe(false);
    });

    it("reports the production SMTP binding as a configured transport, which alone is not readiness", async () => {
        expect(isAuthEmailTransportConfigured(configuredEnv)).toBe(true);
        await expect(isAuthEmailDeliveryReady({ env: configuredEnv })).resolves.toBe(false);
    });

    it("delivers through SMTP once a transport binding exists", async () => {
        const deps = { createSmtpTransport: () => transport };

        const delivery = resolveAuthEmailDelivery(configuredEnv, deps);
        await expect(delivery.isReady()).resolves.toBe(true);
        expect(await delivery.deliver(message)).toEqual({ status: "sent" });
        expect(isAuthEmailTransportConfigured(configuredEnv)).toBe(true);
        expect(isAuthEmailTransportConfigured({})).toBe(false);
    });

    it("resolves its configuration on every send, so a changed setting applies without a restart", async () => {
        let env: Record<string, string | undefined> = {};
        const sentWith: Array<string | null> = [];
        const delivery = createPerSendAuthEmailDelivery({
            readEnv: async () => env,
            createSmtpTransport: (config) => ({ async send() { sentWith.push(config.password); } }),
        });

        await expect(delivery.isReady()).resolves.toBe(false);
        expect(await delivery.deliver(message)).toMatchObject({ status: "failed", reason: "not_configured" });

        env = { ...configuredEnv, HAPPIER_AUTH_EMAIL_SMTP_USERNAME: "mailer", HAPPIER_AUTH_EMAIL_SMTP_PASSWORD: "stored-password" };
        await expect(delivery.isReady()).resolves.toBe(true);
        expect(await delivery.deliver(message)).toEqual({ status: "sent" });
        expect(sentWith).toEqual(["stored-password"]);
    });
});
