import { request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";
import tweetnacl from "tweetnacl";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
    normalizePluginReleaseFactsV1,
    PLUGIN_INSTALLATION_MANIFEST_PUBLISHER_HEADER_V1,
    type StoredPluginWebhookDeliveryContentV1,
} from "@happier-dev/protocol";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { createSignedPluginInstallationPublisherHeader } from "@/testkit/pluginInstallationPublisherTestkit";
import { createAuthenticatedTestApp } from "@/app/api/testkit/sqliteFastify";
import { registerPluginWebhookDaemonRoutes } from "@/app/api/routes/plugins/webhooks/registerPluginWebhookDaemonRoutes";

import { claimPluginWebhookDeliveryWithBoundedWaitV1 } from "./claimStore";
import { markPluginWebhookAccountChangedInTxV1 } from "./accountChange";

const SERVER_IDENTITY_ID = "srv_webhookClaimLongPo";
const NOW = new Date("2026-08-10T00:00:00.000Z");
const TARGET = {
    materialization: {
        machineId: "machine-longpoll",
        materializationId: "materialization-longpoll",
        pluginId: "acme.github",
    },
    machineInstallationId: "installation-longpoll",
} as const;
const MACHINE_CLAIM = {
    machineId: TARGET.materialization.machineId,
    machineInstallationId: TARGET.machineInstallationId,
} as const;
const ENVELOPE: StoredPluginWebhookDeliveryContentV1 = {
    t: "plain",
    v: {
        v: 1,
        receivedAtMs: NOW.getTime(),
        contentType: "application/json",
        headers: [{ name: "x-github-event", value: "issues" }],
        rawBodyBytes: 2,
        rawBodyBase64: "e30=",
        verified: {
            verifier: "github_hmac_sha256_v1",
            providerDeliveryId: "provider-longpoll-1",
            eventType: "issues",
            credentialVersionId: "credential-longpoll-1",
        },
    },
};
const RELEASE_FACTS = normalizePluginReleaseFactsV1({
    ref: { pluginId: TARGET.materialization.pluginId, version: "1.0.0" },
    archiveDigestSha256: `sha256:${"a".repeat(64)}`,
    normalizedManifest: {
        schemaVersion: 2,
        id: TARGET.materialization.pluginId,
        version: "1.0.0",
        displayName: "GitHub",
        engines: { happier: "^1.0.0" },
        runtime: { apiVersion: 1 },
        entrypoints: { daemon: "./dist/index.js" },
        contributes: {
            actions: [{
                id: "handle-webhook",
                title: "Handle webhook",
                scopes: ["global"],
                surfaces: ["plugin"],
                dangerLevel: "safe",
                execution: { target: "daemon" },
            }],
            webhooks: [{
                id: "github-events",
                title: "GitHub events",
                verifier: { kind: "github_hmac_sha256_v1", routing: "accountEndpoint" },
                handlerAction: { localId: "handle-webhook" },
            }],
        },
    },
    collectionContracts: [],
    uiSlots: [],
    packageAssetArchive: {
        archiveDigestSha256: `sha256:${"d".repeat(64)}`,
        resources: [],
    },
});

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutCount(): number {
    return process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
}

/**
 * The parked window is a fixed private implementation constant of the claim
 * owner, so the deadline behavior is pinned here through the public owner
 * boundary instead of through an exported policy number.
 */
const FIXED_PARK_MS_V1 = 30_000;

async function waitForParkedClaimTimers(expected: number): Promise<void> {
    const deadlineMs = performance.now() + 5_000;
    while (performance.now() < deadlineMs) {
        if (vi.getTimerCount() === expected) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Expected ${expected} parked claim timer(s), found ${vi.getTimerCount()}`);
}

describe("plugin webhook bounded claim", () => {
    let harness: LightSqliteHarness | undefined;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-plugin-webhook-claim-long-poll-",
            initAuth: false,
            env: {
                HAPPIER_SERVER_IDENTITY_ID: SERVER_IDENTITY_ID,
                HAPPIER_PUBLIC_SERVER_URL: "https://happier.example",
            },
        });
    }, 120_000);

    afterAll(async () => {
        await harness?.close();
    });

    afterEach(async () => {
        harness?.resetEnv();
        await harness?.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.pluginWebhookDelivery.deleteMany(),
            () => db.pluginWebhookEndpoint.deleteMany(),
            () => db.pluginWebhookRoute.deleteMany(),
            () => db.pluginMachineMaterialization.deleteMany(),
            () => db.accountPluginIntent.deleteMany(),
            () => db.accountPluginRelease.deleteMany(),
            () => db.machine.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    async function seedClaimableTarget(): Promise<{ endpointRevision: number }> {
        const account = await db.account.create({
            data: {
                id: "account-claim",
                publicKey: null,
                encryptionMode: "plain",
            },
        });
        await db.accountPluginIntent.create({
            data: {
                accountId: account.id,
                pluginId: TARGET.materialization.pluginId,
                desiredVersion: "1.0.0",
                enabled: true,
                writableCollections: [],
            },
        });
        await db.accountPluginRelease.create({
            data: {
                accountId: account.id,
                pluginId: TARGET.materialization.pluginId,
                version: "1.0.0",
                archiveDigestSha256: RELEASE_FACTS.archiveDigestSha256,
                normalizedManifest: RELEASE_FACTS.normalizedManifest,
                collectionContracts: RELEASE_FACTS.collectionContracts,
                uiSlots: RELEASE_FACTS.uiSlots,
                packageAssetArchive: RELEASE_FACTS.packageAssetArchive,
            },
        });
        await db.machine.create({
            data: {
                id: TARGET.materialization.machineId,
                accountId: account.id,
                metadata: "{}",
                installationId: TARGET.machineInstallationId,
                pluginMaterializationRevision: 1n,
                operationProtocolCapabilities: {
                    pluginWebhookClaim: { protocolVersions: [1] },
                },
                operationProtocolCapabilitiesRevision: 1,
            },
        });
        await db.pluginMachineMaterialization.create({
            data: {
                accountId: account.id,
                serverIdentityId: SERVER_IDENTITY_ID,
                machineId: TARGET.materialization.machineId,
                materializationId: TARGET.materialization.materializationId,
                pluginId: TARGET.materialization.pluginId,
                version: "1.0.0",
                sourceClass: "registryPackage",
                portableRelease: true,
                archiveDigestSha256: RELEASE_FACTS.archiveDigestSha256,
                uiArtifacts: [],
                enabled: true,
                trustState: "trusted",
                observedAt: NOW,
            },
        });
        const route = await db.pluginWebhookRoute.create({
            data: {
                id: "route-longpoll",
                opaqueRouteId: "opaque-longpoll",
                verifierKind: "github_hmac_sha256_v1",
                routingKind: "accountEndpoint",
            },
        });
        const endpoint = await db.pluginWebhookEndpoint.create({
            data: {
                id: "wh_ep_AAECAwQFBgcICQoLDA0ODw",
                accountId: account.id,
                pluginId: TARGET.materialization.pluginId,
                webhookContributionId: "github-events",
                handlerActionId: "handle-webhook",
                sourceInstanceId: "source-longpoll",
                ensureIdempotencyKey: "idempotency-longpoll-01",
                ensureRequestFingerprint: "a".repeat(64),
                setupKind: "accountEndpointV1",
                routeId: route.id,
                routingKind: "accountEndpoint",
                targetMachineId: TARGET.materialization.machineId,
                targetMachineInstallationId: TARGET.machineInstallationId,
                targetMaterializationId: TARGET.materialization.materializationId,
                targetPluginVersion: "1.0.0",
            },
        });
        await db.pluginWebhookRoute.update({
            where: { id: route.id },
            data: { accountEndpointId: endpoint.id },
        });
        return { endpointRevision: endpoint.revision };
    }

    function deliveryCreateData(params: Readonly<{ id: string; endpointRevision: number }>) {
        return {
            id: params.id,
            endpointId: "wh_ep_AAECAwQFBgcICQoLDA0ODw",
            accountId: "account-claim",
            routeId: "route-longpoll",
            deliveryIdentityDigest: "b".repeat(64),
            verifierKind: "github_hmac_sha256_v1",
            targetMachineId: TARGET.materialization.machineId,
            targetMachineInstallationId: TARGET.machineInstallationId,
            targetMaterializationId: TARGET.materialization.materializationId,
            targetPluginId: TARGET.materialization.pluginId,
            targetPluginVersion: "1.0.0",
            endpointRevision: params.endpointRevision,
            endpointWebhookContributionId: "github-events",
            endpointHandlerActionId: "handle-webhook",
            endpointSourceInstanceId: "source-longpoll",
            payloadKind: "plain",
            payload: ENVELOPE,
            payloadBytes: 256n,
            wireVersion: 1,
            payloadVersion: 1,
            state: "queued",
            attemptCount: 0,
            nextAttemptAt: NOW,
            metadataDeleteAt: new Date(NOW.getTime() + 97 * 24 * 60 * 60 * 1_000),
            receivedAt: NOW,
        } as const;
    }

    async function seedDueDelivery(id = "delivery-longpoll"): Promise<void> {
        const { endpointRevision } = await seedClaimableTarget();
        await db.pluginWebhookDelivery.create({
            data: deliveryCreateData({ id, endpointRevision }),
        });
    }

    /**
     * Mirrors the §7.4 ingress commit order: the delivery row and the durable
     * content-free AccountChange wake commit in one transaction. Reuses the
     * scaffold an earlier `seedClaimableTarget()` call created.
     */
    async function commitDueDeliveryWithWake(id = "delivery-longpoll"): Promise<void> {
        await inTx(async (tx) => {
            const endpoint = await tx.pluginWebhookEndpoint.findUniqueOrThrow({
                where: { id: "wh_ep_AAECAwQFBgcICQoLDA0ODw" },
                select: { revision: true },
            });
            await tx.pluginWebhookDelivery.create({
                data: deliveryCreateData({ id, endpointRevision: endpoint.revision }),
            });
            await markPluginWebhookAccountChangedInTxV1(tx, {
                accountId: "account-claim",
                pluginId: TARGET.materialization.pluginId,
            });
        });
    }

    it("returns an already-due delivery from the first immediate attempt without parking", async () => {
        await seedDueDelivery();
        const startedAtMs = Date.now();
        const result = await claimPluginWebhookDeliveryWithBoundedWaitV1({
            accountId: "account-claim",
            machine: MACHINE_CLAIM,
            now: NOW,
        });
        const elapsedMs = Date.now() - startedAtMs;

        expect(result).toMatchObject({ kind: "delivery", deliveryId: "delivery-longpoll", attempt: 1 });
        expect(elapsedMs).toBeLessThan(5_000);
    });

    it("settles a parked claim with the canonical bounded none after exactly one fixed window", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            let settled = false;
            const parked = claimPluginWebhookDeliveryWithBoundedWaitV1({
                accountId: "account-claim",
                machine: MACHINE_CLAIM,
                now: NOW,
            }).then((result) => {
                settled = true;
                return result;
            });

            await waitForParkedClaimTimers(1);
            expect(settled).toBe(false);

            await vi.advanceTimersByTimeAsync(FIXED_PARK_MS_V1 - 1);
            expect(settled).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            expect(await parked).toEqual({ kind: "none", retryAfterMs: 5_000 });
        } finally {
            vi.useRealTimers();
        }
    });

    it("a delivery committed while parked is claimed only by the single final attempt; the wake does not release the park", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            await seedClaimableTarget();
            let settled = false;
            const parked = claimPluginWebhookDeliveryWithBoundedWaitV1({
                accountId: "account-claim",
                machine: MACHINE_CLAIM,
                now: NOW,
            }).then((result) => {
                settled = true;
                return result;
            });

            await waitForParkedClaimTimers(1);
            expect(settled).toBe(false);

            // The §7.4 ingress commit (delivery + durable AccountChange wake)
            // happens mid-park. The parked claim must not observe it: no wake
            // release, no polling database read, no claim before the deadline.
            await commitDueDeliveryWithWake();

            await vi.advanceTimersByTimeAsync(FIXED_PARK_MS_V1 - 1_000);
            expect(settled).toBe(false);
            const midPark = await db.pluginWebhookDelivery.findUnique({
                where: { id: "delivery-longpoll" },
                select: { state: true },
            });
            expect(midPark?.state).toBe("queued");

            await vi.advanceTimersByTimeAsync(1_000);
            expect(await parked).toMatchObject({
                kind: "delivery",
                deliveryId: "delivery-longpoll",
                attempt: 1,
                envelope: ENVELOPE,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("request cancellation settles the park promptly with the first answer and makes no final claim", async () => {
        await seedClaimableTarget();
        const controller = new AbortController();
        const timeoutsBefore = timeoutCount();
        const startedAtMs = Date.now();
        const parked = claimPluginWebhookDeliveryWithBoundedWaitV1({
            accountId: "account-claim",
            machine: MACHINE_CLAIM,
            now: NOW,
        }, { signal: controller.signal });
        await delay(50);
        // A due delivery committed mid-park must NOT be claimed by the aborted
        // request: cancellation returns the first answer with no final claim.
        await commitDueDeliveryWithWake();
        await delay(50);
        controller.abort(new Error("plugin_webhook_claim_client_aborted"));

        const result = await parked;
        const elapsedMs = Date.now() - startedAtMs;

        expect(result).toEqual({ kind: "none", retryAfterMs: 5_000 });
        expect(result).not.toHaveProperty("envelope");
        expect(elapsedMs).toBeLessThan(5_000);
        expect(timeoutCount()).toBeLessThanOrEqual(timeoutsBefore);
    });

    it("a fully uploaded HTTP claim cannot lease later work after its client disconnects", async () => {
        await seedClaimableTarget();
        const keyPair = tweetnacl.sign.keyPair();
        await db.machine.update({
            where: { id: TARGET.materialization.machineId },
            data: { installationPublicKey: new Uint8Array(keyPair.publicKey) },
        });
        const app = createAuthenticatedTestApp();
        const disconnected = new Promise<void>((resolve) => {
            app.addHook("onRequest", async (_request: unknown, reply: { raw: import("node:http").ServerResponse }) => {
                reply.raw.once("close", resolve);
            });
        });
        registerPluginWebhookDaemonRoutes(app, undefined, { HAPPIER_FEATURE_PLUGINS_WEBHOOKS__ENABLED: "1" });
        const origin = await app.listen({ host: "127.0.0.1", port: 0 });
        const path = "/v1/daemon/plugins/webhooks/claim";
        const body = { v: 1, policyVersion: 1, machine: MACHINE_CLAIM };
        const bodyText = JSON.stringify(body);
        vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
        const headers = {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(bodyText),
            "x-test-user-id": "account-claim",
            [PLUGIN_INSTALLATION_MANIFEST_PUBLISHER_HEADER_V1]: createSignedPluginInstallationPublisherHeader({
                keyPair,
                machineId: TARGET.materialization.machineId,
                installationId: TARGET.machineInstallationId,
                path,
                body,
            }),
        };
        const client = httpRequest(new URL(path, origin), { method: "POST", headers });
        client.on("error", () => {}); // A canceled HTTP request reports ECONNRESET.
        try {
            client.end(bodyText);
            await waitForParkedClaimTimers(1);
            client.destroy();
            await disconnected;
            // The actual response-side close must cancel the owner's parked
            // timeout before later work can arrive for this dead client.
            expect(vi.getTimerCount()).toBe(0);
            await commitDueDeliveryWithWake();
            await vi.advanceTimersByTimeAsync(FIXED_PARK_MS_V1);

            await expect(db.pluginWebhookDelivery.findUniqueOrThrow({ where: { id: "delivery-longpoll" } }))
                .resolves.toMatchObject({ state: "queued", attemptCount: 0, leaseId: null });
            const liveResponse = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
                const liveClient = httpRequest(new URL(path, origin), { method: "POST", headers }, (response) => {
                    const chunks: Buffer[] = [];
                    response.on("data", (chunk: Buffer) => chunks.push(chunk));
                    response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
                });
                liveClient.on("error", reject);
                liveClient.end(bodyText);
            });
            expect(liveResponse.status).toBe(200);
            expect(JSON.parse(liveResponse.body)).toMatchObject({ kind: "delivery", deliveryId: "delivery-longpoll", attempt: 1 });
        } finally {
            client.destroy();
            await vi.runOnlyPendingTimersAsync();
            vi.useRealTimers();
            await app.close();
        }
    });

    it("an already-aborted signal skips the park entirely", async () => {
        await seedClaimableTarget();
        const controller = new AbortController();
        controller.abort(new Error("plugin_webhook_claim_client_aborted"));
        const startedAtMs = Date.now();
        const result = await claimPluginWebhookDeliveryWithBoundedWaitV1({
            accountId: "account-claim",
            machine: MACHINE_CLAIM,
            now: NOW,
        }, { signal: controller.signal });
        const elapsedMs = Date.now() - startedAtMs;

        expect(result).toEqual({ kind: "none", retryAfterMs: 5_000 });
        expect(elapsedMs).toBeLessThan(5_000);
    });

    it("concurrent parked claims do not duplicate the delivery", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            await seedClaimableTarget();
            const parkedClaims = [
                claimPluginWebhookDeliveryWithBoundedWaitV1({
                    accountId: "account-claim",
                    machine: MACHINE_CLAIM,
                    now: NOW,
                }),
                claimPluginWebhookDeliveryWithBoundedWaitV1({
                    accountId: "account-claim",
                    machine: MACHINE_CLAIM,
                    now: NOW,
                }),
            ];
            await waitForParkedClaimTimers(2);

            await commitDueDeliveryWithWake();

            await vi.advanceTimersByTimeAsync(FIXED_PARK_MS_V1);
            const results = await Promise.all(parkedClaims);
            expect(results.filter((result) => result.kind === "delivery")).toHaveLength(1);
            const losers = results.filter((result) => result.kind === "none");
            expect(losers).toHaveLength(1);
            expect(losers[0]).not.toHaveProperty("envelope");
        } finally {
            vi.useRealTimers();
        }
    });
});
