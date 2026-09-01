import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createScmBackendRegistry } from '@/scm/registry';
import {
  createWorkspaceSyncSeedExport,
  createWorkspaceSyncSeedTunnelHttpProxy,
  materializeLocalWorkspaceSyncSeed,
  materializeWorkspaceSyncSeedExport,
} from './workspaceSyncSeedTransfer';

describe('workspace sync seed transfer', () => {
  it('requires the lease capability before opening the private machine tunnel', async () => {
    const capability = 'a'.repeat(64);
    let acceptedConnections = 0;
    let observedApplicationRequest = Buffer.alloc(0);
    const target = createServer((socket) => {
      acceptedConnections += 1;
      let received = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        received = Buffer.concat([received, typeof chunk === 'string' ? Buffer.from(chunk) : chunk]);
        if (received.byteLength < capability.length || !received.subarray(0, capability.length).equals(Buffer.from(capability))) return;
        const headerEnd = received.indexOf('\r\n\r\n', capability.length);
        if (headerEnd < 0) return;
        const applicationRequest = received.subarray(capability.length);
        const contentLengthMatch = applicationRequest.subarray(0, headerEnd - capability.length)
          .toString('latin1')
          .match(/\r\ncontent-length:\s*(\d+)(?:\r\n|$)/i);
        const expectedLength = headerEnd - capability.length + 4 + Number(contentLengthMatch?.[1] ?? 0);
        if (applicationRequest.byteLength < expectedLength) return;
        observedApplicationRequest = applicationRequest.subarray(0, expectedLength);
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok');
      });
    });
    await new Promise<void>((resolve, reject) => {
      target.once('error', reject);
      target.listen(0, '127.0.0.1', resolve);
    });
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('target did not bind');
    const proxy = await createWorkspaceSyncSeedTunnelHttpProxy({
      localPort: address.port,
      localCapability: capability,
      observedPath: 'direct',
      close: async () => {},
    });
    try {
      await expect(fetch(`http://127.0.0.1:${proxy.localPort}/seed`)).rejects.toThrow();
      expect(acceptedConnections).toBe(0);
      await expect(fetch(`http://127.0.0.1:${proxy.localPort}/seed`, {
        headers: { 'X-Happier-Machine-Local-Capability': 'b'.repeat(64) },
      })).rejects.toThrow();
      expect(acceptedConnections).toBe(0);
      const response = await fetch(`http://127.0.0.1:${proxy.localPort}/seed`, {
        method: 'POST',
        headers: { ...proxy.requestHeaders, 'X-Happier-Test-Preserved': 'yes' },
        body: 'seed-body',
      });
      expect(await response.text()).toBe('ok');
      expect(acceptedConnections).toBe(1);
      const observedText = observedApplicationRequest.toString('latin1');
      expect(observedText.toLowerCase()).toContain('x-happier-test-preserved: yes\r\n');
      expect(observedText).toContain('\r\n\r\nseed-body');
      expect(observedText.toLowerCase()).not.toContain('x-happier-machine-local-capability');
      expect(observedApplicationRequest.includes(Buffer.from(capability))).toBe(false);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it('publishes SCM artifacts as a manifest plus digest-addressed finite transfers', async () => {
    const source = await mkdtemp(join(tmpdir(), 'happier-sync-seed-source-'));
    const file = join(source, 'hello.txt');
    await writeFile(file, 'hello seed', 'utf8');
    const prepared = await createWorkspaceSyncSeedExport({
      operationId: 'copy-1',
      activeServerDir: source,
      sourcePath: source,
      workspaceTransfer: { includeIgnoredMode: 'exclude', ignoredIncludeGlobs: [] },
      registry: createScmBackendRegistry([]),
    });

    const envelope = JSON.parse((prepared.payloadSource.kind === 'buffer'
      ? prepared.payloadSource.payload
      : Buffer.alloc(0)).toString('utf8')) as { blobTransferIds: Record<string, string> };
    const digest = Object.keys(envelope.blobTransferIds)[0]!;
    const blob = await prepared.onDemandScope.resolvePayloadSourceOnOpen({
      transferId: envelope.blobTransferIds[digest]!,
      requestBody: {},
    });
    expect(blob.kind).toBe('file');
    expect(blob.kind === 'file' ? await readFile(blob.filePath, 'utf8') : null).toBe('hello seed');
    expect(prepared.onDemandScope.allowTransferId('copy-1:blob:not-authorized')).toBe(false);
  });

  it('materializes the received SCM artifact envelope through the canonical target owner', async () => {
    const target = await mkdtemp(join(tmpdir(), 'happier-sync-seed-target-'));
    const digest = 'sha256:seed';
    const envelope = Buffer.from(JSON.stringify({
      v: 1,
      workspaceExportArtifacts: {
        manifest: { entries: [{ relativePath: 'hello.txt', kind: 'file', digest, sizeBytes: 10, executable: false }] },
      },
      blobTransferIds: { [digest]: `copy-1:blob:${createHash('sha256').update(digest).digest('hex')}` },
    }), 'utf8');
    const materialize: Parameters<typeof materializeWorkspaceSyncSeedExport>[0]['materializeWorkspaceExportArtifacts'] = async (input) => {
      const blobPath = input.blobProvider.getBlobFilePath(digest)!;
      await writeFile(join(target, 'observed.txt'), await readFile(blobPath));
      return {
        targetPath: input.targetPath,
        custody: {
          receipt: { v: 1, previousTargetName: null },
          commit: async () => undefined,
          abort: async () => undefined,
        },
      };
    };

    const custody = await materializeWorkspaceSyncSeedExport({
      operationId: 'copy-1',
      targetPath: target,
      stagingDirectory: target,
      requestPayload: async ({ transferId, destinationPath }) => {
        const payload = transferId === 'copy-1' ? envelope : Buffer.from('hello seed', 'utf8');
        await writeFile(destinationPath, payload);
      },
      materializeWorkspaceExportArtifacts: materialize,
    });
    expect(await readFile(join(target, 'observed.txt'), 'utf8')).toBe('hello seed');
    await custody.commit();
  });

  it('materializes a same-machine all-files seed with rollback custody', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'happier-sync-local-seed-'));
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    await Promise.all([mkdir(source), mkdir(target)]);
    await writeFile(join(source, 'new.txt'), 'new');
    await writeFile(join(target, 'old.txt'), 'old');
    try {
      const custody = await materializeLocalWorkspaceSyncSeed({
        operationId: 'relationship-local',
        activeServerDir: fixture,
        sourcePath: source,
        targetPath: target,
        workspaceTransfer: { includeIgnoredMode: 'include_selected', ignoredIncludeGlobs: [] },
        registry: createScmBackendRegistry([]),
      });
      await expect(readFile(join(target, 'new.txt'), 'utf8')).resolves.toBe('new');
      await custody.abort();
      await expect(readFile(join(target, 'old.txt'), 'utf8')).resolves.toBe('old');
      await expect(readFile(join(target, 'new.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
