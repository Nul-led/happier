import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve } from 'node:path';

import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import { getPathRemainderWithinBase } from '@/session/handoff/paths/sessionHandoffPathNormalization';
import { inspectWorkspaceLocationWithScmWorkspace } from '@/scm/workspace/workspaceLocationInspection';
import { normalizeSessionHandoffWorkspaceRootPath } from '@happier-dev/protocol';
import type { WorkspaceRootOwnershipHandle, WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import { computeWorkspaceSyncRootFingerprint } from './workspaceSyncRootIdentity';

export type WorkspaceSyncTargetBootstrapInput = Readonly<{
  rootPath: string;
  /** Present only when the source root is on this daemon and path-comparable. */
  sourceRootPath?: string;
  relationshipId: string;
  endpointRole: 'alpha' | 'beta';
  policyDigest: string;
  contentSelection: 'git_worktree' | 'all_files';
  approved: true;
  stagingDirectory: string;
  rootOwnershipManager: WorkspaceRootOwnershipManager;
  createIfMissing?: boolean;
  /** The target WorkspaceRef was explicitly selected as an existing checkout/folder. */
  existingTargetChoice?: 'use_existing';
  /** SCM-owned Git verification/materialization. Credentials stay inside this callback. */
  prepareGitTarget?: (input: Readonly<{
    canonicalRoot: string;
    sourceRootPath?: string;
    relationshipId: string;
    endpointRole: 'alpha' | 'beta';
    policyDigest: string;
    targetState: 'missing' | 'empty' | 'nonempty';
  }>) => Promise<void>;
  materializeSeed?: (input: Readonly<{
    canonicalRoot: string;
    relationshipId: string;
    endpointRole: 'alpha' | 'beta';
    policyDigest: string;
  }>) => Promise<void>;
}>;

export type WorkspaceSyncTargetBootstrapResult = Readonly<{
  canonicalRoot: string;
  created: boolean;
  state: 'READY';
  rootFingerprint: string;
  policyDigest: string;
  markerPath: string;
  /** Deterministic digest over the verified READY marker facts. */
  manifestDigest: string;
  ownershipHandles: readonly WorkspaceRootOwnershipHandle[];
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
}>;

const WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION = 'happier-mutagen-external-v1' as const;
type WorkspaceSyncTargetBootstrapState =
  | 'AUTHORIZED'
  | 'STAGING_CREATED'
  | 'MATERIALIZING'
  | 'VERIFYING'
  | 'READY'
  | 'REJECTED'
  | 'OFFLINE'
  | 'UNSAFE_ROOT'
  | 'MATERIALIZATION_FAILED'
  | 'VERIFICATION_FAILED';
type WorkspaceSyncTargetBootstrapManifest = Readonly<{
  v: 1;
  engineVersion: typeof WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION;
  state: WorkspaceSyncTargetBootstrapState;
  relationshipId: string;
  endpointRole: 'alpha' | 'beta';
  canonicalRoot: string;
  rootFingerprint: string | null;
  policyDigest: string;
  contentSelection: 'git_worktree' | 'all_files';
}>;

/**
 * One canonical manifest-digest representation, derived from exactly the facts
 * persisted in the READY marker after verification.
 */
function manifestDigest(manifest: WorkspaceSyncTargetBootstrapManifest): string {
  return createHash('sha256')
    .update('workspace-sync-bootstrap-manifest-v1\0')
    .update(JSON.stringify(manifest))
    .digest('hex');
}

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
    manifestPath: join(operationDirectory, 'manifest.json'),
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

function failureState(error: unknown, phase: 'staging' | 'materializing' | 'verifying'): WorkspaceSyncTargetBootstrapState {
  const code = (error as Readonly<{ code?: unknown }> | null)?.code;
  if (code === 'target_bootstrap_offline') return 'OFFLINE';
  if (code === 'workspace_root_unsafe' || code === 'root_changed') return 'UNSAFE_ROOT';
  if (code === 'target_bootstrap_rejected' || code === 'target_bootstrap_required' || code === 'target_bootstrap_seed_required') return 'REJECTED';
  return phase === 'materializing' ? 'MATERIALIZATION_FAILED' : 'VERIFICATION_FAILED';
}

function bootstrapError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Verifies the only Git bootstrap shape that is fully authorized by the
 * current wire: an already-selected checkout whose repository root is exactly
 * the target WorkspaceRef root. Missing or empty targets require an explicit
 * SCM source choice that the current request does not carry and therefore fail
 * closed instead of guessing credentials, repository identity, or a branch.
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
  const { markerPath, manifestPath } = bootstrapPaths(
    input.stagingDirectory,
    input.relationshipId,
    input.endpointRole,
  );
  const [marker, manifest] = await Promise.all([
    readBootstrapJson(markerPath),
    readBootstrapJson(manifestPath),
  ]);
  if (marker === null && manifest === null) return null;
  if (marker === null || manifest === null) {
    throw bootstrapError('target_bootstrap_required', 'Workspace sync target bootstrap is incomplete');
  }
  const canonicalRoot = await realpath(input.rootPath).catch(() => {
    throw bootstrapError('root_changed', 'Workspace sync target root is unavailable');
  });
  const fingerprint = await computeWorkspaceSyncRootFingerprint(canonicalRoot).catch(() => {
    throw bootstrapError('root_changed', 'Workspace sync target root identity changed');
  });
  const markerKeys = ['v', 'state', 'relationshipId', 'endpointRole', 'canonicalRoot', 'rootFingerprint', 'policyDigest'] as const;
  const manifestKeys = ['v', 'engineVersion', 'state', 'relationshipId', 'endpointRole', 'canonicalRoot', 'rootFingerprint', 'policyDigest', 'contentSelection'] as const;
  if (!isExactObject(marker, markerKeys)
    || marker.v !== 1
    || marker.state !== 'READY'
    || marker.relationshipId !== input.relationshipId
    || marker.endpointRole !== input.endpointRole
    || marker.canonicalRoot !== canonicalRoot
    || marker.rootFingerprint !== fingerprint
    || marker.policyDigest !== input.policyDigest
    || !isExactObject(manifest, manifestKeys)
    || manifest.v !== 1
    || manifest.engineVersion !== WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION
    || manifest.state !== 'READY'
    || manifest.relationshipId !== input.relationshipId
    || manifest.endpointRole !== input.endpointRole
    || manifest.canonicalRoot !== canonicalRoot
    || manifest.rootFingerprint !== fingerprint
    || manifest.policyDigest !== input.policyDigest
    || manifest.contentSelection !== input.contentSelection) {
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
  const readyManifest = manifest as WorkspaceSyncTargetBootstrapManifest;
  return {
    canonicalRoot,
    created: false,
    state: 'READY',
    rootFingerprint: fingerprint,
    policyDigest: input.policyDigest,
    markerPath,
    manifestDigest: manifestDigest(readyManifest),
    ownershipHandles: [ownership],
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
  if (!input.relationshipId.trim() || !/^[a-f0-9]{64}$/u.test(input.policyDigest) || input.approved !== true) {
    throw bootstrapError('target_bootstrap_rejected', 'workspace sync target bootstrap is not explicitly authorized');
  }
  if (!input.stagingDirectory.trim()) throw bootstrapError('target_bootstrap_rejected', 'workspace sync staging directory is blank');

  const requested = normalize(resolve(input.rootPath));
  if (requested === resolve('/')) throw bootstrapError('workspace_root_unsafe', 'workspace sync target root is invalid');
  let created = false;
  const existingBeforeFence = await lstat(requested).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (existingBeforeFence && (!existingBeforeFence.isDirectory() || existingBeforeFence.isSymbolicLink())) {
    throw bootstrapError('workspace_root_unsafe', 'workspace sync target root must be a real directory');
  }
  if (!existingBeforeFence && !input.createIfMissing) {
    throw bootstrapError('target_bootstrap_required', 'workspace sync target root does not exist');
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

  const { operationDirectory, markerPath, manifestPath } = bootstrapPaths(
    input.stagingDirectory,
    input.relationshipId,
    input.endpointRole,
  );

  const ownership = await input.rootOwnershipManager.tryAcquire({
    ownerId: input.relationshipId,
    canonicalRoot,
    operation: 'bootstrap',
  });
  if ('kind' in ownership) throw bootstrapError('workspace_root_in_use', 'workspace sync target root overlaps an active operation');
  let phase: 'staging' | 'materializing' | 'verifying' = 'staging';
  const buildManifest = (
    state: WorkspaceSyncTargetBootstrapState,
    fingerprint: string | null,
  ): WorkspaceSyncTargetBootstrapManifest => ({
    v: 1,
    engineVersion: WORKSPACE_SYNC_BOOTSTRAP_ENGINE_VERSION,
    state,
    relationshipId: input.relationshipId,
    endpointRole: input.endpointRole,
    canonicalRoot,
    rootFingerprint: fingerprint,
    policyDigest: input.policyDigest,
    contentSelection: input.contentSelection,
  });
  try {
    await mkdir(operationDirectory, { recursive: true, mode: 0o700 });
    await writeJsonAtomic(manifestPath, buildManifest('AUTHORIZED', null));
    await writeJsonAtomic(manifestPath, buildManifest('STAGING_CREATED', null));
    let existing = existingBeforeFence;
    if (!existing) {
      await mkdir(canonicalRoot);
      created = true;
      existing = await lstat(canonicalRoot);
    }
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw bootstrapError('workspace_root_unsafe', 'workspace sync target root must be a real directory');
    }
    const verifiedCanonicalRoot = await realpath(requested);
    if (getPathRemainderWithinBase(verifiedCanonicalRoot, canonicalRoot) !== ''
      || getPathRemainderWithinBase(canonicalRoot, verifiedCanonicalRoot) !== '') {
      throw bootstrapError('root_changed', 'workspace sync target root changed before bootstrap');
    }
    await ownership.bindCurrentRootIdentity();
    const fingerprintBeforeMarker = await computeWorkspaceSyncRootFingerprint(canonicalRoot);
    const priorMarker = await readFile(markerPath, 'utf8').then((raw) => JSON.parse(raw) as unknown).catch(() => null);
    const priorReady = Boolean(priorMarker && typeof priorMarker === 'object' && !Array.isArray(priorMarker)
      && (priorMarker as Record<string, unknown>).v === 1
      && (priorMarker as Record<string, unknown>).state === 'READY'
      && (priorMarker as Record<string, unknown>).relationshipId === input.relationshipId
      && (priorMarker as Record<string, unknown>).endpointRole === input.endpointRole
      && (priorMarker as Record<string, unknown>).canonicalRoot === canonicalRoot
      && (priorMarker as Record<string, unknown>).rootFingerprint === fingerprintBeforeMarker
      && (priorMarker as Record<string, unknown>).policyDigest === input.policyDigest);
    const children = await readdir(canonicalRoot);
    const targetState = existingBeforeFence === null ? 'missing' : children.length === 0 ? 'empty' : 'nonempty';
    if (input.contentSelection === 'git_worktree') {
      phase = 'materializing';
      await writeJsonAtomic(manifestPath, buildManifest('MATERIALIZING', fingerprintBeforeMarker));
      await input.prepareGitTarget!({
        canonicalRoot,
        ...(canonicalSourceRoot === undefined ? {} : { sourceRootPath: canonicalSourceRoot }),
        relationshipId: input.relationshipId,
        endpointRole: input.endpointRole,
        policyDigest: input.policyDigest,
        targetState,
      });
      const preparedIdentity = await realpath(requested);
      if (getPathRemainderWithinBase(preparedIdentity, canonicalRoot) !== ''
        || getPathRemainderWithinBase(canonicalRoot, preparedIdentity) !== ''
        || !(await lstat(preparedIdentity)).isDirectory()) {
        throw bootstrapError('root_changed', 'workspace sync target root changed during SCM bootstrap');
      }
    } else if (children.length > 0 && !priorReady) {
      if (!input.materializeSeed) {
        if (input.existingTargetChoice !== 'use_existing') {
          throw bootstrapError('target_bootstrap_seed_required', 'non-empty workspace sync target requires an explicit existing-target or seed choice');
        }
      } else {
        phase = 'materializing';
        await writeJsonAtomic(manifestPath, buildManifest('MATERIALIZING', fingerprintBeforeMarker));
        await input.materializeSeed({
          canonicalRoot,
          relationshipId: input.relationshipId,
          endpointRole: input.endpointRole,
          policyDigest: input.policyDigest,
        });
      }
      const seededIdentity = await realpath(requested);
      if (seededIdentity !== canonicalRoot || !(await lstat(seededIdentity)).isDirectory()) {
        throw bootstrapError('root_changed', 'workspace sync target root changed during seed materialization');
      }
    }
    phase = 'verifying';
    await writeJsonAtomic(manifestPath, buildManifest('VERIFYING', await computeWorkspaceSyncRootFingerprint(canonicalRoot)));
    const fingerprint = await computeWorkspaceSyncRootFingerprint(canonicalRoot);
    const marker: WorkspaceSyncTargetBootstrapMarker = {
      v: 1,
      state: 'READY',
      relationshipId: input.relationshipId,
      endpointRole: input.endpointRole,
      canonicalRoot,
      rootFingerprint: fingerprint,
      policyDigest: input.policyDigest,
    };
    const verifiedFingerprint = await computeWorkspaceSyncRootFingerprint(await realpath(requested));
    if (verifiedFingerprint !== fingerprint) throw bootstrapError('root_changed', 'workspace sync target root changed during bootstrap');
    const readyManifest = buildManifest('READY', fingerprint);
    await writeJsonAtomic(manifestPath, readyManifest);
    // The READY marker is the single atomic authorization point and is written
    // only after target identity and the durable manifest have been verified.
    await writeJsonAtomic(markerPath, marker);
    return {
      canonicalRoot, created, state: 'READY', rootFingerprint: fingerprint, policyDigest: input.policyDigest, markerPath,
      manifestDigest: manifestDigest(readyManifest),
      ownershipHandles: [ownership], release: ownership.release,
    };
  } catch (error) {
    const fingerprint = await computeWorkspaceSyncRootFingerprint(canonicalRoot).catch(() => null);
    await writeJsonAtomic(manifestPath, buildManifest(failureState(error, phase), fingerprint)).catch(() => undefined);
    await ownership.release();
    throw error;
  }
}

export const prepareWorkspaceSyncTargetBootstrap = workspaceSyncTargetBootstrap;
