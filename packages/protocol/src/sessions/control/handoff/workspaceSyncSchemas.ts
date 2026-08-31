import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

const MAX_RELATIONSHIP_ID_LENGTH = 256;
const MAX_MACHINE_ID_LENGTH = 256;
const MAX_WORKSPACE_REF_ID_LENGTH = 256;
const MAX_PATH_LENGTH = 4096;
export const WORKSPACE_SYNC_MAX_PATTERN_LENGTH = 1024;
export const WORKSPACE_SYNC_MAX_PATTERNS = 128;
const MAX_DIGEST_LENGTH = 256;
const MAX_ERROR_CODE_LENGTH = 256;
const MAX_CONFLICTS = 1_000;
export const WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES = 1024 * 1024;

export const WorkspaceSyncModeV1Schema = z.enum([
  'copy_once',
  'keep_synced',
  'mirror_exactly',
  'keep_both_in_sync',
]);
export type WorkspaceSyncModeV1 = z.infer<typeof WorkspaceSyncModeV1Schema>;

export const WorkspaceSyncPersistentModeV1Schema = z.enum([
  'keep_synced',
  'mirror_exactly',
  'keep_both_in_sync',
]);
export type WorkspaceSyncPersistentModeV1 = z.infer<typeof WorkspaceSyncPersistentModeV1Schema>;

const WorkspaceContentPolicyV1FieldsSchema = z.object({
  v: z.literal(1),
  selection: z.enum(['git_worktree', 'all_files']),
  extraIgnorePatterns: z.array(z.string().trim().min(1).max(WORKSPACE_SYNC_MAX_PATTERN_LENGTH)).max(WORKSPACE_SYNC_MAX_PATTERNS).readonly(),
  extraIncludePatterns: z.array(z.string().trim().min(1).max(WORKSPACE_SYNC_MAX_PATTERN_LENGTH)).max(WORKSPACE_SYNC_MAX_PATTERNS).readonly(),
  includeGitDirectory: z.boolean(),
  policyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export const WorkspaceContentPolicyV1Schema = WorkspaceContentPolicyV1FieldsSchema.superRefine((value, context) => {
  if (value.policyDigest !== computeWorkspaceSyncPolicyDigest(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['policyDigest'], message: 'policyDigest does not match content policy' });
  }
});
export type WorkspaceContentPolicyV1 = z.infer<typeof WorkspaceContentPolicyV1Schema>;

/**
 * Computes the stable policy fingerprint shared by UI, daemon and sidecar
 * boundaries.  Keep the canonical field order here so callers never invent a
 * second digest representation.
 */
export function computeWorkspaceSyncPolicyDigest(
  policy: Omit<WorkspaceContentPolicyV1, 'policyDigest'>,
): string {
  const canonical = JSON.stringify({
    v: 1,
    selection: policy.selection,
    // Git ignore rules are ordered: a later negation can re-include a path.
    // Preserve that order so semantically different policies never share an
    // authorization/endpoint fingerprint.
    extraIgnorePatterns: [...policy.extraIgnorePatterns],
    extraIncludePatterns: [...policy.extraIncludePatterns],
    includeGitDirectory: policy.includeGitDirectory,
  });
  return bytesToHex(sha256(utf8ToBytes(canonical)));
}

export const WorkspaceSyncRelationshipV1Schema = z
  .object({
    v: z.literal(1),
    relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
    controllerMachineId: z.string().trim().min(1).max(MAX_MACHINE_ID_LENGTH),
    alphaWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
    betaWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
    mode: WorkspaceSyncPersistentModeV1Schema,
    contentPolicy: WorkspaceContentPolicyV1Schema,
    enabled: z.boolean(),
    createdAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    updatedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.alphaWorkspaceRefId === value.betaWorkspaceRefId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['betaWorkspaceRefId'],
        message: 'alphaWorkspaceRefId and betaWorkspaceRefId must be distinct',
      });
    }
  });
export type WorkspaceSyncRelationshipV1 = z.infer<typeof WorkspaceSyncRelationshipV1Schema>;

type WorkspaceSyncRelationshipDefinitionV1 = Pick<
  WorkspaceSyncRelationshipV1,
  | 'controllerMachineId'
  | 'alphaWorkspaceRefId'
  | 'betaWorkspaceRefId'
  | 'mode'
  | 'contentPolicy'
>;

/**
 * Compares the immutable runtime definition selected by a relationship ID.
 * Settings lifecycle metadata (`enabled` and timestamps) is deliberately not
 * part of Mutagen session identity; content policy identity is its canonical
 * digest rather than another serialization of the policy document.
 */
export function areWorkspaceSyncRelationshipDefinitionsEqual(
  left: WorkspaceSyncRelationshipDefinitionV1,
  right: WorkspaceSyncRelationshipDefinitionV1,
): boolean {
  return left.controllerMachineId === right.controllerMachineId
    && left.alphaWorkspaceRefId === right.alphaWorkspaceRefId
    && left.betaWorkspaceRefId === right.betaWorkspaceRefId
    && left.mode === right.mode
    && left.contentPolicy.policyDigest === right.contentPolicy.policyDigest;
}

export const WorkspaceSyncCopyOnceV1Schema = z.object({
  v: z.literal(1),
  operationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  controllerMachineId: z.string().trim().min(1).max(MAX_MACHINE_ID_LENGTH),
  alphaWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  betaWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  contentPolicy: WorkspaceContentPolicyV1Schema,
}).strict().superRefine((value, context) => {
  if (value.alphaWorkspaceRefId === value.betaWorkspaceRefId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['betaWorkspaceRefId'],
      message: 'alphaWorkspaceRefId and betaWorkspaceRefId must be distinct',
    });
  }
});
export type WorkspaceSyncCopyOnceV1 = z.infer<typeof WorkspaceSyncCopyOnceV1Schema>;

export const WorkspaceSyncEndpointEntryKindV1Schema = z.enum(['missing', 'file', 'directory', 'symlink']);
export type WorkspaceSyncEndpointEntryKindV1 = z.infer<typeof WorkspaceSyncEndpointEntryKindV1Schema>;

const WorkspaceSyncConflictEndpointV1Schema = z.object({
  kind: WorkspaceSyncEndpointEntryKindV1Schema,
  digest: z.string().trim().min(1).max(MAX_DIGEST_LENGTH).optional(),
  size: z.number().int().nonnegative().optional(),
}).strict();

export const WorkspaceSyncConflictV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  path: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  alpha: WorkspaceSyncConflictEndpointV1Schema,
  beta: WorkspaceSyncConflictEndpointV1Schema,
}).strict();
export type WorkspaceSyncConflictV1 = z.infer<typeof WorkspaceSyncConflictV1Schema>;

export const WorkspaceSyncConflictListV1Schema = z
  .object({
    relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
    totalCount: z.number().int().nonnegative(),
    shownCount: z.number().int().nonnegative(),
    truncatedCount: z.number().int().nonnegative(),
    conflicts: z.array(WorkspaceSyncConflictV1Schema).max(MAX_CONFLICTS).readonly(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.shownCount !== value.conflicts.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shownCount'],
        message: 'shownCount must equal conflicts.length',
      });
    }
    if (value.totalCount < value.shownCount || value.truncatedCount !== value.totalCount - value.shownCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['truncatedCount'],
        message: 'truncatedCount must equal totalCount minus shownCount',
      });
    }
    for (const [index, conflict] of value.conflicts.entries()) {
      if (conflict.relationshipId !== value.relationshipId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['conflicts', index, 'relationshipId'],
          message: 'conflict relationshipId must match the list relationshipId',
        });
      }
    }
  });
export type WorkspaceSyncConflictListV1 = z.infer<typeof WorkspaceSyncConflictListV1Schema>;

function validateConflictDeletePrecondition(
  value: Readonly<{ expectedKind: z.infer<typeof WorkspaceSyncEndpointEntryKindV1Schema>; expectedDigest?: string }>,
  context: z.RefinementCtx,
): void {
  if (value.expectedKind === 'file' && value.expectedDigest === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expectedDigest'],
      message: 'file conflict deletion requires an expected digest',
    });
  } else if (value.expectedKind !== 'file' && value.expectedDigest !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expectedDigest'],
      message: 'non-file conflict deletion uses only the expected type precondition',
    });
  }
}

export const DeleteWorkspaceSyncConflictLoserV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  path: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  keep: z.enum(['alpha', 'beta']),
  expectedDigest: z.string().trim().min(1).max(MAX_DIGEST_LENGTH).optional(),
  expectedKind: WorkspaceSyncEndpointEntryKindV1Schema,
}).strict().superRefine(validateConflictDeletePrecondition);
export type DeleteWorkspaceSyncConflictLoserV1 = z.infer<typeof DeleteWorkspaceSyncConflictLoserV1Schema>;

export const WorkspaceSyncRelationshipIdV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
}).strict();
export type WorkspaceSyncRelationshipIdV1 = z.infer<typeof WorkspaceSyncRelationshipIdV1Schema>;

/**
 * Target-daemon mutation request. The receiving daemon resolves
 * `workspaceRefId` from its current Account settings; a caller-controlled root
 * is deliberately not part of this authority boundary.
 */
export const WorkspaceSyncTargetConflictDeleteV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  workspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  path: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  expectedDigest: z.string().trim().min(1).max(MAX_DIGEST_LENGTH).optional(),
  expectedKind: WorkspaceSyncEndpointEntryKindV1Schema,
}).strict().superRefine(validateConflictDeletePrecondition);
export type WorkspaceSyncTargetConflictDeleteV1 = z.infer<typeof WorkspaceSyncTargetConflictDeleteV1Schema>;

export const ReadWorkspaceSyncFileV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  side: z.enum(['alpha', 'beta']),
  path: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  expectedDigest: z.string().trim().min(1).max(MAX_DIGEST_LENGTH).optional(),
  maxBytes: z.number().int().positive().max(WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES)
    .default(WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES),
}).strict();
export type ReadWorkspaceSyncFileV1 = z.infer<typeof ReadWorkspaceSyncFileV1Schema>;

/**
 * Target-daemon preview request. The selected side is resolved by the
 * controller before forwarding, and the receiving daemon resolves this
 * workspace reference from its current Account settings. A caller-controlled
 * filesystem root is deliberately absent.
 */
const WorkspaceSyncHexDigestV1Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const WorkspaceSyncTargetBootstrapOwnerV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('relationship'),
    relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  }).strict(),
  z.object({
    kind: z.literal('copy_once'),
    operation: WorkspaceSyncCopyOnceV1Schema,
  }).strict(),
]);
export type WorkspaceSyncTargetBootstrapOwnerV1 = z.infer<typeof WorkspaceSyncTargetBootstrapOwnerV1Schema>;

/**
 * Target-daemon bootstrap prepare request. The receiving daemon resolves the
 * target root and bootstrap source root from its current Account settings; a
 * caller-supplied path, credential or grant is deliberately not representable.
 */
export const WorkspaceSyncTargetBootstrapPrepareV1Schema = z.object({
  v: z.literal(1),
  bootstrapOperationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  owner: WorkspaceSyncTargetBootstrapOwnerV1Schema,
  targetWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  endpointRole: z.enum(['alpha', 'beta']),
  policyDigest: WorkspaceSyncHexDigestV1Schema,
  createIfMissing: z.boolean(),
}).strict();
export type WorkspaceSyncTargetBootstrapPrepareV1 = z.infer<typeof WorkspaceSyncTargetBootstrapPrepareV1Schema>;

/** Strict, root-free prepare result: digests only, never a local handle. */
export const WorkspaceSyncTargetBootstrapPrepareResultV1Schema = z.object({
  v: z.literal(1),
  bootstrapOperationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  targetWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  state: z.literal('ready'),
  created: z.boolean(),
  rootFingerprint: WorkspaceSyncHexDigestV1Schema,
  policyDigest: WorkspaceSyncHexDigestV1Schema,
  manifestDigest: WorkspaceSyncHexDigestV1Schema,
}).strict();
export type WorkspaceSyncTargetBootstrapPrepareResultV1 = z.infer<typeof WorkspaceSyncTargetBootstrapPrepareResultV1Schema>;

export const WorkspaceSyncTargetBootstrapReleaseV1Schema = z.object({
  v: z.literal(1),
  bootstrapOperationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  targetWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  reason: z.enum(['abort', 'copy_committed']),
}).strict();
export type WorkspaceSyncTargetBootstrapReleaseV1 = z.infer<typeof WorkspaceSyncTargetBootstrapReleaseV1Schema>;

export const WorkspaceSyncTargetBootstrapReleaseResultV1Schema = z.object({
  ok: z.literal(true),
  released: z.boolean(),
}).strict();
export type WorkspaceSyncTargetBootstrapReleaseResultV1 = z.infer<typeof WorkspaceSyncTargetBootstrapReleaseResultV1Schema>;

export const WorkspaceSyncTargetFileReadV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  workspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  path: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  expectedDigest: z.string().trim().min(1).max(MAX_DIGEST_LENGTH).optional(),
  maxBytes: z.number().int().positive().max(WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES)
    .default(WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES),
}).strict();
export type WorkspaceSyncTargetFileReadV1 = z.infer<typeof WorkspaceSyncTargetFileReadV1Schema>;

const WorkspaceSyncFileDigestV1Schema = z.string().trim().min(1).max(MAX_DIGEST_LENGTH);
const WorkspaceSyncFileSizeV1Schema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const ReadWorkspaceSyncFileResultV1Schema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('text'),
    text: z.string().max(WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES),
    digest: WorkspaceSyncFileDigestV1Schema,
    size: WorkspaceSyncFileSizeV1Schema,
  }).strict(),
  z.object({
    status: z.literal('binary'),
    digest: WorkspaceSyncFileDigestV1Schema,
    size: WorkspaceSyncFileSizeV1Schema,
  }).strict(),
  z.object({
    status: z.literal('too_large'),
    digest: WorkspaceSyncFileDigestV1Schema.optional(),
    size: WorkspaceSyncFileSizeV1Schema,
  }).strict(),
  z.object({ status: z.literal('missing') }).strict(),
  z.object({
    status: z.literal('changed'),
    actualDigest: WorkspaceSyncFileDigestV1Schema.optional(),
  }).strict(),
]);
export type ReadWorkspaceSyncFileResultV1 = z.infer<typeof ReadWorkspaceSyncFileResultV1Schema>;

export const WorkspaceSyncStatusV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  controllerMachineId: z.string().trim().min(1).max(MAX_MACHINE_ID_LENGTH),
  state: z.enum([
    'starting',
    'watching',
    'flushing',
    'paused',
    'disconnected',
    'conflicted',
    'controller_unavailable',
    'error',
    'stopped',
  ]),
  alphaPath: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  betaPath: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  mode: WorkspaceSyncModeV1Schema,
  changedFiles: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  lastSuccessfulSyncAtMs: z.number().finite().nonnegative().nullable(),
  errorCode: z.string().trim().min(1).max(MAX_ERROR_CODE_LENGTH).optional(),
}).strict();
export type WorkspaceSyncStatusV1 = z.infer<typeof WorkspaceSyncStatusV1Schema>;

export const HandoffWorkspaceActionV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({
    kind: z.literal('copy_once'),
    contentPolicy: WorkspaceContentPolicyV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('relationship'),
    relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
    flushBeforeCommit: z.boolean(),
  }).strict(),
]);
export type HandoffWorkspaceActionV1 = z.infer<typeof HandoffWorkspaceActionV1Schema>;
