import { describe, expect, it, vi } from "vitest";

import type { OAuthFlowProvider } from "./providers/types";
import { exchangeOAuthCodeForProfile } from "./exchangeOAuthCodeForProfile";

function provider(
    exchange: OAuthFlowProvider["exchangeCodeForAccessToken"],
    fetchProfile: OAuthFlowProvider["fetchProfile"],
): OAuthFlowProvider {
    return {
        id: "provider",
        resolveStatus: () => ({ enabled: true, configured: true }),
        isConfigured: () => true,
        resolveRedirectUrl: () => "https://example.test/callback",
        resolveScope: () => "",
        resolveAuthorizeUrl: vi.fn(async () => "https://example.test/authorize"),
        exchangeCodeForAccessToken: exchange,
        fetchProfile,
        getLogin: () => null,
        getProviderUserId: () => null,
    };
}

describe("exchangeOAuthCodeForProfile", () => {
    it("uses an exchange-bundled profile without issuing a second profile request", async () => {
        const fetchProfile = vi.fn(async () => ({ id: "wrong" }));
        const profile = { id: "workos-user", organizationId: "org_exact" };
        const result = await exchangeOAuthCodeForProfile({
            provider: provider(
                vi.fn(async () => ({ accessToken: "token", profile })),
                fetchProfile,
            ),
            env: {},
            code: "code",
            state: "state",
        });
        expect(result).toEqual({ accessToken: "token", profile });
        expect(fetchProfile).not.toHaveBeenCalled();
    });

    it("keeps the incumbent token-then-profile flow when exchange has no profile", async () => {
        const fetchProfile = vi.fn(async () => ({ id: "github-user" }));
        const result = await exchangeOAuthCodeForProfile({
            provider: provider(
                vi.fn(async () => ({ accessToken: "token", refreshToken: "refresh" })),
                fetchProfile,
            ),
            env: {},
            code: "code",
        });
        expect(result).toEqual({
            accessToken: "token",
            refreshToken: "refresh",
            profile: { id: "github-user" },
        });
        expect(fetchProfile).toHaveBeenCalledOnce();
    });
});
