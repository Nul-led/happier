import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { runnerArtifactTargetForPlatform } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';
import tweetnacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import * as loggerModule from '@/ui/logger';
import packageJson from '../../package.json';
import { runEphemeralRunner } from './endpointApp';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ephemeral Runner logging custody', () => {
  it('binds redacted local-only diagnostics to activation-local state and restores the process logger before cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-runner-logging-'));
    roots.push(root);
    const activationFilePath = join(root, 'happier-runner.activation.json');
    const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(71));
    const authoringCommitment = encodeBase64(new Uint8Array(32).fill(73), 'base64url');
    const artifactTarget = runnerArtifactTargetForPlatform({ os: process.platform, arch: process.arch });
    expect(artifactTarget).not.toBeNull();
    const artifact = {
      product: 'happier-runner' as const,
      version: packageJson.version,
      target: artifactTarget!,
      sha256: 'd'.repeat(64),
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
        id: '00000000-0000-4000-8000-000000000071',
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

    const priorLogger = loggerModule.logger;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const env = createEnvKeyScope([
      'DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING',
      'HAPPIER_SERVER_URL',
    ] as const);
    env.patch({
      DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING: '1',
      HAPPIER_SERVER_URL: 'https://logs.example.test',
    });

    let activationHome: string | null = null;
    let capturedLogPath: string | null = null;
    let capturedLogText: string | null = null;
    try {
      await expect(runEphemeralRunner({
        activationFilePath,
        artifact,
        localStateParentDirectory: root,
        dependencies: {
          createConnection: vi.fn(async () => ({
            claim: vi.fn(async ({ claim }: { claim: unknown }) => claim),
            storeEndpointFacts: vi.fn(async () => undefined),
            reportProgress: vi.fn(async () => undefined),
            waitForReview: vi.fn(async () => ({
              manifest: { agentId: 'codex' },
              launchManifestCommitment: encodeBase64(new Uint8Array(32).fill(79), 'base64url'),
              authoringCommitment,
              directory: '/workspace/project',
            })),
            submitConsent: vi.fn(async () => undefined),
            submitReadiness: vi.fn(async () => undefined),
            decline: vi.fn(async () => undefined),
            onConnectionState: () => () => undefined,
            close: vi.fn(async () => undefined),
          })),
          prepareAgent: vi.fn(async ({ homeDirectory }: { homeDirectory: string }) => {
            activationHome = homeDirectory;
            loggerModule.logger.infoFile(
              '[RUNNER] managed preparation failed',
              'Authorization: Bearer runner-secret-token',
            );
            loggerModule.logger.flushSync();
            capturedLogPath = loggerModule.logger.getLogPath();
            capturedLogText = await readFile(capturedLogPath, 'utf8');
            return { executablePath: '/managed/codex' };
          }),
          releasePreparation: vi.fn(async () => undefined),
          checkNonInferenceReadiness: vi.fn(async () => ({ status: 'ready' as const, readiness: {} as never })),
          materialize: vi.fn(async () => ({ sessionId: 'runner-session' })),
          startSession: vi.fn(async () => ({
            terminal: Promise.resolve({ status: 'completed' as const }),
            stop: vi.fn(async () => undefined),
          })),
          releaseMaterialized: vi.fn(async () => undefined),
        },
        ui: {
          selectDirectory: vi.fn(async () => '/workspace/project'),
          reviewAndRequestConsent: vi.fn(async () => true),
          confirmActiveClose: vi.fn(async () => 'stop' as const),
          requestFailureRecovery: vi.fn(async () => 'exit' as const),
          bindControls: vi.fn(() => () => undefined),
          present: vi.fn(),
        },
      })).resolves.toEqual({ status: 'completed' });
    } finally {
      env.restore();
      fetchSpy.mockRestore();
    }

    expect(capturedLogPath).toBe(join(activationHome!, 'logs', 'runner.log'));
    expect(capturedLogText).toContain('[RUNNER] managed preparation failed');
    expect(capturedLogText).toContain('[REDACTED]');
    expect(capturedLogText).not.toContain('runner-secret-token');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loggerModule.logger).toBe(priorLogger);
    await expect(access(activationHome!)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
