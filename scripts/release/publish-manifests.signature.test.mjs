import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const publishManifestsPath = join(repoRoot, 'scripts', 'pipeline', 'release', 'publish-manifests.mjs');

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'publish-manifests-signature-test-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runPublishManifests({ artifactsDir, outDir, product = 'happier', version = '1.2.3' }) {
  return spawnSync(
    process.execPath,
    [
      publishManifestsPath,
      `--product=${product}`,
      '--channel=stable',
      `--version=${version}`,
      `--artifacts-dir=${artifactsDir}`,
      `--out-dir=${outDir}`,
      '--assets-base-url=https://example.com/downloads/cli-stable',
      '--commit-sha=deadbeef',
      '--workflow-run-id=123',
    ],
    { encoding: 'utf-8' }
  );
}

test('publish-manifests projects Runner bounds only from the signed checksum envelope', async () => {
  await withTempDir(async (dir) => {
    const artifactsDir = join(dir, 'artifacts');
    const outDir = join(dir, 'out');
    const product = 'happier-runner';
    const version = '0.3.0';
    const archiveName = `${product}-v${version}-linux-x64.zip`;
    const checksumsName = `checksums-${product}-v${version}.txt`;
    const metadata = { sizeBytes: 321, entries: [{ path: 'happier-runner', kind: 'file', sizeBytes: 300, mode: 0o755 }] };
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, archiveName), 'archive', 'utf-8');
    await writeFile(join(artifactsDir, checksumsName), [
      `${'a'.repeat(64)}  ${archiveName}`,
      `# happier-artifact-v1 ${JSON.stringify({ name: archiveName, ...metadata })}`,
      '',
    ].join('\n'), 'utf-8');
    await writeFile(join(artifactsDir, `${checksumsName}.minisig`), 'signature', 'utf-8');

    const result = runPublishManifests({ artifactsDir, outDir, product, version });
    assert.equal(result.status, 0, result.stderr);
    const latest = JSON.parse(await readFile(join(outDir, 'v1', product, 'stable', 'latest.json'), 'utf-8'));
    assert.deepEqual({ sizeBytes: latest.records[0].sizeBytes, entries: latest.records[0].entries }, metadata);

    await writeFile(join(artifactsDir, checksumsName), `${'a'.repeat(64)}  ${archiveName}\n`, 'utf-8');
    const missing = runPublishManifests({ artifactsDir, outDir: join(dir, 'missing'), product, version });
    assert.notEqual(missing.status, 0);
    assert.match(`${missing.stdout}\n${missing.stderr}`, /signed Runner archive metadata missing/i);
  });
});

test('publish-manifests fails when minisign signature asset is missing', async () => {
  await withTempDir(async (dir) => {
    const artifactsDir = join(dir, 'artifacts');
    const outDir = join(dir, 'out');
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, 'happier-v1.2.3-linux-x64.tar.gz'), 'archive', 'utf-8');
    await writeFile(
      join(artifactsDir, 'checksums-happier-v1.2.3.txt'),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  happier-v1.2.3-linux-x64.tar.gz\n',
      'utf-8'
    );

    const result = runPublishManifests({ artifactsDir, outDir });
    const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.match(combinedOutput, /minisign|signature/i);
  });
});

test('publish-manifests emits signature URL when minisign asset exists', async () => {
  await withTempDir(async (dir) => {
    const artifactsDir = join(dir, 'artifacts');
    const outDir = join(dir, 'out');
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, 'happier-v1.2.3-linux-x64.tar.gz'), 'archive', 'utf-8');
    await writeFile(
      join(artifactsDir, 'checksums-happier-v1.2.3.txt'),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  happier-v1.2.3-linux-x64.tar.gz\n',
      'utf-8'
    );
    await writeFile(join(artifactsDir, 'checksums-happier-v1.2.3.txt.minisig'), 'signature', 'utf-8');

    const result = runPublishManifests({ artifactsDir, outDir });
    assert.equal(result.status, 0, result.stderr);

    const latest = JSON.parse(
      await readFile(join(outDir, 'v1', 'happier', 'stable', 'latest.json'), 'utf-8')
    );
    assert.equal(latest.records.length, 1);
    assert.equal(
      latest.records[0].signature,
      'https://example.com/downloads/cli-stable/checksums-happier-v1.2.3.txt.minisig'
    );
  });
});

test('publish-manifests fails closed on malformed checksum lines', async () => {
  await withTempDir(async (dir) => {
    const artifactsDir = join(dir, 'artifacts');
    const outDir = join(dir, 'out');
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(join(artifactsDir, 'happier-v1.2.3-linux-x64.tar.gz'), 'archive', 'utf-8');
    await writeFile(
      join(artifactsDir, 'checksums-happier-v1.2.3.txt'),
      [
        'malformed checksum line',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  happier-v1.2.3-linux-x64.tar.gz',
        '',
      ].join('\n'),
      'utf-8'
    );
    await writeFile(join(artifactsDir, 'checksums-happier-v1.2.3.txt.minisig'), 'signature', 'utf-8');

    const result = runPublishManifests({ artifactsDir, outDir });
    const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0);
    assert.match(combinedOutput, /invalid checksum line/i);
  });
});
