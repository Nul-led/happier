import { describe, expect, it } from 'vitest';

import {
  ManagedGitHubAppCreateInputV1Schema,
  ManagedGitHubAppErrorCodeV1Schema,
  ManagedGitHubAppInstallationV1Schema,
  ManagedGitHubAppTeamConsumerV1Schema,
  ManagedGitHubAppManifestSetupStartOutputV1Schema,
} from './githubApps.js';

describe('ManagedGitHubAppManifestSetupStartOutputV1Schema', () => {
  it('exposes one cross-platform browser URL without leaking form fields to clients', () => {
    expect(ManagedGitHubAppManifestSetupStartOutputV1Schema.parse({
      authorizeUrl: 'https://home.example.test/v1/identity/github-apps/manifest-setup/submit?handle=opaque',
    })).toEqual({
      authorizeUrl: 'https://home.example.test/v1/identity/github-apps/manifest-setup/submit?handle=opaque',
    });
    expect(ManagedGitHubAppManifestSetupStartOutputV1Schema.safeParse({
      submitUrl: 'https://github.com/settings/apps/new',
      manifest: '{}',
    }).success).toBe(false);
  });
});

describe('ManagedGitHubAppErrorCodeV1Schema', () => {
  it('publishes a typed missing-permission verification failure', () => {
    expect(ManagedGitHubAppErrorCodeV1Schema.parse('github_permission_missing'))
      .toBe('github_permission_missing');
  });
});

describe('managed GitHub App persisted text bounds', () => {
  it('accepts the portable limits and rejects larger registration fields', () => {
    const input = {
      owner: { kind: 'home' as const },
      githubHost: 'https://github.enterprise.example',
      githubAppId: '44',
      githubClientId: 'c'.repeat(256),
      githubAppSlug: 's'.repeat(256),
      githubOwnerLogin: 'o'.repeat(256),
      secrets: { privateKey: 'private-key' },
    };
    expect(ManagedGitHubAppCreateInputV1Schema.safeParse(input).success).toBe(true);
    expect(ManagedGitHubAppCreateInputV1Schema.safeParse({
      ...input,
      githubClientId: 'c'.repeat(257),
    }).success).toBe(false);
    expect(ManagedGitHubAppCreateInputV1Schema.safeParse({
      ...input,
      githubHost: `https://${'a'.repeat(501)}.test`,
    }).success).toBe(false);
  });

  it('bounds externally observed organization login projection', () => {
    const installation = {
      id: 'installation', registrationId: 'registration', githubInstallationId: '1',
      githubOrganizationId: '2', githubOrganizationLogin: 'o'.repeat(256),
      repositorySelection: 'all', revision: 1, state: 'verified',
      verifiedPermissions: {}, verifiedEvents: [], suspendedAt: null, lastVerifiedAt: null,
      teamConsumers: [],
    } as const;
    expect(ManagedGitHubAppInstallationV1Schema.safeParse(installation).success).toBe(true);
    expect(ManagedGitHubAppInstallationV1Schema.safeParse({
      ...installation,
      githubOrganizationLogin: 'o'.repeat(257),
    }).success).toBe(false);
  });

  it('keeps identity and directory Team bindings as distinct exact facets', () => {
    const team = { id: 'team-1', name: 'Acme' };
    expect(ManagedGitHubAppTeamConsumerV1Schema.parse({
      team,
      binding: {
        kind: 'identity_connection', id: 'connection-1',
        providerInstanceId: 'provider-1', enabled: true,
      },
    }).binding.kind).toBe('identity_connection');
    expect(ManagedGitHubAppTeamConsumerV1Schema.parse({
      team,
      binding: { kind: 'directory_source', id: 'source-1', state: 'active' },
    }).binding.kind).toBe('directory_source');
  });
});
