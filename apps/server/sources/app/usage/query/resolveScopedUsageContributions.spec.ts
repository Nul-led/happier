import { describe, expect, it } from "vitest";

import { createEmptyUsageCost, createEmptyUsageTokens } from "../usageMetrics";
import { resolveScopedUsageContributions, type ScopedUsageEventRow } from "./resolveScopedUsageContributions";
import { resolveEffectiveUsageCostUsd } from "./resolveUsageCostMode";

function row(id: string, time: number, scope: string, total: number): ScopedUsageEventRow {
    return {
        id, sessionId: "session", agentId: "claude", source: "native",
        observedAt: new Date(time), createdAt: new Date(time), scope,
        isCumulative: scope !== "turn_delta", backendMode: null, modelId: null,
        projectKey: null, workspaceId: null, machineId: null, turnId: null,
        contextUsedTokens: null, contextWindowTokens: null,
        tokens: { ...createEmptyUsageTokens(), input: total, total },
        cost: { ...createEmptyUsageCost(), estimatedUsd: total / 100, costSource: "pricing_estimate" },
    };
}

describe("resolveScopedUsageContributions", () => {
    it("counts deltas from a later interrupted turn after the latest final", () => {
        const result = resolveScopedUsageContributions([
            row("covered-delta", 1, "turn_delta", 5),
            row("old-final", 2, "session_final", 10),
            row("covered-later-delta", 3, "turn_delta", 8),
            row("latest-final", 4, "session_final", 20),
            row("interrupted-delta", 5, "turn_delta", 7),
            // A historical row delivered after the final still belongs before its coverage boundary.
            { ...row("late-replay", 3, "turn_delta", 8), createdAt: new Date(6) },
        ]);

        expect(result.totalContributions.reduce((sum, event) => sum + event.tokens.total, 0)).toBe(27);
        expect(result.bucketAttributions.reduce((sum, event) => sum + event.tokens.total, 0)).toBe(27);
        expect(result.totalContributions.reduce((sum, event) => sum + event.cost.estimatedUsd, 0)).toBeCloseTo(0.27);
        expect(result.bucketAttributions.reduce((sum, event) => sum + resolveEffectiveUsageCostUsd(event.cost, "auto"), 0)).toBeCloseTo(0.27);
        expect(result.totalContributions.flatMap((event) => event.contributingEventIds)).toEqual([
            "latest-final", "interrupted-delta",
        ]);
    });

    it("reports only the snapshot counted in totals and excludes superseded deltas", () => {
        const result = resolveScopedUsageContributions([
            row("delta", 1, "turn_delta", 5),
            row("older", 2, "session_cumulative", 10),
            row("latest", 3, "session_cumulative", 20),
        ]);

        expect(result.totalContributions.flatMap((event) => event.contributingEventIds)).toEqual(["latest"]);
        expect(result.bucketAttributions.flatMap((event) => event.contributingEventIds)).toEqual(["older", "latest"]);
    });
});
