import { describe, expect, it, vi } from 'vitest';
import { RunnerBrokerReadinessRequestV1Schema } from '@happier-dev/protocol';

import { createDaemonMachineIrohRuntime } from './daemonMachineIrohRuntime';

describe('Runner broker readiness machine carrier', () => {
  it('carries the distinct readiness application without disguising it as an ordinary or inference handshake', async () => {
    // Built through the canonical Protocol schema so the carried bytes stay the real readiness
    // request rather than a locally shaped look-alike.
    const request = RunnerBrokerReadinessRequestV1Schema.parse({
      v: 1,
      kind: 'provider_broker_readiness',
      homeServerIdentityId: 'srv_runner_home',
      activationId: '00000000-0000-4000-8000-000000000010',
      launchManifestCommitment: 'A'.repeat(43),
      resourceId: 'resource-1',
      agentTargetKey: 'agent:happier.agent.codex/codex',
      protocol: 'openai-responses',
      modelId: 'gpt-5',
      initiator: { installationId: 'installation-1', endpointId: 'a'.repeat(64) },
      target: { machineId: 'broker-machine', endpointId: 'b'.repeat(64) },
      activationSignature: 'A'.repeat(86),
      installationSignature: 'A'.repeat(86),
    });
    const native = {
      createEndpoint: async () => ({ endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64) }),
      getEndpointStatus: async () => ({
        endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64), relayMode: 'automatic', relayUrls: [],
        capProfile: 'machineBulk', directAddresses: [], active: true,
      }),
      startMachineAcceptor: async () => ({}),
      stopMachineAcceptor: async () => undefined,
      startMachineHttpTunnel: vi.fn(async () => ({
        machineTunnelId: 'readiness-tunnel', endpointHandle: 'endpoint-1', localPort: 48123,
        localCapability: 'f'.repeat(64), connectionActive: true, remoteEndpointId: 'b'.repeat(64),
        observedPath: 'direct', startedAtMs: 1, lastErrorCode: null,
      })),
      stopMachineTunnel: async () => undefined,
      ensureHomeTunnel: async () => { throw new Error('not used'); },
      releaseHomeTunnel: async () => undefined,
      shutdownEndpoint: async () => undefined,
    };
    const runtime = await createDaemonMachineIrohRuntime({
      happyHomeDir: '/runner-home',
      relayConfig: { relayPolicy: 'automatic', relayUrls: [] },
      native: native as never,
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    const tunnel = await runtime.openHttpTunnel({
      alpn: 'happier/machine/1',
      remoteEndpointId: request.target.endpointId,
      flow: 'provider_broker_readiness',
      handshake: request,
    }, { endpointId: request.target.endpointId });

    expect(tunnel).toMatchObject({ localPort: 48123, localCapability: 'f'.repeat(64) });
    expect(native.startMachineHttpTunnel).toHaveBeenCalledWith(expect.objectContaining({
      endpointId: request.target.endpointId,
      handshakeJson: JSON.stringify(request),
      capProfile: 'machineBulk',
    }));
    await tunnel.close();
    await runtime.shutdown();
  });
});
