import { describe, expect, it, vi } from "vitest";
import type { Fastify } from "@/app/api/types";
import { PresentUserRequiredResponseSchema } from "@/app/api/utils/requirePresentUser";
import { registerAccountDirectoryLinkRoutes } from "./accountDirectoryRoutes";

type RecordedRoute = Readonly<{
    method: string;
    path: string;
    responseSchema: Readonly<Record<string, unknown>> | undefined;
}>;

/**
 * Route registration introspection (same pattern as the admission inventory
 * spec): the canonical auth owner `requirePresentUser` emits
 * `{ error: "present_user_required" }` on 403, so the Home link routes must
 * declare that owner's response schema instead of the protocol error enum.
 */
function captureRegistrations(register: (app: Fastify) => void): RecordedRoute[] {
    const registrations: Array<{ method: string; path: string; opts: { schema?: { response?: Record<string, unknown> } } }> = [];
    const fakeApp = {
        authenticate: vi.fn(),
        put(path: string, opts: { schema?: { response?: Record<string, unknown> } }) {
            registrations.push({ method: "PUT", path, opts });
        },
        delete(path: string, opts: { schema?: { response?: Record<string, unknown> } }) {
            registrations.push({ method: "DELETE", path, opts });
        },
    } as unknown as Fastify;
    register(fakeApp);
    return registrations.map(({ method, path, opts }) => ({
        method,
        path,
        responseSchema: opts.schema?.response,
    }));
}

describe("Account Directory route response contracts", () => {
    it("declares the canonical present-user 403 response schema on the Home link routes", () => {
        const linkRoutes = captureRegistrations(registerAccountDirectoryLinkRoutes)
            .filter((route) => route.path.includes("/v1/account/directory-links/"));

        expect(linkRoutes.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
            "DELETE /v1/account/directory-links/:issuerServerIdentityId",
            "PUT /v1/account/directory-links/:issuerServerIdentityId",
        ]);
        for (const route of linkRoutes) {
            expect(route.responseSchema?.[403]).toBe(PresentUserRequiredResponseSchema);
        }
    });
});
