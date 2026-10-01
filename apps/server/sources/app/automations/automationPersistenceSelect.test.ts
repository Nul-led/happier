import { describe, expect, it } from "vitest";

import {
    automationRunV3ListItemSelect,
} from "./automationPersistenceSelect";

describe("Automation persistence query shapes", () => {
    it("keeps private frozen execution and result envelopes off the V3 Run-list read", () => {
        expect(automationRunV3ListItemSelect).not.toHaveProperty("executionInputEnvelope");
        expect(automationRunV3ListItemSelect).not.toHaveProperty("resultEnvelope");
        expect(automationRunV3ListItemSelect).not.toHaveProperty("errorMessage");
        expect(automationRunV3ListItemSelect).not.toHaveProperty("scheduledAt");

    });
});
