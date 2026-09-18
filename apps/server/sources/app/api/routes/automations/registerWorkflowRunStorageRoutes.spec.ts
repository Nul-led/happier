import { describe, expect, it, vi } from "vitest";

import { createRouteTestBuilder } from "../../testkit/routeTestBuilder";
import { registerWorkflowRunStorageRoutes } from "./registerWorkflowRunStorageRoutes";

describe("registerWorkflowRunStorageRoutes", () => {
    it("rejects a workflow persistence request without an exact machine publisher proof", async () => {
        const verifyPublisher = vi.fn(async () => null);
        const route = createRouteTestBuilder({
            method: "POST",
            path: "/v3/automations/runs/workflow-storage",
            defaultRequest: { userId: "account-1" },
            registerRoutes(app) {
                registerWorkflowRunStorageRoutes(app as never, { verifyPublisher });
            },
        });

        const { reply } = await route.invoke({
            body: { operation: "get", publisherMachineId: "machine-1", runId: "run-1" },
        });

        expect(verifyPublisher).toHaveBeenCalledWith(expect.objectContaining({
            accountId: "account-1",
            path: "/v3/automations/runs/workflow-storage",
            required: true,
        }));
        expect(reply.statusCode).toBe(401);
    });
});
