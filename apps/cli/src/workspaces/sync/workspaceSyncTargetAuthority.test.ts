import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
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
import { createScmBackendRegistry } from '@/scm/registry';
import { deriveWorkspaceSyncRelationshipId } from './workspaceSyncRelationshipIdentity';
import { createWorkspaceRootOwnershipManager, type WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import { createWorkspaceSyncTargetAuthority } from './workspaceSyncTargetAuthority';
import { workspaceSyncTargetBootstrap } from './workspaceSyncTargetBootstrap';
import { materializeLocalWorkspaceSyncSeed } from './workspaceSyncSeedTransfer';
import {
  beginWorkspaceTargetMaterialization,
  rehydrateWorkspaceTargetMaterializationFromReceiptPath,
} from '@/scm/workspace/workspaceExportMaterialization';

/**
 * A destructive replacement proof is stamped for the handoff operation, while
 * the relationship it bootstraps is named by the canonical derivation of that
 * operation. Fixtures must use the real rule, or they would prove only that a
 * caller can repeat one id back to the target.
 */
const handoffOperationId = 'handoff-op-1';
const relationshipId = deriveWorkspaceSyncRelationshipId(handoffOperationId);

const contentPolicyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
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
    mode?: 'keep_synced' | 'mirror_exactly' | 'keep_both_in_sync';
    betaServerId?: string;
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
        { id: 'workspace-beta', serverId: options.betaServerId ?? 'server-1', machineId: 'machine-b', rootPath: betaRoot, createdAtMs: 1 },
        ...(options.extraRefs ?? []).map((ref) => ({ serverId: 'server-1', createdAtMs: 1, ...ref })),
      ],
      workspaceSyncRelationshipsV1: includeRelationship ? [{
        v: 1,
        relationshipId,
        controllerMachineId: 'machine-a',
        alphaWorkspaceRefId: 'workspace-alpha',
        betaWorkspaceRefId: 'workspace-beta',
        mode: options.mode ?? 'keep_both_in_sync',
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
  materializationDirectory: string;
  lockDirectory: string;
  cleanup(): Promise<void>;
}>;

let harnessCounter = 0;

function ownedRootedAgent(stream = new PassThrough()) {
  return {
    stream,
    stop: vi.fn(async () => { stream.destroy(); }),
  };
}

function createAuthorityHarness(options: Readonly<{
  localMachineId?: string;
  getSettingsSnapshot: () => ActiveAccountSettingsSnapshot | null;
  callMachineRpc?: (input: Readonly<{ machineId: string; method: string; request: unknown; signal?: AbortSignal }>) => Promise<unknown>;
  openRootedAgent?: (input: Readonly<{ operationId: string; role: 'alpha' | 'beta'; workspaceRefId: string; canonicalRoot: string; signal?: AbortSignal }>) => Promise<ReturnType<typeof ownedRootedAgent>>;
  materializeRemoteSeed?: false | NonNullable<NonNullable<Parameters<typeof createWorkspaceSyncTargetAuthority>[0]['bootstrap']>['materializeRemoteSeed']>;
  materializeLocalSeed?: NonNullable<NonNullable<Parameters<typeof createWorkspaceSyncTargetAuthority>[0]['bootstrap']>['materializeLocalSeed']>;
  writeReadyFact?: NonNullable<NonNullable<Parameters<typeof createWorkspaceSyncTargetAuthority>[0]['bootstrap']>['writeReadyFact']>;
  rehydrateMaterializationFromReceiptPath?: NonNullable<NonNullable<Parameters<typeof createWorkspaceSyncTargetAuthority>[0]['bootstrap']>['rehydrateMaterializationFromReceiptPath']>;
  assertConflictResolutionAuthorized?: NonNullable<Parameters<typeof createWorkspaceSyncTargetAuthority>[0]['assertConflictResolutionAuthorized']>;
  assertTargetReplacementAuthorized?: NonNullable<Parameters<typeof createWorkspaceSyncTargetAuthority>[0]['assertTargetReplacementAuthorized']>;
}>): AuthorityHarness {
  const suffix = `${process.pid}-${++harnessCounter}-${Math.random().toString(36).slice(2)}`;
  const materializationDirectory = join(tmpdir(), `workspace-sync-authority-staging-${suffix}`);
  const lockDirectory = join(tmpdir(), `workspace-sync-authority-locks-${suffix}`);
  const rootOwnershipManager = createWorkspaceRootOwnershipManager({ lockDirectory });
  const authority = createWorkspaceSyncTargetAuthority({
    localServerId: 'server-1',
    localMachineId: options.localMachineId ?? 'machine-b',
    getSettingsSnapshot: options.getSettingsSnapshot,
    callMachineRpc: options.callMachineRpc ?? (async () => { throw new Error('unexpected machine RPC'); }),
    assertConflictResolutionAuthorized: options.assertConflictResolutionAuthorized ?? (async () => undefined),
    assertTargetReplacementAuthorized: options.assertTargetReplacementAuthorized ?? (async () => undefined),
    ...(options.openRootedAgent ? { openRootedAgent: options.openRootedAgent } : {}),
    bootstrap: {
      materializationDirectory,
      rootOwnershipManager,
      ...(options.materializeRemoteSeed === false
        ? {}
        : {
            materializeRemoteSeed: options.materializeRemoteSeed ?? (async () => ({
              receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null },
              bindPromotedTarget: async () => undefined,
              commit: async () => undefined,
              abort: async () => undefined,
            })),
          }),
      ...(options.materializeLocalSeed ? { materializeLocalSeed: options.materializeLocalSeed } : {}),
      ...(options.writeReadyFact ? { writeReadyFact: options.writeReadyFact } : {}),
      ...(options.rehydrateMaterializationFromReceiptPath
        ? { rehydrateMaterializationFromReceiptPath: options.rehydrateMaterializationFromReceiptPath }
        : {}),
    },
  });
  return {
    authority,
    rootOwnershipManager,
    materializationDirectory,
    lockDirectory,
    cleanup: async () => {
      await rm(materializationDirectory, { recursive: true, force: true });
      await rm(lockDirectory, { recursive: true, force: true });
    },
  };
}

function prepareRequest(overrides: Record<string, unknown> = {}) {
  return {
    v: 1 as const,
    bootstrapOperationId: relationshipId,
    owner: { kind: 'relationship' as const, relationshipId },
    transientRelationship: {
      v: 1 as const, relationshipId, controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-alpha', betaWorkspaceRefId: 'workspace-beta',
      mode: 'keep_both_in_sync' as const, contentPolicy, enabled: true,
      createdAtMs: 1, updatedAtMs: 1,
    },
    targetWorkspaceRefId: 'workspace-beta',
    endpointRole: 'beta' as const,
    policyDigest: contentPolicy.policyDigest,
    createIfMissing: true,
    targetBootstrap: 'materialize_from_source_workspace' as const,
    ...overrides,
  };
}

function copyOncePrepareRequest(overrides: Record<string, unknown> = {}) {
  return prepareRequest({
    bootstrapOperationId: 'bootstrap-op-1',
    transientRelationship: undefined,
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
    targetBootstrap: 'materialize_from_source_workspace',
    ...overrides,
  });
}

function existingRelationshipPrepareRequest(overrides: Record<string, unknown> = {}) {
  return prepareRequest({
    bootstrapOperationId: 'existing-handoff',
    transientRelationship: undefined,
    targetBootstrap: undefined,
    ...overrides,
  });
}

function conflictDeleteRequest(path: string, expectedDigest?: string) {
  const request = {
    relationshipId,
    path,
    keep: 'alpha' as const,
    expectedKind: 'file' as const,
    ...(expectedDigest === undefined ? {} : { expectedDigest }),
  };
  return {
    actionReceiptId: 'approval-1',
    actionInput: { controllerMachineId: 'machine-a', request },
    relationshipId,
    workspaceRefId: 'workspace-beta',
    path,
    expectedKind: 'file' as const,
    ...(expectedDigest === undefined ? {} : { expectedDigest }),
  };
}

async function approvedPrepareRequest(
  harness: AuthorityHarness,
  targetPath: string,
  overrides: Record<string, unknown> = {},
) {
  const preflight = await harness.authority.preflightHandoffTargetReplacementHere({
    v: 1,
    serverId: 'server-1',
    machineId: 'machine-b',
    operationId: handoffOperationId,
    targetPath,
  });
  if (preflight.type !== 'approval_required') throw new Error('expected target replacement approval');
  return prepareRequest({
    ...approvalBinding(preflight.approval),
    ...overrides,
  });
}

function approvalBinding(approval: import('@happier-dev/protocol').HandoffTargetReplacementApprovalV1) {
  return {
    targetReplacementApproval: approval,
    targetReplacementApprovalReceiptId: 'handoff-target-approval-1',
    targetReplacementApprovalActionInput: {
      sessionId: 'session-1',
      targetMachineId: approval.machineId,
      targetPath: approval.canonicalRoot,
    },
  };
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition was not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('workspace sync target authority', () => {
  it('settles every retained bootstrap during shutdown and preserves failed custody for retry', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-sweep-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const gammaRoot = join(fixture, 'gamma');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot), mkdir(gammaRoot)]);
    await Promise.all([
      writeFile(join(betaRoot, 'existing.txt'), 'beta'),
      writeFile(join(gammaRoot, 'existing.txt'), 'gamma'),
    ]);
    const firstFailure = new Error('first materialization abort failed');
    const firstAbort = vi.fn()
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValueOnce(undefined);
    const secondAbort = vi.fn(async () => undefined);
    let materializationIndex = 0;
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, {
        includeRelationship: false,
        extraRefs: [{ id: 'workspace-gamma', machineId: 'machine-b', rootPath: gammaRoot }],
      }),
      materializeRemoteSeed: async () => ({
        receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null },
        bindPromotedTarget: async () => undefined,
        commit: async () => undefined,
        abort: materializationIndex++ === 0 ? firstAbort : secondAbort,
      }),
    });
    try {
      const betaPreflight = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: 'copy-op-1', targetPath: betaRoot,
      });
      if (betaPreflight.type !== 'approval_required') throw new Error('expected beta approval');
      const gammaPreflight = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: 'copy-op-2', targetPath: gammaRoot,
      });
      if (gammaPreflight.type !== 'approval_required') throw new Error('expected gamma approval');
      await harness.authority.prepareBootstrapHere(copyOncePrepareRequest({
        ...approvalBinding(betaPreflight.approval),
      }));
      await harness.authority.prepareBootstrapHere(copyOncePrepareRequest({
        bootstrapOperationId: 'bootstrap-op-2',
        owner: {
          kind: 'copy_once',
          operation: {
            v: 1,
            operationId: 'copy-op-2',
            controllerMachineId: 'machine-a',
            alphaWorkspaceRefId: 'workspace-alpha',
            betaWorkspaceRefId: 'workspace-gamma',
            contentPolicy,
          },
        },
        targetWorkspaceRefId: 'workspace-gamma',
        ...approvalBinding(gammaPreflight.approval),
      }));

      await expect(harness.authority.releaseAllRetainedBootstraps()).rejects.toBe(firstFailure);
      expect(firstAbort).toHaveBeenCalledOnce();
      expect(secondAbort).toHaveBeenCalledOnce();
      const betaOwnership = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'post-sweep-beta', canonicalRoot: await realpath(betaRoot), operation: 'handoff',
      });
      expect('kind' in betaOwnership).toBe(false);
      if (!('kind' in betaOwnership)) await betaOwnership.release();
      const gammaOwnership = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'post-sweep-gamma', canonicalRoot: await realpath(gammaRoot), operation: 'handoff',
      });
      expect('kind' in gammaOwnership).toBe(false);
      if (!('kind' in gammaOwnership)) await gammaOwnership.release();

      await expect(harness.authority.releaseAllRetainedBootstraps()).resolves.toBeUndefined();
      expect(firstAbort).toHaveBeenCalledTimes(2);
      expect(secondAbort).toHaveBeenCalledOnce();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('externalizes manual materialization recovery instead of retrying destructive cleanup', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-manual-recovery-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot)]);
    await writeFile(join(betaRoot, 'existing.txt'), 'beta');
    const recoveryError = Object.assign(new Error('manual recovery required'), {
      code: 'workspace_target_materialization_manual_recovery',
    });
    const abort = vi.fn(async () => { throw recoveryError; });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { includeRelationship: false }),
      materializeRemoteSeed: async () => ({
        receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null },
        bindPromotedTarget: async () => undefined,
        commit: async () => undefined,
        abort,
      }),
    });
    try {
      const preflight = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: 'copy-op-1', targetPath: betaRoot,
      });
      if (preflight.type !== 'approval_required') throw new Error('expected approval');
      await harness.authority.prepareBootstrapHere(copyOncePrepareRequest(approvalBinding(preflight.approval)));

      await expect(harness.authority.releaseAllRetainedBootstraps()).resolves.toBeUndefined();
      await expect(harness.authority.releaseAllRetainedBootstraps()).resolves.toBeUndefined();
      expect(abort).toHaveBeenCalledOnce();
      const ownership = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'post-externalization', canonicalRoot: await realpath(betaRoot), operation: 'handoff',
      });
      expect('kind' in ownership).toBe(false);
      if (!('kind' in ownership)) await ownership.release();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('stamps a non-empty handoff target proof under arbitration and releases before returning', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-target-preflight-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot)]);
    await writeFile(join(betaRoot, 'existing.txt'), 'preserve');
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
    });
    try {
      const result = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1,
        serverId: 'server-1',
        machineId: 'machine-b',
        operationId: 'handoff-action-1',
        targetPath: betaRoot,
      });
      expect(result).toMatchObject({
        type: 'approval_required',
        approval: {
          consequences: ['replace_nonempty_workspace_target'],
          serverId: 'server-1',
          machineId: 'machine-b',
          canonicalRoot: await realpath(betaRoot),
          operationId: 'handoff-action-1',
        },
      });
      const reacquired = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'probe-after-human-wait',
        canonicalRoot: await realpath(betaRoot),
        operation: 'handoff',
      });
      expect('kind' in reacquired).toBe(false);
      if (!('kind' in reacquired)) await reacquired.release();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });
  it('asks exactly once for every destructive consequence the handoff target decision carries', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-target-consequences-'));
    const alphaRoot = join(fixture, 'alpha');
    const emptyRoot = join(fixture, 'empty');
    const missingRoot = join(fixture, 'missing');
    const filledRoot = join(fixture, 'filled');
    await Promise.all([mkdir(alphaRoot), mkdir(emptyRoot), mkdir(filledRoot)]);
    await writeFile(join(filledRoot, 'existing.txt'), 'preserve');
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, filledRoot),
    });
    const preflight = async (targetPath: string, activatesExactMirror: boolean) => (
      await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1,
        serverId: 'server-1',
        machineId: 'machine-b',
        operationId: 'handoff-action-1',
        targetPath,
        ...(activatesExactMirror ? { activatesExactMirror: true } : {}),
      })
    );
    try {
      // Nothing to lose and no deletion semantics: no approval at all.
      expect(await preflight(missingRoot, false)).toEqual({ type: 'not_required' });
      expect(await preflight(emptyRoot, false)).toEqual({ type: 'not_required' });

      // Exact mirroring authorizes future target-only deletion even when the
      // destination is missing or empty today.
      expect(await preflight(missingRoot, true)).toMatchObject({
        type: 'approval_required',
        approval: { consequences: ['delete_target_only_files_during_exact_mirror'] },
      });
      expect(await preflight(emptyRoot, true)).toMatchObject({
        type: 'approval_required',
        approval: {
          consequences: ['delete_target_only_files_during_exact_mirror'],
          canonicalRoot: await realpath(emptyRoot),
        },
      });

      // Both consequences apply to one destination decision, so they are bound
      // to one proof rather than two prompts.
      expect(await preflight(filledRoot, true)).toMatchObject({
        type: 'approval_required',
        approval: {
          consequences: [
            'replace_nonempty_workspace_target',
            'delete_target_only_files_during_exact_mirror',
          ],
          canonicalRoot: await realpath(filledRoot),
        },
      });
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('keeps destructive materialization custody until the release outcome is known', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-custody-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot)]);
    await writeFile(join(alphaRoot, 'from-source.txt'), 'new');
    await writeFile(join(betaRoot, 'existing.txt'), 'existing');
    let materialization: Awaited<ReturnType<typeof materializeLocalWorkspaceSyncSeed>> | null = null;
    const commit = vi.fn(async () => await materialization?.commit());
    const abort = vi.fn(async () => await materialization?.abort());
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { relationshipEnabled: false }),
      materializeRemoteSeed: async ({ operationId, canonicalRoot }) => {
        materialization = await materializeLocalWorkspaceSyncSeed({
          operationId,
          activeServerDir: fixture,
          sourcePath: alphaRoot,
          targetPath: canonicalRoot,
          workspaceTransfer: { includeIgnoredMode: 'include_selected', ignoredIncludeGlobs: [] },
          registry: createScmBackendRegistry([]),
        });
        return {
          receipt: materialization.receipt,
          bindPromotedTarget: async () => await materialization?.bindPromotedTarget(),
          commit,
          abort,
        };
      },
    });
    try {
      await harness.authority.prepareBootstrapHere(await approvedPrepareRequest(harness, betaRoot));
      expect(commit).not.toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();

      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: relationshipId,
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'abort',
      })).resolves.toEqual({ ok: true, released: true });
      expect(abort).toHaveBeenCalledOnce();
      expect(commit).not.toHaveBeenCalled();
      await expect(readFile(join(betaRoot, 'existing.txt'), 'utf8')).resolves.toBe('existing');
      await expect(readFile(join(betaRoot, 'from-source.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('does not delete rollback custody when READY publication fails', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-ready-failure-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot)]);
    await writeFile(join(betaRoot, 'existing.txt'), 'existing');
    const commit = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const readyFailure = new Error('injected READY publication failure');
    const writeReadyFact = vi.fn().mockRejectedValueOnce(readyFailure).mockResolvedValue(undefined);
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { includeRelationship: false }),
      writeReadyFact,
      materializeRemoteSeed: async () => ({
        receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null },
        bindPromotedTarget: async () => undefined,
        commit,
        abort,
      }),
    });
    try {
      const preflight = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: 'copy-op-1', targetPath: betaRoot,
      });
      if (preflight.type !== 'approval_required') throw new Error('expected approval');
      await harness.authority.prepareBootstrapHere(copyOncePrepareRequest(approvalBinding(preflight.approval)));

      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'bootstrap-op-1',
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'copy_committed',
      })).rejects.toBe(readyFailure);
      expect(writeReadyFact).toHaveBeenCalledOnce();
      expect(commit).not.toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();
      const overlap = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'ready-failure-probe', canonicalRoot: await realpath(betaRoot), operation: 'handoff',
      });
      expect(overlap).toMatchObject({ kind: 'overlap' });
      if (!('kind' in overlap)) await overlap.release();

      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'bootstrap-op-1',
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'copy_committed',
      })).resolves.toEqual({ ok: true, released: true });
      expect(writeReadyFact).toHaveBeenCalledTimes(2);
      expect(commit).toHaveBeenCalledOnce();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('keeps committed READY custody fenced and retries cleanup instead of aborting it', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-ready-cleanup-retry-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot)]);
    await writeFile(join(betaRoot, 'existing.txt'), 'existing');
    const cleanupFailure = new Error('injected committed custody cleanup failure');
    const commit = vi.fn().mockRejectedValueOnce(cleanupFailure).mockResolvedValue(undefined);
    const abort = vi.fn(async () => undefined);
    const writeReadyFact = vi.fn(async () => undefined);
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { includeRelationship: false }),
      writeReadyFact,
      materializeRemoteSeed: async () => ({
        receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null },
        bindPromotedTarget: async () => undefined,
        commit,
        abort,
      }),
    });
    try {
      const preflight = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: 'copy-op-1', targetPath: betaRoot,
      });
      if (preflight.type !== 'approval_required') throw new Error('expected approval');
      await harness.authority.prepareBootstrapHere(copyOncePrepareRequest(approvalBinding(preflight.approval)));

      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'bootstrap-op-1',
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'copy_committed',
      })).rejects.toBe(cleanupFailure);
      expect(writeReadyFact).toHaveBeenCalledOnce();
      expect(commit).toHaveBeenCalledOnce();
      expect(abort).not.toHaveBeenCalled();
      const overlap = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'ready-cleanup-failure-probe', canonicalRoot: await realpath(betaRoot), operation: 'handoff',
      });
      expect(overlap).toMatchObject({ kind: 'overlap' });
      if (!('kind' in overlap)) await overlap.release();

      await expect(harness.authority.releaseAllRetainedBootstraps()).resolves.toBeUndefined();
      expect(writeReadyFact).toHaveBeenCalledOnce();
      expect(commit).toHaveBeenCalledTimes(2);
      expect(abort).not.toHaveBeenCalled();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('commits destructive materialization custody while retaining the enabled relationship fence', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-custody-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot)]);
    await writeFile(join(betaRoot, 'existing.txt'), 'existing');
    const commit = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { relationshipEnabled: true }),
      materializeRemoteSeed: async () => ({ receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null }, bindPromotedTarget: async () => undefined, commit, abort }),
    });
    try {
      await harness.authority.prepareBootstrapHere(await approvedPrepareRequest(harness, betaRoot));
      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: relationshipId,
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'relationship_committed',
      })).resolves.toEqual({ ok: true, released: false });
      expect(commit).toHaveBeenCalledOnce();
      expect(abort).not.toHaveBeenCalled();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });


  it('does not infer restart custody from settings and a matching root without final READY', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-delete-unready-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const loserPath = join(betaRoot, 'loser.txt');
    await writeFile(loserPath, 'loser');
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      await expect(harness.authority.deleteConflictLoserHere({
        ...conflictDeleteRequest('loser.txt', createHash('sha1').update('loser').digest('hex')),
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
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const loserPath = join(betaRoot, 'loser.txt');
    await writeFile(loserPath, 'loser');
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest({
        createIfMissing: false,
        targetBootstrap: 'use_existing',
      }));
      await harness.authority.deleteConflictLoserHere({
        ...conflictDeleteRequest('loser.txt', createHash('sha1').update('loser').digest('hex')),
      });
      await expect(readFile(loserPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('leaves the loser untouched when target-side Action receipt authority is stale', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-delete-stale-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const loserPath = join(betaRoot, 'loser.txt');
    await writeFile(loserPath, 'loser');
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      assertConflictResolutionAuthorized: async () => {
        throw Object.assign(new Error('stale'), { code: 'approval_stale' });
      },
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest({
        createIfMissing: false,
        targetBootstrap: 'use_existing',
      }));
      await expect(harness.authority.deleteConflictLoserHere({
        ...conflictDeleteRequest('loser.txt', createHash('sha1').update('loser').digest('hex')),
      })).rejects.toMatchObject({ code: 'approval_stale' });
      await expect(readFile(loserPath, 'utf8')).resolves.toBe('loser');
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
      await harness.authority.prepareBootstrapHere(prepareRequest({
        createIfMissing: false,
        targetBootstrap: 'use_existing',
      }));
      await rm(betaRoot, { recursive: true, force: true });
      await mkdir(betaRoot, { recursive: true });
      const replacementLoser = join(betaRoot, 'loser.txt');
      await writeFile(replacementLoser, 'replacement');

      await expect(harness.authority.deleteConflictLoserHere({
        ...conflictDeleteRequest('loser.txt', createHash('sha1').update('replacement').digest('hex')),
      })).rejects.toMatchObject({ code: 'root_changed' });
      await expect(readFile(replacementLoser, 'utf8')).resolves.toBe('replacement');
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a conflict preview when the retained target root object changed', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-preview-root-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    await mkdir(betaRoot, { recursive: true });
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest({
        createIfMissing: false,
        targetBootstrap: 'use_existing',
      }));
      await rm(betaRoot, { recursive: true, force: true });
      await mkdir(betaRoot, { recursive: true });
      await writeFile(join(betaRoot, 'secret.txt'), 'unrelated replacement bytes');

      // Disclosure must be bound to the same retained root object as deletion:
      // a replacement tree at the granted pathname is not the granted root.
      await expect(harness.authority.readFileHere({
        relationshipId,
        workspaceRefId: 'workspace-beta',
        path: 'secret.txt',
        maxBytes: 1024,
      })).rejects.toMatchObject({ code: 'root_changed' });
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
      localServerId: 'server-1',
      localMachineId: 'machine-a',
      getSettingsSnapshot: () => snapshot('/alpha', '/beta'),
      callMachineRpc,
    });

    await expect(authority.readFileAtTarget({
      relationshipId,
      targetMachineId: 'machine-b',
      targetWorkspaceRefId: 'workspace-beta',
      path: 'src/index.ts',
      maxBytes: 1024,
    })).resolves.toMatchObject({ status: 'text', text: 'hello' });
    expect(callMachineRpc).toHaveBeenCalledWith({
      machineId: 'machine-b',
      method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_FILE_READ,
      request: {
        relationshipId, workspaceRefId: 'workspace-beta',
        path: 'src/index.ts', maxBytes: 1024,
      },
    });
  });

  it('rejects a workspace ref outside the relationship and a mismatched target machine', async () => {
    const authority = createWorkspaceSyncTargetAuthority({
      localServerId: 'server-1',
      localMachineId: 'machine-a',
      getSettingsSnapshot: () => snapshot('/alpha', '/beta'),
      callMachineRpc: vi.fn(),
    });
    await expect(authority.readFileHere({
      relationshipId, workspaceRefId: 'workspace-other', path: 'file.txt', maxBytes: 10,
    })).rejects.toMatchObject({ code: 'relationship_not_ready' });
    await expect(authority.readFileAtTarget({
      relationshipId, targetMachineId: 'machine-c', targetWorkspaceRefId: 'workspace-beta',
      path: 'file.txt', maxBytes: 10,
    })).rejects.toMatchObject({ code: 'peer_unavailable' });
  });

  it('fail-closes local mutations, routed target calls and ingress with the exact typed legacy-state code', async () => {
    for (const code of ['legacy_workspace_sync_state_unsupported', 'legacy_workspace_sync_state_unknown'] as const) {
      const callMachineRpc = vi.fn(async () => undefined);
      const authority = createWorkspaceSyncTargetAuthority({
        localServerId: 'server-1',
        localMachineId: 'machine-b',
        getSettingsSnapshot: () => snapshot('/alpha', '/beta'),
        callMachineRpc,
        assertLegacyStateAvailable: () => { throw Object.assign(new Error('legacy workspace sync state'), { code }); },
      });
      const expectTyped = (run: Promise<unknown>) => expect(run).rejects.toMatchObject({ code });
      await expectTyped(authority.deleteConflictLoserHere({
        ...conflictDeleteRequest('src/x.ts'),
      }));
      await expectTyped(authority.readFileHere({
        relationshipId, workspaceRefId: 'workspace-beta', path: 'src/x.ts', maxBytes: 64,
      }));
      await expectTyped(authority.prepareBootstrapHere({
        v: 1, bootstrapOperationId: 'boot-op-1',
        owner: { kind: 'relationship', relationshipId },
        targetWorkspaceRefId: 'workspace-beta', endpointRole: 'beta',
        policyDigest: contentPolicy.policyDigest, createIfMissing: true,
      }));
      await expectTyped(authority.deleteConflictLoserAtTarget({
        actionReceiptId: 'approval-1',
        actionInput: { controllerMachineId: 'machine-a', request: conflictDeleteRequest('src/x.ts').actionInput.request },
        relationshipId, targetMachineId: 'machine-c', targetWorkspaceRefId: 'workspace-beta',
        path: 'src/x.ts', expectedKind: 'file',
      }));
      await expectTyped(authority.readFileAtTarget({
        relationshipId, targetMachineId: 'machine-c', targetWorkspaceRefId: 'workspace-beta',
        path: 'src/x.ts', maxBytes: 64,
      }));
      await expectTyped(authority.prepareBootstrapAtTarget({
        v: 1, bootstrapOperationId: 'boot-op-1',
        owner: { kind: 'relationship', relationshipId },
        targetWorkspaceRefId: 'workspace-beta', targetMachineId: 'machine-b', endpointRole: 'beta',
        policyDigest: contentPolicy.policyDigest, createIfMissing: true,
      }));
      await expectTyped(authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId, sourceMachineId: 'machine-a', targetMachineId: 'machine-b',
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
  it('rejects target preparation when the selected workspace belongs to another Home', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-home-placement-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const materializeRemoteSeed = vi.fn();
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { betaServerId: 'server-2' }),
      materializeRemoteSeed,
    });
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest()))
        .rejects.toMatchObject({ code: 'workspace_machine_not_enrolled' });
      expect(materializeRemoteSeed).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

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
        bootstrapOperationId: relationshipId,
        targetWorkspaceRefId: 'workspace-beta',
        state: 'ready',
        created: true,
        rootFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
        policyDigest: contentPolicy.policyDigest,
      });
      expect(Object.keys(result).sort()).toEqual([
        'bootstrapOperationId', 'created', 'policyDigest', 'rootFingerprint', 'state', 'targetWorkspaceRefId', 'v',
      ]);
      await expect(stat(betaRoot)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      expect(await readdir(betaRoot)).toEqual([]);
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

  it('restores a missing all-files use-existing target to absence on authority abort', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-missing-use-existing-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { relationshipEnabled: false }),
    });
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        targetBootstrap: 'use_existing',
      }))).resolves.toMatchObject({ created: true, state: 'ready' });
      await expect(stat(betaRoot)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await writeFile(join(betaRoot, 'partially-synced.txt'), 'transient');

      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: relationshipId,
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'abort',
      })).resolves.toEqual({ ok: true, released: true });
      await expect(stat(betaRoot)).rejects.toMatchObject({ code: 'ENOENT' });
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
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        targetBootstrap: 'use_existing',
      })))
        .rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      await expect(harness.authority.prepareBootstrapHere(existingRelationshipPrepareRequest({ createIfMissing: false })))
        .resolves.toMatchObject({ bootstrapOperationId: 'existing-handoff', created: false });
      await expect(harness.authority.prepareBootstrapHere(existingRelationshipPrepareRequest({ policyDigest: 'b'.repeat(64) })))
        .rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        bootstrapOperationId: 'existing-handoff',
        transientRelationship: undefined,
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

  it('adopts the exact retained transient relationship when settings publication re-enters with the same operation', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-persisted-reentry-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    let currentSnapshot = snapshot(alphaRoot, betaRoot, { includeRelationship: false });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => currentSnapshot,
    });
    try {
      const prepared = await harness.authority.prepareBootstrapHere(prepareRequest());
      currentSnapshot = snapshot(alphaRoot, betaRoot);

      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        transientRelationship: undefined,
        targetBootstrap: undefined,
        targetReplacementApproval: undefined,
      }))).resolves.toEqual(prepared);

      currentSnapshot = {
        ...currentSnapshot,
        settings: AccountSettingsSchema.parse({
          ...currentSnapshot.settings,
          workspaceSyncRelationshipsV1: currentSnapshot.settings.workspaceSyncRelationshipsV1.map((relationship) => ({
            ...relationship,
            mode: 'keep_synced',
          })),
        }),
      };
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        transientRelationship: undefined,
        targetBootstrap: undefined,
        targetReplacementApproval: undefined,
      }))).rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });

      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('refuses a destructive approval stamped for another operation without touching the target', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-approval-operation-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    await mkdir(betaRoot, { recursive: true });
    await writeFile(join(betaRoot, 'existing.txt'), 'existing');
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { includeRelationship: false }),
      materializeRemoteSeed: async () => { throw new Error('must not materialize'); },
    });
    try {
      // A proof this target minted for a different handoff operation is replayed
      // against the still-unchanged target of the requesting operation.
      const otherOperation = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: 'copy-op-other', targetPath: betaRoot,
      });
      if (otherOperation.type !== 'approval_required') throw new Error('expected approval');

      await expect(harness.authority.prepareBootstrapHere(copyOncePrepareRequest({
        ...approvalBinding(otherOperation.approval),
      }))).rejects.toMatchObject({ code: 'approval_stale' });

      // The same replay against a relationship endpoint: this relationship is
      // named by `handoffOperationId`, so a proof minted for any other handoff
      // operation cannot authorize its destructive bootstrap either.
      const relationshipHarness = createAuthorityHarness({
        getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
        materializeRemoteSeed: async () => { throw new Error('must not materialize'); },
      });
      try {
        const otherHandoff = await relationshipHarness.authority.preflightHandoffTargetReplacementHere({
          v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: 'handoff-op-other', targetPath: betaRoot,
        });
        if (otherHandoff.type !== 'approval_required') throw new Error('expected approval');
        await expect(relationshipHarness.authority.prepareBootstrapHere(prepareRequest({
          ...approvalBinding(otherHandoff.approval),
        }))).rejects.toMatchObject({ code: 'approval_stale' });
        await expect(readdir(relationshipHarness.materializationDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await relationshipHarness.authority.releaseAllRetainedBootstraps();
        await relationshipHarness.cleanup();
      }

      await expect(readFile(join(betaRoot, 'existing.txt'), 'utf8')).resolves.toBe('existing');
      await expect(readdir(harness.materializationDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
      const free = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'post-refusal', canonicalRoot: await realpath(betaRoot), operation: 'handoff',
      });
      expect('kind' in free).toBe(false);
      if (!('kind' in free)) await free.release();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('requires the exact approved Action receipt before accepting a structural replacement proof', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-action-receipt-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot)]);
    await writeFile(join(betaRoot, 'existing.txt'), 'existing');
    const assertTargetReplacementAuthorized = vi.fn(async () => undefined);
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { includeRelationship: false }),
      assertTargetReplacementAuthorized,
    });
    try {
      const preflight = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: 'copy-op-1', targetPath: betaRoot,
      });
      if (preflight.type !== 'approval_required') throw new Error('expected approval');

      await expect(harness.authority.prepareBootstrapHere(copyOncePrepareRequest({
        targetReplacementApproval: preflight.approval,
      }))).rejects.toThrow();
      expect(assertTargetReplacementAuthorized).not.toHaveBeenCalled();
      await expect(readFile(join(betaRoot, 'existing.txt'), 'utf8')).resolves.toBe('existing');

      const request: WorkspaceSyncTargetBootstrapPrepareV1 = copyOncePrepareRequest(approvalBinding(preflight.approval));
      await expect(harness.authority.prepareBootstrapHere(request)).resolves.toMatchObject({ state: 'ready' });
      expect(assertTargetReplacementAuthorized).toHaveBeenCalledWith(
        request.targetReplacementApprovalReceiptId,
        request.targetReplacementApprovalActionInput,
        preflight.approval,
      );
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('requires exactly the mirror-deletion consequence when exact mirroring activates on an empty target', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-mirror-consequence-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    await mkdir(betaRoot, { recursive: true });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { mode: 'mirror_exactly' }),
    });
    try {
      // Nothing is replaced today, but activating exact mirroring authorizes
      // deleting target-only files for the life of the relationship.
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        transientRelationship: {
          v: 1 as const, relationshipId, controllerMachineId: 'machine-a',
          alphaWorkspaceRefId: 'workspace-alpha', betaWorkspaceRefId: 'workspace-beta',
          mode: 'mirror_exactly' as const, contentPolicy, enabled: true,
          createdAtMs: 1, updatedAtMs: 1,
        },
      }))).rejects.toMatchObject({ code: 'approval_stale' });

      const preflight = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: handoffOperationId,
        targetPath: betaRoot, activatesExactMirror: true,
      });
      if (preflight.type !== 'approval_required') throw new Error('expected mirror approval');
      expect(preflight.approval.consequences).toEqual(['delete_target_only_files_during_exact_mirror']);

      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        transientRelationship: {
          v: 1 as const, relationshipId, controllerMachineId: 'machine-a',
          alphaWorkspaceRefId: 'workspace-alpha', betaWorkspaceRefId: 'workspace-beta',
          mode: 'mirror_exactly' as const, contentPolicy, enabled: true,
          createdAtMs: 1, updatedAtMs: 1,
        },
        ...approvalBinding(preflight.approval),
      }))).resolves.toMatchObject({ state: 'ready' });
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('refuses an approval carrying a consequence this relationship mode does not authorize', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-extra-consequence-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    await mkdir(betaRoot, { recursive: true });
    await writeFile(join(betaRoot, 'existing.txt'), 'existing');
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      materializeRemoteSeed: async () => { throw new Error('must not materialize'); },
    });
    try {
      const preflight = await harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: handoffOperationId,
        targetPath: betaRoot, activatesExactMirror: true,
      });
      if (preflight.type !== 'approval_required') throw new Error('expected approval');
      expect(preflight.approval.consequences).toEqual([
        'replace_nonempty_workspace_target',
        'delete_target_only_files_during_exact_mirror',
      ]);

      // The retained relationship is not mirroring, so the mirror consequence is
      // an extra proof the target must not honour.
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        ...approvalBinding(preflight.approval),
      }))).rejects.toMatchObject({ code: 'approval_stale' });
      await expect(readFile(join(betaRoot, 'existing.txt'), 'utf8')).resolves.toBe('existing');
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
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
      await rejectsAndLeavesRoot(existingRelationshipPrepareRequest(), 'workspace_machine_not_enrolled', 'machine-c');
      await rejectsAndLeavesRoot(existingRelationshipPrepareRequest({ targetWorkspaceRefId: 'workspace-missing' }), 'peer_unavailable');
      await rejectsAndLeavesRoot(existingRelationshipPrepareRequest({ targetWorkspaceRefId: 'workspace-alpha' }), 'relationship_not_ready');
      await rejectsAndLeavesRoot(existingRelationshipPrepareRequest({ policyDigest: 'b'.repeat(64) }), 'bootstrap_definition_conflict');
      const stale = createAuthorityHarness({
        getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { relationshipEnabled: false }),
      });
      try {
        await expect(stale.authority.prepareBootstrapHere(existingRelationshipPrepareRequest())).rejects.toMatchObject({ code: 'relationship_not_ready' });
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
              policyDigest: computeWorkspaceSyncPolicyDigest({
                v: 1, selection: 'git_worktree', extraIgnorePatterns: [], extraIncludePatterns: [],
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
        ownerId: 'probe', canonicalRoot: betaRoot, operation: 'bootstrap', deferRootIdentityBinding: true,
      });
      if ('kind' in probe) throw new Error('copy_once release did not free the root ownership fence');
      await probe.release();
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rehydrates an exact copy_once target from persisted intent and the canonical materialization owner after restart', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-copy-restart-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const materializationDirectory = join(fixture, 'staging');
    const lockDirectory = join(fixture, 'locks');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const currentSnapshot = () => snapshot(alphaRoot, betaRoot, { includeRelationship: false });
    const create = () => createWorkspaceSyncTargetAuthority({
      localServerId: 'server-1',
      localMachineId: 'machine-b',
      getSettingsSnapshot: currentSnapshot,
      callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
      bootstrap: {
        materializationDirectory,
        rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
        materializeRemoteSeed: async () => ({ receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null }, bindPromotedTarget: async () => undefined, commit: async () => undefined, abort: async () => undefined }),
      },
    });
    const first = create();
    try {
      await first.prepareBootstrapHere(copyOncePrepareRequest());
      await first.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'bootstrap-op-1',
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'copy_committed',
      });
      await first.releaseAllRetainedBootstraps();

      const restarted = create();
      await expect(restarted.prepareBootstrapHere(copyOncePrepareRequest({
        bootstrapOperationId: 'copy-op-1',
        createIfMissing: false,
        targetBootstrap: undefined,
      }))).resolves.toMatchObject({
        bootstrapOperationId: 'copy-op-1',
        targetWorkspaceRefId: 'workspace-beta',
        state: 'ready',
        created: false,
        policyDigest: contentPolicy.policyDigest,
      });
      await restarted.releaseAllRetainedBootstraps();
    } finally {
      await first.releaseAllRetainedBootstraps();
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

  it('leaves an empty remote all-files relationship target for the initial Mutagen cycle', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-remote-seed-'));
    const alphaRoot = join(fixture, 'source');
    const betaRoot = join(fixture, 'target');
    await mkdir(alphaRoot, { recursive: true });
    const materializeRemoteSeed = vi.fn(async ({ canonicalRoot }: { canonicalRoot: string }) => {
      await writeFile(join(canonicalRoot, 'from-source.txt'), 'seeded');
      return {
        receipt: { v: 1 as const, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null },
        bindPromotedTarget: async () => undefined,
        commit: async () => undefined,
        abort: async () => undefined,
      };
    });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      materializeRemoteSeed,
    });
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toMatchObject({
        state: 'ready',
        created: true,
      });
      expect(materializeRemoteSeed).not.toHaveBeenCalled();
      expect(await readdir(betaRoot)).toEqual([]);
      await harness.authority.releaseAllRetainedBootstraps();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('materializes an all-files seed when both endpoints belong to this daemon', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-local-seed-'));
    const alphaRoot = join(fixture, 'source');
    const betaRoot = join(fixture, 'target');
    await Promise.all([mkdir(alphaRoot), mkdir(betaRoot)]);
    await writeFile(join(alphaRoot, 'from-local-source.txt'), 'seeded');
    await writeFile(join(betaRoot, 'old-target.txt'), 'old');
    const current = snapshot(alphaRoot, betaRoot);
    const localSnapshot: ActiveAccountSettingsSnapshot = {
      ...current,
      settings: {
        ...current.settings,
        workspaceRefsV1: current.settings.workspaceRefsV1.map((ref) => ({ ...ref, machineId: 'machine-b' })),
        workspaceSyncRelationshipsV1: current.settings.workspaceSyncRelationshipsV1.map((relationship) => ({
          ...relationship,
          controllerMachineId: 'machine-b',
        })),
      },
    };
    const materializeLocalSeed = vi.fn(async ({ operationId, sourcePath, canonicalRoot }: {
      operationId: string;
      sourcePath: string;
      canonicalRoot: string;
    }) => await materializeLocalWorkspaceSyncSeed({
      operationId,
      activeServerDir: fixture,
      sourcePath,
      targetPath: canonicalRoot,
      workspaceTransfer: { includeIgnoredMode: 'include_selected', ignoredIncludeGlobs: [] },
      registry: createScmBackendRegistry([]),
    }));
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => localSnapshot,
      materializeRemoteSeed: false,
      materializeLocalSeed,
    });
    try {
      await harness.authority.prepareBootstrapHere(await approvedPrepareRequest(harness, betaRoot, {
        transientRelationship: {
          ...current.settings.workspaceSyncRelationshipsV1[0]!,
          controllerMachineId: 'machine-b',
        },
      }));
      expect(materializeLocalSeed).toHaveBeenCalledWith(expect.objectContaining({
        operationId: relationshipId,
        sourcePath: alphaRoot,
        canonicalRoot: await realpath(betaRoot),
        // The authority hands the seed the complete bounded policy plus the
        // receipt facts it needs, not a reduced selection hint.
        contentPolicy,
        materializationReceiptPath: expect.any(String),
        originalTargetExists: true,
      }));
      await harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: relationshipId,
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'relationship_committed',
      });
      await harness.authority.releaseAllRetainedBootstraps();
      await expect(readFile(join(betaRoot, 'from-local-source.txt'), 'utf8')).resolves.toBe('seeded');
      await expect(readFile(join(betaRoot, 'old-target.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readdir(fixture)).some((name) => name.startsWith('.happier-sync-backup.'))).toBe(false);
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
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
        v: 1, bootstrapOperationId: relationshipId, targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
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
        v: 1, bootstrapOperationId: relationshipId, targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
      })).resolves.toEqual({ ok: true, released: true });
      const probe = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'probe', canonicalRoot: betaRoot, operation: 'bootstrap', deferRootIdentityBinding: true,
      });
      if ('kind' in probe) throw new Error('disabled relationship abort did not release the fence');
      await probe.release();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('lets the exact admitted handoff operation re-enter an enabled relationship target without competing with its retained fence', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-handoff-replay-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const otherRoot = join(fixture, 'other');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(otherRoot, { recursive: true })]);
    await writeFile(join(alphaRoot, 'source.txt'), 'source');
    await writeFile(join(otherRoot, 'existing.txt'), 'preserve');
    let current = snapshot(alphaRoot, betaRoot);
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => current });
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toMatchObject({ state: 'ready' });

      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1,
        serverId: 'server-1',
        machineId: 'machine-b',
        operationId: handoffOperationId,
        targetPath: betaRoot,
      })).resolves.toEqual({ type: 'not_required' });

      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1,
        serverId: 'server-1',
        machineId: 'machine-b',
        operationId: 'different-handoff-operation',
        targetPath: betaRoot,
      })).rejects.toMatchObject({ code: 'workspace_root_in_use' });

      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1,
        serverId: 'server-1',
        machineId: 'machine-b',
        operationId: handoffOperationId,
        targetPath: otherRoot,
      })).resolves.toMatchObject({
        type: 'approval_required',
        approval: { consequences: ['replace_nonempty_workspace_target'] },
      });

      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1,
        serverId: 'server-1',
        machineId: 'machine-b',
        operationId: handoffOperationId,
        targetPath: alphaRoot,
      })).resolves.toMatchObject({
        type: 'approval_required',
        approval: { consequences: ['replace_nonempty_workspace_target'] },
      });

      current = snapshot(alphaRoot, betaRoot, { relationshipEnabled: false });
      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: handoffOperationId, targetPath: betaRoot,
      })).rejects.toMatchObject({ code: 'workspace_root_in_use' });

      current = snapshot(alphaRoot, betaRoot, { includeRelationship: false });
      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: handoffOperationId, targetPath: betaRoot,
      })).rejects.toMatchObject({ code: 'workspace_root_in_use' });

      const duplicatedRef = snapshot(alphaRoot, betaRoot);
      const betaRef = duplicatedRef.settings.workspaceRefsV1.find((workspace) => workspace.id === 'workspace-beta')!;
      current = {
        ...duplicatedRef,
        settings: {
          ...duplicatedRef.settings,
          workspaceRefsV1: [...duplicatedRef.settings.workspaceRefsV1, { ...betaRef }],
        },
      };
      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: handoffOperationId, targetPath: betaRoot,
      })).rejects.toMatchObject({ code: 'workspace_root_in_use' });

      current = snapshot(alphaRoot, betaRoot, {
        extraRefs: [{ id: 'workspace-other', machineId: 'machine-b', rootPath: otherRoot }],
      });
      current = {
        ...current,
        settings: {
          ...current.settings,
          workspaceSyncRelationshipsV1: current.settings.workspaceSyncRelationshipsV1.map((relationship) => ({
            ...relationship,
            betaWorkspaceRefId: 'workspace-other',
          })),
        },
      };
      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: handoffOperationId, targetPath: betaRoot,
      })).rejects.toMatchObject({ code: 'workspace_root_in_use' });

      current = snapshot(alphaRoot, betaRoot, { mode: 'mirror_exactly' });
      await expect(harness.authority.preflightHandoffTargetReplacementHere({
        v: 1, serverId: 'server-1', machineId: 'machine-b', operationId: handoffOperationId, targetPath: betaRoot,
      })).resolves.toEqual({ type: 'not_required' });
      await expect(harness.authority.prepareBootstrapHere(prepareRequest({
        transientRelationship: undefined,
        targetBootstrap: undefined,
        targetReplacementApproval: undefined,
      }))).rejects.toMatchObject({ code: 'bootstrap_definition_conflict' });
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('drops retained ownership when reconciliation detects root identity loss', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-bind-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await mkdir(alphaRoot, { recursive: true });
    const harness = createAuthorityHarness({ getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot) });
    try {
      await expect(harness.authority.prepareBootstrapHere(prepareRequest())).resolves.toMatchObject({ state: 'ready' });
      const canonical = await realpath(betaRoot);
      await rm(betaRoot, { recursive: true, force: true });
      await mkdir(betaRoot, { recursive: true });
      await expect(harness.authority.reconcileRetainedBootstraps()).resolves.toBeUndefined();
      const probe = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'probe', canonicalRoot: canonical, operation: 'bootstrap',
      });
      expect('kind' in probe).toBe(false);
      if (!('kind' in probe)) await probe.release();
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
      const probe = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'probe', canonicalRoot: rootPath, operation: 'bootstrap', deferRootIdentityBinding: true,
      });
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
    const rootedAgentStops: Array<ReturnType<typeof vi.fn>> = [];
    const openRootedAgent = vi.fn(async () => {
      const agent = new PassThrough();
      rootedAgents.push(agent);
      const owned = ownedRootedAgent(agent);
      rootedAgentStops.push(owned.stop);
      return owned;
    });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      const ingress = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      expect(ingress).toMatchObject({
        port: expect.any(Number),
        localCapability: expect.stringMatching(/^[0-9a-f]{64}$/),
        close: expect.any(Function),
      });
      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      })).rejects.toMatchObject({ code: 'peer_unavailable' });
      expect(openRootedAgent).toHaveBeenCalledTimes(1);

      const scanner = connect({ host: '127.0.0.1', port: ingress.port });
      await once(scanner, 'connect');
      scanner.end('unauthorized-local-process');
      await once(scanner, 'close');
      expect(openRootedAgent).toHaveBeenCalledTimes(1);

      await waitForCondition(() => rootedAgents[0]?.destroyed === true);
      expect(rootedAgentStops[0]).toHaveBeenCalledOnce();
      const rejectedAfterFirstAttach = connect({ host: '127.0.0.1', port: ingress.port });
      await expect(once(rejectedAfterFirstAttach, 'error')).resolves.toBeDefined();
      rejectedAfterFirstAttach.destroy();

      const retryIngress = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });

      const client = connect({ host: '127.0.0.1', port: retryIngress.port });
      await once(client, 'connect');
      const response = once(client, 'data') as Promise<[Buffer]>;
      client.write(retryIngress.localCapability);
      client.write(Buffer.from('native-machine-carrier-bytes'));
      await expect(response).resolves.toEqual([Buffer.from('native-machine-carrier-bytes')]);
      expect(openRootedAgent).toHaveBeenCalledWith({
        operationId: relationshipId, role: 'beta', workspaceRefId: 'workspace-beta',
        canonicalRoot: await realpath(betaRoot), signal: expect.any(AbortSignal),
      });
      client.destroy();

      const duplicate = connect({ host: '127.0.0.1', port: retryIngress.port });
      const duplicateOutcome = await new Promise<'connected' | 'refused'>((resolve) => {
        duplicate.once('connect', () => resolve('connected'));
        duplicate.once('error', () => resolve('refused'));
      });
      if (duplicateOutcome === 'connected') {
        duplicate.end(retryIngress.localCapability);
        await once(duplicate, 'close');
      }
      expect(openRootedAgent).toHaveBeenCalledTimes(2);
      await retryIngress.close();
      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-c',
        targetMachineId: 'machine-b',
      })).rejects.toMatchObject({ code: 'peer_unavailable' });

      const pendingIngress = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      const partialCapabilityClient = connect({ host: '127.0.0.1', port: pendingIngress.port });
      await once(partialCapabilityClient, 'connect');
      const partialCapabilityClosed = new Promise<void>((resolve) => {
        partialCapabilityClient.once('close', () => resolve());
      });
      partialCapabilityClient.on('error', () => undefined);
      partialCapabilityClient.write('0');
      await expect(harness.authority.releaseAllRetainedBootstraps()).resolves.toBeUndefined();
      await expect(partialCapabilityClosed).resolves.toBeUndefined();
      expect(rootedAgents[1]?.destroyed).toBe(true);
      const rejectedClient = connect({ host: '127.0.0.1', port: pendingIngress.port });
      await expect(once(rejectedClient, 'error')).resolves.toBeDefined();
      rejectedClient.destroy();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('cancels rooted-agent acquisition and permits an immediate ingress retry', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-ingress-cancel-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    let attempts = 0;
    const openRootedAgent = vi.fn(async (input: Readonly<{ signal?: AbortSignal }>) => {
      attempts += 1;
      if (attempts > 1) return ownedRootedAgent();
      return await new Promise<ReturnType<typeof ownedRootedAgent>>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      });
    });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      const abort = new AbortController();
      const cancelled = harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
        signal: abort.signal,
      });
      await vi.waitFor(() => expect(openRootedAgent).toHaveBeenCalledOnce());
      abort.abort(Object.assign(new Error('request disconnected'), { code: 'cancelled' }));
      await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });

      const retry = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      expect(openRootedAgent).toHaveBeenCalledTimes(2);
      await retry.close();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('retains the target root fence until rooted-agent shutdown succeeds', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-ingress-fence-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const cleanupFailure = new Error('rooted agent stop failed');
    let failStop = true;
    const stop = vi.fn(async () => {
      if (failStop) throw cleanupFailure;
    });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent: async () => ({ stream: new PassThrough(), stop }),
    });
    const canAcquireTargetRoot = async (): Promise<boolean> => {
      const probe = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'fence-probe',
        canonicalRoot: betaRoot,
        operation: 'handoff',
      });
      if ('kind' in probe) return false;
      await probe.release();
      return true;
    };
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });

      await expect(harness.authority.releaseAllRetainedBootstraps()).rejects.toBe(cleanupFailure);
      await expect(canAcquireTargetRoot()).resolves.toBe(false);

      failStop = false;
      await expect(harness.authority.releaseAllRetainedBootstraps()).resolves.toBeUndefined();
      expect(stop).toHaveBeenCalledTimes(2);
      await expect(canAcquireTargetRoot()).resolves.toBe(true);
    } finally {
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('consumes an event-driven ingress close rejection while the explicit closer stays retryable', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-close-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const agentStreams: PassThrough[] = [];
    let failAgentStop = true;
    const stop = vi.fn(async () => {
      if (failAgentStop) throw new Error('rooted agent stop failed');
      for (const agentStream of agentStreams) agentStream.destroy();
    });
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent: async () => {
        const stream = new PassThrough();
        agentStreams.push(stream);
        return { stream, stop };
      },
    });
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      const ingress = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });

      const client = connect({ host: '127.0.0.1', port: ingress.port });
      await once(client, 'connect');
      const response = once(client, 'data') as Promise<[Buffer]>;
      client.write(ingress.localCapability);
      client.write(Buffer.from('carrier-bytes'));
      await expect(response).resolves.toEqual([Buffer.from('carrier-bytes')]);

      // The peer disappears: the socket close event drives cleanup, and the
      // rooted agent stop fails. A daemon must not die of an unhandled
      // rejection because an ingress could not be stopped.
      client.destroy();
      await vi.waitFor(() => expect(stop).toHaveBeenCalled());
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);

      // Custody stayed with the explicit closer: it still reports the failure
      // and still retries it.
      await expect(ingress.close()).rejects.toThrow('rooted agent stop failed');
      failAgentStop = false;
      await expect(ingress.close()).resolves.toBeUndefined();
      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      })).resolves.toMatchObject({ port: expect.any(Number) });
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('owns the machine attach deadline and cancels it after authenticated attachment', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-attach-expiry-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const agents: ReturnType<typeof ownedRootedAgent>[] = [];
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent: async () => {
        const agent = ownedRootedAgent();
        agents.push(agent);
        return agent;
      },
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      const expired = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
        expiresAtMs: Date.now() + 50,
      });
      await waitForCondition(() => agents[0]?.stop.mock.calls.length === 1);
      const afterExpiry = connect({ host: '127.0.0.1', port: expired.port });
      await expect(once(afterExpiry, 'error')).resolves.toBeDefined();
      afterExpiry.destroy();

      const attached = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
        expiresAtMs: Date.now() + 100,
      });
      const client = connect({ host: '127.0.0.1', port: attached.port });
      await once(client, 'connect');
      client.write(attached.localCapability);
      await new Promise((resolve) => setTimeout(resolve, 175));
      expect(agents[1]?.stop).not.toHaveBeenCalled();

      client.destroy();
      await attached.close();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('closes ingress admission and joins an in-flight acquisition before shutdown releases custody', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-ingress-shutdown-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const agent = ownedRootedAgent();
    let resolveAgent!: (value: ReturnType<typeof ownedRootedAgent>) => void;
    const openRootedAgent = vi.fn(async () => await new Promise<ReturnType<typeof ownedRootedAgent>>((resolve) => {
      resolveAgent = resolve;
    }));
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      const acquisition = harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      await vi.waitFor(() => expect(openRootedAgent).toHaveBeenCalledOnce());
      const release = harness.authority.releaseAllRetainedBootstraps();
      resolveAgent(agent);
      await expect(acquisition).rejects.toMatchObject({ code: 'peer_unavailable' });
      await expect(release).resolves.toBeUndefined();
      expect(agent.stop).toHaveBeenCalledOnce();
      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      })).rejects.toMatchObject({ code: 'peer_unavailable' });
      expect(openRootedAgent).toHaveBeenCalledOnce();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps().catch(() => undefined);
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rebinds repeated handoffs to one retained relationship endpoint authority', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-rebind-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const openRootedAgent = vi.fn(async () => ownedRootedAgent());
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      await harness.authority.prepareBootstrapHere(prepareRequest({ bootstrapOperationId: 'handoff-1', transientRelationship: undefined, targetBootstrap: undefined }));
      await harness.authority.prepareBootstrapHere(prepareRequest({ bootstrapOperationId: 'handoff-2', transientRelationship: undefined, targetBootstrap: undefined }));

      const ingress = await harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
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

  it('rehydrates retained relationship ingress from settings and the exact final READY fact after restart', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-restart-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const materializationDirectory = join(fixture, 'staging');
    const lockDirectory = join(fixture, 'locks');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const currentSnapshot = () => snapshot(alphaRoot, betaRoot);
    const first = createWorkspaceSyncTargetAuthority({
      localServerId: 'server-1',
      localMachineId: 'machine-b',
      getSettingsSnapshot: currentSnapshot,
      callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
      openRootedAgent: async () => ownedRootedAgent(),
      bootstrap: {
        materializationDirectory,
        rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
        materializeRemoteSeed: async () => ({ receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null }, bindPromotedTarget: async () => undefined, commit: async () => undefined, abort: async () => undefined }),
      },
    });
    try {
      await first.prepareBootstrapHere(prepareRequest());
      await first.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: relationshipId,
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'relationship_committed',
      });
      await first.releaseAllRetainedBootstraps();

      const openRootedAgent = vi.fn(async () => ownedRootedAgent());
      const restarted = createWorkspaceSyncTargetAuthority({
        localServerId: 'server-1',
        localMachineId: 'machine-b',
        getSettingsSnapshot: currentSnapshot,
        assertConflictResolutionAuthorized: async () => undefined,
        callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
        openRootedAgent,
        bootstrap: {
          materializationDirectory,
          rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
        },
      });
      await restarted.reconcileRetainedBootstraps();
      const ingress = await restarted.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      });
      expect(openRootedAgent).toHaveBeenCalledWith({
        operationId: relationshipId,
        role: 'beta',
        workspaceRefId: 'workspace-beta',
        canonicalRoot: await realpath(betaRoot),
        signal: expect.any(AbortSignal),
      });
      await ingress.close();
      const loserPath = join(betaRoot, 'loser-after-restart.txt');
      await writeFile(loserPath, 'loser');
      await restarted.deleteConflictLoserHere({
        ...conflictDeleteRequest('loser-after-restart.txt', createHash('sha1').update('loser').digest('hex')),
      });
      await expect(readFile(loserPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await restarted.releaseAllRetainedBootstraps();
    } finally {
      await first.releaseAllRetainedBootstraps();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('retains the restart fence when READY cleanup fails and retries commit without aborting', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-restart-cleanup-retry-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const materializationDirectory = join(fixture, 'staging');
    const lockDirectory = join(fixture, 'locks');
    await mkdir(alphaRoot, { recursive: true });
    const rootOwnershipManager = createWorkspaceRootOwnershipManager({ lockDirectory });
    const prepared = await workspaceSyncTargetBootstrap({
      rootPath: betaRoot,
      relationshipId,
      endpointRole: 'beta',
      targetWorkspaceRefId: 'workspace-beta',
      policyDigest: contentPolicy.policyDigest,
      contentSelection: 'all_files',
      materializationDirectory,
      rootOwnershipManager,
      createIfMissing: true,
      targetBootstrap: 'materialize_from_source_workspace',
      materializeSeed: async () => undefined,
    });
    await prepared.publishReady();
    await prepared.release();

    const cleanupFailure = new Error('injected restart cleanup failure');
    const commit = vi.fn();
    const abort = vi.fn();
    const restarted = createWorkspaceSyncTargetAuthority({
      localServerId: 'server-1',
      localMachineId: 'machine-b',
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
      openRootedAgent: async () => ownedRootedAgent(),
      bootstrap: {
        materializationDirectory,
        rootOwnershipManager,
        rehydrateMaterializationFromReceiptPath: async (input) => {
          const custody = await rehydrateWorkspaceTargetMaterializationFromReceiptPath(input);
          if (!custody) return null;
          return {
            receipt: custody.receipt,
            bindPromotedTarget: custody.bindPromotedTarget,
            commit: async () => {
              commit();
              if (commit.mock.calls.length === 1) throw cleanupFailure;
              await custody.commit();
            },
            abort: async () => {
              abort();
              await custody.abort();
            },
          };
        },
      },
    });
    try {
      await expect(restarted.reconcileRetainedBootstraps()).rejects.toBe(cleanupFailure);
      expect(commit).toHaveBeenCalledOnce();
      expect(abort).not.toHaveBeenCalled();

      const overlap = await rootOwnershipManager.tryAcquire({
        ownerId: 'restart-cleanup-overlap-probe',
        canonicalRoot: await realpath(betaRoot),
        operation: 'handoff',
      });
      expect(overlap).toMatchObject({ kind: 'overlap' });
      if (!('kind' in overlap)) await overlap.release();

      await expect(restarted.reconcileRetainedBootstraps()).resolves.toBeUndefined();
      expect(commit).toHaveBeenCalledTimes(2);
      expect(abort).not.toHaveBeenCalled();
      await expect(readdir(materializationDirectory)).resolves.toEqual([
        expect.stringMatching(/\.ready\.json$/u),
      ]);
      await expect(restarted.releaseAllRetainedBootstraps()).resolves.toBeUndefined();
      expect(abort).not.toHaveBeenCalled();
    } finally {
      await restarted.releaseAllRetainedBootstraps().catch(() => undefined);
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rolls back rehydrated materialization custody that has no exact final READY fact', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-restart-custody-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const materializationDirectory = join(fixture, 'staging');
    const lockDirectory = join(fixture, 'locks');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    await writeFile(join(betaRoot, 'original.txt'), 'original');
    const operationKey = createHash('sha256')
      .update('workspace-sync-bootstrap-v1\0')
      .update(relationshipId)
      .update('\0beta')
      .digest('hex');
    const materialization = await beginWorkspaceTargetMaterialization({
      targetPath: betaRoot,
      backupDirectoryPrefix: '.happier-sync-backup',
      receiptPath: join(materializationDirectory, `${operationKey}.json`),
      originalTargetExists: true,
    });
    await mkdir(betaRoot);
    await writeFile(join(betaRoot, 'promoted.txt'), 'promoted');
    await materialization.custody.bindPromotedTarget();

    const restarted = createWorkspaceSyncTargetAuthority({
      localServerId: 'server-1',
      localMachineId: 'machine-b',
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
      bootstrap: {
        materializationDirectory,
        rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
      },
    });
    try {
      await restarted.reconcileRetainedBootstraps();
      await expect(restarted.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: `rehydrated:${relationshipId}:beta`,
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'relationship_committed',
      })).resolves.toEqual({ ok: true, released: false });
      await expect(readFile(join(betaRoot, 'promoted.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(betaRoot, 'original.txt'), 'utf8')).resolves.toBe('original');
      await expect(readFile(join(materializationDirectory, `${operationKey}.json`), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await restarted.releaseAllRetainedBootstraps().catch(() => undefined);
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects marker-based ingress rehydration when the workspace is no longer enrolled in this Home', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-restart-home-placement-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const materializationDirectory = join(fixture, 'staging');
    const lockDirectory = join(fixture, 'locks');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    let betaServerId = 'server-1';
    const currentSnapshot = () => snapshot(alphaRoot, betaRoot, { betaServerId });
    const create = (openRootedAgent = vi.fn(async () => ownedRootedAgent())) => createWorkspaceSyncTargetAuthority({
      localServerId: 'server-1',
      localMachineId: 'machine-b',
      getSettingsSnapshot: currentSnapshot,
      callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
      openRootedAgent,
      bootstrap: {
        materializationDirectory,
        rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
        materializeRemoteSeed: async () => ({ receipt: { v: 1, previousTargetName: null, originalTargetIdentity: null, promotedTargetIdentity: null, expectedBackupIdentity: null }, bindPromotedTarget: async () => undefined, commit: async () => undefined, abort: async () => undefined }),
      },
    });
    const first = create();
    try {
      await first.prepareBootstrapHere(prepareRequest());
      await first.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: relationshipId,
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'relationship_committed',
      });
      await first.releaseAllRetainedBootstraps();
      betaServerId = 'server-2';
      const openRootedAgent = vi.fn(async () => ownedRootedAgent());
      const restarted = create(openRootedAgent);

      await expect(restarted.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      })).rejects.toMatchObject({ code: 'workspace_machine_not_enrolled' });
      expect(openRootedAgent).not.toHaveBeenCalled();
      await restarted.releaseAllRetainedBootstraps();
    } finally {
      await first.releaseAllRetainedBootstraps();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects retained ingress when the workspace enrollment moves to another Home', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-ingress-home-placement-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    let betaServerId = 'server-1';
    const openRootedAgent = vi.fn(async () => ownedRootedAgent());
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot, { betaServerId }),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      betaServerId = 'server-2';

      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      })).rejects.toMatchObject({ code: 'workspace_machine_not_enrolled' });
      expect(openRootedAgent).not.toHaveBeenCalled();
    } finally {
      await harness.authority.releaseAllRetainedBootstraps();
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects ingress when the target root was replaced at the same path after bootstrap', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-root-replaced-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const openRootedAgent = vi.fn(async () => ownedRootedAgent());
    const harness = createAuthorityHarness({
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      openRootedAgent,
    });
    try {
      await harness.authority.prepareBootstrapHere(prepareRequest());
      await rm(betaRoot, { recursive: true, force: true });
      await mkdir(betaRoot, { recursive: true });

      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: relationshipId,
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
      await expect(harness.authority.prepareBootstrapAtTarget({ ...prepare, targetMachineId: 'machine-b' }))
        .rejects.toThrow();
      // A target machine that does not own the ref never reaches the transport.
      await expect(harness.authority.prepareBootstrapAtTarget({ ...prepare, targetMachineId: 'machine-c' }))
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
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const callMachineRpc = vi.fn(async () => {
      throw new Error('same-machine bootstrap must not use the machine RPC boundary');
    });
    const harness = createAuthorityHarness({
      localMachineId: 'machine-a',
      getSettingsSnapshot: () => snapshot(alphaRoot, betaRoot),
      callMachineRpc,
    });
    try {
      const prepared = await harness.authority.prepareBootstrapAtTarget({
        ...prepareRequest({ targetWorkspaceRefId: 'workspace-alpha', endpointRole: 'alpha', targetBootstrap: 'use_existing' }),
        targetMachineId: 'machine-a',
      });
      expect(prepared).toMatchObject({
        state: 'ready',
        targetWorkspaceRefId: 'workspace-alpha',
        ownershipHandles: [expect.objectContaining({
          owner: expect.objectContaining({ ownerId: relationshipId, operation: 'bootstrap' }),
        })],
      });
      await expect(harness.rootOwnershipManager.tryAcquire({
        ownerId: relationshipId, canonicalRoot: alphaRoot, operation: 'sync',
      })).resolves.toMatchObject({ kind: 'overlap', existing: { ownerId: relationshipId } });
      await expect(stat(alphaRoot)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      expect(callMachineRpc).not.toHaveBeenCalled();
      await harness.authority.releaseAllRetainedBootstraps();
      const replacement = await harness.rootOwnershipManager.tryAcquire({
        ownerId: 'replacement', canonicalRoot: alphaRoot, operation: 'sync',
      });
      expect('kind' in replacement).toBe(false);
      if (!('kind' in replacement)) await replacement.release();
    } finally {
      await harness.cleanup();
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
