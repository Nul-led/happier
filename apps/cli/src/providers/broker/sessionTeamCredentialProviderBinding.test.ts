import { describe, expect, it, vi } from 'vitest';
import type { PluginApi } from '@happier-dev/plugin-sdk';
import { TeamCredentialDirectMaterialPayloadV1Schema } from '@happier-dev/protocol/teams';
import type { PluginRuntimeRegistryLease } from '@/plugins/runtime/reload/controller';
import type { ResolvedExecutablePluginRuntimeRegistry } from '@/plugins/runtime/resolveExecutablePluginRuntimeRegistry';

import {
  openExactSessionTeamCredentialProviderBinding,
  openSessionTeamCredentialProviderBinding,
  type SessionTeamCredentialDirectOpen,
} from './sessionTeamCredentialProviderBinding';

type ProviderAdapter = NonNullable<NonNullable<Parameters<PluginApi['agents']['register']>[2]>['providerBinding']>;
type ExactOpenBroker = NonNullable<Parameters<typeof openExactSessionTeamCredentialProviderBinding>[0]['openBroker']>;

const prepareSpawnEnv: ProviderAdapter['prepare'] = () => ({ v: 1, materialization: 'spawnEnv' });
const materializeEmptySpawnEnv: ProviderAdapter['materialize'] = () => ({ v: 1, kind: 'spawnEnv', env: [] });
const materializeBrokerAuthoritySpawnEnv: ProviderAdapter['materialize'] = (input) => ({
  v: 1,
  kind: 'spawnEnv',
  env: [{
    name: 'BROKER_AUTHORITY',
    value: input.credential.kind === 'apiKey' ? input.credential.value : null,
    source: 'provider',
  }],
});
const materializeNullBrokerAuthoritySpawnEnv: ProviderAdapter['materialize'] = () => ({
  v: 1,
  kind: 'spawnEnv',
  env: [{ name: 'BROKER_AUTHORITY', value: null, source: 'provider' }],
});

function lease(adapter: ProviderAdapter): PluginRuntimeRegistryLease {
  const registry = {
    contributes: {
      agentDefinitionsById: new Map([['codex', { definition: {
        id: 'codex', kindVersion: 1,
        providerRequirements: {
          acceptsProtocols: ['openai-responses'], required: { streaming: true, toolRoundTrips: true },
          credentialSupport: { supportsNoAuth: false, apiKeyTransports: [{
            protocol: 'openai-responses',
            destination: { kind: 'httpHeader', names: 'anyValidated', formats: ['bearer'] },
          }] },
          authIsolation: { suppressConnectedServiceIds: [], ownedEnvKeys: ['BROKER_AUTHORITY'] },
          materialization: 'spawnEnv', applyPolicy: 'restart_session', supportsFreeformModelIds: false,
        },
      }, identity: { pluginId: 'happier.agent.codex', localId: 'codex' } }]]),
    },
    agentRuntimesByAgentId: new Map([['codex', {
      pluginId: 'happier.agent.codex', pluginVersion: '1', agentId: 'codex', generation: '1',
      providerBinding: adapter, isCurrent: () => true,
      retirementSignal: new AbortController().signal,
      createRuntime: vi.fn(),
    }]]),
  } as unknown as ResolvedExecutablePluginRuntimeRegistry;
  return { registry, source: 'active', durableRevision: 1, release: async () => undefined };
}

const row = {
  selection: {
    kind: 'team_credential_provider_model' as const,
    resourceId: 'resource-1', teamId: 'team-1', expectedResourceRevision: 3,
    deliveryMode: 'brokered' as const,
    agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
  },
  descriptor: { id: 'gpt-5', name: 'GPT-5 Dynamic', description: 'Source-owned descriptor', contextWindowTokens: 131_072 },
  application: {
    agentTargetKey: 'agent:happier.agent.codex/codex',
    implementationIdentity: { pluginId: 'happier.provider.clipro', localId: 'clipro' },
    endpointTemplateId: 'responses', protocol: 'openai-responses',
  },
  sourceRevision: 'catalog:3', availability: 'available' as const,
} as const;

const authority = {
  payload: {
    v: 1 as const, grantId: 'grant-1', aud: 'happier-provider-broker-route-v1' as const,
    issuedAt: 1, expiresAt: 2, teamId: 'team-1', resourceId: 'resource-1',
    expectedResourceRevision: 3, modelId: 'gpt-5', sourceRevision: 'catalog:3',
    initiator: { accountId: 'account-1', machineId: 'worker-1', endpointId: 'a'.repeat(64) },
    target: { custodianAccountId: 'account-2', machineId: 'broker-1', endpointId: 'b'.repeat(64) },
    consumer: { kind: 'session' as const, sessionId: 'session-1' },
    application: row.application,
  },
  signature: { alg: 'Ed25519' as const, keyId: 'home', valueBase64Url: 'A'.repeat(86) },
};

describe('Session Team credential Provider binding', () => {
  it.each([
    {
      name: 'Session',
      consumerInput: { sessionId: 'session-1' },
      expectedConsumer: { kind: 'session' as const, sessionId: 'session-1' },
    },
    {
      name: 'detached Execution Run',
      consumerInput: { consumer: { kind: 'execution_run' as const, executionRunId: 'run-1' } },
      expectedConsumer: { kind: 'execution_run' as const, executionRunId: 'run-1' },
    },
  ])('opens exact direct material for a $name and feeds it through the canonical Agent Provider materializer', async ({
    consumerInput,
    expectedConsumer,
  }) => {
    const directRow = {
      ...row,
      selection: { ...row.selection, deliveryMode: 'direct' as const },
      direct: {
        sourceMemberKey: 'provider:source-member',
        sourceVersion: 'source-version:7',
      },
    };
    const openBroker = vi.fn();
    const openTunnel = vi.fn();
    const openTeamDirect = vi.fn<SessionTeamCredentialDirectOpen>(async () => ({
      ok: true as const,
      payload: TeamCredentialDirectMaterialPayloadV1Schema.parse({
        v: 1 as const,
        domain: 'happier.team-credential-direct-material' as const,
        homeServerIdentityId: 'home-1', teamId: 'team-1', resourceId: 'resource-1',
        resourceRevision: 3,
        recipientAccountId: 'recipient-1',
        sourceMember: {
          kind: 'provider_credential_slot' as const,
          connectionId: 'pc_source', credentialSlotId: 'apiKey',
        },
        sourceVersion: 'source-version:7',
        material: {
        kind: 'provider_api_key' as const,
        value: 'recipient-secret',
        runtimeBinding: {
          provider: { identity: row.application.implementationIdentity, definitionRevision: 1 },
          endpoint: {
            endpointTemplateId: 'responses',
            normalizedUrl: 'https://api.example.test/v1',
            protocol: 'openai-responses' as const,
            publicHeaders: { 'X-Public-Route': 'stable' },
          },
          credentialTransport: {
            id: 'api-key', protocols: ['openai-responses' as const], uses: ['runtime' as const],
            destination: { kind: 'httpHeader' as const, name: 'Authorization', format: 'bearer' as const },
          },
        },
        },
      }),
    }));
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeBrokerAuthoritySpawnEnv),
    };

    const opened = await openSessionTeamCredentialProviderBinding({
      ...consumerInput, machineId: 'worker-1', agentId: 'codex',
      agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
      binding: { v: 1, slot: { kind: 'provider_model' }, resourceId: 'resource-1', expectedResourceRevision: 3, deliveryMode: 'direct' },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-direct-test',
      signal: new AbortController().signal,
      readCatalog: async () => [directRow], openBroker: openBroker as never, openTunnel: openTunnel as never,
      openTeamDirect,
    });

    expect(openTeamDirect).toHaveBeenCalledWith({
      teamId: 'team-1', resourceId: 'resource-1', expectedResourceRevision: 3,
      sourceMemberKey: 'provider:source-member', expectedSourceVersion: 'source-version:7',
      consumer: expectedConsumer,
    });
    expect(openBroker).not.toHaveBeenCalled();
    expect(openTunnel).not.toHaveBeenCalled();
    expect(adapter.materialize).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ kind: 'apiKey', value: 'recipient-secret' }),
      binding: expect.objectContaining({ endpoint: expect.objectContaining({
        normalizedUrl: 'https://api.example.test/v1',
      }) }),
    }));
    expect(adapter.prepare).toHaveBeenCalledWith(expect.objectContaining({
      bindingKey: 'team_resource:resource-1:revision:3:route:direct',
    }));
    expect(opened?.providerBinding.upstream.normalizedUrl).toBe('https://api.example.test/v1');
    expect(opened?.additionalRedactionValues).toContain('recipient-secret');
    await opened?.cleanup();
  });

  it.each([
    ['temporarily_unavailable', 'provider_endpoint_unavailable'],
    ['source_changed', 'provider_authorization_changed'],
    ['access_removed', 'provider_account_grant_stale'],
    ['unsupported_direct_source', 'provider_credential_transport_unavailable'],
    ['resource_corrupt', 'provider_materialization_failed'],
  ] as const)('surfaces Team direct %s through the stable Provider error code %s', async (reason, code) => {
    const directRow = {
      ...row,
      selection: { ...row.selection, deliveryMode: 'direct' as const },
      direct: {
        sourceMemberKey: 'provider:source-member',
        sourceVersion: 'source-version:7',
      },
    };
    const materialize = vi.fn();

    await expect(openSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
      binding: { v: 1, slot: { kind: 'provider_model' }, resourceId: 'resource-1', expectedResourceRevision: 3, deliveryMode: 'direct' },
      lease: lease({
        v: 1, adapterVersion: 1,
        prepare: vi.fn(prepareSpawnEnv),
        materialize,
      }),
      materializationBaseDir: '/tmp/happier-team-direct-test',
      signal: new AbortController().signal,
      readCatalog: async () => [directRow],
      openTeamDirect: async () => ({ ok: false, reason }),
    })).rejects.toMatchObject({ code });
    expect(materialize).not.toHaveBeenCalled();
  });

  it('preserves a Team authentication operation error through the Session Provider binding', async () => {
    const directRow = {
      ...row,
      selection: { ...row.selection, deliveryMode: 'direct' as const },
      direct: {
        sourceMemberKey: 'provider:source-member',
        sourceVersion: 'source-version:7',
      },
    };

    await expect(openSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
      binding: { v: 1, slot: { kind: 'provider_model' }, resourceId: 'resource-1', expectedResourceRevision: 3, deliveryMode: 'direct' },
      lease: lease({
        v: 1, adapterVersion: 1,
        prepare: vi.fn(prepareSpawnEnv),
        materialize: vi.fn(materializeEmptySpawnEnv),
      }),
      materializationBaseDir: '/tmp/happier-team-direct-test',
      signal: new AbortController().signal,
      readCatalog: async () => [directRow],
      openTeamDirect: async () => ({
        ok: false,
        operationError: { error: 'team_authentication_policy_unavailable' },
      }),
    })).rejects.toMatchObject({
      name: 'TeamCredentialDirectMaterialOperationError',
      code: 'team_authentication_policy_unavailable',
    });
  });

  it.each([
    { name: 'no consumer identity', sessionId: undefined, consumer: undefined },
    {
      name: 'conflicting Session identities',
      sessionId: 'session-1',
      consumer: { kind: 'session' as const, sessionId: 'session-2' },
    },
  ])('rejects $name before catalog or direct-material access', async ({ sessionId, consumer }) => {
    const readCatalog = vi.fn(async () => []);
    const openTeamDirect = vi.fn();

    await expect(openSessionTeamCredentialProviderBinding({
      ...(sessionId ? { sessionId } : {}),
      ...(consumer ? { consumer } : {}),
      machineId: 'worker-1', agentId: 'codex',
      agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
      binding: { v: 1, slot: { kind: 'provider_model' }, resourceId: 'resource-1', expectedResourceRevision: 3, deliveryMode: 'direct' },
      lease: lease({
        v: 1, adapterVersion: 1,
        prepare: vi.fn(prepareSpawnEnv),
        materialize: vi.fn(materializeEmptySpawnEnv),
      }),
      materializationBaseDir: '/tmp/happier-team-direct-test',
      signal: new AbortController().signal,
      readCatalog,
      openTeamDirect,
    })).rejects.toThrow('team_credential_provider_selection_not_current');
    expect(readCatalog).not.toHaveBeenCalled();
    expect(openTeamDirect).not.toHaveBeenCalled();
  });

  it('does not silently fail over a selected direct row when current material is absent', async () => {
    const openBroker = vi.fn();
    await expect(openSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
      binding: { v: 1, slot: { kind: 'provider_model' }, resourceId: 'resource-1', expectedResourceRevision: 3, deliveryMode: 'direct' },
      lease: lease({
        v: 1, adapterVersion: 1,
        prepare: vi.fn(prepareSpawnEnv),
        materialize: vi.fn(materializeEmptySpawnEnv),
      }),
      materializationBaseDir: '/tmp/happier-team-direct-test', signal: new AbortController().signal,
      readCatalog: async () => [{ ...row, selection: { ...row.selection, deliveryMode: 'direct' } }],
      openBroker: openBroker as never,
    })).rejects.toThrow('team_credential_direct_material_not_current');
    expect(openBroker).not.toHaveBeenCalled();
  });

  it('opens one exact broker/tunnel, revalidates current catalog, and closes Session custody once', async () => {
    const closeOrder: string[] = [];
    const retire = vi.fn(async () => { closeOrder.push('retire'); });
    const close = vi.fn(async () => undefined);
    const brokerOpened = { ok: true as const, authority,
      target: { custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64), endpointRevision: 1 } };
    const openBroker = vi.fn(async () => brokerOpened);
    const openTunnel = vi.fn(async () => ({
      localPort: 43123,
      localCapability: 'c'.repeat(64),
      observedPath: 'relay' as const,
      retire,
      close: vi.fn(async () => { closeOrder.push('close'); await close(); }),
    }));
    const directTwin = {
      ...row,
      selection: { ...row.selection, deliveryMode: 'direct' as const },
      direct: { sourceMemberKey: 'provider:source-member', sourceVersion: 'source-version:7' },
    };
    const readCatalog = vi.fn(async () => [directTwin, row]);
    const signal = new AbortController().signal;
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeBrokerAuthoritySpawnEnv),
    };

    const opened = await openSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
      binding: { v: 1, slot: { kind: 'provider_model' }, resourceId: 'resource-1', expectedResourceRevision: 3, deliveryMode: 'brokered' },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal, readCatalog, openBroker, openTunnel,
    });

    expect(readCatalog).toHaveBeenCalledTimes(2);
    expect(openBroker).toHaveBeenCalledOnce();
    expect(openTunnel).toHaveBeenCalledWith(expect.objectContaining({
      brokerOpen: brokerOpened,
      refreshBrokerOpen: expect.any(Function),
      signal,
    }));
    expect(adapter.prepare).toHaveBeenCalledWith(expect.objectContaining({
      bindingKey: 'team_resource:resource-1:revision:3:route:brokered',
    }));
    expect(opened?.providerBinding).toMatchObject({
      source: { kind: 'team_resource', resourceId: 'resource-1', resourceRevision: 3 },
      upstream: { normalizedUrl: 'http://127.0.0.1:43123/v1' },
    });
    // The Agent receives only its loopback endpoint and the tunnel's local
    // capability as its bearer. The Home-signed cross-Account authority stays
    // with the trusted transport owner and never enters Agent configuration.
    expect(adapter.materialize).toHaveBeenCalledWith(expect.objectContaining({
      credential: { kind: 'apiKey', transport: expect.anything(), value: 'c'.repeat(64) },
    }));
    expect(JSON.stringify(vi.mocked(adapter.materialize).mock.calls)).not.toContain(authority.signature.valueBase64Url);
    await opened?.cleanup();
    await opened?.cleanup();
    expect(retire).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(closeOrder).toEqual(['retire', 'close']);
  });

  it('does not revalidate a selected brokered binding against its available direct twin', async () => {
    const directTwin = {
      ...row,
      selection: { ...row.selection, deliveryMode: 'direct' as const },
      direct: { sourceMemberKey: 'provider:source-member', sourceVersion: 'source-version:7' },
    };
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeEmptySpawnEnv),
    };
    const readCatalog = vi.fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([directTwin]);

    await expect(openSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
      binding: { v: 1, slot: { kind: 'provider_model' }, resourceId: 'resource-1', expectedResourceRevision: 3, deliveryMode: 'brokered' },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal, readCatalog,
      openBroker: async () => ({ ok: true, authority,
        target: { custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64), endpointRevision: 1 } }),
      openTunnel: async () => ({ localPort: 43123, localCapability: 'c'.repeat(64), observedPath: 'direct', retire: async () => undefined, close: async () => undefined }),
    })).rejects.toThrow('team_credential_provider_selection_changed');
    expect(adapter.materialize).not.toHaveBeenCalled();
  });

  it('still closes native transport when the target retirement acknowledgement is lost', async () => {
    const order: string[] = [];
    const retire = vi.fn(async () => {
      order.push('retire-attempt');
      throw new Error('lost close acknowledgement');
    });
    const close = vi.fn(async () => { order.push('transport-close'); });
    const brokerOpened = {
      ok: true as const,
      authority,
      target: {
        custodianAccountId: 'account-2',
        brokerMachineId: 'broker-1',
        endpointId: 'b'.repeat(64),
        endpointRevision: 1,
      },
    };
    const adapter: ProviderAdapter = {
      v: 1,
      adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeBrokerAuthoritySpawnEnv),
    };
    const opened = await openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1',
      machineId: 'worker-1',
      agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId,
        brokerMachineId: 'broker-1',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: row.selection.agentTargetKey,
        modelId: row.selection.modelId,
        descriptor: row.descriptor,
        application: row.application,
        sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter),
      materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal,
      openBroker: async () => brokerOpened,
      openTunnel: async () => ({
        localPort: 43123,
        localCapability: 'c'.repeat(64),
        observedPath: 'relay',
        retire,
        close,
      }),
    });

    await expect(opened.cleanup()).rejects.toThrow('lost close acknowledgement');
    expect(order).toEqual(['retire-attempt', 'transport-close']);
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails currentness before Agent materialization and closes the carrier', async () => {
    const close = vi.fn(async () => undefined);
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeNullBrokerAuthoritySpawnEnv),
    };
    const readCatalog = vi.fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ ...row, sourceRevision: 'catalog:changed' }]);
    await expect(openSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      agentTargetKey: 'agent:happier.agent.codex/codex', modelId: 'gpt-5',
      binding: { v: 1, slot: { kind: 'provider_model' }, resourceId: 'resource-1', expectedResourceRevision: 3, deliveryMode: 'brokered' },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal, readCatalog,
      openBroker: async () => ({ ok: true, authority,
        target: { custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64), endpointRevision: 1 } }),
      openTunnel: async () => ({ localPort: 43123, localCapability: 'c'.repeat(64), observedPath: 'direct', retire: async () => undefined, close }),
    })).rejects.toThrow('selection_changed');
    expect(adapter.materialize).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('opens an already-authoritative exact selection without reading a catalog', async () => {
    const close = vi.fn(async () => undefined);
    const openBroker = vi.fn<ExactOpenBroker>(async () => ({ ok: true as const, authority,
      target: {
        custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64),
        endpointRevision: 1, placementKind: 'machine_pool' as const,
      } }));
    const refreshedOpen = vi.fn();
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeBrokerAuthoritySpawnEnv),
    };

    const opened = await openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId,
        brokerMachineId: 'broker-1',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: row.selection.agentTargetKey,
        modelId: row.selection.modelId,
        descriptor: row.descriptor,
        application: row.application,
        sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal,
      openBroker,
      openTunnel: async ({ refreshBrokerOpen }) => {
        refreshedOpen(await refreshBrokerOpen());
        return { localPort: 43123, localCapability: 'c'.repeat(64), observedPath: 'relay', retire: async () => undefined, close };
      },
    });

    expect(openBroker).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: 'resource-1',
      expectedResourceRevision: 3,
      modelId: 'gpt-5',
      sourceRevision: 'catalog:3',
      application: row.application,
    }), expect.any(AbortSignal));
    expect(openBroker).toHaveBeenCalledTimes(2);
    expect(openBroker.mock.calls[1]?.[0]).toMatchObject({
      resourceId: 'resource-1',
      refreshAuthority: authority,
    });
    expect(refreshedOpen).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(opened.providerBinding).toMatchObject({
      source: { kind: 'team_resource', resourceId: 'resource-1', resourceRevision: 3 },
      model: row.descriptor,
    });
    await opened.cleanup();
    expect(close).toHaveBeenCalledOnce();
  });

  it('binds an independently owned Execution Run to its exact broker authority', async () => {
    const close = vi.fn(async () => undefined);
    const runAuthority = {
      ...authority,
      payload: {
        ...authority.payload,
        consumer: { kind: 'execution_run' as const, executionRunId: 'run-1' },
        executionRunOccurrenceId: 'occurrence-1',
      },
    };
    const openBroker = vi.fn(async () => ({ ok: true as const, authority: runAuthority,
      target: { custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64), endpointRevision: 1 } }));
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeBrokerAuthoritySpawnEnv),
    };

    const opened = await openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', consumer: { kind: 'execution_run', executionRunId: 'run-1' },
      machineId: 'worker-1', agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId, brokerMachineId: 'broker-1',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: row.selection.agentTargetKey, modelId: row.selection.modelId,
        descriptor: row.descriptor, application: row.application, sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal, openBroker,
      openTunnel: async () => ({ localPort: 43123, localCapability: 'c'.repeat(64), observedPath: 'relay', retire: async () => undefined, close }),
    });

    expect(openBroker).toHaveBeenCalledWith(expect.objectContaining({
      consumer: { kind: 'execution_run', executionRunId: 'run-1' },
    }), expect.any(AbortSignal));
    await opened.cleanup();
    expect(close).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent Session cleanup and retains failed tunnel cleanup for retry', async () => {
    let settleClose!: (error?: Error) => void;
    let closeAttempt = 0;
    const close = vi.fn(async () => {
      closeAttempt += 1;
      if (closeAttempt === 1) {
        await new Promise<void>((resolve, reject) => {
          settleClose = (error) => error ? reject(error) : resolve();
        });
      }
    });
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeBrokerAuthoritySpawnEnv),
    };
    const opened = await openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId,
        brokerMachineId: 'broker-1',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: row.selection.agentTargetKey,
        modelId: row.selection.modelId,
        descriptor: row.descriptor,
        application: row.application,
        sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal,
      openBroker: async () => ({ ok: true, authority,
        target: { custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64), endpointRevision: 1 } }),
      openTunnel: async () => ({ localPort: 43123, localCapability: 'c'.repeat(64), observedPath: 'relay', retire: async () => undefined, close }),
    });

    const first = opened.cleanup();
    const concurrent = opened.cleanup();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    settleClose(new Error('native tunnel cleanup failed'));
    await expect(first).rejects.toThrow('native tunnel cleanup failed');
    await expect(concurrent).rejects.toThrow('native tunnel cleanup failed');

    await expect(opened.cleanup()).resolves.toBeUndefined();
    await expect(opened.cleanup()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('rejects a broker-open response that substituted the sealed broker Machine before opening a tunnel', async () => {
    const openTunnel = vi.fn();
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeEmptySpawnEnv),
    };

    await expect(openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId,
        brokerMachineId: 'sealed-broker',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: row.selection.agentTargetKey,
        modelId: row.selection.modelId,
        descriptor: row.descriptor,
        application: row.application,
        sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal,
      openBroker: async () => ({ ok: true, authority,
        target: { custodianAccountId: 'account-2', brokerMachineId: 'substituted-broker', endpointId: 'b'.repeat(64), endpointRevision: 1 } }),
      openTunnel: openTunnel as never,
    })).rejects.toThrow('team_credential_provider_broker_machine_changed');
    expect(openTunnel).not.toHaveBeenCalled();
    expect(adapter.prepare).not.toHaveBeenCalled();
  });

  it.each([
    ['resource', { resourceId: 'substituted-resource' }, 'team_credential_provider_selection_changed'],
    ['resource revision', { expectedResourceRevision: 4 }, 'team_credential_provider_selection_changed'],
    ['model', { modelId: 'substituted-model' }, 'team_credential_provider_selection_changed'],
    ['source revision', { sourceRevision: 'catalog:substituted' }, 'team_credential_provider_selection_changed'],
    ['Session', { consumer: { kind: 'session' as const, sessionId: 'substituted-session' } }, 'team_credential_provider_broker_open_changed'],
    ['worker Machine', { initiator: { ...authority.payload.initiator, machineId: 'substituted-worker' } }, 'team_credential_provider_broker_open_changed'],
    ['custodian Account', { target: { ...authority.payload.target, custodianAccountId: 'substituted-account' } }, 'team_credential_provider_broker_open_changed'],
    ['broker Endpoint', { target: { ...authority.payload.target, endpointId: 'd'.repeat(64) } }, 'team_credential_provider_broker_open_changed'],
    ['application', { application: { ...row.application, endpointTemplateId: 'substituted-endpoint' } }, 'team_credential_provider_selection_changed'],
  ])('rejects a signed broker-open witness that substituted the exact %s', async (_label, payloadPatch, reason) => {
    const openTunnel = vi.fn();
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeEmptySpawnEnv),
    };

    await expect(openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId,
        brokerMachineId: 'broker-1',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: row.selection.agentTargetKey,
        modelId: row.selection.modelId,
        descriptor: row.descriptor,
        application: row.application,
        sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal,
      openBroker: async () => ({
        ok: true,
        authority: { ...authority, payload: { ...authority.payload, ...payloadPatch } },
        target: { custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64), endpointRevision: 1 },
      }),
      openTunnel: openTunnel as never,
    })).rejects.toThrow(reason);
    expect(openTunnel).not.toHaveBeenCalled();
    expect(adapter.prepare).not.toHaveBeenCalled();
  });

  it('does not dial the exact carrier when cancellation arrives during broker open', async () => {
    const controller = new AbortController();
    const openTunnel = vi.fn();
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeEmptySpawnEnv),
    };

    await expect(openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId,
        brokerMachineId: 'broker-1',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: row.selection.agentTargetKey,
        modelId: row.selection.modelId,
        descriptor: row.descriptor,
        application: row.application,
        sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: controller.signal,
      openBroker: async () => {
        controller.abort(new Error('cancelled-after-broker-open'));
        return { ok: true, authority,
          target: { custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64), endpointRevision: 1 } };
      },
      openTunnel: openTunnel as never,
    })).rejects.toThrow('cancelled-after-broker-open');
    expect(openTunnel).not.toHaveBeenCalled();
    expect(adapter.prepare).not.toHaveBeenCalled();
  });

  it('rejects incoherent exact Agent/model selections before broker effects', async () => {
    const openBroker = vi.fn();
    const openTunnel = vi.fn();
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn(materializeEmptySpawnEnv),
    };

    await expect(openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId,
        brokerMachineId: 'broker-1',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: 'agent:happier.agent.opencode/opencode',
        modelId: row.selection.modelId,
        descriptor: { ...row.descriptor, id: 'different-model' },
        application: row.application,
        sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal,
      openBroker: openBroker as never,
      openTunnel: openTunnel as never,
    })).rejects.toThrow('team_credential_provider_selection_invalid');
    expect(openBroker).not.toHaveBeenCalled();
    expect(openTunnel).not.toHaveBeenCalled();
    expect(adapter.prepare).not.toHaveBeenCalled();
  });

  it('closes the exact carrier when Agent materialization fails', async () => {
    const close = vi.fn(async () => undefined);
    const adapter: ProviderAdapter = {
      v: 1, adapterVersion: 1,
      prepare: vi.fn(prepareSpawnEnv),
      materialize: vi.fn<ProviderAdapter['materialize']>(() => { throw new Error('materialization_failed'); }),
    };

    await expect(openExactSessionTeamCredentialProviderBinding({
      sessionId: 'session-1', machineId: 'worker-1', agentId: 'codex',
      selection: {
        resourceId: row.selection.resourceId,
        brokerMachineId: 'broker-1',
        expectedResourceRevision: row.selection.expectedResourceRevision,
        agentTargetKey: row.selection.agentTargetKey,
        modelId: row.selection.modelId,
        descriptor: row.descriptor,
        application: row.application,
        sourceRevision: row.sourceRevision,
      },
      lease: lease(adapter), materializationBaseDir: '/tmp/happier-team-broker-test',
      signal: new AbortController().signal,
      openBroker: async () => ({ ok: true, authority,
        target: { custodianAccountId: 'account-2', brokerMachineId: 'broker-1', endpointId: 'b'.repeat(64), endpointRevision: 1 } }),
      openTunnel: async () => ({ localPort: 43123, localCapability: 'c'.repeat(64), observedPath: 'direct', retire: async () => undefined, close }),
    })).rejects.toThrow('Agent provider binding materialization failed');
    expect(close).toHaveBeenCalledOnce();
  });
});
