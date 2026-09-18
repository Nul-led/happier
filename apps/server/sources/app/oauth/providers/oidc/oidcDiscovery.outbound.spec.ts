import { generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";

import * as oidc from "openid-client";
import { describe, expect, it, vi } from "vitest";

import type { OidcAuthProviderInstanceConfig } from "@/app/auth/providers/oidc/oidcProviderConfig";
import { OutboundIdentityEndpointError, type OutboundIdentityNetworkPolicy } from "@/app/net/outboundIdentityNetworkPolicy";

import { deploymentConfiguredOidcNetworkPolicy, discoverOidcConfiguration } from "./oidcDiscovery";

/**
 * Gate for child 04 U2: `openid-client` must reach an administrator-defined OIDC
 * endpoint only through the server's outbound boundary. Every request the library
 * makes after discovery — token, JWKS rotation, refresh, UserInfo — is proven to
 * carry the boundary's policy by making that exact request fail with the
 * boundary's typed error.
 */

type IssuerFixture = Readonly<{
    origin: string;
    port: number;
    traffic: string[];
    setHandler: (handler: RequestListener) => void;
}>;

function findOutboundError(error: unknown): OutboundIdentityEndpointError | null {
    for (let current: unknown = error, depth = 0; current && depth < 8; depth += 1) {
        if (current instanceof OutboundIdentityEndpointError) return current;
        current = (current as { cause?: unknown }).cause;
    }
    return null;
}

function instanceFor(origin: string): OidcAuthProviderInstanceConfig {
    return {
        id: `outbound-${Math.random().toString(36).slice(2)}`,
        type: "oidc",
        displayName: "Outbound boundary",
        issuer: origin,
        clientId: "client",
        clientSecret: "secret",
        clientAuthenticationMethod: "client_secret_post",
        redirectUrl: "https://app.invalid/callback",
        scopes: "openid",
        httpTimeoutSeconds: 5,
        claims: { login: "preferred_username", email: "email", groups: "groups" },
        allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
        fetchUserInfo: true,
        storeRefreshToken: false,
        ui: { buttonColor: null, iconHint: null },
    };
}

function selfHostedLoopbackPolicy(port: number, overrides: Partial<OutboundIdentityNetworkPolicy> = {}): OutboundIdentityNetworkPolicy {
    return {
        address: { kind: "privateAllowlist", hostnames: ["127.0.0.1"], cidrs: ["127.0.0.0/8"] },
        allowedPorts: [port],
        allowLoopbackHttp: true,
        maxResponseBytes: 1024 * 1024,
        maxHeaderBytes: 32 * 1024,
        timeoutMs: 5_000,
        ...overrides,
    };
}

async function withIssuer(run: (issuer: IssuerFixture) => Promise<void>): Promise<void> {
    const traffic: string[] = [];
    let handler: RequestListener = (_request, response) => response.writeHead(404).end();
    const server = createServer((request, response) => {
        traffic.push(request.url ?? "");
        handler(request, response);
    });
    try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing test listener");
        await run({
            origin: `http://127.0.0.1:${address.port}`,
            port: address.port,
            traffic,
            setHandler: (next) => { handler = next; },
        });
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

type IssuerEndpoints = Readonly<{
    rotateKey: () => void;
    setRedirect: (path: string | null) => void;
    setAuthorizationEndpoint: (endpoint: string) => void;
    setUserInfoPadding: (length: number) => void;
}>;

function installOidcHandlers(issuer: IssuerFixture): IssuerEndpoints {
    const keys = [0, 1].map(() => generateKeyPairSync("rsa", { modulusLength: 2048 }));
    let currentKey = 0;
    let redirectPath: string | null = null;
    let authorizationEndpoint = `${issuer.origin}/authorize`;
    let userInfoPadding = 0;

    const idToken = () => {
        const key = keys[currentKey]!;
        const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: String(currentKey) })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({
            iss: issuer.origin, sub: "subject", aud: "client", nonce: "nonce",
            iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60,
        })).toString("base64url");
        const message = `${header}.${payload}`;
        return `${message}.${sign("RSA-SHA256", Buffer.from(message), key.privateKey).toString("base64url")}`;
    };

    issuer.setHandler((request, response) => {
        if (redirectPath && request.url === redirectPath) {
            response.writeHead(302, { location: `${issuer.origin}/elsewhere` }).end();
            return;
        }
        response.setHeader("content-type", "application/json");
        switch (request.url) {
            case "/.well-known/openid-configuration":
                response.end(JSON.stringify({
                    issuer: issuer.origin, authorization_endpoint: authorizationEndpoint,
                    token_endpoint: `${issuer.origin}/token`, jwks_uri: `${issuer.origin}/jwks`,
                    userinfo_endpoint: `${issuer.origin}/userinfo`, response_types_supported: ["code"],
                    code_challenge_methods_supported: ["S256"],
                    subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
                }));
                break;
            case "/token":
                response.end(JSON.stringify({
                    access_token: "access", token_type: "Bearer", refresh_token: "refresh", id_token: idToken(),
                }));
                break;
            case "/jwks":
                response.end(JSON.stringify({
                    keys: [{ ...keys[currentKey]!.publicKey.export({ format: "jwk" }), kid: String(currentKey), alg: "RS256", use: "sig" }],
                }));
                break;
            case "/userinfo":
                response.end(JSON.stringify({ sub: "subject", padding: "x".repeat(userInfoPadding) }));
                break;
            default:
                response.writeHead(404).end();
        }
    });

    return {
        rotateKey: () => { currentKey = 1; },
        setRedirect: (path) => { redirectPath = path; },
        setAuthorizationEndpoint: (endpoint) => { authorizationEndpoint = endpoint; },
        setUserInfoPadding: (length) => { userInfoPadding = length; },
    };
}

const CALLBACK = new URL("https://app.invalid/callback?code=code&state=state");
const GRANT_CHECKS = { expectedState: "state", expectedNonce: "nonce", pkceCodeVerifier: "verifier" } as const;

describe("OIDC discovery outbound boundary", () => {
    it("carries the boundary through discovery, token, JWKS rotation, refresh, and UserInfo", async () => {
        await withIssuer(async (issuer) => {
            const endpoints = installOidcHandlers(issuer);
            const config = await discoverOidcConfiguration(
                instanceFor(issuer.origin), "fingerprint", selfHostedLoopbackPolicy(issuer.port),
            );

            const grant = () => oidc.authorizationCodeGrant(config, CALLBACK, { ...GRANT_CHECKS });
            expect((await grant()).claims()?.sub).toBe("subject");
            expect(oidc.getJwksCache(config)).toBeDefined();

            // Exercise key rotation without sleeping through oauth4webapi's cache cooldown.
            const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
            try {
                endpoints.rotateKey();
                expect((await grant()).claims()?.sub).toBe("subject");
                expect((await oidc.refreshTokenGrant(config, "refresh")).access_token).toBe("access");
                expect((await oidc.fetchUserInfo(config, "access", "subject")).sub).toBe("subject");
            } finally {
                clock.mockRestore();
            }

            expect(issuer.traffic).toEqual([
                "/.well-known/openid-configuration", "/token", "/jwks",
                "/token", "/jwks", "/token", "/userinfo",
            ]);
        });
    });

    it("denies an administrator-defined issuer that resolves outside the supplied policy", async () => {
        await withIssuer(async (issuer) => {
            installOidcHandlers(issuer);
            const publicOnly: OutboundIdentityNetworkPolicy = {
                ...selfHostedLoopbackPolicy(issuer.port),
                address: { kind: "publicOnly" },
            };
            const error = await discoverOidcConfiguration(instanceFor(issuer.origin), "fingerprint", publicOnly)
                .then(() => null, (caught: unknown) => caught);
            expect(findOutboundError(error)?.code).toBe("outbound_address_forbidden");
            expect(issuer.traffic).toEqual([]);
        });
    });

    it("rejects a browser authorization endpoint outside the issuer policy", async () => {
        await withIssuer(async (issuer) => {
            const endpoints = installOidcHandlers(issuer);
            endpoints.setAuthorizationEndpoint(`https://other.invalid:${issuer.port}/authorize`);
            const error = await discoverOidcConfiguration(
                instanceFor(issuer.origin), "fingerprint", selfHostedLoopbackPolicy(issuer.port),
            ).then(() => null, (caught: unknown) => caught);
            expect(findOutboundError(error)?.code).toBe("outbound_host_forbidden");
            expect(issuer.traffic).toEqual(["/.well-known/openid-configuration"]);
        });
    });

    it("rejects discovered server endpoints outside the issuer policy before use", async () => {
        await withIssuer(async (issuer) => {
            issuer.setHandler((request, response) => {
                if (request.url === "/.well-known/openid-configuration") {
                    response.setHeader("content-type", "application/json");
                    response.end(JSON.stringify({
                        issuer: issuer.origin,
                        authorization_endpoint: `${issuer.origin}/authorize`,
                        token_endpoint: `https://other.invalid:${issuer.port}/token`,
                        jwks_uri: `${issuer.origin}/jwks`,
                        userinfo_endpoint: `${issuer.origin}/userinfo`,
                        response_types_supported: ["code"],
                        code_challenge_methods_supported: ["S256"],
                        subject_types_supported: ["public"],
                        id_token_signing_alg_values_supported: ["RS256"],
                    }));
                    return;
                }
                response.writeHead(404).end();
            });
            const error = await discoverOidcConfiguration(
                instanceFor(issuer.origin), "server-endpoint-policy", selfHostedLoopbackPolicy(issuer.port),
            ).then(() => null, (caught: unknown) => caught);
            expect(findOutboundError(error)?.code).toBe("outbound_host_forbidden");
            expect(issuer.traffic).toEqual(["/.well-known/openid-configuration"]);
        });
    });

    it("rejects an unexpected redirect on each retained endpoint rather than following it", async () => {
        for (const [path, exercise] of [
            ["/token", async (config: oidc.Configuration) => { await oidc.authorizationCodeGrant(config, CALLBACK, { ...GRANT_CHECKS }); }],
            ["/jwks", async (config: oidc.Configuration) => { await oidc.authorizationCodeGrant(config, CALLBACK, { ...GRANT_CHECKS }); }],
            ["/userinfo", async (config: oidc.Configuration) => { await oidc.fetchUserInfo(config, "access", "subject"); }],
        ] as const) {
            await withIssuer(async (issuer) => {
                const endpoints = installOidcHandlers(issuer);
                const config = await discoverOidcConfiguration(
                    instanceFor(issuer.origin), "fingerprint", selfHostedLoopbackPolicy(issuer.port),
                );
                endpoints.setRedirect(path);
                const error = await exercise(config).then(() => null, (caught: unknown) => caught);
                expect(findOutboundError(error)?.code, path).toBe("outbound_unexpected_redirect");
                expect(issuer.traffic, path).not.toContain("/elsewhere");
            });
        }
    });

    it("bounds a retained non-discovery response body", async () => {
        await withIssuer(async (issuer) => {
            const endpoints = installOidcHandlers(issuer);
            const config = await discoverOidcConfiguration(
                instanceFor(issuer.origin), "fingerprint", selfHostedLoopbackPolicy(issuer.port, { maxResponseBytes: 512 }),
            );
            endpoints.setUserInfoPadding(1024);
            const error = await oidc.fetchUserInfo(config, "access", "subject")
                .then(() => null, (caught: unknown) => caught);
            expect(findOutboundError(error)?.code).toBe("outbound_response_too_large");
        });
    });

    it("keeps deployment-configured issuers unfiltered by address and loopback-http capable", () => {
        const policy = deploymentConfiguredOidcNetworkPolicy(instanceFor("https://idp.internal.example"));
        expect(policy.address).toEqual({ kind: "deploymentConfigured" });
        expect(policy.allowedPorts).toBe("any");
        expect(policy.allowLoopbackHttp).toBe(true);
        expect(policy.timeoutMs).toBe(5_000);
    });
});
