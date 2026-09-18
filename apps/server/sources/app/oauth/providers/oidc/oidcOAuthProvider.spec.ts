import { afterEach, describe, expect, it, vi } from "vitest";
import * as oidcClient from "openid-client";

import { createOidcOAuthProvider } from "./oidcOAuthProvider";

vi.mock("openid-client", () => ({
    allowInsecureRequests: () => {},
    ClientSecretBasic: vi.fn(() => () => {}),
    ClientSecretPost: vi.fn(() => () => {}),
    enableNonRepudiationChecks: () => {},
    customFetch: Symbol("customFetch"),
    discovery: vi.fn(async (issuer: URL) => ({
        serverMetadata: () => ({
            issuer: issuer.href.replace(/\/$/, ""),
            authorization_endpoint: `${issuer.origin}/authorize`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
        }),
    })),
    fetchUserInfo: vi.fn(async () => ({})),
    skipSubjectCheck: Symbol("skipSubjectCheck"),
}));

afterEach(() => {
    vi.restoreAllMocks();
});

describe("oidcOAuthProvider", () => {
    it("reports sanitized test diagnostics using the same normalized claims and eligibility rules as sign-in", async () => {
        const provider = createOidcOAuthProvider({
            id: "oidc-diagnostics",
            type: "oidc",
            displayName: "OIDC diagnostics",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://home.example.test/v1/oauth/oidc-diagnostics/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "upn", email: "mail", groups: "roles" },
            allow: {
                usersAllowlist: ["alice"],
                emailDomains: ["example.test"],
                groupsAny: ["engineering"],
                groupsAll: ["staff"],
            },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "diagnostics-runtime");
        const profile = await provider.fetchProfile({
            env: process.env,
            accessToken: "never-disclose-this-token",
            idTokenClaims: {
                sub: "private-subject",
                upn: "ALICE",
                mail: "Alice@Example.Test",
                email_verified: true,
                roles: ["Engineering", "STAFF", "engineering"],
                private_claim: "do-not-persist",
            },
        });

        expect(await provider.describeIdentityTest?.({ env: process.env, profile })).toEqual({
            subjectPresent: true,
            loginAvailable: true,
            emailAvailable: true,
            emailVerified: true,
            groups: { state: "complete", values: ["engineering", "staff"] },
            eligibility: {
                status: "eligible",
                rules: [
                    { kind: "users", matched: true },
                    { kind: "email_domains", matched: true },
                    { kind: "groups_any", matched: true },
                    { kind: "groups_all", matched: true },
                ],
            },
        });

        const incomplete = await provider.describeIdentityTest?.({
            env: process.env,
            profile: {
                sub: "private-subject",
                upn: "alice",
                mail: "alice@example.test",
                email_verified: false,
                _claim_names: { roles: "remote-source" },
            },
        });
        expect(incomplete).toMatchObject({
            emailVerified: false,
            groups: { state: "incomplete" },
            eligibility: {
                status: "ineligible",
                rules: [
                    { kind: "users", matched: true },
                    { kind: "email_domains", matched: false },
                    { kind: "groups_any", matched: false },
                    { kind: "groups_all", matched: false },
                ],
            },
        });
    });

    it("uses configured scopes when building auth urls", () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email offline_access",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");

        expect(provider.resolveScope({ env: process.env, flow: "auth" })).toBe("openid profile email offline_access");
    });

    it("extracts login using the configured login claim with sensible fallback", () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "upn", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");

        expect(provider.getLogin({ sub: "subject", upn: "User@Corp.Example" })).toBe("user@corp.example");
        expect(provider.getLogin({ sub: "subject", upn: "", preferred_username: "alice" })).toBe("alice");
        expect(provider.getLogin({ sub: "subject", email: "alice@example.test" })).toBe("alice@example.test");
        expect(provider.getLogin({ sub: "subject" })).toBe(null);
    });

    it("rejects non-string subjects instead of coercing them", () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");

        expect(provider.getProviderUserId({ sub: 42 })).toBe(null);
    });

    it("rejects UserInfo with a different subject", async () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: true,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");
        (oidcClient.fetchUserInfo as any).mockResolvedValueOnce({ sub: "different-subject" });

        await expect(provider.fetchProfile({
            env: process.env,
            accessToken: "t",
            idTokenClaims: { sub: "case-Sensitive-Subject" },
        })).rejects.toThrow("profile_fetch_failed");
    });

    it("does not let UserInfo overwrite protected ID-token claims", async () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: true,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");
        (oidcClient.fetchUserInfo as any).mockResolvedValueOnce({
            sub: "case-Sensitive-Subject",
            preferred_username: "SupplementedUser",
            iss: "https://attacker.example.test",
            aud: "attacker",
            nonce: "attacker",
        });

        await expect(provider.fetchProfile({
            env: process.env,
            accessToken: "t",
            idTokenClaims: {
                sub: "case-Sensitive-Subject",
                iss: "https://issuer.example.test",
                aud: "cid",
                nonce: "expected",
            },
        })).resolves.toEqual({
            sub: "case-Sensitive-Subject",
            preferred_username: "supplementeduser",
            email_verified: false,
        });
    });

    it("keeps distinct configured login and email claims stable in the sanitized profile", async () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "email", email: "mail", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");

        const profile = await provider.fetchProfile({
            env: process.env,
            accessToken: "t",
            idTokenClaims: {
                sub: "subject",
                email: "Login@Example.Test",
                mail: "Mailbox@Example.Test",
                email_verified: true,
            },
        });

        expect(profile).toEqual({
            sub: "subject",
            email: "login@example.test",
            mail: "mailbox@example.test",
            email_verified: true,
        });
        expect(provider.getLogin(profile)).toBe("login@example.test");
    });

    it("does not reuse ID-token verification for a UserInfo-supplied email", async () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: true,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");
        (oidcClient.fetchUserInfo as any).mockResolvedValueOnce({
            sub: "subject",
            email: "new@allowed.example",
        });

        await expect(provider.fetchProfile({
            env: process.env,
            accessToken: "t",
            idTokenClaims: {
                sub: "subject",
                email: "old@outside.example",
                email_verified: true,
            },
        })).resolves.toMatchObject({
            email: "new@allowed.example",
            email_verified: false,
        });
    });

    it("preserves ID-token verification when UserInfo repeats the same normalized email", async () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: true,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");
        (oidcClient.fetchUserInfo as any).mockResolvedValueOnce({
            sub: "subject",
            email: "same@example.test",
        });

        await expect(provider.fetchProfile({
            env: process.env,
            accessToken: "t",
            idTokenClaims: {
                sub: "subject",
                email: " Same@Example.Test ",
                email_verified: true,
            },
        })).resolves.toMatchObject({
            email: "same@example.test",
            email_verified: true,
        });
    });

    it("preserves the original error as the cause when profile fetch fails", async () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: true,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");

        const cause = new Error("fetchUserInfo exploded");
        (oidcClient.discovery as any).mockResolvedValue({} as any);
        (oidcClient.fetchUserInfo as any).mockRejectedValue(cause);

        const err = await provider
            .fetchProfile({ env: process.env, accessToken: "t", idTokenClaims: { sub: "user-1" } })
            .then(
                () => null,
                (e) => e,
            );

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe("profile_fetch_failed");
        expect((err as any).cause).toBe(cause);
    });

    it("reports configured=false when required instance config is missing", () => {
        const provider = createOidcOAuthProvider({
            id: "okta",
            type: "oidc",
            displayName: "Okta",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "",
            redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "test-runtime");

        expect(provider.isConfigured(process.env)).toBe(false);
        expect(provider.resolveStatus(process.env).configured).toBe(false);
    });

    it("validates advertised authorization-code and S256 PKCE support", async () => {
        const provider = createOidcOAuthProvider({
            id: "validate-oidc",
            type: "oidc",
            displayName: "Validate OIDC",
            issuer: "https://validate.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/validate-oidc/callback",
            scopes: "openid profile email",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "validate-runtime");

        (oidcClient.discovery as any).mockResolvedValueOnce({
            serverMetadata: () => ({
                issuer: "https://validate.example.test",
                authorization_endpoint: "https://validate.example.test/authorize",
                response_types_supported: ["token"],
                code_challenge_methods_supported: ["S256"],
            }),
        });
        await expect(provider.validateConfiguration?.({ env: process.env }))
            .rejects.toThrow("oidc_authorization_code_unsupported");
        (oidcClient.discovery as any).mockResolvedValueOnce({
            serverMetadata: () => ({
                issuer: "https://validate.example.test",
                authorization_endpoint: "https://validate.example.test/authorize",
                response_types_supported: ["code"],
                code_challenge_methods_supported: ["S256"],
            }),
        });
        await expect(createOidcOAuthProvider({
            id: "validate-oidc-ready",
            type: "oidc",
            displayName: "Validate OIDC",
            issuer: "https://validate.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/validate-oidc-ready/callback",
            scopes: "openid",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "validate-runtime-ready").validateConfiguration?.({ env: process.env }))
            .resolves.toBeUndefined();
    });

    it("rejects unsupported discovery metadata before building a real authorization URL", async () => {
        (oidcClient.discovery as any).mockResolvedValueOnce({
            serverMetadata: () => ({
                issuer: "https://consumer.example.test",
                authorization_endpoint: "https://consumer.example.test/authorize",
                response_types_supported: ["token"],
                code_challenge_methods_supported: ["S256"],
            }),
        });
        const provider = createOidcOAuthProvider({
            id: "consumer-oidc",
            type: "oidc",
            displayName: "Consumer OIDC",
            issuer: "https://consumer.example.test",
            clientId: "cid",
            clientAuthenticationMethod: "client_secret_post",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/consumer-oidc/callback",
            scopes: "openid",
            httpTimeoutSeconds: 30,
            claims: { login: "preferred_username", email: "email", groups: "groups" },
            allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
            fetchUserInfo: false,
            storeRefreshToken: false,
            ui: { buttonColor: null, iconHint: null },
        }, "consumer-runtime");

        await expect(provider.resolveAuthorizeUrl({
            env: process.env,
            state: "state",
            scope: "openid",
            codeChallenge: "challenge",
            codeChallengeMethod: "S256",
            nonce: "nonce",
        })).rejects.toThrow("oidc_authorization_code_unsupported");
    });
});
