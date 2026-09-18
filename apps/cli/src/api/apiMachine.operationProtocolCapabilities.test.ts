import { describe, expect, it, vi } from 'vitest';

import type { Machine } from '@/api/types';

import { ApiMachineClient } from './apiMachine';

function createMachine(): Machine {
  return {
    id: 'machine-1',
    encryptionKey: new Uint8Array(32).fill(1),
    encryptionVariant: 'legacy',
    metadata: null,
    metadataVersion: 0,
    daemonState: null,
    daemonStateVersion: 0,
  };
}

describe('ApiMachineClient operation protocol capability publication', () => {
  it('publishes exact external-Action authorization independently of Session spawn readiness', async () => {
    const client = new ApiMachineClient('token', createMachine());
    const internal = client as unknown as {
      externalActionExecutionAuthorizationV1OutcomeRequired: boolean;
      resolveCurrentMachineOperationProtocolCapabilitiesForPublication(): Promise<Record<string, unknown>>;
    };
    internal.externalActionExecutionAuthorizationV1OutcomeRequired = true;
    await expect(internal.resolveCurrentMachineOperationProtocolCapabilitiesForPublication()).resolves.toEqual({
      externalActionExecutionAuthorization: { protocolVersions: [1] },
    });
  });

  it('withdraws the broker application capability until the composition reports a live handler', async () => {
    const client = new ApiMachineClient('token', createMachine(), undefined, {
      resolveServerFeaturesSnapshot: async () => ({
        status: 'ready',
        features: {
          features: {
            teams: {
              enabled: true,
              credentialResources: {
                enabled: true,
                externalApi: { enabled: false },
              },
            },
          },
        },
      } as never),
    });
    const readProjection = async () => await (
      client as unknown as {
        resolveCurrentMachineOperationProtocolCapabilitiesForPublication(): Promise<Record<string, unknown>>;
      }
    ).resolveCurrentMachineOperationProtocolCapabilitiesForPublication();

    await expect(readProjection()).resolves.toBeNull();
    await client.setProviderBrokerIngressLive(true);
    await expect(readProjection()).resolves.toEqual({
      providerBrokerIngress: { protocolVersions: [1] },
    });
    await client.setProviderBrokerIngressLive(false);
    await expect(readProjection()).resolves.toBeNull();
  });

  it.each([
    ['old Home without the feature projection', { status: 'ready', features: { capabilities: {} } }],
    ['malformed feature projection', {
      status: 'ready',
      features: { features: { teams: { enabled: true, credentialResources: { enabled: 'yes' } } } },
    }],
    ['explicitly disabled feature', {
      status: 'ready',
      features: { features: { teams: { enabled: true, credentialResources: { enabled: false } } } },
    }],
  ])('does not advertise broker ingress to an %s', async (_label, snapshot) => {
    const client = new ApiMachineClient('token', createMachine(), undefined, {
      resolveServerFeaturesSnapshot: async () => snapshot as never,
    });
    await client.setProviderBrokerIngressLive(true);

    await expect((
      client as unknown as {
        resolveCurrentMachineOperationProtocolCapabilitiesForPublication(): Promise<Record<string, unknown> | null>;
      }
    ).resolveCurrentMachineOperationProtocolCapabilitiesForPublication()).resolves.toBeNull();
  });

  it('re-publishes the live handler capability across Home feature snapshot transitions', async () => {
    let enabled = false;
    const client = new ApiMachineClient('token', createMachine(), undefined, {
      resolveServerFeaturesSnapshot: async () => ({
        status: 'ready',
        features: {
          features: {
            teams: {
              enabled: true,
              credentialResources: {
                enabled,
                externalApi: { enabled: false },
              },
            },
          },
        },
      } as never),
    });
    const publish = vi.fn(async () => 1);
    const internal = client as unknown as {
      socket: { connected: boolean } | null;
      publishOperationProtocolCapabilitiesOnSocket(
        socket: unknown,
        capabilities: Record<string, unknown>,
      ): Promise<number>;
    };
    internal.socket = { connected: true };
    internal.publishOperationProtocolCapabilitiesOnSocket = publish;

    await client.setProviderBrokerIngressLive(true);
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), {});

    enabled = true;
    await client.refreshProviderBrokerIngressAdvertisement();
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), {
      providerBrokerIngress: { protocolVersions: [1] },
    });

    enabled = false;
    await client.refreshProviderBrokerIngressAdvertisement();
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), {});
  });

  it('includes placement-origin admission only when the server advertises cumulative V4 support', async () => {
    const createClient = (currentProtocolVersion: number) => new ApiMachineClient(
      'token',
      createMachine(),
      undefined,
      {
        resolveServerFeaturesSnapshot: async () => ({
          status: 'ready',
          features: {
            capabilities: {
              accountStoredContentCompatibility: {
                v: 1,
                minimumProtocolVersion: 2,
                currentProtocolVersion,
                declarationTransport: 'http-header-and-socket-auth-v1',
              },
            },
          },
        } as never),
      },
    );
    const readProjection = async (client: ApiMachineClient) => await (
      client as unknown as {
        resolveCurrentMachineOperationProtocolCapabilitiesForPublication(): Promise<Record<string, unknown>>;
      }
    ).resolveCurrentMachineOperationProtocolCapabilitiesForPublication();

    const preV4Client = createClient(3);
    const v4Client = createClient(4);
    (preV4Client as unknown as { sessionSpawnV1OutcomeRequired: boolean }).sessionSpawnV1OutcomeRequired = true;
    (v4Client as unknown as { sessionSpawnV1OutcomeRequired: boolean }).sessionSpawnV1OutcomeRequired = true;
    expect(await readProjection(preV4Client)).not.toHaveProperty('sessionSpawnPlacementOrigin');
    expect(await readProjection(v4Client)).toMatchObject({
      sessionSpawnPlacementOrigin: { protocolVersions: [1] },
    });
  });

  it('advertises targeted input V2 only from the daemon-wide cached Pending V3 server snapshot', async () => {
    const createClient = (pendingInputProtocolVersion: number | null) => new ApiMachineClient(
      'token',
      createMachine(),
      undefined,
      {
        resolveServerFeaturesSnapshot: async () => pendingInputProtocolVersion === null
          ? undefined
          : ({
              status: 'ready',
              features: { capabilities: { session: { pendingInput: { protocolVersion: pendingInputProtocolVersion } } } },
            } as never),
      },
    );
    const readProjection = async (client: ApiMachineClient) => await (
      client as unknown as {
        sessionSpawnV1OutcomeRequired: boolean;
        resolveCurrentMachineOperationProtocolCapabilitiesForPublication(): Promise<Record<string, unknown>>;
      }
    ).resolveCurrentMachineOperationProtocolCapabilitiesForPublication();

    const unavailable = createClient(null);
    const oldServer = createClient(2);
    const targetAwareServer = createClient(3);
    for (const client of [unavailable, oldServer, targetAwareServer]) {
      (client as unknown as { sessionSpawnV1OutcomeRequired: boolean }).sessionSpawnV1OutcomeRequired = true;
    }

    await expect(readProjection(unavailable)).resolves.toMatchObject({
      sessionInputAdmission: { protocolVersions: [1] },
    });
    await expect(readProjection(oldServer)).resolves.toMatchObject({
      sessionInputAdmission: { protocolVersions: [1] },
    });
    await expect(readProjection(targetAwareServer)).resolves.toMatchObject({
      sessionInputAdmission: { protocolVersions: [1, 2] },
    });
  });

  it('sends the complete strict projection through the authenticated Machine mutation', async () => {
    const client = new ApiMachineClient('token', createMachine());
    const emitWithAck = vi.fn(async () => ({ v: 1, result: 'success', revision: 4 }));
    const socket = {
      connected: true,
      timeout: vi.fn(() => ({ emitWithAck })),
    };
    (client as unknown as { socket: unknown }).socket = socket;

    await expect(client.publishOperationProtocolCapabilities({
      sessionSpawn: { protocolVersions: [1] },
    })).resolves.toBe(4);

    expect(emitWithAck).toHaveBeenCalledWith(
      'machine-update-operation-protocol-capabilities',
      {
        machineId: 'machine-1',
        capabilities: {
          sessionSpawn: { protocolVersions: [1] },
        },
      },
    );
  });

  it('rejects an unrecognized capability response instead of treating it as support', async () => {
    const client = new ApiMachineClient('token', createMachine());
    const socket = {
      connected: true,
      timeout: vi.fn(() => ({
        emitWithAck: vi.fn(async () => ({ result: 'success', revision: 1 })),
      })),
    };
    (client as unknown as { socket: unknown }).socket = socket;

    await expect(client.publishOperationProtocolCapabilities({})).rejects.toThrow();
  });

  it('synchronizes the active daemon Iroh endpoint through the same replace-all projection', async () => {
    const client = new ApiMachineClient('token', createMachine(), undefined, {
      resolveServerFeaturesSnapshot: async () => ({
        status: 'ready',
        features: {
          capabilities: {
            session: { pendingInput: { protocolVersion: 3 } },
            accountStoredContentCompatibility: {
              v: 1,
              minimumProtocolVersion: 2,
              currentProtocolVersion: 4,
              declarationTransport: 'http-header-and-socket-auth-v1',
            },
          },
        },
      } as never),
    });
    (client as unknown as { sessionSpawnV1OutcomeRequired: boolean })
      .sessionSpawnV1OutcomeRequired = true;
    const emitWithAck = vi.fn(async (event: string, payload: { daemonState?: string }) => {
      if (event === 'machine-update-state') {
        return { result: 'success', version: 1, daemonState: payload.daemonState };
      }
      return { v: 1, result: 'success', revision: 4 };
    });
    const socket = {
      connected: true,
      timeout: vi.fn(() => ({ emitWithAck })),
    };
    (client as unknown as { socket: unknown }).socket = socket;

    await expect(client.updateDaemonState(() => ({
      status: 'running',
      peerMediation: {
        iroh: { endpoint: { endpointId: 'a'.repeat(64) } },
      },
    }))).resolves.toBe('published');

    expect(emitWithAck).toHaveBeenCalledWith(
      'machine-update-operation-protocol-capabilities',
      {
        machineId: 'machine-1',
        capabilities: {
          sessionInputAdmission: { protocolVersions: [1, 2] },
          sessionSpawn: { protocolVersions: [1] },
          sessionSpawnPlacementOrigin: { protocolVersions: [1] },
          pluginWebhookClaim: { protocolVersions: [1] },
          externalActionExecutionAuthorization: { protocolVersions: [1] },
          sessionFollow: { contextV1: true, wakeOnHumanChangeV1: true },
          irohMachineEndpoint: {
            protocolVersions: [1],
            endpointId: 'a'.repeat(64),
          },
        },
      },
    );
  });
});
