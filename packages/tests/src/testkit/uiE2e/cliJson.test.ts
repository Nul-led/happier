import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

// The child process is the boundary; keep the CLI launch environment real.
vi.mock('../process/spawnProcess', () => ({
  runLoggedCommandWithOutcome: async (params: { env: NodeJS.ProcessEnv; stdoutPath: string }) => {
    await writeFile(params.stdoutPath, JSON.stringify({
      ok: true,
      kind: 'environment_probe',
      data: {
        activeServerId: params.env.HAPPIER_ACTIVE_SERVER_ID ?? null,
        daemonInstanceId: params.env.HAPPIER_DAEMON_SERVICE_INSTANCE_ID ?? null,
        daemonServerUrl: params.env.HAPPIER_DAEMON_SERVICE_SERVER_URL ?? null,
        serverUrl: params.env.HAPPIER_SERVER_URL,
        homeDir: params.env.HAPPIER_HOME_DIR,
        probe: params.env.HAPPIER_TEST_ENV_PROBE,
      },
    }));
    return { exitCode: 0, signal: null };
  },
}));

import { runCliJson } from './cliJson';

it('uses the fixture credential namespace instead of ambient stack server selection', async () => {
  const testDir = await mkdtemp(join(tmpdir(), 'happier-cli-json-env-'));
  const cliHomeDir = join(testDir, 'cli-home');
  const serverUrl = 'http://127.0.0.1:4011';
  try {
    const result = await runCliJson({
      testDir,
      cliHomeDir,
      serverUrl,
      webappUrl: 'http://127.0.0.1:4012',
      label: 'environment',
      args: ['auth', 'status', '--json'],
      cliLaunchSpec: {
        command: 'fixture-cli',
        args: [],
        env: { HAPPIER_ACTIVE_SERVER_ID: 'ambient-launch-spec' },
      },
      env: {
        ...process.env,
        HAPPIER_ACTIVE_SERVER_ID: 'ambient-stack',
        HAPPIER_DAEMON_SERVICE_INSTANCE_ID: 'ambient-daemon',
        HAPPIER_DAEMON_SERVICE_SERVER_URL: 'https://ambient.invalid',
        HAPPIER_TEST_ENV_PROBE: 'preserved',
      },
    });
    expect(result).toEqual({
      ok: true,
      kind: 'environment_probe',
      data: {
        activeServerId: null,
        daemonInstanceId: null,
        daemonServerUrl: null,
        serverUrl,
        homeDir: cliHomeDir,
        probe: 'preserved',
      },
    });
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
});
