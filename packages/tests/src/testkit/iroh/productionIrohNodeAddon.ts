/**
 * Just-in-time artifact custody for the ordinary Iroh node addon in composed
 * production journeys (Lane 06 real-integration lane).
 *
 * The canonical real-integration runner (`packages/iroh-native`
 * `test:home-iroh:real`) builds the ordinary `packages/iroh-native` N-API
 * addon immediately before the composed production-loader journey, but remote
 * executor workspace mirrors deliberately exclude ignored native build output
 * and may delete that artifact between the runner's build and a later
 * production child start. Composition fixtures therefore call this helper
 * immediately before every production child process that loads the addon
 * through its ordinary production resolution path.
 *
 * This helper owns no artifact and creates no release representation: it
 * invokes the repository canonical iroh-native build command through the
 * shared binary-safe logged-process corridor and fails closed unless the
 * canonical artifact exists afterwards. Builds are cargo-incremental, so a
 * rebuild immediately after the runner's build is a cheap no-op.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveIrohNodeAddonPath } from '@happier-dev/iroh-native/node';

import { repoRootDir } from '../paths';
import { yarnCommand } from '../process/commands';
import { runLoggedCommand } from '../process/spawnProcess';

export type IrohNodeAddonBuildSpec = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
}>;

export type RunIrohNodeAddonBuild = (build: IrohNodeAddonBuildSpec) => Promise<void>;

function resolveIrohNativePackageRoot(rootDir: string = repoRootDir()): string {
  return resolve(rootDir, 'packages', 'iroh-native');
}

export function resolveProductionIrohNodeAddonBuildSpec(
  params: Readonly<{ packageRoot?: string }> = {},
): IrohNodeAddonBuildSpec {
  const packageRoot = params.packageRoot ?? resolveIrohNativePackageRoot();
  return {
    // The exact canonical ordinary-addon build command the real-integration
    // runner invokes. `runLoggedCommand` resolves this through the
    // repository's binary-safe yarn invocation owner; never spawn cargo,
    // npm, or node directly here.
    command: yarnCommand(),
    args: ['-s', 'build:native'],
    cwd: packageRoot,
  };
}

/**
 * Ensures the ordinary production Iroh node addon exists by running the
 * canonical build unconditionally (custody must hold at the instant of the
 * caller's child spawn, so an existence check must not skip the build) and
 * verifying the canonical artifact afterwards. Returns the verified artifact
 * path resolved by the production loader's canonical owner.
 */
export async function ensureProductionIrohNodeAddon(params: Readonly<{
  /** Run directory that receives the build logs. */
  testDir: string;
  /** Overrides the `packages/iroh-native` root (test-only; defaults to the repository checkout). */
  packageRoot?: string;
  /** Overrides the process boundary (test-only; defaults to the shared `runLoggedCommand` corridor). */
  runBuild?: RunIrohNodeAddonBuild;
}>): Promise<Readonly<{ addonPath: string; build: IrohNodeAddonBuildSpec }>> {
  const build = resolveProductionIrohNodeAddonBuildSpec({ packageRoot: params.packageRoot });
  const runBuild = params.runBuild ?? (async (spec: IrohNodeAddonBuildSpec) => {
    mkdirSync(params.testDir, { recursive: true });
    await runLoggedCommand({
      command: spec.command,
      args: [...spec.args],
      cwd: spec.cwd,
      stdoutPath: resolve(params.testDir, 'iroh-native-addon-build.stdout.log'),
      stderrPath: resolve(params.testDir, 'iroh-native-addon-build.stderr.log'),
      timeoutMs: 600_000,
    });
  });

  await runBuild(build);

  // The artifact name/layout grammar is owned by the production loader in
  // `@happier-dev/iroh-native/node`; never restate it here.
  const addonPath = resolveIrohNodeAddonPath(build.cwd);
  if (!existsSync(addonPath)) {
    throw new Error(
      `Iroh native addon custody failed: the ordinary production artifact is still missing after the canonical build (${build.args.join(' ')} in ${build.cwd}; logs in ${params.testDir}): ${addonPath}`,
    );
  }
  return { addonPath, build };
}
