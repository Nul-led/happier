import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PACKAGE_ROOT = resolve(dirname(SCRIPT_PATH), '..');

/**
 * Where the SDK test lanes build the repository's example plugins.
 *
 * The public author build materializes an example's dependencies into the
 * author root it is pointed at — that is the shipped contract and it does not
 * change here. Pointing it at a tracked example root leaves a packed SDK copy
 * under `examples/<name>/node_modules`, and every later cross-package source
 * test that imports that example (the UI and plugin-ui suites import
 * `examples/public-authoring/**`) then resolves `@happier-dev/plugin-sdk`
 * through that copy instead of the workspace root. The lane therefore owns its
 * own build roots here, outside `examples/`, and copies only the build outputs
 * the in-place example tests read back into the tracked root.
 *
 * The root is fixed and package-owned: it accepts no override, because a
 * caller-chosen root could alias tracked source (for example `examples`) and
 * turn the harness reset below into a tracked-source reset.
 */
export const ISOLATED_EXAMPLE_BUILD_ROOT = '.example-builds';

/** Entries the author build produces; they are never copied *into* isolation. */
const AUTHOR_BUILD_PRODUCED_ENTRIES = Object.freeze([
  'node_modules',
  'dist',
  '.happier',
  '.happier-plugin',
]);

/**
 * Outputs the tracked example tests read (`../dist/**`, staged daemon
 * outputs). After a verified build the tracked example root carries exactly
 * these entries as this build produced them — a recognized output the build
 * did not produce is stale and is dropped.
 */
const SYNCED_BUILD_OUTPUT_ENTRIES = Object.freeze(['dist', '.happier-plugin']);

/**
 * Author-produced entries the tracked example root must never carry. A packed
 * SDK copy under `examples/<name>/node_modules` (or the author cache under
 * `.happier/`) left by any earlier in-place build shadows workspace resolution
 * for every later importer of that example — the cross-package UI and
 * plugin-ui suites import `examples/**` sources directly — so a verified build
 * drops them in the same step that republishes its outputs.
 */
const TRACKED_ROOT_DROPPED_AUTHOR_ENTRIES = AUTHOR_BUILD_PRODUCED_ENTRIES.filter(
  (entry) => !SYNCED_BUILD_OUTPUT_ENTRIES.includes(entry),
);

function firstPathSegment(root, path) {
  return relative(root, path).split(sep)[0] ?? '';
}

/**
 * Kernel path resolution follows symlinks and junctions at intermediate path
 * components, and the harness reset below removes whole project roots — so a
 * link installed at the build root would redirect that custody outside the
 * package (`fs.rm` only refuses a link at the final component). The root must
 * be absent or a real directory.
 */
async function assertUsableIsolatedRoot(isolatedRoot) {
  let stats;
  try {
    stats = await lstat(isolatedRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Unsafe isolated example build root: ${isolatedRoot}`);
  }
}

/**
 * Runs the public author build. `yarn` runs the example's own `build` script
 * (`happier plugins dev build .`); `happier-dev` is the repository CLI entry the
 * local lane already used for the Session Agent example. Both remain public
 * `happier` commands — only the author root they are pointed at moves.
 */
function spawnAuthorBuild({ entry, packageRoot, projectRoot }) {
  if (entry === 'happier-dev') {
    return spawnSync(
      process.execPath,
      [
        resolve(packageRoot, '../../apps/cli/bin/happier-dev.mjs'),
        'plugins',
        'dev',
        'build',
        projectRoot,
      ],
      { stdio: 'inherit' },
    );
  }
  // `happier` lives in the repository root bin folder. A lane started through
  // `yarn run` already inherits it; a direct `node ./scripts/...` invocation
  // does not, and the example's `build` script then dies with `happier: not
  // found`, so the entry supplies it rather than depending on its caller.
  const repositoryBinFolder = resolve(packageRoot, '../../node_modules/.bin');
  return spawnSync(
    process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
    ['--cwd', projectRoot, 'build'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PATH: `${repositoryBinFolder}${delimiter}${process.env.PATH ?? ''}`,
      },
    },
  );
}

async function syncAuthorSources(trackedRoot, projectRoot) {
  // The author tool intentionally reuses an already-materialized root; an SDK
  // source test needs the opposite contract so a prior temp-packed 0.0.0 SDK
  // can never become the next run's dependency authority. Reset only this
  // harness-owned exact project root, then materialize current dependencies.
  await rm(projectRoot, { recursive: true, force: true });
  await mkdir(projectRoot, { recursive: true });
  await cp(trackedRoot, projectRoot, {
    recursive: true,
    force: true,
    filter: (source) => !AUTHOR_BUILD_PRODUCED_ENTRIES.includes(firstPathSegment(trackedRoot, source)),
  });
}

/** Recognized outputs this build produced, in canonical sync order. */
async function recognizeBuildOutputs(projectRoot) {
  const produced = new Set(await readdir(projectRoot));
  return SYNCED_BUILD_OUTPUT_ENTRIES.filter((name) => produced.has(name));
}

async function syncVerifiedBuildToTrackedRoot(producedOutputs, projectRoot, trackedRoot) {
  for (const entry of TRACKED_ROOT_DROPPED_AUTHOR_ENTRIES) {
    await rm(join(trackedRoot, entry), { recursive: true, force: true });
  }
  const synced = [];
  for (const entry of SYNCED_BUILD_OUTPUT_ENTRIES) {
    const target = join(trackedRoot, entry);
    // Exact synchronization: replace every recognized output, dropping the
    // ones this build did not produce instead of leaving stale bytes beside
    // fresh ones.
    await rm(target, { recursive: true, force: true });
    if (!producedOutputs.includes(entry)) continue;
    await cp(join(projectRoot, entry), target, { recursive: true });
    synced.push(entry);
  }
  return synced;
}

/**
 * Builds each example through the public author build in the fixed
 * package-owned isolated root, then republishes only its build outputs into
 * the tracked example root — dropping author materialization an earlier
 * in-place build left there — so the
 * `node --test examples/**\/test/index.test.mjs` lane keeps running in place
 * against this build's verified bytes. A build that succeeds while emitting no
 * recognized output stops the lane instead of leaving the previous run's
 * outputs unverified in place.
 */
export async function buildExampleProjects({
  packageRoot = DEFAULT_PACKAGE_ROOT,
  projects,
  runBuild = spawnAuthorBuild,
}) {
  const isolatedRoot = join(packageRoot, ISOLATED_EXAMPLE_BUILD_ROOT);
  await assertUsableIsolatedRoot(isolatedRoot);
  const results = [];
  for (const project of projects) {
    if (
      project.name === ''
      || project.name === '.'
      || project.name === '..'
      || /[\\/]/u.test(project.name)
    ) {
      throw new Error(`Unsafe example project name: ${project.name}`);
    }
    const trackedRoot = join(packageRoot, 'examples', project.name);
    const projectRoot = join(isolatedRoot, project.name);
    await syncAuthorSources(trackedRoot, projectRoot);
    const build = await runBuild({ entry: project.entry, packageRoot, projectRoot });
    if (build?.status !== 0) {
      throw new Error(
        `Example build failed for ${project.name} (${project.entry}) in ${projectRoot}`,
      );
    }
    const producedOutputs = await recognizeBuildOutputs(projectRoot);
    if (producedOutputs.length === 0) {
      throw new Error(
        `Example build produced no recognized output for ${project.name} (${project.entry}) in ${projectRoot}`,
      );
    }
    results.push({
      name: project.name,
      entry: project.entry,
      projectRoot,
      trackedRoot,
      syncedOutputs: await syncVerifiedBuildToTrackedRoot(producedOutputs, projectRoot, trackedRoot),
    });
  }
  return results;
}

export function parseExampleProjectArgs(args) {
  const projects = [];
  for (const arg of args) {
    const [flag, value = ''] = arg.split(/=(.*)/su);
    const names = value.split(',').map((name) => name.trim()).filter(Boolean);
    if (flag === '--yarn') {
      projects.push(...names.map((name) => ({ name, entry: 'yarn' })));
    } else if (flag === '--happier-dev') {
      projects.push(...names.map((name) => ({ name, entry: 'happier-dev' })));
    } else {
      throw new Error(`Unknown example build argument: ${arg}`);
    }
  }
  if (projects.length === 0) throw new Error('No examples were named to build');
  return { projects };
}

export async function main(args = process.argv.slice(2)) {
  const { projects } = parseExampleProjectArgs(args);
  await buildExampleProjects({ projects });
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
