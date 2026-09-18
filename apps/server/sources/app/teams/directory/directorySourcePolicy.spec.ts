import { describe, expect, it } from "vitest";

import { isDirectorySourceProjectionComplete } from "./directorySourcePolicy";

describe("directory source completed evidence", () => {
    it("accepts only an active source with no observation attempt in flight", () => {
        expect(isDirectorySourceProjectionComplete({ state: "active", activeReconcileRunId: null })).toBe(true);
        expect(isDirectorySourceProjectionComplete({ state: "active", activeReconcileRunId: "attempt-1" })).toBe(false);
        expect(isDirectorySourceProjectionComplete({ state: "initializing", activeReconcileRunId: null })).toBe(false);
        expect(isDirectorySourceProjectionComplete({ state: "needs_attention", activeReconcileRunId: null })).toBe(false);
        expect(isDirectorySourceProjectionComplete({ state: "paused", activeReconcileRunId: null })).toBe(false);
    });
});
