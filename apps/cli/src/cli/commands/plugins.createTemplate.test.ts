import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';

import { handlePluginsCommand } from './plugins';

describe('plugins create template', () => {
  it('threads the session-agent template through the public CLI command', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'happier-plugin-create-session-agent-'));
    const targetDir = join(parentDir, 'session-agent-plugin');
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const output = captureConsoleJsonOutput();
      try {
        await handlePluginsCommand([
          'create',
          targetDir,
          '--id=acme.cli-session-agent',
          '--name=CLI Session Agent',
          '--template=session-agent',
          '--json',
        ]);

        expect(output.json()).toMatchObject({
          ok: true,
          kind: 'plugins_create',
          data: { plugin: { pluginId: 'acme.cli-session-agent', title: 'CLI Session Agent' } },
        });
        expect(process.exitCode).not.toBe(1);
      } finally {
        output.restore();
      }

      await expect(lstat(join(targetDir, 'src', 'agent', 'sessionAgent.ts'))).resolves.toMatchObject({});
      await expect(readFile(join(targetDir, 'src', 'index.ts'), 'utf8'))
        .resolves.toContain('module: "./agent/sessionAgent.js"');
    } finally {
      process.exitCode = previousExitCode;
      await rm(parentDir, { recursive: true, force: true });
    }
  });
});
