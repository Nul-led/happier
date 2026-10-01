import {
    createApiRateLimitKeyGenerator,
    resolveRouteRateLimit,
    type ApiRateLimitRequest,
    type ApiRouteRateLimitConfig,
} from "./apiRateLimitPolicy";

import {
    API_HOT_ENDPOINT_RATE_LIMIT_DEFAULTS,
    resolveRateLimitEnvKeysForId,
    type ApiHotEndpointRateLimitId,
} from "./apiRateLimitDefaults";

export { API_HOT_ENDPOINT_RATE_LIMIT_DEFAULTS, type ApiHotEndpointRateLimitId };

export function resolveApiHotEndpointRateLimit(
    env: Record<string, string | undefined>,
    id: ApiHotEndpointRateLimitId,
    opts?: Readonly<{ keyGenerator?: (request: ApiRateLimitRequest) => string | number | Promise<string | number> }>,
): ApiRouteRateLimitConfig {
    const defaults = API_HOT_ENDPOINT_RATE_LIMIT_DEFAULTS[id];
    if (!defaults) return false;
    const keys = resolveRateLimitEnvKeysForId(id);

    const keyGenerator =
        opts?.keyGenerator ??
        (defaults.keyMode === "ip"
            ? createApiRateLimitKeyGenerator(env, { strategy: "ip-only" })
            : createApiRateLimitKeyGenerator(env, { scope: "route" }));

    return resolveRouteRateLimit(env, {
        maxEnvKey: keys.maxEnvKey,
        windowEnvKey: keys.windowEnvKey,
        defaultMax: defaults.defaultMax,
        defaultWindow: defaults.defaultWindow,
        keyGenerator,
    });
}
