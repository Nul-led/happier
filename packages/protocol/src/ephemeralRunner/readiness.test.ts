import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import { encodeBase64 } from '../crypto/base64.js';
import { signMachineInstallationProof } from '../machines/identity/installationIdentity.js';
import { signRunnerBrokerReadinessRequestV1 } from '../teams/credentials/readinessV1.js';
import { signRunnerClaimV1 } from './endpoint.js';
import { RunnerReadinessPayloadV1Schema } from './readiness.js';

const commitment = encodeBase64(new Uint8Array(32).fill(4), 'base64url');

function fixture() {
  const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1));
  const installationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(2));
  const boxKey = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(3));
  const binding = {
    activationId: '00000000-0000-4000-8000-000000000013',
    homeServerIdentityId: 'srv_runner_readiness_13',
    creatorAccountId: 'creator-13',
    creatorTokenEpoch: 1,
    activationExpiresAt: null,
    workspace: { kind: 'choose_on_endpoint' as const },
    sessionId: 'session-13',
    machineId: 'runner-machine-13',
    activationSigningPublicKey: encodeBase64(activationKey.publicKey, 'base64url'),
    authoringCommitment: commitment,
    artifact: {
      product: 'happier-runner' as const,
      version: '0.3.0',
      target: 'linux-x64' as const,
      sha256: 'a'.repeat(64),
    },
    endpointFactsRecipient: {
      mode: 'plain' as const,
      creatorAccountId: 'creator-13',
    },
  };
  const claim = signRunnerClaimV1({
    payload: {
    v: 1 as const,
    purpose: 'happier.ephemeral-session-runner.claim' as const,
    binding,
    runnerBoxPublicKey: encodeBase64(boxKey.publicKey, 'base64url'),
    installation: {
      installationId: 'installation-13',
      publicKey: encodeBase64(installationKey.publicKey, 'base64url'),
      proof: signMachineInstallationProof({
        payload: {
          version: 1 as const,
          installationId: 'installation-13',
          machineId: 'runner-machine-13',
          accountId: 'creator-13',
        },
        privateKey: installationKey.secretKey,
      }),
    },
    protocolEpoch: 1 as const,
    },
    activationSecretKey: activationKey.secretKey,
  });
  const brokerReadinessRequest = signRunnerBrokerReadinessRequestV1({
    facts: {
      v: 1,
      kind: 'provider_broker_readiness',
      homeServerIdentityId: binding.homeServerIdentityId,
      activationId: binding.activationId,
      launchManifestCommitment: commitment,
      resourceId: 'resource-13',
      agentTargetKey: 'agent:happier.agent.codex/codex',
      modelId: 'gpt-5',
      protocol: 'openai-responses',
      initiator: {
        installationId: claim.payload.installation.installationId,
        endpointId: 'b'.repeat(64),
      },
      target: {
        machineId: 'broker-machine-13',
        endpointId: 'c'.repeat(64),
      },
    },
    claim,
    activationSecretKey: activationKey.secretKey,
    installationSecretKey: installationKey.secretKey,
  });
  return { claim: claim.payload, brokerReadinessRequest };
}

describe('Runner readiness', () => {
  it('freezes the exact dual-signed Lane 10 broker readiness request in the endpoint report', () => {
    const { claim, brokerReadinessRequest } = fixture();

    const parsed = RunnerReadinessPayloadV1Schema.safeParse({
      v: 1,
      purpose: 'happier.ephemeral-session-runner.readiness',
      claim,
      launchManifestCommitment: commitment,
      installation: {
        agentTarget: {
          kind: 'agent',
          identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
        },
        agentRuntimeId: 'codex',
        executablePath: '/managed/codex',
        authoritativeVersion: '1.0.0',
      },
      credentialSelectionBinding: {
        v: 1,
        resourceId: brokerReadinessRequest.resourceId,
        brokerMachineId: brokerReadinessRequest.target.machineId,
        revision: 4,
        application: { agentTargetKey: brokerReadinessRequest.agentTargetKey,
          implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
          endpointTemplateId: 'responses', protocol: brokerReadinessRequest.protocol },
        sourceRevision: 'source-revision-4',
      },
      brokerReadinessRequest,
    });

    expect(parsed.success, parsed.success ? undefined : parsed.error.message).toBe(true);
    if (parsed.success) {
      expect(parsed.data.brokerReadinessRequest).toEqual(brokerReadinessRequest);
      expect(parsed.data.installation).toEqual({
        agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
        agentRuntimeId: 'codex',
        executablePath: '/managed/codex',
        authoritativeVersion: '1.0.0',
      });
    }
  });
});
