import { describe, expect, it } from "vitest";

import { decodeAutomationRunCause, retainedV2OriginKindForRun } from "./automationRunCauseCodec";

describe("automationRunCauseCodec", () => {
    it("keeps direct Workflow rows out of Automation cause decoding", () => {
        const direct = {
            originKind: "direct",
            triggerId: null,
            causeKind: null,
            causeTriggerKind: null,
            causeTriggerRevision: null,
            causeOccurredAt: null,
            causeEventPluginId: null,
            causeEventLocalId: null,
            causeScheduledFor: null,
            causeSessionLifecycleEvent: null,
            causeSourceSessionId: null,
            causeSourceTurnId: null,
            causeSessionLifecycleRequestId: null,
            causeSessionLifecycleRequestKind: null,
            causeSessionLifecyclePolicyKind: null,
            causeSessionLifecycleConfiguredCount: null,
            occurrenceKey: null,
            causeSourceSelectorId: null,
            createdAt: new Date(0),
        } as const;

        expect(decodeAutomationRunCause(direct)).toBeNull();
        expect(retainedV2OriginKindForRun(direct)).toBeUndefined();
    });
});
