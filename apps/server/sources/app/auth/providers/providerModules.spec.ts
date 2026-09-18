import { describe, expect, it } from "vitest";

import { resolveDeploymentProviderSnapshot } from "./providerModules";

function oidcEntry(id: string, issuer = "https://issuer.example.test"): Record<string, unknown> {
    return {
        id,
        type: "oidc",
        displayName: id,
        issuer,
        clientId: "cid",
        clientSecret: "secret",
        redirectUrl: `https://server.example.test/v1/oauth/${id.trim().toLowerCase()}/callback`,
    };
}

describe("resolveDeploymentProviderSnapshot auth id ownership", () => {
    it.each(["github", " GitHub ", "key_challenge", "email", "mtls", "anonymous"])(
        "rejects normalized dynamic id %s colliding with static, core, or compatibility output",
        (id) => {
            const result = resolveDeploymentProviderSnapshot({
                AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([oidcEntry(id), oidcEntry("valid")]),
            } as NodeJS.ProcessEnv);

            expect(result.modules.map((module) => module.id)).toEqual(["github", "valid"]);
            expect([...result.references.keys()]).toEqual(["github", "valid"]);
            expect(result.errors.join("\n")).toMatch(/reserved|collision/i);
        },
    );

    it("keeps built-in and valid providers when another deployment entry is malformed", () => {
        const result = resolveDeploymentProviderSnapshot({
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                oidcEntry("broken", "not-a-url"),
                oidcEntry("valid"),
            ]),
        } as NodeJS.ProcessEnv);

        expect(result.modules.map((module) => module.id)).toEqual(["github", "valid"]);
        expect([...result.references.keys()]).toEqual(["github", "valid"]);
        expect(result.errors.join("\n")).toMatch(/broken/);
    });

    it("excludes every candidate in a canonicalized duplicate id group", () => {
        const result = resolveDeploymentProviderSnapshot({
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([
                oidcEntry("duplicate"),
                oidcEntry(" DUPLICATE ", "https://second-issuer.example.test"),
                oidcEntry("valid"),
            ]),
        } as NodeJS.ProcessEnv);

        expect(result.modules.map((module) => module.id)).toEqual(["github", "valid"]);
        expect([...result.references.keys()]).toEqual(["github", "valid"]);
        expect(result.errors.join("\n")).toMatch(/duplicate provider id: duplicate/i);
    });

    it("projects stable built-in and deployment runtime references", () => {
        const env = {
            AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([oidcEntry("valid")]),
        } as NodeJS.ProcessEnv;

        const first = resolveDeploymentProviderSnapshot(env);
        const second = resolveDeploymentProviderSnapshot(env);

        expect(first.references.get("github")).toEqual({
            source: "built_in",
            runtimeFingerprint: "builtin:github:v1",
        });
        expect(first.references.get("valid")).toEqual({
            source: "deployment",
            runtimeFingerprint: expect.stringMatching(/^deployment:v1:/),
        });
        expect(second.references.get("valid")).toEqual(first.references.get("valid"));
    });

    it("changes deployment fingerprints only for normalized runtime configuration", () => {
        const fingerprintFor = (overrides: Record<string, unknown>): string | undefined => {
            const snapshot = resolveDeploymentProviderSnapshot({
                AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{ ...oidcEntry("valid"), ...overrides }]),
            } as NodeJS.ProcessEnv);
            return snapshot.references.get("valid")?.runtimeFingerprint;
        };
        const baseline = fingerprintFor({});

        expect(fingerprintFor({
            displayName: "Renamed",
            ui: { buttonColor: "#123456", iconHint: "custom" },
        })).toBe(baseline);
        expect(fingerprintFor({
            scopes: "email openid profile",
            allow: { usersAllowlist: ["Bob", "alice"] },
        })).toBe(fingerprintFor({
            scopes: "profile email openid",
            allow: { usersAllowlist: ["ALICE", "bob", "alice"] },
        }));

        for (const runtimeChange of [
            { issuer: "https://other-issuer.example.test" },
            { clientId: "other-client" },
            { clientSecret: "other-secret" },
            { clientAuthenticationMethod: "client_secret_basic" },
            { redirectUrl: "https://server.example.test/v1/oauth/other/callback" },
            { scopes: "openid profile custom" },
            { httpTimeoutSeconds: 45 },
            { claims: { login: "login", email: "mail", groups: "roles" } },
            { allow: { usersAllowlist: ["alice"] } },
            { fetchUserInfo: true },
            { storeRefreshToken: true },
        ]) {
            expect(fingerprintFor(runtimeChange)).not.toBe(baseline);
        }
    });
});
