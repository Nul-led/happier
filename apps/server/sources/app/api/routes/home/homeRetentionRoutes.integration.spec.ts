import Fastify from "fastify";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { auth } from "@/app/auth/auth";
import type { AuthEmailDelivery } from "@/app/auth/email/authEmailDelivery";
import { acquireRetentionSweepLock } from "@/app/retention/runtime/retentionSweepLock";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { db } from "@/storage/db";

import { createAppCloseTracker } from "../../testkit/appLifecycle";
import { enableAuthentication } from "../../utils/enableAuthentication";
import { featuresRoutes } from "../features/featuresRoutes";
import { registerHomeRetentionRoutes } from "./homeRetentionRoutes";
import { registerHomeSettingsRoutes } from "./homeSettingsRoutes";

const { trackApp, closeTrackedApps } = createAppCloseTracker();

const EVENTS_MODE = "HAPPIER_SERVER_RETENTION__HOME_ADMINISTRATION_EVENTS__MODE";
const EVENTS_DAYS = "HAPPIER_SERVER_RETENTION__HOME_ADMINISTRATION_EVENTS__DAYS";

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;
    enableAuthentication(typed);
    // Mail is not exercised here; the settings routes need a delivery to register.
    const authEmailDelivery: AuthEmailDelivery = {
        isReady: async () => false,
        deliver: async () => ({ status: "failed", reason: "not_configured", detail: "not configured" }),
    };
    registerHomeSettingsRoutes(typed, { authEmailDelivery });
    registerHomeRetentionRoutes(typed);
    featuresRoutes(typed);
    return trackApp(typed);
}

let harness: LightSqliteHarness;
let sequence = 0;

async function createAccount(homeRole: "owner" | "admin" | "member"): Promise<Readonly<{ accountId: string; token: string }>> {
    sequence += 1;
    const account = await db.account.create({
        data: { publicKey: `pk_home_retention_${sequence}`, encryptionMode: "plain", homeRole },
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
        tempDirPrefix: "happier-home-retention-routes-",
        initAuth: true,
        initEncrypt: true,
        initFiles: true,
    });
}, 120_000);
afterAll(async () => await harness.close());
afterEach(async () => {
    await closeTrackedApps();
    await db.globalLock.deleteMany({});
    await db.homeAdministrationEvent.deleteMany({});
    await db.homeSettings.deleteMany({});
    await db.account.deleteMany({});
});

describe("Home retention routes", () => {
    it("serves the stored rules on /v2/retention-policy and dry-runs them for the owner only", async () => {
        const app = createTestApp();
        const owner = await createAccount("owner");
        const admin = await createAccount("admin");

        const saved = await post(app, "/v1/home/settings/set", owner.token, {
            expectedRevision: 0,
            values: { HAPPIER_SERVER_RETENTION__ENABLED: true, [EVENTS_MODE]: "delete_older_than", [EVENTS_DAYS]: 30 },
        });
        expect(saved.statusCode).toBe(200);

        const policy = await app.inject({ method: "GET", url: "/v2/retention-policy" });
        expect(policy.statusCode).toBe(200);
        expect(policy.json()).toMatchObject({ enabled: true });
        expect(policy.json().domains).toContainEqual({
            id: "homeAdministrationEvents",
            policy: { mode: "delete_older_than", days: 30 },
        });

        const denied = await post(app, "/v1/home/retention/dry-run", admin.token, {});
        expect(denied.statusCode).toBe(403);
        expect(denied.json()).toEqual({ error: "home_governance_forbidden" });

        const dryRun = await post(app, "/v1/home/retention/dry-run", owner.token, {});
        expect(dryRun.statusCode).toBe(200);
        expect(dryRun.json().byDomain.homeAdministrationEvents).toEqual({
            wouldDelete: 0,
            candidatesExamined: 0,
            stopReason: "exhausted",
        });

        const lock = await acquireRetentionSweepLock({ ttlMs: 60_000 });
        try {
            const busy = await post(app, "/v1/home/retention/dry-run", owner.token, {});
            expect(busy.statusCode).toBe(409);
            expect(busy.json()).toEqual({ error: "retention_sweep_in_progress" });
        } finally {
            await lock?.release();
        }
    });
});
