import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    createGitHubAppRegistrationConfigV1,
    encryptGitHubAppRegistrationSecretsV1,
} from "@/app/integrations/github/githubManagedApp";
import { createDirectorySource } from "./directorySourceService";

describe("directorySourceService", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-directory-source-",
            initAuth: false,
            initEncrypt: true,
            env: { HAPPIER_FEATURE_TEAMS__ENABLED: "1" },
        });
        await db.homeGovernancePolicy.create({
            data: {
                id: "home",
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ["workos_sso", "github_app_identity"],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    it("creates a WorkOS source from the exact same-Team connection even when SSO is disabled", async () => {
        const team = await db.team.create({ data: { name: "WorkOS Team" } });
        const otherTeam = await db.team.create({ data: { name: "Other Team" } });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: "workos_sso",
                displayName: "WorkOS",
                enabled: true,
                config: { v: 1, kind: "workos_sso" },
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId: team.id,
                providerInstanceId: provider.id,
                externalReference: {
                    v: 1,
                    kind: "workos_sso",
                    organizationId: "organization_01",
                    connectionId: null,
                },
                settings: { v: 1, kind: "workos_sso" },
                enabled: false,
            },
        });

        expect(await createDirectorySource({
            kind: "workos_directory",
            teamId: otherTeam.id,
            teamIdentityConnectionId: connection.id,
            workosDirectoryId: "directory_01",
            displayName: "Wrong Team",
        })).toEqual({ ok: false, code: "directory_source_owner_not_found" });

        const created = await createDirectorySource({
            kind: "workos_directory",
            teamId: team.id,
            teamIdentityConnectionId: connection.id,
            workosDirectoryId: "directory_01",
            displayName: "Primary directory",
            now: new Date("2026-09-05T10:00:00.000Z"),
        });
        expect(created).toEqual({ ok: true, sourceId: expect.any(String) });
        const source = await db.teamDirectorySource.findUniqueOrThrow({
            where: { id: created.ok ? created.sourceId : "unreachable" },
        });
        expect(source).toMatchObject({
            teamId: team.id,
            kind: "workos_directory",
            state: "initializing",
            externalSourceKey: expect.stringMatching(/^workos_directory:[A-Za-z0-9_-]{43}$/),
            bindingConfig: { v: 1, kind: "workos_directory", workosDirectoryId: "directory_01" },
            teamIdentityConnectionId: connection.id,
            githubAppInstallationId: null,
            eventRangeStart: new Date("2026-09-05T10:00:00.000Z"),
            activeReconcileRunId: expect.any(String),
            activeReconcileStartedAt: new Date("2026-09-05T10:00:00.000Z"),
        });

        expect(await createDirectorySource({
            kind: "workos_directory",
            teamId: team.id,
            teamIdentityConnectionId: connection.id,
            workosDirectoryId: "directory_01",
            displayName: "Duplicate",
        })).toEqual({ ok: false, code: "directory_source_already_exists" });
    });

    it("creates a GitHub source from the stored installation identity and permitted Team owner", async () => {
        const creator = await db.account.create({ data: { publicKey: "github-source-creator" } });
        const team = await db.team.create({ data: { name: "GitHub Team" } });
        const otherTeam = await db.team.create({ data: { name: "Other GitHub Team" } });
        const registration = await db.gitHubAppRegistration.create({
            data: {
                ownerTeamId: team.id,
                githubHost: "https://github.com",
                githubAppId: 10n,
                githubClientId: "client",
                config: createGitHubAppRegistrationConfigV1({ v: 1, privateKey: "private-key" }),
                encryptedSecrets: encryptGitHubAppRegistrationSecretsV1({
                    registrationId: "github-directory-registration",
                    secrets: { v: 1, privateKey: "private-key" },
                }),
                state: "verified",
                createdByAccountId: creator.id,
                id: "github-directory-registration",
            },
        });
        const installation = await db.gitHubAppInstallation.create({
            data: {
                registrationId: registration.id,
                githubInstallationId: 101n,
                githubOrganizationId: 202n,
                githubOrganizationLogin: "Acme",
                repositorySelection: "all",
                state: "verified",
                verifiedPermissions: { members: "read" },
            },
        });

        expect(await createDirectorySource({
            kind: "github_organization",
            teamId: otherTeam.id,
            githubAppInstallationId: installation.id,
            displayName: "Wrong Team",
        })).toEqual({ ok: false, code: "directory_source_identity_mismatch" });

        const created = await createDirectorySource({
            kind: "github_organization",
            teamId: team.id,
            githubAppInstallationId: installation.id,
            displayName: "GitHub Acme",
        });
        expect(created).toEqual({ ok: true, sourceId: expect.any(String) });
        expect(await db.teamDirectorySource.findUniqueOrThrow({
            where: { id: created.ok ? created.sourceId : "unreachable" },
        })).toMatchObject({
            teamId: team.id,
            kind: "github_organization",
            state: "initializing",
            externalSourceKey: expect.stringMatching(/^github_organization:[A-Za-z0-9_-]{43}$/),
            bindingConfig: { v: 1, kind: "github_organization", githubOrganizationLogin: "Acme" },
            teamIdentityConnectionId: null,
            githubAppInstallationId: installation.id,
            eventRangeStart: null,
            activeReconcileRunId: expect.any(String),
            activeReconcileStartedAt: expect.any(Date),
        });
    });

    it("rejects a verified GitHub installation that is not currently ready for directory reads", async () => {
        const creator = await db.account.create({ data: { publicKey: "github-unready-source-creator" } });
        const team = await db.team.create({ data: { name: "Unready GitHub Team" } });
        const registrationId = "github-unready-directory-registration";
        const registration = await db.gitHubAppRegistration.create({
            data: {
                id: registrationId,
                ownerTeamId: team.id,
                githubHost: "https://github.com",
                githubAppId: 20n,
                githubClientId: "client",
                config: createGitHubAppRegistrationConfigV1({ v: 1, clientSecret: "identity-only" }),
                encryptedSecrets: encryptGitHubAppRegistrationSecretsV1({
                    registrationId,
                    secrets: { v: 1, clientSecret: "identity-only" },
                }),
                state: "verified",
                createdByAccountId: creator.id,
            },
        });
        const installation = await db.gitHubAppInstallation.create({
            data: {
                registrationId: registration.id,
                githubInstallationId: 201n,
                githubOrganizationId: 202n,
                githubOrganizationLogin: "Acme",
                repositorySelection: "all",
                state: "verified",
                verifiedPermissions: { contents: "read" },
            },
        });

        await expect(createDirectorySource({
            kind: "github_organization",
            teamId: team.id,
            githubAppInstallationId: installation.id,
            displayName: "Unready GitHub directory",
        })).resolves.toEqual({ ok: false, code: "directory_source_identity_mismatch" });
        await expect(db.teamDirectorySource.count({
            where: { githubAppInstallationId: installation.id },
        })).resolves.toBe(0);
    });
});
