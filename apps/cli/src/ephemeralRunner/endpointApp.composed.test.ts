import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { runnerArtifactTargetForPlatform } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';
import tweetnacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runEphemeralRunnerMain } from './main';
import { runEphemeralRunner } from './endpointApp';
import { createProductionEphemeralRunnerApplication } from './runtimeIntegrations';
import packageJson from '../../package.json';

const authRuntimeMocks = vi.hoisted(() => ({
  acquireTerminalAuthEnrollmentRuntime: vi.fn(async () => ({
    ok: true as const,
    runtime: {
      runtimeOrigin: 'https://home.example.test',
      carrier: 'https' as const,
      authenticatedCredentialDestination: {
        kind: 'https' as const,
        applicationUrl: 'https://home.example.test',
      },
    },
    close: vi.fn(async () => undefined),
  })),
}));

vi.mock('@/auth/terminalAuthEnrollmentRuntime', () => authRuntimeMocks);

const roots: string[] = [];

function currentRunnerArtifactTarget() {
  const target = runnerArtifactTargetForPlatform({
    os: process.platform === 'win32' ? 'windows' : process.platform,
    arch: process.arch,
  });
  if (!target) throw new Error('Test host is not a supported Runner target');
  return target;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('shipped Happier Runner composition', () => {
  it('rejects an activation for a different Runner build before acquiring Home transport', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-runner-build-mismatch-'));
    roots.push(root);
    const activationFilePath = join(root, 'happier-runner.activation.json');
    const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(29));
    const target = currentRunnerArtifactTarget();
    await writeFile(activationFilePath, JSON.stringify({
      v: 1,
      home: {
        v: 1,
        homeServerIdentityId: 'srv_runner_home',
        canonicalServerUrl: 'https://home.example.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
      },
      activation: {
        id: '00000000-0000-4000-8000-000000000029',
        signingPrivateKeyBase64Url: encodeBase64(activationKey.secretKey, 'base64url'),
        creatorAccountId: 'creator-account',
        creatorTokenEpoch: 4,
        activationExpiresAt: null,
        workspace: { kind: 'choose_on_endpoint' as const },
        sessionId: 'runner-session',
        machineId: 'runner-machine',
        authoringCommitment: encodeBase64(new Uint8Array(32).fill(31), 'base64url'),
        artifact: { product: 'happier-runner', version: 'different-build', target, sha256: 'a'.repeat(64) },
        endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator-account' },
      },
    }), { mode: 0o600 });

    const application = await createProductionEphemeralRunnerApplication({ activationFilePath });
    await expect(runEphemeralRunner({
      activationFilePath,
      artifact: application.artifact,
      dependencies: application.dependencies,
      ui: application.ui,
      localStateParentDirectory: root,
    })).rejects.toMatchObject({
      code: 'RUNNER_ARTIFACT_MISMATCH',
    });
    expect(authRuntimeMocks.acquireTerminalAuthEnrollmentRuntime).not.toHaveBeenCalled();
  });

  it('runs an activation file through the ordinary runtime boundary and removes activation-local state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-runner-composed-'));
    roots.push(root);
    const activationFilePath = join(root, 'happier-runner.activation.json');
    const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(31));
    const authoringCommitment = encodeBase64(new Uint8Array(32).fill(41), 'base64url');
    const launchManifestCommitment = encodeBase64(new Uint8Array(32).fill(43), 'base64url');
    const artifact = {
      product: 'happier-runner' as const,
      version: packageJson.version,
      target: currentRunnerArtifactTarget(),
      sha256: 'a'.repeat(64),
    };
    await writeFile(activationFilePath, JSON.stringify({
      v: 1,
      home: {
        v: 1,
        homeServerIdentityId: 'srv_runner_home',
        canonicalServerUrl: 'https://home.example.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
      },
      activation: {
        id: '00000000-0000-4000-8000-000000000013',
        signingPrivateKeyBase64Url: encodeBase64(activationKey.secretKey, 'base64url'),
        creatorAccountId: 'creator-account',
        creatorTokenEpoch: 4,
        activationExpiresAt: null,
        workspace: { kind: 'choose_on_endpoint' as const },
        sessionId: 'runner-session',
        machineId: 'runner-machine',
        authoringCommitment,
        artifact,
        endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator-account' },
      },
    }), { mode: 0o600 });

    const events: string[] = [];
    let activationHome: string | null = null;
    let settleTerminal!: () => void;
    const terminal = new Promise<{ status: 'completed' }>((resolve) => {
      settleTerminal = () => resolve({ status: 'completed' });
    });
    const dependencies = {
      createConnection: vi.fn(async () => ({
        claim: vi.fn(async ({ claim }: { claim: unknown }) => { events.push('claim'); return claim; }),
        storeEndpointFacts: vi.fn(async () => { events.push('facts'); }),
        // The creator's whole waiting surface is driven by these published
        // phases, so the composed run asserts the exact sequence rather than
        // treating progress as a fire-and-forget side effect.
        reportProgress: vi.fn(async ({ phase }: { phase: string }) => { events.push(`progress.${phase}`); }),
        waitForReview: vi.fn(async () => {
          events.push('review');
          return { manifest: { agentId: 'codex' }, launchManifestCommitment, authoringCommitment, directory: '/workspace/project' };
        }),
        submitConsent: vi.fn(async () => { events.push('consent'); }),
        submitReadiness: vi.fn(async () => { events.push('readiness.publish'); }),
        decline: vi.fn(async () => { events.push('decline'); }),
        onConnectionState: () => () => undefined,
        close: vi.fn(async () => { events.push('connection.close'); }),
      })),
      prepareAgent: vi.fn(async ({ homeDirectory }: { homeDirectory: string }) => {
        activationHome = homeDirectory;
        events.push('prepare');
        return { executablePath: '/managed/codex' };
      }),
      releasePreparation: vi.fn(async () => { events.push('preparation.release'); }),
      // This boundary has no prompt/model input: readiness cannot perform paid inference.
      checkNonInferenceReadiness: vi.fn(async (input: object) => {
        expect(input).not.toHaveProperty('prompt');
        events.push('readiness');
        return { status: 'ready' as const, readiness: {} as never };
      }),
      materialize: vi.fn(async () => { events.push('materialize'); return { sessionId: 'runner-session' }; }),
      startSession: vi.fn(async () => {
        events.push('runtime.start');
        settleTerminal();
        return { terminal, stop: vi.fn(async () => { events.push('runtime.stop'); }) };
      }),
      releaseMaterialized: vi.fn(async () => { events.push('materialized.release'); }),
    };

    await expect(runEphemeralRunnerMain({
      argv: [],
      executablePath: join(root, 'happier-runner'),
      createApplication: vi.fn(async ({ activationFilePath: selectedPath }) => {
        expect(selectedPath).toBe(activationFilePath);
        return {
          artifact,
          // This composed fixture replaces the production dependency collection
          // while preserving the factory's exact public return contract.
          dependencies: dependencies as unknown as Awaited<ReturnType<typeof createProductionEphemeralRunnerApplication>>['dependencies'],
          ui: {
            selectDirectory: vi.fn(async () => '/workspace/project'),
            reviewAndRequestConsent: vi.fn(async () => true),
            confirmActiveClose: vi.fn(async () => 'stop' as const),
            requestFailureRecovery: vi.fn(async () => 'exit' as const),
            bindControls: vi.fn(() => () => undefined),
            present: vi.fn(),
          },
        };
      }),
    })).resolves.toBeUndefined();

    expect(events).toEqual([
      'claim',
      'facts',
      'review',
      'consent',
      'prepare',
      'progress.checking_ai_access',
      'readiness',
      'readiness.publish',
      'materialize',
      'runtime.start',
      'runtime.stop',
      'materialized.release',
      'preparation.release',
      'connection.close',
    ]);
    expect(activationHome).not.toBeNull();
    await expect(access(activationHome!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed before managed Agent preparation when a reviewed external plugin has no acquired Runner-local generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-runner-external-missing-'));
    roots.push(root);
    const activationFilePath = join(root, 'happier-runner.activation.json');
    const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(47));
    const authoringCommitment = encodeBase64(new Uint8Array(32).fill(49), 'base64url');
    await writeFile(activationFilePath, JSON.stringify({
      v: 1,
      home: {
        v: 1,
        homeServerIdentityId: 'srv_runner_home',
        canonicalServerUrl: 'https://home.example.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
      },
      activation: {
        id: '00000000-0000-4000-8000-000000000047',
        signingPrivateKeyBase64Url: encodeBase64(activationKey.secretKey, 'base64url'),
        creatorAccountId: 'creator-account',
        creatorTokenEpoch: 4,
        activationExpiresAt: null,
        workspace: { kind: 'choose_on_endpoint' as const },
        sessionId: 'runner-session',
        machineId: 'runner-machine',
        authoringCommitment,
        artifact: {
          product: 'happier-runner',
          version: packageJson.version,
          target: currentRunnerArtifactTarget(),
          sha256: 'b'.repeat(64),
        },
        endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator-account' },
      },
    }), { mode: 0o600 });
    const app = await createProductionEphemeralRunnerApplication({ activationFilePath });
    const activationHome = await mkdtemp(join(root, 'activation-home-'));

    await expect(app.dependencies.prepareAgent({
      manifest: {
        preparedAuthoring: {
          actionsSettings: { v: 1, actions: {} },
          authoring: {
            agentTarget: {
              kind: 'agent',
              identity: { pluginId: 'acme.reviewed-external', localId: 'assistant' },
            },
          },
        },
      } as never,
      environment: { HAPPIER_HOME_DIR: activationHome },
      homeDirectory: activationHome,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'runner_reviewed_plugin_runtime_unavailable',
      pluginId: 'acme.reviewed-external',
      localId: 'assistant',
    });
  });

  it('binds the production Personal Home carrier to activation-local endpoint identity custody', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-runner-home-carrier-'));
    roots.push(root);
    const activationFilePath = join(root, 'happier-runner.activation.json');
    const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(53));
    const installationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(59));
    const authoringCommitment = encodeBase64(new Uint8Array(32).fill(61), 'base64url');
    const binding = {
      activationId: '00000000-0000-4000-8000-000000000053',
      homeServerIdentityId: 'srv_runner_home',
      creatorAccountId: 'creator-account',
      creatorTokenEpoch: 4,
      activationExpiresAt: null,
      workspace: { kind: 'choose_on_endpoint' as const },
      sessionId: 'runner-session',
      machineId: 'runner-machine',
      activationSigningPublicKey: encodeBase64(activationKey.publicKey, 'base64url'),
      authoringCommitment,
      artifact: {
        product: 'happier-runner' as const,
        version: packageJson.version,
        target: currentRunnerArtifactTarget(),
        sha256: 'c'.repeat(64),
      },
      endpointFactsRecipient: { mode: 'plain' as const, creatorAccountId: 'creator-account' },
    };
    await writeFile(activationFilePath, JSON.stringify({
      v: 1,
      home: {
        v: 1,
        homeServerIdentityId: 'srv_runner_home',
        canonicalServerUrl: 'https://home.example.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
      },
      activation: {
        id: binding.activationId,
        signingPrivateKeyBase64Url: encodeBase64(activationKey.secretKey, 'base64url'),
        creatorAccountId: binding.creatorAccountId,
        creatorTokenEpoch: binding.creatorTokenEpoch,
        activationExpiresAt: null,
        workspace: binding.workspace,
        sessionId: binding.sessionId,
        machineId: binding.machineId,
        authoringCommitment,
        artifact: binding.artifact,
        endpointFactsRecipient: binding.endpointFactsRecipient,
      },
    }), { mode: 0o600 });
    const app = await createProductionEphemeralRunnerApplication({ activationFilePath });
    const activationHome = join(root, 'activation-local-home');
    const signal = new AbortController().signal;

    const connection = await app.dependencies.createConnection({
      home: {
        v: 1,
        homeServerIdentityId: 'srv_runner_home',
        canonicalServerUrl: 'https://home.example.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
      },
      homeDirectory: activationHome,
      binding,
      activationSecretKey: activationKey.secretKey,
      installation: {
        version: 1,
        installationId: 'installation-runner',
        createdAt: 1,
        publicKey: encodeBase64(installationKey.publicKey, 'base64url'),
        privateKey: encodeBase64(installationKey.secretKey, 'base64url'),
      },
      signal,
    });

    expect(authRuntimeMocks.acquireTerminalAuthEnrollmentRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ homeServerIdentityId: 'srv_runner_home' }),
      undefined,
      signal,
      { happyHomeDir: activationHome },
    );
    await connection.close();
  });
});
