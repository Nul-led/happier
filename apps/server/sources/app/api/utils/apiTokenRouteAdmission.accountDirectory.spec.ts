import { describe, expect, it, vi } from "vitest";

import { registerAccountDirectoryRoutes } from "@/app/accountDirectory/accountDirectoryRoutes";
import type { Fastify } from "@/app/api/types";
import {
    isRestrictedAuthTokenDeniedForRoute,
    isRestrictedAuthTokenKind,
} from "./apiTokenRouteAdmission";

type RecordedRoute = Readonly<{
    method: string;
    path: string;
    config: Readonly<Record<string, unknown>> | undefined;
    preHandler: unknown;
}>;

describe("Account Directory central route admission", () => {
    it("keeps the Directory opt-in inventory closed to exactly the six identity routes", () => {
        const registrations: RecordedRoute[] = [];
        const record = (method: string) => (
            path: string,
            options: Readonly<{
                config?: Readonly<Record<string, unknown>>;
                preHandler?: unknown;
            }>,
        ) => {
            registrations.push({
                method,
                path,
                config: options.config,
                preHandler: options.preHandler,
            });
        };
        const fakeApp = {
            authenticate: vi.fn(),
            get: record("GET"),
            put: record("PUT"),
            delete: record("DELETE"),
            patch: record("PATCH"),
            post: record("POST"),
        } as unknown as Fastify;

        registerAccountDirectoryRoutes(fakeApp);

        const optedIn = registrations
            .filter((route) => route.config?.allowAccountDirectoryToken === true)
            .map((route) => `${route.method} ${route.path}`)
            .sort();
        expect(optedIn).toEqual([
            "DELETE /v1/account-directory/homes/:homeServerIdentityId",
            "GET /v1/account-directory/homes",
            "GET /v1/account-directory/me",
            "PATCH /v1/account-directory/homes/preferred",
            "POST /v1/account-directory/homes/:homeServerIdentityId/login-assertion",
            "PUT /v1/account-directory/homes/:homeServerIdentityId",
        ].sort());
        expect(registrations
            .filter((route) => route.config?.allowAccountDirectoryToken === true)
            .every((route) => Array.isArray(route.preHandler)
                && route.preHandler.length === 1
                && route.preHandler[0] === fakeApp.authenticate))
            .toBe(true);
    });

    it("fails closed for undefined or non-Directory provenance at the one admission owner", () => {
        expect(isRestrictedAuthTokenKind("account_directory")).toBe(true);
        expect(isRestrictedAuthTokenKind("api_token")).toBe(true);
        expect(isRestrictedAuthTokenKind("account")).toBe(false);
        expect(isRestrictedAuthTokenKind("terminal")).toBe(false);
        expect(isRestrictedAuthTokenKind("future_kind")).toBe(true);
        expect(isRestrictedAuthTokenKind(undefined)).toBe(true);
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "account_directory",
            routeOptions: { config: {} },
        })).toBe(true);
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "account_directory",
            routeOptions: { config: { allowAccountDirectoryToken: true } },
        })).toBe(false);
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "terminal",
            routeOptions: { config: { allowAccountDirectoryToken: true } },
        })).toBe(true);
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: undefined,
            routeOptions: { config: { allowAccountDirectoryToken: true } },
        })).toBe(true);
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: "future_kind",
            routeOptions: { config: {} },
        })).toBe(true);
        expect(isRestrictedAuthTokenDeniedForRoute({
            authTokenKind: undefined,
            routeOptions: { config: {} },
        })).toBe(true);
    });
});
