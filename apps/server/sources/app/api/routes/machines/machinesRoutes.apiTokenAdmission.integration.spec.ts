import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

import { auth } from "@/app/auth/auth";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import {
    ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER,
    MACHINE_PLAIN_DATA_KEY_MARKER,
} from "@happier-dev/protocol";

import { machinesRoutes } from "./machinesRoutes";

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;
    enableAuthentication(typed);
    machinesRoutes(typed);
    return typed;
}

describe("machinesRoutes API-token admission (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-machine-pat-discovery-",
            initAuth: true,
            env: {
                AUTH_REQUIRED_LOGIN_PROVIDERS: "",
                AUTH_LOGIN_ELIGIBILITY_CACHE_TTL_MS: "0",
            },
        });
    }, 120_000);

    afterEach(async () => {
        harness.resetEnv();
        await db.machine.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("omits temporary computers from ordinary discovery but retains exact Account detail", async () => {
        const account = await db.account.create({
            data: { publicKey: null, encryptionMode: "e2ee" },
        });
        await db.machine.createMany({ data: [
            { id: "persistent", accountId: account.id, metadata: "encrypted" },
            { id: "temporary", accountId: account.id, metadata: "encrypted", kind: "ephemeral_session_runner" },
        ] });
        const token = await auth.createToken(account.id, undefined, { kind: "account", authority: "present_user" });
        const app = createTestApp();
        await app.ready();
        try {
            const headers = { authorization: `Bearer ${token}` };
            const list = await app.inject({ method: "GET", url: "/v1/machines", headers });
            expect(list.statusCode).toBe(200);
            expect(list.json()).toEqual([expect.objectContaining({ id: "persistent", kind: "persistent" })]);
            const exact = await app.inject({ method: "GET", url: "/v1/machines/temporary", headers });
            expect(exact.statusCode).toBe(200);
            expect(exact.json()).toMatchObject({ machine: { id: "temporary", kind: "ephemeral_session_runner" } });
        } finally {
            await app.close();
        }
    });

    it("returns PAT callers only the strict machine-selection bootstrap projection", async () => {
        const account = await db.account.create({
            data: { publicKey: null, encryptionMode: "plain" },
            select: { id: true },
        });
        await db.machine.create({
            data: {
                id: "machine-1",
                accountId: account.id,
                metadata: '{"t":"plain","v":{"host":"workstation"}}',
                daemonState: '{"t":"plain","v":{"status":"running"}}',
                dataEncryptionKey: new Uint8Array(
                    Buffer.from(MACHINE_PLAIN_DATA_KEY_MARKER, "base64"),
                ),
                installationId: "installation-1",
                installationPublicKey: new Uint8Array([1, 2, 3]),
                contentPublicKeyFingerprint: "sensitive-fingerprint",
                replacedByMachineId: "machine-2",
                active: false,
                revokedAt: new Date(1234),
            },
        });
        const pat = await auth.createApiToken({
            accountId: account.id,
            tokenId: crypto.randomUUID(),
            label: "Machine discovery",
        });
        const app = createTestApp();
        await app.ready();

        try {
            const response = await app.inject({
                method: "GET",
                url: "/v1/machines",
                headers: { authorization: `Bearer ${pat.token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual([{
                id: "machine-1",
                active: false,
                revokedAt: 1234,
                replacedByMachineId: "machine-2",
            }]);
        } finally {
            await app.close();
        }
    });

    it("projects the placement-origin capability from the Machine list only to V4 readers", async () => {
        const account = await db.account.create({
            data: { publicKey: null, encryptionMode: "e2ee" },
            select: { id: true },
        });
        await db.machine.create({
            data: {
                id: "machine-1",
                accountId: account.id,
                metadata: "encrypted-metadata",
                dataEncryptionKey: new Uint8Array(32).fill(1),
                operationProtocolCapabilities: {
                    sessionSpawn: { protocolVersions: [1] },
                    sessionSpawnPlacementOrigin: { protocolVersions: [1] },
                },
                operationProtocolCapabilitiesRevision: 1,
            },
        });
        const token = await auth.createToken(
            account.id,
            undefined,
            { kind: "account", authority: "present_user" },
        );
        const app = createTestApp();
        await app.ready();

        try {
            const readMachines = async (protocolVersion: 3 | 4) => app.inject({
                method: "GET",
                url: "/v1/machines",
                headers: {
                    authorization: `Bearer ${token}`,
                    [ACCOUNT_STORED_CONTENT_COMPATIBILITY_HTTP_HEADER]: String(protocolVersion),
                },
            });
            const preV4 = await readMachines(3);
            const v4 = await readMachines(4);

            expect(preV4.statusCode).toBe(200);
            expect(preV4.json()[0].operationProtocolCapabilities).toEqual({
                sessionSpawn: { protocolVersions: [1] },
            });
            expect(v4.statusCode).toBe(200);
            expect(v4.json()[0].operationProtocolCapabilities).toEqual({
                sessionSpawn: { protocolVersions: [1] },
                sessionSpawnPlacementOrigin: { protocolVersions: [1] },
            });
        } finally {
            await app.close();
        }
    });
});
