import { describe, expect, it } from "vitest";

import { isPublicSessionShareActive } from "./publicSessionSharePublication";

describe("isPublicSessionShareActive", () => {
    it("treats the exact expiration instant as expired", () => {
        const expiresAt = new Date("2026-09-09T12:00:00.000Z");

        expect(isPublicSessionShareActive({ expiresAt }, expiresAt)).toBe(false);
    });

    it("keeps a future or non-expiring publication active", () => {
        const now = new Date("2026-09-09T12:00:00.000Z");

        expect(isPublicSessionShareActive({ expiresAt: new Date(now.getTime() + 1) }, now)).toBe(true);
        expect(isPublicSessionShareActive({ expiresAt: null }, now)).toBe(true);
        expect(isPublicSessionShareActive(null, now)).toBe(false);
    });
});
