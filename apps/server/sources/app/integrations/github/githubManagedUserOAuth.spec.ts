import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
    fetch: vi.fn(),
    close: vi.fn(async () => undefined),
}));

vi.mock("@/app/net/outboundIdentityFetch", () => ({
    createOutboundIdentityFetch: vi.fn(() => transport),
}));

import type { OutboundIdentityNetworkPolicy } from "@/app/net/outboundIdentityNetworkPolicy";
import { createManagedGitHubUserOAuthProvider } from "./githubManagedUserOAuth";

const networkPolicy = {
    address: { kind: "publicOnly" },
    allowedPorts: [443],
    allowLoopbackHttp: false,
    maxResponseBytes: 1024,
    maxHeaderBytes: 1024,
    timeoutMs: 30_000,
} as const satisfies OutboundIdentityNetworkPolicy;

function createProvider(githubHost = "https://github.enterprise.test") {
    return createManagedGitHubUserOAuthProvider({
        providerId: "managed-github",
        githubHost,
        clientId: "Iv1.client",
        clientSecret: "client-secret",
        redirectUrl: "https://home.example.test/v1/oauth/managed-github/callback",
        networkPolicy,
    });
}

describe("managed GitHub App user OAuth", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transport.close.mockResolvedValue(undefined);
    });

    it("builds the exact host callback, state, and PKCE authorization request", async () => {
        const provider = createProvider();
        expect(provider.resolveStatus({})).toEqual({ enabled: true, configured: true });
        expect(provider.resolveRedirectUrl({})).toBe("https://home.example.test/v1/oauth/managed-github/callback");
        expect(provider.resolveScope({ env: {}, flow: "auth" })).toBe("read:user");
        const url = new URL(await provider.resolveAuthorizeUrl({
            env: {},
            state: "signed-state",
            scope: "read:user",
            codeChallenge: "challenge",
            codeChallengeMethod: "S256",
        }));
        expect(`${url.origin}${url.pathname}`).toBe("https://github.enterprise.test/login/oauth/authorize");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: "Iv1.client",
            redirect_uri: "https://home.example.test/v1/oauth/managed-github/callback",
            scope: "read:user",
            state: "signed-state",
            prompt: "select_account",
            code_challenge: "challenge",
            code_challenge_method: "S256",
        });
    });

    it("uses the canonical outbound transport for token exchange and closes it", async () => {
        transport.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
            access_token: "ephemeral-user-token",
            refresh_token: "must-be-discarded",
        }), { status: 200, headers: { "content-type": "application/json" } }));
        await expect(createProvider().exchangeCodeForAccessToken({
            env: {}, code: "one-time-code", pkceCodeVerifier: "verifier",
        })).resolves.toEqual({ accessToken: "ephemeral-user-token" });
        expect(transport.fetch).toHaveBeenCalledWith(
            new URL("https://github.enterprise.test/login/oauth/access_token"),
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    client_id: "Iv1.client",
                    client_secret: "client-secret",
                    code: "one-time-code",
                    redirect_uri: "https://home.example.test/v1/oauth/managed-github/callback",
                    code_verifier: "verifier",
                }),
            }),
        );
        expect(transport.close).toHaveBeenCalledOnce();
    });

    it("fetches and strictly validates the immutable user identity without returning tokens in the profile", async () => {
        transport.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 42, login: "Octocat" }), {
            status: 200,
            headers: { "content-type": "application/json" },
        }));
        const provider = createProvider("https://github.com");
        const profile = await provider.fetchProfile({ env: {}, accessToken: "ephemeral-user-token" });
        expect(profile).toEqual({ id: 42, login: "Octocat" });
        expect(provider.getProviderUserId(profile)).toBe("42");
        expect(provider.getLogin(profile)).toBe("Octocat");
        expect(transport.fetch).toHaveBeenCalledWith(
            new URL("https://api.github.com/user"),
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: "Bearer ephemeral-user-token" }),
            }),
        );
        expect(transport.close).toHaveBeenCalledOnce();

        expect(provider.getProviderUserId({ id: 0, login: "bad" })).toBeNull();
        expect(provider.getProviderUserId({ id: 1.5, login: "bad" })).toBeNull();
        expect(provider.getLogin({ id: 42, login: " " })).toBeNull();
    });
});
