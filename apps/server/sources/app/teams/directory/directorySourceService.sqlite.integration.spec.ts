import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    createGitHubAppRegistrationConfigV1,
    encryptGitHubAppRegistrationSecretsV1,
} from "@/app/integrations/github/githubManagedApp";
import {
    claimDirectorySourceFullReconcile,
    createDirectorySource,
    findNextDirectorySourceDueForSync,
    markActiveWorkosDirectoryPollFailed,
    markDirectorySourceReconcileFailed,
    requestDirectorySourceSync,
} from "./directorySourceService";

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

    async function createWorkosSource(input: Readonly<{
        name: string;
        state: "active" | "needs_attention";
        lastErrorCode: string | null;
    }>) {
        const team = await db.team.create({ data: { name: input.name } });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: "workos_sso",
                displayName: `WorkOS ${input.name}`,
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
                    organizationId: `organization_${input.name}`,
                    connectionId: null,
                },
                settings: { v: 1, kind: "workos_sso" },
                enabled: true,
            },
        });
        // The canonical creator owns the identity columns and the kind/reference
        // invariant the schema enforces, so the fixture only moves the created
        // row to the lifecycle position under test.
        const created = await createDirectorySource({
            kind: "workos_directory",
            teamId: team.id,
            teamIdentityConnectionId: connection.id,
            workosDirectoryId: "directory_01",
            displayName: input.name,
        });
        if (!created.ok) throw new Error(`fixture directory source not created: ${created.code}`);
        const source = await db.teamDirectorySource.update({
            where: { id: created.sourceId },
            data: {
                state: input.state,
                activeReconcileRunId: null,
                activeReconcileStartedAt: null,
                manualSyncRequestedAt: null,
                eventCursor: "event_01",
                eventRangeStart: null,
                lastAttemptAt: new Date("2026-09-05T10:00:00.000Z"),
                lastSuccessAt: new Date("2026-09-05T10:00:00.000Z"),
                lastFullReconcileAt: new Date("2026-09-05T10:00:00.000Z"),
                lastErrorCode: input.lastErrorCode,
                consecutiveFailureCount: 0,
                retryNotBefore: null,
            },
        });
        return { team, source };
    }

    it("stops re-offering an active source parked on a non-retryable failure", async () => {
        await db.teamDirectorySource.deleteMany({});
        // The incremental claim clears `lastErrorCode` on every re-claim, so a
        // selectable source with an unrepairable failure is an unbounded
        // re-drain against the provider inside one worker pass.
        const { source } = await createWorkosSource({
            name: "parked",
            state: "active",
            lastErrorCode: "directory_source_identity_mismatch",
        });

        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-06T10:00:00.000Z"),
        })).resolves.toBeNull();

        await db.teamDirectorySource.update({
            where: { id: source.id },
            data: { lastErrorCode: "directory_sync_unavailable" },
        });
        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-06T10:00:00.000Z"),
        })).resolves.toEqual({ id: source.id, mode: "full" });
    });

    it("retries a source parked on a non-retryable failure with one complete scan per press", async () => {
        await db.teamDirectorySource.deleteMany({});
        const { source } = await createWorkosSource({
            name: "parked-retry",
            state: "active",
            lastErrorCode: null,
        });
        // Park the source the way production does: a claimed complete scan
        // fails with a failure that repeating the work on a timer cannot clear.
        const firstRun = await claimDirectorySourceFullReconcile({
            sourceId: source.id,
            reconcileRunId: "parked-run-1",
            now: new Date("2026-09-06T09:00:00.000Z"),
        });
        expect(firstRun.ok).toBe(true);
        await expect(markDirectorySourceReconcileFailed({
            sourceId: source.id,
            reconcileRunId: "parked-run-1",
            errorCode: "directory_source_permission_lost",
            now: new Date("2026-09-06T09:01:00.000Z"),
        })).resolves.toEqual({ applied: true });
        // Nothing retries it automatically.
        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-06T09:30:00.000Z"),
        })).resolves.toBeNull();

        // child 05 §14.1: a failed source offers Retry, and recovery starts
        // another complete scan (§9.6). The press is accepted, not refused.
        await expect(requestDirectorySourceSync({
            sourceId: source.id,
            now: new Date("2026-09-06T10:00:00.000Z"),
        })).resolves.toEqual({ ok: true, status: "requested" });
        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-06T10:00:01.000Z"),
        })).resolves.toEqual({ id: source.id, mode: "full" });
        const retryRun = await claimDirectorySourceFullReconcile({
            sourceId: source.id,
            reconcileRunId: "parked-run-2",
            now: new Date("2026-09-06T10:00:01.000Z"),
        });
        expect(retryRun).toMatchObject({
            ok: true,
            source: { observedManualSyncRequestedAt: new Date("2026-09-06T10:00:00.000Z") },
        });
        await expect(markDirectorySourceReconcileFailed({
            sourceId: source.id,
            reconcileRunId: "parked-run-2",
            errorCode: "directory_source_permission_lost",
            now: new Date("2026-09-06T10:00:02.000Z"),
        })).resolves.toEqual({ applied: true });

        // The press bought exactly one attempt: the attempted request is not
        // replayed on a timer against a failure only an administrator clears.
        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-06T10:30:00.000Z"),
        })).resolves.toBeNull();
        // A later press is a new request, never a silent coalesce into the
        // attempt that already failed.
        await expect(requestDirectorySourceSync({
            sourceId: source.id,
            now: new Date("2026-09-06T11:00:00.000Z"),
        })).resolves.toEqual({ ok: true, status: "requested" });
        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-06T11:00:01.000Z"),
        })).resolves.toEqual({ id: source.id, mode: "full" });
        // An unattempted request still coalesces.
        await expect(requestDirectorySourceSync({
            sourceId: source.id,
            now: new Date("2026-09-06T11:00:02.000Z"),
        })).resolves.toEqual({ ok: true, status: "coalesced" });
    });

    it("refuses Sync with the reason that actually blocks it", async () => {
        await db.teamDirectorySource.deleteMany({});
        const { source } = await createWorkosSource({
            name: "typed-refusals",
            state: "active",
            lastErrorCode: null,
        });

        // The Home no longer lets Teams use this provider kind: that is a Home
        // policy refusal, not a directory health problem Resume could clear.
        await db.homeGovernancePolicy.update({
            where: { id: "home" },
            data: {
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ["github_app_identity"],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
        try {
            await expect(requestDirectorySourceSync({ sourceId: source.id }))
                .resolves.toEqual({ ok: false, code: "team_identity_not_allowed" });
        } finally {
            await db.homeGovernancePolicy.update({
                where: { id: "home" },
                data: {
                    teamProviderPolicy: {
                        v: 1,
                        allowedTeamProviderKinds: ["workos_sso", "github_app_identity"],
                        teamJitAllowed: false,
                        approvedGitHubEnterpriseOrigins: [],
                    },
                },
            });
        }

        // A persisted binding document is untrusted at this boundary; one that
        // no longer parses for its kind is the claim path's identity mismatch.
        await db.teamDirectorySource.update({
            where: { id: source.id },
            data: { bindingConfig: { v: 1, kind: "github_organization" } },
        });
        await expect(requestDirectorySourceSync({ sourceId: source.id }))
            .resolves.toEqual({ ok: false, code: "directory_source_identity_mismatch" });

        // Only a paused source answers needs-attention (child 05 :498).
        await db.teamDirectorySource.update({ where: { id: source.id }, data: { state: "paused" } });
        await expect(requestDirectorySourceSync({ sourceId: source.id }))
            .resolves.toEqual({ ok: false, code: "directory_sync_needs_attention" });
        await expect(db.teamDirectorySource.findUniqueOrThrow({ where: { id: source.id } }))
            .resolves.toMatchObject({ manualSyncRequestedAt: null });
    });

    it("wakes the Team on a worker status transition and stays silent on an identical failure", async () => {
        await db.teamDirectorySource.deleteMany({});
        const { team, source } = await createWorkosSource({
            name: "publishing",
            state: "active",
            lastErrorCode: null,
        });
        const member = await db.account.create({ data: { publicKey: "directory-publication-member" } });
        await db.teamMembership.create({
            data: { teamId: team.id, accountId: member.id, role: "member" },
        });
        const readCursor = async () => (await db.account.findUniqueOrThrow({
            where: { id: member.id },
            select: { seq: true },
        })).seq;
        const before = await readCursor();

        await expect(markActiveWorkosDirectoryPollFailed({
            sourceId: source.id,
            expectedPosition: { eventCursor: "event_01" },
            errorCode: "directory_sync_unavailable",
        })).resolves.toEqual({ applied: true });
        const afterFailure = await readCursor();
        expect(afterFailure).toBeGreaterThan(before);

        await expect(markActiveWorkosDirectoryPollFailed({
            sourceId: source.id,
            expectedPosition: { eventCursor: "event_01" },
            errorCode: "directory_sync_unavailable",
        })).resolves.toEqual({ applied: true });
        expect(await readCursor()).toBe(afterFailure);

        // Claiming the repair scan moves the source into its running attempt
        // and clears the shown failure; a mounted detail must learn that.
        const claimed = await claimDirectorySourceFullReconcile({
            sourceId: source.id,
            reconcileRunId: "publishing-run",
            now: new Date("2099-01-01T00:00:00.000Z"),
        });
        expect(claimed.ok).toBe(true);
        expect(await readCursor()).toBeGreaterThan(afterFailure);
    });
});
