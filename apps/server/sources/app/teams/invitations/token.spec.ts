import * as crypto from "crypto";
import { describe, expect, it } from "vitest";
import { TeamInvitationTokenV1Schema } from "@happier-dev/protocol/teams";
import {
    digestTeamInvitationToken,
    mintTeamInvitationToken,
    tryDigestTeamInvitationToken,
} from "./token";

describe("Team invitation token codec", () => {
    it("mints a bearer the protocol contract admits", () => {
        for (let attempt = 0; attempt < 32; attempt += 1) {
            expect(TeamInvitationTokenV1Schema.safeParse(mintTeamInvitationToken()).success).toBe(true);
        }
    });

    it("mints a distinct bearer per invitation", () => {
        const minted = new Set(Array.from({ length: 64 }, () => mintTeamInvitationToken()));
        expect(minted.size).toBe(64);
    });

    it("persists exactly the 32-byte SHA-256 of the UTF-8 bearer and never the bearer", () => {
        const token = mintTeamInvitationToken();
        const digest = digestTeamInvitationToken(token);
        expect(digest.byteLength).toBe(32);
        expect(digest.equals(crypto.createHash("sha256").update(token, "utf8").digest())).toBe(true);
        expect(digest.toString("utf8")).not.toContain(token);
    });

    it("is deterministic for one bearer and separates distinct bearers", () => {
        const token = mintTeamInvitationToken();
        expect(digestTeamInvitationToken(token).equals(digestTeamInvitationToken(token))).toBe(true);
        expect(digestTeamInvitationToken(token).equals(digestTeamInvitationToken(mintTeamInvitationToken()))).toBe(false);
    });

    it("fails closed on a malformed bearer instead of digesting arbitrary input", () => {
        for (const malformed of ["", "short", `${"a".repeat(42)}/`, "a".repeat(44), "a".repeat(42)]) {
            expect(() => digestTeamInvitationToken(malformed)).toThrow();
            expect(tryDigestTeamInvitationToken(malformed)).toBeNull();
        }
        expect(tryDigestTeamInvitationToken(mintTeamInvitationToken())).not.toBeNull();
    });
});
