import type { ConnectionType, WorkOS } from "@workos-inc/node";
import { describe, expect, it, vi } from "vitest";

import type { WorkosPlatformConfigResolution } from "@/app/integrations/workos/workosPlatform";
import { createWorkosOAuthAdapter } from "./workosOAuthAdapter";

function availablePlatform(client: WorkOS): WorkosPlatformConfigResolution {
    return Object.freeze({
        available: true,
        clientId: "client_test",
        client,
        runtimeFingerprint: "workos-platform:v1:test",
    });
}

function createClient() {
    return {
        sso: {
            getAuthorizationUrl: vi.fn(() => "https://api.workos.test/sso/authorize"),
            getProfileAndToken: vi.fn(async () => ({
                accessToken: "access-token",
                profile: {
                    id: "prof_123",
                    idpId: "idp_123",
                    organizationId: "org_123",
                    connectionId: "conn_123",
                    connectionType: "GoogleOAuth",
                    email: "Alice@Example.com",
                },
                oauthTokens: { accessToken: "provider-token", refreshToken: "provider-refresh" },
            })),
        },
    } as unknown as WorkOS;
}

function createAdapter(providerInstanceId = "team-sso-1", client = createClient()) {
    return createWorkosOAuthAdapter({
        providerInstanceId,
        enabled: true,
        redirectUrl: `https://home.example.test/v1/oauth/${providerInstanceId}/callback`,
        externalReference: {
            v: 1,
            kind: "workos_sso",
            organizationId: "org_123",
            connectionId: "conn_123",
        },
        platform: availablePlatform(client),
    });
}

describe("createWorkosOAuthAdapter", () => {
    it("uses the immutable provider-instance namespace", () => {
        expect(createAdapter("team-sso-1").id).toBe("team-sso-1");
        expect(createAdapter("team-sso-2").id).toBe("team-sso-2");
    });

    it("authorizes with the exact connection and the existing state and S256 challenge", async () => {
        const client = createClient();
        const adapter = createAdapter("team-sso-1", client);

        await expect(adapter.resolveAuthorizeUrl({
            state: "signed-state",
            codeChallenge: "s256-challenge",
            codeChallengeMethod: "S256",
        })).resolves.toBe("https://api.workos.test/sso/authorize");

        expect(client.sso.getAuthorizationUrl).toHaveBeenCalledWith({
            clientId: "client_test",
            connection: "conn_123",
            redirectUri: "https://home.example.test/v1/oauth/team-sso-1/callback",
            state: "signed-state",
            codeChallenge: "s256-challenge",
            codeChallengeMethod: "S256",
        });
    });

    it("returns a sanitized exchange profile and never projects vendor OAuth tokens", async () => {
        const client = createClient();
        const adapter = createAdapter("team-sso-1", client);

        await expect(adapter.exchangeCodeForProfile({
            code: "authorization-code",
            pkceCodeVerifier: "pkce-verifier",
        })).resolves.toEqual({
            accessToken: "access-token",
            profile: {
                id: "prof_123",
                idpId: "idp_123",
                organizationId: "org_123",
                connectionId: "conn_123",
                email: "alice@example.com",
            },
        });
        expect(client.sso.getProfileAndToken).toHaveBeenCalledWith({
            clientId: "client_test",
            code: "authorization-code",
            codeVerifier: "pkce-verifier",
        });
    });

    it("requires the existing S256 challenge and verifier", async () => {
        const adapter = createAdapter();

        await expect(adapter.resolveAuthorizeUrl({
            state: "signed-state",
        } as Parameters<typeof adapter.resolveAuthorizeUrl>[0])).rejects.toThrow("invalid_pkce");
        await expect(adapter.exchangeCodeForProfile({
            code: "authorization-code",
        } as Parameters<typeof adapter.exchangeCodeForProfile>[0])).rejects.toThrow("invalid_pkce");
    });

    it.each([
        [{ organizationId: "org_other", connectionId: "conn_123" }, "workos_organization_mismatch"],
        [{ organizationId: "org_123", connectionId: "conn_other" }, "workos_connection_mismatch"],
    ] as const)("rejects mismatched profile evidence %#", async (mismatch, error) => {
        const client = createClient();
        vi.mocked(client.sso.getProfileAndToken).mockResolvedValueOnce({
            accessToken: "access-token",
            profile: {
                id: "prof_123",
                idpId: "idp_123",
                organizationId: mismatch.organizationId,
                connectionId: mismatch.connectionId,
                connectionType: "GoogleOAuth" as ConnectionType,
                email: "alice@example.com",
            },
        });
        const adapter = createAdapter("team-sso-1", client);

        await expect(adapter.exchangeCodeForProfile({
            code: "authorization-code",
            pkceCodeVerifier: "pkce-verifier",
        })).rejects.toThrow(error);
    });

    it("retains an unavailable binding without calling WorkOS", async () => {
        const adapter = createWorkosOAuthAdapter({
            providerInstanceId: "team-sso-1",
            enabled: true,
            redirectUrl: "https://home.example.test/v1/oauth/team-sso-1/callback",
            externalReference: {
                v: 1,
                kind: "workos_sso",
                organizationId: "org_123",
                connectionId: "conn_123",
            },
            platform: {
                available: false,
                code: "workos_platform_unavailable",
                reason: "not_configured",
            },
        });

        expect(adapter.resolveStatus()).toEqual({ enabled: true, configured: false });
        await expect(adapter.resolveAuthorizeUrl({
            state: "state", codeChallenge: "challenge", codeChallengeMethod: "S256",
        })).rejects.toThrow("workos_platform_unavailable");
    });
});
