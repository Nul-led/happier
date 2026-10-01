import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreProcessEnv, snapshotProcessEnv } from '@/testkit/env/envSnapshot';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';

describe('configuration terminal present-user policy', () => {
  const originalEnv = snapshotProcessEnv();
  const tempDirs: string[] = [];
  afterEach(() => {
    restoreProcessEnv(originalEnv);
    vi.resetModules();
    for (const path of tempDirs) removeTempDirSync(path);
    tempDirs.length = 0;
  });
  async function load(value?: string) {
    const path = createTempDirSync('happier-terminal-policy-');
    tempDirs.push(path);
    process.env.HAPPIER_HOME_DIR = path;
    if (value === undefined) delete process.env.HAPPIER_CLI_PRESENT_USER;
    else process.env.HAPPIER_CLI_PRESENT_USER = value;
    return await import('./configuration');
  }
  it('leaves the account policy unconstrained when unset', async () => {
    expect((await load()).configuration.terminalPresentUserPolicy).toBeUndefined();
  });
  it('accepts the narrowing override', async () => {
    expect((await load(' disallowed ')).configuration.terminalPresentUserPolicy).toBe('disallowed');
  });
  it('fails startup on an invalid override', async () => {
    await expect(load('sometimes')).rejects.toThrow(/HAPPIER_CLI_PRESENT_USER/);
  });
});
