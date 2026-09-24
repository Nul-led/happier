import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import * as artifacts from './index.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it.each(['linux', 'windows'])('builds only the requested %s difftastic executable and license through the real archive unpacker', async (os) => {
  const root = await mkdtemp(join(tmpdir(), 'optional-difft-fixture-'));
  roots.push(root);
  const scripts = join(root, 'apps/cli/scripts');
  const archives = join(root, 'apps/cli/tools/archives');
  const staging = join(root, 'staging');
  await Promise.all([mkdir(scripts, { recursive: true }), mkdir(archives, { recursive: true }), mkdir(staging)]);
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  await copyFile(join(repoRoot, 'apps/cli/scripts/unpack-tools.cjs'), join(scripts, 'unpack-tools.cjs'));
  await symlink(join(repoRoot, 'node_modules'), join(scripts, 'node_modules'), 'junction');
  const exeExt = os === 'windows' ? '.exe' : '';
  const binaryName = `difft${exeExt}`;
  await writeFile(join(staging, binaryName), `${os} difft fixture`);
  const archiveName = `difftastic-x64-${os === 'windows' ? 'win32' : os}.tar.gz`;
  const archivePath = join(archives, archiveName);
  execFileSync('tar', ['-czf', archivePath, '-C', staging, binaryName]);
  const sha = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  await writeFile(join(archives, 'checksums.sha256'), `${sha}  ${archiveName}\n`);
  await writeFile(join(archives, 'difftastic-LICENSE'), 'difftastic license');
  const payloadDir = join(root, 'payload');
  await artifacts.buildCliOptionalComponentArtifactPayload({
    repoRoot: root, payloadDir, componentId: 'happier-difftastic',
    target: { os, arch: 'x64', bunTarget: `bun-${os}-x64`, exeExt },
  });
  expect((await readdir(payloadDir)).sort()).toEqual([binaryName, 'difftastic-LICENSE'].sort());
  expect(await readFile(join(payloadDir, binaryName), 'utf8')).toBe(`${os} difft fixture`);
  expect(await readFile(join(payloadDir, 'difftastic-LICENSE'), 'utf8')).toBe('difftastic license');
  if (process.platform !== 'win32') expect((await stat(join(payloadDir, binaryName))).mode & 0o111).not.toBe(0);
});

it('produces an independently resolvable target-specific memory runtime, preserving licenses and shared libraries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'optional-memory-fixture-'));
  roots.push(root);
  const put = async (relativePath: string, bytes: string) => {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  };
  await put('package.json', JSON.stringify({ name: 'fixture' }));
  await put('apps/cli/package.json', JSON.stringify({ name: '@happier-dev/cli', dependencies: { '@huggingface/transformers': '3.0.0' } }));
  await put('node_modules/@huggingface/transformers/package.json', JSON.stringify({
    name: '@huggingface/transformers', version: '3.0.0', main: 'dist/transformers.node.mjs',
    dependencies: { 'onnxruntime-node': '1.0.0' },
  }));
  await put('node_modules/@huggingface/transformers/dist/transformers.node.mjs', 'export const pipeline = true;');
  await put('node_modules/@huggingface/transformers/LICENSE', 'transformers license');
  for (const name of ['index.d.ts', 'index.d.mts', 'index.d.cts', 'index.js.map', 'cache.tsbuildinfo']) {
    await put(`node_modules/@huggingface/transformers/dist/${name}`, 'non-runtime metadata');
  }
  await put('node_modules/@huggingface/transformers/dist/runtime.json', '{}');
  await put('node_modules/@huggingface/transformers/dist/runtime.cjs', 'module.exports = {};');
  await put('node_modules/onnxruntime-node/package.json', JSON.stringify({ name: 'onnxruntime-node', version: '1.0.0', main: 'index.js' }));
  await put('node_modules/onnxruntime-node/index.js', 'module.exports = {};');
  await put('node_modules/onnxruntime-node/LICENSE', 'onnx license');
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const arch of ['arm64', 'x64']) {
      await put(`node_modules/onnxruntime-node/bin/napi-v3/${platform}/${arch}/onnxruntime_binding.node`, `${platform}/${arch}`);
      await put(`node_modules/onnxruntime-node/bin/napi-v3/${platform}/${arch}/libonnxruntime.so`, 'provider library');
    }
  }
  const payloadDir = join(root, 'payload');
  await artifacts.buildCliOptionalComponentArtifactPayload({
    repoRoot: root, payloadDir, componentId: 'happier-memory-runtime',
    target: { os: 'darwin', arch: 'arm64', bunTarget: 'bun-darwin-arm64', exeExt: '' },
  });
  const transformers = join(payloadDir, 'node_modules/@huggingface/transformers');
  expect(await realpath(createRequire(join(payloadDir, 'entry.js')).resolve('@huggingface/transformers')))
    .toBe(await realpath(join(transformers, 'dist/transformers.node.mjs')));
  expect(await readFile(join(transformers, 'dist/transformers.node.mjs'), 'utf8')).toContain('pipeline');
  expect(await readFile(join(transformers, 'LICENSE'), 'utf8')).toBe('transformers license');
  expect((await readdir(join(transformers, 'dist'))).sort()).toEqual(['index.js.map', 'runtime.cjs', 'runtime.json', 'transformers.node.mjs']);
  const onnx = join(transformers, 'node_modules/onnxruntime-node');
  expect(await readdir(join(onnx, 'bin/napi-v3'))).toEqual(['darwin']);
  expect(await readdir(join(onnx, 'bin/napi-v3/darwin'))).toEqual(['arm64']);
  expect(await readFile(join(onnx, 'bin/napi-v3/darwin/arm64/libonnxruntime.so'), 'utf8')).toBe('provider library');
  expect(await readFile(join(onnx, 'LICENSE'), 'utf8')).toBe('onnx license');
});

it('produces an independently resolvable target-specific voice runtime with only the selected Sherpa native package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'optional-voice-fixture-'));
  roots.push(root);
  const put = async (relativePath: string, bytes: string) => {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  };
  await put('package.json', JSON.stringify({ name: 'fixture' }));
  await put('apps/cli/package.json', JSON.stringify({
    name: '@happier-dev/cli',
    dependencies: { 'sherpa-onnx-node': '1.0.0' },
  }));
  await put('node_modules/sherpa-onnx-node/package.json', JSON.stringify({
    name: 'sherpa-onnx-node',
    version: '1.0.0',
    main: 'sherpa-onnx.js',
    optionalDependencies: {
      'sherpa-onnx-darwin-arm64': '1.0.0',
      'sherpa-onnx-linux-x64': '1.0.0',
    },
  }));
  await put('node_modules/sherpa-onnx-node/sherpa-onnx.js', 'module.exports = { OnlineRecognizer: class OnlineRecognizer {} };');
  await put('node_modules/sherpa-onnx-node/LICENSE', 'sherpa wrapper license');
  for (const [packageName, marker] of [
    ['sherpa-onnx-darwin-arm64', 'darwin-arm64'],
    ['sherpa-onnx-linux-x64', 'linux-x64'],
  ] as const) {
    await put(`node_modules/${packageName}/package.json`, JSON.stringify({ name: packageName, version: '1.0.0' }));
    await put(`node_modules/${packageName}/sherpa-onnx.node`, marker);
    await put(`node_modules/${packageName}/LICENSE`, `${marker} license`);
  }

  const payloadDir = join(root, 'payload');
  await artifacts.buildCliOptionalComponentArtifactPayload({
    repoRoot: root,
    payloadDir,
    componentId: 'happier-voice-runtime',
    target: { os: 'darwin', arch: 'arm64', bunTarget: 'bun-darwin-arm64', exeExt: '' },
  });

  expect(await realpath(createRequire(join(payloadDir, 'entry.js')).resolve('sherpa-onnx-node')))
    .toBe(await realpath(join(payloadDir, 'node_modules/sherpa-onnx-node/sherpa-onnx.js')));
  expect(await readFile(join(payloadDir, 'node_modules/sherpa-onnx-node/LICENSE'), 'utf8')).toBe('sherpa wrapper license');
  expect(await readFile(join(payloadDir, 'node_modules/sherpa-onnx-node/node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node'), 'utf8')).toBe('darwin-arm64');
  await expect(stat(join(payloadDir, 'node_modules/sherpa-onnx-node/node_modules/sherpa-onnx-linux-x64'))).rejects.toMatchObject({ code: 'ENOENT' });
});
