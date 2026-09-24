import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { encryptString } from "@/modules/encrypt";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";

import {
    isEffectiveHomeAuthMethodActionEnabledInTx,
    type HomeAuthMethodAdmissionContext,
} from "./effectiveHomeAuthMethods";

describe("Home authentication method admission", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-effective-home-auth-methods-",
            initAuth: false,
            initEncrypt: true,
            initFiles: false,
        });
    }, 120_000);

    afterEach(async () => {
        harness.resetEnv();
        await db.teamProvisionedIdentity.deleteMany({});
        await db.teamIdentityConnection.deleteMany({});
        await db.identityProviderInstance.deleteMany({});
        await db.team.deleteMany({});
        await db.homeGovernancePolicy.deleteMany({});
    });

    afterAll(async () => await harness.close());

    async function createTeamProvisionedIdentityAdmission() {
        const team = await db.team.create({
            data: { name: "Provisioned Admission Team", admissionMode: "provisioned" },
        });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: "oidc",
                displayName: "Admission SSO",
                enabled: true,
                firstEnabledAt: new Date(),
                config: {
                    v: 1, kind: "oidc", issuer: "https://id.example.test", clientId: "client",
                    clientAuthenticationMethod: "client_secret_post", scopes: "openid",
                    httpTimeoutSeconds: 30,
                    claims: { login: "preferred_username", email: "email", groups: "groups" },
                    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                    fetchUserInfo: false, storeRefreshToken: false, ui: { buttonColor: null, iconHint: null },
                },
            },
        });
        await db.identityProviderInstance.update({
            where: { id: provider.id },
            data: {
                encryptedSecrets: encryptString(
                    ["storage", "identity_provider_instance", provider.id, "oidc", "secrets", "v1"],
                    JSON.stringify({ v: 1, kind: "oidc", clientSecret: "secret" }),
                ),
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId: team.id,
                providerInstanceId: provider.id,
                enabled: true,
                firstEnabledAt: new Date(),
                externalReference: { v: 1, kind: "oidc" },
                settings: { v: 1, kind: "oidc", allowedUsers: [], allowedEmailDomains: [], groupsAny: [], groupsAll: [] },
            },
        });
        return {
            providerId: provider.id,
            admission: {
                kind: "team_provisioned_identity" as const,
                teamId: team.id,
                providerId: provider.id,
                connectionId: connection.id,
                connectionRevision: connection.revision,
                admissionMode: "provisioned" as const,
                provisionedIdentityId: "provisioned-identity-1",
            },
        };
    }

    async function createWorkosAdmission(presentationStatus: string) {
        const team = await db.team.create({
            data: { name: `WorkOS Admission Team ${presentationStatus}`, admissionMode: "provisioned" },
        });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: "workos_sso",
                displayName: "Admission WorkOS",
                enabled: true,
                firstEnabledAt: new Date(),
                config: { v: 1, kind: "workos_sso" },
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId: team.id,
                providerInstanceId: provider.id,
                enabled: true,
                firstEnabledAt: new Date(),
                externalReference: {
                    v: 1,
                    kind: "workos_sso",
                    organizationId: `org_${team.id}`,
                    connectionId: `conn_${team.id}`,
                },
                settings: { v: 1, kind: "workos_sso" },
                lastObservation: {
                    v: 1,
                    kind: "workos_sso",
                    presentation: {
                        displayName: "Acme Okta",
                        strategy: "okta",
                        status: presentationStatus,
                        lastCheckedAt: "2026-09-22T00:00:00.000Z",
                    },
                    successfulTest: null,
                },
            },
        });
        return {
            providerId: provider.id,
            admission: {
                kind: "team_provisioned_identity" as const,
                teamId: team.id,
                providerId: provider.id,
                connectionId: connection.id,
                connectionRevision: connection.revision,
                admissionMode: "provisioned" as const,
                provisionedIdentityId: "provisioned-identity-2",
            },
        };
    }

    async function writeHomeGovernancePolicy(
        authenticationPolicy: Record<string, unknown> | null,
    ): Promise<void> {
        await db.homeGovernancePolicy.upsert({
            where: { id: "home" },
            create: {
                id: "home",
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ["oidc", "workos_sso"],
                    teamJitAllowed: true,
                    approvedGitHubEnterpriseOrigins: [],
                },
                ...(authenticationPolicy ? { authenticationPolicy } : {}),
            },
            update: { authenticationPolicy },
        });
    }

    it("applies the Home's permitted Account modes to a Team-provider admission", async () => {
        harness.resetEnv({
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
        });
        const { providerId, admission } = await createTeamProvisionedIdentityAdmission();
        await writeHomeGovernancePolicy(null);

        const admit = (mode: "keyed" | "keyless") => inTx((tx) => isEffectiveHomeAuthMethodActionEnabledInTx(tx, {
            env: process.env,
            methodId: providerId,
            actionId: "provision",
            mode,
            admission,
        }));

        // The Home permits both protections: the Team admission may create either.
        await expect(admit("keyed")).resolves.toBe(true);
        await expect(admit("keyless")).resolves.toBe(true);

        // Narrowing the Home to E2EE-only Accounts is a storage ceiling the
        // ordinary path already honours; a Team identity connection admits
        // members, it does not widen what this Home stores.
        await writeHomeGovernancePolicy({ v: 1, permittedAccountModes: ["e2ee"] });
        await expect(admit("keyed")).resolves.toBe(true);
        await expect(admit("keyless")).resolves.toBe(false);
    });

    it("reads Team connection usability through the lifecycle owner's state", async () => {
        harness.resetEnv({
            HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
            HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: "1",
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: "optional",
            WORKOS_API_KEY: "sk_test",
            WORKOS_CLIENT_ID: "client_test",
        });
        await writeHomeGovernancePolicy(null);

        const admit = (target: Readonly<{ providerId: string; admission: HomeAuthMethodAdmissionContext }>) =>
            inTx((tx) => isEffectiveHomeAuthMethodActionEnabledInTx(tx, {
                env: process.env,
                methodId: target.providerId,
                actionId: "provision",
                mode: "keyed",
                admission: target.admission,
            }));

        // A live WorkOS connection is `connected` and admits.
        const live = await createWorkosAdmission("active");
        await expect(admit(live)).resolves.toBe(true);

        // The same connection whose upstream presentation is no longer active
        // derives `needs_attention`: qualification and admission finalization
        // already refuse it, so this gate must not offer it either. The raw
        // `enabled` columns are identical in both rows, so this case fails on
        // any implementation that re-derives usability from them.
        const stale = await createWorkosAdmission("inactive");
        await expect(admit(stale)).resolves.toBe(false);
    });
});
