import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve } from 'node:path';

import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import { getPathRemainderWithinBase } from '@/session/handoff/paths/sessionHandoffPathNormalization';
import { inspectWorkspaceLocationWithScmWorkspace } from '@/scm/workspace/workspaceLocationInspection';
import { realizeWorkspaceCheckoutWithScmWorkspace } from '@/scm/workspace/workspaceCheckoutOperations';
import type { ScmWorkspaceIntegrationWorkspaceCheckoutRealizationResult } from '@/scm/workspace/workspaceCheckoutRealization';
import { normalizeSessionHandoffWorkspaceRootPath, type HandoffTargetReplacementApprovalV1 } from '@happier-dev/protocol';
import type { WorkspaceRootOwnershipHandle, WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import {
  beginWorkspaceTargetMaterialization,
  recoverInterruptedWorkspaceTargetMaterialization,
  rehydrateWorkspaceTargetMaterializationFromReceiptPath,
  type WorkspaceExportMaterializationCustody,
} from '@/scm/workspace/workspaceExportMaterialization';
import {
  computeWorkspaceSyncAbsentRootFingerprint,
  computeWorkspaceSyncRootFingerprint,
} from './workspaceSyncRootIdentity';

export type WorkspaceSyncTargetBootstrapInput = Readonly<{
  rootPath: string;
  /** Present only when the source root is on this daemon and path-comparable. */
  sourceRootPath?: string;
  relationshipId: string;
  endpointRole: 'alpha' | 'beta';
  policyDigest: string;
  contentSelection: 'git_worktree' | 'all_files';
  /** Host-private Action approval, reinspected at this target under root custody. */
  targetReplacementApproval?: HandoffTargetReplacementApprovalV1;
  /**
   * Whether this bootstrap activates exact mirroring, which authorizes deleting
   * target-only files even when the destination is missing or empty today.
   */
  activatesExactMirror?: boolean;
  stagingDirectory: string;
  rootOwnershipManager: WorkspaceRootOwnershipManager;
  createIfMissing?: boolean;
  /** Explicit user intent for this target; never inferred from target contents. */
  targetBootstrap: 'use_existing' | 'materialize_from_source_workspace';
  /** SCM-owned Git verification/materialization. Credentials stay inside this callback. */
  prepareGitTarget?: (input: Readonly<{
    canonicalRoot: string;
    sourceRootPath?: string;
    relationshipId: string;
    endpointRole: 'alpha' | 'beta';
    policyDigest: string;
    targetState: 'missing' | 'empty' | 'nonempty';
    targetBootstrap: 'use_existing' | 'materialize_from_source_workspace';
    materializationReceiptPath: string;
  }>) => Promise<WorkspaceExportMaterializationCustody | void>;
  materializeSeed?: (input: Readonly<{
    canonicalRoot: string;
    relationshipId: string;
    endpointRole: 'alpha' | 'beta';
    policyDigest: string;
    materializationReceiptPath: string;
    originalTargetExists: boolean;
  }>) => Promise<WorkspaceExportMaterializationCustody | void>;
}>;

export type WorkspaceSyncTargetBootstrapResult = Readonly<{
  canonicalRoot: string;
  created: boolean;
  state: 'READY';
  rootFingerprint: string;
  policyDigest: string;
  markerPath: string;
  ownershipHandles: readonly WorkspaceRootOwnershipHandle[];
  materializationCustody?: WorkspaceExportMaterializationCustody;
  release(): Promise<void>;
}>;

type WorkspaceSyncTargetBootstrapMarker = Readonly<{
  v: 1;
  state: 'READY';
  relationshipId: string;
  endpointRole: 'alpha' | 'beta';
  canonicalRoot: string;
  rootFingerprint: string;
  policyDigest: string;
  contentSelection: 'git_worktree' | 'all_files';
  engineVersion: typeof WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION;
}>;

const WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION = 'happier-mutagen-external-v1' as const;

function bootstrapPaths(stagingDirectory: string, relationshipId: string, endpointRole: 'alpha' | 'beta') {
  const operationKey = createHash('sha256')
    .update('workspace-sync-bootstrap-v1\0')
    .update(relationshipId)
    .update('\0')
    .update(endpointRole)
    .digest('hex');
  const operationDirectory = join(resolve(stagingDirectory), operationKey);
  return {
    operationDirectory,
    markerPath: join(operationDirectory, 'ready.json'),
    materializationReceiptPath: join(operationDirectory, 'materialization.json'),
  };
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'));
}

async function readBootstrapJson(path: string): Promise<unknown | null> {
  const raw = await readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw bootstrapError('target_bootstrap_required', 'Workspace sync target bootstrap marker is malformed');
  }
}

function bootstrapError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Verifies an already-selected checkout whose repository root is exactly the
 * authorized target WorkspaceRef root. Materialization owners use this same
 * verifier after they have populated a missing or empty target.
 */
export async function prepareExistingGitWorkspaceSyncTarget(input: Readonly<{
  canonicalRoot: string;
  targetState: 'missing' | 'empty' | 'nonempty';
}>, dependencies: Readonly<{
  inspectWorkspaceLocation(input: Readonly<{ candidatePath: string }>): Promise<Readonly<{
    workspaceLocationScm?: Readonly<{ provider: string; rootPath: string }>;
    checkoutDiscovery: readonly Readonly<{ kind: string }>[];
  }> | null>;
}> = {
  inspectWorkspaceLocation: inspectWorkspaceLocationWithScmWorkspace,
}): Promise<void> {
  if (input.targetState !== 'nonempty') {
    throw bootstrapError('target_bootstrap_required', 'Git workspace sync target requires an explicit SCM bootstrap source');
  }
  const canonicalRoot = await realpath(input.canonicalRoot).catch(() => null);
  if (!canonicalRoot) {
    throw bootstrapError('git_selection_unavailable', 'Git workspace sync target is unavailable');
  }
  const inspection = await dependencies.inspectWorkspaceLocation({
    candidatePath: canonicalRoot,
  });
  const inspectedRoot = inspection?.workspaceLocationScm?.provider === 'git'
    ? await realpath(inspection.workspaceLocationScm.rootPath).catch(() => null)
    : null;
  if (inspectedRoot !== canonicalRoot
    || !inspection?.checkoutDiscovery.some(({ kind }) => kind === 'git_worktree')) {
    throw bootstrapError('git_selection_unavailable', 'Selected workspace sync target is not a Git checkout rooted at the authorized path');
  }
}

/**
 * Applies the user's target choice at the SCM ownership boundary. Existing
 * checkouts are verified in place; materialization delegates to the canonical
 * SCM workspace integration so repository credentials and Git behavior never
 * leak into workspace-sync.
 */
export async function prepareWorkspaceSyncGitTarget(input: Readonly<{
  canonicalRoot: string;
  sourceRootPath?: string;
  relationshipId: string;
  targetState: 'missing' | 'empty' | 'nonempty';
  targetBootstrap: 'use_existing' | 'materialize_from_source_workspace';
  materializationReceiptPath: string;
}>, dependencies: Readonly<{
  realizeWorkspaceCheckout(input: Readonly<{
    sourcePath: string;
    targetPath?: string;
    checkoutCreation: Readonly<{
      kind: 'git_worktree';
      displayName: string;
      baseRef: string | null;
      branchMode: 'new';
    }>;
  }>): Promise<ScmWorkspaceIntegrationWorkspaceCheckoutRealizationResult | null>;
  inspectWorkspaceLocation: NonNullable<Parameters<typeof prepareExistingGitWorkspaceSyncTarget>[1]>['inspectWorkspaceLocation'];
}> = {
  realizeWorkspaceCheckout: realizeWorkspaceCheckoutWithScmWorkspace,
  inspectWorkspaceLocation: inspectWorkspaceLocationWithScmWorkspace,
}): Promise<WorkspaceExportMaterializationCustody | void> {
  if (input.targetBootstrap === 'use_existing') {
    return await prepareExistingGitWorkspaceSyncTarget(input, {
      inspectWorkspaceLocation: dependencies.inspectWorkspaceLocation,
    });
  }
  const sourceRootPath = input.sourceRootPath?.trim();
  if (!sourceRootPath || !(await lstat(sourceRootPath).catch(() => null))?.isDirectory()) {
    throw bootstrapError('target_bootstrap_offline', 'Source workspace is unavailable for Git target preparation');
  }
  const displayName = `happier-sync-${createHash('sha256').update(input.relationshipId).digest('hex').slice(0, 12)}`;
  const targetMaterialization = await beginWorkspaceTargetMaterialization({
    targetPath: input.canonicalRoot,
    backupDirectoryPrefix: '.happier-sync-backup',
    receiptPath: input.materializationReceiptPath,
    originalTargetExists: input.targetState !== 'missing',
  });
  try {
    const realization = await dependencies.realizeWorkspaceCheckout({
      sourcePath: sourceRootPath,
      targetPath: input.canonicalRoot,
      checkoutCreation: {
        kind: 'git_worktree',
        displayName,
        baseRef: null,
        branchMode: 'new',
      },
    });
    if (!realization) {
      throw bootstrapError('git_selection_unavailable', 'Source workspace cannot materialize a Git target');
    }
    await targetMaterialization.custody.bindPromotedTarget();
    const realizedRoot = await realpath(realization.targetPath).catch(() => null);
    const expectedRoot = await realpath(input.canonicalRoot).catch(() => null);
    if (!realizedRoot || realizedRoot !== expectedRoot) {
      throw bootstrapError('root_changed', 'SCM materialized outside the authorized workspace sync target');
    }
    await prepareExistingGitWorkspaceSyncTarget({
      canonicalRoot: expectedRoot,
      targetState: 'nonempty',
    }, { inspectWorkspaceLocation: dependencies.inspectWorkspaceLocation });
    return targetMaterialization.custody;
  } catch (error) {
    await targetMaterialization.custody.abort();
    throw error;
  }
}

export { computeWorkspaceSyncRootFingerprint } from './workspaceSyncRootIdentity';

/**
 * Rebuilds process-local target custody from the settings-owned relationship
 * and the target bootstrap owner's verified READY marker. The marker is only
 * restart evidence; current root identity and ownership are reacquired before
 * it can authorize an agent ingress.
 */
export async function rehydrateWorkspaceSyncTargetBootstrap(input: Readonly<{
  rootPath: string;
  relationshipId: string;
  endpointRole: 'alpha' | 'beta';
  policyDigest: string;
  contentSelection: 'git_worktree' | 'all_files';
  stagingDirectory: string;
  rootOwnershipManager: WorkspaceRootOwnershipManager;
}>): Promise<WorkspaceSyncTargetBootstrapResult | null> {
  const { markerPath, materializationReceiptPath } = bootstrapPaths(
    input.stagingDirectory,
    input.relationshipId,
    input.endpointRole,
  );
  const marker = await readBootstrapJson(markerPath);
  if (marker === null) return null;
  const canonicalRoot = await realpath(input.rootPath).catch(() => {
    throw bootstrapError('root_changed', 'Workspace sync target root is unavailable');
  });
  const fingerprint = await computeWorkspaceSyncRootFingerprint(canonicalRoot).catch(() => {
    throw bootstrapError('root_changed', 'Workspace sync target root identity changed');
  });
  if (!isExactObject(marker, ['v', 'engineVersion', 'state', 'relationshipId', 'endpointRole', 'canonicalRoot', 'rootFingerprint', 'policyDigest', 'contentSelection'])
    || marker.v !== 1
    || marker.engineVersion !== WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION
    || marker.state !== 'READY'
    || marker.relationshipId !== input.relationshipId
    || marker.endpointRole !== input.endpointRole
    || marker.canonicalRoot !== canonicalRoot
    || marker.rootFingerprint !== fingerprint
    || marker.policyDigest !== input.policyDigest
    || marker.contentSelection !== input.contentSelection) {
    throw bootstrapError('root_changed', 'Workspace sync target bootstrap no longer matches settings or root identity');
  }
  const ownership = await input.rootOwnershipManager.tryAcquire({
    ownerId: input.relationshipId,
    canonicalRoot,
    operation: 'bootstrap',
  });
  if ('kind' in ownership) {
    throw bootstrapError('workspace_root_in_use', 'Workspace sync target root overlaps an active operation');
  }
  const fingerprintAfterOwnership = await computeWorkspaceSyncRootFingerprint(await realpath(input.rootPath)).catch(() => null);
  if (fingerprintAfterOwnership !== fingerprint) {
    await ownership.release();
    throw bootstrapError('root_changed', 'Workspace sync target root identity changed during restart rehydration');
  }
  const materializationCustody = await rehydrateWorkspaceTargetMaterializationFromReceiptPath({
    targetPath: canonicalRoot,
    backupDirectoryPrefix: '.happier-sync-backup',
    receiptPath: materializationReceiptPath,
  }).catch(async () => {
    await ownership.release();
    throw bootstrapError('target_bootstrap_required', 'Workspace sync target rollback receipt is unsafe');
  });
  return {
    canonicalRoot,
    created: false,
    state: 'READY',
    rootFingerprint: fingerprint,
    policyDigest: input.policyDigest,
    markerPath,
    ownershipHandles: [ownership],
    ...(materializationCustody ? { materializationCustody } : {}),
    release: ownership.release,
  };
}

export async function workspaceSyncTargetBootstrap(input: WorkspaceSyncTargetBootstrapInput): Promise<WorkspaceSyncTargetBootstrapResult> {
  if (!input.rootPath.trim()) throw bootstrapError('workspace_root_unsafe', 'workspace sync target root is blank');
  let sourceRoot: string | undefined;
  if (input.sourceRootPath !== undefined) {
    const normalizedSourceRoot = normalizeSessionHandoffWorkspaceRootPath(input.sourceRootPath);
    if (!normalizedSourceRoot) {
      throw bootstrapError('workspace_root_unsafe', 'workspace sync source root is invalid');
    }
    sourceRoot = normalizedSourceRoot;
  }
  if (!input.relationshipId.trim() || !/^[a-f0-9]{64}$/u.test(input.policyDigest)) {
    throw bootstrapError('target_bootstrap_rejected', 'workspace sync target bootstrap is not authorized');
  }
  if (!input.stagingDirectory.trim()) throw bootstrapError('target_bootstrap_rejected', 'workspace sync staging directory is blank');

  const requested = normalize(resolve(input.rootPath));
  if (requested === resolve('/')) throw bootstrapError('workspace_root_unsafe', 'workspace sync target root is invalid');
  const { operationDirectory, markerPath, materializationReceiptPath } = bootstrapPaths(
    input.stagingDirectory,
    input.relationshipId,
    input.endpointRole,
  );
  let created = false;
  let existingBeforeFence = await lstat(requested).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (existingBeforeFence && (!existingBeforeFence.isDirectory() || existingBeforeFence.isSymbolicLink())) {
    throw bootstrapError('workspace_root_unsafe', 'workspace sync target root must be a real directory');
  }
  const canonicalRootCandidate = existingBeforeFence
    ? await realpath(requested)
    : await realpath(dirname(requested)).then((parent) => normalize(join(parent, basename(requested)))).catch(() => null);
  if (typeof canonicalRootCandidate !== 'string' || canonicalRootCandidate === resolve('/')) {
    throw bootstrapError('workspace_root_unsafe', 'workspace sync target parent is unavailable');
  }
  const canonicalRoot = canonicalRootCandidate;
  const canonicalSourceRoot = sourceRoot === undefined
    ? undefined
    : await realpath(sourceRoot).catch(() => sourceRoot);
  if (canonicalSourceRoot !== undefined && (
    getPathRemainderWithinBase(canonicalRoot, canonicalSourceRoot) !== null
    || getPathRemainderWithinBase(canonicalSourceRoot, canonicalRoot) !== null
  )) {
    throw bootstrapError('workspace_root_unsafe', 'workspace sync source and target roots overlap');
  }
  if (input.contentSelection === 'git_worktree' && !input.prepareGitTarget) {
    throw bootstrapError('target_bootstrap_required', 'Git workspace sync target requires an explicit SCM bootstrap source');
  }

  const ownership = await input.rootOwnershipManager.tryAcquire({
    ownerId: input.relationshipId,
    canonicalRoot,
    operation: 'bootstrap',
    deferRootIdentityBinding: true,
  });
  if ('kind' in ownership) throw bootstrapError('workspace_root_in_use', 'workspace sync target root overlaps an active operation');
  let materializationCustody: WorkspaceExportMaterializationCustody | undefined;
  try {
    if (!(await lstat(markerPath).catch(() => null))) {
      await recoverInterruptedWorkspaceTargetMaterialization({
        targetPath: requested,
        backupDirectoryPrefix: '.happier-sync-backup',
        receiptPath: materializationReceiptPath,
      }).catch((error: unknown) => {
        throw bootstrapError('target_bootstrap_required', `Workspace sync target recovery failed: ${(error as Error).message}`);
      });
    }
    existingBeforeFence = await lstat(requested).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (existingBeforeFence && (!existingBeforeFence.isDirectory() || existingBeforeFence.isSymbolicLink())) {
      throw bootstrapError('workspace_root_unsafe', 'workspace sync target root must be a real directory');
    }
    if (existingBeforeFence || input.activatesExactMirror || input.targetReplacementApproval) {
      let approvalFingerprint = computeWorkspaceSyncAbsentRootFingerprint(canonicalRoot);
      if (existingBeforeFence) {
        const approvalCanonicalRoot = await realpath(requested);
        if (approvalCanonicalRoot !== canonicalRoot) {
          throw bootstrapError('root_changed', 'workspace sync target root changed before approval replay');
        }
        approvalFingerprint = await computeWorkspaceSyncRootFingerprint(canonicalRoot);
      }
      const approvalMarker = await readFile(markerPath, 'utf8').then((raw) => JSON.parse(raw) as unknown).catch(() => null);
      const alreadyReady = Boolean(isExactObject(approvalMarker, ['v', 'engineVersion', 'state', 'relationshipId', 'endpointRole', 'canonicalRoot', 'rootFingerprint', 'policyDigest', 'contentSelection'])
        && approvalMarker.v === 1
        && approvalMarker.engineVersion === WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION
        && approvalMarker.state === 'READY'
        && approvalMarker.relationshipId === input.relationshipId
        && approvalMarker.endpointRole === input.endpointRole
        && approvalMarker.canonicalRoot === canonicalRoot
        && approvalMarker.rootFingerprint === approvalFingerprint
        && approvalMarker.policyDigest === input.policyDigest
        && approvalMarker.contentSelection === input.contentSelection);
      // The complete consequence set is derived here, from the target this
      // daemon actually observes, and compared exactly. A proof that is
      // missing, stale, stamped elsewhere, or carries a consequence the
      // current state does not require authorizes nothing and mutates nothing.
      const replacesNonEmptyTarget = existingBeforeFence !== null
        && input.targetBootstrap === 'materialize_from_source_workspace'
        && (await readdir(canonicalRoot)).length > 0;
      const requiredConsequences = alreadyReady ? [] : [
        ...(replacesNonEmptyTarget ? ['replace_nonempty_workspace_target'] as const : []),
        ...(input.activatesExactMirror ? ['delete_target_only_files_during_exact_mirror'] as const : []),
      ];
      if (!alreadyReady && (requiredConsequences.length > 0 || input.targetReplacementApproval)) {
        const approval = input.targetReplacementApproval;
        if (!approval
          || approval.canonicalRoot !== canonicalRoot
          || approval.rootFingerprint !== approvalFingerprint
          || approval.consequences.length !== requiredConsequences.length
          || !requiredConsequences.every((consequence, index) => approval.consequences[index] === consequence)) {
          throw bootstrapError('approval_stale', 'Workspace target replacement approval is stale');
        }
      }
    }
    await mkdir(operationDirectory, { recursive: true, mode: 0o700 });
    if (!existingBeforeFence && !input.createIfMissing) {
      throw bootstrapError('target_bootstrap_required', 'workspace sync target root does not exist');
    }
    if (existingBeforeFence) {
      const recoveredCanonicalRoot = await realpath(requested);
      if (getPathRemainderWithinBase(recoveredCanonicalRoot, canonicalRoot) !== ''
        || getPathRemainderWithinBase(canonicalRoot, recoveredCanonicalRoot) !== '') {
        throw bootstrapError('root_changed', 'workspace sync target root changed during recovery');
      }
    }
    let existing = existingBeforeFence;
    const gitOwnsMissingTargetMaterialization = existing === null
      && input.contentSelection === 'git_worktree';
    if (!existing && !gitOwnsMissingTargetMaterialization) {
      const createdTargetMaterialization = await beginWorkspaceTargetMaterialization({
        targetPath: canonicalRoot,
        backupDirectoryPrefix: '.happier-sync-backup',
        receiptPath: materializationReceiptPath,
        originalTargetExists: false,
      });
      await mkdir(canonicalRoot);
      await createdTargetMaterialization.custody.bindPromotedTarget();
      materializationCustody = createdTargetMaterialization.custody;
      created = true;
      existing = await lstat(canonicalRoot);
    }
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw bootstrapError('workspace_root_unsafe', 'workspace sync target root must be a real directory');
    }
    const priorMarker = await readFile(markerPath, 'utf8').then((raw) => JSON.parse(raw) as unknown).catch(() => null);
    const fingerprintBeforeMarker = existing
      ? await computeWorkspaceSyncRootFingerprint(canonicalRoot)
      : computeWorkspaceSyncAbsentRootFingerprint(canonicalRoot);
    const priorReady = Boolean(isExactObject(priorMarker, ['v', 'engineVersion', 'state', 'relationshipId', 'endpointRole', 'canonicalRoot', 'rootFingerprint', 'policyDigest', 'contentSelection'])
      && priorMarker.v === 1
      && priorMarker.engineVersion === WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION
      && priorMarker.state === 'READY'
      && priorMarker.relationshipId === input.relationshipId
      && priorMarker.endpointRole === input.endpointRole
      && priorMarker.canonicalRoot === canonicalRoot
      && priorMarker.rootFingerprint === fingerprintBeforeMarker
      && priorMarker.policyDigest === input.policyDigest
      && priorMarker.contentSelection === input.contentSelection);
    const targetState = existingBeforeFence === null
      ? 'missing'
      : (await readdir(canonicalRoot)).length === 0 ? 'empty' : 'nonempty';
    if (input.contentSelection === 'git_worktree') {
      const gitMaterializationCustody = await input.prepareGitTarget!({
        canonicalRoot,
        ...(canonicalSourceRoot === undefined ? {} : { sourceRootPath: canonicalSourceRoot }),
        relationshipId: input.relationshipId,
        endpointRole: input.endpointRole,
        policyDigest: input.policyDigest,
        targetState,
        targetBootstrap: input.targetBootstrap,
        materializationReceiptPath,
      });
      if (gitMaterializationCustody) materializationCustody = gitMaterializationCustody;
      const preparedIdentity = await realpath(requested);
      if (getPathRemainderWithinBase(preparedIdentity, canonicalRoot) !== ''
        || getPathRemainderWithinBase(canonicalRoot, preparedIdentity) !== ''
        || !(await lstat(preparedIdentity)).isDirectory()) {
        throw bootstrapError('root_changed', 'workspace sync target root changed during SCM bootstrap');
      }
    } else if (!priorReady && targetState === 'nonempty') {
      if (input.targetBootstrap === 'materialize_from_source_workspace') {
        if (!input.materializeSeed) {
          throw bootstrapError('target_bootstrap_seed_required', 'workspace sync target requires the selected source seed');
        }
        const seedMaterializationCustody = await input.materializeSeed({
          canonicalRoot,
          relationshipId: input.relationshipId,
          endpointRole: input.endpointRole,
          policyDigest: input.policyDigest,
          materializationReceiptPath,
          originalTargetExists: existingBeforeFence !== null,
        });
        if (seedMaterializationCustody) materializationCustody = seedMaterializationCustody;
      }
      const seededIdentity = await realpath(requested);
      if (seededIdentity !== canonicalRoot || !(await lstat(seededIdentity)).isDirectory()) {
        throw bootstrapError('root_changed', 'workspace sync target root changed during seed materialization');
      }
    }
    const verifiedCanonicalRoot = await realpath(requested);
    if (getPathRemainderWithinBase(verifiedCanonicalRoot, canonicalRoot) !== ''
      || getPathRemainderWithinBase(canonicalRoot, verifiedCanonicalRoot) !== '') {
      throw bootstrapError('root_changed', 'workspace sync target root changed before bootstrap');
    }
    await ownership.bindCurrentRootIdentity();
    const fingerprint = await computeWorkspaceSyncRootFingerprint(canonicalRoot);
    const marker: WorkspaceSyncTargetBootstrapMarker = {
      v: 1,
      state: 'READY',
      relationshipId: input.relationshipId,
      endpointRole: input.endpointRole,
      canonicalRoot,
      rootFingerprint: fingerprint,
      policyDigest: input.policyDigest,
      contentSelection: input.contentSelection,
      engineVersion: WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION,
    };
    const verifiedFingerprint = await computeWorkspaceSyncRootFingerprint(await realpath(requested));
    if (verifiedFingerprint !== fingerprint) throw bootstrapError('root_changed', 'workspace sync target root changed during bootstrap');
    // This is the only durable bootstrap authority. An interrupted attempt has
    // no READY record, so restart performs a fresh root/policy inspection.
    await writeJsonAtomic(markerPath, marker);
    let materializationSettled = false;
    const unsettledMaterializationCustody = materializationCustody ?? null;
    const retainedMaterializationCustody = unsettledMaterializationCustody
      ? Object.freeze({
          receipt: unsettledMaterializationCustody.receipt,
          bindPromotedTarget: unsettledMaterializationCustody.bindPromotedTarget,
          commit: async () => {
            if (materializationSettled) return;
            await unsettledMaterializationCustody.commit();
            materializationSettled = true;
          },
          abort: async () => {
            if (materializationSettled) return;
            await unsettledMaterializationCustody.abort();
            await rm(markerPath, { force: true });
            materializationSettled = true;
          },
        })
      : undefined;
    return {
      canonicalRoot, created, state: 'READY', rootFingerprint: fingerprint, policyDigest: input.policyDigest, markerPath,
      ownershipHandles: [ownership], release: ownership.release,
      ...(retainedMaterializationCustody ? { materializationCustody: retainedMaterializationCustody } : {}),
    };
  } catch (error) {
    let materializationAborted = materializationCustody === undefined;
    if (materializationCustody) {
      await materializationCustody.abort().then(
        () => { materializationAborted = true; },
        () => undefined,
      );
    }
    if (!materializationAborted) {
      // Keep the receipt for the next restart when the active custody could
      // not settle. Guessing here could discard the only rollback evidence.
    } else {
      await recoverInterruptedWorkspaceTargetMaterialization({
        targetPath: canonicalRoot,
        backupDirectoryPrefix: '.happier-sync-backup',
        receiptPath: materializationReceiptPath,
      }).catch(() => undefined);
    }
    await rm(markerPath, { force: true }).catch(() => undefined);
    await ownership.release();
    throw error;
  }
}

export const prepareWorkspaceSyncTargetBootstrap = workspaceSyncTargetBootstrap;
