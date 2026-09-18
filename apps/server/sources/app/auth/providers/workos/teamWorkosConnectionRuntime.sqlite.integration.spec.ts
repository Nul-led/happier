import type { WorkOS } from "@workos-inc/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    computeTeamWorkosConnectionRuntimeFingerprint,
    resolveTeamWorkosConnectionRuntimeInTx,
} from "./teamWorkosConnectionRuntime";

describe("Team WorkOS connection runtime", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-team-workos-runtime-",
            initAuth: false,
        });
    }, 120_000);
    afterAll(async () => await harness.close());

    it("resolves a Home-owned provider only through the exact enabled Team binding", async () => {
        const team = await db.team.create({ data: { name: "WorkOS Team" } });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: null,
                kind: "workos_sso",
                displayName: "Company SSO",
                enabled: true,
                firstEnabledAt: new Date(),
                securityRevision: 4,
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
                    organizationId: "org_exact",
                    connectionId: "conn_exact",
                },
                settings: { v: 1, kind: "workos_sso" },
                enabled: true,
                firstEnabledAt: new Date(),
                revision: 7,
            },
        });
        const client = {} as WorkOS;
        const result = await inTx((tx) => resolveTeamWorkosConnectionRuntimeInTx(tx, {
            env: {},
            teamId: team.id,
            connectionId: connection.id,
        }, {
            resolvePlatform: () => ({
                available: true,
                clientId: "client_exact",
                client,
                runtimeFingerprint: "workos-platform:v1:exact",
            }),
        }));
        expect(result).toMatchObject({
            status: "ready",
            provider: { id: provider.id, owner: { kind: "home" }, securityRevision: 4 },
            connection: {
                id: connection.id,
                teamId: team.id,
                revision: 7,
                externalReference: {
                    organizationId: "org_exact",
                    connectionId: "conn_exact",
                },
            },
            platform: { clientId: "client_exact", client },
        });
        expect(result.status === "ready" && result.runtimeFingerprint).toContain(":4:7:");
        expect(result.status === "ready" && result.runtimeFingerprint).toBe(
            computeTeamWorkosConnectionRuntimeFingerprint({
                teamId: team.id,
                connectionId: connection.id,
                providerInstanceId: provider.id,
                providerSecurityRevision: 4,
                connectionRevision: 7,
                platformRuntimeFingerprint: "workos-platform:v1:exact",
            }),
        );

        await db.teamIdentityConnection.update({
            where: { id: connection.id },
            data: { enabled: false, revision: 8 },
        });
        await expect(inTx((tx) => resolveTeamWorkosConnectionRuntimeInTx(tx, {
            env: {}, teamId: team.id, connectionId: connection.id,
        }, {
            resolvePlatform: () => ({
                available: true,
                clientId: "client_exact",
                client,
                runtimeFingerprint: "workos-platform:v1:exact",
            }),
        }))).resolves.toEqual({ status: "connection_disabled" });
    });

    it("resolves a Directory carrier from an exact organization without an SSO connection", async () => {
        const team = await db.team.create({ data: { name: "Directory-only WorkOS Team" } });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: "workos_sso",
                displayName: "Directory WorkOS",
                enabled: true,
                firstEnabledAt: new Date(),
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
                    organizationId: "org_directory_only",
                    connectionId: null,
                },
                settings: { v: 1, kind: "workos_sso" },
                enabled: false,
            },
        });
        const client = {} as WorkOS;
        const dependencies = {
            resolvePlatform: () => ({
                available: true as const,
                clientId: "client_exact",
                client,
                runtimeFingerprint: "workos-platform:v1:directory",
            }),
        };

        await expect(inTx((tx) => resolveTeamWorkosConnectionRuntimeInTx(tx, {
            env: {},
            teamId: team.id,
            connectionId: connection.id,
        }, dependencies))).resolves.toEqual({ status: "connection_disabled" });
        const directory = await inTx((tx) => resolveTeamWorkosConnectionRuntimeInTx(tx, {
            env: {},
            teamId: team.id,
            connectionId: connection.id,
            purpose: "directory",
        }, dependencies));
        expect(directory).toMatchObject({
            status: "ready",
            purpose: "directory",
            connection: {
                id: connection.id,
                externalReference: {
                    organizationId: "org_directory_only",
                    connectionId: null,
                },
            },
            platform: { client },
        });
    });
});
