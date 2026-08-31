import { beforeEach, describe, expect, it } from "vitest";

import { authEnrollmentOutcomeCounter, recordAuthEnrollmentOutcome } from "./authMetrics";

describe("auth enrollment metrics", () => {
    beforeEach(() => {
        authEnrollmentOutcomeCounter.reset();
    });

    it("records only fixed-cardinality flow and outcome labels", async () => {
        for (const outcome of [
            "success",
            "expired",
            "rejected",
            "wrong_target",
            "wrong_binding",
            "wrong_proof",
            "malformed_payload",
        ] as const) {
            recordAuthEnrollmentOutcome({ flow: "account_qr", outcome });
        }

        const metric = await authEnrollmentOutcomeCounter.get();
        expect(metric.values).toHaveLength(7);
        for (const value of metric.values) {
            expect(Object.keys(value.labels).sort()).toEqual(["flow", "outcome"]);
        }
    });
});
