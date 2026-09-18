import { describe, expect, it } from "vitest";

import { toScopedUsageEventRow } from "./scopedUsageEventRow";

function row(overrides: Partial<Parameters<typeof toScopedUsageEventRow>[0]> = {}) {
    return {
        id: "event-1",
        sessionId: "session-1",
        observedAt: new Date("2026-09-07T12:00:00.000Z"),
        createdAt: new Date("2026-09-07T12:00:01.000Z"),
        agentId: "claude",
        backendMode: "remote",
        modelId: "claude-sonnet",
        projectKey: null,
        workspaceId: null,
        machineId: "worker-1",
        source: "claude_sdk",
        scope: "turn_delta",
        isCumulative: false,
        turnId: "turn-1",
        requestCount: 0,
        teamCredentialResourceId: null,
        teamCredentialActorAccountId: null,
        teamCredentialExternalApiKeyId: null,
        teamCredentialSourceCredentialId: null,
        brokerMachineId: null,
        credentialDeliveryMode: null,
        inputTokens: 8,
        outputTokens: 4,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 12,
        reportedCostUsd: 0.11,
        estimatedCostUsd: 0,
        invoiceCostUsd: 0,
        billingContext: "api_usage",
        costSource: "provider_reported",
        currency: "USD",
        costBreakdown: JSON.stringify({ input: 0.07, output: 0.04, garbage: "drop" }),
        contextUsedTokens: 12,
        contextWindowTokens: 200_000,
        ...overrides,
    };
}

describe("toScopedUsageEventRow", () => {
    it("maps tokens, Team attribution, request count, and parsed cost breakdown through one owner", () => {
        const mapped = toScopedUsageEventRow(row({
            requestCount: 1,
            teamCredentialResourceId: "resource-1",
            teamCredentialActorAccountId: "account-1",
            brokerMachineId: "broker-1",
            credentialDeliveryMode: "brokered",
        }));

        expect(mapped.tokens).toEqual({ input: 8, output: 4, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 12 });
        expect(mapped.requestCount).toBe(1);
        expect(mapped.teamCredentialResourceId).toBe("resource-1");
        expect(mapped.teamCredentialActorAccountId).toBe("account-1");
        expect(mapped.brokerMachineId).toBe("broker-1");
        expect(mapped.cost.breakdown).toEqual({ input: 0.07, output: 0.04 });
    });

    it("degrades missing cost provenance to the honest unknown and none sentinels", () => {
        const mapped = toScopedUsageEventRow(row({ billingContext: null, costSource: null }));

        expect(mapped.cost.billingContext).toBe("unknown");
        expect(mapped.cost.costSource).toBe("none");
    });

    it("does not pass non-canonical cost provenance strings through to the wire", () => {
        const mapped = toScopedUsageEventRow(row({ billingContext: "mystery", costSource: "made_up" }));

        expect(mapped.cost.billingContext).toBe("unknown");
        expect(mapped.cost.costSource).toBe("none");
    });

    it("drops malformed cost breakdown metadata without failing the row", () => {
        expect(toScopedUsageEventRow(row({ costBreakdown: "{not json" })).cost.breakdown).toBeUndefined();
        expect(toScopedUsageEventRow(row({ costBreakdown: "[1,2]" })).cost.breakdown).toBeUndefined();
        expect(toScopedUsageEventRow(row({ costBreakdown: null })).cost.breakdown).toBeUndefined();
    });
});
