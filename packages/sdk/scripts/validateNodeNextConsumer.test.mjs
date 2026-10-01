import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('./validateNodeNextConsumer.mjs', import.meta.url));

async function createRejectingNpmPath(directory) {
  const sentinelPath = join(directory, 'reject-npm.mjs');
  await writeFile(sentinelPath, "throw new Error('The source consumer validator must not invoke npm.');\n");
  if (process.platform === 'win32') {
    await writeFile(join(directory, 'npm.cmd'), `@echo off\r\n"${process.execPath}" "${sentinelPath}" %*\r\n`);
  } else {
    const npmPath = join(directory, 'npm');
    await writeFile(npmPath, `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(sentinelPath).href)};\n`);
    await chmod(npmPath, 0o755);
  }
  return `${directory}${delimiter}${process.env.PATH ?? ''}`;
}

test('every published example consumes the public SDK entry point and no host internals', async () => {
  const examplesDir = new URL('../examples/', import.meta.url);
  const exampleNames = (await readdir(examplesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.ok(exampleNames.includes('external-plugin'), 'Expected the external integration example.');

  const validatorSource = await readFile(scriptPath, 'utf8');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  for (const exampleName of exampleNames) {
    const source = await readFile(new URL(`../examples/${exampleName}/index.ts`, import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/^import[^']*'([^']+)'/gmu)].map(([, specifier]) => specifier);
    assert.ok(specifiers.length > 0, `${exampleName} imports nothing from the SDK.`);
    // A standalone external integration has exactly this reach: the published
    // SDK entry point. Installed plugins use the public Plugin SDK and retain
    // trusted-host parity instead. A host module, a Protocol deep import or a
    // relative source path would make this example prove an unavailable seam.
    for (const specifier of specifiers) {
      assert.ok(
        specifier === '@happier-dev/sdk' || specifier.startsWith('node:'),
        `${exampleName} imports ${specifier} instead of the published SDK entry point.`,
      );
    }
    assert.ok(
      validatorSource.includes(`'${exampleName}'`),
      `${exampleName} is not compiled by the external-consumer validator.`,
    );
    for (const published of [`examples/${exampleName}/index.ts`, `examples/${exampleName}/README.md`]) {
      assert.ok(packageJson.files.includes(published), `${published} is missing from the package files list.`);
    }
  }
});

test('the SDK consumer validator defaults to current source without npm pack or install', async () => {
  const rejectingNpmBin = await mkdtemp(join(tmpdir(), 'happier-sdk-validator-rejecting-npm-bin-'));
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath], {
      env: { ...process.env, PATH: await createRejectingNpmPath(rejectingNpmBin) },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /npm (?:pack|install)/u);
  } finally {
    await rm(rejectingNpmBin, { recursive: true, force: true });
  }
});

test('the SDK consumer validator rejects a missing supplied tarball before it can repack source', async () => {
  const emptyBin = await mkdtemp(join(tmpdir(), 'happier-sdk-validator-empty-bin-'));
  const missingTarball = join(emptyBin, 'candidate.tgz');
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath, '--tarball', missingTarball], {
      env: {
        ...process.env,
        PATH: emptyBin,
      },
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /SDK consumer tarball does not exist/u,
    );
  } finally {
    await rm(emptyBin, { recursive: true, force: true });
  }
});

test('the SDK consumer validator uses a supplied exact tarball instead of packing source again', async () => {
  const emptyBin = await mkdtemp(join(tmpdir(), 'happier-sdk-validator-empty-bin-'));
  const suppliedTarball = join(emptyBin, 'candidate.tgz');
  try {
    await writeFile(suppliedTarball, 'not-a-real-tarball');
    const result = spawnSync(process.execPath, ['--import', 'tsx', scriptPath, '--tarball', suppliedTarball], {
      env: {
        ...process.env,
        PATH: emptyBin,
      },
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /npm install/u);
    assert.doesNotMatch(output, /npm pack/u);
  } finally {
    await rm(emptyBin, { recursive: true, force: true });
  }
});
