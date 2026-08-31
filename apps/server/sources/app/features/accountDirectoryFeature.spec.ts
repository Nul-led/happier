import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/accountDirectory/accountDirectorySigner", () => ({
    accountDirectorySigningKeyMetadata: () => ({
        keyId: "0".repeat(64),
        publicKeyBase64Url: "A".repeat(43),
    }),
}));

import { resolveAccountDirectoryFeature } from "./accountDirectoryFeature";

describe("Account Directory capability publication", () => {
    it("does not project Home-owned device approval policy from the Account Service", () => {
        const result = resolveAccountDirectoryFeature({});
        expect(result.capabilities?.accountDirectory).toMatchObject({
            version: 1,
            homeDirectory: true,
            homeEnrollment: true,
        });
        expect(result.capabilities?.accountDirectory).not.toHaveProperty("deviceApproval");
    });
});
