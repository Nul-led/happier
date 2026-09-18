import { describe, expect, it } from "vitest";
import {
    ACCOUNT_API_TOKEN_ENCRYPTION_ACCESS_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_REVOKE_ALL_HTTP_PATH_V1,
    ACCOUNT_API_TOKENS_REVOKE_HTTP_PATH_V1,
} from "@happier-dev/protocol";

import { resolveApiHotEndpointRateLimit } from "@/app/api/utils/apiRateLimitCatalog";
import { createFakeRouteApp, getRouteEntry } from "../../testkit/routeHarness";
import { registerAccountApiTokenManagementRoutes } from "./registerAccountApiTokenManagementRoutes";

describe("Account API-token route rate limits", () => {
    it("registers management writes, reads, and PAT-self retrieval with their canonical profiles", () => {
        const app = createFakeRouteApp();
        registerAccountApiTokenManagementRoutes(app as never);

        const writeLimit = resolveApiHotEndpointRateLimit(process.env, "auth.apiTokens.mutate");
        if (writeLimit === false) throw new Error("API-token mutation rate limit unexpectedly disabled");
        for (const path of [
            ACCOUNT_API_TOKENS_CREATE_HTTP_PATH_V1,
            ACCOUNT_API_TOKENS_REVOKE_HTTP_PATH_V1,
            ACCOUNT_API_TOKENS_REVOKE_ALL_HTTP_PATH_V1,
        ]) {
            const routeLimit = getRouteEntry(app, "POST", path).opts.config?.rateLimit;
            expect(routeLimit).toEqual(expect.objectContaining({
                max: writeLimit.max,
                timeWindow: writeLimit.timeWindow,
                keyGenerator: expect.any(Function),
            }));
        }

        const readLimit = resolveApiHotEndpointRateLimit(process.env, "auth.apiTokens.read");
        if (readLimit === false) throw new Error("API-token read rate limit unexpectedly disabled");
        for (const path of [
            ACCOUNT_API_TOKENS_LIST_HTTP_PATH_V1,
            ACCOUNT_API_TOKEN_ENCRYPTION_ACCESS_HTTP_PATH_V1,
        ]) {
            const routeLimit = getRouteEntry(app, "POST", path).opts.config?.rateLimit;
            expect(routeLimit).toEqual(expect.objectContaining({
                max: readLimit.max,
                timeWindow: readLimit.timeWindow,
                keyGenerator: expect.any(Function),
            }));
        }
    });
});
