import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '@/testkit/fs/tempDir';
import { writeExecutableShim } from '@/testkit/fs/executableShim';
import { createZellijTerminalHostAdapter } from './adapter';

describe('Zellij creation cleanup ownership', () => {
  it.skipIf(process.platform === 'win32').each([false, true])('classifies the actual kill-session result without replacing the startup cause (stopped=%s)', async (stopped) => {
    await withTempDir('zellij-creation-', async (directory) => {
      const binary = await writeExecutableShim({ dir: directory, fileName: 'zellij', contents: `#!/bin/sh\ncase "$1" in\nattach) exit 0;;\nkill-session) exit ${stopped ? 0 : 42};;\n*) printf 'startup-failed' >&2; exit 17;;\nesac\n` });
      const adapter = createZellijTerminalHostAdapter({ zellijBinary: binary, socketDir: join(directory, 'socket') });
      await expect(adapter.createOrAttachHost({
        sessionName: 'owned', workingDirectory: directory, spawnArgv: ['native'], spawnEnv: {}, isolatedEnv: true,
      })).rejects.toMatchObject({
        creationDisposition: stopped ? 'created_and_absent' : 'created_or_uncertain',
        cleanupIncomplete: !stopped,
        cause: expect.objectContaining({ message: expect.stringContaining('startup-failed') }),
      });
    });
  });
});
