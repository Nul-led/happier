import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';
import { writeExecutableShimSync } from '@/testkit/fs/executableShim';
import { projectAgentCliAuthCatalogEntry } from './agentCatalogEntryHooks';

afterEach(() => vi.unstubAllEnvs());

describe('Agent CLI auth command environment custody', () => {
  it('runs an admitted declared tool in the final launch environment without disclosing that environment', async () => {
    const dir = createTempDirSync('happier-auth-command-env-');
    try {
      const runtime = `'${process.execPath.replace(/'/g, `'\\''`)}'`;
      const tool = writeExecutableShimSync({
        dir, fileName: process.platform === 'win32' ? 'auth-fixture.cmd' : 'auth-fixture',
        contents: process.platform === 'win32'
          ? `@echo off\r\n"${process.execPath}" %*\r\n`
          : `#!/bin/sh\nexec ${runtime} "$@"\n`,
      });
      vi.stubEnv('HAPPIER_AUTH_COMMAND_AMBIENT', 'ambient-key');
      vi.stubEnv('HAPPIER_AUTH_COMMAND_SELECTED', '');
      const projected = projectAgentCliAuthCatalogEntry({
        agentId: 'codex', pluginId: 'acme.auth', isCurrent: () => true,
        cli: {
          executable: { binaryName: 'auth-fixture', sourcePreference: 'system-first' },
          install: { managed: null, manual: { kind: 'none' } },
          auth: { support: 'status_only', nonInteractiveStatusProbe: true, loginLaunches: [] },
        },
        systemTools: [{ id: 'auth-fixture', title: 'Auth fixture', executableNames: [tool] }],
        hostAccess: { required: [{
          id: 'auth-fixture-process', capability: 'process', reason: 'Read native auth status.',
          scope: { executables: [{ kind: 'systemTool', id: 'auth-fixture' }] },
        }], optional: [] },
        cliAuth: { detectAuthStatus: async (context) => {
          expect(Object.keys(context)).toEqual(['runDeclaredSystemToolCommand']);
          const output = await context.runDeclaredSystemToolCommand({
            toolId: 'auth-fixture', args: ['-e',
              "process.stdout.write(process.env.HAPPIER_AUTH_COMMAND_SELECTED && !process.env.HAPPIER_AUTH_COMMAND_AMBIENT ? 'logged_in' : 'logged_out')"],
            timeoutMs: 5_000,
          });
          expect(output.ok).toBe(true);
          return { state: output.stdout === 'logged_in' ? 'logged_in' : 'logged_out' };
        } },
      });
      const spec = await projected.getCliAuthSpec?.();
      const args = { resolvedPath: tool, processEnv: {
        ...process.env, HAPPIER_AUTH_COMMAND_AMBIENT: undefined,
        HAPPIER_AUTH_COMMAND_SELECTED: 'selected-key',
      } };
      await expect(spec?.detectAuthStatus?.(args)).resolves.toEqual({ state: 'logged_in' });
      await expect(spec?.detectAuthStatus?.({ ...args, processEnv: {
        ...args.processEnv, HAPPIER_AUTH_COMMAND_SELECTED: undefined,
      } })).resolves.toEqual({ state: 'logged_out' });
      expect(process.env.HAPPIER_AUTH_COMMAND_AMBIENT).toBe('ambient-key');
    } finally {
      removeTempDirSync(dir);
    }
  });
});
