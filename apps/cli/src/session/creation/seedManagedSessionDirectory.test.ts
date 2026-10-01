import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pluginReloadController } from '@/plugins/runtime/reload/singleton';
import { resolveExecutablePluginRuntimeRegistry } from '@/plugins/runtime/resolveExecutablePluginRuntimeRegistry';
import type { PluginRuntimeRegistryLease } from '@/plugins/runtime/reload/controller';
import { createManagedSessionDirectories } from './managedSessionDirectories';
import { seedManagedSessionDirectory } from './seedManagedSessionDirectory';
import { deriveSessionCreationTagV1 } from '@happier-dev/protocol';

describe('managed fork workspace seeding', () => {
  let runtimeLease: PluginRuntimeRegistryLease | null = null;
  beforeAll(async () => {
    runtimeLease = await pluginReloadController.acquireRuntimeRegistry({
      resolveRuntimeRegistry: () => resolveExecutablePluginRuntimeRegistry({ pluginIds: [] }),
    });
  });
  afterAll(async () => { await runtimeLease?.release(); await pluginReloadController.shutdown(); });
  it.each(['source', 'child'] as const)('copies a plain source workspace privately and deleting %s cannot remove the other copy', async (removed) => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-managed-fork-seed-'));
    try {
      const owner = createManagedSessionDirectories({ activeServerDir });
      const source = await owner.materializeForFreshSpawn({ sessionCreationTag: 'source-tag' });
      await owner.bind({ allocationId: source.allocationId, sessionId: 'source' });
      await writeFile(join(source.directory, '.gitignore'), 'notes.txt');
      await writeFile(join(source.directory, 'notes.txt'), 'source files');
      const childTag = deriveSessionCreationTagV1({ callerCreationNamespace: 'session.fork:source', creationKey: 'child' });
      const child = await owner.materializeForFreshSpawn({ sessionCreationTag: childTag });
      expect(await seedManagedSessionDirectory({ activeServerDir, sessionCreationTag: childTag, targetPath: child.directory,
        seed: { sourceSessionId: 'source', sourceSessionCreationTag: 'source-tag', sourcePath: source.directory },
      })).toEqual({ ok: true });
      expect(child.directory).not.toBe(source.directory);
      expect(await readFile(join(child.directory, 'notes.txt'), 'utf8')).toBe('source files');
      if (process.platform !== 'win32') expect((await stat(child.directory)).mode & 0o777).toBe(0o700);
      await owner.bind({ allocationId: child.allocationId, sessionId: 'child' });
      await owner.removeForSession({ sessionId: removed, stopSession: async () => ({ status: 'stopped' }) });
      const retained = removed === 'source' ? child : source;
      expect(await readFile(join(retained.directory, 'notes.txt'), 'utf8')).toBe('source files');
      await expect(access((removed === 'source' ? source : child).directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(activeServerDir, { recursive: true, force: true }); }
  });

  it('returns the typed missing-directory result for unproven source paths without touching their files', async () => {
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-managed-fork-proof-'));
    try {
      const owner = createManagedSessionDirectories({ activeServerDir });
      const target = await owner.materializeForFreshSpawn({ sessionCreationTag: 'child-tag' });
      await writeFile(join(activeServerDir, 'private.txt'), 'not an allocation');
      expect(await seedManagedSessionDirectory({ activeServerDir, sessionCreationTag: 'child-tag', targetPath: target.directory,
        seed: { sourceSessionId: 'unproven-session', sourcePath: activeServerDir },
      })).toEqual({ ok: false, errorCode: 'SESSION_DIRECTORY_MISSING' });
      expect(await readFile(join(activeServerDir, 'private.txt'), 'utf8')).toBe('not an allocation');
    } finally { await rm(activeServerDir, { recursive: true, force: true }); }
  });
});
