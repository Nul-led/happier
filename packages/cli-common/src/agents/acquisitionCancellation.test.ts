import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { downloadGitHubReleaseAsset } from './downloadGitHubReleaseAsset';
import { extractGitHubReleaseAsset } from './extractGitHubReleaseAsset';
import { fetchNodeRuntimeReleaseAsset } from './nodeRelease';

test('download abort closes a streaming response and leaves no published asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acquisition-cancel-'));
  const destinationPath = join(root, 'asset');
  const controller = new AbortController();
  let responseClosed = false;
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.write('partial');
    res.on('close', () => { responseClosed = true; });
    controller.abort();
    // A finite fallback makes the missing-cancellation RED fail rather than hang.
    const timer = setTimeout(() => res.end('complete'), 100);
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const url = `http://127.0.0.1:${address.port}/asset`;
    const operation = downloadGitHubReleaseAsset({ url, destinationPath, signal: controller.signal });
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(readFile(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${destinationPath}.download`)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
  expect(responseClosed).toBe(true);
});

test('a canceled raw asset extraction preserves its source and existing destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'extract-cancel-'));
  const archivePath = join(root, 'download');
  const outputPath = join(root, 'binary');
  await writeFile(archivePath, 'new');
  await writeFile(outputPath, 'existing');
  try {
    await expect(extractGitHubReleaseAsset({ archivePath, archiveName: 'binary', extractDir: join(root, 'extract'), outputPath, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readFile(outputPath, 'utf8')).toBe('existing');
    expect(await readFile(archivePath, 'utf8')).toBe('new');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Node release lookup cancels its real fetch transport', async () => {
  const controller = new AbortController();
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('[');
    controller.abort();
    const timer = setTimeout(() => res.end(']'), 100);
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    // The test server substitutes only the external HTTP service.
    const fetchImpl: typeof fetch = (_url, init) => fetch(`http://127.0.0.1:${address.port}`, init);
    const operation = fetchNodeRuntimeReleaseAsset({ signal: controller.signal, fetchImpl });
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
