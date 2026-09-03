import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveIrohNodeAddonPath } from '@happier-dev/iroh-native/node';

import { yarnCommand } from '../process/commands';
import {
  ensureProductionIrohNodeAddon,
  resolveProductionIrohNodeAddonBuildSpec,
} from './productionIrohNodeAddon';

describe('production Iroh node addon custody', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempPackageRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'happier-iroh-addon-custody-'));
    mkdirSync(join(dir, 'native'), { recursive: true });
    cleanupDirs.push(dir);
    return dir;
  }

  it('requests the canonical ordinary-addon build through the repository yarn corridor', () => {
    const packageRoot = '/repo/packages/iroh-native';
    const build = resolveProductionIrohNodeAddonBuildSpec({ packageRoot });
    // The exact canonical script the real-integration runner invokes, routed
    // through the same binary-safe `yarnCommand()` corridor every other
    // testkit child launch uses (never a direct cargo/npm/node spawn).
    expect(build.command).toBe(yarnCommand());
    expect(build.args).toEqual(['-s', 'build:native']);
    expect(build.cwd).toBe(packageRoot);
    expect(resolveProductionIrohNodeAddonBuildSpec().cwd).toMatch(/packages[\\/]iroh-native$/u);
  });

  it('builds the ordinary addon and verifies the canonical artifact before returning', async () => {
    const packageRoot = makeTempPackageRoot();
    const addonPath = resolveIrohNodeAddonPath(packageRoot);
    const builds: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    const result = await ensureProductionIrohNodeAddon({
      testDir: packageRoot,
      packageRoot,
      runBuild: async (build) => {
        builds.push(build);
        // Simulate the canonical build's artifact install step.
        writeFileSync(addonPath, 'addon');
      },
    });

    expect(builds).toEqual([
      { command: yarnCommand(), args: ['-s', 'build:native'], cwd: packageRoot },
    ]);
    // The verified path comes from the production loader's canonical owner,
    // not a restated artifact grammar.
    expect(result.addonPath).toBe(addonPath);
    expect(existsSync(result.addonPath)).toBe(true);
  });

  it('rebuilds even when the artifact already exists, so custody holds before every child start', async () => {
    const packageRoot = makeTempPackageRoot();
    writeFileSync(resolveIrohNodeAddonPath(packageRoot), 'stale');
    let builds = 0;
    await ensureProductionIrohNodeAddon({
      testDir: packageRoot,
      packageRoot,
      runBuild: async () => {
        builds += 1;
      },
    });
    expect(builds).toBe(1);
  });

  it('fails closed when the canonical build does not produce the ordinary artifact', async () => {
    const packageRoot = makeTempPackageRoot();
    const addonPath = resolveIrohNodeAddonPath(packageRoot);
    const error = await ensureProductionIrohNodeAddon({
      testDir: packageRoot,
      packageRoot,
      runBuild: async () => undefined,
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(addonPath);
    expect((error as Error).message).toContain('build:native');
    expect(existsSync(addonPath)).toBe(false);
  });
});
