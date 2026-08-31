import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  prepareExistingGitWorkspaceSyncTarget,
  workspaceSyncTargetBootstrap,
} from './workspaceSyncTargetBootstrap';
import { createWorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';

const rootOwnershipManager = createWorkspaceRootOwnershipManager({
  lockDirectory: join(tmpdir(), `workspace-sync-bootstrap-locks-${process.pid}`),
});

describe('workspaceSyncTargetBootstrap', () => {
  it('rejects a blank root before path resolution', async () => {
    await expect(workspaceSyncTargetBootstrap(input({ rootPath: '   ' }))).rejects.toMatchObject({ code: 'workspace_root_unsafe' });
  });

  it('requires explicit seed approval for a non-empty unmarked target', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    await mkdir(target);
    await writeFile(join(target, 'existing.txt'), 'preserve');
    await expect(workspaceSyncTargetBootstrap(input({ rootPath: target, stagingDirectory: join(fixture, 'staging') })))
      .rejects.toMatchObject({ code: 'target_bootstrap_seed_required' });
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('preserve');
    await rm(fixture, { recursive: true, force: true });
  });

  it('uses an explicitly selected existing target without replacing its contents', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    await mkdir(target);
    await writeFile(join(target, 'existing.txt'), 'preserve');
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      existingTargetChoice: 'use_existing',
    }));
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('preserve');
    expect(result).toMatchObject({ created: false, state: 'READY' });
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('fails closed before creating an empty Git target when no SCM bootstrap owner is supplied', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    await expect(workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      contentSelection: 'git_worktree',
      createIfMissing: true,
    }))).rejects.toMatchObject({ code: 'target_bootstrap_required' });
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(fixture, { recursive: true, force: true });
  });

  it('accepts only an existing selected Git checkout rooted at the authorized target', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-git-'));
    const target = join(fixture, 'target');
    const nested = join(target, 'nested');
    await mkdir(nested, { recursive: true });
    await writeFile(join(target, '.git-marker'), 'test boundary');
    const inspectWorkspaceLocation = async () => ({
      workspaceLocationScm: { provider: 'git' as const, rootPath: target },
      checkoutDiscovery: [{ kind: 'git_worktree' as const }],
    });

    await expect(prepareExistingGitWorkspaceSyncTarget({
      canonicalRoot: target,
      targetState: 'nonempty',
    }, { inspectWorkspaceLocation })).resolves.toBeUndefined();
    await expect(prepareExistingGitWorkspaceSyncTarget({
      canonicalRoot: nested,
      targetState: 'nonempty',
    }, { inspectWorkspaceLocation })).rejects.toMatchObject({ code: 'git_selection_unavailable' });
    await expect(prepareExistingGitWorkspaceSyncTarget({
      canonicalRoot: target,
      targetState: 'empty',
    }, { inspectWorkspaceLocation })).rejects.toMatchObject({ code: 'target_bootstrap_required' });

    await rm(fixture, { recursive: true, force: true });
  });

  it('acquires the mutation fence before creating a missing target root', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    let acquired = false;
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      createIfMissing: true,
      rootOwnershipManager: {
        tryAcquire: async (owner) => {
          await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
          acquired = true;
          return {
            owner: { ...owner, rootFingerprint: null },
            bindCurrentRootIdentity: async () => undefined,
            renew: async () => undefined,
            release: async () => undefined,
          };
        },
      },
    }));
    expect(acquired).toBe(true);
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('runs an explicit seed provider under the bootstrap fence before marking a non-empty target ready', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    await mkdir(target);
    await writeFile(join(target, 'scm-metadata'), 'present');
    let seedCalled = false;
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      materializeSeed: async ({ canonicalRoot }) => {
        seedCalled = true;
        await writeFile(join(canonicalRoot, 'seeded.txt'), 'seed');
      },
    }));
    expect(seedCalled).toBe(true);
    await expect(readFile(join(target, 'seeded.txt'), 'utf8')).resolves.toBe('seed');
    expect(JSON.parse(await readFile(result.markerPath, 'utf8'))).toMatchObject({ state: 'READY' });
    expect(JSON.parse(await readFile(join(dirname(result.markerPath), 'manifest.json'), 'utf8'))).toMatchObject({
      state: 'READY',
      engineVersion: 'happier-mutagen-external-v1',
    });
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('records a materialization failure without changing the selected existing target', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    const stagingDirectory = join(fixture, 'staging');
    await mkdir(target);
    await writeFile(join(target, 'existing.txt'), 'preserve');
    await expect(workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory,
      materializeSeed: async () => {
        throw Object.assign(new Error('seed unavailable'), { code: 'target_bootstrap_offline' });
      },
    }))).rejects.toMatchObject({ code: 'target_bootstrap_offline' });
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('preserve');
    const operationDirectories = await readdir(stagingDirectory);
    expect(operationDirectories).toHaveLength(1);
    const manifest = JSON.parse(await readFile(join(stagingDirectory, operationDirectories[0]!, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ state: 'OFFLINE', relationshipId: 'relationship-1' });
    await expect(readFile(join(stagingDirectory, operationDirectories[0]!, 'ready.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await rm(fixture, { recursive: true, force: true });
  });

  it('authorizes an empty target and writes a root/policy-bound READY marker', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    const result = await workspaceSyncTargetBootstrap(input({ rootPath: target, stagingDirectory: join(fixture, 'staging'), createIfMissing: true }));
    expect(result).toMatchObject({ created: true, state: 'READY', policyDigest: 'a'.repeat(64) });
    const marker = JSON.parse(await readFile(result.markerPath, 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({ state: 'READY', relationshipId: 'relationship-1', endpointRole: 'beta', policyDigest: 'a'.repeat(64) });
    expect(marker.rootFingerprint).toBe(result.rootFingerprint);
    await result.release();
    await writeFile(join(target, 'later-synced.txt'), 'data');
    const retry = await workspaceSyncTargetBootstrap(input({ rootPath: target, stagingDirectory: join(fixture, 'staging') }));
    expect(retry).toMatchObject({ created: false, state: 'READY', rootFingerprint: result.rootFingerprint });
    await retry.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('derives an opaque staging component from an untrusted relationship id', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    const stagingDirectory = join(fixture, 'staging');
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target, stagingDirectory, relationshipId: '../escape', createIfMissing: true,
    }));
    expect(result.markerPath.startsWith(`${stagingDirectory}/`)).toBe(true);
    await expect(readFile(join(fixture, 'escape', 'ready.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('returns a deterministic manifestDigest bound to the verified ready marker facts', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const targetA = join(fixture, 'target-a');
    const targetB = join(fixture, 'target-b');
    const staging = join(fixture, 'staging');
    const first = await workspaceSyncTargetBootstrap(input({ rootPath: targetA, stagingDirectory: staging, createIfMissing: true }));
    expect(first.manifestDigest).toMatch(/^[a-f0-9]{64}$/u);
    // The primitive holds its ownership fence until released; once released,
    // re-preparing over the same verified marker facts is stable.
    await first.release();
    const repeat = await workspaceSyncTargetBootstrap(input({ rootPath: targetA, stagingDirectory: staging }));
    expect(repeat.manifestDigest).toBe(first.manifestDigest);
    await repeat.release();
    // The digest covers exactly the facts persisted in the READY marker. The
    // marker is operation-keyed, so it is read before the second root reuses it.
    const marker = JSON.parse(await readFile(first.markerPath, 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({
      v: 1,
      state: 'READY',
      relationshipId: 'relationship-1',
      endpointRole: 'beta',
      policyDigest: 'a'.repeat(64),
      rootFingerprint: first.rootFingerprint,
    });
    // Different verified facts (canonical root) never share a manifest digest.
    const otherRoot = await workspaceSyncTargetBootstrap(input({ rootPath: targetB, stagingDirectory: staging, createIfMissing: true }));
    expect(otherRoot.manifestDigest).not.toBe(first.manifestDigest);
    await otherRoot.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('rejects source/target overlap before seed materialization or marker writes', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const source = join(fixture, 'workspace');
    const target = join(source, 'nested-target');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'existing'), 'data');
    let seeded = false;
    await expect(workspaceSyncTargetBootstrap(input({
      rootPath: target, sourceRootPath: source, stagingDirectory: join(fixture, 'staging'),
      materializeSeed: async () => { seeded = true; },
    }))).rejects.toMatchObject({ code: 'workspace_root_unsafe' });
    expect(seeded).toBe(false);
    await rm(fixture, { recursive: true, force: true });
  });

  it('does not compare target-local paths with an absent remote source path', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'workspace');
    const { sourceRootPath: _sourceRootPath, ...remoteSourceInput } = input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      createIfMissing: true,
    });
    void _sourceRootPath;
    const result = await workspaceSyncTargetBootstrap(remoteSourceInput);

    expect(result).toMatchObject({ created: true, state: 'READY' });
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });
});

function input(overrides: Partial<Parameters<typeof workspaceSyncTargetBootstrap>[0]> = {}) {
  return {
    rootPath: '/tmp/unused', sourceRootPath: `/tmp/workspace-sync-source-${process.pid}`, relationshipId: 'relationship-1', endpointRole: 'beta' as const,
    policyDigest: 'a'.repeat(64), contentSelection: 'all_files' as const, approved: true as const, stagingDirectory: '/tmp/unused-staging',
    rootOwnershipManager,
    ...overrides,
  };
}
