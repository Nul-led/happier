import { describe, expect, it } from "vitest";

import {
  TeamAdmissionModeApplicabilityV1Schema,
  TeamIdentityConnectionCreateInputV1Schema,
  TeamIdentityConnectionListResultV1Schema,
  TeamIdentityConnectionSettingsUpdateInputV1Schema,
  TeamIdentityConnectionRemovalPreflightV1Schema,
  TeamIdentityConnectionV1Schema,
  TeamIdentityErrorCodeV1Schema,
  TeamIdentityWorkosAdminPortalLinkCreateInputV1Schema,
  TeamIdentityWorkosReconcileResultV1Schema,
} from "./index.js";

describe("Team identity connection protocol", () => {
  const admissionModeApplicability = {
    v: 1,
    modes: {
      invite_only: { status: "available" },
      provisioned: { status: "unavailable", reason: "directory_source_required" },
      jit: { status: "unavailable", reason: "team_connection_required" },
    },
  } as const;
  const connection = {
    v: 1,
    id: "connection_exact",
    teamId: "team_exact",
    provider: { id: "provider_exact", kind: "workos_sso", displayName: "Acme SSO" },
    externalReference: {
      v: 1,
      kind: "workos_sso",
      organizationId: "org_exact",
      connectionId: "conn_exact",
    },
    settings: { v: 1, kind: "workos_sso" },
    enabled: true,
    firstEnabledAt: 1_000,
    revision: 3,
    state: "connected",
    allowedActions: [
      "teams.identity.connections.disable",
      "teams.identity.connections.test.start",
      "teams.identity.connections.remove",
      "teams.identity.workos.adminPortalLink.create",
      "teams.identity.workos.reconcile",
      "teams.identity.workos.connection.set",
    ],
    lastObservation: {
      v: 1,
      kind: "workos_sso",
      presentation: {
        displayName: "Okta",
        strategy: "SAML",
        status: "active",
        lastCheckedAt: 1_100,
      },
    },
    lastSuccessfulTest: {
      at: 1_200,
      runtimeFingerprint: "runtime_exact",
      current: true,
    },
    createdAt: 900,
    updatedAt: 1_200,
  } as const;

  it("accepts the bounded redacted WorkOS projection and rejects unknown fields", () => {
    expect(TeamIdentityConnectionV1Schema.parse(connection)).toEqual(connection);
    expect(TeamIdentityConnectionV1Schema.safeParse({ ...connection, secret: "no" }).success).toBe(false);
    expect(TeamIdentityConnectionV1Schema.safeParse({
      ...connection,
      lastSuccessfulTest: {
        ...connection.lastSuccessfulTest,
        connectionRevision: connection.revision,
      },
    }).success).toBe(false);
  });

  it("uses the structured selection outcome instead of a second ambiguous error code", () => {
    expect(TeamIdentityErrorCodeV1Schema.safeParse("workos_connection_ambiguous").success).toBe(false);
    expect(TeamIdentityWorkosReconcileResultV1Schema.safeParse({
      outcome: "selection_required",
      connection,
      candidates: [
        { connectionId: "conn_one", displayName: "One", strategy: "SAML", status: "active" },
        { connectionId: "conn_two", displayName: "Two", strategy: "SAML", status: "active" },
      ],
    }).success).toBe(true);
  });

  it("requires a deduplicated closed set of server-authorized user actions", () => {
    const allowedActions = [
      "teams.identity.connections.disable",
      "teams.identity.connections.test.start",
      "teams.identity.connections.remove",
      "teams.identity.workos.adminPortalLink.create",
      "teams.identity.workos.reconcile",
      "teams.identity.workos.connection.set",
    ] as const;
    const { allowedActions: _omitted, ...withoutAllowedActions } = connection;
    expect(TeamIdentityConnectionV1Schema.safeParse(withoutAllowedActions).success).toBe(false);
    expect(TeamIdentityConnectionV1Schema.parse({ ...connection, allowedActions }).allowedActions)
      .toEqual(allowedActions);
    expect(TeamIdentityConnectionV1Schema.safeParse({
      ...connection,
      allowedActions: [...allowedActions, "teams.identity.connections.test.consume"],
    }).success).toBe(false);
    expect(TeamIdentityConnectionV1Schema.safeParse({
      ...connection,
      allowedActions: [allowedActions[0], allowedActions[0]],
    }).success).toBe(false);
  });

  it("keeps connection removal impact bounded and exposes only closed blocker reasons", () => {
    expect(TeamIdentityConnectionRemovalPreflightV1Schema.parse({
      v: 1,
      canRemove: false,
      connection,
      impact: {
        linkedAccounts: 3,
        accountsRequiringAlternateLogin: 1,
        directorySources: 1,
        externalGroupBindings: 0,
        managedMemberships: 2,
      },
      blockers: ["account_would_lose_login", "directory_source_in_use"],
    })).toMatchObject({ canRemove: false, impact: { accountsRequiringAlternateLogin: 1 } });
    expect(TeamIdentityConnectionRemovalPreflightV1Schema.safeParse({
      v: 1,
      canRemove: false,
      connection,
      impact: {
        linkedAccounts: 3,
        accountsRequiringAlternateLogin: 1,
        directorySources: 1,
        externalGroupBindings: 0,
        managedMemberships: 2,
      },
      blockers: ["force_remove_anyway"],
    }).success).toBe(false);
  });

  it("requires kind-matching strict create documents", () => {
    const input = {
      v: 1,
      teamId: "team_exact",
      providerInstanceId: "provider_exact",
      externalReference: { v: 1, kind: "oidc" },
      settings: {
        v: 1,
        kind: "oidc",
        allowedUsers: [],
        allowedEmailDomains: [],
        groupsAny: [],
        groupsAll: [],
      },
    } as const;
    expect(TeamIdentityConnectionCreateInputV1Schema.safeParse(input).success).toBe(true);
    expect(TeamIdentityConnectionCreateInputV1Schema.safeParse({
      ...input,
      settings: { v: 1, kind: "workos_sso" },
    }).success).toBe(false);

    expect(TeamIdentityConnectionCreateInputV1Schema.safeParse({
      ...input,
      externalReference: {
        v: 1,
        kind: "workos_sso",
        organizationId: null,
        connectionId: null,
      },
      settings: { v: 1, kind: "workos_sso" },
    }).success).toBe(true);
  });

  it("projects closed server-owned eligible provider choices with no actionable target when unavailable", () => {
    const available = {
      v: 1,
      providerId: "provider_exact",
      providerKind: "oidc",
      owner: "home",
      displayName: "Shared OIDC",
      availability: {
        status: "available",
        setupChoice: {
          kind: "use_existing",
          providerInstanceId: "provider_exact",
          connectionDraft: {
            externalReference: { v: 1, kind: "oidc" },
            settings: {
              v: 1,
              kind: "oidc",
              allowedUsers: [],
              allowedEmailDomains: [],
              groupsAny: [],
              groupsAll: [],
            },
          },
        },
      },
    } as const;
    const unavailable = {
      v: 1,
      providerId: null,
      providerKind: "workos_sso",
      owner: "team",
      displayName: null,
      availability: { status: "unavailable", code: "workos_platform_unavailable" },
    } as const;
    expect(TeamIdentityConnectionListResultV1Schema.parse({
      items: [],
      eligibleProviders: [available, unavailable],
      admissionModeApplicability,
      memberSignInUrl: "https://app.example.test/teams/team_exact/sign-in?target=home",
    })).toEqual({
      items: [],
      eligibleProviders: [available, unavailable],
      admissionModeApplicability,
      memberSignInUrl: "https://app.example.test/teams/team_exact/sign-in?target=home",
    });
    // A Home with no published application origin renders no link at all, and
    // says so rather than omitting the fact and letting a client invent one.
    expect(TeamIdentityConnectionListResultV1Schema.safeParse({
      items: [], eligibleProviders: [], admissionModeApplicability, memberSignInUrl: null,
    }).success).toBe(true);
    expect(TeamIdentityConnectionListResultV1Schema.safeParse({
      items: [], eligibleProviders: [], admissionModeApplicability,
    }).success).toBe(false);
    expect(TeamIdentityConnectionListResultV1Schema.safeParse({
      items: [],
      memberSignInUrl: null,
      admissionModeApplicability,
      eligibleProviders: [{
        ...unavailable,
        availability: {
          ...unavailable.availability,
          setupChoice: { kind: "create_managed" },
        },
      }],
    }).success).toBe(false);
    expect(TeamIdentityConnectionListResultV1Schema.safeParse({
      items: [],
      memberSignInUrl: null,
      admissionModeApplicability,
      eligibleProviders: [{
        ...available,
        availability: {
          status: "available",
          setupChoice: { ...available.availability.setupChoice, providerInstanceId: "different" },
        },
      }],
    }).success).toBe(false);
    expect(TeamIdentityConnectionListResultV1Schema.safeParse({
      items: [],
      memberSignInUrl: null,
      admissionModeApplicability,
      eligibleProviders: [{
        v: 1,
        providerId: null,
        providerKind: "oidc",
        owner: "team",
        displayName: null,
        availability: {
          status: "available",
          setupChoice: {
            kind: "create_managed",
            actionId: "teams.identity.workos.connection.create",
          },
        },
      }],
    }).success).toBe(false);
  });

  it("preserves complete connection and eligible-provider projections beyond 100 rows", () => {
    const eligibleProvider = {
      v: 1,
      providerId: "provider_exact",
      providerKind: "oidc",
      owner: "home",
      displayName: "Shared OIDC",
      availability: {
        status: "available",
        setupChoice: {
          kind: "use_existing",
          providerInstanceId: "provider_exact",
          connectionDraft: {
            externalReference: { v: 1, kind: "oidc" },
            settings: {
              v: 1,
              kind: "oidc",
              allowedUsers: [],
              allowedEmailDomains: [],
              groupsAny: [],
              groupsAll: [],
            },
          },
        },
      },
    } as const;
    const items = Array.from({ length: 101 }, (_, index) => ({
      ...connection,
      id: `connection_${index}`,
    }));
    const eligibleProviders = Array.from({ length: 101 }, (_, index) => ({
      ...eligibleProvider,
      providerId: `provider_${index}`,
      availability: {
        ...eligibleProvider.availability,
        setupChoice: {
          ...eligibleProvider.availability.setupChoice,
          providerInstanceId: `provider_${index}`,
        },
      },
    }));

    expect(TeamIdentityConnectionListResultV1Schema.parse({
      items,
      eligibleProviders,
      admissionModeApplicability,
      memberSignInUrl: null,
    })).toEqual({ items, eligibleProviders, admissionModeApplicability, memberSignInUrl: null });
    expect(TeamIdentityConnectionListResultV1Schema.safeParse({
      items: [...items.slice(0, -1), { ...connection, id: "invalid", secret: "not-allowed" }],
      eligibleProviders,
      admissionModeApplicability,
      memberSignInUrl: null,
    }).success).toBe(false);
  });

  it("keeps admission applicability closed, complete, and mode-specific", () => {
    expect(TeamAdmissionModeApplicabilityV1Schema.parse(admissionModeApplicability))
      .toEqual(admissionModeApplicability);
    expect(TeamAdmissionModeApplicabilityV1Schema.safeParse({
      ...admissionModeApplicability,
      modes: { ...admissionModeApplicability.modes, jit: { status: "available", providerId: "secret" } },
    }).success).toBe(false);
    expect(TeamAdmissionModeApplicabilityV1Schema.safeParse({
      ...admissionModeApplicability,
      modes: { ...admissionModeApplicability.modes, provisioned: { status: "unavailable", reason: "team_connection_required" } },
    }).success).toBe(false);
    expect(TeamAdmissionModeApplicabilityV1Schema.safeParse({
      ...admissionModeApplicability,
      modes: { invite_only: { status: "available" }, provisioned: { status: "available" } },
    }).success).toBe(false);
  });

  it("accepts an exact settings-only connection update", () => {
    expect(TeamIdentityConnectionSettingsUpdateInputV1Schema.parse({
      v: 1,
      teamId: "team_exact",
      connectionId: "connection_exact",
      expectedRevision: 2,
      settings: {
        v: 1,
        kind: "oidc",
        allowedUsers: ["alice"],
        allowedEmailDomains: ["example.test"],
        groupsAny: ["engineering"],
        groupsAll: [],
      },
    }).settings.groupsAny).toEqual(["engineering"]);
    expect(TeamIdentityConnectionSettingsUpdateInputV1Schema.parse({
      v: 1,
      teamId: "team_exact",
      connectionId: "connection_exact",
      expectedRevision: 2,
      settings: {
        v: 1,
        kind: "github_app_identity",
        organizationLogin: "acme",
      },
    }).settings.kind).toBe("github_app_identity");
  });

  it("keeps WorkOS portal intent closed without truncating reconcile candidates", () => {
    expect(TeamIdentityWorkosAdminPortalLinkCreateInputV1Schema.parse({
      v: 1,
      teamId: "team_exact",
      connectionId: "connection_exact",
      intent: "sso",
    })).toEqual({ v: 1, teamId: "team_exact", connectionId: "connection_exact", intent: "sso" });
    expect(TeamIdentityWorkosAdminPortalLinkCreateInputV1Schema.safeParse({
      v: 1,
      teamId: "team_exact",
      connectionId: "connection_exact",
      intent: "sso_and_dsync",
    }).success).toBe(false);
    expect(TeamIdentityWorkosReconcileResultV1Schema.safeParse({
      outcome: "selection_required",
      connection,
      candidates: Array.from({ length: 101 }, (_, index) => ({
        connectionId: `connection_${index}`,
        displayName: "Okta",
        strategy: "SAML",
        status: "active",
      })),
    }).success).toBe(true);
  });
});
