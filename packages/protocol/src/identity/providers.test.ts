import { describe, expect, it } from "vitest";

import {
  ManagedIdentityProviderTeamConsumerV1Schema,
  ManagedIdentityProviderCreateInputV1Schema,
  ManagedIdentityProviderV1Schema,
  ManagedIdentityProviderUpdateInputV1Schema,
  ManagedIdentityProviderOwnerV1Schema,
  ManagedOidcProviderConfigV1Schema,
} from "./providers";

describe("managed identity provider owner protocol", () => {
  it("keeps omitted legacy inputs Home-owned and accepts an exact Team owner", () => {
    expect(ManagedIdentityProviderOwnerV1Schema.parse({ kind: "team", teamId: "team_exact" }))
      .toEqual({ kind: "team", teamId: "team_exact" });

    const provider = {
      displayName: "Acme OIDC",
      config: {
        v: 1,
        kind: "oidc",
        issuer: "https://id.example.test",
        clientId: "client",
        scopes: "openid profile email",
        httpTimeoutSeconds: 30,
        claims: { login: "sub", email: "email", groups: "groups" },
        allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
        fetchUserInfo: false,
        storeRefreshToken: false,
        ui: { buttonColor: null, iconHint: "oidc" },
      },
      clientSecret: "secret",
    } as const;
    expect(ManagedIdentityProviderCreateInputV1Schema.parse(provider).owner)
      .toEqual({ kind: "home" });
    expect(ManagedIdentityProviderCreateInputV1Schema.parse(provider).config.clientAuthenticationMethod)
      .toBe("client_secret_post");
    expect(ManagedIdentityProviderCreateInputV1Schema.parse({
      ...provider,
      owner: { kind: "team", teamId: "team_exact" },
    }).owner).toEqual({ kind: "team", teamId: "team_exact" });
  });

  it("defaults client authentication only while ingesting a create request", () => {
    const config = {
      v: 1,
      kind: "oidc",
      issuer: "https://id.example.test",
      clientId: "client",
      scopes: "openid profile email",
      httpTimeoutSeconds: 30,
      claims: { login: "sub", email: "email", groups: "groups" },
      allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
      fetchUserInfo: false,
      storeRefreshToken: false,
      ui: { buttonColor: null, iconHint: "oidc" },
    } as const;

    expect(ManagedOidcProviderConfigV1Schema.safeParse(config).success).toBe(false);
    expect(ManagedIdentityProviderUpdateInputV1Schema.safeParse({
      id: "provider-1",
      expectedRevision: 1,
      config,
    }).success).toBe(false);
    expect(ManagedIdentityProviderCreateInputV1Schema.parse({
      displayName: "Acme OIDC",
      config,
      clientSecret: "secret",
    }).config.clientAuthenticationMethod).toBe("client_secret_post");
  });

  it("bounds persisted provider display names to the shared label contract", () => {
    const provider = {
      displayName: "x".repeat(256),
      config: {
        v: 1, kind: "oidc", issuer: "https://id.example.test", clientId: "client",
        scopes: "openid", httpTimeoutSeconds: 30,
        claims: { login: "sub", email: "email", groups: "groups" },
        allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
        fetchUserInfo: false, storeRefreshToken: false,
        ui: { buttonColor: null, iconHint: "oidc" },
      },
      clientSecret: "secret",
    } as const;
    expect(ManagedIdentityProviderCreateInputV1Schema.safeParse(provider).success).toBe(true);
    expect(ManagedIdentityProviderCreateInputV1Schema.safeParse({
      ...provider,
      displayName: "x".repeat(257),
    }).success).toBe(false);
  });

  it("projects installation-backed GitHub identity consumers without accepting OIDC-only fields", () => {
    const githubProvider = {
      v: 1,
      owner: { kind: "home" },
      id: "github-provider-1",
      kind: "github_app_identity",
      displayName: "Acme GitHub",
      enabled: false,
      firstEnabledAt: null,
      securityRevision: 1,
      revision: 1,
      config: { v: 1, kind: "github_app_identity" },
      githubAppInstallationId: "installation-1",
      lastSuccessfulTest: null,
      createdByAccountId: "account-1",
      createdAt: 1,
      updatedAt: 1,
      teamConsumers: [{
        team: { id: "team-1", name: "Acme" },
        binding: { kind: "identity_connection", id: "connection-1", enabled: true },
      }],
    } as const;

    expect(ManagedIdentityProviderV1Schema.parse(githubProvider)).toEqual(githubProvider);
    expect(ManagedIdentityProviderV1Schema.safeParse({
      ...githubProvider,
      secret: { configured: true },
    }).success).toBe(false);
  });

  it("projects only the safe Team presentation and exact identity binding", () => {
    expect(ManagedIdentityProviderTeamConsumerV1Schema.parse({
      team: { id: "team-1", name: "Acme" },
      binding: { kind: "identity_connection", id: "connection-1", enabled: false },
    })).toEqual({
      team: { id: "team-1", name: "Acme" },
      binding: { kind: "identity_connection", id: "connection-1", enabled: false },
    });
    expect(ManagedIdentityProviderTeamConsumerV1Schema.safeParse({
      team: { id: "team-1", name: "Acme", policy: {} },
      binding: { kind: "identity_connection", id: "connection-1", enabled: true },
    }).success).toBe(false);
  });
});
