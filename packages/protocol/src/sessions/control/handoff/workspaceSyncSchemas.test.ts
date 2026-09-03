import { describe, expect, it } from 'vitest';

import {
  areWorkspaceSyncRelationshipDefinitionsEqual,
  computeWorkspaceSyncPolicyDigest,
  DeleteWorkspaceSyncConflictLoserV1Schema,
  HandoffTargetReplacementPreflightV1Schema,
  HandoffWorkspaceActionV1Schema,
  ReadWorkspaceSyncFileV1Schema,
  ReadWorkspaceSyncFileResultV1Schema,
  WorkspaceContentPolicyV1Schema,
  WorkspaceSyncConflictListV1Schema,
  WorkspaceSyncLegacyStateInspectionV1Schema,
  WorkspaceSyncRelationshipV1Schema,
  WorkspaceSyncTargetBootstrapPrepareResultV1Schema,
  WorkspaceSyncTargetBootstrapPrepareV1Schema,
  WorkspaceSyncTargetBootstrapReleaseResultV1Schema,
  WorkspaceSyncTargetBootstrapReleaseV1Schema,
  WorkspaceSyncTargetConflictDeleteV1Schema,
  WorkspaceSyncTargetFileReadV1Schema,
  WorkspaceSyncStatusV1Schema,
} from './workspaceSyncSchemas.js';
import {
  SessionHandoffPrepareTargetResultGetResponseSchema,
  SessionHandoffStartRequestSchema,
} from './handoffSchemas.js';
import {
  HandoffTargetReplacementApprovalV1Schema,
  sameHandoffTargetReplacementApproval,
} from './handoffTargetReplacementApprovalV1.js';

const contentPolicyInput = {
  v: 1 as const,
  selection: 'git_worktree' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
  includeGitDirectory: false,
};
const contentPolicy = { ...contentPolicyInput, policyDigest: computeWorkspaceSyncPolicyDigest(contentPolicyInput) };

describe('workspace sync protocol schemas', () => {
  it('publishes only strict read-only legacy-state inspection results', () => {
    expect(WorkspaceSyncLegacyStateInspectionV1Schema.parse({ status: 'absent' })).toEqual({ status: 'absent' });
    expect(WorkspaceSyncLegacyStateInspectionV1Schema.parse({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
      quarantinePath: '/private/state/workspace-replication.retired-123',
      schemaVersion: 1,
    })).toMatchObject({ classification: 'retired_v1', schemaVersion: 1 });
    expect(WorkspaceSyncLegacyStateInspectionV1Schema.parse({
      status: 'legacy_workspace_sync_state_unknown',
      path: '/private/state/workspace-replication',
      reason: 'unrecognized_entries',
    })).toMatchObject({ status: 'legacy_workspace_sync_state_unknown' });
    expect(WorkspaceSyncLegacyStateInspectionV1Schema.safeParse({ status: 'absent', cleanup: true }).success).toBe(false);
  });

  it('defines relationship runtime identity without mutable settings metadata', () => {
    const relationship = {
      v: 1 as const,
      relationshipId: 'rel-1',
      controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-a',
      betaWorkspaceRefId: 'workspace-b',
      mode: 'keep_synced' as const,
      contentPolicy,
      enabled: true,
      createdAtMs: 10,
      updatedAtMs: 11,
    };

    expect(areWorkspaceSyncRelationshipDefinitionsEqual(relationship, {
      ...relationship,
      relationshipId: 'another-settings-record',
      enabled: false,
      createdAtMs: 20,
      updatedAtMs: 21,
    })).toBe(true);

    for (const changed of [
      { ...relationship, controllerMachineId: 'machine-b' },
      { ...relationship, alphaWorkspaceRefId: 'workspace-c' },
      { ...relationship, betaWorkspaceRefId: 'workspace-c' },
      { ...relationship, mode: 'mirror_exactly' as const },
      { ...relationship, contentPolicy: { ...relationship.contentPolicy, policyDigest: 'b'.repeat(64) } },
    ]) {
      expect(areWorkspaceSyncRelationshipDefinitionsEqual(relationship, changed)).toBe(false);
    }
  });

  it('preserves ordered Git policy semantics in the canonical digest', () => {
    const shared = {
      v: 1 as const,
      selection: 'git_worktree' as const,
      extraIncludePatterns: [],
      includeGitDirectory: false,
    };
    const includeAfterIgnore = computeWorkspaceSyncPolicyDigest({
      ...shared,
      extraIgnorePatterns: ['dist/**', '!dist/keep.txt'],
    });
    const ignoreAfterInclude = computeWorkspaceSyncPolicyDigest({
      ...shared,
      extraIgnorePatterns: ['!dist/keep.txt', 'dist/**'],
    });

    expect(includeAfterIgnore).not.toBe(ignoreAfterInclude);
  });

  it('accepts the four product modes and rejects copy_once relationships', () => {
    expect(HandoffWorkspaceActionV1Schema.parse({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(HandoffWorkspaceActionV1Schema.parse({
      kind: 'copy_once',
      contentPolicy,
    })).toMatchObject({ kind: 'copy_once' });
    expect(HandoffWorkspaceActionV1Schema.parse({
      kind: 'create_relationship',
      mode: 'keep_synced',
      contentPolicy,
      flushBeforeCommit: true,
    })).toMatchObject({ kind: 'create_relationship', mode: 'keep_synced' });
    expect(HandoffWorkspaceActionV1Schema.safeParse({
      kind: 'create_relationship',
      mode: 'copy_once',
      contentPolicy,
      flushBeforeCommit: true,
    }).success).toBe(false);
    expect(HandoffWorkspaceActionV1Schema.safeParse({
      kind: 'create_relationship',
      mode: 'keep_synced',
      contentPolicy,
      targetBootstrap: 'use_existing',
      flushBeforeCommit: false,
    }).success).toBe(false);
    expect(HandoffWorkspaceActionV1Schema.parse({ kind: 'relationship', relationshipId: 'rel-1', flushBeforeCommit: true })).toMatchObject({ kind: 'relationship' });
    expect(HandoffWorkspaceActionV1Schema.safeParse({ kind: 'copy_once', contentPolicy }).success).toBe(true);
    expect(HandoffWorkspaceActionV1Schema.safeParse({
      kind: 'copy_once', contentPolicy, targetBootstrap: 'materialize_from_source_workspace',
    }).success).toBe(false);
    expect(HandoffWorkspaceActionV1Schema.safeParse({
      kind: 'copy_once', contentPolicy, destructiveTargetReuseApproved: true,
    }).success).toBe(false);
    expect(HandoffWorkspaceActionV1Schema.safeParse({
      kind: 'copy_once',
      contentPolicy,
      targetReplacementApproval: {
        v: 1,
        consequences: ['replace_nonempty_workspace_target'],
        serverId: 'server-1',
        machineId: 'machine-beta',
        canonicalRoot: '/workspace/beta',
        rootFingerprint: 'a'.repeat(64),
        operationId: 'handoff-action-1',
      },
    }).success).toBe(false);
    expect(HandoffWorkspaceActionV1Schema.safeParse({
      kind: 'relationship',
      relationshipId: 'rel-1',
      flushBeforeCommit: true,
      targetBootstrap: 'use_existing',
    }).success).toBe(false);

    expect(WorkspaceSyncRelationshipV1Schema.safeParse({
      v: 1,
      relationshipId: 'rel-1',
      controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-a',
      betaWorkspaceRefId: 'workspace-b',
      mode: 'keep_synced',
      contentPolicy,
      enabled: true,
      createdAtMs: 10,
      updatedAtMs: 11,
    }).success).toBe(true);
    expect(WorkspaceSyncRelationshipV1Schema.safeParse({
      v: 1,
      relationshipId: 'rel-1',
      controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-a',
      betaWorkspaceRefId: 'workspace-a',
      mode: 'copy_once',
      contentPolicy,
      enabled: true,
      createdAtMs: 10,
      updatedAtMs: 11,
    }).success).toBe(false);
  });

  it('keeps status and conflict projections strict and internally bounded', () => {
    expect(WorkspaceSyncStatusV1Schema.parse({
      relationshipId: 'rel-1',
      controllerMachineId: 'machine-a',
      state: 'watching',
      alphaPath: '/repo/a',
      betaPath: '/repo/b',
      mode: 'keep_both_in_sync',
      changedFiles: 2,
      conflictCount: 1,
      lastSuccessfulSyncAtMs: null,
    })).toMatchObject({ state: 'watching' });

    expect(WorkspaceSyncConflictListV1Schema.safeParse({
      relationshipId: 'rel-1',
      totalCount: 1,
      shownCount: 1,
      truncatedCount: 0,
      conflicts: [{
        relationshipId: 'rel-1',
        path: 'src/index.ts',
        alpha: { kind: 'file', digest: 'a', size: 10 },
        beta: { kind: 'file', digest: 'b', size: 12 },
      }],
    }).success).toBe(true);
    expect(WorkspaceSyncStatusV1Schema.safeParse({
      relationshipId: 'rel-1',
      controllerMachineId: 'machine-a',
      state: 'watching',
      alphaPath: '/repo/a',
      betaPath: '/repo/b',
      mode: 'keep_synced',
      changedFiles: 0,
      conflictCount: 0,
      lastSuccessfulSyncAtMs: null,
      unexpected: true,
    }).success).toBe(false);
  });

  it('bounds workspace conflict file previews and keeps result variants body-safe', () => {
    expect(ReadWorkspaceSyncFileV1Schema.parse({
      relationshipId: 'rel-1',
      side: 'alpha',
      path: 'src/index.ts',
    })).toMatchObject({ maxBytes: 1024 * 1024 });
    expect(ReadWorkspaceSyncFileV1Schema.safeParse({
      relationshipId: 'rel-1',
      side: 'beta',
      path: 'src/index.ts',
      maxBytes: 1024 * 1024 + 1,
    }).success).toBe(false);
    expect(ReadWorkspaceSyncFileResultV1Schema.parse({
      status: 'text',
      text: 'hello',
      digest: 'a'.repeat(40),
      size: 5,
    })).toMatchObject({ status: 'text', text: 'hello' });
    expect(ReadWorkspaceSyncFileResultV1Schema.safeParse({
      status: 'binary',
      bytes: 'must-not-cross-the-status-boundary',
      digest: 'a'.repeat(40),
      size: 5,
    }).success).toBe(false);
  });

  it('keeps target conflict mutation authority root-free', () => {
    expect(WorkspaceSyncTargetConflictDeleteV1Schema.safeParse({
      relationshipId: 'rel-1',
      workspaceRefId: 'workspace-beta',
      path: 'src/index.ts',
      expectedKind: 'file',
      expectedDigest: 'a'.repeat(40),
    }).success).toBe(true);
    expect(WorkspaceSyncTargetConflictDeleteV1Schema.safeParse({
      relationshipId: 'rel-1',
      workspaceRefId: 'workspace-beta',
      rootPath: '/caller/chosen/root',
      path: 'src/index.ts',
      expectedKind: 'file',
    }).success).toBe(false);
  });

  it('requires a digest precondition for file conflict deletion and only a type precondition otherwise', () => {
    const fileRequest = {
      relationshipId: 'rel-1',
      path: 'src/index.ts',
      keep: 'alpha' as const,
      expectedKind: 'file' as const,
    };
    expect(DeleteWorkspaceSyncConflictLoserV1Schema.safeParse(fileRequest).success).toBe(false);
    expect(DeleteWorkspaceSyncConflictLoserV1Schema.safeParse({
      ...fileRequest,
      expectedDigest: 'a'.repeat(40),
    }).success).toBe(true);
    expect(DeleteWorkspaceSyncConflictLoserV1Schema.safeParse({
      ...fileRequest,
      expectedKind: 'directory',
    }).success).toBe(true);
    expect(DeleteWorkspaceSyncConflictLoserV1Schema.safeParse({
      ...fileRequest,
      expectedKind: 'directory',
      expectedDigest: 'a'.repeat(40),
    }).success).toBe(false);

    const targetFileRequest = {
      relationshipId: 'rel-1',
      workspaceRefId: 'workspace-beta',
      path: 'src/index.ts',
      expectedKind: 'file' as const,
    };
    expect(WorkspaceSyncTargetConflictDeleteV1Schema.safeParse(targetFileRequest).success).toBe(false);
    expect(WorkspaceSyncTargetConflictDeleteV1Schema.safeParse({
      ...targetFileRequest,
      expectedDigest: 'a'.repeat(40),
    }).success).toBe(true);
  });

  it('keeps target file-read authority workspace-ref scoped and root-free', () => {
    expect(WorkspaceSyncTargetFileReadV1Schema.parse({
      relationshipId: 'rel-1',
      workspaceRefId: 'workspace-beta',
      path: 'src/index.ts',
    })).toMatchObject({
      relationshipId: 'rel-1',
      workspaceRefId: 'workspace-beta',
      maxBytes: 1024 * 1024,
    });
    expect(WorkspaceSyncTargetFileReadV1Schema.safeParse({
      relationshipId: 'rel-1',
      workspaceRefId: 'workspace-beta',
      rootPath: '/caller/chosen/root',
      path: 'src/index.ts',
    }).success).toBe(false);
    expect(WorkspaceSyncTargetFileReadV1Schema.safeParse({
      relationshipId: 'rel-1',
      side: 'beta',
      path: 'src/index.ts',
    }).success).toBe(false);
  });

  it('rejects non-versioned or malformed content policies', () => {
    expect(WorkspaceContentPolicyV1Schema.safeParse({ ...contentPolicy, v: 2 }).success).toBe(false);
    expect(WorkspaceContentPolicyV1Schema.safeParse({
      ...contentPolicy,
      extraIgnorePatterns: [''],
    }).success).toBe(false);
    expect(WorkspaceContentPolicyV1Schema.safeParse({ ...contentPolicy, policyDigest: '0'.repeat(64) }).success).toBe(false);
  });

  it('requires safe integer relationship timestamps', () => {
    const relationship = {
      v: 1 as const, relationshipId: 'rel-1', controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-a', betaWorkspaceRefId: 'workspace-b', mode: 'keep_synced' as const,
      contentPolicy, enabled: true, createdAtMs: 1, updatedAtMs: 2,
    };
    expect(WorkspaceSyncRelationshipV1Schema.safeParse({ ...relationship, createdAtMs: 1.5 }).success).toBe(false);
    expect(WorkspaceSyncRelationshipV1Schema.safeParse({ ...relationship, updatedAtMs: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });

  it('accepts strict root-free target bootstrap prepare requests for both owner kinds', () => {
    const relationshipPrepare = {
      v: 1 as const,
      bootstrapOperationId: 'bootstrap-op-1',
      owner: { kind: 'relationship' as const, relationshipId: 'rel-1' },
      targetWorkspaceRefId: 'workspace-beta',
      endpointRole: 'beta' as const,
      policyDigest: 'a'.repeat(64),
      createIfMissing: true,
    };
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.parse(relationshipPrepare)).toEqual(relationshipPrepare);
    const copyOnceOperation = {
      v: 1 as const,
      operationId: 'copy-op-1',
      controllerMachineId: 'machine-a',
      alphaWorkspaceRefId: 'workspace-alpha',
      betaWorkspaceRefId: 'workspace-beta',
      contentPolicy,
    };
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.parse({
      ...relationshipPrepare,
      bootstrapOperationId: 'bootstrap-op-2',
      owner: { kind: 'copy_once' as const, operation: copyOnceOperation },
      targetBootstrap: 'materialize_from_source_workspace',
    }).owner).toEqual({ kind: 'copy_once', operation: copyOnceOperation });
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({
      ...relationshipPrepare,
      bootstrapOperationId: 'bootstrap-op-3',
      owner: { kind: 'copy_once' as const, operation: copyOnceOperation },
      targetBootstrap: 'use_existing',
      destructiveTargetReuseApproved: true,
    }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.parse({
      ...relationshipPrepare,
      bootstrapOperationId: 'copy-op-1',
      owner: { kind: 'copy_once' as const, operation: copyOnceOperation },
      createIfMissing: false,
    }).targetBootstrap).toBeUndefined();
  });

  it('rejects caller-supplied paths, credentials, routes and every unknown prepare field', () => {
    const relationshipPrepare = {
      v: 1 as const,
      bootstrapOperationId: 'bootstrap-op-1',
      owner: { kind: 'relationship' as const, relationshipId: 'rel-1' },
      targetWorkspaceRefId: 'workspace-beta',
      endpointRole: 'beta' as const,
      policyDigest: 'a'.repeat(64),
      createIfMissing: true,
    };
    for (const poison of [
      'rootPath', 'sourceRootPath', 'canonicalRoot', 'markerPath', 'credential', 'grant', 'bearer', 'route', 'unknownField',
    ] as const) {
      const poisoned = { ...relationshipPrepare, [poison]: '/caller/chosen/value' } as Record<string, unknown>;
      expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse(poisoned).success).toBe(false);
    }
  });

  it('rejects malformed target bootstrap prepare contracts', () => {
    const relationshipPrepare = {
      v: 1 as const,
      bootstrapOperationId: 'bootstrap-op-1',
      owner: { kind: 'relationship' as const, relationshipId: 'rel-1' },
      targetWorkspaceRefId: 'workspace-beta',
      endpointRole: 'beta' as const,
      policyDigest: 'a'.repeat(64),
      createIfMissing: true,
    };
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({ ...relationshipPrepare, v: 2 }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({ ...relationshipPrepare, endpointRole: 'source' }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({ ...relationshipPrepare, policyDigest: 'A'.repeat(64) }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({ ...relationshipPrepare, policyDigest: 'a'.repeat(63) }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({ ...relationshipPrepare, bootstrapOperationId: '   ' }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({
      ...relationshipPrepare,
      owner: { kind: 'machine', machineId: 'machine-a' },
    }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({
      ...relationshipPrepare,
      owner: {
        kind: 'copy_once',
        operation: {
          v: 1,
          operationId: 'copy-op-1',
          controllerMachineId: 'machine-a',
          alphaWorkspaceRefId: 'workspace-alpha',
          betaWorkspaceRefId: 'workspace-beta',
          contentPolicy: { ...contentPolicy, policyDigest: 'b'.repeat(64) },
        },
      },
    }).success).toBe(false);
  });

  it('keeps the target bootstrap prepare result strict, hex-digested and free of paths or handles', () => {
    const result = {
      v: 1,
      bootstrapOperationId: 'bootstrap-op-1',
      targetWorkspaceRefId: 'workspace-beta',
      state: 'ready',
      created: true,
      rootFingerprint: 'b'.repeat(64),
      policyDigest: 'a'.repeat(64),
    };
    expect(WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse(result)).toEqual(result);
    expect(WorkspaceSyncTargetBootstrapPrepareResultV1Schema.safeParse({ ...result, rootPath: '/leaked/path' }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareResultV1Schema.safeParse({ ...result, handle: { ownerId: 'leaked' } }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareResultV1Schema.safeParse({ ...result, manifestDigest: 'c'.repeat(64) }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareResultV1Schema.safeParse({ ...result, state: 'READY' }).success).toBe(false);
  });

  it('admits one exact transient relationship only on its matching relationship bootstrap owner', () => {
    const transientRelationship = WorkspaceSyncRelationshipV1Schema.parse({
      v: 1,
      relationshipId: 'relationship-transient',
      controllerMachineId: 'machine-alpha',
      alphaWorkspaceRefId: 'workspace-alpha',
      betaWorkspaceRefId: 'workspace-beta',
      mode: 'keep_synced',
      contentPolicy,
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    const request = {
      v: 1 as const,
      bootstrapOperationId: 'relationship-transient',
      owner: { kind: 'relationship' as const, relationshipId: 'relationship-transient' },
      transientRelationship,
      targetWorkspaceRefId: 'workspace-beta',
      endpointRole: 'beta' as const,
      policyDigest: contentPolicy.policyDigest,
      createIfMissing: true,
      targetBootstrap: 'materialize_from_source_workspace' as const,
      targetReplacementApproval: {
        v: 1 as const,
        consequences: ['replace_nonempty_workspace_target'] as const,
        serverId: 'server-1',
        machineId: 'machine-beta',
        canonicalRoot: '/workspace/beta',
        rootFingerprint: 'a'.repeat(64),
        operationId: 'relationship-transient',
      },
    };

    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.parse(request)).toEqual(request);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({
      ...request,
      owner: { kind: 'relationship', relationshipId: 'another-relationship' },
    }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapPrepareV1Schema.safeParse({
      ...request,
      owner: { kind: 'copy_once', operation: {
        v: 1,
        operationId: 'copy-op',
        controllerMachineId: 'machine-alpha',
        alphaWorkspaceRefId: 'workspace-alpha',
        betaWorkspaceRefId: 'workspace-beta',
        contentPolicy,
      } },
    }).success).toBe(false);
  });

  it('keeps target bootstrap release strict, bounded and idempotent-shaped', () => {
    const release = {
      v: 1 as const,
      bootstrapOperationId: 'bootstrap-op-1',
      targetWorkspaceRefId: 'workspace-beta',
      reason: 'abort' as const,
    };
    expect(WorkspaceSyncTargetBootstrapReleaseV1Schema.parse(release)).toEqual(release);
    expect(WorkspaceSyncTargetBootstrapReleaseV1Schema.parse({ ...release, reason: 'copy_committed' })).toMatchObject({ reason: 'copy_committed' });
    expect(WorkspaceSyncTargetBootstrapReleaseV1Schema.safeParse({ ...release, reason: 'committed' }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapReleaseV1Schema.safeParse({ ...release, rootPath: '/caller/root' }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse({ ok: true, released: false })).toEqual({ ok: true, released: false });
    expect(WorkspaceSyncTargetBootstrapReleaseResultV1Schema.safeParse({ ok: false, released: false }).success).toBe(false);
    expect(WorkspaceSyncTargetBootstrapReleaseResultV1Schema.safeParse({ ok: true, released: 'yes' }).success).toBe(false);
  });

  it('binds every approved destructive handoff-target consequence to one host-private proof', () => {
    const base = {
      v: 1 as const,
      serverId: 'server-1',
      machineId: 'machine-beta',
      canonicalRoot: '/workspace/beta',
      rootFingerprint: 'a'.repeat(64),
      operationId: 'handoff-action-1',
    };

    const replacement = HandoffTargetReplacementApprovalV1Schema.parse({
      ...base,
      consequences: ['replace_nonempty_workspace_target'],
    });
    const combined = HandoffTargetReplacementApprovalV1Schema.parse({
      ...base,
      consequences: ['replace_nonempty_workspace_target', 'delete_target_only_files_during_exact_mirror'],
    });
    const mirrorOnly = HandoffTargetReplacementApprovalV1Schema.parse({
      ...base,
      consequences: ['delete_target_only_files_during_exact_mirror'],
    });

    expect(sameHandoffTargetReplacementApproval(combined, combined)).toBe(true);
    expect(sameHandoffTargetReplacementApproval(combined, replacement)).toBe(false);
    expect(sameHandoffTargetReplacementApproval(replacement, mirrorOnly)).toBe(false);

    // An empty, duplicated or unordered consequence list cannot describe one
    // decision, so it is not representable.
    expect(HandoffTargetReplacementApprovalV1Schema.safeParse({ ...base, consequences: [] }).success).toBe(false);
    expect(HandoffTargetReplacementApprovalV1Schema.safeParse({
      ...base,
      consequences: ['replace_nonempty_workspace_target', 'replace_nonempty_workspace_target'],
    }).success).toBe(false);
    expect(HandoffTargetReplacementApprovalV1Schema.safeParse({
      ...base,
      consequences: ['delete_target_only_files_during_exact_mirror', 'replace_nonempty_workspace_target'],
    }).success).toBe(false);
    expect(HandoffTargetReplacementApprovalV1Schema.safeParse({
      ...base,
      consequence: 'replace_nonempty_workspace_target',
    }).success).toBe(false);
  });

  it('carries the exact-mirror activation fact into the target preflight request', () => {
    const request = {
      v: 1 as const,
      serverId: 'server-1',
      machineId: 'machine-beta',
      operationId: 'handoff-action-1',
      targetPath: '/workspace/beta',
      activatesExactMirror: true,
    };
    expect(HandoffTargetReplacementPreflightV1Schema.parse(request)).toEqual(request);
    expect(HandoffTargetReplacementPreflightV1Schema.safeParse({
      ...request,
      activatesExactMirror: 'yes',
    }).success).toBe(false);
  });

  it('fails closed on the retired workspaceTransfer request field', () => {
    expect(SessionHandoffStartRequestSchema.safeParse({
      sessionId: 'session-1',
      sourceMachineId: 'machine-a',
      targetMachineId: 'machine-b',
      sessionStorageMode: 'persisted',
      preferredTransportStrategies: ['direct_peer'],
      workspaceTransfer: { enabled: true },
    }).success).toBe(false);
    expect(SessionHandoffPrepareTargetResultGetResponseSchema.safeParse({
      ok: false,
      errorCode: 'workspace_sync_update_required',
      error: 'client must update before using workspace sync',
    }).success).toBe(true);
  });
});
