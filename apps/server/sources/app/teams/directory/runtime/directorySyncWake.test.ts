import { describe, expect, it, vi } from "vitest";

import {
    registerEnterpriseIdentitySyncNudge,
    requestEnterpriseIdentitySyncNudge,
} from "./directorySyncWake";

describe("directory sync wake", () => {
    it("delivers a manual-sync wake to the active worker", () => {
        const nudge = vi.fn();
        const unregister = registerEnterpriseIdentitySyncNudge(nudge);

        requestEnterpriseIdentitySyncNudge();

        expect(nudge).toHaveBeenCalledOnce();
        unregister();
    });

    it("does not retain a worker callback after unregister", () => {
        const nudge = vi.fn();
        const unregister = registerEnterpriseIdentitySyncNudge(nudge);
        unregister();

        requestEnterpriseIdentitySyncNudge();

        expect(nudge).not.toHaveBeenCalled();
    });
});
