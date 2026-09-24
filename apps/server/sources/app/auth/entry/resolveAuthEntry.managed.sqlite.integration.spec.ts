import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { encryptString } from "@/modules/encrypt";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import { resolveAuthEntry } from "./resolveAuthEntry";

const managedOidcConfig = {
    v: 1,
    kind: "oidc",
    issuer: "https://id.example.test",
    clientId: "happier",
    clientAuthenticationMethod: "client_secret_post",
    scopes: "openid profile email",
    httpTimeoutSeconds: 30,
    claims: { login: "preferred_username", email: "email", groups: "groups" },
    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
    fetchUserInfo: true,
    storeRefreshToken: false,
    ui: { buttonColor: "#0B5FFF", iconHint: "oidc" },
} as const;

describe("resolveAuthEntry managed Home providers (SQLite integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-auth-entry-managed-",
            initAuth: false,
            initEncrypt: true,
            initFiles: false,
        });
    }, 180_000);

    afterEach(async () => {
        await db.identityProviderInstance.deleteMany({});
        await db.homeGovernancePolicy.deleteMany({});
    });

    afterAll(async () => {
        if (harness) await harness.close();
    });

    it("projects an enabled managed OIDC provider through the async catalog and Home policy owner", async () => {
        const managed = await db.identityProviderInstance.create({
            data: {
                kind: "oidc",
                displayName: "Company login",
                enabled: true,
                firstEnabledAt: new Date("2026-09-06T00:00:00.000Z"),
                config: managedOidcConfig,
                encryptedSecrets: null,
            },
        });
        await db.identityProviderInstance.update({
            where: { id: managed.id },
            data: {
                encryptedSecrets: encryptString(
                    ["storage", "identity_provider_instance", managed.id, "oidc", "secrets", "v1"],
                    JSON.stringify({ v: 1, kind: "oidc", clientSecret: "secret" }),
                ),
            },
        });

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: "home" } },
            {
                env: {
                    HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
                    AUTH_ANONYMOUS_SIGNUP_ENABLED: "true",
                },
                // `connect` is offered only to a signed-in caller; the managed
                // provider's full action table is the fact under test here.
                principal: { accountId: "account-without-row" },
            },
        );

        // teams-lane-03/01 §10.2: every projector carries the descriptor's
        // provider kind, display name, icon hint, connect-button colour and
        // profile-badge support; a client must not recreate them for a dynamic provider.
        const companyLoginPresentation = {
            displayName: "Company login",
            iconHint: "oidc",
            providerKind: "oidc",
            connectButtonColor: "#0B5FFF",
            supportsProfileBadge: false,
        };
        expect(projection.state).toBe("ready");
        if (projection.state !== "ready") throw new Error("expected ready projection");
        expect(projection.actions.filter((action) => action.methodId === managed.id)).toEqual([
            expect.objectContaining({
                methodId: managed.id,
                action: "connect",
                mode: "either",
                presentation: companyLoginPresentation,
            }),
            expect.objectContaining({
                methodId: managed.id,
                action: "provision",
                mode: "keyed",
                presentation: companyLoginPresentation,
            }),
        ]);
    });
});
