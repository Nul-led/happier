import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredCredentials } from '@/persistence';

const mocks = vi.hoisted(() => ({
  bootstrapAccountSettingsContext: vi.fn(),
}));

vi.mock('@/settings/accountSettings/bootstrapAccountSettingsContext', () => ({
  bootstrapAccountSettingsContext: mocks.bootstrapAccountSettingsContext,
}));
vi.mock('@/agent/catalog/registry', () => ({
  resolveCatalogAgentConnectedAccountServiceIds: (agentId: string) => agentId === 'claude'
    ? ['happier.agent.claude/anthropic', 'happier.agent.claude/claude-subscription']
    : agentId === 'codex'
      ? ['happier.agent.codex/openai-codex']
      : [],
}));
import {
  createSpawnConnectedServicesTeamResourceCatalogResolver,
  resolveSessionSpawnConnectedServicesDefaultsPayload,
  resolveSpawnConnectedServicesDefaultDisposition,
  resolveSpawnConnectedServicesDefaults,
} from './spawnConnectedServicesDefaults';

describe('resolveSpawnConnectedServicesDefaults', () => {
  beforeEach(() => {
    mocks.bootstrapAccountSettingsContext.mockReset();
  });

  it('reads every recipient-catalog continuation before resolving a Team default', async () => {
    const resource = {
      id: 'resource-page-two', teamId: 'team-a', displayName: 'Page two', resourceRevision: 1,
      readiness: { kind: 'available' as const }, recoveryAction: null,
      mayBroker: true, mayReceiveDirect: false, directMaterialState: 'never_delivered' as const,
      sessionUsePolicy: 'personal_allowed' as const, providerModels: [],
      connectedServiceSelections: [{ source: 'team_resource' as const, resourceId: 'resource-page-two', deliveryMode: 'brokered' as const }],
      sourcePresentation: {
        kind: 'connected_service' as const,
        service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' },
      },
    };
    const homeDomainAction = vi.fn()
      .mockResolvedValueOnce({ resources: [], nextCursor: 'recipient-page-2' })
      .mockResolvedValueOnce({ resources: [resource], nextCursor: null });

    await expect(createSpawnConnectedServicesTeamResourceCatalogResolver({
      homeDomainAction, serverId: 'home-a', accountId: 'account-a',
    })({ teamIds: ['team-a'] })).resolves.toEqual({
      serverId: 'home-a', accountId: 'account-a', resources: [resource],
    });
    expect(homeDomainAction).toHaveBeenNthCalledWith(2, {
      actionId: 'teams.credentials.entitled.list',
      input: { teamId: 'team-a', cursor: 'recipient-page-2' },
      context: { surface: 'cli', serverId: 'home-a' },
    });
  });

  it('resolves connected-service defaults from plain account Settings with token-only credentials', async () => {
    const credentials = {
      token: 'token-only',
      encryption: null,
    } satisfies StoredCredentials;
    mocks.bootstrapAccountSettingsContext.mockResolvedValue({
      settings: {
        connectedServicesDefaultAuthByAgentIdV1: {
          v: 1,
          bindingsByAgentId: {
            codex: {
              v: 1,
              bindingsByServiceId: {
                'openai-codex': {
                  source: 'connected',
                  selection: 'profile',
                  profileId: 'primary',
                },
              },
            },
          },
        },
      },
    });

    await expect(resolveSessionSpawnConnectedServicesDefaultsPayload({
      agentId: 'codex',
      credentials,
    })).resolves.toMatchObject({
      connectedServices: {
        bindingsByServiceId: {
          'happier.agent.codex/openai-codex': {
            source: 'connected',
            selection: 'profile',
            profileId: 'primary',
          },
        },
      },
      connectedServicesUpdatedAt: expect.any(Number),
    });
    expect(mocks.bootstrapAccountSettingsContext).toHaveBeenCalledWith({
      credentials,
      mode: 'blocking',
      deps: { applySideEffects: expect.any(Function) },
    });
  });

  it('preserves an exact connected group selection while availability is deferred to the daemon', () => {
    expect(resolveSpawnConnectedServicesDefaults({
      agentId: 'claude',
      accountSettings: {
        connectedServicesDefaultAuthByAgentIdV1: {
          v: 1,
          bindingsByAgentId: {
            claude: {
              v: 1,
              bindingsByServiceId: {
                'claude-subscription': {
                  source: 'connected',
                  selection: 'group',
                  groupId: 'team',
                },
              },
            },
          },
        },
      },
    })).toEqual({
      v: 2,
      bindingsByServiceId: {
        'happier.agent.claude/claude-subscription': {
          source: 'connected',
          selection: 'group',
          groupId: 'team',
        },
        'happier.agent.claude/anthropic': { source: 'native' },
      },
    });
  });

  it('preserves protocol-tolerant native fallback for a malformed persisted default blob', () => {
    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex',
      accountSettings: {},
    })).toEqual({ kind: 'native' });
    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex',
      accountSettings: {
        connectedServicesDefaultAuthByAgentIdV1: { v: 999 },
      },
    })).toEqual({ kind: 'native' });
  });

  it('fails typed instead of falling back to native for a Team resource default without a current catalog', () => {
    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex',
      accountSettings: {
        connectedServicesDefaultAuthByAgentIdV1: {
          v: 1,
          bindingsByAgentId: {
            codex: {
              v: 2,
              bindingsByServiceId: {
                'happier.agent.codex/openai-codex': {
                  source: 'team_resource',
                  serverId: 'home-a',
                  accountId: 'recipient-account',
                  teamId: 'team-a',
                  resourceId: 'resource-a',
                  expectedResourceRevision: 7,
                  deliveryMode: 'brokered',
                },
              },
            },
          },
        },
      },
    })).toEqual({
      kind: 'unavailable',
      reason: 'connected_services_team_default_requires_current_resource',
    });
  });

  it('resolves an exact fresh Team resource default through the current recipient catalog', () => {
    const settings = {
      connectedServicesDefaultAuthByAgentIdV1: {
        v: 1,
        bindingsByAgentId: {
          codex: {
            v: 2,
            bindingsByServiceId: {
              'happier.agent.codex/openai-codex': {
                source: 'team_resource', serverId: 'home-a', accountId: 'recipient-account',
                teamId: 'team-a', resourceId: 'resource-a', expectedResourceRevision: 7,
                deliveryMode: 'brokered',
              },
            },
          },
        },
      },
    };
    const catalog = {
      serverId: 'home-a',
      accountId: 'recipient-account',
      resources: [{
        id: 'resource-a', teamId: 'team-a', displayName: 'Shared Codex account',
        resourceRevision: 7, readiness: { kind: 'available' as const }, recoveryAction: null,
        mayBroker: true, mayReceiveDirect: false, directMaterialState: 'never_delivered' as const,
        sessionUsePolicy: 'personal_allowed' as const, providerModels: [],
        connectedServiceSelections: [{
          source: 'team_resource' as const, resourceId: 'resource-a', deliveryMode: 'brokered' as const,
        }],
        sourcePresentation: {
          kind: 'connected_service' as const,
          service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' },
        },
      }],
    };

    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex', accountSettings: settings, teamCredentialResourceCatalog: catalog,
    })).toEqual({
      kind: 'connected',
      bindings: {
        v: 2,
        bindingsByServiceId: {
          'happier.agent.codex/openai-codex': {
            source: 'team_resource', resourceId: 'resource-a', deliveryMode: 'brokered',
          },
        },
      },
    });

    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex',
      accountSettings: settings,
      teamCredentialResourceCatalog: {
        ...catalog,
        resources: [{ ...catalog.resources[0]!, resourceRevision: 8 }],
      },
    })).toEqual({
      kind: 'unavailable',
      reason: 'connected_services_team_default_requires_current_resource',
    });

    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex',
      accountSettings: settings,
      teamCredentialResourceCatalog: {
        ...catalog,
        resources: [{ ...catalog.resources[0]!, readiness: { kind: 'policy_denied' as const } }],
      },
    })).toEqual({
      kind: 'unavailable',
      reason: 'connected_services_team_default_requires_current_resource',
    });
  });

  it('requires the exact disclosed member for a direct Team resource default', () => {
    const service = { pluginId: 'happier.agent.codex', localId: 'openai-codex' } as const;
    const disclosedMember = { service, accountId: 'source-account' } as const;
    const binding = {
      source: 'team_resource' as const,
      serverId: 'home-a',
      accountId: 'recipient-account',
      teamId: 'team-a',
      resourceId: 'resource-a',
      expectedResourceRevision: 7,
      deliveryMode: 'direct' as const,
      disclosedMember,
    };
    const accountSettings = {
      connectedServicesDefaultAuthByAgentIdV1: {
        v: 1,
        bindingsByAgentId: {
          codex: {
            v: 2,
            bindingsByServiceId: { 'happier.agent.codex/openai-codex': binding },
          },
        },
      },
    };
    const resource = {
      id: binding.resourceId,
      teamId: binding.teamId,
      displayName: 'Shared Codex account',
      resourceRevision: binding.expectedResourceRevision,
      readiness: { kind: 'available' as const },
      recoveryAction: null,
      mayBroker: false,
      mayReceiveDirect: true,
      directMaterialState: 'current' as const,
      sessionUsePolicy: 'personal_allowed' as const,
      providerModels: [],
      connectedServiceSelections: [{
        source: 'team_resource' as const,
        resourceId: binding.resourceId,
        deliveryMode: 'direct' as const,
        disclosedMember,
      }],
      sourcePresentation: { kind: 'connected_service' as const, service },
    };
    const catalog = {
      serverId: binding.serverId,
      accountId: binding.accountId,
      resources: [resource],
    };

    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex',
      accountSettings,
      teamCredentialResourceCatalog: catalog,
    })).toMatchObject({
      kind: 'connected',
      bindings: {
        bindingsByServiceId: {
          'happier.agent.codex/openai-codex': {
            source: 'team_resource',
            resourceId: 'resource-a',
            deliveryMode: 'direct',
            disclosedMember,
          },
        },
      },
    });

    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex',
      accountSettings,
      teamCredentialResourceCatalog: {
        ...catalog,
        resources: [{
          ...resource,
          connectedServiceSelections: [{
            ...resource.connectedServiceSelections[0]!,
            disclosedMember: { service, accountId: 'different-source-account' },
          }],
        }],
      },
    })).toEqual({
      kind: 'unavailable',
      reason: 'connected_services_team_default_requires_current_resource',
    });

    expect(resolveSpawnConnectedServicesDefaultDisposition({
      agentId: 'codex',
      accountSettings,
      teamCredentialResourceCatalog: {
        ...catalog,
        resources: [{
          ...resource,
          connectedServiceSelections: [{
            ...resource.connectedServiceSelections[0]!,
            disclosedMember: {
              accountId: disclosedMember.accountId,
              service: { ...service, localId: 'different-service' },
            },
          }],
        }],
      },
    })).toEqual({
      kind: 'unavailable',
      reason: 'connected_services_team_default_requires_current_resource',
    });
  });

});
