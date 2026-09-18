import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { runnerArtifactTargetForPlatform } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';
import tweetnacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatEphemeralRunnerFatalError, runEphemeralRunnerMain } from './main';
import packageJson from '../../package.json';

const roots: string[] = [];

async function createRunnerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'happier-runner-main-'));
  roots.push(root);
  const executablePath = join(root, 'happier-runner');
  const activationFilePath = `${executablePath}.activation.json`;
  const target = runnerArtifactTargetForPlatform({
    os: process.platform === 'win32' ? 'windows' : process.platform,
    arch: process.arch,
  });
  if (!target) throw new Error('Test host is not a supported Runner target');
  const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(83));
  const artifact = {
    product: 'happier-runner' as const,
    version: packageJson.version,
    target,
    sha256: '8'.repeat(64),
  };
  await writeFile(activationFilePath, JSON.stringify({
    v: 1,
    home: {
      v: 1,
      homeServerIdentityId: 'srv_runner_main',
      canonicalServerUrl: 'https://home.example.test',
      revision: 1,
      endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
    },
    activation: {
      id: '00000000-0000-4000-8000-000000000083',
      signingPrivateKeyBase64Url: encodeBase64(activationKey.secretKey, 'base64url'),
      creatorAccountId: 'creator-account',
      creatorTokenEpoch: 1,
      activationExpiresAt: null,
      workspace: { kind: 'choose_on_endpoint' as const },
      sessionId: 'runner-session-main',
      machineId: 'runner-machine-main',
      authoringCommitment: encodeBase64(new Uint8Array(32).fill(89), 'base64url'),
      artifact,
      endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator-account' },
    },
  }), { mode: 0o600 });
  return { root, executablePath, activationFilePath, artifact };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ephemeral Runner shipped entry', () => {
  it('never prints raw provider or runtime failures from the shipped entry', () => {
    const rendered = formatEphemeralRunnerFatalError(new Error('Bearer secret and private path'));
    expect(rendered).toBe('Happier Runner could not continue. Open Happier for details.');
    expect(rendered).not.toContain('Bearer secret');
  });

  it('has a side-effect-free version smoke path', async () => {
    const writeVersion = vi.fn();
    const createApplication = vi.fn();
    await runEphemeralRunnerMain({ argv: ['--version'], writeVersion, createApplication });
    expect(writeVersion).toHaveBeenCalledWith(expect.stringMatching(/^happier-runner \d+\.\d+\.\d+/));
    expect(createApplication).not.toHaveBeenCalled();
  });

  it('resolves only the exact adjacent activation filename and rejects command/bearer arguments', async () => {
    const fixture = await createRunnerFixture();
    const createApplication = vi.fn(async () => {
      throw new Error('stop-after-path-proof');
    });
    await expect(runEphemeralRunnerMain({
      argv: [], executablePath: fixture.executablePath, createApplication,
    })).rejects.toThrow('stop-after-path-proof');
    expect(createApplication).toHaveBeenCalledWith({
      activationFilePath: fixture.activationFilePath,
    });
    await expect(runEphemeralRunnerMain({ argv: ['--token', 'secret'], createApplication }))
      .rejects.toThrow('does not accept CLI commands or Account credentials');
  });

  it('recreates the complete application only after an explicit pre-materialization retry', async () => {
    const fixture = await createRunnerFixture();
    const createApplication = vi.fn()
      .mockResolvedValueOnce({
        artifact: fixture.artifact,
        dependencies: {} as never,
        ui: {} as never,
      })
      .mockResolvedValueOnce({
        artifact: fixture.artifact,
        dependencies: {} as never,
        ui: {} as never,
      });
    const run = vi.fn()
      .mockResolvedValueOnce({ status: 'retry_requested' as const })
      .mockResolvedValueOnce({ status: 'completed' as const });

    await runEphemeralRunnerMain({
      argv: [],
      executablePath: fixture.executablePath,
      createApplication,
      runApplication: run,
    });

    expect(createApplication).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
    const firstLocalState = run.mock.calls[0]?.[0]?.localState;
    const secondLocalState = run.mock.calls[1]?.[0]?.localState;
    expect(firstLocalState).toBeDefined();
    expect(secondLocalState).toBe(firstLocalState);
    await expect(access(firstLocalState!.homeDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
