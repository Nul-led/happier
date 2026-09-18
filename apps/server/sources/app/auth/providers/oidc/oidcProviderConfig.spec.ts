import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("oidcProviderConfig", () => {
    it("parses AUTH_PROVIDERS_CONFIG_JSON and normalizes provider ids", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const env: NodeJS.ProcessEnv = {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                {
                    id: "Okta",
                    type: "oidc",
                    displayName: "Acme Okta",
                    issuer: "https://example.okta.com/oauth2/default",
                    clientId: "cid",
                    clientSecret: "secret",
                    redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
                },
            ]),
        };

        const res = resolveAuthProviderInstancesFromEnv(env);
        expect(res.errors).toEqual([]);
        expect(res.instances.map((i) => i.id)).toEqual(["okta"]);
        expect(res.instances[0]?.type).toBe("oidc");
    });

    it("applies OIDC defaults and validates scopes include openid", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const env: NodeJS.ProcessEnv = {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                {
                    id: "okta",
                    type: "oidc",
                    displayName: "Acme Okta",
                    issuer: "https://issuer.example.test",
                    clientId: "cid",
                    clientSecret: "secret",
                    redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
                    scopes: "profile email", // invalid (missing openid)
                },
            ]),
        };

        const res = resolveAuthProviderInstancesFromEnv(env);
        expect(res.instances).toEqual([]);
        expect(res.errors.join("\n")).toMatch(/openid/i);
    });

    it("parses allowlists, claim mapping, ui hints, and refresh/userinfo toggles", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const env: NodeJS.ProcessEnv = {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                {
                    id: "okta",
                    type: "oidc",
                    displayName: "Acme Okta",
                    issuer: "https://issuer.example.test",
                    clientId: "cid",
                    clientSecret: "secret",
                    redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
                    scopes: "openid profile email offline_access",
                    httpTimeoutSeconds: 7,
                    claims: { login: "preferred_username", email: "email", groups: "groups" },
                    allow: {
                        usersAllowlist: ["Alice", "bob"],
                        emailDomains: ["Example.COM", "@corp.example.test"],
                        groupsAny: ["Eng", "SRE"],
                        groupsAll: ["employees"],
                    },
                    fetchUserInfo: true,
                    storeRefreshToken: true,
                    ui: { buttonColor: "#123456", iconHint: "okta" },
                },
            ]),
        };

        const res = resolveAuthProviderInstancesFromEnv(env);
        expect(res.errors).toEqual([]);
        expect(res.instances.length).toBe(1);
        const instance: any = res.instances[0];
        expect(instance.scopes).toContain("openid");
        expect(instance.fetchUserInfo).toBe(true);
        expect(instance.storeRefreshToken).toBe(true);
        expect(instance.claims?.login).toBe("preferred_username");
        expect(instance.allow?.usersAllowlist).toEqual(["alice", "bob"]);
        expect(instance.allow?.emailDomains).toEqual(["example.com", "corp.example.test"]);
        expect(instance.allow?.groupsAny).toEqual(["eng", "sre"]);
        expect(instance.allow?.groupsAll).toEqual(["employees"]);
        expect(instance.ui?.buttonColor).toBe("#123456");
        expect(instance.ui?.iconHint).toBe("okta");
        expect(instance.httpTimeoutSeconds).toBe(7);
        expect(instance.clientAuthenticationMethod).toBe("client_secret_post");
    });

    it("accepts only supported confidential-client authentication methods", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");
        const provider = {
            id: "corp",
            type: "oidc",
            displayName: "Corp OIDC",
            issuer: "https://issuer.example.test",
            clientId: "cid",
            clientSecret: "secret",
            redirectUrl: "https://server.example.test/v1/oauth/corp/callback",
        };

        const basic = resolveAuthProviderInstancesFromEnv({
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{ ...provider, clientAuthenticationMethod: "client_secret_basic" }]),
        });
        expect(basic.errors).toEqual([]);
        expect(basic.instances[0]?.clientAuthenticationMethod).toBe("client_secret_basic");

        const unsupported = resolveAuthProviderInstancesFromEnv({
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{ ...provider, clientAuthenticationMethod: "private_key_jwt" }]),
        });
        expect(unsupported.instances).toEqual([]);
        expect(unsupported.errors.join("\n")).toMatch(/clientAuthenticationMethod/);
    });

    it("reports an error for duplicate provider ids", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const env: NodeJS.ProcessEnv = {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                {
                    id: "okta",
                    type: "oidc",
                    displayName: "Okta",
                    issuer: "https://issuer.example.test",
                    clientId: "cid",
                    clientSecret: "secret",
                    redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
                },
                {
                    id: "OKTA",
                    type: "oidc",
                    displayName: "Okta2",
                    issuer: "https://issuer2.example.test",
                    clientId: "cid2",
                    clientSecret: "secret2",
                    redirectUrl: "https://server.example.test/v1/oauth/okta/callback",
                },
            ]),
        };

        const res = resolveAuthProviderInstancesFromEnv(env);
        expect(res.instances).toEqual([]);
        expect(res.errors.length).toBeGreaterThan(0);
        expect(res.errors.join("\n")).toMatch(/duplicate/i);
    });


    it("rejects non-loopback http issuers (security hardening)", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const env: NodeJS.ProcessEnv = {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                {
                    id: "corp",
                    type: "oidc",
                    displayName: "Corp OIDC",
                    issuer: "http://issuer.corp.example.test",
                    clientId: "cid",
                    clientSecret: "secret",
                    redirectUrl: "https://server.example.test/v1/oauth/corp/callback",
                },
            ]),
        };

        const res = resolveAuthProviderInstancesFromEnv(env);
        expect(res.instances).toEqual([]);
        expect(res.errors.join("\n")).toMatch(/issuer/i);
        expect(res.errors.join("\n")).toMatch(/https/i);
    });

    it("keeps valid provider instances when an unrelated entry is invalid", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const env: NodeJS.ProcessEnv = {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                {
                    id: "broken",
                    type: "oidc",
                    displayName: "Broken",
                    issuer: "not-a-url",
                    clientId: "cid",
                    clientSecret: "secret",
                    redirectUrl: "https://server.example.test/v1/oauth/broken/callback",
                },
                {
                    id: "valid",
                    type: "oidc",
                    displayName: "Valid",
                    issuer: "https://issuer.example.test",
                    clientId: "cid",
                    clientSecret: "secret",
                    redirectUrl: "https://server.example.test/v1/oauth/valid/callback",
                },
            ]),
        };

        const res = resolveAuthProviderInstancesFromEnv(env);
        expect(res.instances.map((instance) => instance.id)).toEqual(["valid"]);
        expect(res.errors.join("\n")).toMatch(/broken/);
    });

    it("rejects malformed allowlist fields without dropping unrelated valid providers", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const provider = (id: string, allow: unknown) => ({
            id,
            type: "oidc",
            displayName: id,
            issuer: `https://${id}.example.test`,
            clientId: "cid",
            clientSecret: "secret",
            redirectUrl: `https://server.example.test/v1/oauth/${id}/callback`,
            allow,
        });
        const res = resolveAuthProviderInstancesFromEnv({
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                provider("scalar-list", { groupsAny: "admins" }),
                provider("mixed-list", { usersAllowlist: ["alice", 7] }),
                provider("valid", { groupsAny: ["admins"] }),
            ]),
        });

        expect(res.instances.map((instance) => instance.id)).toEqual(["valid"]);
        expect(res.errors).toEqual(expect.arrayContaining([
            expect.stringMatching(/allow\.groupsAny for scalar-list/),
            expect.stringMatching(/allow\.usersAllowlist for mixed-list/),
        ]));
    });

    it("rejects a malformed whole document without producing provider instances", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const res = resolveAuthProviderInstancesFromEnv({
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify({ id: "not-an-array" }),
        });

        expect(res.instances).toEqual([]);
        expect(res.errors.join("\n")).toMatch(/JSON array/);
    });

    it("does not fall back to JSON when the preferred config path is unreadable", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const dir = await mkdtemp(join(tmpdir(), "happier-oidc-missing-config-"));
        try {
            const res = resolveAuthProviderInstancesFromEnv({
                AUTH_PROVIDERS_CONFIG_PATH: join(dir, "missing.json"),
                AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                    {
                        id: "fallback",
                        type: "oidc",
                        displayName: "Fallback",
                        issuer: "https://issuer.example.test",
                        clientId: "cid",
                        clientSecret: "secret",
                        redirectUrl: "https://server.example.test/v1/oauth/fallback/callback",
                    },
                ]),
            });

            expect(res.instances).toEqual([]);
            expect(res.errors.join("\n")).toMatch(/cannot read file/);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("loads provider instances from AUTH_PROVIDERS_CONFIG_PATH (preferred over JSON)", async () => {
        const { resolveAuthProviderInstancesFromEnv } = await import("./oidcProviderConfig");

        const dir = await mkdtemp(join(tmpdir(), "happier-oidc-config-"));
        try {
            const path = join(dir, "providers.json");
            await writeFile(
                path,
                JSON.stringify([
                    {
                        id: "Acme",
                        type: "oidc",
                        displayName: "Acme OIDC",
                        issuer: "https://issuer.example.test",
                        clientId: "cid",
                        clientSecret: "secret",
                        redirectUrl: "https://server.example.test/v1/oauth/acme/callback",
                    },
                ]),
                "utf8",
            );

            const env: NodeJS.ProcessEnv = {
                AUTH_PROVIDERS_CONFIG_PATH: path,
                AUTH_PROVIDERS_CONFIG_JSON: "[]",
            };

            const res = resolveAuthProviderInstancesFromEnv(env);
            expect(res.errors).toEqual([]);
            expect(res.instances.map((i) => i.id)).toEqual(["acme"]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
