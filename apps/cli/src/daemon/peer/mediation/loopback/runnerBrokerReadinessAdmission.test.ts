import { describe, expect, it, vi } from 'vitest';
import { IROH_MACHINE_ADMISSION_PATH, IROH_MACHINE_REMOTE_ENDPOINT_HEADER } from '@happier-dev/iroh-native/node';
import { createPeerMediationLoopbackApp } from './server';

const sourceEndpoint = 'a'.repeat(64);
const targetEndpoint = 'b'.repeat(64);
const request = {
  v: 1 as const, kind: 'provider_broker_readiness' as const,
  homeServerIdentityId: 'srv_runner_home', activationId: '00000000-0000-4000-8000-000000000010',
  launchManifestCommitment: 'A'.repeat(43), resourceId: 'resource-1',
  agentTargetKey: 'agent:happier.agent.codex/codex', protocol: 'openai-responses',
  modelId: 'gpt-5',
  initiator: { installationId: 'installation-1', endpointId: sourceEndpoint },
  target: { machineId: 'machine-b', endpointId: targetEndpoint },
  activationSignature: 'A'.repeat(86), installationSignature: 'A'.repeat(86),
};

function createApp(resolve: NonNullable<NonNullable<Parameters<typeof createPeerMediationLoopbackApp>[0]['irohMachineAdmission']>['resolveRunnerBrokerReadinessApplicationTarget']>) {
  return createPeerMediationLoopbackApp({
    nowMs: () => 1,
    expected: { accountId: 'account-b', machineId: 'machine-b', flowKind: 'bounded_transfer', routeKind: 'loopback_direct', endpointFingerprint: 'unused' },
    trustRoots: [],
    irohMachineAdmission: { localEndpointId: targetEndpoint, role: 'acceptor', allowedFlows: [],
      resolveApplicationTarget: () => null, resolveRunnerBrokerReadinessApplicationTarget: resolve },
  });
}

describe('Runner broker readiness machine/1 admission', () => {
  it('binds the observed endpoint and exact local broker before selecting the fixed readiness app', async () => {
    const resolve = vi.fn(async () => ({ port: 46_124 }));
    const app = createApp(resolve);
    const result = await app.inject({ method: 'POST', url: IROH_MACHINE_ADMISSION_PATH,
      headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: sourceEndpoint }, payload: request });
    expect(result.statusCode).toBe(204);
    expect(resolve).toHaveBeenCalledWith({
      request,
      authenticatedRemoteEndpointId: sourceEndpoint,
      localEndpointId: targetEndpoint,
      signal: expect.any(AbortSignal),
    });
    await app.close();
  });

  it('rejects a different observed endpoint or target before authorization', async () => {
    const resolve = vi.fn(async () => ({ port: 46_124 }));
    const app = createApp(resolve);
    expect((await app.inject({ method: 'POST', url: IROH_MACHINE_ADMISSION_PATH,
      headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: 'f'.repeat(64) }, payload: request })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: IROH_MACHINE_ADMISSION_PATH,
      headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: sourceEndpoint },
      payload: { ...request, target: { ...request.target, machineId: 'other' } } })).statusCode).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
    await app.close();
  });
});
