import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  ISOLATED_EXAMPLE_BUILD_ROOT,
  buildExampleProjects,
  parseExampleProjectArgs,
} from './buildExampleProjects.mjs';

async function writeFixtureFile(root, relativePath, contents) {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

/** Neither root may contain the other, so a harness reset can never sweep tracked source. */
function assertPhysicallyDisjoint(left, right) {
  for (const [from, to] of [[left, right], [right, left]]) {
    const rel = relative(from, to);
    assert.ok(
      rel.startsWith(`..${sep}`),
      `expected disjoint roots, but ${to} is reachable from ${from} via ${rel}`,
    );
  }
}

async function createExampleFixture() {
  const packageRoot = await mkdtemp(join(tmpdir(), 'plugin-sdk-example-builds-'));
  await writeFixtureFile(
    packageRoot,
    'examples/demo/package.json',
    `${JSON.stringify({ name: '@example/demo', scripts: { build: 'happier plugins dev build .' } }, null, 2)}\n`,
  );
  await writeFixtureFile(packageRoot, 'examples/demo/index.ts', 'export const demo = true;\n');
  await writeFixtureFile(packageRoot, 'examples/demo/test/index.test.mjs', '// tracked test\n');
  return packageRoot;
}

test('a verified build drops author materialization left behind in the tracked example root', async () => {
  const packageRoot = await createExampleFixture();
  const authorBuild = createAuthorBuildDouble();
  try {
    // A prior in-place build left the temp-packed SDK and the author cache in
    // the tracked root. Resolution from an example file prefers that copy over
    // the workspace SDK, and the cross-package UI/plugin-ui suites import these
    // example sources directly, so the step that republishes this build's
    // outputs must also drop the shadowing materialization.
    await writeFixtureFile(
      join(packageRoot, 'examples/demo/node_modules/@happier-dev/plugin-sdk'),
      'package.json',
      '{"name":"@happier-dev/plugin-sdk","version":"0.0.0"}\n',
    );
    await writeFixtureFile(
      join(packageRoot, 'examples/demo/.happier/typescript-package-build'),
      'cache.json',
      '{}\n',
    );

    const [result] = await buildExampleProjects({
      packageRoot,
      projects: [{ name: 'demo', entry: 'yarn' }],
      runBuild: authorBuild.runBuild,
    });

    const trackedRoot = join(packageRoot, 'examples/demo');
    assert.deepEqual(result.syncedOutputs.sort(), ['.happier-plugin', 'dist']);
    assert.deepEqual(
      (await readdir(trackedRoot)).sort(),
      ['.happier-plugin', 'dist', 'index.ts', 'package.json', 'test'],
    );
    // Prove the composed adjacent→UI resolution seam with the real Node
    // resolver: nothing under the example root may answer for the SDK anymore.
    const resolveFromExample = createRequire(join(trackedRoot, 'index.ts'));
    assert.throws(
      () => resolveFromExample.resolve('@happier-dev/plugin-sdk'),
      (error) => error?.code === 'MODULE_NOT_FOUND',
    );
    // The isolated author root keeps the materialization the shipped contract
    // produced there.
    assert.equal(
      await readFile(
        join(packageRoot, ISOLATED_EXAMPLE_BUILD_ROOT, 'demo/node_modules/@happier-dev/plugin-sdk/package.json'),
        'utf8',
      ),
      '{"name":"@happier-dev/plugin-sdk"}\n',
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

/**
 * Stands in for the public author build: it materializes the example's
 * dependencies into whatever author root it is pointed at and emits the build
 * outputs beside them. The materialization is the shipped contract, so the
 * contract under test is *where* the harness points it.
 */
function createAuthorBuildDouble() {
  const invocations = [];
  return {
    invocations,
    async runBuild({ entry, projectRoot }) {
      invocations.push({ entry, projectRoot });
      await writeFixtureFile(
        projectRoot,
        'node_modules/@happier-dev/plugin-sdk/package.json',
        '{"name":"@happier-dev/plugin-sdk"}\n',
      );
      await writeFixtureFile(projectRoot, 'dist/index.js', 'export const demo = true;\n');
      await writeFixtureFile(
        projectRoot,
        '.happier-plugin/.happier-daemon-outputs.json',
        '{"version":1,"outputs":["dist/index.js"]}\n',
      );
      await writeFixtureFile(projectRoot, '.happier/typescript-package-build/cache.json', '{}\n');
      return { status: 0 };
    },
  };
}

test('builds examples in an isolated root and leaves the tracked example root uncontaminated', async () => {
  const packageRoot = await createExampleFixture();
  const authorBuild = createAuthorBuildDouble();
  try {
    const [result] = await buildExampleProjects({
      packageRoot,
      projects: [{ name: 'demo', entry: 'yarn' }],
      runBuild: authorBuild.runBuild,
    });

    const trackedRoot = join(packageRoot, 'examples/demo');
    assert.deepEqual(authorBuild.invocations, [{
      entry: 'yarn',
      projectRoot: join(packageRoot, ISOLATED_EXAMPLE_BUILD_ROOT, 'demo'),
    }]);
    assert.equal(result.projectRoot, join(packageRoot, ISOLATED_EXAMPLE_BUILD_ROOT, 'demo'));

    // Physical disjointness: the harness-owned root and the tracked example
    // root must not nest inside each other, so no harness reset can sweep
    // tracked source.
    assertPhysicallyDisjoint(join(packageRoot, 'examples/demo'), result.projectRoot);

    // The materialized dependency tree stays in the harness-owned root, so no
    // later cross-package source test resolves the SDK through the example.
    assert.deepEqual(
      (await readdir(join(packageRoot, ISOLATED_EXAMPLE_BUILD_ROOT, 'demo'))).sort(),
      ['.happier', '.happier-plugin', 'dist', 'index.ts', 'node_modules', 'package.json', 'test'],
    );
    assert.deepEqual(
      (await readdir(trackedRoot)).sort(),
      ['.happier-plugin', 'dist', 'index.ts', 'package.json', 'test'],
    );

    // The outputs the in-place example tests read are republished verbatim.
    assert.equal(
      await readFile(join(trackedRoot, 'dist/index.js'), 'utf8'),
      'export const demo = true;\n',
    );
    assert.equal(
      await readFile(join(trackedRoot, '.happier-plugin/.happier-daemon-outputs.json'), 'utf8'),
      '{"version":1,"outputs":["dist/index.js"]}\n',
    );
    assert.deepEqual(result.syncedOutputs.sort(), ['.happier-plugin', 'dist']);
    assert.equal(await readFile(join(trackedRoot, 'index.ts'), 'utf8'), 'export const demo = true;\n');
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test('carries hosted-static author input into isolation without copying generated plugin metadata', async () => {
  const packageRoot = await createExampleFixture();
  try {
    await writeFixtureFile(
      packageRoot,
      'examples/demo/.happier-plugin/ui/hosted-web/panel/index.html',
      '<!doctype html><title>Panel</title>\n',
    );
    await writeFixtureFile(
      packageRoot,
      'examples/demo/.happier-plugin/plugin.json',
      '{"stale":true}\n',
    );

    await buildExampleProjects({
      packageRoot,
      projects: [{ name: 'demo', entry: 'yarn' }],
      runBuild: async ({ projectRoot }) => {
        assert.equal(
          await readFile(
            join(projectRoot, '.happier-plugin/ui/hosted-web/panel/index.html'),
            'utf8',
          ),
          '<!doctype html><title>Panel</title>\n',
        );
        assert.equal(
          await readFile(join(projectRoot, '.happier-plugin/plugin.json'), 'utf8').catch(() => undefined),
          undefined,
        );
        await writeFixtureFile(projectRoot, 'dist/index.js', 'export const demo = true;\n');
        await writeFixtureFile(
          projectRoot,
          '.happier-plugin/.happier-daemon-outputs.json',
          '{"version":1,"outputs":["dist/index.js"]}\n',
        );
        return { status: 0 };
      },
    });
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test('a repeated run drops every stale isolated install, cache, source, and output byte', async () => {
  const packageRoot = await createExampleFixture();
  const authorBuild = createAuthorBuildDouble();
  try {
    await buildExampleProjects({
      packageRoot,
      projects: [{ name: 'demo', entry: 'yarn' }],
      runBuild: authorBuild.runBuild,
    });
    const isolatedRoot = join(packageRoot, ISOLATED_EXAMPLE_BUILD_ROOT, 'demo');
    await writeFixtureFile(isolatedRoot, 'node_modules/.stale-sdk-marker', 'stale\n');
    await writeFixtureFile(isolatedRoot, '.happier/stale-cache.json', '{}\n');
    await writeFixtureFile(isolatedRoot, 'dist/stale-output.js', 'stale\n');
    await writeFixtureFile(isolatedRoot, 'stale-source.ts', 'export const stale = true;\n');
    await rm(join(packageRoot, 'examples/demo/index.ts'));
    await writeFixtureFile(packageRoot, 'examples/demo/entry.ts', 'export const demo = 1;\n');

    await buildExampleProjects({
      packageRoot,
      projects: [{ name: 'demo', entry: 'yarn' }],
      runBuild: authorBuild.runBuild,
    });

    const isolatedEntries = await readdir(isolatedRoot);
    assert.equal(isolatedEntries.includes('entry.ts'), true);
    assert.equal(isolatedEntries.includes('index.ts'), false);
    assert.equal(isolatedEntries.includes('stale-source.ts'), false);
    assert.equal(
      (await readdir(join(isolatedRoot, 'node_modules'))).includes('.stale-sdk-marker'),
      false,
    );
    assert.equal(
      (await readdir(join(isolatedRoot, '.happier'))).includes('stale-cache.json'),
      false,
    );
    assert.equal(
      (await readdir(join(isolatedRoot, 'dist'))).includes('stale-output.js'),
      false,
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test('a failing author build stops the lane instead of republishing stale outputs', async () => {
  const packageRoot = await createExampleFixture();
  try {
    await assert.rejects(
      () => buildExampleProjects({
        packageRoot,
        projects: [{ name: 'demo', entry: 'happier-dev' }],
        runBuild: () => ({ status: 1 }),
      }),
      /Example build failed for demo \(happier-dev\)/u,
    );
    assert.deepEqual(
      (await readdir(join(packageRoot, 'examples/demo'))).sort(),
      ['index.ts', 'package.json', 'test'],
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test('the lane names each example and the entry the public build is invoked through', () => {
  assert.deepEqual(parseExampleProjectArgs(['--yarn=a,b', '--happier-dev=c']), {
    projects: [
      { name: 'a', entry: 'yarn' },
      { name: 'b', entry: 'yarn' },
      { name: 'c', entry: 'happier-dev' },
    ],
  });
  assert.throws(() => parseExampleProjectArgs([]), /No examples were named to build/u);
  assert.throws(() => parseExampleProjectArgs(['--all']), /Unknown example build argument: --all/u);
  // The build root is fixed and package-owned: an override could alias the
  // tracked examples folder and turn the harness reset into a tracked-source
  // reset.
  assert.throws(
    () => parseExampleProjectArgs(['--yarn=demo', '--isolated-root=examples']),
    /Unknown example build argument: --isolated-root=examples/u,
  );
});

test('rejects an example name that can escape the harness-owned isolated root', async () => {
  const packageRoot = await createExampleFixture();
  try {
    await assert.rejects(
      () => buildExampleProjects({
        packageRoot,
        projects: [{ name: '../demo', entry: 'yarn' }],
        runBuild: () => ({ status: 0 }),
      }),
      /Unsafe example project name/u,
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test('rejects a link-like isolated build root instead of following it outside the package', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'plugin-sdk-example-root-escape-'));
  const packageRoot = join(fixtureRoot, 'package');
  const outsideTarget = join(fixtureRoot, 'outside', 'example-builds');
  await writeFixtureFile(packageRoot, 'examples/demo/index.ts', 'export const demo = true;\n');
  await writeFixtureFile(join(outsideTarget, 'demo'), 'sentinel.txt', 'must survive\n');
  // Junctions stand in for directory symlinks on Windows without requiring
  // symlink privileges; kernel path resolution treats both as intermediate
  // components of every project root below the build root.
  await symlink(
    outsideTarget,
    join(packageRoot, ISOLATED_EXAMPLE_BUILD_ROOT),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  try {
    await assert.rejects(
      () => buildExampleProjects({
        packageRoot,
        projects: [{ name: 'demo', entry: 'yarn' }],
        runBuild: () => ({ status: 0 }),
      }),
      /Unsafe isolated example build root/u,
    );
    assert.equal(
      await readFile(join(outsideTarget, 'demo', 'sentinel.txt'), 'utf8'),
      'must survive\n',
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('a successful build emitting one recognized output drops the stale companion output', async () => {
  const packageRoot = await createExampleFixture();
  try {
    // A recognized output left behind by an earlier run that this build does
    // not produce must not survive beside fresh outputs.
    await writeFixtureFile(
      join(packageRoot, 'examples/demo'),
      '.happier-plugin/.happier-daemon-outputs.json',
      '{"version":1,"outputs":["stale/index.js"]}\n',
    );
    const [result] = await buildExampleProjects({
      packageRoot,
      projects: [{ name: 'demo', entry: 'yarn' }],
      runBuild: async ({ projectRoot }) => {
        await writeFixtureFile(projectRoot, 'dist/index.js', 'export const demo = true;\n');
        return { status: 0 };
      },
    });

    assert.deepEqual(result.syncedOutputs, ['dist']);
    await assert.rejects(
      () => readFile(
        join(packageRoot, 'examples/demo/.happier-plugin/.happier-daemon-outputs.json'),
        'utf8',
      ),
      { code: 'ENOENT' },
    );
    assert.equal(
      await readFile(join(packageRoot, 'examples/demo/dist/index.js'), 'utf8'),
      'export const demo = true;\n',
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test('a successful author build emitting no recognized output stops the lane', async () => {
  const packageRoot = await createExampleFixture();
  try {
    await assert.rejects(
      () => buildExampleProjects({
        packageRoot,
        projects: [{ name: 'demo', entry: 'yarn' }],
        runBuild: () => ({ status: 0 }),
      }),
      /Example build produced no recognized output for demo/u,
    );
    // Nothing is republished on an unverifiable build: the tracked root keeps
    // exactly its sources and tests.
    assert.deepEqual(
      (await readdir(join(packageRoot, 'examples/demo'))).sort(),
      ['index.ts', 'package.json', 'test'],
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});
