import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { inspectRetiredWorkspaceReplicationState } from './workspaceSyncLegacyState';

async function makeServerDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'happier-workspace-sync-legacy-state-'));
}

/**
 * Stands in for the canonical Windows protected-ACL boundary (the real one
 * shells out to System32 tools). `rejectPaths` models every non-ok boundary
 * result the owner must fail closed on: a broad or inherited DACL, an
 * unresolved owner, a reparse point, or an unavailable PowerShell inspection.
 */
function windowsAclBoundaryStub(rejectPaths: readonly string[] = []) {
  const reject = (path: string) => {
    if (rejectPaths.includes(path)) throw new Error(`Windows protected path has an unsafe ACL entry: ${path}`);
  };
  return {
    verify: vi.fn(async (input: Readonly<{ path: string }>) => { reject(input.path); }),
    applyAndVerify: vi.fn(async (input: Readonly<{ path: string }>) => { reject(input.path); }),
  };
}

async function makeLegacyStateRoot(activeServerDir: string): Promise<string> {
  const stateRoot = join(activeServerDir, 'workspace-replication');
  await mkdir(join(stateRoot, 'cas'), { recursive: true });
  await mkdir(join(stateRoot, 'jobs'));
  await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1, jobId: 'job-1' }));
  await chmod(stateRoot, 0o700);
  return stateRoot;
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

  it('fails closed on Windows when the canonical protected-ACL boundary rejects, however private the POSIX mode looks', async () => {
    const activeServerDir = await makeServerDir();
    const canonicalServerDir = await realpath(activeServerDir);
    const stateRoot = await makeLegacyStateRoot(activeServerDir);
    const canonicalStateRoot = join(canonicalServerDir, 'workspace-replication');

    // The state root is 0o700 and owned by this user: POSIX mode bits are never
    // a Windows privacy proof.
    const rejectedState = windowsAclBoundaryStub([canonicalStateRoot]);
    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      platform: 'win32',
      windowsAclBoundary: rejectedState,
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'ownership_or_permissions',
    });
    expect(rejectedState.verify).toHaveBeenCalledWith({ path: canonicalStateRoot, kind: 'directory' });

    // The containing active server directory carries the same requirement.
    const rejectedParent = windowsAclBoundaryStub([canonicalServerDir]);
    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      platform: 'win32',
      windowsAclBoundary: rejectedParent,
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'parent_ownership_or_permissions',
    });

    // Nothing was quarantined or otherwise mutated.
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readdir(activeServerDir)).resolves.toEqual(['workspace-replication']);

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('quarantines on Windows once the protected-ACL boundary verifies, and protects the quarantine natively', async () => {
    const activeServerDir = await makeServerDir();
    await makeLegacyStateRoot(activeServerDir);
    const windowsAclBoundary = windowsAclBoundaryStub();

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'winok',
      platform: 'win32',
      windowsAclBoundary,
    });

    const quarantinePath = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-winok');
    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
      quarantinePath,
    });
    expect(windowsAclBoundary.applyAndVerify).toHaveBeenCalledWith({ path: quarantinePath, kind: 'directory' });

    // A restart re-proves the quarantine through the same boundary and fails
    // closed when it can no longer be proven private.
    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      platform: 'win32',
      windowsAclBoundary: windowsAclBoundaryStub([quarantinePath]),
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'malformed_retired_quarantine',
    });
    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      platform: 'win32',
      windowsAclBoundary: windowsAclBoundaryStub(),
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      quarantinePath,
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed when POSIX quarantine permissions cannot be established', async () => {
    const activeServerDir = await makeServerDir();
    await makeLegacyStateRoot(activeServerDir);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'chmodfail',
      platform: 'linux',
      setPosixPrivatePermissions: async () => {
        throw Object.assign(new Error('chmod denied'), { code: 'EPERM' });
      },
    });

    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'quarantine_permissions_failed',
    });
    await expect(stat(join(
      activeServerDir,
      'workspace-replication.retired-v1-1700000000000-chmodfail',
    ))).resolves.toBeTruthy();
    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('rechecks the renamed POSIX quarantine instead of trusting a successful permission call', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = await makeLegacyStateRoot(activeServerDir);
    await chmod(stateRoot, 0o755);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'chmodnoop',
      platform: 'linux',
      setPosixPrivatePermissions: async () => undefined,
    });

    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'quarantine_permissions_failed',
    });
    await rm(activeServerDir, { recursive: true, force: true });
  });
});
