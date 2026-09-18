import { describe, expect, it } from 'vitest';

import {
  RunnerBrokerReadinessRequestV1Schema,
  RunnerBrokerReadinessResponseV1Schema,
  createRunnerBrokerReadinessSigningInputV1,
} from './runnerBrokerReadinessV1.js';

const request = {
  v: 1,
  kind: 'provider_broker_readiness',
  homeServerIdentityId: 'srv_runner_home',
  activationId: '00000000-0000-4000-8000-000000000010',
  launchManifestCommitment: 'c'.repeat(43),
  resourceId: 'resource-1',
  agentTargetKey: 'agent:happier.agent.codex/codex',
  modelId: 'gpt-5',
  protocol: 'openai-responses',
  initiator: { installationId: 'installation-1', endpointId: 'a'.repeat(64) },
  target: { machineId: 'broker-machine', endpointId: 'b'.repeat(64) },
  activationSignature: 'A'.repeat(86),
  installationSignature: 'A'.repeat(86),
} as const;

describe('RunnerBrokerReadinessRequestV1', () => {
  it('is strict, purpose-separated, and binds the exact endpoint-to-broker selection', () => {
    expect(RunnerBrokerReadinessRequestV1Schema.parse(request)).toEqual(request);
    expect(RunnerBrokerReadinessRequestV1Schema.safeParse({ ...request, prompt: 'secret' }).success).toBe(false);
    expect(RunnerBrokerReadinessRequestV1Schema.safeParse({ ...request, kind: 'provider_broker' }).success).toBe(false);
    expect(createRunnerBrokerReadinessSigningInputV1(request)).toContain('happier.provider-broker.readiness-request.v1');
    expect(createRunnerBrokerReadinessSigningInputV1({ ...request, target: { ...request.target, machineId: 'other' } }))
      .not.toBe(createRunnerBrokerReadinessSigningInputV1(request));
    expect(createRunnerBrokerReadinessSigningInputV1({ ...request, modelId: 'substituted-model' }))
      .not.toBe(createRunnerBrokerReadinessSigningInputV1(request));
  });

  it('returns only the checked binding and canonical safe readiness projection', () => {
    const { activationSignature: _activationSignature, installationSignature: _installationSignature, v: _v, kind: _kind, ...binding } = request;
    const credentialSelectionBinding = { v: 1, resourceId: request.resourceId, brokerMachineId: request.target.machineId, revision: 7,
      application: { agentTargetKey: request.agentTargetKey, implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' }, endpointTemplateId: 'responses', protocol: request.protocol },
      sourceRevision: 'source-revision-7' };
    expect(RunnerBrokerReadinessResponseV1Schema.parse({
      v: 1,
      binding,
      credentialSelectionBinding,
      readiness: { kind: 'available' },
    })).toEqual({ v: 1, binding, credentialSelectionBinding, readiness: { kind: 'available' } });
    expect(RunnerBrokerReadinessResponseV1Schema.safeParse({
      v: 1,
      binding,
      credentialSelectionBinding,
      secret: true,
      readiness: { kind: 'available' },
    }).success).toBe(false);
  });
});
