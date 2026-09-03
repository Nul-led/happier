import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

type DirectBearerConsumerDisposition = Readonly<{
    path: string;
    verifies: readonly ("auth.verifyToken" | "auth.verifyLegacyHomeToken" | "auth.verifyTokenForRoute")[];
    disposition: string;
}>;

const SERVER_SOURCE_ROOT = resolve(
    fileURLToPath(new URL("../../../", import.meta.url)),
);

const DIRECT_BEARER_CONSUMER_DISPOSITIONS = [
    {
        path: "app/api/socket.ts",
        verifies: ["auth.verifyTokenForRoute", "auth.verifyTokenForRoute"],
        disposition: "Socket.IO authenticates route-compatible bearers and explicitly disconnects restricted Directory/PAT provenance before session access.",
    },
    {
        path: "app/api/utils/enableAuthentication.ts",
        verifies: ["auth.verifyToken", "auth.verifyLegacyHomeToken"],
        disposition: "Canonical Fastify route admission; Directory tokens require allowAccountDirectoryToken and PATs require allowApiToken.",
    },
    {
        path: "app/api/utils/apiRateLimitPolicy.ts",
        verifies: ["auth.verifyTokenForRoute"],
        disposition: "Rate-limit key projection only; restricted Directory/PAT or invalid bearers fall back to the IP bucket and do not authorize a route.",
    },
    {
        path: "app/api/routes/local/services/public/registerRoutes.ts",
        verifies: ["auth.verifyTokenForRoute"],
        disposition: "Public-preview optional owner projection; restricted Directory/PAT bearers are treated as anonymous and grant no preview authority.",
    },
    {
        path: "app/api/routes/share/registerPublicShareReadRoutes.ts",
        verifies: ["auth.verifyTokenForRoute"],
        disposition: "Public-share optional owner projection; restricted Directory/PAT bearers are treated as anonymous and grant no share authority.",
    },
    {
        path: "app/local/services/public/websocket.ts",
        verifies: ["auth.verifyTokenForRoute"],
        disposition: "Public-preview websocket optional owner projection; restricted Directory/PAT bearers are treated as anonymous and grant no websocket authority.",
    },
] as const satisfies readonly DirectBearerConsumerDisposition[];

function listProductionTypeScriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) return listProductionTypeScriptFiles(absolutePath);
        if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
        if (/\.(?:spec|test)\.ts$/.test(entry.name)) return [];
        return [absolutePath];
    });
}

function directVerifierCalls(source: string): ("auth.verifyToken" | "auth.verifyLegacyHomeToken" | "auth.verifyTokenForRoute")[] {
    return [...source.matchAll(/auth\.(verifyTokenForRoute|verifyLegacyHomeToken|verifyToken)\s*\(/g)]
        .map((match) => match[1] === "verifyTokenForRoute"
            ? "auth.verifyTokenForRoute"
            : match[1] === "verifyLegacyHomeToken"
                ? "auth.verifyLegacyHomeToken"
            : "auth.verifyToken");
}

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

    it("keeps a test-only exhaustive inventory of direct production bearer verification consumers", () => {
        const expectedByPath = new Map(
            DIRECT_BEARER_CONSUMER_DISPOSITIONS.map((entry) => [entry.path, entry]),
        );
        const actual = listProductionTypeScriptFiles(SERVER_SOURCE_ROOT)
            .map((absolutePath) => ({
                path: relative(SERVER_SOURCE_ROOT, absolutePath).replace(/\\/g, "/"),
                verifies: directVerifierCalls(readFileSync(absolutePath, "utf8")),
            }))
            .filter((entry) => entry.verifies.length > 0)
            .sort((left, right) => left.path.localeCompare(right.path));

        expect(actual).toEqual([...expectedByPath.values()]
            .map(({ path, verifies }) => ({ path, verifies: [...verifies] }))
            .sort((left, right) => left.path.localeCompare(right.path)));
        for (const entry of DIRECT_BEARER_CONSUMER_DISPOSITIONS) {
            expect(entry.disposition.trim().length).toBeGreaterThan(40);
            expect(entry.disposition).toMatch(/Directory|restricted|Canonical/);
        }
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
