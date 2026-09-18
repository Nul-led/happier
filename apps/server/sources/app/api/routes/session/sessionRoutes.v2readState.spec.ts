import { beforeEach, describe, expect, it } from "vitest";

import {
    applySessionReadCursorOperation,
    createSessionRouteTestBuilder,
    resetSessionRouteMocks,
} from "./sessionRoutes.testkit";

describe("sessionRoutes v2 read state", () => {
    beforeEach(() => {
        resetSessionRouteMocks();
    });

    it("rejects invalid read-state bodies", async () => {
        const route = await createSessionRouteTestBuilder("POST", "/v2/sessions/:sessionId/read-state");
        const { reply, response: res } = await route.invoke({
            params: { sessionId: "s1" },
            body: { state: "pending" },
        });

        expect(reply.code).toHaveBeenCalledWith(400);
        expect(res).toEqual({ error: "invalid-read-state" });
        expect(applySessionReadCursorOperation).not.toHaveBeenCalled();
    });

    it("rejects unknown mutation fields instead of granting them read-state meaning", async () => {
        const route = await createSessionRouteTestBuilder("POST", "/v2/sessions/:sessionId/read-state");
        const { reply, response: res } = await route.invoke({
            params: { sessionId: "s1" },
            body: { state: "read", accountId: "another-account" },
        });

        expect(reply.code).toHaveBeenCalledWith(400);
        expect(res).toEqual({ error: "invalid-read-state" });
        expect(applySessionReadCursorOperation).not.toHaveBeenCalled();
    });

    it("maps forbidden service results to a forbidden response", async () => {
        applySessionReadCursorOperation.mockResolvedValue({ ok: false, error: "forbidden" });

        const route = await createSessionRouteTestBuilder("POST", "/v2/sessions/:sessionId/read-state");
        const { reply, response: res } = await route.invoke({
            params: { sessionId: "s1" },
            body: { state: "read" },
        });

        expect(reply.code).toHaveBeenCalledWith(403);
        expect(res).toEqual({ error: "Forbidden" });
    });
});
