import { describe, expect, it, vi } from 'vitest';

import { RunnerBrokerReadinessRequestV1Schema } from '@happier-dev/protocol/teams';

import { checkRunnerBrokerNonInferenceReadiness } from './runnerBrokerReadinessClient';

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

const binding = {
  homeServerIdentityId: request.homeServerIdentityId,
  activationId: request.activationId,
  launchManifestCommitment: request.launchManifestCommitment,
  resourceId: request.resourceId,
  agentTargetKey: request.agentTargetKey,
  protocol: request.protocol,
  modelId: request.modelId,
  initiator: request.initiator,
  target: request.target,
};
const credentialSelectionBinding = {
  v: 1 as const,
  resourceId: request.resourceId,
  brokerMachineId: request.target.machineId,
  revision: 7,
  application: {
    agentTargetKey: request.agentTargetKey,
    implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
    endpointTemplateId: 'responses',
    protocol: request.protocol,
  },
  sourceRevision: 'source-revision-7',
};

function harness(fetchImpl: typeof fetch) {
  const close = vi.fn(async () => undefined);
  const shutdown = vi.fn(async () => undefined);
  const openHttpTunnel = vi.fn(async () => ({
    localPort: 48123,
    localCapability: 'f'.repeat(64),
    remoteEndpointId: request.target.endpointId,
    observedPath: 'direct' as const,
    close,
  }));
  return {
    close,
    shutdown,
    openHttpTunnel,
    createRuntime: vi.fn(async () => ({
      available: true as const,
      endpoint: { endpointId: request.initiator.endpointId },
      openHttpTunnel,
      shutdown,
    })),
    fetchImpl,
  };
}

describe('Runner broker readiness client', () => {
  it('posts only the signed readiness request through the existing HTTP carrier and closes everything', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.body).toBe(JSON.stringify(request));
      expect(init?.headers).toEqual(expect.objectContaining({
        'content-type': 'application/json',
        'x-happier-machine-local-capability': 'f'.repeat(64),
      }));
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('prompt');
      return Response.json({ v: 1, binding, credentialSelectionBinding, readiness: { kind: 'available' } });
    });
    const h = harness(fetchImpl);
    await expect(checkRunnerBrokerNonInferenceReadiness({
      createRequest: (initiatorEndpointId) => {
        expect(initiatorEndpointId).toBe(request.initiator.endpointId);
        return request;
      },
      target: { endpointId: request.target.endpointId },
      happyHomeDir: '/runner-home',
      signal: new AbortController().signal,
      createRuntime: h.createRuntime,
      fetchImpl,
    })).resolves.toEqual({ kind: 'available' });
    expect(h.openHttpTunnel).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.shutdown).toHaveBeenCalledOnce();
  });

  it('closes the temporary tunnel and endpoint when the request is cancelled', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort(reason);
      throw reason;
    });
    const h = harness(fetchImpl);
    await expect(checkRunnerBrokerNonInferenceReadiness({
      createRequest: (initiatorEndpointId) => {
        expect(initiatorEndpointId).toBe(request.initiator.endpointId);
        return request;
      },
      target: { endpointId: request.target.endpointId },
      happyHomeDir: '/runner-home',
      signal: controller.signal,
      createRuntime: h.createRuntime,
      fetchImpl,
    })).rejects.toBe(reason);
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.shutdown).toHaveBeenCalledOnce();
  });

  it.each([
    [403, 'policy_denied'],
    [503, 'broker_unavailable'],
  ] as const)('maps bodyless effect status %s to canonical %s readiness and cleans up', async (status, kind) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    const h = harness(fetchImpl);
    await expect(checkRunnerBrokerNonInferenceReadiness({
      createRequest: () => request,
      target: { endpointId: request.target.endpointId },
      happyHomeDir: '/runner-home',
      signal: new AbortController().signal,
      createRuntime: h.createRuntime,
      fetchImpl,
    })).resolves.toEqual({ kind });
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.shutdown).toHaveBeenCalledOnce();
  });
});
