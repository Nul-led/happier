import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { signRunnerClaimV1 } from '@happier-dev/protocol/ephemeralRunner/endpoint';
import { signMachineInstallationProof } from '@happier-dev/protocol/machines/identity/installationIdentity';
import { verifyRunnerBrokerReadinessRequestV1 } from '@happier-dev/protocol/teams';
import tweetnacl from 'tweetnacl';
import { describe, expect, it, vi } from 'vitest';

import { checkProductionRunnerBrokerReadiness } from './productionRunnerBrokerReadiness';

describe('production Runner broker readiness', () => {
  it('derives the exact reviewed target and unique Provider protocol, dual-signs the carrier request, and signs content-free readiness', async () => {
    const activation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(71));
    const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(73));
    const binding = {
      activationId: '00000000-0000-4000-8000-000000000071',
      homeServerIdentityId: 'srv_home',
      creatorAccountId: 'creator',
      creatorTokenEpoch: 2,
      activationExpiresAt: null,
      workspace: { kind: 'choose_on_endpoint' as const },
      sessionId: 'session',
      machineId: 'runner-machine',
      activationSigningPublicKey: encodeBase64(activation.publicKey, 'base64url'),
      authoringCommitment: encodeBase64(new Uint8Array(32).fill(79), 'base64url'),
      artifact: { product: 'happier-runner' as const, version: '0.3.0', target: 'linux-x64' as const, sha256: 'a'.repeat(64) },
      endpointFactsRecipient: { mode: 'plain' as const, creatorAccountId: 'creator' },
    };
    const claim = signRunnerClaimV1({
      payload: {
        v: 1,
        purpose: 'happier.ephemeral-session-runner.claim',
        binding,
        runnerBoxPublicKey: encodeBase64(new Uint8Array(32).fill(81), 'base64url'),
        installation: {
          installationId: 'installation-1',
          publicKey: encodeBase64(installation.publicKey, 'base64url'),
          proof: signMachineInstallationProof({
            payload: { version: 1, installationId: 'installation-1', machineId: 'runner-machine', accountId: 'creator' },
            privateKey: encodeBase64(installation.secretKey, 'base64url'),
          }),
        },
        protocolEpoch: 1,
      },
      activationSecretKey: activation.secretKey,
    });
    const selection = { v: 1 as const, resourceId: 'resource-1', brokerMachineId: 'broker-machine', revision: 9,
      application: { agentTargetKey: 'agent:happier.agent.codex/codex', implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' }, endpointTemplateId: 'responses', protocol: 'openai-responses' },
      sourceRevision: 'source-revision-9' };
    const agentTarget = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.codex', localId: 'codex' } };
    const transportCheck = vi.fn(async (input: Parameters<NonNullable<Parameters<typeof checkProductionRunnerBrokerReadiness>[0]['transportCheck']>>[0]) => {
      const request = input.createRequest('c'.repeat(64));
      expect(verifyRunnerBrokerReadinessRequestV1({
        request,
        claim,
        expectedBinding: binding,
        expectedFacts: {
          v: 1,
          kind: 'provider_broker_readiness',
          homeServerIdentityId: 'srv_home',
          activationId: binding.activationId,
          launchManifestCommitment: encodeBase64(new Uint8Array(32).fill(89), 'base64url'),
          resourceId: 'resource-1',
          agentTargetKey: 'agent:happier.agent.codex/codex',
          protocol: 'openai-responses',
          modelId: 'gpt-5',
          initiator: { installationId: 'installation-1', endpointId: 'c'.repeat(64) },
          target: { machineId: 'broker-machine', endpointId: 'd'.repeat(64) },
        },
      })).toEqual(request);
      return { kind: 'available' as const };
    });

    const result = await checkProductionRunnerBrokerReadiness({
      binding,
      claim,
      manifest: {
        preparedAuthoring: { authoring: { agentTarget } },
        credentialSelectionBinding: selection,
        reviewedProviderModel: {
          selection: { modelId: 'gpt-5' },
        },
      } as never,
      launchManifestCommitment: encodeBase64(new Uint8Array(32).fill(89), 'base64url'),
      activationSecretKey: activation.secretKey,
      installationSecretKey: installation.secretKey,
      preparation: {
        managed: { resolution: { source: 'managed', command: '/managed/codex' } },
        pluginRuntime: {
          selected: { pluginId: 'happier.agent.codex', localId: 'codex', agentId: 'codex', runtimeSpec: { id: 'codex' } },
          lease: { registry: {
            contributes: {
              agentDefinitionsById: new Map([['codex', { definition: { providerRequirements: {
                acceptsProtocols: ['openai-responses'], required: {}, credentialSupport: { supportsNoAuth: false, apiKeyTransports: [{ destination: { kind: 'httpHeader', names: ['authorization'], formats: ['bearer'] }, protocol: 'openai-responses' }] }, authIsolation: { suppressConnectedServiceIds: [], ownedEnvKeys: [] }, materialization: 'spawnEnv', applyPolicy: 'restart_session', supportsFreeformModelIds: true,
              } } }]]),
              providersByContributionKey: new Map([['happier.provider.openai/openai', { identity: { pluginId: 'happier.provider.openai', localId: 'openai' }, definition: {
                v: 1, endpointTemplates: [
                  { id: 'responses', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', capabilities: { streaming: 'supported', toolRoundTrips: 'supported', statefulResponses: 'supported', reasoningControls: 'supported' } },
                  { id: 'chat', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', capabilities: { streaming: 'supported', toolRoundTrips: 'supported', statefulResponses: 'unsupported', reasoningControls: 'unsupported' } },
                ], credential: { kind: 'apiKey', required: true, slotId: 'apiKey', transports: [{ id: 'runtime-bearer', uses: ['runtime'], protocols: ['openai-responses', 'openai-chat'], destination: { kind: 'httpHeader', name: 'authorization', format: 'bearer' } }] },
              } }]]),
            },
          } },
        },
      } as never,
      projection: {
        credentialSelectionBinding: selection,
        target: { endpointId: 'd'.repeat(64) },
        provider: { identity: { pluginId: 'happier.provider.openai', localId: 'openai' }, definitionRevision: 1 },
        readiness: { kind: 'available' },
      },
      happyHomeDir: '/runner-home',
      signal: new AbortController().signal,
      transportCheck,
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.readiness.payload.installation).toEqual({
        agentTarget,
        managedInstallationId: 'codex',
        executablePath: '/managed/codex',
        authoritativeVersion: null,
      });
      expect(result.readiness.payload.credentialSelectionBinding).toEqual(selection);
    }
  });
});
