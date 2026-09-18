import { describe, expect, it, vi } from 'vitest';
import {
  TeamCredentialSourceBindingV1Schema,
  type TeamCredentialSourceBindingV1,
} from '@happier-dev/protocol/teams';
import type { ManagedProviderEndpointAccessProjection } from '@/plugins/runtime/invocation/services/managedServicesAdapter';

import {
  createTeamCredentialBrokerSourceOwner,
  teamCredentialBrokerPlacementAcceptsMachine,
} from './teamCredentialBrokerSourceOwner';

function projection(isCurrent = true): ManagedProviderEndpointAccessProjection {
  return Object.freeze({
    access: Object.freeze({
      endpointUrl: () => 'http://127.0.0.1:45123/v1',
      request: vi.fn(async () => ({
        ok: true as const,
        status: 200,
        statusText: 'OK',
        headers: Object.freeze({}),
        body: null,
      })),
    }),
    isCurrent: () => isCurrent,
    cleanup: vi.fn(),
  });
}

function opened(
  projectionValue = projection(),
  sourceCurrent: boolean | (() => boolean) = true,
  retire = vi.fn(async () => {}),
) {
  return Object.freeze({
    projection: projectionValue,
    retire,
    sourceCurrentness: Object.freeze({
      sourceMember: Object.freeze({
        kind: 'connected_account' as const,
        service: Object.freeze({ pluginId: 'acme.accounts', localId: 'service' }),
        connectedAccountId: 'source-account',
      }),
      isCurrent: vi.fn(async () => (
        typeof sourceCurrent === 'function' ? sourceCurrent() : sourceCurrent
      )),
    }),
  });
}

const service = Object.freeze({ pluginId: 'acme.accounts', localId: 'service' });
const parsedAccountSource = TeamCredentialSourceBindingV1Schema.parse({
  v: 1 as const,
  kind: 'connected_account' as const,
  target: Object.freeze({
    kind: 'account' as const,
    account: Object.freeze({ service, accountId: 'source-account' }),
  }),
  credentialIncarnation: 'credential-incarnation',
});
if (parsedAccountSource.kind !== 'connected_account') throw new Error('expected account source');
const accountSource = parsedAccountSource;
const parsedPoolSource = TeamCredentialSourceBindingV1Schema.parse({
  v: 1 as const,
  kind: 'connected_pool' as const,
  target: Object.freeze({ kind: 'group' as const, service, groupId: 'source-pool' }),
  poolIncarnation: 'pool-incarnation',
});
if (parsedPoolSource.kind !== 'connected_pool') throw new Error('expected pool source');
const poolSource = parsedPoolSource;
const parsedProviderSource = TeamCredentialSourceBindingV1Schema.parse({
  v: 1 as const,
  kind: 'provider_connection' as const,
  connectionId: 'pc_source',
  connectionSecurityFingerprint: 'connection-security:v1:source',
  credentialSlotId: 'apiKey',
});
if (parsedProviderSource.kind !== 'provider_connection') throw new Error('expected Provider source');
const providerSource = parsedProviderSource;

function request(
  source: TeamCredentialSourceBindingV1,
  overrides: Partial<Parameters<ReturnType<typeof createTeamCredentialBrokerSourceOwner>['acquire']>[0]> = {},
) {
  return {
    source,
    resourceId: 'resource-1',
    resourceRevision: 7,
    brokerMachineId: 'broker-machine',
    operation: { kind: 'session' as const, sessionId: 'session-1' },
    application: {
      agentTargetKey: 'agent:codex',
      implementationIdentity: {
        pluginId: 'happier.provider.cliproxyapi',
        localId: 'cliproxyapi',
      },
      endpointTemplateId: 'responses',
      protocol: 'openai-responses' as const,
    },
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('Team credential broker source owner', () => {
  it('uses one placement predicate for exact matching and already-admitted Pool targets', () => {
    expect(teamCredentialBrokerPlacementAcceptsMachine(
      { kind: 'machine', machineId: 'broker-machine' },
      'broker-machine',
    )).toBe(true);
    expect(teamCredentialBrokerPlacementAcceptsMachine(
      { kind: 'machine', machineId: 'other-machine' },
      'broker-machine',
    )).toBe(false);
    expect(teamCredentialBrokerPlacementAcceptsMachine(
      { kind: 'machine_pool', poolId: 'pool-1' },
      'broker-machine',
    )).toBe(true);
    expect(teamCredentialBrokerPlacementAcceptsMachine(null, 'broker-machine')).toBe(false);
    expect(teamCredentialBrokerPlacementAcceptsMachine(
      { kind: 'machine_pool', poolId: 'pool-1' },
      '',
    )).toBe(false);
  });

  it('routes Connected Accounts and connected_pool through the same Connected Services owner', async () => {
    const connected = vi.fn(async () => opened());
    const provider = vi.fn(async () => opened());
    const owner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource: connected,
      openProviderConnectionSource: provider,
    });

    await expect(owner.acquire(request(accountSource))).resolves.toMatchObject({ ok: true });
    await expect(owner.acquire(request(poolSource, {
      operation: { kind: 'execution_run', executionRunId: 'run-1' },
    }))).resolves.toMatchObject({ ok: true });

    expect(connected).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: accountSource,
      resourceId: 'resource-1',
      brokerMachineId: 'broker-machine',
      operation: { kind: 'session', sessionId: 'session-1' },
    }));
    expect(connected).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: poolSource,
      operation: { kind: 'execution_run', executionRunId: 'run-1' },
    }));
    expect(provider).not.toHaveBeenCalled();
  });

  it('routes Provider Connections through the Provider/CPX source adapter', async () => {
    const connected = vi.fn(async () => opened());
    const provider = vi.fn(async () => opened());
    const owner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource: connected,
      openProviderConnectionSource: provider,
    });

    await expect(owner.acquire(request(providerSource))).resolves.toMatchObject({ ok: true });
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({
      source: providerSource,
      brokerMachineId: 'broker-machine',
      application: expect.objectContaining({
        endpointTemplateId: 'responses',
        protocol: 'openai-responses',
      }),
    }));
    expect(connected).not.toHaveBeenCalled();
  });

  it('rejects a different broker Machine before opening source custody', async () => {
    const connected = vi.fn(async () => opened());
    const provider = vi.fn(async () => opened());
    const owner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource: connected,
      openProviderConnectionSource: provider,
    });

    await expect(owner.acquire(request(accountSource, { brokerMachineId: 'other-machine' }))).resolves.toEqual({
      ok: false,
      reasonCode: 'broker_machine_mismatch',
    });
    expect(connected).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it('fences the exact operation lifetime and releases stale custody exactly once', async () => {
    const controller = new AbortController();
    const current = projection();
    const retire = vi.fn(async () => {});
    const owner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource: async () => opened(current, true, retire),
      openProviderConnectionSource: async () => opened(),
    });
    const acquired = await owner.acquire(request(accountSource, { signal: controller.signal }));
    if (!acquired.ok) throw new Error('expected source custody');
    controller.abort();
    await vi.waitFor(() => expect(current.cleanup).toHaveBeenCalledTimes(1));
    expect(acquired.projection.isCurrent()).toBe(false);
    await acquired.projection.cleanup();
    expect(current.cleanup).toHaveBeenCalledTimes(1);
    expect(retire).toHaveBeenCalledOnce();
  });

  it('retains cleanup custody after a failed release and coalesces concurrent retries', async () => {
    let releaseCleanup!: () => void;
    const cleanup = vi.fn()
      .mockRejectedValueOnce(new Error('managed projection cleanup failed'))
      .mockImplementationOnce(async () => await new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      }));
    const current: ManagedProviderEndpointAccessProjection = Object.freeze({
      ...projection(),
      cleanup,
    });
    const owner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource: async () => opened(current),
      openProviderConnectionSource: async () => opened(),
    });
    const acquired = await owner.acquire(request(accountSource));
    if (!acquired.ok) throw new Error('expected source custody');

    await expect(acquired.projection.cleanup()).rejects.toThrow('managed projection cleanup failed');
    expect(acquired.projection.isCurrent()).toBe(false);
    await expect(acquired.projection.access.request({
      pathAndQuery: '/v1/responses',
      method: 'POST',
      body: undefined,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ ok: false, status: 403 });
    expect(current.access.request).not.toHaveBeenCalled();
    const firstRetry = acquired.projection.cleanup();
    const concurrentRetry = acquired.projection.cleanup();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
    releaseCleanup();
    await Promise.all([firstRetry, concurrentRetry]);
    await acquired.projection.cleanup();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('releases a projection that is already stale at acquisition', async () => {
    const stale = projection(false);
    const retire = vi.fn(async () => {});
    const owner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource: async () => opened(stale, true, retire),
      openProviderConnectionSource: async () => opened(),
    });
    await expect(owner.acquire(request(accountSource))).resolves.toEqual({
      ok: false,
      reasonCode: 'source_unavailable',
    });
    expect(stale.cleanup).toHaveBeenCalledOnce();
    expect(retire).toHaveBeenCalledOnce();
  });

  it('retires broker custody when the shared source snapshot becomes stale', async () => {
    const current = projection();
    const retire = vi.fn(async () => {});
    const owner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource: async () => opened(current, false, retire),
      openProviderConnectionSource: async () => opened(),
    });
    await expect(owner.acquire(request(accountSource))).resolves.toEqual({
      ok: false,
      reasonCode: 'source_unavailable',
    });
    expect(current.cleanup).toHaveBeenCalledOnce();
    expect(retire).toHaveBeenCalledOnce();
  });

  it('rechecks opaque source currentness before every broker request', async () => {
    let sourceCurrent = true;
    const current = projection();
    const retire = vi.fn(async () => {});
    const owner = createTeamCredentialBrokerSourceOwner({
      machineId: 'broker-machine',
      openConnectedServicesSource: async () => opened(current, () => sourceCurrent, retire),
      openProviderConnectionSource: async () => opened(),
    });
    const acquired = await owner.acquire(request(accountSource));
    if (!acquired.ok) throw new Error('expected source custody');
    sourceCurrent = false;
    await expect(acquired.projection.access.request({
      pathAndQuery: '/responses',
      method: 'POST',
      body: undefined,
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ ok: false, status: 403 });
    expect(current.access.request).not.toHaveBeenCalled();
    expect(acquired.projection.isCurrent()).toBe(false);
    expect(current.cleanup).toHaveBeenCalledOnce();
    expect(retire).toHaveBeenCalledOnce();
  });
});
