import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    claimDirectorySourceFullReconcile,
    findNextDirectorySourceDueForSync,
    markActiveWorkosDirectoryPollFailed,
    markDirectorySourceReconcileFailed,
    requestDirectorySourceSync,
} from "./directorySourceService";

describe("directory source lifecycle", () => {
    let harness: LightSqliteHarness;

    async function createWorkosSource(params: Readonly<{
        teamId: string;
        state: "active" | "initializing";
        suffix: string;
        data?: Record<string, unknown>;
    }>) {
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: params.teamId,
                kind: "workos_sso",
                displayName: "WorkOS",
                config: { v: 1 },
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId: params.teamId,
                providerInstanceId: provider.id,
                externalReference: { v: 1 },
                settings: { v: 1 },
            },
        });
        return await db.teamDirectorySource.create({
            data: {
                teamId: params.teamId,
                kind: "workos_directory",
                state: params.state,
                displayName: "WorkOS",
                externalSourceKey: `workos:${params.teamId}:${params.suffix}`,
                bindingConfig: { v: 1, kind: "workos_directory", workosDirectoryId: params.suffix },
                teamIdentityConnectionId: connection.id,
                ...params.data,
            },
        });
    }

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-directory-lifecycle-",
            initAuth: false,
            env: { HAPPIER_FEATURE_TEAMS__ENABLED: "1" },
        });
        await db.homeGovernancePolicy.create({
            data: {
                id: "home",
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ["workos_sso"],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    it("selects durable manual work, replaces an abandoned run, and fences stale failure", async () => {
        const team = await db.team.create({ data: { name: "Lifecycle Team" } });
        const requestedAt = new Date("2026-09-05T12:00:00.000Z");
        const source = await createWorkosSource({
            teamId: team.id,
            state: "initializing",
            suffix: "lifecycle",
            data: {
                activeReconcileRunId: "abandoned-run",
                activeReconcileStartedAt: new Date("2026-09-05T10:00:00.000Z"),
                lastAttemptAt: new Date("2026-09-05T10:00:00.000Z"),
                manualSyncRequestedAt: requestedAt,
            },
        });

        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-05T12:01:00.000Z"),
        })).resolves.toMatchObject({ id: source.id, mode: "full" });

        const claimed = await claimDirectorySourceFullReconcile({
            sourceId: source.id,
            reconcileRunId: "current-run",
            now: new Date("2026-09-05T12:01:00.000Z"),
        });
        expect(claimed).toMatchObject({
            ok: true,
            source: {
                id: source.id,
                kind: "workos_directory",
                reconcileRunId: "current-run",
                observedManualSyncRequestedAt: requestedAt,
            },
        });

        await expect(markDirectorySourceReconcileFailed({
            sourceId: source.id,
            reconcileRunId: "abandoned-run",
            errorCode: "directory_snapshot_incomplete",
        })).resolves.toEqual({ applied: false, reason: "stale_run" });
        await expect(markDirectorySourceReconcileFailed({
            sourceId: source.id,
            reconcileRunId: "current-run",
            errorCode: "directory_snapshot_incomplete",
        })).resolves.toEqual({ applied: true });

        await expect(db.teamDirectorySource.findUniqueOrThrow({ where: { id: source.id } })).resolves.toMatchObject({
            state: "needs_attention",
            activeReconcileRunId: null,
            lastErrorCode: "directory_snapshot_incomplete",
            manualSyncRequestedAt: requestedAt,
        });
        await db.teamDirectorySource.update({
            where: { id: source.id },
            data: { state: "paused", manualSyncRequestedAt: null },
        });
    });

    it("coalesces a durable request and never treats a paused source as runnable", async () => {
        const team = await db.team.create({ data: { name: "Manual Sync Team" } });
        const source = await createWorkosSource({
            teamId: team.id,
            state: "active",
            suffix: "manual",
            data: {
                lastAttemptAt: new Date("2026-09-05T11:00:00.000Z"),
                lastFullReconcileAt: new Date("2026-09-05T11:00:00.000Z"),
            },
        });
        const requestedAt = new Date("2026-09-05T12:00:00.000Z");

        await expect(requestDirectorySourceSync({ sourceId: source.id, now: requestedAt }))
            .resolves.toEqual({ ok: true, status: "requested" });
        await expect(requestDirectorySourceSync({
            sourceId: source.id,
            now: new Date("2026-09-05T12:00:01.000Z"),
        })).resolves.toEqual({ ok: true, status: "coalesced" });

        await db.teamDirectorySource.update({ where: { id: source.id }, data: { state: "paused" } });
        await expect(requestDirectorySourceSync({
            sourceId: source.id,
            now: new Date("2026-09-05T12:00:02.000Z"),
        })).resolves.toEqual({ ok: false, code: "directory_sync_needs_attention" });
        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-05T12:01:00.000Z"),
        })).resolves.toBeNull();
    });

    it("schedules WorkOS incremental observations at five minutes and full repair daily", async () => {
        const team = await db.team.create({ data: { name: "Scheduled Sync Team" } });
        const source = await createWorkosSource({
            teamId: team.id,
            state: "active",
            suffix: "scheduled",
            data: {
                lastAttemptAt: new Date("2026-09-05T11:55:00.000Z"),
                lastSuccessAt: new Date("2026-09-05T11:55:59.000Z"),
                lastFullReconcileAt: new Date("2026-09-05T11:00:00.000Z"),
                eventCursor: "event_1",
            },
        });

        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-05T12:01:00.000Z"),
        })).resolves.toEqual({ id: source.id, mode: "incremental" });

        await db.teamDirectorySource.update({
            where: { id: source.id },
            data: { lastFullReconcileAt: new Date("2026-09-04T11:59:00.000Z") },
        });
        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-05T12:01:00.000Z"),
        })).resolves.toEqual({ id: source.id, mode: "full" });
    });

    it("routes an unfinished active observation to full repair without waiting for cadence", async () => {
        await db.teamDirectorySource.updateMany({ data: { state: "paused" } });
        const team = await db.team.create({ data: { name: "Abandoned Active Observation Team" } });
        const now = new Date("2026-09-05T12:00:00.000Z");
        const source = await createWorkosSource({
            teamId: team.id,
            state: "active",
            suffix: "abandoned-active-observation",
            data: {
                activeReconcileRunId: "abandoned-event-page-attempt",
                activeReconcileStartedAt: new Date("2026-09-05T11:59:00.000Z"),
                lastAttemptAt: new Date("2026-09-05T11:59:00.000Z"),
                lastSuccessAt: new Date("2026-09-05T11:59:00.000Z"),
                lastFullReconcileAt: new Date("2026-09-05T11:59:00.000Z"),
                eventCursor: "event_before_interruption",
            },
        });

        await expect(findNextDirectorySourceDueForSync({ now }))
            .resolves.toEqual({ id: source.id, mode: "full" });
    });

    it("persists bounded retry backoff, prevents manual bypass, and resets it when a run is claimed", async () => {
        const team = await db.team.create({ data: { name: "Retry Schedule Team" } });
        const failedAt = new Date("2026-09-05T13:00:00.000Z");
        const source = await createWorkosSource({
            teamId: team.id,
            state: "initializing",
            suffix: "retry-schedule",
            data: {
                activeReconcileRunId: "retry-run-1",
                activeReconcileStartedAt: failedAt,
                lastAttemptAt: failedAt,
            },
        });

        await markDirectorySourceReconcileFailed({
            sourceId: source.id,
            reconcileRunId: "retry-run-1",
            errorCode: "directory_snapshot_incomplete",
            consecutiveFailureCount: 0,
            now: failedAt,
        });
        await requestDirectorySourceSync({
            sourceId: source.id,
            now: new Date("2026-09-05T13:00:05.000Z"),
        });
        await expect(claimDirectorySourceFullReconcile({
            sourceId: source.id,
            reconcileRunId: "too-early",
            now: new Date("2026-09-05T13:00:29.999Z"),
        })).resolves.toEqual({ ok: false, code: "directory_sync_needs_attention" });

        const second = await claimDirectorySourceFullReconcile({
            sourceId: source.id,
            reconcileRunId: "retry-run-2",
            now: new Date("2026-09-05T13:00:30.000Z"),
        });
        expect(second).toMatchObject({ ok: true, source: { consecutiveFailureCount: 1 } });
        if (!second.ok) throw new Error("second retry claim failed");
        await markDirectorySourceReconcileFailed({
            sourceId: source.id,
            reconcileRunId: second.source.reconcileRunId,
            errorCode: "directory_snapshot_incomplete",
            consecutiveFailureCount: second.source.consecutiveFailureCount,
            now: new Date("2026-09-05T13:00:30.000Z"),
        });
        await expect(db.teamDirectorySource.findUniqueOrThrow({ where: { id: source.id } }))
            .resolves.toMatchObject({
                consecutiveFailureCount: 2,
                retryNotBefore: new Date("2026-09-05T13:02:30.000Z"),
            });

        const cancelled = await claimDirectorySourceFullReconcile({
            sourceId: source.id,
            reconcileRunId: "cancelled-run",
            now: new Date("2026-09-05T13:02:30.000Z"),
        });
        expect(cancelled).toMatchObject({ ok: true, source: { consecutiveFailureCount: 2 } });
        await expect(db.teamDirectorySource.findUniqueOrThrow({ where: { id: source.id } }))
            .resolves.toMatchObject({ consecutiveFailureCount: 0, retryNotBefore: null });
    });

    it("recovers a lost WorkOS cursor through a new boundary instead of skipping events", async () => {
        const team = await db.team.create({ data: { name: "Cursor Loss Team" } });
        const lastSuccessAt = new Date("2026-09-05T14:00:00.000Z");
        const failedAt = new Date("2026-09-05T14:05:00.000Z");
        const source = await createWorkosSource({
            teamId: team.id,
            state: "active",
            suffix: "cursor-loss",
            data: {
                eventCursor: "event_expired",
                lastAttemptAt: failedAt,
                lastSuccessAt,
                lastFullReconcileAt: lastSuccessAt,
            },
        });

        await expect(markActiveWorkosDirectoryPollFailed({
            sourceId: source.id,
            expectedPosition: { eventCursor: "event_expired" },
            errorCode: "directory_cursor_expired",
            now: failedAt,
        })).resolves.toEqual({ applied: true });

        // The unusable bookmark is dropped, the source stops claiming freshness,
        // and the previously committed success horizon is retained.
        await expect(db.teamDirectorySource.findUniqueOrThrow({ where: { id: source.id } }))
            .resolves.toMatchObject({
                state: "needs_attention",
                eventCursor: null,
                eventRangeStart: null,
                lastErrorCode: "directory_cursor_expired",
                lastSuccessAt,
            });

        const retryAt = new Date("2026-09-05T14:05:30.000Z");
        // Park the sources left behind by the earlier cases so this assertion
        // observes the cursor-loss source rather than the oldest attempt.
        await db.teamDirectorySource.updateMany({
            where: { id: { not: source.id } },
            data: { state: "paused" },
        });
        await expect(findNextDirectorySourceDueForSync({ now: retryAt }))
            .resolves.toMatchObject({ id: source.id, mode: "full" });

        const claimed = await claimDirectorySourceFullReconcile({
            sourceId: source.id,
            reconcileRunId: "cursor-repair-run",
            now: retryAt,
        });
        expect(claimed).toMatchObject({
            ok: true,
            source: { eventCursor: null, eventRangeStart: retryAt },
        });
        await expect(db.teamDirectorySource.findUniqueOrThrow({ where: { id: source.id } }))
            .resolves.toMatchObject({ state: "initializing", eventRangeStart: retryAt, lastSuccessAt });
    });

    it("skips the oldest policy-disabled source and selects later eligible work", async () => {
        await db.teamDirectorySource.updateMany({ data: { state: "paused" } });
        const githubTeam = await db.team.create({ data: { name: "Disabled GitHub Directory Team" } });
        const registration = await db.gitHubAppRegistration.create({
            data: {
                ownerTeamId: githubTeam.id,
                githubHost: "https://github.com",
                githubAppId: 9001n,
                githubClientId: "disabled-directory-client",
                config: { v: 1 },
                encryptedSecrets: Buffer.from("disabled-directory-secret"),
                state: "verified",
            },
        });
        const installation = await db.gitHubAppInstallation.create({
            data: {
                registrationId: registration.id,
                githubInstallationId: 9002n,
                githubOrganizationId: 9003n,
                githubOrganizationLogin: "disabled-directory-org",
                repositorySelection: "all",
                state: "verified",
            },
        });
        await db.teamDirectorySource.create({
            data: {
                teamId: githubTeam.id,
                kind: "github_organization",
                state: "needs_attention",
                displayName: "Disabled GitHub",
                externalSourceKey: "github:policy-disabled-oldest",
                bindingConfig: {
                    v: 1,
                    kind: "github_organization",
                    githubOrganizationLogin: "disabled-directory-org",
                },
                githubAppInstallationId: installation.id,
                manualSyncRequestedAt: new Date("2026-09-05T09:00:00.000Z"),
                lastAttemptAt: new Date("2026-09-05T08:00:00.000Z"),
            },
        });
        const eligibleTeam = await db.team.create({ data: { name: "Eligible WorkOS Directory Team" } });
        const eligible = await createWorkosSource({
            teamId: eligibleTeam.id,
            state: "active",
            suffix: "policy-eligible-later",
            data: {
                manualSyncRequestedAt: new Date("2026-09-05T10:00:00.000Z"),
                lastAttemptAt: new Date("2026-09-05T09:00:00.000Z"),
            },
        });

        await expect(findNextDirectorySourceDueForSync({
            now: new Date("2026-09-05T12:00:00.000Z"),
        })).resolves.toEqual({ id: eligible.id, mode: "full" });
    });
});
