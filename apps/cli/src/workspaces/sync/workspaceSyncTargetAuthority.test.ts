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
import { createWorkspaceRootOwnershipManager, type WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import { createWorkspaceSyncTargetAuthority } from './workspaceSyncTargetAuthority';
import { workspaceSyncTargetBootstrap } from './workspaceSyncTargetBootstrap';
import { materializeLocalWorkspaceSyncSeed } from './workspaceSyncSeedTransfer';

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
  openRootedAgent?: (input: Readonly<{ operationId: string; role: 'alpha' | 'beta'; workspaceRefId: string; canonicalRoot: string; signal?: AbortSignal }>) => Promise<PassThrough>;
  materializeRemoteSeed?: false | NonNullable<NonNullable<Parameters<typeof createWorkspaceSyncTargetAuthority>[0]['bootstrap']>['materializeRemoteSeed']>;
  materializeLocalSeed?: NonNullable<NonNullable<Parameters<typeof createWorkspaceSyncTargetAuthority>[0]['bootstrap']>['materializeLocalSeed']>;
}>): AuthorityHarness {
  const suffix = `${process.pid}-${++harnessCounter}-${Math.random().toString(36).slice(2)}`;
  const stagingDirectory = join(tmpdir(), `workspace-sync-authority-staging-${suffix}`);
  const lockDirectory = join(tmpdir(), `workspace-sync-authority-locks-${suffix}`);
  const rootOwnershipManager = createWorkspaceRootOwnershipManager({ lockDirectory });
  const authority = createWorkspaceSyncTargetAuthority({
    localServerId: 'server-1',
    localMachineId: options.localMachineId ?? 'machine-b',
    getSettingsSnapshot: options.getSettingsSnapshot,
    callMachineRpc: options.callMachineRpc ?? (async () => { throw new Error('unexpected machine RPC'); }),
    ...(options.openRootedAgent ? { openRootedAgent: options.openRootedAgent } : {}),
    bootstrap: {
      stagingDirectory,
      rootOwnershipManager,
      ...(options.materializeRemoteSeed === false
        ? {}
        : {
            materializeRemoteSeed: options.materializeRemoteSeed ?? (async () => ({
              receipt: { v: 1, previousTargetName: null },
              commit: async () => undefined,
              abort: async () => undefined,
            })),
          }),
      ...(options.materializeLocalSeed ? { materializeLocalSeed: options.materializeLocalSeed } : {}),
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
    bootstrapOperationId: 'rel-1',
    owner: { kind: 'relationship' as const, relationshipId: 'rel-1' },
    transientRelationship: {
      v: 1 as const, relationshipId: 'rel-1', controllerMachineId: 'machine-a',
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

async function approvedPrepareRequest(
  harness: AuthorityHarness,
  targetPath: string,
  overrides: Record<string, unknown> = {},
) {
  const preflight = await harness.authority.preflightHandoffTargetReplacementHere({
    v: 1,
    serverId: 'server-1',
    machineId: 'machine-b',
    operationId: 'rel-1',
    targetPath,
  });
  if (preflight.type !== 'approval_required') throw new Error('expected target replacement approval');
  return prepareRequest({ targetReplacementApproval: preflight.approval, ...overrides });
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition was not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('workspace sync target authority', () => {
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
        return { receipt: materialization.receipt, commit, abort };
      },
    });
    try {
      await harness.authority.prepareBootstrapHere(await approvedPrepareRequest(harness, betaRoot));
      expect(commit).not.toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();

      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'rel-1',
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
      materializeRemoteSeed: async () => ({ receipt: { v: 1, previousTargetName: null }, commit, abort }),
    });
    try {
      await harness.authority.prepareBootstrapHere(await approvedPrepareRequest(harness, betaRoot));
      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'rel-1',
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
      await harness.authority.prepareBootstrapHere(prepareRequest({
        createIfMissing: false,
        targetBootstrap: 'use_existing',
      }));
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
      localServerId: 'server-1',
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
      localServerId: 'server-1',
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
        localServerId: 'server-1',
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
        bootstrapOperationId: 'rel-1',
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
      const [operationDirectory] = await readdir(harness.stagingDirectory);
      const readyMarkerPath = join(harness.stagingDirectory, operationDirectory!, 'ready.json');
      await expect(stat(betaRoot)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
      await expect(readFile(readyMarkerPath, 'utf8').then((raw) => JSON.parse(raw)))
        .resolves.toMatchObject({ state: 'READY' });
      await writeFile(join(betaRoot, 'partially-synced.txt'), 'transient');

      await expect(harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'rel-1',
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'abort',
      })).resolves.toEqual({ ok: true, released: true });
      await expect(stat(betaRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(readyMarkerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
      await rejectsAndLeavesRoot(existingRelationshipPrepareRequest(), 'peer_unavailable', 'machine-c');
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

  it('rehydrates an exact copy_once target only from its verified ready marker after restart', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'workspace-sync-authority-copy-restart-'));
    const alphaRoot = join(fixture, 'alpha');
    const betaRoot = join(fixture, 'beta');
    const stagingDirectory = join(fixture, 'staging');
    const lockDirectory = join(fixture, 'locks');
    await Promise.all([mkdir(alphaRoot, { recursive: true }), mkdir(betaRoot, { recursive: true })]);
    const currentSnapshot = () => snapshot(alphaRoot, betaRoot, { includeRelationship: false });
    const create = () => createWorkspaceSyncTargetAuthority({
      localServerId: 'server-1',
      localMachineId: 'machine-b',
      getSettingsSnapshot: currentSnapshot,
      callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
      bootstrap: {
        stagingDirectory,
        rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
        materializeRemoteSeed: async () => ({ receipt: { v: 1, previousTargetName: null }, commit: async () => undefined, abort: async () => undefined }),
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
        receipt: { v: 1 as const, previousTargetName: null },
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
      await expect(readdir(betaRoot)).resolves.toEqual([]);
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
        operationId: 'rel-1',
        sourcePath: alphaRoot,
        canonicalRoot: await realpath(betaRoot),
        contentSelection: 'all_files',
      }));
      await harness.authority.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'rel-1',
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
        v: 1, bootstrapOperationId: 'rel-1', targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
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
        v: 1, bootstrapOperationId: 'rel-1', targetWorkspaceRefId: 'workspace-beta', reason: 'abort',
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
      expect(ingress).toMatchObject({
        port: expect.any(Number),
        localCapability: expect.stringMatching(/^[0-9a-f]{64}$/),
        close: expect.any(Function),
      });
      await expect(harness.authority.acquireWorkspaceSyncMachineIngress({
        operationId: 'rel-1',
        sourceMachineId: 'machine-a',
        targetMachineId: 'machine-b',
      })).rejects.toMatchObject({ code: 'peer_unavailable' });
      expect(openRootedAgent).toHaveBeenCalledTimes(1);

      const scanner = connect({ host: '127.0.0.1', port: ingress.port });
      await once(scanner, 'connect');
      scanner.end('unauthorized-local-process');
      await once(scanner, 'close');
      expect(openRootedAgent).toHaveBeenCalledTimes(1);

      const client = connect({ host: '127.0.0.1', port: ingress.port });
      await once(client, 'connect');
      const response = once(client, 'data') as Promise<[Buffer]>;
      client.write(ingress.localCapability);
      client.write(Buffer.from('native-machine-carrier-bytes'));
      await expect(response).resolves.toEqual([Buffer.from('native-machine-carrier-bytes')]);
      expect(openRootedAgent).toHaveBeenCalledWith({
        operationId: 'rel-1', role: 'beta', workspaceRefId: 'workspace-beta',
        canonicalRoot: await realpath(betaRoot), signal: expect.any(AbortSignal),
      });
      client.destroy();

      const duplicate = connect({ host: '127.0.0.1', port: ingress.port });
      const duplicateOutcome = await new Promise<'connected' | 'refused'>((resolve) => {
        duplicate.once('connect', () => resolve('connected'));
        duplicate.once('error', () => resolve('refused'));
      });
      if (duplicateOutcome === 'connected') {
        duplicate.end(ingress.localCapability);
        await once(duplicate, 'close');
      }
      expect(openRootedAgent).toHaveBeenCalledTimes(1);
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
      await harness.authority.prepareBootstrapHere(prepareRequest());
      await harness.authority.prepareBootstrapHere(prepareRequest({ bootstrapOperationId: 'handoff-1', transientRelationship: undefined, targetBootstrap: undefined }));
      await harness.authority.prepareBootstrapHere(prepareRequest({ bootstrapOperationId: 'handoff-2', transientRelationship: undefined, targetBootstrap: undefined }));

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
      localServerId: 'server-1',
      localMachineId: 'machine-b',
      getSettingsSnapshot: currentSnapshot,
      callMachineRpc: async () => { throw new Error('unexpected machine RPC'); },
      openRootedAgent: async () => new PassThrough(),
      bootstrap: {
        stagingDirectory,
        rootOwnershipManager: createWorkspaceRootOwnershipManager({ lockDirectory }),
        materializeRemoteSeed: async () => ({ receipt: { v: 1, previousTargetName: null }, commit: async () => undefined, abort: async () => undefined }),
      },
    });
    try {
      await first.prepareBootstrapHere(prepareRequest());
      await first.releaseBootstrapHere({
        v: 1,
        bootstrapOperationId: 'rel-1',
        targetWorkspaceRefId: 'workspace-beta',
        reason: 'relationship_committed',
      });
      await first.releaseAllRetainedBootstraps();

      const openRootedAgent = vi.fn(async () => new PassThrough());
      const restarted = createWorkspaceSyncTargetAuthority({
        localServerId: 'server-1',
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
          owner: expect.objectContaining({ ownerId: 'rel-1', operation: 'bootstrap' }),
        })],
      });
      await expect(harness.rootOwnershipManager.tryAcquire({
        ownerId: 'rel-1', canonicalRoot: alphaRoot, operation: 'sync',
      })).resolves.toMatchObject({ kind: 'overlap', existing: { ownerId: 'rel-1' } });
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
