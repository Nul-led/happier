import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { auth } from "@/app/auth/auth";
import type { AuthEmailMessage } from "@/app/auth/email/authEmailDelivery";
import { createPerSendAuthEmailDelivery } from "@/app/auth/email/resolveAuthEmailDelivery";
import { readHomeConfigEnv } from "@/app/home/settings/homeSettings";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { db } from "@/storage/db";

import { createAppCloseTracker } from "../../testkit/appLifecycle";
import { enableAuthentication } from "../../utils/enableAuthentication";
import { homeGovernanceRoutes } from "./homeGovernanceRoutes";
import { registerHomeSettingsRoutes } from "./homeSettingsRoutes";

const { trackApp, closeTrackedApps } = createAppCloseTracker();

const PASSWORD = "route-smtp-password";
const sent: Array<Readonly<{ kind: AuthEmailMessage["kind"]; to: string; password: string | null; host: string }>> = [];

/**
 * The composed per-send delivery over the Home overlay, with only the SMTP socket replaced: the
 * transport records the configuration it was built from for the message it sends.
 */
function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;
    enableAuthentication(typed);
    homeGovernanceRoutes(typed);
    registerHomeSettingsRoutes(typed, {
        authEmailDelivery: createPerSendAuthEmailDelivery({
            readEnv: () => readHomeConfigEnv({}),
            createSmtpTransport: (config) => ({
                async send(envelope) {
                    sent.push({ kind: "mail_delivery_test", to: envelope.to, password: config.password, host: config.host });
                },
            }),
        }),
    });
    return trackApp(typed);
}

let harness: LightSqliteHarness;
let sequence = 0;

async function createAccount(homeRole: "owner" | "admin" | "member"): Promise<Readonly<{ accountId: string; token: string }>> {
    sequence += 1;
    const account = await db.account.create({
        data: { publicKey: `pk_home_settings_${sequence}`, encryptionMode: "plain", homeRole },
        select: { id: true },
    });
    const token = await auth.createToken(account.id, undefined, {
        kind: "account",
        authority: "present_user",
        authenticationEvidence: [{ kind: "home_method", methodId: "key_challenge" }],
    });
    return { accountId: account.id, token };
}

async function post(app: ReturnType<typeof createTestApp>, url: string, token: string, payload: unknown) {
    return await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` }, payload });
}

beforeAll(async () => {
    harness = await createLightSqliteHarness({
        tempDirPrefix: "happier-home-settings-routes-",
        initAuth: true,
        initEncrypt: true,
        initFiles: true,
    });
}, 120_000);
afterAll(async () => await harness.close());
afterEach(async () => {
    await closeTrackedApps();
    sent.length = 0;
    await db.homeAdministrationEvent.deleteMany({});
    await db.homeSettings.deleteMany({});
    await db.account.deleteMany({});
});

describe("Home settings routes", () => {
    it("saves SMTP from the console and the next test email uses the stored password, which no read ever returns", async () => {
        const app = createTestApp();
        const owner = await createAccount("owner");
        const admin = await createAccount("admin");

        const before = await post(app, "/v1/home/mail-delivery/get", owner.token, {});
        expect(before.statusCode).toBe(200);
        expect(before.json()).toMatchObject({ transportConfigured: false, linkOrigin: null, ready: false, passwordUnreadable: false });

        const saved = await post(app, "/v1/home/settings/set", owner.token, {
            expectedRevision: 0,
            values: {
                HAPPIER_AUTH_EMAIL_SMTP_HOST: "smtp.home.test",
                HAPPIER_AUTH_EMAIL_SMTP_USERNAME: "mailer",
                HAPPIER_AUTH_EMAIL_FROM_ADDRESS: "home@home.test",
            },
            secrets: { HAPPIER_AUTH_EMAIL_SMTP_PASSWORD: { replace: PASSWORD } },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.body).not.toContain(PASSWORD);

        const test = await post(app, "/v1/home/mail-delivery/test", owner.token, { to: "owner@home.test" });
        expect(test.statusCode).toBe(200);
        expect(test.json()).toEqual({ status: "sent" });
        expect(sent).toEqual([{ kind: "mail_delivery_test", to: "owner@home.test", password: PASSWORD, host: "smtp.home.test" }]);

        const readiness = await post(app, "/v1/home/mail-delivery/get", admin.token, {});
        expect(readiness.json()).toMatchObject({ transportConfigured: true, passwordUnreadable: false });

        const read = await post(app, "/v1/home/settings/get", admin.token, {});
        expect(read.statusCode).toBe(200);
        expect(read.body).not.toContain(PASSWORD);
        const password = read.json().entries.find((entry: { key: string }) => entry.key === "HAPPIER_AUTH_EMAIL_SMTP_PASSWORD");
        expect(password).toMatchObject({ value: null, secretSet: true, source: "home" });

        const audit = await post(app, "/v1/home/audit/list", admin.token, {});
        expect(audit.statusCode).toBe(200);
        expect(audit.body).not.toContain(PASSWORD);
        expect(audit.json().items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: "home.settings.set",
                actor: expect.objectContaining({ kind: "account", accountId: owner.accountId }),
                target: { kind: "setting", id: "HAPPIER_AUTH_EMAIL_SMTP_PASSWORD", profile: null },
                summary: { secret: true, key: "HAPPIER_AUTH_EMAIL_SMTP_PASSWORD", from: "unset", to: "set" },
            }),
        ]));
    });

    it("keeps writes and the test send to owners and names the refused key", async () => {
        const app = createTestApp();
        const owner = await createAccount("owner");
        const admin = await createAccount("admin");
        const member = await createAccount("member");

        expect((await post(app, "/v1/home/settings/get", member.token, {})).statusCode).toBe(403);
        expect((await post(app, "/v1/home/audit/list", member.token, {})).statusCode).toBe(403);
        expect((await post(app, "/v1/home/settings/set", admin.token, { expectedRevision: 0, values: { METRICS_PORT: 9191 } })).statusCode).toBe(403);
        expect((await post(app, "/v1/home/mail-delivery/test", admin.token, { to: "a@home.test" })).statusCode).toBe(403);

        const bootstrap = await post(app, "/v1/home/settings/set", owner.token, { expectedRevision: 0, values: { HAPPIER_INSTANCE_ID: "replica-a" } });
        expect(bootstrap.statusCode).toBe(400);
        expect(bootstrap.json()).toEqual({ error: "home_settings_invalid", key: "HAPPIER_INSTANCE_ID", reason: "not_home_editable" });

        await post(app, "/v1/home/settings/set", owner.token, { expectedRevision: 0, values: { METRICS_PORT: 9191 } });
        const stale = await post(app, "/v1/home/settings/set", owner.token, { expectedRevision: 0, values: { METRICS_PORT: 9292 } });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toEqual({ error: "home_settings_revision_conflict" });

        const notConfigured = await post(app, "/v1/home/mail-delivery/test", owner.token, { to: "owner@home.test" });
        expect(notConfigured.json()).toEqual({ status: "failed", reason: "not_configured" });
        expect(sent).toEqual([]);
    });

    it("records role changes in the audit trail about the person", async () => {
        const app = createTestApp();
        const owner = await createAccount("owner");
        const member = await createAccount("member");

        expect((await post(app, "/v1/home/accounts/role/set", owner.token, { accountId: member.accountId, homeRole: "admin" })).statusCode).toBe(200);
        const audit = await post(app, "/v1/home/audit/list", owner.token, { targetId: member.accountId });
        expect(audit.json().items).toEqual([
            expect.objectContaining({
                action: "account.role.set",
                summary: { from: "member", to: "admin" },
                target: expect.objectContaining({ kind: "account", id: member.accountId }),
            }),
        ]);
    });
});
