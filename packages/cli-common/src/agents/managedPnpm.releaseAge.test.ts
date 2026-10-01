import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { execFileWithDeadline } from '../process/index.js';
import { managedPnpmBinPath, readManagedPnpmMinimumReleaseAgeMs } from './managedPnpm.js';

type ExecFile = typeof execFileWithDeadline;

/** The managed pnpm process is the boundary: it answers `config get` and `--version`. */
function fakePnpm(answers: Readonly<{ configured: string; version: string }>) {
  return vi.fn<ExecFile>(async (_command, args) => ({
    stdout: args.includes('--version') ? `${answers.version}\n` : `${answers.configured}\n`,
    stderr: '',
  }));
}

describe('readManagedPnpmMinimumReleaseAgeMs', () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'happier-managed-pnpm-release-age-'));
    env = { HAPPIER_HOME_DIR: home, PATH: '' };
    const bin = managedPnpmBinPath(env);
    await mkdir(dirname(bin), { recursive: true });
    await writeFile(bin, '#!/bin/sh\n', { mode: 0o755 });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('uses the age the managed pnpm is configured with', async () => {
    const execFile = fakePnpm({ configured: '60', version: '11.24.0' });
    await expect(readManagedPnpmMinimumReleaseAgeMs(env, { execFile })).resolves.toBe(60 * 60_000);
    expect(execFile.mock.calls[0]?.[0]).toBe(managedPnpmBinPath(env));
    expect(execFile.mock.calls[0]?.[1]).toEqual(['config', 'get', 'minimumReleaseAge']);
  });

  it("falls back to that pnpm version's built-in default when nothing is configured", async () => {
    await expect(readManagedPnpmMinimumReleaseAgeMs(env, { execFile: fakePnpm({ configured: 'undefined', version: '11.24.0' }) }))
      .resolves.toBe(24 * 60 * 60_000);
    await expect(readManagedPnpmMinimumReleaseAgeMs(env, { execFile: fakePnpm({ configured: 'undefined', version: '10.18.1' }) }))
      .resolves.toBe(0);
  });

  it('reports no policy when there is no managed pnpm to ask', async () => {
    const execFile = fakePnpm({ configured: '60', version: '11.24.0' });
    await expect(readManagedPnpmMinimumReleaseAgeMs({ HAPPIER_HOME_DIR: join(home, 'empty'), PATH: '' }, { execFile }))
      .resolves.toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });
});
