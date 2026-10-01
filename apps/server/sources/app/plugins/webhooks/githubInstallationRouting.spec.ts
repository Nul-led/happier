import { describe, expect, it } from "vitest";

import { extractVerifiedGitHubInstallationIdV1 } from "./githubInstallationRouting";

function bytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

describe("verified GitHub installation routing", () => {
    it("preserves safe-integer identities exactly and fails closed beyond safe integers", () => {
        expect(extractVerifiedGitHubInstallationIdV1(bytes(
            '{"action":"opened","installation":{"node_id":"x","id":9007199254740991},"repository":{}}',
        ))).toEqual({ ok: true, installationId: "9007199254740991" });
        // Bounded JSON.parse cannot preserve precision beyond MAX_SAFE_INTEGER.
        // Failing closed routes nothing rather than routing the wrong installation.
        expect(extractVerifiedGitHubInstallationIdV1(bytes(
            '{"action":"opened","installation":{"node_id":"x","id":18446744073709551615},"repository":{}}',
        ))).toEqual({ ok: false, code: "malformedInstallation" });
    });

    it("reads only the top-level installation object; JSON duplicate keys resolve to the last value", () => {
        expect(extractVerifiedGitHubInstallationIdV1(bytes(
            '{"repository":{"installation":{"id":123}},"installation":{"id":456}}',
        ))).toEqual({ ok: true, installationId: "456" });
        // JSON.parse keeps the last duplicate key. Duplicates never reach
        // routing before signature verification, and GitHub never sends them,
        // so last-wins is the bounded canonical parse rather than a second tokenizer.
        expect(extractVerifiedGitHubInstallationIdV1(bytes(
            '{"installation":{"id":123},"installation":{"id":456}}',
        ))).toEqual({ ok: true, installationId: "456" });
    });

    it("rejects missing, string, zero, negative, fractional, and overlong identities", () => {
        for (const payload of [
            '{}',
            '{"installation":{}}',
            '{"installation":{"id":"123"}}',
            '{"installation":{"id":0}}',
            '{"installation":{"id":-1}}',
            '{"installation":{"id":1.5}}',
            '{"installation":{"id":123456789012345678901}}',
        ]) {
            expect(extractVerifiedGitHubInstallationIdV1(bytes(payload))).toEqual({
                ok: false,
                code: "malformedInstallation",
            });
        }
    });

    it("rejects invalid UTF-8, invalid JSON, and trailing content before verification", () => {
        expect(extractVerifiedGitHubInstallationIdV1(Uint8Array.of(0xff))).toEqual({
            ok: false,
            code: "malformedPayload",
        });
        for (const payload of [
            '{"installation":{"id":123}',
            '{"installation":{"id":123}} trailing',
        ]) {
            expect(extractVerifiedGitHubInstallationIdV1(bytes(payload))).toEqual({
                ok: false,
                code: "malformedPayload",
            });
        }
    });

    it("reports non-object JSON as a routing miss rather than a payload failure", () => {
        // Bounded JSON.parse admits the syntax; the shape check then reports
        // no usable installation. Ingest maps both codes to 404, so the
        // outward routing behavior is unchanged.
        expect(extractVerifiedGitHubInstallationIdV1(bytes(
            `${"[".repeat(65)}0${"]".repeat(65)}`,
        ))).toEqual({ ok: false, code: "malformedInstallation" });
    });
});
