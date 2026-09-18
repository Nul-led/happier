import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { HandoffTargetReplacementApprovalV1Schema } from './handoffTargetReplacementApprovalV1.js';

const MAX_RELATIONSHIP_ID_LENGTH = 256;
const MAX_MACHINE_ID_LENGTH = 256;
const MAX_WORKSPACE_REF_ID_LENGTH = 256;
const MAX_PATH_LENGTH = 4096;
export const WORKSPACE_SYNC_MAX_PATTERN_BYTES = 1024;
export const WORKSPACE_SYNC_MAX_PATTERNS = 128;
const MAX_ERROR_CODE_LENGTH = 256;
const MAX_CONFLICTS = 1_000;
export const WORKSPACE_SYNC_CONFLICT_PAGE_MAX_ITEMS = 100;
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
  extraIgnorePatterns: z.array(z.string().trim().min(1).max(WORKSPACE_SYNC_MAX_PATTERN_BYTES)
    .refine((value) => utf8ToBytes(value).byteLength <= WORKSPACE_SYNC_MAX_PATTERN_BYTES, 'pattern exceeds UTF-8 byte limit')).max(WORKSPACE_SYNC_MAX_PATTERNS).readonly(),
  extraIncludePatterns: z.array(z.string().trim().min(1).max(WORKSPACE_SYNC_MAX_PATTERN_BYTES)
    .refine((value) => utf8ToBytes(value).byteLength <= WORKSPACE_SYNC_MAX_PATTERN_BYTES, 'pattern exceeds UTF-8 byte limit')
    .refine((value) => !value.startsWith('!'), 'include patterns must be positive')).max(WORKSPACE_SYNC_MAX_PATTERNS).readonly(),
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

const WorkspaceSyncConflictEndpointEntryKindV1Schema = z.enum([
  ...WorkspaceSyncEndpointEntryKindV1Schema.options,
  'unsupported',
]);
const WorkspaceSyncUnsupportedEntrySourceKindV1Schema = z.enum(['untracked', 'problematic', 'unknown']);

// Mutagen synchronization v1 hashes file content with SHA-1 and exposes the
// raw 20-byte digest as lowercase hexadecimal at the broker boundary.
const WorkspaceSyncFileDigestV1Schema = z.string().regex(/^[a-f0-9]{40}$/u);

/**
 * An engine-relative path is identity-bearing data, not display/user input.
 * Preserve its bytes exactly. Forward slash is the cross-platform engine
 * separator; the target filesystem owner applies any additional native rules
 * (notably Windows backslash separators and volume/ADS rejection).
 */
const WorkspaceSyncRelativePathV1Schema = z.string().min(1).max(MAX_PATH_LENGTH).superRefine((value, context) => {
  const components = value.split('/');
  if (
    value.includes('\0')
    || value.startsWith('/')
    || components.some((component) => component === '' || component === '.' || component === '..')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'workspace sync path must identify a safe root-relative descendant',
    });
  }
});

const WorkspaceSyncConflictEndpointV1Schema = z.object({
  kind: WorkspaceSyncConflictEndpointEntryKindV1Schema,
  digest: WorkspaceSyncFileDigestV1Schema.optional(),
  size: z.number().int().nonnegative().optional(),
  sourceKind: WorkspaceSyncUnsupportedEntrySourceKindV1Schema.optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'unsupported' && value.sourceKind === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceKind'],
      message: 'unsupported conflict entries require their bounded engine source kind',
    });
  } else if (value.kind !== 'unsupported' && value.sourceKind !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceKind'],
      message: 'supported conflict entries cannot carry an unsupported source kind',
    });
  }
  if (value.kind === 'unsupported' && (value.digest !== undefined || value.size !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'unsupported conflict entries cannot claim file metadata',
    });
  }
});

export const WorkspaceSyncConflictV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  path: WorkspaceSyncRelativePathV1Schema,
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

export const WorkspaceSyncConflictPageRequestV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  cursor: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH).optional(),
  limit: z.number().int().positive().max(WORKSPACE_SYNC_CONFLICT_PAGE_MAX_ITEMS),
}).strict();
export type WorkspaceSyncConflictPageRequestV1 = z.infer<typeof WorkspaceSyncConflictPageRequestV1Schema>;

const WorkspaceSyncConflictPageDataV1Schema = z.object({
  status: z.literal('page'),
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  totalCount: z.number().int().nonnegative(),
  nextCursor: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH).nullable(),
  conflicts: z.array(WorkspaceSyncConflictV1Schema).max(WORKSPACE_SYNC_CONFLICT_PAGE_MAX_ITEMS).readonly(),
}).strict().superRefine((value, context) => {
  if (value.totalCount < value.conflicts.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['totalCount'],
      message: 'totalCount must be at least conflicts.length',
    });
  }
  for (const [index, conflict] of value.conflicts.entries()) {
    if (conflict.relationshipId !== value.relationshipId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conflicts', index, 'relationshipId'],
        message: 'conflict relationshipId must match the page relationshipId',
      });
    }
  }
});

export const WorkspaceSyncConflictPageV1Schema = z.discriminatedUnion('status', [
  WorkspaceSyncConflictPageDataV1Schema,
  z.object({
    status: z.literal('cursor_invalidated'),
    relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  }).strict(),
]);
export type WorkspaceSyncConflictPageV1 = z.infer<typeof WorkspaceSyncConflictPageV1Schema>;

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
  path: WorkspaceSyncRelativePathV1Schema,
  keep: z.enum(['alpha', 'beta']),
  expectedDigest: WorkspaceSyncFileDigestV1Schema.optional(),
  expectedKind: WorkspaceSyncEndpointEntryKindV1Schema,
}).strict().superRefine(validateConflictDeletePrecondition);
export type DeleteWorkspaceSyncConflictLoserV1 = z.infer<typeof DeleteWorkspaceSyncConflictLoserV1Schema>;

/**
 * Action-owned destructive intent. Binding the controller machine into the
 * approved subject prevents an otherwise valid receipt from being replayed
 * against a different controller placement.
 */
export const WorkspaceSyncConflictResolveActionInputV1Schema = z.object({
  controllerMachineId: z.string().trim().min(1).max(MAX_MACHINE_ID_LENGTH),
  request: DeleteWorkspaceSyncConflictLoserV1Schema,
}).strict();
export type WorkspaceSyncConflictResolveActionInputV1 = z.infer<typeof WorkspaceSyncConflictResolveActionInputV1Schema>;

/**
 * Private controller-daemon carrier for an already approved conflict Action.
 * The receipt and its exact Action subject travel together so the daemon can
 * revalidate the persisted approval before performing the destructive write.
 */
export const WorkspaceSyncConflictResolveRpcInputV1Schema = z.object({
  actionReceiptId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  actionInput: WorkspaceSyncConflictResolveActionInputV1Schema,
}).strict();
export type WorkspaceSyncConflictResolveRpcInputV1 = z.infer<typeof WorkspaceSyncConflictResolveRpcInputV1Schema>;

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
  actionReceiptId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  actionInput: WorkspaceSyncConflictResolveActionInputV1Schema,
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  workspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  path: WorkspaceSyncRelativePathV1Schema,
  expectedDigest: WorkspaceSyncFileDigestV1Schema.optional(),
  expectedKind: WorkspaceSyncEndpointEntryKindV1Schema,
}).strict().superRefine(validateConflictDeletePrecondition);
export type WorkspaceSyncTargetConflictDeleteV1 = z.infer<typeof WorkspaceSyncTargetConflictDeleteV1Schema>;

export const ReadWorkspaceSyncFileV1Schema = z.object({
  relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  side: z.enum(['alpha', 'beta']),
  path: WorkspaceSyncRelativePathV1Schema,
  expectedDigest: WorkspaceSyncFileDigestV1Schema.optional(),
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

export const HandoffTargetReplacementPreflightV1Schema = z.object({
  v: z.literal(1),
  serverId: z.string().trim().min(1).max(MAX_MACHINE_ID_LENGTH),
  machineId: z.string().trim().min(1).max(MAX_MACHINE_ID_LENGTH),
  operationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  targetPath: z.string().trim().min(1).max(MAX_PATH_LENGTH),
  /**
   * Whether this handoff activates exact mirroring, which authorizes deleting
   * target-only files later even when the destination is missing or empty now.
   */
  activatesExactMirror: z.boolean().optional(),
}).strict();
export type HandoffTargetReplacementPreflightV1 = z.infer<typeof HandoffTargetReplacementPreflightV1Schema>;

export const HandoffTargetReplacementPreflightResultV1Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('not_required') }).strict(),
  z.object({
    type: z.literal('approval_required'),
    approval: HandoffTargetReplacementApprovalV1Schema,
  }).strict(),
]);
export type HandoffTargetReplacementPreflightResultV1 = z.infer<typeof HandoffTargetReplacementPreflightResultV1Schema>;

/**
 * Target-daemon bootstrap prepare request. The receiving daemon resolves the
 * target root and bootstrap source root from its current Account settings; a
 * caller-supplied path, credential or grant is deliberately not representable.
 */
export const WorkspaceSyncTargetBootstrapPrepareV1Schema = z.object({
  v: z.literal(1),
  bootstrapOperationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  owner: WorkspaceSyncTargetBootstrapOwnerV1Schema,
  /**
   * Operation-scoped definition used only while a newly-created relationship
   * is being proven before its durable Account-settings commit.
   */
  transientRelationship: WorkspaceSyncRelationshipV1Schema.optional(),
  targetWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  endpointRole: z.enum(['alpha', 'beta']),
  policyDigest: WorkspaceSyncHexDigestV1Schema,
  createIfMissing: z.boolean(),
  /** Explicit only for a new copy/relationship target; existing relationships rehydrate READY custody. */
  targetBootstrap: z.enum(['use_existing', 'materialize_from_source_workspace']).optional(),
  /**
   * Host-private proof for the destructive consequences of this destination.
   * The target daemon derives the operation it must be stamped for from the
   * bootstrap owner it resolves locally, so no accompanying caller-supplied
   * operation field is carried here: a caller could align that field with a
   * stolen proof, which would make the binding prove nothing.
   */
  targetReplacementApproval: HandoffTargetReplacementApprovalV1Schema.optional(),
  /** Durable Protocol Action artifact authorizing the exact proof and input below. */
  targetReplacementApprovalReceiptId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH).optional(),
  /** Exact canonical `session.handoff` input stored in the approving artifact. */
  targetReplacementApprovalActionInput: z.unknown().optional(),
}).strict().superRefine((value, context) => {
  const transient = value.transientRelationship;
  const createsTarget = (value.owner.kind === 'copy_once' && value.createIfMissing) || transient !== undefined;
  if (createsTarget !== (value.targetBootstrap !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetBootstrap'],
      message: createsTarget
        ? 'new workspace sync targets require an explicit bootstrap choice'
        : 'existing relationships cannot replace their established bootstrap choice',
    });
  }
  if (value.targetBootstrap !== 'materialize_from_source_workspace'
    && value.targetReplacementApproval !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetReplacementApproval'],
      message: 'destructive target-reuse approval is valid only for source materialization',
    });
  }
  const replacementAuthorityParts = [
    value.targetReplacementApproval,
    value.targetReplacementApprovalReceiptId,
    value.targetReplacementApprovalActionInput,
  ];
  if (replacementAuthorityParts.some((part) => part !== undefined)
    && replacementAuthorityParts.some((part) => part === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetReplacementApprovalReceiptId'],
      message: 'target replacement approval requires its Action receipt and exact approved input',
    });
  }
  if (!transient) return;
  if (value.owner.kind !== 'relationship') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transientRelationship'],
      message: 'transient relationship authority requires a relationship owner',
    });
    return;
  }
  const expectedTargetRefId = value.endpointRole === 'alpha'
    ? transient.alphaWorkspaceRefId
    : transient.betaWorkspaceRefId;
  if (
    transient.relationshipId !== value.owner.relationshipId
    || transient.relationshipId !== value.bootstrapOperationId
    || transient.enabled !== true
    || value.targetWorkspaceRefId !== expectedTargetRefId
    || value.policyDigest !== transient.contentPolicy.policyDigest
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transientRelationship'],
      message: 'transient relationship does not match the exact bootstrap authority',
    });
  }
});
export type WorkspaceSyncTargetBootstrapPrepareV1 = z.infer<typeof WorkspaceSyncTargetBootstrapPrepareV1Schema>;

/** Strict, root-free prepare result: authority fingerprints, never a local handle. */
export const WorkspaceSyncTargetBootstrapPrepareResultV1Schema = z.object({
  v: z.literal(1),
  bootstrapOperationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  targetWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  state: z.literal('ready'),
  created: z.boolean(),
  rootFingerprint: WorkspaceSyncHexDigestV1Schema,
  policyDigest: WorkspaceSyncHexDigestV1Schema,
}).strict();
export type WorkspaceSyncTargetBootstrapPrepareResultV1 = z.infer<typeof WorkspaceSyncTargetBootstrapPrepareResultV1Schema>;

export const WorkspaceSyncTargetBootstrapReleaseV1Schema = z.object({
  v: z.literal(1),
  bootstrapOperationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
  targetWorkspaceRefId: z.string().trim().min(1).max(MAX_WORKSPACE_REF_ID_LENGTH),
  reason: z.enum(['abort', 'copy_committed', 'relationship_committed']),
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
  path: WorkspaceSyncRelativePathV1Schema,
  expectedDigest: WorkspaceSyncFileDigestV1Schema.optional(),
  maxBytes: z.number().int().positive().max(WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES)
    .default(WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES),
}).strict();
export type WorkspaceSyncTargetFileReadV1 = z.infer<typeof WorkspaceSyncTargetFileReadV1Schema>;

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

const WorkspaceSyncReadyComponentV1Schema = z.object({ state: z.literal('ready') }).strict();
const WorkspaceSyncUnavailableComponentV1Schema = z.object({
  state: z.literal('unavailable'),
  errorCode: z.string().trim().min(1).max(MAX_ERROR_CODE_LENGTH),
}).strict();

export const WorkspaceSyncRuntimeReadinessV1Schema = z.object({
  engine: z.discriminatedUnion('state', [
    z.object({ state: z.literal('starting') }).strict(),
    WorkspaceSyncReadyComponentV1Schema,
    WorkspaceSyncUnavailableComponentV1Schema,
  ]),
  carrier: z.discriminatedUnion('state', [
    WorkspaceSyncReadyComponentV1Schema,
    z.object({
      state: z.literal('unavailable'),
      errorCode: z.literal('machine_carrier_unavailable'),
    }).strict(),
  ]),
}).strict();
export type WorkspaceSyncRuntimeReadinessV1 = z.infer<typeof WorkspaceSyncRuntimeReadinessV1Schema>;

/**
 * One bounded readiness/status publication carried by the existing Machine
 * daemon-state channel. Readiness is always present so a client never infers
 * engine or carrier availability from paths or machine metadata; relationship
 * status is present only when the daemon has one to project. The enclosing
 * daemon-state version provides ordering and this event carries no independent
 * cursor or persisted history.
 */
export const WorkspaceSyncRuntimeEventV1Schema = z.object({
  v: z.literal(1),
  readiness: WorkspaceSyncRuntimeReadinessV1Schema,
  status: WorkspaceSyncStatusV1Schema.optional(),
}).strict();
export type WorkspaceSyncRuntimeEventV1 = z.infer<typeof WorkspaceSyncRuntimeEventV1Schema>;

/**
 * Post-commit cleanup debt. The operation succeeded and its durable state is
 * published; only a best-effort release failed, so this is reported rather than
 * turned into a failure.
 */
export const WorkspaceSyncCleanupWarningV1Schema = z.object({
  code: z.string().trim().min(1).max(MAX_ERROR_CODE_LENGTH),
  message: z.string().trim().min(1).max(2048),
}).strict();
export type WorkspaceSyncCleanupWarningV1 = z.infer<typeof WorkspaceSyncCleanupWarningV1Schema>;

export const WorkspaceSyncLegacyStateInspectionV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('absent') }).strict(),
  z.object({
    status: z.literal('legacy_workspace_sync_state_unsupported'),
    classification: z.literal('retired_v1'),
    quarantinePath: z.string().trim().min(1).max(MAX_PATH_LENGTH),
    schemaVersion: z.literal(1),
  }).strict(),
  z.object({
    status: z.literal('legacy_workspace_sync_state_unknown'),
    path: z.string().trim().min(1).max(MAX_PATH_LENGTH),
    reason: z.string().trim().min(1).max(MAX_ERROR_CODE_LENGTH),
  }).strict(),
]);
export type WorkspaceSyncLegacyStateInspectionV1 = z.infer<typeof WorkspaceSyncLegacyStateInspectionV1Schema>;

/**
 * The daemon's terminal, committed workspace result for one handoff. It is the
 * only representation of the workspace outcome that crosses back to the UI:
 * whether a copy was materialized, whether a persistent relationship was newly
 * created or an exact existing definition was reused, the engine status the
 * daemon observed at commit, and any post-commit cleanup debt. The UI renders
 * this Action result directly and keeps no second workspace-outcome store.
 */
export const HandoffWorkspaceOutcomeV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({
    kind: z.literal('copied'),
    operationId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
    status: WorkspaceSyncStatusV1Schema.optional(),
    cleanupWarning: WorkspaceSyncCleanupWarningV1Schema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('relationship'),
    relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
    /** `true` when this handoff persisted a new relationship; `false` when an exact existing definition was reused. */
    created: z.boolean(),
    status: WorkspaceSyncStatusV1Schema.optional(),
    cleanupWarning: WorkspaceSyncCleanupWarningV1Schema.optional(),
  }).strict(),
]);
export type HandoffWorkspaceOutcomeV1 = z.infer<typeof HandoffWorkspaceOutcomeV1Schema>;

export const HandoffWorkspaceActionV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({
    kind: z.literal('copy_once'),
    contentPolicy: WorkspaceContentPolicyV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('create_relationship'),
    mode: WorkspaceSyncPersistentModeV1Schema,
    contentPolicy: WorkspaceContentPolicyV1Schema,
    flushBeforeCommit: z.literal(true),
  }).strict(),
  z.object({
    kind: z.literal('relationship'),
    relationshipId: z.string().trim().min(1).max(MAX_RELATIONSHIP_ID_LENGTH),
    flushBeforeCommit: z.boolean(),
  }).strict(),
]);
export type HandoffWorkspaceActionV1 = z.infer<typeof HandoffWorkspaceActionV1Schema>;
