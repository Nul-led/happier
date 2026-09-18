import { describe, expect, it } from "vitest";

import { isSessionPublicLinkExternalSharingIncrease } from "./sessionAccessExternalSharingPolicy";

const now = new Date("2026-09-09T12:00:00.000Z");

describe("isSessionPublicLinkExternalSharingIncrease", () => {
    it("classifies a fresh publication and active token rotation as increases", () => {
        expect(isSessionPublicLinkExternalSharingIncrease({
            previous: null,
            next: { expiresAt: null, maxUses: null, rotatesToken: true },
            now,
        })).toBe(true);
        expect(isSessionPublicLinkExternalSharingIncrease({
            previous: { expiresAt: null, maxUses: 1, useCount: 1 },
            next: { expiresAt: null, maxUses: 1, rotatesToken: true },
            now,
        })).toBe(true);
    });

    it("classifies expiry and remaining-admission expansion as increases", () => {
        expect(isSessionPublicLinkExternalSharingIncrease({
            previous: { expiresAt: new Date("2026-09-10T12:00:00.000Z"), maxUses: null, useCount: 0 },
            next: { expiresAt: null, maxUses: null, rotatesToken: false },
            now,
        })).toBe(true);
        expect(isSessionPublicLinkExternalSharingIncrease({
            previous: { expiresAt: null, maxUses: 5, useCount: 4 },
            next: { expiresAt: null, maxUses: 10, rotatesToken: false },
            now,
        })).toBe(true);
    });

    it("permits publication reductions and inactive updates", () => {
        expect(isSessionPublicLinkExternalSharingIncrease({
            previous: { expiresAt: new Date("2026-09-11T12:00:00.000Z"), maxUses: 10, useCount: 2 },
            next: {
                expiresAt: new Date("2026-09-10T12:00:00.000Z"),
                maxUses: 5,
                rotatesToken: false,
            },
            now,
        })).toBe(false);
        expect(isSessionPublicLinkExternalSharingIncrease({
            previous: { expiresAt: new Date("2026-09-08T12:00:00.000Z"), maxUses: null, useCount: 0 },
            next: {
                expiresAt: new Date("2026-09-08T13:00:00.000Z"),
                maxUses: null,
                rotatesToken: true,
            },
            now,
        })).toBe(false);
    });
});
