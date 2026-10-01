import { afterEach, describe, expect, it, vi } from "vitest";
import { API_TOKEN_FULL_GRANT_V1 } from "@happier-dev/protocol/auth/apiTokenGrant";

import { isApiTokenRequestOriginAllowed } from "./isApiTokenRequestOriginAllowed";

describe("isApiTokenRequestOriginAllowed", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("combines exact grant origins with the configured Happier origin", () => {
        vi.stubEnv("HAPPIER_WEBAPP_URL", "https://happier.test/app");
        const grant = { ...API_TOKEN_FULL_GRANT_V1, origins: ["https://dashboard.test"] };
        expect(isApiTokenRequestOriginAllowed(grant, "https://dashboard.test")).toBe(true);
        expect(isApiTokenRequestOriginAllowed(API_TOKEN_FULL_GRANT_V1, "https://happier.test")).toBe(true);
        expect(isApiTokenRequestOriginAllowed(grant, "https://denied.test")).toBe(false);
    });

    it.each([
        "null",
        "https://happier.test/app",
        "https://happier.test/",
        "https://user@happier.test",
        "https://happier.test.attacker.test",
        "https://dashboard.test/path",
    ])("does not reinterpret malformed or neighboring origins: %s", (origin) => {
        vi.stubEnv("HAPPIER_WEBAPP_URL", "https://happier.test/app");
        const grant = { ...API_TOKEN_FULL_GRANT_V1, origins: ["https://dashboard.test"] };
        expect(isApiTokenRequestOriginAllowed(grant, origin)).toBe(false);
    });
});
