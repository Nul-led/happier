import type { FeaturesResponse } from "@/app/features/types";
import { readServerEnabledBit, type FeatureId } from "@happier-dev/protocol";

import { resolveServerFeaturePayload } from "./resolveServerFeaturePayload";
import { serverFeatureRegistry } from "./serverFeatureRegistry";

export function resolveServerFeaturesForGating(env: NodeJS.ProcessEnv): FeaturesResponse {
    return resolveServerFeaturePayload(env, serverFeatureRegistry);
}

export function isServerFeatureEnabledForRequest(featureId: FeatureId, env: NodeJS.ProcessEnv): boolean {
    const payload = resolveServerFeaturesForGating(env);
    return readServerEnabledBit(payload, featureId) === true;
}

export function isResolvedServerFeatureEnabledForGating(payload: FeaturesResponse, featureId: FeatureId): boolean {
    return readServerEnabledBit(payload, featureId) === true;
}

export function isPeerMediationGrantSigningAdvertisedForRequest(env: NodeJS.ProcessEnv): boolean {
    const payload = resolveServerFeaturesForGating(env);
    return payload.capabilities.machines.peerMediation.grantSigningKeys.length > 0;
}

type RouteHandler = (request: any, reply: any) => unknown | Promise<unknown>;
type RoutePreHandler = (request: any, reply: any) => unknown | Promise<unknown>;

/**
 * The refusal a gated family sends when its feature is off.
 *
 * Most families send the generic `{ error }` envelope; a family whose route
 * declares a strict typed result union may instead answer one member of that
 * union (for example the public Team invitation preview's
 * `{ outcome: "feature_unavailable" }`). The enabled/disabled decision stays
 * here either way; only the presentation moves.
 */
export type ServerFeatureUnavailableBody = Readonly<Record<string, unknown>>;

export const DEFAULT_SERVER_FEATURE_UNAVAILABLE_BODY: ServerFeatureUnavailableBody = { error: "not_found" };

export function createServerFeatureGatePreHandler(
    featureId: FeatureId,
    env: NodeJS.ProcessEnv = process.env,
    unavailableBody: ServerFeatureUnavailableBody = DEFAULT_SERVER_FEATURE_UNAVAILABLE_BODY,
    // Typed public answers keep the default gate status only when the family has
    // no richer vocabulary; a route whose result union can express the disabled
    // feature truthfully declares its own status beside its own body.
    unavailableStatus: number = 404,
): RoutePreHandler {
    return async (_request, reply) => {
        if (!isServerFeatureEnabledForRequest(featureId, env)) {
            return reply.code(unavailableStatus).send(unavailableBody);
        }
        return undefined;
    };
}

type RouteMethod = {
    (path: string, handler: RouteHandler): void;
    (path: string, opts: any, handler: RouteHandler): void;
};

type RouteApp = {
    get: RouteMethod;
    post: RouteMethod;
    patch: RouteMethod;
    delete: RouteMethod;
    put: RouteMethod;
    head: RouteMethod;
    options: RouteMethod;
};

function resolvePreHandlers(existing: unknown): RoutePreHandler[] {
    if (typeof existing === "function") return [existing as RoutePreHandler];
    if (Array.isArray(existing)) {
        return existing.filter((h): h is RoutePreHandler => typeof h === "function");
    }
    return [];
}

function withLeadingPreHandler(
    opts: any,
    preHandler: RoutePreHandler,
    routeConfig: Readonly<Record<string, unknown>>,
): any {
    const base = opts && typeof opts === "object" ? opts : {};
    const existing = resolvePreHandlers(base.preHandler);
    const next = { ...base };
    next.preHandler = [preHandler, ...existing];
    next.config = { ...(base.config ?? {}), ...routeConfig };
    return next;
}

function resolveOptsAndHandler(
    path: string,
    optsOrHandler: unknown,
    maybeHandler: unknown,
): Readonly<{ path: string; opts: any; handler: RouteHandler }> {
    if (typeof optsOrHandler === "function") {
        return { path, opts: {}, handler: optsOrHandler as RouteHandler };
    }
    if (typeof maybeHandler === "function") {
        return { path, opts: optsOrHandler ?? {}, handler: maybeHandler as RouteHandler };
    }
    throw new Error(`Invalid route registration for "${path}": missing handler function`);
}

export function createServerFeatureGatedRouteApp<TApp extends RouteApp>(
    app: TApp,
    featureId: FeatureId,
    env: NodeJS.ProcessEnv = process.env,
    unavailableBody: ServerFeatureUnavailableBody = DEFAULT_SERVER_FEATURE_UNAVAILABLE_BODY,
    unavailableStatus: number = 404,
    routeConfig: Readonly<Record<string, unknown>> = {},
): TApp {
    const gate = createServerFeatureGatePreHandler(featureId, env, unavailableBody, unavailableStatus);
    const gated = Object.create(app) as TApp;

    gated.get = (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        const { opts, handler } = resolveOptsAndHandler(path, optsOrHandler, maybeHandler);
        return app.get(path, withLeadingPreHandler(opts, gate, routeConfig), handler);
    };
    gated.post = (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        const { opts, handler } = resolveOptsAndHandler(path, optsOrHandler, maybeHandler);
        return app.post(path, withLeadingPreHandler(opts, gate, routeConfig), handler);
    };
    gated.patch = (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        const { opts, handler } = resolveOptsAndHandler(path, optsOrHandler, maybeHandler);
        return app.patch(path, withLeadingPreHandler(opts, gate, routeConfig), handler);
    };
    gated.delete = (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        const { opts, handler } = resolveOptsAndHandler(path, optsOrHandler, maybeHandler);
        return app.delete(path, withLeadingPreHandler(opts, gate, routeConfig), handler);
    };
    gated.put = (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        const { opts, handler } = resolveOptsAndHandler(path, optsOrHandler, maybeHandler);
        return app.put(path, withLeadingPreHandler(opts, gate, routeConfig), handler);
    };
    gated.head = (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        const { opts, handler } = resolveOptsAndHandler(path, optsOrHandler, maybeHandler);
        return app.head(path, withLeadingPreHandler(opts, gate, routeConfig), handler);
    };
    gated.options = (path: string, optsOrHandler: unknown, maybeHandler?: unknown) => {
        const { opts, handler } = resolveOptsAndHandler(path, optsOrHandler, maybeHandler);
        return app.options(path, withLeadingPreHandler(opts, gate, routeConfig), handler);
    };

    return gated;
}
