import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    acquireFence: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    resolveTarget: vi.fn(),
    markAccountChanged: vi.fn(async () => 123),
}));

vi.mock("@/storage/inTx", () => ({
    inTx: async (fn: (tx: unknown) => Promise<unknown>) => await fn({
        pluginWebhookDelivery: {
            findFirst: mocks.findFirst,
            updateMany: mocks.updateMany,
        },
    }),
}));
vi.mock("@/storage/prisma", () => ({
    getActivePrismaRuntime: () => ({ DbNull: null }),
}));
vi.mock("@/storage/db", () => ({ db: { pluginWebhookDelivery: {} } }));
vi.mock("@/app/encryption/accountEncryptionTransition", () => ({
    acquireAccountEncryptionTransitionFenceInTx: mocks.acquireFence,
}));
vi.mock("@/app/plugins/availability/operations", () => ({
    resolveCurrentClaimablePluginMachineMaterializationTx: mocks.resolveTarget,
}));
vi.mock("@/app/serverIdentity/serverIdentity", () => ({
    getOrCreateServerIdentityId: vi.fn(async () => "server-identity-1"),
}));
vi.mock("./accountChange", () => ({
    markPluginWebhookAccountChangedInTxV1: mocks.markAccountChanged,
}));

import {
    completePluginWebhookDeliveryV1,
    failPluginWebhookDeliveryV1,
    renewPluginWebhookDeliveryV1,
} from "./claimStore";

const TARGET = {
    materialization: {
        machineId: "machine-1",
        materializationId: "materialization-1",
        pluginId: "acme.github",
    },
    machineInstallationId: "installation-1",
} as const;
const LEASE = { leaseId: "wh_lease_AAECAwQFBgcICQoLDA0ODw", revision: 3 } as const;
const NOW = new Date("2026-08-10T00:00:00.000Z");

describe("plugin webhook settlement target currentness", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.acquireFence.mockResolvedValue({
            status: "ready",
            account: { version: 1, currentness: { encryptionMode: "plain" } },
        });
        mocks.updateMany.mockResolvedValue({ count: 1 });
        mocks.resolveTarget.mockResolvedValue({ kind: "notCurrent" });
    });

    it("loses renew authority after the frozen target is no longer current", async () => {
        mocks.findFirst.mockResolvedValue({
            firstClaimAt: new Date(NOW.getTime() - 1_000),
            executionStartedAt: new Date(NOW.getTime() - 500),
            leaseExpiresAt: new Date(NOW.getTime() + 60_000),
            endpointId: "endpoint-1",
            endpointRevision: 1,
            endpointWebhookContributionId: "github-events",
            endpointHandlerActionId: "handle-webhook",
            endpointSourceInstanceId: "source-1",
            targetPluginId: TARGET.materialization.pluginId,
            targetPluginVersion: "1.0.0",
            endpoint: {
                id: "endpoint-1",
                routingKind: "accountEndpoint",
                enabled: true,
                revokedAt: null,
                releasedAt: null,
                route: { enabled: true, revokedAt: null, verifierKind: "github_hmac_sha256_v1" },
            },
        });

        await expect(renewPluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            transition: "renew",
            now: NOW,
        })).resolves.toEqual({ kind: "leaseLost" });

        expect(mocks.resolveTarget).toHaveBeenCalledTimes(1);
        expect(mocks.updateMany).not.toHaveBeenCalled();
    });

    it("settles an already-started attempt under its exact unexpired lease after currentness is lost", async () => {
        // The handler has run: `executionStartedAt` is set and the daemon holds
        // the exact lease. Re-deriving plugin/endpoint currentness here would
        // throw the known result away and force a duplicate execution once the
        // lease expires.
        mocks.findFirst.mockResolvedValue({ attemptCount: 1 });

        await expect(completePluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            disposition: "accepted",
            now: NOW,
        })).resolves.toEqual({ kind: "settled", state: "succeeded" });
        await expect(failPluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            result: { kind: "retry", code: "provider_busy" },
            retryDelayMs: 5_000,
            now: NOW,
        })).resolves.toEqual({ kind: "settled", state: "queued" });

        expect(mocks.resolveTarget).not.toHaveBeenCalled();
        expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    });

    it("permits content-unavailable dead-letter settlement after start or under the exact pre-execution exception", async () => {
        mocks.findFirst.mockResolvedValue({ attemptCount: 0 });

        await expect(failPluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            result: { kind: "deadLetter", code: "content_unavailable" },
            now: NOW,
        })).resolves.toEqual({ kind: "settled", state: "dead_letter" });

        expect(mocks.findFirst).toHaveBeenCalledWith({
            where: expect.objectContaining({
                OR: [
                    { executionStartedAt: { not: null } },
                    { executionStartedAt: null, attemptCount: 0 },
                ],
                leaseExpiresAt: { gt: NOW },
            }),
            select: { attemptCount: true },
        });
        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: [
                    { executionStartedAt: { not: null } },
                    { executionStartedAt: null, attemptCount: 0 },
                ],
                leaseExpiresAt: { gt: NOW },
            }),
        }));
    });

    it("settles an already-started attempt while an Account encryption transition fence is unavailable", async () => {
        mocks.acquireFence.mockResolvedValue({ status: "unavailable" });
        mocks.findFirst.mockResolvedValue({ attemptCount: 1 });

        await expect(completePluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            disposition: "accepted",
            now: NOW,
        })).resolves.toEqual({ kind: "settled", state: "succeeded" });
        await expect(failPluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            result: { kind: "retry", code: "provider_busy" },
            retryDelayMs: 5_000,
            now: NOW,
        })).resolves.toEqual({ kind: "settled", state: "queued" });

        expect(mocks.acquireFence).not.toHaveBeenCalled();
        expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    });

    it("settles an already-started attempt after its endpoint was revoked", async () => {
        mocks.findFirst.mockResolvedValue({ attemptCount: 1 });

        await expect(completePluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            disposition: "accepted",
            now: NOW,
        })).resolves.toEqual({ kind: "settled", state: "succeeded" });

        // A revoked or disabled endpoint stops new ingress and new claims. It
        // cannot strand an attempt that already produced its result.
        for (const call of mocks.updateMany.mock.calls) {
            expect(call[0].where).not.toHaveProperty("endpoint");
        }
        for (const call of mocks.findFirst.mock.calls) {
            expect(call[0].where).not.toHaveProperty("endpoint");
        }
    });

    it("settles only for the exact claimant machine installation, lease, revision and unexpired lease", async () => {
        mocks.findFirst.mockResolvedValue({ attemptCount: 1 });

        await completePluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            disposition: "accepted",
            now: NOW,
        });

        expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: "delivery-1",
                accountId: "account-1",
                state: "claimed",
                leaseId: LEASE.leaseId,
                revision: LEASE.revision,
                executionStartedAt: { not: null },
                leaseExpiresAt: { gt: NOW },
                targetMachineId: TARGET.materialization.machineId,
                targetMachineInstallationId: TARGET.machineInstallationId,
                targetMaterializationId: TARGET.materialization.materializationId,
                targetPluginId: TARGET.materialization.pluginId,
                claimedByMachineId: TARGET.materialization.machineId,
                claimedByMachineInstallationId: TARGET.machineInstallationId,
            }),
        }));
    });

    it("reports leaseLost when the exact custody row no longer matches", async () => {
        mocks.findFirst.mockResolvedValue(null);
        mocks.updateMany.mockResolvedValue({ count: 0 });

        await expect(completePluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            disposition: "accepted",
            now: NOW,
        })).resolves.toEqual({ kind: "leaseLost" });
        await expect(failPluginWebhookDeliveryV1({
            accountId: "account-1",
            deliveryId: "delivery-1",
            target: TARGET,
            lease: LEASE,
            result: { kind: "retry", code: "provider_busy" },
            retryDelayMs: 5_000,
            now: NOW,
        })).resolves.toEqual({ kind: "leaseLost" });
        expect(mocks.markAccountChanged).not.toHaveBeenCalled();
    });
});
