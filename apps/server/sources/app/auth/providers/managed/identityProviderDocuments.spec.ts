import { describe, expect, it } from "vitest";

import {
    parseIdentityProviderConfig,
    parseIdentityProviderSecrets,
    parseTeamIdentityConnectionDocuments,
} from "./identityProviderDocuments";

const oidcConfig = {
    v: 1,
    kind: "oidc",
    issuer: "https://id.example.test",
    clientId: "happier",
    clientAuthenticationMethod: "client_secret_post",
    scopes: "openid profile email",
    httpTimeoutSeconds: 30,
    claims: { login: "preferred_username", email: "email", groups: "groups" },
    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
    fetchUserInfo: true,
    storeRefreshToken: false,
    ui: { buttonColor: null, iconHint: "oidc" },
} as const;

describe("managed identity-provider stored documents", () => {
    it("accepts the exact current OIDC document and rejects unknown or unmanaged kinds", () => {
        expect(parseIdentityProviderConfig("oidc", oidcConfig)).toEqual({ ok: true, value: oidcConfig });
        expect(parseIdentityProviderConfig("oidc", { ...oidcConfig, future: true })).toEqual({
            ok: false,
            code: "provider_config_unreadable",
        });
        expect(parseIdentityProviderConfig("native_email", oidcConfig)).toEqual({
            ok: false,
            code: "provider_kind_not_managed",
        });
    });

    it("resolves the token-endpoint client authentication method explicitly", () => {
        const { clientAuthenticationMethod: _omitted, ...withoutMethod } = oidcConfig;
        // A document written before the method was stored still resolves to one explicit
        // method rather than leaving the token-endpoint credential placement undecided.
        expect(parseIdentityProviderConfig("oidc", withoutMethod)).toEqual({
            ok: true,
            value: { ...withoutMethod, clientAuthenticationMethod: "client_secret_post" },
        });
        expect(parseIdentityProviderConfig("oidc", {
            ...oidcConfig,
            clientAuthenticationMethod: "client_secret_basic",
        })).toEqual({
            ok: true,
            value: { ...oidcConfig, clientAuthenticationMethod: "client_secret_basic" },
        });
        expect(parseIdentityProviderConfig("oidc", {
            ...oidcConfig,
            clientAuthenticationMethod: "private_key_jwt",
        })).toEqual({ ok: false, code: "provider_config_unreadable" });
    });

    it("accepts only a matching strict encrypted secret document", () => {
        expect(parseIdentityProviderSecrets("oidc", { v: 1, kind: "oidc", clientSecret: "secret" })).toEqual({
            ok: true,
            value: { v: 1, kind: "oidc", clientSecret: "secret" },
        });
        expect(parseIdentityProviderSecrets("oidc", { v: 1, kind: "oidc", clientSecret: "secret", extra: true })).toEqual({
            ok: false,
            code: "provider_secret_unreadable",
        });
        expect(parseIdentityProviderSecrets("workos_sso", null)).toEqual({ ok: true, value: null });
    });

    it("keeps WorkOS namespace identity exact and pairs current test evidence atomically", () => {
        const documents = parseTeamIdentityConnectionDocuments({
            providerKind: "workos_sso",
            externalReference: {
                v: 1,
                kind: "workos_sso",
                organizationId: "org_ExactCase",
                connectionId: null,
            },
            settings: { v: 1, kind: "workos_sso" },
            lastObservation: {
                v: 1,
                kind: "workos_sso",
                presentation: {
                    displayName: "Acme SSO",
                    strategy: "SAML",
                    status: "active",
                    lastCheckedAt: "2026-09-06T00:00:00.000Z",
                },
                successfulTest: {
                    runtimeFingerprint: "fingerprint",
                },
            },
            lastSuccessfulTestAt: new Date("2026-09-06T00:01:00.000Z"),
        });
        expect(documents.ok).toBe(true);
        if (!documents.ok) return;
        expect(documents.value.externalReference).toMatchObject({
            kind: "workos_sso",
            organizationId: "org_ExactCase",
        });
        expect(documents.value.successfulTest).toEqual({
            at: new Date("2026-09-06T00:01:00.000Z"),
            runtimeFingerprint: "fingerprint",
        });
    });

    it("rejects incomplete or kind-mismatched connection documents", () => {
        expect(parseTeamIdentityConnectionDocuments({
            providerKind: "workos_sso",
            externalReference: { v: 1, kind: "workos_sso", organizationId: "org_1", connectionId: null },
            settings: { v: 1, kind: "oidc", allowedUsers: [], allowedEmailDomains: [], groupsAny: [], groupsAll: [] },
            lastObservation: null,
            lastSuccessfulTestAt: null,
        })).toEqual({ ok: false, code: "identity_connection_document_unreadable" });

        expect(parseTeamIdentityConnectionDocuments({
            providerKind: "workos_sso",
            externalReference: { v: 1, kind: "workos_sso", organizationId: "org_1", connectionId: null },
            settings: { v: 1, kind: "workos_sso" },
            lastObservation: null,
            lastSuccessfulTestAt: new Date(),
        })).toEqual({ ok: false, code: "identity_connection_document_unreadable" });
    });
});
