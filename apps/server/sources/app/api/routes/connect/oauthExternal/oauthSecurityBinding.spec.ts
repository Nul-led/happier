import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { resolveOAuthRuntimeById } from "@/app/auth/providers/identityProviderCatalog";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { OAuthProviderConfigurationChangedError } from "./oauthExternalErrors";
import {
    requireCurrentOAuthPendingRuntime,
    requireCurrentOAuthPendingRuntimeInTx,
    resolveOAuthSecurityBinding,
} from "./oauthSecurityBinding";

let harness: LightSqliteHarness;

beforeAll(async () => {
    harness = await createLightSqliteHarness({
        tempDirPrefix: "happier-oauth-security-binding-",
        initAuth: false,
        initEncrypt: false,
        initFiles: false,
    });
});
afterAll(async () => await harness.close());

const instance = {
    id: "acme", type: "oidc", displayName: "Acme", issuer: "https://issuer.example.test",
    clientId: "client", clientSecret: "secret", redirectUrl: "https://home.example.test/v1/oauth/acme/callback",
};
const env = { AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([instance]) };

describe("OAuth security binding resolution", () => {
    it("rechecks pending runtime against the request Home environment in and outside a transaction", async () => {
        const runtime = (await resolveOAuthRuntimeById(env, "acme"))!;
        const binding = { provider: runtime.reference, connection: null, admission: null, purpose: null } as const;
        const input = { env, providerId: "acme", pendingKey: "pending-acme", binding, purpose: null } as const;
        const identitiesBefore = await db.accountIdentity.count();
        try {
            harness.resetEnv({ AUTH_PROVIDERS_CONFIG_JSON: "[]" });
            await expect(requireCurrentOAuthPendingRuntime(input)).resolves.toMatchObject({ id: "acme" });
            await expect(inTx((tx) => requireCurrentOAuthPendingRuntimeInTx(tx, input)))
                .resolves.toMatchObject({ id: "acme" });

            harness.resetEnv({ AUTH_PROVIDERS_CONFIG_JSON: env.AUTH_PROVIDERS_CONFIG_JSON });
            const changedEnv = { AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{ ...instance, clientSecret: "rotated" }]) };
            const staleInput = { ...input, env: changedEnv };
            await expect(requireCurrentOAuthPendingRuntime(staleInput)).rejects.toBeInstanceOf(OAuthProviderConfigurationChangedError);
            await expect(inTx((tx) => requireCurrentOAuthPendingRuntimeInTx(tx, staleInput)))
                .rejects.toBeInstanceOf(OAuthProviderConfigurationChangedError);
            await expect(db.accountIdentity.count()).resolves.toBe(identitiesBefore);
        } finally {
            harness.resetEnv();
        }
    });

    it.each(["oauth_callback", "oauth_finalize"] as const)("rejects changed or removed deployment configuration at %s", async (stage) => {
        const runtime = (await resolveOAuthRuntimeById(env, "acme"))!;
        const binding = { provider: runtime.reference, connection: null, admission: null, purpose: null } as const;
        const input = { providerId: "acme", binding, purpose: null, stage } as const;
        expect(await resolveOAuthSecurityBinding({ ...input, env })).toMatchObject({ securityBinding: binding });
        expect(await resolveOAuthSecurityBinding({ ...input, env: {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{ ...instance, clientSecret: "rotated" }]),
        } })).toBeNull();
        expect(await resolveOAuthSecurityBinding({ ...input, env: {} })).toBeNull();
        expect(await resolveOAuthSecurityBinding({ ...input, env: {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{ ...instance, displayName: "Renamed" }]),
        } })).toMatchObject({ securityBinding: binding });
    });

    it("accepts only ordinary released missing-reference records and never converts their purpose", async () => {
        // server-v0.2.11 / preview.2 @ 98ea8fb76733b1dd785d38c31360179cafa84824
        // wrote ordinary attempts/pending without a provider reference; ../0.2 @ af1b427 matches.
        const input = { providerId: "acme", binding: undefined, env, stage: "oauth_finalize" } as const;
        expect(await resolveOAuthSecurityBinding({ ...input, purpose: null })).toMatchObject({
            securityBinding: { provider: { id: "acme", source: "deployment" }, purpose: null },
        });
        expect(await resolveOAuthSecurityBinding({ ...input, purpose: "account_directory" })).toBeNull();
        expect(await resolveOAuthSecurityBinding({ ...input, purpose: "account_encryption_first_key" })).toBeNull();
        const runtime = (await resolveOAuthRuntimeById(env, "acme"))!;
        const binding = { provider: runtime.reference, connection: null, admission: null, purpose: null } as const;
        expect(await resolveOAuthSecurityBinding({ ...input, binding, purpose: "account_directory" })).toBeNull();
        expect(await resolveOAuthSecurityBinding({ ...input, binding, providerId: "github", purpose: null })).toBeNull();
    });
});
