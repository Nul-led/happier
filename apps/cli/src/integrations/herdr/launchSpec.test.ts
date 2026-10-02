import { chmod, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createHerdrLaunchSpec } from './launchSpec';
import { logger } from '@/ui/logger';

describe('Herdr managed launch', () => {
  it('reports incomplete private handoff cleanup while retaining unexpected content', async () => {
    const launch = await createHerdrLaunchSpec({
      workingDirectory: '/tmp', spawnArgv: ['/managed/happier'], spawnEnv: {},
    });
    const unexpected = join(dirname(launch.specPath), 'unexpected');
    const diagnostic = vi.spyOn(logger, 'infoFile').mockImplementation(() => undefined);
    try {
      await writeFile(unexpected, 'retained');
      await expect(launch.discard()).rejects.toMatchObject({ code: 'ENOTEMPTY' });
      await expect(readFile(unexpected, 'utf8')).resolves.toBe('retained');
      await expect(stat(launch.specPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('terminal_launch_cleanup_incomplete'));
    } finally {
      diagnostic.mockRestore();
      await unlink(unexpected);
      await launch.discard();
    }
  });

  it.skipIf(process.platform === 'win32')('reports failure to remove an unread launch handoff instead of silently leaving secrets behind', async () => {
    const launch = await createHerdrLaunchSpec({
      workingDirectory: '/tmp', spawnArgv: ['/managed/happier'], spawnEnv: { TEST_SECRET: 'secret' },
    });
    try {
      await chmod(dirname(launch.specPath), 0o500);
      await expect(launch.discard()).rejects.toMatchObject({ errors: expect.arrayContaining([
        expect.objectContaining({ code: 'EACCES' }),
        expect.objectContaining({ code: 'ENOTEMPTY' }),
      ]) });
    } finally {
      await chmod(dirname(launch.specPath), 0o700);
      await launch.discard();
    }
    await expect(launch.discard()).resolves.toBeUndefined();
  });

  it('reuses the isolated terminal launch runner so Herdr native hooks cannot override Happier resume', async () => {
    const launch = await createHerdrLaunchSpec({
      workingDirectory: '/tmp',
      spawnArgv: ['/managed/claude', '--model', 'sonnet'],
      spawnEnv: { PATH: '/bin', ANTHROPIC_API_KEY: 'test-key', HERDR_ENV: '1', REMOVE_ME: 'secret' },
      unsetEnvKeys: ['REMOVE_ME'],
    });
    try {
      expect(launch.argv[1]).toContain('terminal_launch_spec_runner.cjs');
      const spec = JSON.parse(await readFile(launch.specPath, 'utf8')) as Record<string, unknown>;
      expect(spec).toMatchObject({
        command: '/managed/claude', args: ['--model', 'sonnet'], cwd: '/tmp',
        env: { PATH: '/bin', ANTHROPIC_API_KEY: 'test-key' },
        envPassthroughKeys: expect.arrayContaining([
          'HERDR_ENV',
          'HERDR_SOCKET_PATH',
          'HERDR_PANE_ID',
        ]),
      });
      expect(spec.env).not.toHaveProperty('HERDR_ENV');
      expect(spec.env).not.toHaveProperty('REMOVE_ME');
      expect((await stat(launch.specPath)).mode & 0o777).toBe(0o600);
    } finally {
      await launch.discard();
    }
  });
});
