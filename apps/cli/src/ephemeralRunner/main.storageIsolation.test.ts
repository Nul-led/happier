import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { runnerArtifactTargetForPlatform } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';
import tweetnacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import packageJson from '../../package.json';

const roots: string[] = [];
const originalProcessEnvironment = { ...process.env };

function currentRunnerArtifactTarget() {
  const target = runnerArtifactTargetForPlatform({
    os: process.platform === 'win32' ? 'windows' : process.platform,
    arch: process.arch,
  });
  if (!target) throw new Error('Test host is not a supported Runner target');
  return target;
}

async function writeActivationFile(path: string) {
  const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(73));
  const artifact = {
    product: 'happier-runner' as const,
    version: packageJson.version,
    target: currentRunnerArtifactTarget(),
    sha256: '7'.repeat(64),
  };
  await writeFile(path, JSON.stringify({
    v: 1,
    home: {
      v: 1,
      homeServerIdentityId: 'srv_runner_isolation',
      canonicalServerUrl: 'https://home.example.test',
      revision: 1,
      endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
    },
    activation: {
      id: '00000000-0000-4000-8000-000000000073',
      signingPrivateKeyBase64Url: encodeBase64(activationKey.secretKey, 'base64url'),
      creatorAccountId: 'creator-account',
      creatorTokenEpoch: 1,
      activationExpiresAt: null,
      workspace: { kind: 'choose_on_endpoint' as const },
      sessionId: 'runner-session-isolation',
      machineId: 'runner-machine-isolation',
      authoringCommitment: encodeBase64(new Uint8Array(32).fill(79), 'base64url'),
      artifact,
      endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator-account' },
    },
  }), { mode: 0o600 });
  return artifact;
}

afterEach(async () => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalProcessEnvironment);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('shipped Runner activation-local storage authority', () => {
  it('initializes configuration and reachable runtime persistence only inside the activation-local Home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-runner-storage-isolation-'));
    roots.push(root);
    const ambientHome = join(root, 'ambient-cli-home');
    const activationStateParent = join(root, 'activation-state');
    const activationFilePath = join(root, 'happier-runner.activation.json');
    const ambientSettings = join(ambientHome, 'settings.json');
    await mkdir(join(ambientHome, 'servers', 'cloud'), { recursive: true });
    await writeFile(ambientSettings, '{"canary":"ordinary-cli-state"}', { mode: 0o644 });
    if (process.platform !== 'win32') await chmod(ambientSettings, 0o644);
    const ambientModeBefore = process.platform === 'win32' ? null : (await stat(ambientSettings)).mode & 0o777;
    const artifact = await writeActivationFile(activationFilePath);

    process.env.HAPPIER_HOME_DIR = ambientHome;
    process.env.HOME = ambientHome;
    process.env.USERPROFILE = ambientHome;
    vi.resetModules();

    const { runEphemeralRunnerMain } = await import('./main');
    let activationHome: string | null = null;

    await runEphemeralRunnerMain({
      argv: [],
      executablePath: join(root, 'happier-runner'),
      localStateParentDirectory: activationStateParent,
      createApplication: async () => {
        const { configuration } = await import('@/configuration');
        activationHome = configuration.happyHomeDir;
        expect(activationHome).not.toBe(ambientHome);
        expect(activationHome.startsWith(`${activationStateParent}/`)).toBe(true);

        const mutationOwner = await import(
          '@/api/session/client/transport/mutations/createRuntimeSessionClientDurableMutationOutbox'
        );
        const mutationStateOwner = await import(
          '@/api/session/client/transport/mutations/createSessionClientDurableMutationOutbox'
        );
        const { persistTerminalAttachmentInfoIfNeeded } = await import('@/agent/runtime/startupSideEffects');
        const outbox = mutationOwner.createRuntimeSessionClientDurableMutationOutbox({
          token: 'runner-token',
          sessionId: 'runner-session-isolation',
          initiallyActive: false,
          getSocket: () => null,
          requestReconnect: () => undefined,
        });
        try {
          await outbox.enqueueSessionEnd({
            v: 1,
            sessionId: 'runner-session-isolation',
            mutationId: 'session-end:runner-session-isolation',
            source: 'session_end',
            observedAt: 1,
          });
          await persistTerminalAttachmentInfoIfNeeded({
            sessionId: 'runner-session-isolation',
            terminal: { mode: 'plain' },
          });

          expect(await readFile(ambientSettings, 'utf8')).toBe('{"canary":"ordinary-cli-state"}');
          await expect(access(join(configuration.activeServerDir, 'session-mutations'))).resolves.toBeUndefined();
          await expect(access(join(configuration.happyHomeDir, 'terminal', 'sessions'))).resolves.toBeUndefined();
        } finally {
          await mutationStateOwner.resetSessionClientDurableMutationOutboxStateForTests();
        }
        return { artifact, dependencies: {} as never, ui: {} as never };
      },
      runApplication: async () => ({ status: 'completed' }),
    });

    expect(activationHome).not.toBeNull();
    await expect(access(activationHome!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(ambientSettings, 'utf8')).toBe('{"canary":"ordinary-cli-state"}');
    if (ambientModeBefore !== null) {
      expect((await stat(ambientSettings)).mode & 0o777).toBe(ambientModeBefore);
    }
  }, 300_000);
});
