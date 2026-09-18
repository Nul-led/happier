import type { OutboundIdentityNetworkPolicy } from "@/app/net/outboundIdentityNetworkPolicy";
import type { OAuthFlowProvider } from "@/app/oauth/providers/types";
import { createOutboundIdentityFetch } from "@/app/net/outboundIdentityFetch";

export type ManagedGitHubUserOAuthConfig = Readonly<{
    providerId: string;
    callbackProviderId?: string;
    githubHost: string;
    clientId: string;
    clientSecret: string;
    redirectUrl: string;
    networkPolicy: OutboundIdentityNetworkPolicy;
}>;

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Readonly<Record<string, unknown>>
        : null;
}

export function parseManagedGitHubUserProfile(value: unknown): Readonly<{
    id: number;
    login: string;
    avatar_url?: string;
    name?: string | null;
}> {
    const record = asRecord(value);
    const id = record?.id;
    const login = typeof record?.login === "string" ? record.login.trim() : "";
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || !login) {
        throw new Error("github_profile_invalid");
    }
    return Object.freeze({
        id,
        login,
        ...(typeof record?.avatar_url === "string" ? { avatar_url: record.avatar_url } : {}),
        ...(typeof record?.name === "string" || record?.name === null ? { name: record.name } : {}),
    });
}

/** User OAuth proof for one managed GitHub App identity consumer. */
export function createManagedGitHubUserOAuthProvider(
    input: ManagedGitHubUserOAuthConfig,
): OAuthFlowProvider {
    const githubHost = new URL(input.githubHost);
    const webBaseUrl = githubHost.toString().replace(/\/$/u, "");
    const apiBaseUrl = webBaseUrl === "https://github.com"
        ? "https://api.github.com"
        : `${webBaseUrl}/api/v3`;

    async function readJson(response: Response): Promise<unknown> {
        if (!response.ok) throw new Error(`github_oauth_upstream_${response.status}`);
        try {
            return await response.json();
        } catch {
            throw new Error("github_oauth_response_invalid");
        }
    }

    return Object.freeze({
        id: input.providerId,
        ...(input.callbackProviderId ? { callbackProviderId: input.callbackProviderId } : {}),
        resolveStatus: () => ({ enabled: true, configured: true }),
        isConfigured: () => true,
        resolveRedirectUrl: () => input.redirectUrl,
        resolveScope: () => "read:user",
        resolveAuthorizeUrl: async ({ state, scope, codeChallenge, codeChallengeMethod }) => {
            const url = new URL(`${webBaseUrl}/login/oauth/authorize`);
            url.searchParams.set("client_id", input.clientId);
            url.searchParams.set("redirect_uri", input.redirectUrl);
            url.searchParams.set("scope", scope);
            url.searchParams.set("state", state);
            // GitHub's account picker avoids silently authorizing the browser's
            // currently active account. This is an account-selection hint only;
            // organization eligibility is still proved by the installation API.
            url.searchParams.set("prompt", "select_account");
            if (codeChallenge && codeChallengeMethod) {
                url.searchParams.set("code_challenge", codeChallenge);
                url.searchParams.set("code_challenge_method", codeChallengeMethod);
            }
            return url.toString();
        },
        exchangeCodeForAccessToken: async ({ code, pkceCodeVerifier }) => {
            const outbound = createOutboundIdentityFetch({ policy: input.networkPolicy });
            try {
                const data = asRecord(await readJson(await outbound.fetch(
                    new URL(`${webBaseUrl}/login/oauth/access_token`),
                    {
                        method: "POST",
                        headers: {
                            Accept: "application/json",
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            client_id: input.clientId,
                            client_secret: input.clientSecret,
                            code,
                            redirect_uri: input.redirectUrl,
                            ...(pkceCodeVerifier ? { code_verifier: pkceCodeVerifier } : {}),
                        }),
                    },
                )));
                const accessToken = typeof data?.access_token === "string" ? data.access_token.trim() : "";
                if (!accessToken) throw new Error("github_access_token_missing");
                // Refresh and expiry fields are deliberately discarded. This token
                // exists only long enough for the current identity proof.
                return { accessToken };
            } finally {
                await outbound.close();
            }
        },
        fetchProfile: async ({ accessToken }) => {
            const outbound = createOutboundIdentityFetch({ policy: input.networkPolicy });
            try {
                return parseManagedGitHubUserProfile(await readJson(await outbound.fetch(
                    new URL(`${apiBaseUrl}/user`),
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            Accept: "application/vnd.github+json",
                        },
                    },
                )));
            } finally {
                await outbound.close();
            }
        },
        getLogin: (profile) => {
            try {
                return parseManagedGitHubUserProfile(profile).login;
            } catch {
                return null;
            }
        },
        getProviderUserId: (profile) => {
            try {
                return String(parseManagedGitHubUserProfile(profile).id);
            } catch {
                return null;
            }
        },
    });
}
