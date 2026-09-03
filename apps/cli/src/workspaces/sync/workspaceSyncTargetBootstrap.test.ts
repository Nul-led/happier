import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HandoffTargetReplacementApprovalV1 } from '@happier-dev/protocol';

import {
  prepareExistingGitWorkspaceSyncTarget,
  prepareWorkspaceSyncGitTarget,
  computeWorkspaceSyncRootFingerprint,
  rehydrateWorkspaceSyncTargetBootstrap,
  workspaceSyncTargetBootstrap,
} from './workspaceSyncTargetBootstrap';
import { beginWorkspaceTargetMaterialization } from '@/scm/workspace/workspaceExportMaterialization';
import { createWorkspaceRootOwnershipManager, type WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';

const rootOwnershipManager = createWorkspaceRootOwnershipManager({
  lockDirectory: join(tmpdir(), `workspace-sync-bootstrap-locks-${process.pid}`),
});
const crashChildPath = join(dirname(fileURLToPath(import.meta.url)), 'workspaceSyncTargetBootstrap.child.ts');

async function replacementApproval(rootPath: string): Promise<HandoffTargetReplacementApprovalV1> {
  return {
    v: 1 as const,
    consequences: ['replace_nonempty_workspace_target'],
    serverId: 'server-1',
    machineId: 'machine-b',
    canonicalRoot: rootPath,
    rootFingerprint: await computeWorkspaceSyncRootFingerprint(rootPath),
    operationId: 'relationship-1',
  };
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!(await access(path).then(() => true, () => false))) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function killBootstrapChildAtBoundary(input: Readonly<{
  mode: 'existing' | 'missing-git';
  target: string;
  staging: string;
  ready: string;
}>): Promise<void> {
  const child = spawn(process.execPath, ['--import', 'tsx', crashChildPath, input.mode, input.target, input.staging, input.ready], {
    cwd: join(dirname(crashChildPath), '../../..'),
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  try {
    await waitForFile(input.ready);
    child.kill('SIGKILL');
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => resolve());
    });
  } catch (error) {
    child.kill('SIGKILL');
    throw new Error(`bootstrap child failed: ${stderr}`, { cause: error });
  }
}

describe('workspaceSyncTargetBootstrap', () => {
  it('returns approval_stale without mutation when the approved root object was replaced', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-stale-'));
    const target = join(fixture, 'target');
    const stagingDirectory = join(fixture, 'staging');
    await mkdir(target);
    await writeFile(join(target, 'approved.txt'), 'old');
    const approval: HandoffTargetReplacementApprovalV1 = {
      v: 1 as const,
      consequences: ['replace_nonempty_workspace_target'],
      serverId: 'server-1',
      machineId: 'machine-b',
      canonicalRoot: target,
      rootFingerprint: await computeWorkspaceSyncRootFingerprint(target),
      operationId: 'handoff-action-1',
    };
    await rm(target, { recursive: true });
    await mkdir(target);
    await writeFile(join(target, 'replacement.txt'), 'preserve');

    await expect(workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory,
      targetBootstrap: 'materialize_from_source_workspace',
      targetReplacementApproval: approval,
      materializeSeed: async () => { throw new Error('must not mutate'); },
    }))).rejects.toMatchObject({ code: 'approval_stale' });
    await expect(readFile(join(target, 'replacement.txt'), 'utf8')).resolves.toBe('preserve');
    await expect(access(stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(fixture, { recursive: true, force: true });
  });
  it('recovers an existing target after process loss between rename and READY', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-crash-existing-'));
    const target = join(fixture, 'target');
    const staging = join(fixture, 'staging');
    const ready = join(fixture, 'child-ready');
    await mkdir(target);
    await writeFile(join(target, 'old.txt'), 'old');
    await killBootstrapChildAtBoundary({ mode: 'existing', target, staging, ready });

    const recovered = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: staging,
      relationshipId: 'relationship-crash',
      targetBootstrap: 'use_existing',
    }));
    await expect(readFile(join(target, 'old.txt'), 'utf8')).resolves.toBe('old');
    await expect(readFile(join(target, 'new.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await recovered.release();
    await rm(fixture, { recursive: true, force: true });
  }, 45_000);

  it('restores a missing Git target to absence after process loss before SCM materialization', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-crash-missing-git-'));
    const target = join(fixture, 'target');
    const staging = join(fixture, 'staging');
    const ready = join(fixture, 'child-ready');
    await killBootstrapChildAtBoundary({ mode: 'missing-git', target, staging, ready });

    await expect(workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: staging,
      relationshipId: 'relationship-crash',
      contentSelection: 'git_worktree',
      createIfMissing: false,
      targetBootstrap: 'materialize_from_source_workspace',
      prepareGitTarget: async () => undefined,
    }))).rejects.toMatchObject({ code: 'target_bootstrap_required' });
    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(fixture, { recursive: true, force: true });
  }, 45_000);

  it('does not mutate an interrupted target when root ownership acquisition reports overlap', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-crash-overlap-'));
    const target = join(fixture, 'target');
    const staging = join(fixture, 'staging');
    const ready = join(fixture, 'child-ready');
    await mkdir(target);
    await writeFile(join(target, 'old.txt'), 'old');
    await killBootstrapChildAtBoundary({ mode: 'existing', target, staging, ready });
    const overlappingManager: WorkspaceRootOwnershipManager = {
      tryAcquire: async ({ canonicalRoot }) => ({
        kind: 'overlap',
        existing: {
          ownerId: 'other-daemon',
          canonicalRoot,
          operation: 'sync',
          rootFingerprint: null,
        },
      }),
    };

    await expect(workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: staging,
      relationshipId: 'relationship-crash',
      rootOwnershipManager: overlappingManager,
      targetBootstrap: 'use_existing',
    }))).rejects.toMatchObject({ code: 'workspace_root_in_use' });
    await expect(readFile(join(target, 'new.txt'), 'utf8')).resolves.toBe('new');
    await expect(readFile(join(target, 'old.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(fixture, { recursive: true, force: true });
  }, 45_000);

  it('rejects a blank root before path resolution', async () => {
    await expect(workspaceSyncTargetBootstrap(input({ rootPath: '   ' }))).rejects.toMatchObject({ code: 'workspace_root_unsafe' });
  });

  it('requires an exact Action proof for a non-empty unmarked target', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    await mkdir(target);
    await writeFile(join(target, 'existing.txt'), 'preserve');
    await expect(workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      targetBootstrap: 'materialize_from_source_workspace',
      materializeSeed: async () => undefined,
    }))).rejects.toMatchObject({ code: 'approval_stale' });
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('preserve');
    await rm(fixture, { recursive: true, force: true });
  });

  it('uses an explicitly selected existing target without replacing its contents', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    await mkdir(target);
    await writeFile(join(target, 'existing.txt'), 'preserve');
    let seedCalled = false;
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      targetBootstrap: 'use_existing',
      materializeSeed: async () => { seedCalled = true; },
    }));
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('preserve');
    expect(seedCalled).toBe(false);
    expect(result).toMatchObject({ created: false, state: 'READY' });
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('authorizes an empty target for the initial Mutagen cycle without finite seed materialization', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    let seeded = false;
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      createIfMissing: true,
      targetBootstrap: 'materialize_from_source_workspace',
      materializeSeed: async ({ canonicalRoot }) => {
        seeded = true;
        await writeFile(join(canonicalRoot, 'seeded.txt'), 'seed');
      },
    }));
    expect(seeded).toBe(false);
    await expect(readFile(join(target, 'seeded.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('holds replaced-target custody until commit and restores it on abort', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-custody-'));
    const target = join(fixture, 'target');
    await mkdir(target);
    await writeFile(join(target, 'existing.txt'), 'preserve');
    let committed = 0;
    let aborted = 0;
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      targetBootstrap: 'materialize_from_source_workspace',
      targetReplacementApproval: await replacementApproval(target),
      materializeSeed: async ({ canonicalRoot }) => {
        await writeFile(join(canonicalRoot, 'seeded.txt'), 'seed');
        return {
          receipt: { v: 1, previousTargetName: null },
          commit: async () => { committed += 1; },
          abort: async () => {
            aborted += 1;
            await writeFile(join(canonicalRoot, 'restored.txt'), 'restored');
          },
        };
      },
    }));

    expect(committed).toBe(0);
    expect(aborted).toBe(0);
    await result.materializationCustody?.abort();
    expect(aborted).toBe(1);
    expect(committed).toBe(0);
    await expect(readFile(join(target, 'restored.txt'), 'utf8')).resolves.toBe('restored');
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('rehydrates durable replacement custody from the READY receipt', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-rehydrate-custody-'));
    const target = join(fixture, 'target');
    await mkdir(target);
    await writeFile(join(target, 'existing.txt'), 'preserve');
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      targetBootstrap: 'materialize_from_source_workspace',
      targetReplacementApproval: await replacementApproval(target),
      materializeSeed: async ({ canonicalRoot }) => {
        const materialization = await beginWorkspaceTargetMaterialization({
          targetPath: canonicalRoot,
          backupDirectoryPrefix: '.happier-sync-backup',
        });
        await mkdir(canonicalRoot);
        await writeFile(join(canonicalRoot, 'seeded.txt'), 'seed');
        return materialization.custody;
      },
    }));
    await result.release();

    const recovered = await rehydrateWorkspaceSyncTargetBootstrap({
      rootPath: target,
      relationshipId: 'relationship-1',
      endpointRole: 'beta',
      policyDigest: 'a'.repeat(64),
      contentSelection: 'all_files',
      stagingDirectory: join(fixture, 'staging'),
      rootOwnershipManager,
    });
    expect(recovered?.materializationCustody).toBeDefined();
    await recovered?.materializationCustody?.abort();
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('preserve');
    await expect(readFile(join(target, 'seeded.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await recovered?.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('restores a missing all-files target to absence when materialization aborts', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-missing-all-files-'));
    const target = join(fixture, 'target');
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      stagingDirectory: join(fixture, 'staging'),
      createIfMissing: true,
      targetBootstrap: 'materialize_from_source_workspace',
      materializeSeed: async ({ canonicalRoot }) => {
        await writeFile(join(canonicalRoot, 'seeded.txt'), 'seed');
        return { receipt: { v: 1, previousTargetName: null }, commit: async () => undefined, abort: async () => undefined };
      },
    }));

    await result.materializationCustody?.abort();
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('restores a missing local Git target to absence when materialization aborts', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-missing-git-'));
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    await mkdir(source);
    const result = await workspaceSyncTargetBootstrap(input({
      rootPath: target,
      sourceRootPath: source,
      stagingDirectory: join(fixture, 'staging'),
      contentSelection: 'git_worktree',
      createIfMissing: true,
      targetBootstrap: 'materialize_from_source_workspace',
      prepareGitTarget: async ({ canonicalRoot }) => {
        await writeFile(join(canonicalRoot, '.git-marker'), 'materialized');
        return { receipt: { v: 1, previousTargetName: null }, commit: async () => undefined, abort: async () => undefined };
      },
    }));

    await result.materializationCustody?.abort();
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
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
      targetBootstrap: 'materialize_from_source_workspace',
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

  it('holds local Git target replacement under canonical materialization custody', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-git-materialize-'));
    const source = join(fixture, 'source');
    const target = join(fixture, 'target');
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(target, 'existing.txt'), 'preserve');
    const realizeWorkspaceCheckout = async (request: Readonly<{
      sourcePath: string;
      targetPath?: string;
      checkoutCreation: Readonly<{ kind: string; displayName: string; baseRef: string | null; branchMode: string }>;
    }>) => {
      expect(request).toMatchObject({
        sourcePath: source,
        targetPath: target,
        checkoutCreation: { kind: 'git_worktree', branchMode: 'new' },
      });
      await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
      await mkdir(target);
      await writeFile(join(target, '.git-marker'), 'materialized');
      return { kind: 'git_worktree' as const, targetPath: target, branchName: 'test', created: true };
    };
    const inspectWorkspaceLocation = async () => ({
      workspaceLocationScm: { provider: 'git' as const, rootPath: target },
      checkoutDiscovery: [{ kind: 'git_worktree' as const }],
    });

    const custody = await prepareWorkspaceSyncGitTarget({
      canonicalRoot: target,
      sourceRootPath: source,
      relationshipId: 'relationship-1',
      targetState: 'nonempty',
      targetBootstrap: 'materialize_from_source_workspace',
      materializationReceiptPath: join(fixture, 'materialization.json'),
    }, { realizeWorkspaceCheckout, inspectWorkspaceLocation });
    await custody?.abort();
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('preserve');
    await expect(readFile(join(target, '.git-marker'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await rm(fixture, { recursive: true, force: true });
  });

  it('reports offline when Git materialization has no reachable source workspace', async () => {
    await expect(prepareWorkspaceSyncGitTarget({
      canonicalRoot: '/tmp/unreachable-target',
      relationshipId: 'relationship-1',
      targetState: 'missing',
      targetBootstrap: 'materialize_from_source_workspace',
      materializationReceiptPath: '/tmp/.unreachable-target.happier-materialization.json',
    })).rejects.toMatchObject({ code: 'target_bootstrap_offline' });
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
      targetBootstrap: 'materialize_from_source_workspace',
      targetReplacementApproval: await replacementApproval(target),
    }));
    expect(seedCalled).toBe(true);
    await expect(readFile(join(target, 'seeded.txt'), 'utf8')).resolves.toBe('seed');
    expect(JSON.parse(await readFile(result.markerPath, 'utf8'))).toMatchObject({
      state: 'READY',
      engineVersion: 'happier-mutagen-external-v1',
      contentSelection: 'all_files',
    });
    await expect(readFile(join(dirname(result.markerPath), 'manifest.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await result.release();
    await rm(fixture, { recursive: true, force: true });
  });

  it('leaves no durable bootstrap authority after materialization fails', async () => {
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
      targetBootstrap: 'materialize_from_source_workspace',
      targetReplacementApproval: await replacementApproval(target),
    }))).rejects.toMatchObject({ code: 'target_bootstrap_offline' });
    await expect(readFile(join(target, 'existing.txt'), 'utf8')).resolves.toBe('preserve');
    const operationDirectories = await readdir(stagingDirectory);
    expect(operationDirectories).toHaveLength(1);
    await expect(readFile(join(stagingDirectory, operationDirectories[0]!, 'manifest.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(stagingDirectory, operationDirectories[0]!, 'ready.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await rm(fixture, { recursive: true, force: true });
  });

  it('authorizes an empty target and writes a root/policy-bound READY marker', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const target = join(fixture, 'target');
    const result = await workspaceSyncTargetBootstrap(input({ rootPath: target, stagingDirectory: join(fixture, 'staging'), createIfMissing: true, targetBootstrap: 'materialize_from_source_workspace', materializeSeed: async () => undefined }));
    expect(result).toMatchObject({ created: true, state: 'READY', policyDigest: 'a'.repeat(64) });
    const marker = JSON.parse(await readFile(result.markerPath, 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({ state: 'READY', relationshipId: 'relationship-1', endpointRole: 'beta', policyDigest: 'a'.repeat(64) });
    expect(marker.rootFingerprint).toBe(result.rootFingerprint);
    await result.release();
    await writeFile(join(target, 'later-synced.txt'), 'data');
    const retry = await workspaceSyncTargetBootstrap(input({ rootPath: target, stagingDirectory: join(fixture, 'staging'), targetBootstrap: 'materialize_from_source_workspace', materializeSeed: async () => {} }));
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

  it('uses the atomic READY record as the only durable bootstrap authority', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-bootstrap-'));
    const targetA = join(fixture, 'target-a');
    const targetB = join(fixture, 'target-b');
    const staging = join(fixture, 'staging');
    const first = await workspaceSyncTargetBootstrap(input({ rootPath: targetA, stagingDirectory: staging, createIfMissing: true, targetBootstrap: 'materialize_from_source_workspace', materializeSeed: async () => {} }));
    expect(first).not.toHaveProperty('manifestDigest');
    // The primitive holds its ownership fence until released; once released,
    // re-preparing over the same verified marker facts is stable.
    await first.release();
    const repeat = await workspaceSyncTargetBootstrap(input({ rootPath: targetA, stagingDirectory: staging, targetBootstrap: 'materialize_from_source_workspace', materializeSeed: async () => {} }));
    expect(repeat).not.toHaveProperty('manifestDigest');
    await repeat.release();
    // The marker is operation-keyed, so read it before the second root reuses
    // the same relationship fixture identity.
    const marker = JSON.parse(await readFile(first.markerPath, 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({
      v: 1,
      state: 'READY',
      relationshipId: 'relationship-1',
      endpointRole: 'beta',
      policyDigest: 'a'.repeat(64),
      rootFingerprint: first.rootFingerprint,
      engineVersion: 'happier-mutagen-external-v1',
      contentSelection: 'all_files',
    });
    // Different verified facts are represented by a distinct READY record.
    const otherRoot = await workspaceSyncTargetBootstrap(input({ rootPath: targetB, stagingDirectory: staging, createIfMissing: true, targetBootstrap: 'materialize_from_source_workspace', materializeSeed: async () => {} }));
    const otherMarker = JSON.parse(await readFile(otherRoot.markerPath, 'utf8')) as Record<string, unknown>;
    expect(otherMarker.canonicalRoot).not.toBe(marker.canonicalRoot);
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
    targetBootstrap: 'use_existing' as const,
    ...overrides,
  };
}
