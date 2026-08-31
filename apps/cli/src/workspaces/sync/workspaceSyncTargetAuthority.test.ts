import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  AccountSettingsSchema,
  computeWorkspaceSyncPolicyDigest,
  type WorkspaceSyncTargetBootstrapPrepareV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import type { ActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { createWorkspaceRootOwnershipManager, type WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import { createWorkspaceSyncTargetAuthority } from './workspaceSyncTargetAuthority';
import { workspaceSyncTargetBootstrap } from './workspaceSyncTargetBootstrap';

const contentPolicyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
  includeGitDirectory: false,
};
const contentPolicy = {
  ...contentPolicyInput,
  policyDigest: computeWorkspaceSyncPolicyDigest(contentPolicyInput),
};

function snapshot(
  alphaRoot: string,
  betaRoot: string,
  options: Readonly<{
    relationshipEnabled?: boolean;
    includeRelationship?: boolean;
    extraRefs?: ReadonlyArray<{ id: string; machineId: string; rootPath: string }>;
  }> = {},
): ActiveAccountSettingsSnapshot {
  const relationshipEnabled = options.relationshipEnabled ?? true;
  const includeRelationship = options.includeRelationship ?? true;
  return {
    source: 'network',
    settings: AccountSettingsSchema.parse({
      workspaceRefsV1: [
        { id: 'workspace-alpha', serverId: 'server-1', machineId: 'machine-a', rootPath: alphaRoot, createdAtMs: 1 },
        { id: 'workspace-beta', serverId: 'server-1', machineId: 'machine-b', rootPath: betaRoot, createdAtMs: 1 },
        ...(options.extraRefs ?? []).map((ref) => ({ serverId: 'server-1', createdAtMs: 1, ...ref })),
      ],
      workspaceSyncRelationshipsV1: includeRelationship ? [{
        v: 1,
        relationshipId: 'rel-1',
        controllerMachineId: 'machine-a',
        alphaWorkspaceRefId: 'workspace-alpha',
        betaWorkspaceRefId: 'workspace-beta',
        mode: 'keep_both_in_sync',
        contentPolicy,
        enabled: relationshipEnabled,
        createdAtMs: 1,
        updatedAtMs: 1,
      }] : [],
    }),
    settingsVersion: 1,
    loadedAtMs: 1,
    settingsSecretsReadKeys: [],
  };
}

type AuthorityHarness = Readonly<{
  authority: ReturnType<typeof createWorkspaceSyncTargetAuthority>;
  rootOwnershipManager: WorkspaceRootOwnershipManager;
  stagingDirectory: string;
  lockDirectory: string;
  cleanup(): Promise<void>;
}>;

let harnessCounter = 0;

function createAuthorityHarness(options: Readonly<{
  localMachineId?: string;
  getSettingsSnapshot: () => ActiveAccountSettingsSnapshot | null;
  callMachineRpc?: (input: Readonly<{ machineId: string; method: string; request: unknown; signal?: AbortSignal }>) => Promise<unknown>;
  ownershipRenewIntervalMs?: number;
  openRootedAgent?: (input: Readonly<{ operationId: string; role: 'alpha' | 'beta'; workspaceRefId: string; canonicalRoot: string; signal?: AbortSignal }>) => Promise<PassThrough>;
}>): AuthorityHarness {
  const suffix = `${process.pid}-${++harnessCounter}-${Math.random().toString(36).slice(2)}`;
  const stagingDirectory = join(tmpdir(), `workspace-sync-authority-staging-${suffix}`);
  const lockDirectory = join(tmpdir(), `workspace-sync-authority-locks-${suffix}`);
  const rootOwnershipManager = createWorkspaceRootOwnershipManager({ lockDirectory });
  const authority = createWorkspaceSyncTargetAuthority({
    localMachineId: options.localMachineId ?? 'machine-b',
    getSettingsSnapshot: options.getSettingsSnapshot,
    callMachineRpc: options.callMachineRpc ?? (async () => { throw new Error('unexpected machine RPC'); }),
    ...(options.openRootedAgent ? { openRootedAgent: options.openRootedAgent } : {}),
    bootstrap: {
      stagingDirectory,
      rootOwnershipManager,
      ...(options.ownershipRenewIntervalMs === undefined ? {} : { ownershipRenewIntervalMs: options.ownershipRenewIntervalMs }),
    },
  });
  return {
    authority,
    rootOwnershipManager,
    stagingDirectory,
    lockDirectory,
    cleanup: async () => {
      await rm(stagingDirectory, { recursive: true, force: true });
      await rm(lockDirectory, { recursive: true, force: true });
    },
  };
}

function prepareRequest(overrides: Record<string, unknown> = {}) {
  return {
    v: 1 as const,
    bootstrapOperationId: 'bootstrap-op-1',
    owner: { kind: 'relationship' as const, relationshipId: 'rel-1' },
    targetWorkspaceRefId: 'workspace-beta',
    endpointRole: 'beta' as const,
    policyDigest: contentPolicy.policyDigest,
    createIfMissing: true,
    ...overrides,
  };
}

function copyOncePrepareRequest(overrides: Record<string, unknown> = {}) {
  return prepareRequest({
    owner: {
      kind: 'copy_once' as const,
      operation: {
        v: 1,
        operationId: 'copy-op-1',
        controllerMachineId: 'machine-a',
        alphaWorkspaceRefId: 'workspace-alpha',
        betaWorkspaceRefId: 'workspace-beta',
        contentPolicy,
      },
    },
    ...overrides,
  });
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition was not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function lockRecordPath(lockDirectory: string, canonicalRoot: string): Promise<string> {
  return join(lockDirectory, `${createHash('sha256').update(canonicalRoot).digest('hex')}.json`);
}

describe('workspace sync target authority', () => {
  it('rejects conflict deletion without retained or rehydratable target custody', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-delete-unready-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const loserPath = join(betaRoot, 'loser.txt');
    await writeFile(loserPath, 'loser');
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      await expect(harness.authority.deleteConflictLoserHere({
        relationshipId: 'rel-1',
        workspaceRefId: 'workspace-beta',
        path: 'loser.txt',
        expectedKind: 'file',
        expectedDigest: createHash('sha1').update('loser').digest('hex'),
      })).rejects.toMatchObject({ code: 'relationship_not_ready' });
      await expect(readFile(loserPath, 'utf8')).resolves.toBe('loser');
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('permits a digest-guarded delete only while the exact retained root authority remains current', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-delete-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    await mkdir(betaRoot, { recursive: true });
    const loserPath = join(betaRoot, 'loser.txt');
    await writeFile(loserPath, 'loser');
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest({ createIfMissing: false }));
      await harness.authority.deleteConflictLoserHere({
        relationshipId: 'rel-1',
        workspaceRefId: 'workspace-beta',
        path: 'loser.txt',
        expectedKind: 'file',
        expectedDigest: createHash('sha1').update('loser').digest('hex'),
      });
      await expect(readFile(loserPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects conflict deletion when the retained target root object changed', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-delete-root-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    await mkdir(betaRoot, { recursive: true });
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest({ createIfMissing: false }));
      await rm(betaRoot, { recursive: true, force: true });
      await mkdir(betaRoot, { recursive: true });
      const replacementLoser = join(betaRoot, 'loser.txt');
      await writeFile(replacementLoser, 'replacement');

      await expect(harness.authority.deleteConflictLoserHere({
        relationshipId: 'rel-1',
        workspaceRefId: 'workspace-beta',
        path: 'loser.txt',
        expectedKind: 'file',
        expectedDigest: createHash('sha1').update('replacement').digest('hex'),
      })).rejects.toMatchObject({ code: 'root_changed' });
      await expect(readFile(replacementLoser, 'utf8')).resolves.toBe('replacement');
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('forwards a bounded preview to the selected machine without a caller root', async () => {
    const callMachineRpc = vi.fn(async () => ({
      status: 'text', text: 'hello', digest: 'a'.repeat(40), size: 5,
    }));
    const authority = createWorkspaceSyncTargetAuthority({
      localMachineId: 'machine-a',
      getSettingsSnapshot: () => snapshot('/alpha', '/beta'),
      callMachineRpc,
    });

    await expect(authority.readFileAtTarget({
      relationshipId: 'rel-1',
      targetMachineId: 'machine-b',
      targetWorkspaceRefId: 'workspace-beta',
      path: 'src/index.ts',
      maxBytes: 1024,
    })).resolves.toMatchObject({ status: 'text', text: 'hello' });
    expect(callMachineRpc).toHaveBeenCalledWith({
      machineId: 'machine-b',
      method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_FILE_READ,
      request: {
        relationshipId: 'rel-1', workspaceRefId: 'workspace-beta',
        path: 'src/index.ts', maxBytes: 1024,
      },
    });
  });

  it('rejects a workspace ref outside the relationship and a mismatched target machine', async () => {
    const authority = createWorkspaceSyncTargetAuthority({
      localMachineId: 'machine-a',
      getSettingsSnapshot: () => snapshot('/alpha', '/beta'),
      callMachineRpc: vi.fn(),
    });
    await expect(authority.readFileHere({
      relationshipId: 'rel-1', workspaceRefId: 'workspace-other', path: 'file.txt', maxBytes: 10,
    })).rejects.toMatchObject({ code: 'relationship_not_ready' });
    await expect(authority.readFileAtTarget({
      relationshipId: 'rel-1', targetMachineId: 'machine-c', targetWorkspaceRefId: 'workspace-beta',
      path: 'file.txt', maxBytes: 10,
    })).rejects.toMatchObject({ code: 'peer_unavailable' });
  });

  it('fail-closes local mutations, routed target calls and ingress with the exact typed legacy-state code', async () => {
    for (const code of ['legacy_workspace_sync_state_unsupported', 'legacy_workspace_sync_state_unknown'] as const) {
      const callMachineRpc = vi.fn(async () => undefined);
      const authority = createWorkspaceSyncTargetAuthority({
        localMachineId: 'machine-b',
        getSettingsSnapshot: () => snapshot('/alpha', '/beta'),
        callMachineRpc,
        assertLegacyStateAvailable: () => { throw Object.assign(new Error('legacy workspace sync state'), { code }); },
      });
      const expectTyped = (run: Promise<unknown>) => expect(run).rejects.toMatchObject({ code });
      await expectTyped(authority.deleteConflictLoserHere({
        relationshipId: 'rel-1', workspaceRefId: 'workspace-beta', path: 'src/x.ts', expectedKind: 'file',
      }));
      await expectTyped(authority.readFileHere({
        relationshipId: 'rel-1', workspaceRefId: 'workspace-beta', path: 'src/x.ts', maxBytes: 64,
      }));
      await expectTyped(authority.prepareBootstrapHere({
        v: 1, bootstrapOperationId: 'boot-op-1',
        owner: { kind: 'relationship', relationshipId: 'rel-1' },
        targetWorkspaceRefId: 'workspace-beta', endpointRole: 'beta',
        policyDigest: contentPolicy.policyDigest, createIfMissing: true,
      }));
      await expectTyped(authority.deleteConflictLoserAtTarget({
        relationshipId: 'rel-1', targetMachineId: 'machine-c', targetWorkspaceRefId: 'workspace-beta',
        path: 'src/x.ts', expectedKind: 'file',
      }));
      await expectTyped(authority.readFileAtTarget({
        relationshipId: 'rel-1', targetMachineId: 'machine-c', targetWorkspaceRefId: 'workspace-beta',
        path: 'src/x.ts', maxBytes: 64,
      }));
      await expectTyped(authority.prepareBootstrapAtTarget({
        v: 1, bootstrapOperationId: 'boot-op-1',
        owner: { kind: 'relationship', relationshipId: 'rel-1' },
        targetWorkspaceRefId: 'workspace-beta', targetMachineId: 'machine-b', endpointRole: 'beta',
        policyDigest: contentPolicy.policyDigest, createIfMissing: true,
      }));
      await expectTyped(authority.acquireWorkspaceSyncMachineIngress({
        operationId: 'rel-1', sourceMachineId: 'machine-a', targetMachineId: 'machine-b',
      }));
      // Safe cleanup/release paths stay available, and no machine RPC was reached.
      await expect(authority.releaseBootstrapHere({
        v: 1, bootstrapOperationId: 'boot-op-1', targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
      })).resolves.toMatchObject({ ok: true, released: false });
      expect(callMachineRpc).not.toHaveBeenCalled();
    }
  });
});

describe('workspace sync target bootstrap authority', () => {
  it('prepares a relationship-owned target locally without accepting a caller path', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-bootstrap-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      const result = await harness.authority.prepareBootstrapHere(prepareRequest());
      expect(result).toEqual({
        v: 1,
        bootstrapOperationId: 'bootstrap-op-1',
        targetWorkspaceRefId: 'workspace-beta',
        state: 'ready',
        created: true,
        rootFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        policyDigest: contentPolicy.policyDigest,
        manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(Object.keys(result).sort()).toEqual([
        'bootstrapOperationId', 'created', 'manifestDigest', 'policyDigest', 'rootFingerprint', 'state', 'targetWorkspaceRefId', 'v',
      ]);
      await expect(stat(betaRoot)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(readdir(betaRoot)).resolves.toEqual([]);
      // A caller-supplied path is not part of the wire contract and never reaches the local root owner.
      const missingRoot = join(fixture, 'never-created');
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        bootstrapOperationId: 'bootstrap-op-poison',
        rootPath: missingRoot,
      }))).rejects.toThrow();
      await expect(stat(missingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('treats an exact duplicate prepare as idempotent and a differing one as a definition conflict', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-dup-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      const first = await harness.authority.prepareBootstrapHere(prepareRequest());
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toEqual(first);
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({ createIfMissing: false })))
        .rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({ policyDigest: 'b'.repeat(64) })))
        .rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        owner: { kind: 'copy_once', operation: {
          v: 1, operationId: 'copy-op-1', controllerMachineId: 'machine-a',
          alphaWorkspaceRefId: 'workspace-alpha', betaWorkspaceRefId: 'workspace-beta', contentPolicy,
        } },
      }))).rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects wrong machine, unknown ref, role/ref drift, wrong policy and stale relationships without touching the root', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-reject-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      const missingRoot = join(fixture, 'never-created');
      const rejectsAndLeavesRoot = async (request: WorkspaceSyncTargetBootstrapPrepareV1, code: string, localMachineId?: string) => {
        const target = createAuthorityHarness({
          localMachineId,
          getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
        });
        try {
          await expect(target.authority.prepareBootstrapHere(request)).rejects.toMatchObject({ code });
          await expect(stat(missingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
          await target.cleanup();
        }
      };
      await rejectsAndLeavesRoot(prepareRequest(), 'peer_unavailable', 'machine-c');
      await rejectsAndLeavesRoot(prepareRequest({ targetWorkspaceRefId: 'workspace-missing' }), 'peer_unavailable');
      await rejectsAndLeavesRoot(prepareRequest({ targetWorkspaceRefId: 'workspace-alpha' }), 'relationship_not_ready');
      await rejectsAndLeavesRoot(prepareRequest({ policyDigest: 'b'.repeat(64) }), 'bootstrap_definition_conflict');
      const stale = createAuthorityHarness({
        getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { relationshipEnabled: false }),
      });
      try {
        await expect(stale.authority.prepareBootstrapHere(prepareRequest())).rejects.toMatchObject({ code: 'relationship_not_ready' });
        await expect(stat(missingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await stale.cleanup();
      }
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('prepares and releases a copy_once target and refuses target, role, policy and source drift', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-copy-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      const result = await harness.authority.prepareBootstrapHere(copyOncePrepareRequest());
      expect(result).toMatchObject({ state: 'ready', targetWorkspaceRefId: 'workspace-beta', bootstrapOperationId: 'bootstrap-op-1' });
      await expect(harness.authority.prepareBootstrapHere(copyOncePrepareRequest({ targetWorkspaceRefId: 'workspace-alpha' })))
        .rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      await expect(harness.authority.prepareBootstrapHere(copyOncePrepareRequest({
        owner: {
          kind: 'copy_once',
          operation: {
            v: 1, operationId: 'copy-op-2', controllerMachineId: 'machine-a',
            alphaWorkspaceRefId: 'workspace-alpha', betaWorkspaceRefId: 'workspace-beta',
            contentPolicy: {
              v: 1,
              selection: 'git_worktree' as const,
              extraIgnorePatterns: [],
              extraIncludePatterns: [],
              includeGitDirectory: false,
              policyDigest: computeWorkspaceSyncPolicyDigest({
                v: 1, selection: 'git_worktree', extraIgnorePatterns: [], extraIncludePatterns: [], includeGitDirectory: false,
              }),
            },
          },
        },
      }))).rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      await expect(harness.authority.prepareBootstrapHere(copyOncePrepareRequest({
        bootstrapOperationId: 'bootstrap-op-3',
        owner: {
          kind: 'copy_once',
          operation: {
            v: 1, operationId: 'copy-op-3', controllerMachineId: 'machine-a',
            alphaWorkspaceRefId: 'workspace-missing', betaWorkspaceRefId: 'workspace-beta', contentPolicy,
          },
        },
      }))).rejects.toMatchObject({ code: 'peer_unavailable' });
      await expect(harness.authority.releaseBootstrapHere({
        v: 1, bootstrapOperationId: 'bootstrap-op-1', targetWorkspaceRefId: 'workspace-other', reason: 'abort',
      })).rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      await expect(harness.authority.releaseBootstrapHere({
        v: 1, bootstrapOperationId: 'bootstrap-op-1', targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
      })).resolves.toEqual({ ok: true, released: true });
      await expect(harness.authority.releaseBootstrapHere({
        v: 1, bootstrapOperationId: 'bootstrap-op-1', targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
      })).resolves.toEqual({ ok: true, released: false });
      await expect(harness.authority.prepareBootstrapHere(copyOncePrepareRequest({
        bootstrapOperationId: 'bootstrap-op-controller-drift',
        owner: {
          kind: 'copy_once',
          operation: {
            v: 1, operationId: 'copy-op-controller-drift', controllerMachineId: 'machine-c',
            alphaWorkspaceRefId: 'workspace-alpha', betaWorkspaceRefId: 'workspace-beta', contentPolicy,
          },
        },
      }))).rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      // The fence is really gone: the same root can be re-acquired by a fresh operation.
      const probe = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'probe', canonicalRoot: betaRoot, operation: 'bootstrap',
      });
      if ('kind' in probe) throw new Error('copy_once release did not free the root ownership fence');
      await probe.release();
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('does not compare identical path strings that belong to different machines', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-cross-machine-path-'));
    const sharedPathText = join(fixture, 'workspace');
    await mkdir(sharedPathText, { recursive: true });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(sharedPathText, sharedPathText),
    });
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toMatchObject({
        state: 'ready',
        targetWorkspaceRefId: 'workspace-beta',
      });
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('retains a relationship fence on abort while the enabled relationship still owns the endpoint', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-retain-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    let current = snapshot(alphaRoot, betaRoot);
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => current });
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toMatchObject({ state: 'ready' });
      await expect(harness.authority.releaseBootstrapHere({
        v: 1, bootstrapOperationId: 'bootstrap-op-1', targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
      })).resolves.toEqual({ ok: true, released: false });
      // The persistent relationship still owns the endpoint: the fence must survive the abort.
      const overlap = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'probe', canonicalRoot: betaRoot, operation: 'bootstrap',
      });
      expect(overlap).toMatchObject({ kind: 'overlap' });
      if (!('kind' in overlap)) await overlap.release();
      // Once the relationship is disabled the same abort release is free to release.
      current = snapshot(alphaRoot, betaRoot, { relationshipEnabled: false });
      await expect(harness.authority.releaseBootstrapHere({
        v: 1, bootstrapOperationId: 'bootstrap-op-1', targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
      })).resolves.toEqual({ ok: true, released: true });
      const probe = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'probe', canonicalRoot: betaRoot, operation: 'bootstrap',
      });
      if ('kind' in probe) throw new Error('disabled relationship abort did not release the fence');
      await probe.release();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('drops ownership on renewal loss and safely re-acquires instead of pretending ready', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-renew-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      ownershipRenewIntervalMs: 15,
    });
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toMatchObject({ state: 'ready' });
      const canonical = await realpath(betaRoot);
      // Simulate a foreign owner taking the fence record; renewal must detect the loss.
      await writeFile(await lockRecordPath(harness.lockDirectory, canonical), JSON.stringify({
        v: 1, ownerId: 'foreign', canonicalRoot: canonical, operation: 'bootstrap', pid: process.pid, heartbeatAtMs: Date.now(),
      }));
      let observedLoss = false;
      const deadline = Date.now() + 2000;
      for (;;) {
        try {
          await harness.authority.prepareBootstrapHere(prepareRequest());
        } catch (error) {
          if ((error as { code?: string }).code === 'workspace_root_in_use') {
            observedLoss = true;
            break;
          }
          throw error;
        }
        if (Date.now() > deadline) throw new Error('renewal loss was never observed');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(observedLoss).toBe(true);
      // The foreign owner finishes; the duplicate prepare re-acquires for real.
      await unlink(await lockRecordPath(harness.lockDirectory, canonical));
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toMatchObject({
        state: 'ready', created: false,
      });
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('reconciles disabled relationships and releases every retained handle on shutdown', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-reconcile-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const gammaRoot = join(fixture, 'gamma');
    await mkdir(alphaRoot, { recursive: true });
    let current = snapshot(alphaRoot, betaRoot, {
      extraRefs: [{ id: 'workspace-gamma', machineId: 'machine-b', rootPath: gammaRoot }],
    });
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => current });
    const probeRoot = async (rootPath: string): Promise<boolean> => {
      const probe = await harness.rootOwnershipManager.tryAcquire({ ownerId: 'probe', canonicalRoot: rootPath, operation: 'bootstrap' });
      if ('kind' in probe) return false;
      await probe.release();
      return true;
    };
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toMatchObject({ state: 'ready' });
      await expect(harness.authority.prepareBootstrapHere(copyOncePrepareRequest({
        bootstrapOperationId: 'bootstrap-op-gamma',
        owner: {
          kind: 'copy_once',
          operation: {
            v: 1, operationId: 'copy-op-gamma', controllerMachineId: 'machine-a',
            alphaWorkspaceRefId: 'workspace-alpha', betaWorkspaceRefId: 'workspace-gamma', contentPolicy,
          },
        },
        targetWorkspaceRefId: 'workspace-gamma',
      }))).resolves.toMatchObject({ state: 'ready' });
      await expect(probeRoot(betaRoot)).resolves.toBe(false);
      await expect(probeRoot(gammaRoot)).resolves.toBe(false);
      current = snapshot(alphaRoot, betaRoot, {
        relationshipEnabled: false,
        extraRefs: [{ id: 'workspace-gamma', machineId: 'machine-b', rootPath: gammaRoot }],
      });
      await harness.authority.reconcileRetainedBootstraps();
      await expect(probeRoot(betaRoot)).resolves.toBe(true);
      await expect(probeRoot(gammaRoot)).resolves.toBe(false);
      await harness.authority.releaseAllRetainedBootstraps();
      await expect(probeRoot(gammaRoot)).resolves.toBe(true);
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('acquires one loopback ingress only for the retained target owner and moves raw bytes to its rooted agent', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-ingress-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const rootedAgents: PassThrough[] = [];
    const openRootedAgent = vi.fn(async () => {
      const agent = new PassThrough();
      rootedAgents.push(agent);
      return agent;
    });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      const ingress = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: 'rel-1',
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      expect(ingress).toMatchObject({ port: expect.any(Number), close: expect.any(Function) });
      const client = connect({ host: '127.0.0.1', port: ingress.port });
      await once(client, 'connect');
      const response = once(client, 'data') as Promise<[Buffer]>;
      client.write(Buffer.from('native-machine-carrier-bytes'));
      await expect(response).resolves.toEqual([Buffer.from('native-machine-carrier-bytes')]);
      expect(openRootedAgent).toHaveBeenCalledWith({
        operationId: 'rel-1', role: 'beta', workspaceRefId: 'workspace-beta',
        canonicalRoot: await realpath(betaRoot), signal: expect.any(AbortSignal),
      });
      client.destroy();
      await ingress.close();
      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: 'rel-1',
        sourceMachineId: 'machine-c',
        targetMachineId: 'machine-b',
      })).rejects.toMatchObject({ code: 'peer_unavailable' });

      const pendingIngress = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: 'rel-1',
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      await harness.authority.releaseAllRetainedBootstraps();
      expect(rootedAgents[1]?.destroyed).toBe(true);
      const rejectedClient = connect({ host: '127.0.0.1', port: pendingIngress.port });
      await expect(once(rejectedClient, 'error')).resolves.toBeDefined();
      rejectedClient.destroy();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rebinds repeated handoffs to one retained relationship endpoint authority', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-rebind-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const openRootedAgent = vi.fn(async () => new PassThrough());
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest({ bootstrapOperationId: 'handoff-1' }));
      await harness.authority.prepareBootstrapHere(prepareRequest({ bootstrapOperationId: 'handoff-2' }));

      const ingress = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: 'rel-1',
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      expect(openRootedAgent).toHaveBeenCalledTimes(1);
      await ingress.close();
      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'handoff-1',
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'abort',
      })).resolves.toEqual({ ok: true, released: false });
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rehydrates retained relationship ingress from settings and the verified bootstrap marker after restart', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-restart-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const stagingDirectory = join(fixture, 'staging');
    const lockDirectory = join(fixture, 'locks');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const currentSnapshot = () => snapshot(alphaRoot, betaRoot);
    const first = createWorkspaceSyncTargetAuthority({
      localMachineId: 'machine-b',
      getSettingsSnapshot: currentSnapshot,
      callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
      openRootedAgent: async () => new PassThrough(),
      bootstrap: {
        stagingDirectory,
        rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
      },
    });
    try {
      await first.prepareBootstrapHere(prepareRequest({ bootstrapOperationId: 'handoff-before-restart' }));
      await first.releaseAllRetainedBootstraps();

      const openRootedAgent = vi.fn(async () => new PassThrough());
      const restarted = createWorkspaceSyncTargetAuthority({
        localMachineId: 'machine-b',
        getSettingsSnapshot: currentSnapshot,
        callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
        openRootedAgent,
        bootstrap: {
          stagingDirectory,
          rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
        },
      });
      await restarted.reconcileRetainedBootstraps();
      const ingress = await restarted.acquireWorkspaceSyncMachineIngress({
        operationId: 'rel-1',
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      expect(openRootedAgent).toHaveBeenCalledWith({
        operationId: 'rel-1',
        role: 'beta',
        workspaceRefId: 'workspace-beta',
        canonicalRoot: await realpath(betaRoot),
        signal: expect.any(AbortSignal),
      });
      await ingress.close();
      const loserPath = join(betaRoot, 'loser-after-restart.txt');
      await writeFile(loserPath, 'loser');
      await restarted.deleteConflictLoserHere({
        relationshipId: 'rel-1',
        workspaceRefId: 'workspace-beta',
        path: 'loser-after-restart.txt',
        expectedKind: 'file',
        expectedDigest: createHash('sha1').update('loser').digest('hex'),
      });
      await expect(readFile(loserPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await restarted.releaseAllRetainedBootstraps();
    } finally {
      await first.releaseAllRetainedBootstraps();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects ingress when the target root was replaced at the same path after bootstrap', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-root-replaced-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const openRootedAgent = vi.fn(async () => new PassThrough());
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      await rm(betaRoot, { recursive: true, force: true });
      await mkdir(betaRoot, { recursive: true });

      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: 'rel-1',
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      })).rejects.toMatchObject({ code: 'root_changed' });
      expect(openRootedAgent).not.toHaveBeenCalled();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('dispatches remote prepare/release through the machine RPC boundary and parses strict responses', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-remote-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const readyResult = {
      v: 1,
      bootstrapOperationId: 'bootstrap-op-1',
      targetWorkspaceRefId: 'workspace-beta',
      state: 'ready',
      created: true,
      rootFingerprint: 'b'.repeat(64),
      policyDigest: contentPolicy.policyDigest,
      manifestDigest: 'c'.repeat(64),
    };
    const callMachineRpc = vi.fn(async (input: Readonly<{ method: string }>) => (
      input.method === RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_RELEASE
        ? { ok: true, released: true }
        : readyResult
    ));
    const harness = createAuthorityHarness({
      localMachineId: 'machine-a',
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      callMachineRpc,
    });
    try {
      const prepare = prepareRequest();
      await expect(harness.authority.prepareBootstrapAtTarget({ ...prepare, targetMachineId: 'machine-b' }))
        .resolves.toEqual(readyResult);
      expect(callMachineRpc).toHaveBeenCalledWith({
        machineId: 'machine-b',
        method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_PREPARE,
        request: prepare,
      });
      await expect(harness.authority.releaseBootstrapAtTarget({
        v: 1, bootstrapOperationId: 'bootstrap-op-1', targetWorkspaceRefId: 'workspace-beta', reason: 'copy_committed',
        targetMachineId: 'machine-b',
      })).resolves.toEqual({ ok: true, released: true });
      expect(callMachineRpc).toHaveBeenCalledWith({
        machineId: 'machine-b',
        method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_RELEASE,
        request: { v: 1, bootstrapOperationId: 'bootstrap-op-1', targetWorkspaceRefId: 'workspace-beta', reason: 'copy_committed' },
      });
      // A leaked path in a remote response is rejected by the strict result contract.
      callMachineRpc.mockImplementationOnce(async () => ({ ...readyResult, rootPath: '/leaked' }));
      await expect(harness.authority.prepareBootstrapAtTarget({ ...prepare, bootstrapOperationId: 'bootstrap-op-2', targetMachineId: 'machine-b' }))
        .rejects.toThrow();
      // A target machine that does not own the ref never reaches the transport.
      await expect(harness.authority.prepareBootstrapAtTarget({ ...prepare, bootstrapOperationId: 'bootstrap-op-3', targetMachineId: 'machine-c' }))
        .rejects.toMatchObject({ code: 'peer_unavailable' });
      expect(callMachineRpc).toHaveBeenCalledTimes(3);
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('serves a same-machine bootstrap prepare through the local authority', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-same-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(betaRoot, { recursive: true });
    const callMachineRpc = vi.fn(async () => {
      throw new Error('same-machine bootstrap must not use the machine RPC boundary');
    });
    const harness = createAuthorityHarness({
      localMachineId: 'machine-a',
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      callMachineRpc,
    });
    try {
      await expect(harness.authority.prepareBootstrapAtTarget({
        ...prepareRequest({ targetWorkspaceRefId: 'workspace-alpha', endpointRole: 'alpha' }),
        targetMachineId: 'machine-a',
      })).resolves.toMatchObject({ state: 'ready', targetWorkspaceRefId: 'workspace-alpha' });
      await expect(stat(alphaRoot)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      expect(callMachineRpc).not.toHaveBeenCalled();
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
