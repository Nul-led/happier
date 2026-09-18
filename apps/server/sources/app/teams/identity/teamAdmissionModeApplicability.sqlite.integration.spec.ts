import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { resolveTeamAdmissionModeApplicabilityInTx } from "./teamAdmissionModeApplicability";

describe("Team admission-mode applicability", () => {
    let harness: LightSqliteHarness;
    let env: NodeJS.ProcessEnv;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-team-admission-mode-applicability-",
            initAuth: false,
            env: {
                HAPPIER_PUBLIC_SERVER_URL: "https://home.example.test",
                WORKOS_API_KEY: "sk_test_exact",
                WORKOS_CLIENT_ID: "client_exact",
            },
        });
        env = harness.resetEnv();
        await db.homeGovernancePolicy.create({
            data: {
                id: "home",
                revision: 1,
                teamCreationPolicy: "self_service",
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ["workos_sso"],
                    teamJitAllowed: true,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    async function resolve(teamId: string) {
        return await inTx(async (tx) => await resolveTeamAdmissionModeApplicabilityInTx({
            tx,
            env,
            teamId,
        }));
    }

    async function createWorkosConnection(teamId: string) {
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: teamId,
                kind: "workos_sso",
                displayName: "Company SSO",
                enabled: true,
                firstEnabledAt: new Date("2026-09-12T00:00:00.000Z"),
                config: { v: 1, kind: "workos_sso" },
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId,
                providerInstanceId: provider.id,
                externalReference: {
                    v: 1,
                    kind: "workos_sso",
                    organizationId: `org_${teamId}`,
                    connectionId: `conn_${teamId}`,
                },
                settings: { v: 1, kind: "workos_sso" },
                enabled: true,
                firstEnabledAt: new Date("2026-09-12T00:00:00.000Z"),
            },
        });
        return { provider, connection };
    }

    async function createCompletedSource(input: Readonly<{
        teamId: string;
        connectionId?: string;
        activeReconcileRunId?: string | null;
    }>) {
        return await db.teamDirectorySource.create({
            data: {
                teamId: input.teamId,
                kind: "workos_directory",
                state: "active",
                displayName: "Company directory",
                externalSourceKey: `directory_${input.teamId}_${crypto.randomUUID()}`,
                bindingConfig: {
                    v: 1,
                    kind: "workos_directory",
                    workosDirectoryId: `directory_${input.teamId}`,
                },
                teamIdentityConnectionId: input.connectionId,
                activeReconcileRunId: input.activeReconcileRunId ?? null,
            },
        });
    }

    it("requires exact-Team current directory and connection evidence", async () => {
        const team = await db.team.create({ data: { name: "Admission target" } });
        const otherTeam = await db.team.create({ data: { name: "Other Team" } });
        const otherConnection = await createWorkosConnection(otherTeam.id);
        await createCompletedSource({ teamId: otherTeam.id, connectionId: otherConnection.connection.id });

        await expect(resolve(team.id)).resolves.toEqual({
            v: 1,
            modes: {
                invite_only: { status: "available" },
                provisioned: { status: "unavailable", reason: "directory_source_required" },
                jit: { status: "unavailable", reason: "team_connection_required" },
            },
        });

        const current = await createWorkosConnection(team.id);
        const source = await createCompletedSource({ teamId: team.id, connectionId: current.connection.id });
        await expect(resolve(team.id)).resolves.toMatchObject({
            modes: {
                provisioned: { status: "available" },
                jit: { status: "available" },
            },
        });

        await db.teamDirectorySource.update({
            where: { id: source.id },
            data: {
                activeReconcileRunId: "run_in_progress",
                activeReconcileStartedAt: new Date("2026-09-06T10:00:00.000Z"),
            },
        });
        await db.teamIdentityConnection.update({
            where: { id: current.connection.id },
            data: {
                enabled: false,
                revision: { increment: 1 },
            },
        });
        await expect(resolve(team.id)).resolves.toMatchObject({
            modes: {
                provisioned: { status: "unavailable", reason: "directory_projection_required" },
                jit: { status: "unavailable", reason: "team_connection_unavailable" },
            },
        });

        await db.teamDirectorySource.delete({ where: { id: source.id } });
        await db.teamIdentityConnection.update({
            where: { id: current.connection.id },
            data: {
                enabled: true,
                revision: { increment: 1 },
                externalReference: {
                    v: 1,
                    kind: "workos_sso",
                    organizationId: `org_${team.id}`,
                    connectionId: null,
                },
            },
        });
        await expect(resolve(team.id)).resolves.toMatchObject({
            modes: {
                provisioned: { status: "unavailable", reason: "directory_source_required" },
                jit: { status: "unavailable", reason: "team_connection_unavailable" },
            },
        });

        await db.teamIdentityConnection.update({
            where: { id: current.connection.id },
            data: {
                revision: { increment: 1 },
                externalReference: {
                    v: 1,
                    kind: "workos_sso",
                    organizationId: `org_${team.id}`,
                    connectionId: `conn_${team.id}`,
                },
            },
        });
        const runtimeUnavailableEnv = { ...env, WORKOS_API_KEY: undefined };
        await expect(inTx(async (tx) => await resolveTeamAdmissionModeApplicabilityInTx({
            tx,
            env: runtimeUnavailableEnv,
            teamId: team.id,
        }))).resolves.toMatchObject({
            modes: { jit: { status: "unavailable", reason: "team_connection_unavailable" } },
        });
    });

    it("reflects current Home provider and JIT ceilings", async () => {
        const team = await db.team.create({ data: { name: "Policy target" } });
        const current = await createWorkosConnection(team.id);
        await createCompletedSource({ teamId: team.id, connectionId: current.connection.id });

        await db.homeGovernancePolicy.update({
            where: { id: "home" },
            data: {
                revision: { increment: 1 },
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: [],
                    teamJitAllowed: true,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
        await expect(resolve(team.id)).resolves.toMatchObject({
            modes: {
                provisioned: { status: "unavailable", reason: "home_policy_prohibited" },
                jit: { status: "unavailable", reason: "home_policy_prohibited" },
            },
        });

        await db.homeGovernancePolicy.update({
            where: { id: "home" },
            data: {
                revision: { increment: 1 },
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ["workos_sso"],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
        await expect(resolve(team.id)).resolves.toMatchObject({
            modes: {
                provisioned: { status: "available" },
                jit: { status: "unavailable", reason: "home_policy_prohibited" },
            },
        });

        await db.homeGovernancePolicy.update({
            where: { id: "home" },
            data: { revision: { increment: 1 }, teamProviderPolicy: { unsupported: true } },
        });
        await expect(resolve(team.id)).resolves.toMatchObject({
            modes: {
                invite_only: { status: "available" },
                provisioned: { status: "unavailable", reason: "home_policy_unavailable" },
                jit: { status: "unavailable", reason: "home_policy_unavailable" },
            },
        });
    });
});
