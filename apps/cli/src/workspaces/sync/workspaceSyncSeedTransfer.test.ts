import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createScmBackendRegistry } from '@/scm/registry';
import {
  createWorkspaceSyncSeedExport,
  materializeLocalWorkspaceSyncSeed,
  materializeWorkspaceSyncSeedExport,
} from './workspaceSyncSeedTransfer';

describe('workspace sync seed transfer', () => {
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
          receipt: {
            v: 1,
            previousTargetName: null,
            originalTargetIdentity: null,
            promotedTargetIdentity: null,
            expectedBackupIdentity: null,
          },
          bindPromotedTarget: async () => undefined,
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
