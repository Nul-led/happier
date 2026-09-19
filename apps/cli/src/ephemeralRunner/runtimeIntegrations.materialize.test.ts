import { beforeEach, describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { deriveBoxPublicKeyFromSeed, deriveBoxSecretKeyFromSeed, sealBoxBundle } from '@happier-dev/protocol/crypto/boxBundle';
import {
  computeRunnerMachineContentKeyFingerprintV1,
  signRunnerMachineContentKeyBindingV1,
} from '@happier-dev/protocol/ephemeralRunner/machineContentKeyBinding';

const h = vi.hoisted(() => ({
  acquireTerminalAuthEnrollmentRuntime: vi.fn(),
  createControlConnection: vi.fn(),
  waitForMaterialization: vi.fn(),
  acquirePluginRuntimeLease: vi.fn(),
  pluginRuntimeRelease: vi.fn(async () => undefined),
  readActivationDocument: vi.fn(async () => ({
    home: {
      v: 1,
      homeServerIdentityId: 'home-1',
      canonicalServerUrl: 'https://home.example.test',
      revision: 1,
      endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
    },
    activation: { creatorAccountId: 'account-1' },
  })),
}));

vi.mock('./activationFile', () => ({
  readStrictEphemeralRunnerActivationDocument: h.readActivationDocument,
}));

vi.mock('@/auth/terminalAuthEnrollmentRuntime', () => ({
  acquireTerminalAuthEnrollmentRuntime: h.acquireTerminalAuthEnrollmentRuntime,
}));

vi.mock('./controlClient', () => ({
  createEphemeralRunnerHttpControlConnection: h.createControlConnection,
  EphemeralRunnerControlHttpError: class EphemeralRunnerControlHttpError extends Error {},
}));

// Plugin installation is its own boundary; this suite exercises the endpoint's
// materialization verification, not plugin discovery.
vi.mock('./runnerPluginRuntimeLease', () => ({
  acquireReviewedRunnerPluginRuntimeLease: h.acquirePluginRuntimeLease,
}));

import { createProductionEphemeralRunnerApplication } from './runtimeIntegrations';

const ACTIVATION_ID = '00000000-0000-4000-8000-000000000001';
const LAUNCH_MANIFEST_COMMITMENT = encodeBase64(new Uint8Array(32).fill(3), 'base64url');

/**
 * The creator's activation signing identity — the only identity this Runner's
 * own activation package can derive, and the only one the proof is signed with.
 */
const activationSigningKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(5));
/**
 * A different, Home-relayed Account signing identity. Nothing signs with it any
 * more, so feeding it to the verifier refuses every E2EE Runner endpoint.
 */
const accountSigningKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(11));

const machineContentKey = new Uint8Array(32).fill(17);
const sessionDataEncryptionKey = new Uint8Array(32).fill(9);

const reviewedMachineContentKeyBinding = signRunnerMachineContentKeyBindingV1({
  payload: {
    v: 1,
    purpose: 'happier.ephemeral-runner.machine-content-key',
    homeServerIdentityId: 'home-1',
    activationId: ACTIVATION_ID,
    creatorAccountId: 'account-1',
    machineId: 'machine-1',
    installationId: 'installation-1',
    machineContentKeyFingerprint: computeRunnerMachineContentKeyFingerprintV1(machineContentKey),
  },
  activationSigningSecretKey: activationSigningKeyPair.secretKey,
});

function activationBinding() {
  return {
    activationId: ACTIVATION_ID,
    homeServerIdentityId: 'home-1',
    creatorAccountId: 'account-1',
    creatorTokenEpoch: 1,
    activationExpiresAt: null,
    workspace: { kind: 'choose_on_endpoint' },
    sessionId: 'session-1',
    machineId: 'machine-1',
    activationSigningPublicKey: encodeBase64(activationSigningKeyPair.publicKey, 'base64url'),
    authoringCommitment: encodeBase64(new Uint8Array(32).fill(4), 'base64url'),
    artifact: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: 'a'.repeat(64) },
    endpointFactsRecipient: {
      mode: 'e2ee',
      creatorAccountId: 'account-1',
      accountSigningPublicKey: encodeBase64(accountSigningKeyPair.publicKey, 'base64url'),
    },
  };
}

function bootstrapDocument() {
  return {
    v: 1,
    purpose: 'happier.ephemeral-session-runner.runtime',
    homeServerIdentityId: 'home-1',
    activationId: ACTIVATION_ID,
    creatorAccountId: 'account-1',
    sessionId: 'session-1',
    machineId: 'machine-1',
    installationId: 'installation-1',
    launchManifestCommitment: LAUNCH_MANIFEST_COMMITMENT,
    storedContent: {
      mode: 'e2ee',
      sessionDataEncryptionKey: encodeBase64(sessionDataEncryptionKey, 'base64url'),
    },
    machineContent: {
      mode: 'e2ee',
      machineContentKeyBase64Url: encodeBase64(machineContentKey, 'base64url'),
      binding: reviewedMachineContentKeyBinding,
    },
  };
}

async function materializeThroughProductionEndpoint() {
  const application = await createProductionEphemeralRunnerApplication({
    activationFilePath: '/runner.activation.json',
  });
  const binding = activationBinding();
  const signal = new AbortController().signal;
  await application.dependencies.createConnection({
    home: { homeServerIdentityId: 'home-1' },
    homeDirectory: '/runner-home',
    binding,
    activationSecretKey: activationSigningKeyPair.secretKey,
    installation: { privateKey: encodeBase64(tweetnacl.sign.keyPair().secretKey, 'base64url') },
    signal,
  } as never);

  const runnerBoxSeed = new Uint8Array(32).fill(23);
  h.waitForMaterialization.mockResolvedValue({
    runtimeToken: 'runner-token',
    sealedBootstrap: encodeBase64(
      sealBoxBundle({
        plaintext: new TextEncoder().encode(JSON.stringify(bootstrapDocument())),
        recipientPublicKey: deriveBoxPublicKeyFromSeed(runnerBoxSeed),
        randomBytes: (length: number) => new Uint8Array(length).fill(7),
      }),
      'base64url',
    ),
  });

  return await application.dependencies.materialize({
    binding,
    claim: {
      payload: {
        installation: {
          installationId: 'installation-1',
          publicKey: encodeBase64(
            tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(13)).publicKey,
            'base64url',
          ),
          proof: { v: 1 },
        },
      },
    },
    manifest: {
      machineContentKeyBinding: reviewedMachineContentKeyBinding,
      preparedAuthoring: {
        actionsSettings: { v: 1, actions: {} },
        authoring: {
          agentTarget: { kind: 'agent', identity: { pluginId: 'codex', localId: 'codex' } },
          connectedServices: { v: 2, bindingsByServiceId: {} },
        },
      },
    },
    launchManifestCommitment: LAUNCH_MANIFEST_COMMITMENT,
    runnerBoxSecretKey: deriveBoxSecretKeyFromSeed(runnerBoxSeed),
    preparation: {
      homeDirectory: '/runner-home',
      pluginRuntime: { selected: { immutableGenerationId: 'bundled:test' } },
    },
    signal,
  } as never);
}

describe('production Runner endpoint materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.acquireTerminalAuthEnrollmentRuntime.mockResolvedValue({
      ok: true,
      runtime: { runtimeOrigin: 'https://home.example.test' },
      close: async () => undefined,
    });
    h.createControlConnection.mockImplementation(() => ({
      waitForMaterialization: h.waitForMaterialization,
      readBrokerReadinessProjection: () => null,
    }));
    h.acquirePluginRuntimeLease.mockResolvedValue({
      selected: {
        agentId: 'codex',
        pluginId: 'happier.agent.codex',
        localId: 'codex',
        immutableGenerationId: 'bundled:test',
      },
      lease: { registry: { contributes: { agentDefinitionsById: new Map() } } },
      release: h.pluginRuntimeRelease,
    });
  });

  it('verifies the sealed E2EE bootstrap against the activation identity derived from its own package', async () => {
    const materialized = await materializeThroughProductionEndpoint();

    expect(materialized.bootstrap).toEqual({
      mode: 'e2ee',
      sessionDataEncryptionKey,
      machineContentKey,
    });
    expect(materialized.runtimeToken).toBe('runner-token');
    expect(materialized.principal).toMatchObject({
      kind: 'ephemeral_session_runner',
      activationId: ACTIVATION_ID,
      machineId: 'machine-1',
    });
  });
});
