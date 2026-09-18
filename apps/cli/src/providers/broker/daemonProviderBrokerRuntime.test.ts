import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeProviderBrokerAuthorityV1 } from '@happier-dev/protocol';
import {
  computeTeamCredentialSourceMemberKeyV1,
  TEAM_CREDENTIAL_EXTERNAL_PROVIDER_APPLICATION_HTTP_PATH_V1,
  type TeamCredentialResourceSummaryV1,
} from '@happier-dev/protocol/teams';

import type { ManagedProviderEndpointHttpAccess } from '@/plugins/runtime/invocation/services/managedServicesAdapter';
import type { ManagedProviderExplicitStartCustody } from '@/providers/connections/publicManagedRuntimeStart';
import { createConnectedServicesBrokerSourceOpen } from './connectedServicesSource';
import {
  createTeamCredentialBrokerSourceOwner,
  type TeamCredentialBrokerSourceOwner,
} from './teamCredentialBrokerSourceOwner';
import {
  createPrivateProviderBrokerStreamLifetime,
  resolveRunnerCredentialSelectionCurrentness,
  startDaemonProviderBrokerRuntime,
} from './daemonProviderBrokerRuntime';

const authority = {
  payload: {
    v: 1 as const,
    grantId: 'grant-1',
    aud: 'happier-provider-broker-route-v1' as const,
    issuedAt: 100,
    expiresAt: 200,
    teamId: 'team-1',
    resourceId: 'resource-1',
    expectedResourceRevision: 7,
    modelId: 'gpt-5',
    sourceRevision: 'source-revision-7',
    initiator: { accountId: 'worker-account', machineId: 'worker-machine', endpointId: 'a'.repeat(64) },
    target: { custodianAccountId: 'custodian-account', machineId: 'broker-machine', endpointId: 'b'.repeat(64) },
    consumer: { kind: 'session' as const, sessionId: 'session-1' },
    application: {
      agentTargetKey: 'codex',
      implementationIdentity: { pluginId: 'happier.provider.cliproxyapi', localId: 'cliproxyapi' },
      endpointTemplateId: 'cliproxyapi-openai-responses',
      protocol: 'openai-responses' as const,
    },
  },
  signature: { alg: 'Ed25519' as const, keyId: 'home', valueBase64Url: 'A'.repeat(86) },
};

const source = {
  v: 1 as const,
  kind: 'connected_account' as const,
  target: {
    kind: 'account' as const,
    account: {
      service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' },
      accountId: 'source-account',
    },
  },
  credentialIncarnation: 'credential-row-1',
};

const closeTasks: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closeTasks.splice(0).map((close) => close()));
});

describe('resolveRunnerCredentialSelectionCurrentness', () => {
  const application = authority.payload.application;
  const selection = {
    v: 1 as const,
    resourceId: 'resource-1',
    brokerMachineId: 'broker-machine',
    revision: 7,
    application,
    sourceRevision: 'source-revision-7',
  };
  const resource = (overrides: Partial<TeamCredentialResourceSummaryV1> = {}): TeamCredentialResourceSummaryV1 => {
    // Complete summary row carrying the schema's canonical defaults; overrides
    // apply via Object.assign so `Partial` cannot re-widen required-nullable or
    // defaulted output fields back to `undefined`.
    const base: TeamCredentialResourceSummaryV1 = {
      id: 'resource-1',
      teamId: 'team-1',
      custodianAccountId: 'custodian-account',
      sourceOwnerDisplayName: null,
      displayName: 'Shared Codex',
      enabled: true,
      revision: 7,
      disclosureCeiling: 'brokered_only',
      sessionUsePolicy: 'personal_allowed',
      source,
      sourcePresentation: { kind: 'connected_service', service: source.target.account.service },
      directExportSupport: 'unsupported',
      activeUsageLimitCount: 0,
      requestPolicy: null,
      brokerPlacement: { kind: 'machine', machineId: 'broker-machine' },
      allMembersDeliveryMode: null,
      groupGrants: [],
      memberGrants: [],
      readiness: { kind: 'available' },
      recoveryAction: null,
      brokerPresentation: {
        selectedTarget: null,
        eligibleTargets: [],
        selectedPool: null,
        eligiblePools: [],
      },
      capabilities: {
        manageAudience: false,
        managePolicy: false,
        manageLimits: false,
        updateBrokerPlacement: false,
        narrowDisclosure: false,
        widenDisclosure: false,
        refreshDirectMaterial: false,
        disable: false,
        enable: false,
        delete: false,
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    return Object.assign(base, overrides);
  };

  it('accepts a Pool-frozen exact Machine only when that selected daemon is currently eligible', async () => {
    const resolveEligibility = vi.fn(async () => ({ status: 'eligible' as const }));

    await expect(resolveRunnerCredentialSelectionCurrentness({
      registeredMachineId: 'broker-machine',
      selection,
      modelId: 'gpt-5',
      signal: new AbortController().signal,
      readResource: async () => resource({ brokerPlacement: { kind: 'machine_pool', poolId: 'pool-1' } }),
      resolveEligibility,
    })).resolves.toBe('available');

    expect(resolveEligibility).toHaveBeenCalledWith({
      machineId: 'broker-machine',
      teamId: 'team-1',
      resourceId: 'resource-1',
      expectedResourceRevision: 7,
      source,
      application,
      modelId: 'gpt-5',
      sourceRevision: 'source-revision-7',
    }, expect.any(AbortSignal));
  });

  it('does not let another eligible Pool member mask an unavailable selected daemon', async () => {
    const resolveEligibility = vi.fn(async (request: Readonly<{ machineId: string }>) => request.machineId === 'other-pool-member'
      ? { status: 'eligible' as const }
      : { status: 'unavailable' as const, reason: 'model_unavailable' as const });

    await expect(resolveRunnerCredentialSelectionCurrentness({
      registeredMachineId: 'broker-machine',
      selection,
      modelId: 'gpt-5',
      signal: new AbortController().signal,
      readResource: async () => resource({ brokerPlacement: { kind: 'machine_pool', poolId: 'pool-1' } }),
      resolveEligibility,
    })).resolves.toBe('source_unavailable');

    expect(resolveEligibility).toHaveBeenCalledOnce();
    expect(resolveEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 'broker-machine' }),
      expect.any(AbortSignal),
    );
  });

  it('preserves ordinary exact-Machine readiness through the same exact eligibility owner', async () => {
    const resolveEligibility = vi.fn(async () => ({ status: 'eligible' as const }));
    await expect(resolveRunnerCredentialSelectionCurrentness({
      registeredMachineId: 'broker-machine',
      selection,
      modelId: 'gpt-5',
      signal: new AbortController().signal,
      readResource: async () => resource(),
      resolveEligibility,
    })).resolves.toBe('available');
    expect(resolveEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 'broker-machine', modelId: 'gpt-5' }),
      expect.any(AbortSignal),
    );
  });

  it('denies a frozen selection that is not this daemon or the resource exact placement', async () => {
    const resolveEligibility = vi.fn(async () => ({ status: 'eligible' as const }));
    const signal = new AbortController().signal;

    await expect(resolveRunnerCredentialSelectionCurrentness({
      registeredMachineId: 'other-machine',
      selection,
      modelId: 'gpt-5',
      signal,
      readResource: async () => resource({ brokerPlacement: { kind: 'machine_pool', poolId: 'pool-1' } }),
      resolveEligibility,
    })).resolves.toBe('source_unavailable');
    await expect(resolveRunnerCredentialSelectionCurrentness({
      registeredMachineId: 'broker-machine',
      selection,
      modelId: 'gpt-5',
      signal,
      readResource: async () => resource({ brokerPlacement: { kind: 'machine', machineId: 'different-machine' } }),
      resolveEligibility,
    })).resolves.toBe('source_unavailable');

    expect(resolveEligibility).not.toHaveBeenCalled();
  });

  it('fails closed for a malformed selected-daemon eligibility response', async () => {
    await expect(resolveRunnerCredentialSelectionCurrentness({
      registeredMachineId: 'broker-machine',
      selection,
      modelId: 'gpt-5',
      signal: new AbortController().signal,
      readResource: async () => resource({ brokerPlacement: { kind: 'machine_pool', poolId: 'pool-1' } }),
      resolveEligibility: async () => ({ status: 'eligible', extra: true }),
    })).resolves.toBe('source_unavailable');
  });

  it.each([
    ['missing placement', { brokerPlacement: null }],
    ['disabled resource', { enabled: false }],
    ['stale resource revision', { revision: 8 }],
    ['missing source', { source: null }],
  ] satisfies ReadonlyArray<readonly [string, Partial<TeamCredentialResourceSummaryV1>]>)('fails closed for %s before local source work', async (_name, overrides) => {
    const resolveEligibility = vi.fn(async () => ({ status: 'eligible' as const }));
    await expect(resolveRunnerCredentialSelectionCurrentness({
      registeredMachineId: 'broker-machine',
      selection,
      modelId: 'gpt-5',
      signal: new AbortController().signal,
      readResource: async () => resource(overrides),
      resolveEligibility,
    })).resolves.toBe('source_unavailable');
    expect(resolveEligibility).not.toHaveBeenCalled();
  });

  it('distinguishes an unsupported application from stale source/model currentness', async () => {
    const base = {
      registeredMachineId: 'broker-machine',
      selection,
      modelId: 'gpt-5',
      signal: new AbortController().signal,
      readResource: async () => resource({ brokerPlacement: { kind: 'machine_pool', poolId: 'pool-1' } }),
    } as const;
    await expect(resolveRunnerCredentialSelectionCurrentness({
      ...base,
      resolveEligibility: async () => ({ status: 'unavailable', reason: 'application_unavailable' }),
    })).resolves.toBe('update_required');
    await expect(resolveRunnerCredentialSelectionCurrentness({
      ...base,
      resolveEligibility: async () => ({ status: 'unavailable', reason: 'source_changed' }),
    })).resolves.toBe('source_unavailable');
  });
});

async function requestThroughApplicationTarget(input: Readonly<{
  port: number;
  localCapability: string;
}>): Promise<string> {
  const body = JSON.stringify({ model: 'gpt-5', input: 'hello' });
  const request = [
    'POST /v1/responses HTTP/1.1',
    'Host: 127.0.0.1',
    `Authorization: Bearer ${encodeProviderBrokerAuthorityV1(authority)}`,
    'Connection: close',
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body,
  ].join('\r\n');

  return await new Promise<string>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: input.port });
    const chunks: Buffer[] = [];
    socket.once('connect', () => {
      socket.write(input.localCapability, 'ascii');
      // Keep the response half open. The client requested `Connection: close`,
      // so the application owns closing only after the streamed result lands.
      socket.write(request, 'utf8');
    });
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function requestThroughExternalApplicationTarget(input: Readonly<{
  port: number;
  localCapability: string;
  body: unknown;
}>): Promise<string> {
  const body = JSON.stringify(input.body);
  const request = [
    `POST ${TEAM_CREDENTIAL_EXTERNAL_PROVIDER_APPLICATION_HTTP_PATH_V1} HTTP/1.1`,
    'Host: 127.0.0.1',
    'Connection: close',
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body,
  ].join('\r\n');

  return await new Promise<string>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: input.port });
    const chunks: Buffer[] = [];
    socket.once('connect', () => {
      socket.write(input.localCapability, 'ascii');
      socket.write(request, 'utf8');
    });
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

describe('startDaemonProviderBrokerRuntime', () => {
  it('records one failed terminal fact when source acquisition is lost after external admission', async () => {
    const binding = {
      v: 1 as const,
      kind: 'external_api_key' as const,
      teamId: 'team-1',
      resourceId: 'resource-1',
      requestId: 'request-1',
      externalApiKeyId: '550e8400-e29b-41d4-a716-446655440000',
      assignedAccountId: 'worker-account',
      assignedTeamMembershipId: 'membership-1',
    };
    const recordExternalTerminalUsage = vi.fn(async () => ({
      ok: true as const,
      usageEventId: 'terminal-usage-1',
      created: true,
    }));
    const revalidateExternalAuthorization = vi.fn(async () => false);
    const acquire = vi.fn(async (request: Parameters<TeamCredentialBrokerSourceOwner['acquire']>[0]) => {
      expect(await request.revalidateOperationAuthorization?.()).toBe(false);
      return { ok: false as const, reasonCode: 'source_unavailable' as const };
    });
    const runtime = await startDaemonProviderBrokerRuntime({
      machineId: 'broker-machine',
      resolveTrustRoots: () => [],
      nowMs: () => 150,
      resolveRequestPolicy: vi.fn(),
      admitRequest: vi.fn(),
      authorizeModelCatalog: vi.fn(),
      resolveExternalRequestPolicy: async () => ({
        kind: 'application' as const,
        resourceRevision: 7,
        policy: null,
        modelCatalog: {
          models: [{ id: 'gpt-5' }],
          resolveCanonicalModelId: (modelId: string) => modelId,
        },
        application: authority.payload.application,
      }),
      admitExternalRequest: async () => ({
        ok: true as const,
        resourceId: 'resource-1',
        resourceRevision: 7,
        brokerMachineId: 'broker-machine',
        source,
        operation: {
          kind: 'external_api_key' as const,
          externalApiKeyId: binding.externalApiKeyId,
          assignedAccountId: binding.assignedAccountId,
          assignedTeamMembershipId: binding.assignedTeamMembershipId,
        },
        usageEventId: 'admission-usage-1',
        terminalRequestId: `external:${binding.externalApiKeyId}:${binding.requestId}`,
      }),
      recordExternalTerminalUsage,
      revalidateExternalAuthorization,
      sourceOwner: Object.freeze({ acquire }),
      createRequestId: () => 'unused',
    });
    closeTasks.push(runtime.close);
    const target = await runtime.resolveExternalProviderBrokerApplicationTarget({ binding });
    if (!target) throw new Error('external target unavailable');

    const response = await requestThroughExternalApplicationTarget({
      ...target,
      body: {
        v: 1,
        requestId: binding.requestId,
        teamId: binding.teamId,
        resourceId: binding.resourceId,
        caller: {
          kind: 'external_api_key',
          keyId: binding.externalApiKeyId,
          assignedAccountId: binding.assignedAccountId,
          assignedTeamMembershipId: binding.assignedTeamMembershipId,
        },
        route: 'responses',
        method: 'POST',
        pathAndQuery: '/v1/responses',
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('{"model":"gpt-5","input":"hello"}').toString('base64'),
      },
    });

    expect(response).toContain('HTTP/1.1 403 Forbidden');
    expect(recordExternalTerminalUsage).toHaveBeenCalledOnce();
    expect(revalidateExternalAuthorization).toHaveBeenCalledWith({
      binding,
      expectedResourceRevision: 7,
      application: authority.payload.application,
    });
    expect(recordExternalTerminalUsage).toHaveBeenCalledWith({
      v: 1,
      admissionUsageEventId: 'admission-usage-1',
      requestId: `external:${binding.externalApiKeyId}:${binding.requestId}`,
      brokerMachineId: 'broker-machine',
      completedAtMs: 150,
      outcome: 'failed',
      measurement: 'unavailable',
    });
  });

  it('retires the exact retained external-key claim when fresh Home admission denies it', async () => {
    const binding = {
      v: 1 as const,
      kind: 'external_api_key' as const,
      teamId: 'team-1',
      resourceId: 'resource-1',
      requestId: 'request-revoked',
      externalApiKeyId: '550e8400-e29b-41d4-a716-446655440000',
      assignedAccountId: 'worker-account',
      assignedTeamMembershipId: 'membership-1',
    };
    const retireExternalApiKey = vi.fn(async () => true);
    const runtime = await startDaemonProviderBrokerRuntime({
      machineId: 'broker-machine',
      resolveTrustRoots: () => [],
      nowMs: () => 150,
      resolveRequestPolicy: vi.fn(),
      admitRequest: vi.fn(),
      authorizeModelCatalog: vi.fn(),
      resolveExternalRequestPolicy: async () => ({
        kind: 'application' as const,
        resourceRevision: 7,
        policy: null,
        modelCatalog: {
          models: [{ id: 'gpt-5' }],
          resolveCanonicalModelId: (modelId: string) => modelId,
        },
        application: authority.payload.application,
      }),
      admitExternalRequest: async () => ({
        ok: false as const,
        reasonCode: 'resource_unavailable' as const,
      }),
      recordExternalTerminalUsage: vi.fn(),
      retireExternalApiKey,
      sourceOwner: createTeamCredentialBrokerSourceOwner({
        machineId: 'broker-machine',
        openConnectedServicesSource: async () => null,
        openProviderConnectionSource: async () => null,
      }),
      createRequestId: () => 'unused',
    });
    closeTasks.push(runtime.close);
    const target = await runtime.resolveExternalProviderBrokerApplicationTarget({ binding });
    if (!target) throw new Error('external target unavailable');

    const response = await requestThroughExternalApplicationTarget({
      ...target,
      body: {
        v: 1,
        requestId: binding.requestId,
        teamId: binding.teamId,
        resourceId: binding.resourceId,
        caller: {
          kind: 'external_api_key',
          keyId: binding.externalApiKeyId,
          assignedAccountId: binding.assignedAccountId,
          assignedTeamMembershipId: binding.assignedTeamMembershipId,
        },
        route: 'responses',
        method: 'POST',
        pathAndQuery: '/v1/responses',
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('{"model":"gpt-5","input":"hello"}').toString('base64'),
      },
    });

    expect(response).toContain('HTTP/1.1 403 Forbidden');
    expect(retireExternalApiKey).toHaveBeenCalledWith({
      externalApiKeyId: binding.externalApiKeyId,
      application: authority.payload.application,
    });
  });

  it('streams a Connected Account request through Home admission, canonical source custody, and Provider dispatch', async () => {
    const upstream = createServer((request, response) => {
      expect(request.headers.authorization).toBeUndefined();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    closeTasks.push(async () => await new Promise<void>((resolve) => upstream.close(() => resolve())));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('upstream unavailable');

    const access: ManagedProviderEndpointHttpAccess = {
      endpointUrl: () => `http://127.0.0.1:${address.port}/v1`,
      request: async (request) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${request.pathAndQuery}`, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: request.signal,
        });
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: response.body,
        };
      },
    };
    const dispatchOrder: string[] = [];
    const cleanup = vi.fn(async () => {});
    const resource: TeamCredentialResourceSummaryV1 = {
      id: 'resource-1', teamId: 'team-1', custodianAccountId: 'custodian-account',
      sourceOwnerDisplayName: null,
      displayName: 'Shared Codex', enabled: true, revision: 7,
      disclosureCeiling: 'brokered_only', sessionUsePolicy: 'personal_allowed',
      source,
      sourcePresentation: { kind: 'connected_service', service: source.target.account.service },
      directExportSupport: 'unsupported', activeUsageLimitCount: 0,
      requestPolicy: null,
      brokerPlacement: { kind: 'machine', machineId: 'broker-machine' },
      allMembersDeliveryMode: null,
      groupGrants: [], memberGrants: [], readiness: { kind: 'available' }, recoveryAction: null,
      brokerPresentation: {
        selectedTarget: null,
        eligibleTargets: [],
        selectedPool: null,
        eligiblePools: [],
      },
      capabilities: {
        manageAudience: false,
        managePolicy: false,
        manageLimits: false,
        updateBrokerPlacement: false,
        narrowDisclosure: false,
        widenDisclosure: false,
        refreshDirectMaterial: false,
        disable: false,
        enable: false,
        delete: false,
      },
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    };
    const readResource = vi.fn(async () => resource);
    const resolveBindingIntentSelection = vi.fn(async ({ purpose, target }) => ({
      binding: { purpose, target },
      resolved: { displayName: 'Account 1', account: source.target.account },
      isCurrent: async () => true,
    }));
    const custody: ManagedProviderExplicitStartCustody = Object.freeze({
      acquire: vi.fn(async () => {
        dispatchOrder.push('source-selection');
        return { access, isCurrent: () => true, cleanup };
      }),
      retire: vi.fn(async () => true),
      retireExternalApiKey: vi.fn(async () => true),
      revalidateRetainedClaims: vi.fn(async () => 0),
      retireAll: vi.fn(async () => 0),
    });
    const openConnectedServicesSource = createConnectedServicesBrokerSourceOpen({
      readResource,
      resolveBindingIntentSelection,
      custody,
    });
    const sourceOwner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource,
      openProviderConnectionSource: async () => null,
    });
    const runtime = await startDaemonProviderBrokerRuntime({
      machineId: 'broker-machine',
      resolveTrustRoots: () => [],
      nowMs: () => 150,
      verifyAuthority: () => ({ valid: true as const, authority }),
      resolveRequestPolicy: async () => {
        dispatchOrder.push('policy');
        return {
          resourceRevision: 7,
          sourceRevision: 'source-revision-7',
          application: authority.payload.application,
          policy: null,
          modelCatalog: {
            models: [{ id: 'gpt-5' }],
            resolveCanonicalModelId: (modelId: string) => modelId,
          },
          source,
        };
      },
      admitRequest: async (admission) => {
        dispatchOrder.push('usage-admission');
        expect(admission.sourceMemberKey).toBe(computeTeamCredentialSourceMemberKeyV1({
          kind: 'connected_account',
          service: source.target.account.service,
          connectedAccountId: source.target.account.accountId,
        }));
        return { ok: true as const, resourceId: 'resource-1', brokerMachineId: 'broker-machine', source, operation: authority.payload.consumer, usageEventId: 'usage-1' };
      },
      authorizeModelCatalog: async () => ({ ok: true as const }),
      sourceOwner,
      createRequestId: () => 'request-1',
    });
    closeTasks.push(runtime.close);

    const target = await runtime.resolveProviderBrokerApplicationTarget({
      handshake: { v: 1, kind: 'provider_broker', authority },
      authority,
      authenticatedRemoteEndpointId: authority.payload.initiator.endpointId,
      localEndpointId: authority.payload.target.endpointId,
      signal: new AbortController().signal,
    });
    expect(target).not.toBeNull();
    const response = await requestThroughApplicationTarget(target!);
    expect(response).toContain('HTTP/1.1 200 OK');
    expect(response).toContain('{"ok":true}');
    expect(dispatchOrder).toEqual(['policy', 'source-selection', 'usage-admission']);
    expect(resolveBindingIntentSelection).toHaveBeenCalledWith(expect.objectContaining({
      target: source.target,
      purpose: expect.objectContaining({ purpose: 'openai-upstream' }),
    }));
    expect(custody.acquire).toHaveBeenCalledWith(expect.objectContaining({
      operationClaim: { kind: 'providerBroker', operation: authority.payload.consumer },
    }));
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it('reuses one exact source projection for the application-stream lifetime', async () => {
    const cleanup = vi.fn(async () => {});
    const openConnectedServicesSource = vi.fn(async () => ({
      projection: {
        access: { endpointUrl: () => 'http://127.0.0.1:1/v1', request: vi.fn() },
        isCurrent: () => true,
        cleanup,
      },
      retire: vi.fn(async () => {}),
      sourceCurrentness: { sourceMember: { kind: 'connected_account' as const, service: source.target.account.service, connectedAccountId: source.target.account.accountId }, isCurrent: async () => true },
    }));
    const lifetime = createPrivateProviderBrokerStreamLifetime({
      sourceOwner: createTeamCredentialBrokerSourceOwner({
        machineId: 'broker-machine',
        openConnectedServicesSource,
        openProviderConnectionSource: async () => null,
      }),
      application: authority.payload.application,
    });
    const admitted = {
      resourceId: 'resource-1',
      brokerMachineId: 'broker-machine',
      source,
      operation: authority.payload.consumer,
      usageEventId: 'usage-1',
    };
    const acquireInput = {
      source: admitted.source,
      resourceId: admitted.resourceId,
      brokerMachineId: admitted.brokerMachineId,
      operation: admitted.operation,
      expectedResourceRevision: 7,
      application: authority.payload.application,
      modelId: authority.payload.modelId,
      sourceRevision: authority.payload.sourceRevision,
    };

    const first = await lifetime.acquireSource(acquireInput);
    const second = await lifetime.acquireSource(acquireInput);
    expect(first).toBe(second);
    expect(openConnectedServicesSource).toHaveBeenCalledOnce();
    expect(openConnectedServicesSource).toHaveBeenCalledWith(expect.objectContaining({
      operation: { kind: 'session', sessionId: 'session-1' },
    }));
    await lifetime.close();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('re-enters the canonical Pool source owner and switches before the next admission uses a source', async () => {
    const poolSource = {
      v: 1 as const,
      kind: 'connected_pool' as const,
      target: {
        kind: 'group' as const,
        service: source.target.account.service,
        groupId: 'pool-1',
      },
      poolIncarnation: 'pool-incarnation-1',
    };
    const requestA = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      statusText: 'OK',
      headers: Object.freeze({}),
      body: null,
    }));
    const requestB = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      statusText: 'OK',
      headers: Object.freeze({}),
      body: null,
    }));
    const accessA: ManagedProviderEndpointHttpAccess = Object.freeze({
      endpointUrl: () => 'http://127.0.0.1:41001/v1',
      request: requestA,
    });
    const accessB: ManagedProviderEndpointHttpAccess = Object.freeze({
      endpointUrl: () => 'http://127.0.0.1:41002/v1',
      request: requestB,
    });
    const cleanupA = vi.fn(async () => {});
    const retireA = vi.fn(async () => {});
    const cleanupB = vi.fn(async () => {});
    const retireB = vi.fn(async () => {});
    const ownerAcquire = vi.fn<TeamCredentialBrokerSourceOwner['acquire']>()
      .mockResolvedValueOnce({
        ok: true,
        sourceMemberKey: 'connected-account:A',
        projection: { access: accessA, isCurrent: () => true, cleanup: cleanupA },
        retire: retireA,
      })
      // The incumbent managed-service owner retires the stale A operation
      // while rejecting the first B establishment. The stream must retry the
      // canonical owner, never return A for this request, and never select B
      // itself.
      .mockResolvedValueOnce({ ok: false, reasonCode: 'source_unavailable' })
      .mockResolvedValueOnce({
        ok: true,
        sourceMemberKey: 'connected-account:B',
        projection: { access: accessB, isCurrent: () => true, cleanup: cleanupB },
        retire: retireB,
      });
    const lifetime = createPrivateProviderBrokerStreamLifetime({
      sourceOwner: Object.freeze({ acquire: ownerAcquire }),
      application: authority.payload.application,
    });
    const acquireInput = {
      source: poolSource,
      resourceId: 'resource-1',
      brokerMachineId: 'broker-machine',
      operation: authority.payload.consumer,
      expectedResourceRevision: 7,
      application: authority.payload.application,
      modelId: authority.payload.modelId,
      sourceRevision: authority.payload.sourceRevision,
    };

    const first = await lifetime.acquireSource(acquireInput);
    expect(first).toEqual({
      access: accessA,
      sourceMemberKey: 'connected-account:A',
    });
    await first?.access.request({
      pathAndQuery: '/v1/responses',
      method: 'POST',
      body: undefined,
      timeoutMs: 1_000,
    });
    const second = await lifetime.acquireSource(acquireInput);
    expect(second).toEqual({
      access: accessB,
      sourceMemberKey: 'connected-account:B',
    });
    expect(ownerAcquire).toHaveBeenCalledTimes(3);
    expect(retireA).toHaveBeenCalledOnce();
    expect(cleanupA).toHaveBeenCalledOnce();
    expect(retireB).not.toHaveBeenCalled();
    await second?.access.request({
      pathAndQuery: '/v1/responses',
      method: 'POST',
      body: undefined,
      timeoutMs: 1_000,
    });
    expect(requestA).toHaveBeenCalledOnce();
    expect(requestB).toHaveBeenCalledOnce();

    await lifetime.close();
    expect(retireB).toHaveBeenCalledOnce();
    expect(cleanupB).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent stream close callers until source cleanup finishes', async () => {
    let releaseCleanup!: () => void;
    const cleanup = vi.fn(async () => await new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    }));
    const retire = vi.fn(async () => {});
    const lifetime = createPrivateProviderBrokerStreamLifetime({
      sourceOwner: createTeamCredentialBrokerSourceOwner({
        machineId: 'broker-machine',
        openConnectedServicesSource: async () => ({
          projection: {
            access: { endpointUrl: () => 'http://127.0.0.1:1/v1', request: vi.fn() },
            isCurrent: () => true,
            cleanup,
          },
          retire,
          sourceCurrentness: { sourceMember: { kind: 'connected_account' as const, service: source.target.account.service, connectedAccountId: source.target.account.accountId }, isCurrent: async () => true },
        }),
        openProviderConnectionSource: async () => null,
      }),
      application: authority.payload.application,
    });
    const acquired = await lifetime.acquireSource({
      source,
      resourceId: 'resource-1',
      brokerMachineId: 'broker-machine',
      operation: authority.payload.consumer,
      expectedResourceRevision: 7,
      application: authority.payload.application,
      modelId: authority.payload.modelId,
      sourceRevision: authority.payload.sourceRevision,
    });
    expect(acquired).not.toBeNull();

    const firstClose = lifetime.close();
    let concurrentSettled = false;
    const concurrentClose = lifetime.close().then(() => { concurrentSettled = true; });
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(concurrentSettled).toBe(false);
    releaseCleanup();
    await Promise.all([firstClose, concurrentClose]);
    await lifetime.close();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(retire).toHaveBeenCalledOnce();
  });

  it('fails closed before creating a stream target when the signed application is not current', async () => {
    const runtime = await startDaemonProviderBrokerRuntime({
      machineId: 'broker-machine',
      resolveTrustRoots: () => [],
      nowMs: () => 150,
      verifyAuthority: () => ({ valid: false as const, reasonCode: 'grant_binding_mismatch' }),
      resolveRequestPolicy: vi.fn(),
      admitRequest: vi.fn(),
      authorizeModelCatalog: vi.fn(),
      sourceOwner: createTeamCredentialBrokerSourceOwner({
        machineId: 'broker-machine', openConnectedServicesSource: async () => null,
        openProviderConnectionSource: async () => null,
      }),
      createRequestId: () => 'request-1',
    });
    closeTasks.push(runtime.close);
    await expect(runtime.resolveProviderBrokerApplicationTarget({
      handshake: { v: 1, kind: 'provider_broker', authority },
      authority,
      authenticatedRemoteEndpointId: authority.payload.initiator.endpointId,
      localEndpointId: authority.payload.target.endpointId,
      signal: new AbortController().signal,
    })).resolves.toBeNull();
  });
});
