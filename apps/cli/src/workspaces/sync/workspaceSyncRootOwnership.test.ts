import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';

describe('workspace root ownership', () => {
  it('rejects both ancestor and descendant overlaps', async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), 'workspace-sync-root-locks-'));
    const manager = createWorkspaceRootOwnershipManager({ lockDirectory });
    const root = await manager.tryAcquire({ ownerId: 'one', canonicalRoot: '/tmp/ws-owner', operation: 'sync' });
    expect('kind' in root).toBe(false);
    const descendant = await manager.tryAcquire({ ownerId: 'two', canonicalRoot: '/tmp/ws-owner/child', operation: 'handoff' });
    expect(descendant).toMatchObject({ kind: 'overlap', existing: { ownerId: 'one' } });
    await (root as Exclude<typeof root, { kind: 'overlap' }>).release();
    const parent = await manager.tryAcquire({ ownerId: 'three', canonicalRoot: '/tmp/ws-owner-parent', operation: 'sync' });
    expect('kind' in parent).toBe(false);
    const exact = await manager.tryAcquire({ ownerId: 'four', canonicalRoot: '/tmp/ws-owner-parent', operation: 'bootstrap' });
    expect(exact).toMatchObject({ kind: 'overlap' });
    await (parent as Exclude<typeof parent, { kind: 'overlap' }>).release();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  it('persists daemon-local ownership so a reconstructed manager cannot steal a live root', async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), 'workspace-sync-root-locks-'));
    const firstManager = createWorkspaceRootOwnershipManager({ lockDirectory, pid: 123, isProcessAlive: () => true });
    const first = await firstManager.tryAcquire({ ownerId: 'relationship-1', canonicalRoot: '/tmp/workspace-a', operation: 'sync' });
    expect('kind' in first).toBe(false);
    expect((await readdir(lockDirectory)).some((name) => name.endsWith('.json'))).toBe(true);

    const reconstructed = createWorkspaceRootOwnershipManager({ lockDirectory, pid: 456, isProcessAlive: () => true });
    await expect(reconstructed.tryAcquire({ ownerId: 'relationship-2', canonicalRoot: '/tmp/workspace-a/child', operation: 'handoff' }))
      .resolves.toMatchObject({ kind: 'overlap', existing: { ownerId: 'relationship-1' } });

    await (first as Exclude<typeof first, { kind: 'overlap' }>).release();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  it('serializes the complete overlap transaction across manager instances', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-root-locks-race-'));
    const lockDirectory = join(fixture, 'locks');
    const root = join(fixture, 'workspace');
    await mkdir(root);
    const firstManager = createWorkspaceRootOwnershipManager({ lockDirectory, pid: 111, isProcessAlive: () => true });
    const secondManager = createWorkspaceRootOwnershipManager({ lockDirectory, pid: 222, isProcessAlive: () => true });

    const results = await Promise.all([
      firstManager.tryAcquire({ ownerId: 'first', canonicalRoot: root, operation: 'sync' }),
      secondManager.tryAcquire({ ownerId: 'second', canonicalRoot: join(root, 'child'), operation: 'handoff' }),
    ]);
    expect(results.filter((result) => !('kind' in result))).toHaveLength(1);
    expect(results.filter((result) => 'kind' in result)).toHaveLength(1);
    for (const result of results) if (!('kind' in result)) await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('loses ownership when the filesystem object at the canonical root is replaced', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-root-identity-'));
    const lockDirectory = join(fixture, 'locks');
    const root = join(fixture, 'workspace');
    await mkdir(root);
    const manager = createWorkspaceRootOwnershipManager({ lockDirectory });
    const acquired = await manager.tryAcquire({ ownerId: 'relationship-1', canonicalRoot: root, operation: 'sync' });
    expect('kind' in acquired).toBe(false);
    if ('kind' in acquired) throw new Error('fixture did not acquire root');

    await rename(root, `${root}-replaced`);
    await mkdir(root);
    await expect(acquired.renew()).rejects.toMatchObject({ code: 'workspace_root_ownership_lost' });
    await acquired.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('shares an exact same-owner fence until every local caller releases it', async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), 'workspace-sync-root-locks-'));
    const manager = createWorkspaceRootOwnershipManager({ lockDirectory });
    const bootstrap = await manager.tryAcquire({
      ownerId: 'relationship-1',
      canonicalRoot: '/tmp/workspace-shared-owner',
      operation: 'bootstrap',
    });
    expect('kind' in bootstrap).toBe(false);

    const controller = await manager.tryAcquire({
      ownerId: 'relationship-1',
      canonicalRoot: '/tmp/workspace-shared-owner',
      operation: 'sync',
    });
    expect('kind' in controller).toBe(false);

    await (bootstrap as Exclude<typeof bootstrap, { kind: 'overlap' }>).release();
    await expect(manager.tryAcquire({
      ownerId: 'relationship-2',
      canonicalRoot: '/tmp/workspace-shared-owner',
      operation: 'sync',
    })).resolves.toMatchObject({ kind: 'overlap', existing: { ownerId: 'relationship-1' } });

    await (controller as Exclude<typeof controller, { kind: 'overlap' }>).release();
    const replacement = await manager.tryAcquire({
      ownerId: 'relationship-2',
      canonicalRoot: '/tmp/workspace-shared-owner',
      operation: 'sync',
    });
    expect('kind' in replacement).toBe(false);
    await (replacement as Exclude<typeof replacement, { kind: 'overlap' }>).release();
    await rm(lockDirectory, { recursive: true, force: true });
  });

  it('reuses canonical carried-root safety and platform-aware containment', async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), 'workspace-sync-root-locks-'));
    const manager = createWorkspaceRootOwnershipManager({ lockDirectory });
    await expect(manager.tryAcquire({ ownerId: 'bad', canonicalRoot: '../relative', operation: 'sync' })).rejects.toThrow();
    await expect(manager.tryAcquire({ ownerId: 'bad', canonicalRoot: '/', operation: 'sync' })).rejects.toThrow();

    const windowsRoot = await manager.tryAcquire({ ownerId: 'windows', canonicalRoot: 'C:\\Users\\Alice\\repo', operation: 'sync' });
    expect('kind' in windowsRoot).toBe(false);
    await expect(manager.tryAcquire({ ownerId: 'child', canonicalRoot: 'c:/users/alice/repo/child', operation: 'handoff' }))
      .resolves.toMatchObject({ kind: 'overlap', existing: { ownerId: 'windows' } });
    const sibling = await manager.tryAcquire({ ownerId: 'sibling', canonicalRoot: 'c:/users/alice/repository', operation: 'handoff' });
    expect('kind' in sibling).toBe(false);

    await (windowsRoot as Exclude<typeof windowsRoot, { kind: 'overlap' }>).release();
    await (sibling as Exclude<typeof sibling, { kind: 'overlap' }>).release();
    await rm(lockDirectory, { recursive: true, force: true });
  });
});
