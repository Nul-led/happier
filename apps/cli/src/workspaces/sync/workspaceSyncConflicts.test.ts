import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const openObserver = vi.hoisted(() => ({
  current: null as null | ((path: string) => Promise<void>),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      await openObserver.current?.(String(args[0]));
      return await actual.open(...args);
    },
  };
});

import {
  applyCapturedWorkspaceSyncEntryAtRoot,
  captureWorkspaceSyncEntryAtRoot,
} from './workspaceSyncConflicts';
import { observeWorkspaceSyncEntryAtRoot } from './workspaceSyncFileRead';

describe('reviewed workspace entry replacement', () => {
  it.skipIf(process.platform !== 'linux')('rejects a directory child changed while held-descriptor capture descends', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-source-'));
    const materialRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-material-'));
    const sourceFile = join(sourceRoot, 'tree', 'child.txt');
    await mkdir(join(sourceRoot, 'tree'));
    await writeFile(sourceFile, 'reviewed');
    const expected = await observeWorkspaceSyncEntryAtRoot({ rootPath: sourceRoot, relativePath: 'tree' });
    openObserver.current = async (path) => {
      if (path.startsWith(materialRoot) && path.endsWith('/child.txt')) {
        openObserver.current = null;
        await writeFile(sourceFile, 'changed');
      }
    };
    try {
      await expect(captureWorkspaceSyncEntryAtRoot({
        rootPath: sourceRoot, relativePath: 'tree', expected,
        captureDirectory: materialRoot, operationId: 'resolution-child-drift',
      })).rejects.toMatchObject({ code: 'conflict_changed' });
    } finally {
      openObserver.current = null;
      await Promise.all([sourceRoot, materialRoot].map(async (path) => await rm(path, { recursive: true, force: true })));
    }
  });
  it.skipIf(process.platform !== 'linux')('captures the approved bytes before replacing a changed destination', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-source-'));
    const targetRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-target-'));
    const materialRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-material-'));
    const recoveryRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-recovery-'));
    await writeFile(join(sourceRoot, 'value.bin'), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(targetRoot, 'value.bin'), 'old');
    const sourceExpected = {
      kind: 'file' as const,
      digest: createHash('sha1').update(Buffer.from([0, 1, 2, 255])).digest('hex'),
      executable: false,
      size: 4,
    };
    const targetExpected = {
      kind: 'file' as const,
      digest: createHash('sha1').update('old').digest('hex'),
      executable: false,
      size: 3,
    };

    const captured = await captureWorkspaceSyncEntryAtRoot({
      rootPath: sourceRoot,
      relativePath: 'value.bin',
      expected: sourceExpected,
      captureDirectory: materialRoot,
      operationId: 'resolution-1',
    });
    await writeFile(join(sourceRoot, 'value.bin'), 'newer source');
    await expect(applyCapturedWorkspaceSyncEntryAtRoot({
      rootPath: targetRoot,
      relativePath: 'value.bin',
      expectedDestination: targetExpected,
      selectedExpectation: sourceExpected,
      materialPath: captured.materialPath,
      recoveryDirectory: recoveryRoot,
      operationId: 'resolution-1',
    })).resolves.toEqual({ status: 'installed' });
    await expect(readFile(join(targetRoot, 'value.bin'))).resolves.toEqual(Buffer.from([0, 1, 2, 255]));

    await Promise.all([sourceRoot, targetRoot, materialRoot, recoveryRoot].map(async (path) => await rm(path, { recursive: true, force: true })));
  });

  it.skipIf(process.platform !== 'linux')('binds a directory subtree and rejects a destination that gained a child', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-source-'));
    const targetRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-target-'));
    const materialRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-material-'));
    const recoveryRoot = await mkdtemp(join(tmpdir(), 'workspace-sync-resolution-recovery-'));
    await mkdir(join(sourceRoot, 'tree'));
    await writeFile(join(sourceRoot, 'tree', 'source.txt'), 'source');
    await mkdir(join(targetRoot, 'tree'));
    await writeFile(join(targetRoot, 'tree', 'old.txt'), 'old');
    const sourceExpected = await observeWorkspaceSyncEntryAtRoot({ rootPath: sourceRoot, relativePath: 'tree' });
    const targetExpected = await observeWorkspaceSyncEntryAtRoot({ rootPath: targetRoot, relativePath: 'tree' });
    const captured = await captureWorkspaceSyncEntryAtRoot({
      rootPath: sourceRoot,
      relativePath: 'tree',
      expected: sourceExpected,
      captureDirectory: materialRoot,
      operationId: 'resolution-directory',
    });
    await writeFile(join(targetRoot, 'tree', 'concurrent.txt'), 'external');

    await expect(applyCapturedWorkspaceSyncEntryAtRoot({
      rootPath: targetRoot,
      relativePath: 'tree',
      expectedDestination: targetExpected,
      selectedExpectation: sourceExpected,
      materialPath: captured.materialPath,
      recoveryDirectory: recoveryRoot,
      operationId: 'resolution-directory',
    })).rejects.toMatchObject({ code: 'conflict_changed' });
    await expect(readFile(join(targetRoot, 'tree', 'concurrent.txt'), 'utf8')).resolves.toBe('external');

    await Promise.all([sourceRoot, targetRoot, materialRoot, recoveryRoot].map(async (path) => await rm(path, { recursive: true, force: true })));
  });
});
