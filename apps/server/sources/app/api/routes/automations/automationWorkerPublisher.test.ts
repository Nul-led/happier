import { describe, expect, it, vi } from "vitest";

import { PluginInstallationPublisherProofError } from "@/app/plugins/installations/publisherProof";
import { resolveExactAutomationWorkerPublisher } from "./automationWorkerPublisher";

const RELEASED_V2_WORKER_HEADERS = {
    authorization: "Bearer released-cli-token",
    "content-type": "application/json",
} as const;

describe("automationWorkerPublisher", () => {
    it("returns the exact signed V3 claim identity from the verified publisher", async () => {
        const proofExpiresAt = new Date("2026-08-28T12:05:00.000Z");
        const verifyPublisher = vi.fn(async () => ({
            machineId: "machine-1",
            installationId: "installation-1",
            requestNonce: "claim-nonce-1",
            proofExpiresAt,
        }));

        await expect(resolveExactAutomationWorkerPublisher({
            dependencies: { verifyPublisher },
            accountId: "account-1",
            request: {
                method: "POST",
                body: { machineId: "machine-1" },
            },
            path: "/v3/automations/runs/claim",
            machineId: "machine-1",
        })).resolves.toEqual({
            kind: "publisherProof",
            machineId: "machine-1",
            machineInstallationId: "installation-1",
            requestNonce: "claim-nonce-1",
            proofExpiresAt,
        });
    });

    it("refuses the headerless predecessor worker vector", async () => {
        const verifyPublisher = vi.fn(async () => {
            throw new PluginInstallationPublisherProofError(
                "required",
                "Plugin installation publisher proof is required",
            );
        });

        await expect(resolveExactAutomationWorkerPublisher({
            dependencies: { verifyPublisher },
            accountId: "account-1",
            request: {
                method: "POST",
                headers: RELEASED_V2_WORKER_HEADERS,
                body: { machineId: "machine-1" },
            },
            path: "/v2/automations/runs/claim",
            machineId: "machine-1",
        })).resolves.toBeNull();

        await expect(resolveExactAutomationWorkerPublisher({
            dependencies: { verifyPublisher },
            accountId: "account-1",
            request: {
                method: "POST",
                headers: RELEASED_V2_WORKER_HEADERS,
                body: { machineId: "machine-1" },
            },
            path: "/v3/automations/runs/claim",
            machineId: "machine-1",
        })).resolves.toBeNull();
    });

    it("does not turn a malformed released-V2 publisher proof into bearer-only admission", async () => {
        const verifyPublisher = vi.fn(async () => {
            throw new PluginInstallationPublisherProofError(
                "invalid",
                "Invalid plugin installation publisher proof",
            );
        });

        await expect(resolveExactAutomationWorkerPublisher({
            dependencies: { verifyPublisher },
            accountId: "account-1",
            request: {
                method: "POST",
                headers: {
                    ...RELEASED_V2_WORKER_HEADERS,
                    "x-happier-plugin-installation-publisher-v1": "malformed",
                },
                body: { machineId: "machine-1" },
            },
            path: "/v2/automations/runs/claim",
            machineId: "machine-1",
        })).resolves.toBeNull();
    });
});
