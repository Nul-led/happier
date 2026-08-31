import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cleanupRetiredWorkspaceReplicationState,
  inspectRetiredWorkspaceReplicationState,
} from './workspaceSyncLegacyState';

async function makeServerDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'happier-workspace-sync-legacy-state-'));
}

describe('inspectRetiredWorkspaceReplicationState', () => {
  it('reports an absent legacy state root without creating anything', async () => {
    const activeServerDir = await makeServerDir();

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'abc123',
    })).resolves.toEqual({
      status: 'absent',
      path: join(activeServerDir, 'workspace-replication'),
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('quarantines an exact, owned v1 state root and writes a bounded retirement marker', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'cas'), { recursive: true });
    await mkdir(join(stateRoot, 'jobs'));
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1, jobId: 'job-1' }));
    await chmod(stateRoot, 0o700);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'abc123',
    });

    const quarantinePath = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-abc123');
    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
      schemaVersion: 1,
      quarantinePath,
    });
    await expect(stat(stateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const marker = JSON.parse(await readFile(join(quarantinePath, 'retirement.json'), 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_700_000_000_000,
      installationId: 'installation-test',
    });
    expect(typeof marker.inventoryHash).toBe('string');
    expect((await stat(quarantinePath)).mode & 0o777).toBe(0o700);

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('leaves a state root untouched when an unknown immediate child is present', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1 }));
    await writeFile(join(stateRoot, 'unexpected.txt'), 'do not touch');

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({ status: 'legacy_workspace_sync_state_unknown' });
    await expect(readFile(join(stateRoot, 'unexpected.txt'), 'utf8')).resolves.toBe('do not touch');
    await expect(readdir(activeServerDir)).resolves.toContain('workspace-replication');

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('still classifies a valid retired-v1 quarantine as unsupported on restart', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'cas'), { recursive: true });
    await mkdir(join(stateRoot, 'jobs'));
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1, jobId: 'job-1' }));
    await chmod(stateRoot, 0o700);

    const first = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'abc123',
    });
    if (first.status !== 'legacy_workspace_sync_state_unsupported') throw new Error('expected quarantine on first startup');
    const { quarantinePath, inventoryHash } = first;

    // A later restart sees the live root absent and must not forget the quarantine.
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir, installationId: 'installation-test' })).resolves.toEqual({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
      path: quarantinePath,
      quarantinePath,
      schemaVersion: 1,
      inventoryHash,
    });
    // The recognized quarantine is reported, never deleted or re-quarantined.
    await expect(stat(quarantinePath)).resolves.toBeTruthy();
    await expect(stat(stateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    // Repeated restarts stay stable and read-only.
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      quarantinePath,
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('removes only the exact unchanged quarantine during an explicit cleanup pass', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1 }));
    await chmod(stateRoot, 0o700);
    const inspection = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'cleanup',
    });
    if (inspection.status !== 'legacy_workspace_sync_state_unsupported') {
      throw new Error('expected retired workspace state');
    }

    await expect(cleanupRetiredWorkspaceReplicationState(inspection)).resolves.toEqual({ removed: true });
    await expect(stat(inspection.quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({ status: 'absent' });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('refuses explicit cleanup when the classified quarantine inventory changed', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1 }));
    await chmod(stateRoot, 0o700);
    const inspection = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'drift-before-cleanup',
    });
    if (inspection.status !== 'legacy_workspace_sync_state_unsupported') {
      throw new Error('expected retired workspace state');
    }
    await mkdir(join(inspection.quarantinePath, 'cas'));

    await expect(cleanupRetiredWorkspaceReplicationState(inspection)).rejects.toMatchObject({
      code: 'legacy_workspace_sync_state_changed',
    });
    await expect(stat(inspection.quarantinePath)).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails unknown when more than one valid retired quarantine is present', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    const quarantine = async (nowMs: number, randomSuffix: string) => {
      await mkdir(join(stateRoot, 'jobs'), { recursive: true });
      await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1 }));
      await chmod(stateRoot, 0o700);
      await inspectRetiredWorkspaceReplicationState({
        activeServerDir,
        installationId: 'installation-test',
        nowMs,
        randomSuffix,
      });
    };

    await quarantine(1_700_000_000_000, 'first');
    await quarantine(1_700_000_000_001, 'second');

    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'multiple_retired_quarantines',
    });
    await expect(readdir(activeServerDir)).resolves.toEqual(expect.arrayContaining([
      'workspace-replication.retired-v1-1700000000000-first',
      'workspace-replication.retired-v1-1700000000001-second',
    ]));

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails unknown and leaves the directory untouched when a retired-v1-shaped directory has no valid marker', async () => {
    const activeServerDir = await makeServerDir();
    const fake = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-junk');
    await mkdir(join(fake, 'jobs'), { recursive: true });
    await writeFile(join(fake, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1 }));

    // No marker at all.
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    // Malformed marker payload.
    await writeFile(join(fake, 'retirement.json'), JSON.stringify({ detectedSchemaVersion: 7 }));
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    // Marker timestamp disagreeing with the plan-owned directory name.
    await writeFile(join(fake, 'retirement.json'), JSON.stringify({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_234_567_890_123,
      installationId: 'installation-test',
      inventoryHash: 'a'.repeat(64),
    }));
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    // A symlink is never authoritative.
    const linked = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-link');
    await symlink(fake, linked);
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    // Never deleted or re-quarantined.
    await expect(stat(fake)).resolves.toBeTruthy();
    await expect(readFile(join(fake, 'retirement.json'), 'utf8')).resolves.toBe(JSON.stringify({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_234_567_890_123,
      installationId: 'installation-test',
      inventoryHash: 'a'.repeat(64),
    }));
    await expect(readFile(join(fake, 'jobs', 'job-1.json'), 'utf8')).resolves.toBe('{"schemaVersion":1}');

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails unknown when the retirement marker inventory hash no longer matches the directory', async () => {
    const activeServerDir = await makeServerDir();
    const drifted = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-drift');
    await mkdir(join(drifted, 'staging'), { recursive: true });
    await writeFile(join(drifted, 'retirement.json'), JSON.stringify({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_700_000_000_000,
      installationId: 'installation-test',
      inventoryHash: 'f'.repeat(64),
    }));

    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    await expect(stat(drifted)).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('ignores similarly named directories that do not match the exact plan-owned quarantine shape', async () => {
    const activeServerDir = await makeServerDir();
    await mkdir(join(activeServerDir, 'workspace-replication.retired-v1'), { recursive: true });
    await mkdir(join(activeServerDir, 'workspace-replication.backed-up-by-user'), { recursive: true });

    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'absent',
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed when the state root is group/other writable', async () => {
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1 }));
    await chmod(stateRoot, 0o777);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({ status: 'legacy_workspace_sync_state_unknown' });
    await expect(stat(stateRoot)).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });
});
