import {
  ReadWorkspaceSyncFileResultV1Schema,
  WorkspaceSyncTargetBootstrapPrepareResultV1Schema,
  WorkspaceSyncTargetBootstrapPrepareV1Schema,
  WorkspaceSyncTargetBootstrapReleaseResultV1Schema,
  WorkspaceSyncTargetBootstrapReleaseV1Schema,
  WorkspaceSyncTargetConflictDeleteV1Schema,
  WorkspaceSyncTargetFileReadV1Schema,
  type ReadWorkspaceSyncFileResultV1,
  type WorkspaceRefV1,
  type WorkspaceSyncRelationshipV1,
  type WorkspaceSyncTargetBootstrapPrepareResultV1,
  type WorkspaceSyncTargetBootstrapPrepareV1,
  type WorkspaceSyncTargetBootstrapReleaseResultV1,
  type WorkspaceSyncTargetBootstrapReleaseV1,
  type WorkspaceSyncTargetConflictDeleteV1,
  type WorkspaceSyncTargetFileReadV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { realpath } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import {
  getActiveAccountSettingsSnapshot,
  type ActiveAccountSettingsSnapshot,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveWorkspaceRefById } from '@/settings/accountSettings/workspaceRefsV1';
import { deleteWorkspaceSyncConflictLoserAtRoot } from './workspaceSyncConflicts';
import { readWorkspaceSyncFileAtRoot } from './workspaceSyncFileRead';
import {
  computeWorkspaceSyncRootFingerprint,
  rehydrateWorkspaceSyncTargetBootstrap,
  workspaceSyncTargetBootstrap,
  type WorkspaceSyncTargetBootstrapInput,
} from './workspaceSyncTargetBootstrap';
import type { WorkspaceRootOwnershipHandle, WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';

export type WorkspaceSyncTargetConflictDeleteRequest = Readonly<{
  relationshipId: string;
  targetMachineId: string;
  targetWorkspaceRefId: string;
  path: string;
  expectedDigest?: string;
  expectedKind: WorkspaceSyncTargetConflictDeleteV1['expectedKind'];
  signal?: AbortSignal;
}>;

export type WorkspaceSyncTargetFileReadRequest = Readonly<{
  relationshipId: string;
  targetMachineId: string;
  targetWorkspaceRefId: string;
  path: string;
  expectedDigest?: string;
  maxBytes: number;
  signal?: AbortSignal;
}>;

export type WorkspaceSyncTargetBootstrapPrepareRequest = Readonly<
  WorkspaceSyncTargetBootstrapPrepareV1 & Readonly<{ targetMachineId: string; signal?: AbortSignal }>
>;
export type WorkspaceSyncTargetBootstrapReleaseRequest = Readonly<
  WorkspaceSyncTargetBootstrapReleaseV1 & Readonly<{ targetMachineId: string; signal?: AbortSignal }>
>;

export type AcquireWorkspaceSyncMachineIngressRequest = Readonly<{
  operationId: string;
  sourceMachineId: string;
  targetMachineId: string;
  signal?: AbortSignal;
}>;

export type WorkspaceSyncMachineIngress = Readonly<{
  port: number;
  close(): Promise<void>;
}>;

/**
 * Local bootstrap resources supplied by the daemon composition root. The
 * staging directory and root-ownership manager are daemon-owned; the receiving
 * authority never accepts them over the wire.
 */
export type WorkspaceSyncTargetBootstrapAuthorityDependencies = Readonly<{
  stagingDirectory: string;
  rootOwnershipManager: WorkspaceRootOwnershipManager;
  /** Canonical SCM owner for verifying/materializing the selected Git target. */
  prepareGitTarget?: WorkspaceSyncTargetBootstrapInput['prepareGitTarget'];
  /** Must match the daemon-wide 15-second ownership renewal cadence. */
  ownershipRenewIntervalMs?: number;
}>;

export type WorkspaceSyncTargetAuthority = Readonly<{
  deleteConflictLoserHere(request: WorkspaceSyncTargetConflictDeleteV1, signal?: AbortSignal): Promise<void>;
  readFileHere(request: WorkspaceSyncTargetFileReadV1, signal?: AbortSignal): Promise<ReadWorkspaceSyncFileResultV1>;
  deleteConflictLoserAtTarget(request: WorkspaceSyncTargetConflictDeleteRequest): Promise<void>;
  readFileAtTarget(request: WorkspaceSyncTargetFileReadRequest): Promise<ReadWorkspaceSyncFileResultV1>;
  prepareBootstrapHere(request: WorkspaceSyncTargetBootstrapPrepareV1, signal?: AbortSignal): Promise<WorkspaceSyncTargetBootstrapPrepareResultV1>;
  releaseBootstrapHere(request: WorkspaceSyncTargetBootstrapReleaseV1, signal?: AbortSignal): Promise<WorkspaceSyncTargetBootstrapReleaseResultV1>;
  prepareBootstrapAtTarget(request: WorkspaceSyncTargetBootstrapPrepareRequest): Promise<WorkspaceSyncTargetBootstrapPrepareResultV1>;
  releaseBootstrapAtTarget(request: WorkspaceSyncTargetBootstrapReleaseRequest): Promise<WorkspaceSyncTargetBootstrapReleaseResultV1>;
  acquireWorkspaceSyncMachineIngress(request: AcquireWorkspaceSyncMachineIngressRequest): Promise<WorkspaceSyncMachineIngress>;
  /** Owner-local, non-wire: release retained relationship fences the settings no longer own. */
  reconcileRetainedBootstraps(): Promise<void>;
  /** Owner-local, non-wire: release every retained handle on daemon shutdown. */
  releaseAllRetainedBootstraps(): Promise<void>;
}>;

export type WorkspaceSyncTargetAuthorityDependencies = Readonly<{
  localMachineId: string;
  getSettingsSnapshot?: () => ActiveAccountSettingsSnapshot | null;
  callMachineRpc(input: Readonly<{
    machineId: string;
    method: string;
    request: unknown;
    signal?: AbortSignal;
  }>): Promise<unknown>;
  bootstrap?: WorkspaceSyncTargetBootstrapAuthorityDependencies;
  openRootedAgent?(input: Readonly<{
    operationId: string;
    role: 'alpha' | 'beta';
    workspaceRefId: string;
    canonicalRoot: string;
    signal?: AbortSignal;
  }>): Promise<Duplex>;
  /**
   * Derived once from the retired-state inspection at the daemon composition
   * boundary. Throws the exact typed legacy-state code before any local
   * delete/read/bootstrap-prepare mutation, routed target call, or rooted
   * agent ingress. Release/cleanup paths stay available: they never mutate
   * workspace state.
   */
  assertLegacyStateAvailable?: () => void;
}>;

function authorityError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function resolveOwnedWorkspace(
  snapshot: ActiveAccountSettingsSnapshot | null,
  relationshipId: string,
  workspaceRefId: string,
): Readonly<{ relationship: WorkspaceSyncRelationshipV1; workspace: WorkspaceRefV1 }> {
  const relationships = snapshot?.settings.workspaceSyncRelationshipsV1 ?? [];
  const relationshipMatches = relationships.filter((candidate) => (
    candidate.relationshipId === relationshipId && candidate.enabled
  ));
  if (relationshipMatches.length !== 1) {
    throw authorityError('relationship_not_ready', 'Workspace sync relationship is not ready');
  }
  const relationship = relationshipMatches[0]!;
  if (
    relationship.alphaWorkspaceRefId !== workspaceRefId
    && relationship.betaWorkspaceRefId !== workspaceRefId
  ) {
    throw authorityError('relationship_not_ready', 'Workspace reference is not owned by the relationship');
  }
  const workspaceMatches = (snapshot?.settings.workspaceRefsV1 ?? [])
    .filter((candidate) => candidate.id === workspaceRefId);
  if (workspaceMatches.length !== 1) {
    throw authorityError('peer_unavailable', 'Workspace sync endpoint is unavailable');
  }
  return { relationship, workspace: workspaceMatches[0]! };
}

function assertTargetMachine(workspace: WorkspaceRefV1, targetMachineId: string): void {
  if (!targetMachineId.trim() || workspace.machineId.trim() !== targetMachineId.trim()) {
    throw authorityError('peer_unavailable', 'Workspace sync target machine does not own the selected workspace');
  }
}

function assertOkResult(value: unknown): void {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || (value as Readonly<Record<string, unknown>>).ok !== true
  ) {
    throw authorityError('indeterminate', 'Workspace sync target mutation returned an invalid result');
  }
}

function assertResultOk(value: unknown): asserts value is { ok: true; released: boolean } {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || (value as Readonly<Record<string, unknown>>).ok !== true
    || typeof (value as Readonly<Record<string, unknown>>).released !== 'boolean'
  ) {
    throw authorityError('indeterminate', 'Workspace sync target bootstrap release returned an invalid result');
  }
}

/** Resolves the single workspace ref for an id or fails closed. */
function resolveWorkspaceRef(
  snapshot: ActiveAccountSettingsSnapshot | null,
  workspaceRefId: string,
): WorkspaceRefV1 {
  const workspace = resolveWorkspaceRefById(snapshot?.settings.workspaceRefsV1 ?? [], workspaceRefId);
  if (!workspace) {
    throw authorityError('peer_unavailable', 'Workspace sync endpoint is unavailable');
  }
  return workspace;
}

/**
 * Resolves the bootstrap owner against the current Account settings and
 * returns the locally resolved target/source roots plus the owner operation
 * id. Every decision is made from the receiving daemon's own snapshot; the
 * caller supplies identity fields only.
 */
function resolveBootstrapOwner(
  snapshot: ActiveAccountSettingsSnapshot | null,
  request: WorkspaceSyncTargetBootstrapPrepareV1,
): Readonly<{
  operationId: string;
  targetRootPath: string;
  sourceRootPath: string;
  relationshipId: string | null;
  targetWorkspaceRefId: string;
  targetWorkspace: WorkspaceRefV1;
  sourceWorkspaceRefId: string;
  sourceWorkspace: WorkspaceRefV1;
  endpointRole: 'alpha' | 'beta';
  contentSelection: 'git_worktree' | 'all_files';
}> {
  const target = resolveWorkspaceRef(snapshot, request.targetWorkspaceRefId);
  if (request.owner.kind === 'relationship') {
    const relationshipId = request.owner.relationshipId;
    const relationships = snapshot?.settings.workspaceSyncRelationshipsV1 ?? [];
    const matches = relationships.filter((candidate) => (
      candidate.relationshipId === relationshipId && candidate.enabled
    ));
    if (matches.length !== 1) {
      throw authorityError('relationship_not_ready', 'Workspace sync relationship is not ready');
    }
    const relationship = matches[0]!;
    const expectedRefId = request.endpointRole === 'alpha'
      ? relationship.alphaWorkspaceRefId
      : relationship.betaWorkspaceRefId;
    if (request.targetWorkspaceRefId !== expectedRefId) {
      throw authorityError('relationship_not_ready', 'Workspace sync bootstrap target does not match the declared relationship endpoint');
    }
    if (request.policyDigest !== relationship.contentPolicy.policyDigest) {
      throw authorityError('bootstrap_definition_conflict', 'Workspace sync bootstrap policy digest conflicts with the relationship');
    }
    const sourceRefId = request.endpointRole === 'alpha'
      ? relationship.betaWorkspaceRefId
      : relationship.alphaWorkspaceRefId;
    const source = resolveWorkspaceRef(snapshot, sourceRefId);
    return {
      operationId: relationship.relationshipId,
      targetRootPath: target.rootPath,
      sourceRootPath: source.rootPath,
      relationshipId: relationship.relationshipId,
      targetWorkspaceRefId: request.targetWorkspaceRefId,
      targetWorkspace: target,
      sourceWorkspaceRefId: sourceRefId,
      sourceWorkspace: source,
      endpointRole: request.endpointRole,
      contentSelection: relationship.contentPolicy.selection,
    };
  }
  const operation = request.owner.operation;
  // A copy_once operation always bootstraps its beta endpoint.
  if (request.endpointRole !== 'beta' || request.targetWorkspaceRefId !== operation.betaWorkspaceRefId) {
    throw authorityError('bootstrap_definition_conflict', 'Workspace sync bootstrap target does not match the copy_once operation');
  }
  if (request.policyDigest !== operation.contentPolicy.policyDigest) {
    throw authorityError('bootstrap_definition_conflict', 'Workspace sync bootstrap policy digest conflicts with the copy_once operation');
  }
  const source = resolveWorkspaceRef(snapshot, operation.alphaWorkspaceRefId);
  if (operation.controllerMachineId.trim() !== source.machineId.trim()) {
    throw authorityError('bootstrap_definition_conflict', 'Workspace sync copy controller does not own the source endpoint');
  }
  return {
    operationId: operation.operationId,
    targetRootPath: target.rootPath,
    sourceRootPath: source.rootPath,
    relationshipId: null,
    targetWorkspaceRefId: request.targetWorkspaceRefId,
    targetWorkspace: target,
    sourceWorkspaceRefId: operation.alphaWorkspaceRefId,
    sourceWorkspace: source,
    endpointRole: request.endpointRole,
    contentSelection: operation.contentPolicy.selection,
  };
}

/** Stable canonical definition used to distinguish idempotent duplicates from conflicts. */
function canonicalBootstrapDefinition(request: WorkspaceSyncTargetBootstrapPrepareV1): string {
  const owner = request.owner.kind === 'relationship'
    ? { kind: 'relationship', relationshipId: request.owner.relationshipId }
    : {
      kind: 'copy_once',
      operation: {
        v: request.owner.operation.v,
        operationId: request.owner.operation.operationId,
        controllerMachineId: request.owner.operation.controllerMachineId,
        alphaWorkspaceRefId: request.owner.operation.alphaWorkspaceRefId,
        betaWorkspaceRefId: request.owner.operation.betaWorkspaceRefId,
        contentPolicy: {
          v: request.owner.operation.contentPolicy.v,
          selection: request.owner.operation.contentPolicy.selection,
          extraIgnorePatterns: [...request.owner.operation.contentPolicy.extraIgnorePatterns],
          extraIncludePatterns: [...request.owner.operation.contentPolicy.extraIncludePatterns],
          includeGitDirectory: request.owner.operation.contentPolicy.includeGitDirectory,
          policyDigest: request.owner.operation.contentPolicy.policyDigest,
        },
      },
    };
  return JSON.stringify({
    v: request.v,
    bootstrapOperationId: request.bootstrapOperationId,
    owner,
    targetWorkspaceRefId: request.targetWorkspaceRefId,
    endpointRole: request.endpointRole,
    policyDigest: request.policyDigest,
    createIfMissing: request.createIfMissing,
  });
}

type RetainedBootstrap = Readonly<{
  bootstrapOperationId: string;
  definition: string;
  result: WorkspaceSyncTargetBootstrapPrepareResultV1;
  handle: WorkspaceRootOwnershipHandle;
  relationshipId: string | null;
  operationId: string;
  sourceWorkspaceRefId: string;
  sourceMachineId: string;
  targetWorkspaceRefId: string;
  targetMachineId: string;
  endpointRole: 'alpha' | 'beta';
  renewalTimer: NodeJS.Timeout | null;
}>;

function retainedAuthorityKey(input: Readonly<{
  relationshipId: string | null;
  operationId: string;
  endpointRole: 'alpha' | 'beta';
  targetWorkspaceRefId: string;
}>): string {
  return JSON.stringify(input.relationshipId
    ? ['relationship', input.relationshipId, input.endpointRole, input.targetWorkspaceRefId]
    : ['copy_once', input.operationId, input.endpointRole, input.targetWorkspaceRefId]);
}

function closeListeningServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

export function createWorkspaceSyncTargetAuthority(
  dependencies: WorkspaceSyncTargetAuthorityDependencies,
): WorkspaceSyncTargetAuthority {
  const localMachineId = dependencies.localMachineId.trim();
  if (!localMachineId) throw new TypeError('Workspace sync target authority requires a local machine id');
  const getSnapshot = dependencies.getSettingsSnapshot ?? getActiveAccountSettingsSnapshot;
  const bootstrap = dependencies.bootstrap ?? null;
  const assertStateAvailable = dependencies.assertLegacyStateAvailable ?? (() => undefined);

  // Process-local custody is keyed by stable relationship endpoint authority,
  // not by the handoff request that happened to prepare it. The settings and
  // bootstrap marker remain the restart sources; no runtime id is persisted.
  const retained = new Map<string, RetainedBootstrap>();
  const inFlight = new Map<string, Promise<unknown>>();
  const activeIngresses = new Map<string, Set<() => Promise<void>>>();
  // Matches the daemon-wide 15-second ownership renewal cadence.
  const renewIntervalMs = bootstrap?.ownershipRenewIntervalMs ?? 15_000;

  const exclusive = <T>(id: string, action: () => Promise<T>): Promise<T> => {
    const prior = inFlight.get(id) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(action);
    const registered = next.catch(() => undefined);
    inFlight.set(id, registered);
    void registered.then(() => { if (inFlight.get(id) === registered) inFlight.delete(id); });
    return next;
  };

  const discardRetained = async (authorityKey: string): Promise<void> => {
    const entry = retained.get(authorityKey);
    if (!entry) return;
    retained.delete(authorityKey);
    if (entry.renewalTimer) clearInterval(entry.renewalTimer);
    const ingressClosers = [...(activeIngresses.get(authorityKey) ?? [])];
    activeIngresses.delete(authorityKey);
    await Promise.allSettled(ingressClosers.map(async (close) => await close()));
    await entry.handle.release().catch(() => undefined);
  };

  const startRenewal = (authorityKey: string): void => {
    const entry = retained.get(authorityKey);
    if (!entry || entry.renewalTimer) return;
    const timer = setInterval(() => {
      void (async () => {
        const current = retained.get(authorityKey);
        if (!current) return;
        try {
          await current.handle.renew();
        } catch {
          // Ownership was lost: close every rooted ingress and drop custody so
          // a later duplicate prepare must re-acquire the root for real.
          await discardRetained(authorityKey);
        }
      })();
    }, renewIntervalMs);
    timer.unref?.();
    retained.set(authorityKey, { ...entry, renewalTimer: timer });
  };

  /** A retained relationship fence must survive only while its still-enabled relationship owns the endpoint. */
  const relationshipStillOwnsEndpoint = (
    snapshot: ActiveAccountSettingsSnapshot | null,
    entry: RetainedBootstrap,
  ): boolean => {
    if (!entry.relationshipId) return false;
    const matches = (snapshot?.settings.workspaceSyncRelationshipsV1 ?? []).filter((candidate) => (
      candidate.relationshipId === entry.relationshipId && candidate.enabled
    ));
    if (matches.length !== 1) return false;
    const relationship = matches[0]!;
    const expectedTargetRef = entry.endpointRole === 'alpha'
      ? relationship.alphaWorkspaceRefId
      : relationship.betaWorkspaceRefId;
    const expectedSourceRef = entry.endpointRole === 'alpha'
      ? relationship.betaWorkspaceRefId
      : relationship.alphaWorkspaceRefId;
    const target = resolveWorkspaceRefById(snapshot?.settings.workspaceRefsV1 ?? [], expectedTargetRef);
    const source = resolveWorkspaceRefById(snapshot?.settings.workspaceRefsV1 ?? [], expectedSourceRef);
    return expectedTargetRef === entry.targetWorkspaceRefId
      && expectedSourceRef === entry.sourceWorkspaceRefId
      && target?.machineId.trim() === entry.targetMachineId
      && source?.machineId.trim() === entry.sourceMachineId
      && relationship.contentPolicy.policyDigest === entry.result.policyDigest;
  };

  const rehydrateRelationshipEndpoint = async (input: Readonly<{
    relationship: WorkspaceSyncRelationshipV1;
    endpointRole: 'alpha' | 'beta';
    targetWorkspace: WorkspaceRefV1;
    sourceWorkspace: WorkspaceRefV1;
  }>): Promise<RetainedBootstrap | null> => {
    if (!bootstrap || input.targetWorkspace.machineId.trim() !== localMachineId) return null;
    const authorityKey = retainedAuthorityKey({
      relationshipId: input.relationship.relationshipId,
      operationId: input.relationship.relationshipId,
      endpointRole: input.endpointRole,
      targetWorkspaceRefId: input.targetWorkspace.id,
    });
    return await exclusive(authorityKey, async () => {
      const existing = retained.get(authorityKey);
      if (existing) return existing;
      const prepared = await rehydrateWorkspaceSyncTargetBootstrap({
        rootPath: input.targetWorkspace.rootPath,
        relationshipId: input.relationship.relationshipId,
        endpointRole: input.endpointRole,
        policyDigest: input.relationship.contentPolicy.policyDigest,
        contentSelection: input.relationship.contentPolicy.selection,
        stagingDirectory: bootstrap.stagingDirectory,
        rootOwnershipManager: bootstrap.rootOwnershipManager,
      });
      if (!prepared) return null;
      const bootstrapOperationId = `rehydrated:${input.relationship.relationshipId}:${input.endpointRole}`;
      const result = WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse({
        v: 1,
        bootstrapOperationId,
        targetWorkspaceRefId: input.targetWorkspace.id,
        state: 'ready',
        created: false,
        rootFingerprint: prepared.rootFingerprint,
        policyDigest: prepared.policyDigest,
        manifestDigest: prepared.manifestDigest,
      });
      const entry: RetainedBootstrap = {
        bootstrapOperationId,
        definition: 'rehydrated-from-settings-and-ready-marker',
        result,
        handle: prepared.ownershipHandles[0]!,
        relationshipId: input.relationship.relationshipId,
        operationId: input.relationship.relationshipId,
        sourceWorkspaceRefId: input.sourceWorkspace.id,
        sourceMachineId: input.sourceWorkspace.machineId.trim(),
        targetWorkspaceRefId: input.targetWorkspace.id,
        targetMachineId: input.targetWorkspace.machineId.trim(),
        endpointRole: input.endpointRole,
        renewalTimer: null,
      };
      retained.set(authorityKey, entry);
      startRenewal(authorityKey);
      return retained.get(authorityKey)!;
    });
  };

  const rehydrateIngressOwner = async (facts: Readonly<{
    operationId: string;
    sourceMachineId: string;
    targetMachineId: string;
  }>): Promise<void> => {
    const snapshot = getSnapshot();
    const relationships = (snapshot?.settings.workspaceSyncRelationshipsV1 ?? []).filter((candidate) => (
      candidate.relationshipId === facts.operationId && candidate.enabled
    ));
    if (relationships.length !== 1) return;
    const relationship = relationships[0]!;
    const refs = snapshot?.settings.workspaceRefsV1 ?? [];
    const candidates = (['alpha', 'beta'] as const).flatMap((endpointRole) => {
      const targetRefId = endpointRole === 'alpha' ? relationship.alphaWorkspaceRefId : relationship.betaWorkspaceRefId;
      const sourceRefId = endpointRole === 'alpha' ? relationship.betaWorkspaceRefId : relationship.alphaWorkspaceRefId;
      const targetWorkspace = resolveWorkspaceRefById(refs, targetRefId);
      const sourceWorkspace = resolveWorkspaceRefById(refs, sourceRefId);
      return targetWorkspace && sourceWorkspace
        && targetWorkspace.machineId.trim() === facts.targetMachineId
        && sourceWorkspace.machineId.trim() === facts.sourceMachineId
        ? [{ endpointRole, targetWorkspace, sourceWorkspace }]
        : [];
    });
    if (candidates.length !== 1) return;
    await rehydrateRelationshipEndpoint({ relationship, ...candidates[0]! });
  };

  const assertRetainedRootIdentity = async (input: Readonly<{
    authorityKey: string;
    entry: RetainedBootstrap;
    rootPath: string;
    renew: boolean;
  }>): Promise<string> => {
    if (input.renew) {
      try {
        await input.entry.handle.renew();
      } catch {
        await discardRetained(input.authorityKey);
        throw authorityError('root_changed', 'Workspace sync target root identity changed');
      }
    }
    const canonicalRoot = await realpath(input.rootPath).catch(() => null);
    const rootFingerprint = canonicalRoot
      ? await computeWorkspaceSyncRootFingerprint(canonicalRoot).catch(() => null)
      : null;
    if (canonicalRoot !== input.entry.handle.owner.canonicalRoot
      || rootFingerprint === null
      || rootFingerprint !== input.entry.result.rootFingerprint
      || input.entry.handle.owner.rootFingerprint !== input.entry.result.rootFingerprint) {
      await discardRetained(input.authorityKey);
      throw authorityError('root_changed', 'Workspace sync target root identity changed');
    }
    return canonicalRoot;
  };

  const requireRetainedRelationshipEndpoint = async (input: Readonly<{
    relationship: WorkspaceSyncRelationshipV1;
    workspace: WorkspaceRefV1;
  }>): Promise<Readonly<{
    authorityKey: string;
    entry: RetainedBootstrap;
    canonicalRoot: string;
  }>> => {
    const endpointRole = input.relationship.alphaWorkspaceRefId === input.workspace.id
      ? 'alpha'
      : input.relationship.betaWorkspaceRefId === input.workspace.id
        ? 'beta'
        : null;
    if (!endpointRole) {
      throw authorityError('relationship_not_ready', 'Workspace reference is not owned by the relationship');
    }
    const sourceWorkspaceRefId = endpointRole === 'alpha'
      ? input.relationship.betaWorkspaceRefId
      : input.relationship.alphaWorkspaceRefId;
    const sourceWorkspace = resolveWorkspaceRef(getSnapshot(), sourceWorkspaceRefId);
    const authorityKey = retainedAuthorityKey({
      relationshipId: input.relationship.relationshipId,
      operationId: input.relationship.relationshipId,
      endpointRole,
      targetWorkspaceRefId: input.workspace.id,
    });
    let entry = retained.get(authorityKey) ?? null;
    if (!entry) {
      entry = await rehydrateRelationshipEndpoint({
        relationship: input.relationship,
        endpointRole,
        targetWorkspace: input.workspace,
        sourceWorkspace,
      });
    }
    if (!entry || !relationshipStillOwnsEndpoint(getSnapshot(), entry)) {
      throw authorityError('relationship_not_ready', 'Workspace sync target root is not retained by a ready relationship');
    }
    const canonicalRoot = await assertRetainedRootIdentity({
      authorityKey,
      entry,
      rootPath: input.workspace.rootPath,
      renew: false,
    });
    return { authorityKey, entry, canonicalRoot };
  };

  const assertRetainedRelationshipEndpointCurrent = async (input: Readonly<{
    authorityKey: string;
    entry: RetainedBootstrap;
    workspace: WorkspaceRefV1;
  }>): Promise<void> => {
    if (retained.get(input.authorityKey) !== input.entry
      || !relationshipStillOwnsEndpoint(getSnapshot(), input.entry)) {
      throw authorityError('relationship_not_ready', 'Workspace sync target root is no longer retained by the relationship');
    }
    await assertRetainedRootIdentity({
      authorityKey: input.authorityKey,
      entry: input.entry,
      rootPath: input.workspace.rootPath,
      renew: true,
    });
  };

  const deleteConflictLoserHere = async (
    rawRequest: WorkspaceSyncTargetConflictDeleteV1,
    signal?: AbortSignal,
  ): Promise<void> => {
    assertStateAvailable();
    signal?.throwIfAborted();
    const request = WorkspaceSyncTargetConflictDeleteV1Schema.parse(rawRequest);
    const { relationship, workspace } = resolveOwnedWorkspace(getSnapshot(), request.relationshipId, request.workspaceRefId);
    assertTargetMachine(workspace, localMachineId);
    const retainedEndpoint = await requireRetainedRelationshipEndpoint({ relationship, workspace });
    signal?.throwIfAborted();
    await deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: retainedEndpoint.canonicalRoot,
      relativePath: request.path,
      expectedKind: request.expectedKind,
      ...(request.expectedDigest === undefined ? {} : { expectedDigest: request.expectedDigest }),
      assertCurrentAuthority: async () => await assertRetainedRelationshipEndpointCurrent({
        authorityKey: retainedEndpoint.authorityKey,
        entry: retainedEndpoint.entry,
        workspace,
      }),
    });
  };

  const readFileHere = async (
    rawRequest: WorkspaceSyncTargetFileReadV1,
    signal?: AbortSignal,
  ): Promise<ReadWorkspaceSyncFileResultV1> => {
    assertStateAvailable();
    signal?.throwIfAborted();
    const request = WorkspaceSyncTargetFileReadV1Schema.parse(rawRequest);
    const { workspace } = resolveOwnedWorkspace(getSnapshot(), request.relationshipId, request.workspaceRefId);
    assertTargetMachine(workspace, localMachineId);
    signal?.throwIfAborted();
    return ReadWorkspaceSyncFileResultV1Schema.parse(await readWorkspaceSyncFileAtRoot({
      rootPath: workspace.rootPath,
      relativePath: request.path,
      maxBytes: request.maxBytes,
      ...(request.expectedDigest === undefined ? {} : { expectedDigest: request.expectedDigest }),
    }));
  };

  const authority: WorkspaceSyncTargetAuthority = {
    deleteConflictLoserHere,
    readFileHere,
    deleteConflictLoserAtTarget: async (request) => {
      assertStateAvailable();
      const targetRequest = WorkspaceSyncTargetConflictDeleteV1Schema.parse({
        relationshipId: request.relationshipId,
        workspaceRefId: request.targetWorkspaceRefId,
        path: request.path,
        expectedKind: request.expectedKind,
        ...(request.expectedDigest === undefined ? {} : { expectedDigest: request.expectedDigest }),
      });
      const { workspace } = resolveOwnedWorkspace(getSnapshot(), targetRequest.relationshipId, targetRequest.workspaceRefId);
      assertTargetMachine(workspace, request.targetMachineId);
      if (workspace.machineId.trim() === localMachineId) {
        await deleteConflictLoserHere(targetRequest, request.signal);
        return;
      }
      const result = await dependencies.callMachineRpc({
        machineId: workspace.machineId.trim(),
        method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_CONFLICT_DELETE,
        request: targetRequest,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      assertOkResult(result);
    },
    readFileAtTarget: async (request) => {
      assertStateAvailable();
      const targetRequest = WorkspaceSyncTargetFileReadV1Schema.parse({
        relationshipId: request.relationshipId,
        workspaceRefId: request.targetWorkspaceRefId,
        path: request.path,
        maxBytes: request.maxBytes,
        ...(request.expectedDigest === undefined ? {} : { expectedDigest: request.expectedDigest }),
      });
      const { workspace } = resolveOwnedWorkspace(getSnapshot(), targetRequest.relationshipId, targetRequest.workspaceRefId);
      assertTargetMachine(workspace, request.targetMachineId);
      if (workspace.machineId.trim() === localMachineId) {
        return await readFileHere(targetRequest, request.signal);
      }
      return ReadWorkspaceSyncFileResultV1Schema.parse(await dependencies.callMachineRpc({
        machineId: workspace.machineId.trim(),
        method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_FILE_READ,
        request: targetRequest,
        ...(request.signal ? { signal: request.signal } : {}),
      }));
    },

    prepareBootstrapHere: async (rawRequest, signal) => {
      assertStateAvailable();
      signal?.throwIfAborted();
      const request = WorkspaceSyncTargetBootstrapPrepareV1Schema.parse(rawRequest);
      if (!bootstrap) {
        throw authorityError('workspace_sync_unavailable', 'Workspace sync target bootstrap is unavailable');
      }
      // Resolve the stable settings-owned endpoint before serializing. A new
      // handoff id rebinds this one authority instead of creating a sibling.
      const owner = resolveBootstrapOwner(getSnapshot(), request);
      assertTargetMachine(owner.targetWorkspace, localMachineId);
      const authorityKey = retainedAuthorityKey({
        relationshipId: owner.relationshipId,
        operationId: owner.operationId,
        endpointRole: owner.endpointRole,
        targetWorkspaceRefId: owner.targetWorkspaceRefId,
      });
      const definition = canonicalBootstrapDefinition(request);
      const operationBinding = [...retained.entries()].find(([, entry]) => (
        entry.bootstrapOperationId === request.bootstrapOperationId
      ));
      if (operationBinding
        && (operationBinding[0] !== authorityKey || operationBinding[1].definition !== definition)) {
        throw authorityError('bootstrap_definition_conflict', 'Workspace sync bootstrap operation id already owns a different definition');
      }
      return await exclusive(authorityKey, async () => {
        signal?.throwIfAborted();
        const retainedEntry = retained.get(authorityKey);
        if (retainedEntry) {
          if (retainedEntry.bootstrapOperationId === request.bootstrapOperationId
            && retainedEntry.definition !== definition) {
            throw authorityError('bootstrap_definition_conflict', 'Workspace sync bootstrap operation id already owns a different definition');
          }
          if (retainedEntry.relationshipId !== owner.relationshipId
            || retainedEntry.operationId !== owner.operationId
            || retainedEntry.sourceWorkspaceRefId !== owner.sourceWorkspaceRefId
            || retainedEntry.sourceMachineId !== owner.sourceWorkspace.machineId.trim()
            || retainedEntry.targetWorkspaceRefId !== owner.targetWorkspaceRefId
            || retainedEntry.targetMachineId !== owner.targetWorkspace.machineId.trim()
            || retainedEntry.endpointRole !== owner.endpointRole
            || retainedEntry.result.policyDigest !== request.policyDigest) {
            throw authorityError('bootstrap_definition_conflict', 'Workspace sync target authority conflicts with the current settings owner');
          }
          if (retainedEntry.bootstrapOperationId === request.bootstrapOperationId) return retainedEntry.result;
          const currentRoot = await realpath(owner.targetRootPath).catch(() => null);
          const currentFingerprint = currentRoot
            ? await computeWorkspaceSyncRootFingerprint(currentRoot).catch(() => null)
            : null;
          if (currentRoot !== retainedEntry.handle.owner.canonicalRoot
            || currentFingerprint !== retainedEntry.result.rootFingerprint) {
            await discardRetained(authorityKey);
            throw authorityError('root_changed', 'Workspace sync target root identity changed before handoff rebinding');
          }
          const reboundResult = WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse({
            ...retainedEntry.result,
            bootstrapOperationId: request.bootstrapOperationId,
            created: false,
          });
          retained.set(authorityKey, {
            ...retainedEntry,
            bootstrapOperationId: request.bootstrapOperationId,
            definition,
            result: reboundResult,
          });
          return reboundResult;
        }
        signal?.throwIfAborted();
        const prepared = await workspaceSyncTargetBootstrap({
          rootPath: owner.targetRootPath,
          ...(owner.sourceWorkspace.machineId.trim() === localMachineId
            ? { sourceRootPath: owner.sourceRootPath }
            : {}),
          relationshipId: owner.operationId,
          endpointRole: request.endpointRole,
          policyDigest: request.policyDigest,
          contentSelection: owner.contentSelection,
          approved: true,
          stagingDirectory: bootstrap.stagingDirectory,
          rootOwnershipManager: bootstrap.rootOwnershipManager,
          ...(bootstrap.prepareGitTarget ? { prepareGitTarget: bootstrap.prepareGitTarget } : {}),
          createIfMissing: request.createIfMissing,
          existingTargetChoice: 'use_existing',
        });
        const result = WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse({
          v: 1,
          bootstrapOperationId: request.bootstrapOperationId,
          targetWorkspaceRefId: request.targetWorkspaceRefId,
          state: 'ready',
          created: prepared.created,
          rootFingerprint: prepared.rootFingerprint,
          policyDigest: prepared.policyDigest,
          manifestDigest: prepared.manifestDigest,
        });
        retained.set(authorityKey, {
          bootstrapOperationId: request.bootstrapOperationId,
          definition,
          result,
          handle: prepared.ownershipHandles[0]!,
          relationshipId: owner.relationshipId,
          operationId: owner.operationId,
          sourceWorkspaceRefId: owner.sourceWorkspaceRefId,
          sourceMachineId: owner.sourceWorkspace.machineId.trim(),
          targetWorkspaceRefId: request.targetWorkspaceRefId,
          targetMachineId: owner.targetWorkspace.machineId.trim(),
          endpointRole: owner.endpointRole,
          renewalTimer: null,
        });
        startRenewal(authorityKey);
        return result;
      });
    },

    releaseBootstrapHere: async (rawRequest, signal) => {
      signal?.throwIfAborted();
      const request = WorkspaceSyncTargetBootstrapReleaseV1Schema.parse(rawRequest);
      const match = [...retained.entries()].find(([, entry]) => (
        entry.bootstrapOperationId === request.bootstrapOperationId
      ));
      if (!match) return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse({ ok: true, released: false });
      const [authorityKey] = match;
      return await exclusive(authorityKey, async () => {
        signal?.throwIfAborted();
        const entry = retained.get(authorityKey);
        if (!entry || entry.bootstrapOperationId !== request.bootstrapOperationId) {
          return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse({ ok: true, released: false });
        }
        if (entry.targetWorkspaceRefId !== request.targetWorkspaceRefId) {
          throw authorityError('bootstrap_definition_conflict', 'Workspace sync bootstrap release does not match the retained operation');
        }
        if (entry.relationshipId && relationshipStillOwnsEndpoint(getSnapshot(), entry)) {
          // The persistent relationship still owns this endpoint: its fence
          // must survive abort/copy_committed until the relationship is
          // disabled/terminated or the daemon shuts down.
          return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse({ ok: true, released: false });
        }
        await discardRetained(authorityKey);
        return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse({ ok: true, released: true });
      });
    },

    prepareBootstrapAtTarget: async (request) => {
      assertStateAvailable();
      const wireRequest = WorkspaceSyncTargetBootstrapPrepareV1Schema.parse({
        v: request.v,
        bootstrapOperationId: request.bootstrapOperationId,
        owner: request.owner,
        targetWorkspaceRefId: request.targetWorkspaceRefId,
        endpointRole: request.endpointRole,
        policyDigest: request.policyDigest,
        createIfMissing: request.createIfMissing,
      });
      const workspace = resolveWorkspaceRef(getSnapshot(), wireRequest.targetWorkspaceRefId);
      assertTargetMachine(workspace, request.targetMachineId);
      if (workspace.machineId.trim() === localMachineId) {
        return await authority.prepareBootstrapHere(wireRequest, request.signal);
      }
      return WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse(await dependencies.callMachineRpc({
        machineId: workspace.machineId.trim(),
        method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_PREPARE,
        request: wireRequest,
        ...(request.signal ? { signal: request.signal } : {}),
      }));
    },

    releaseBootstrapAtTarget: async (request) => {
      const wireRequest = WorkspaceSyncTargetBootstrapReleaseV1Schema.parse({
        v: request.v,
        bootstrapOperationId: request.bootstrapOperationId,
        targetWorkspaceRefId: request.targetWorkspaceRefId,
        reason: request.reason,
      });
      const workspace = resolveWorkspaceRef(getSnapshot(), wireRequest.targetWorkspaceRefId);
      assertTargetMachine(workspace, request.targetMachineId);
      if (workspace.machineId.trim() === localMachineId) {
        return await authority.releaseBootstrapHere(wireRequest, request.signal);
      }
      const result: unknown = await dependencies.callMachineRpc({
        machineId: workspace.machineId.trim(),
        method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_BOOTSTRAP_RELEASE,
        request: wireRequest,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      assertResultOk(result);
      return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse(result);
    },

    acquireWorkspaceSyncMachineIngress: async (request) => {
      assertStateAvailable();
      request.signal?.throwIfAborted();
      if (!dependencies.openRootedAgent) {
        throw authorityError('agent_unavailable', 'Verified rooted workspace sync agent is unavailable');
      }
      const facts = {
        operationId: request.operationId.trim(),
        sourceMachineId: request.sourceMachineId.trim(),
        targetMachineId: request.targetMachineId.trim(),
      };
      if (Object.values(facts).some((value) => !value)) {
        throw authorityError('peer_unavailable', 'Workspace sync machine ingress identity is incomplete');
      }
      if (facts.targetMachineId !== localMachineId) {
        throw authorityError('peer_unavailable', 'Workspace sync machine ingress targets another daemon');
      }
      let matches = [...retained.entries()].filter(([, entry]) => (
        entry.operationId === facts.operationId
        && entry.sourceMachineId === facts.sourceMachineId
        && entry.targetMachineId === facts.targetMachineId
      ));
      if (matches.length === 0) {
        await rehydrateIngressOwner(facts);
        matches = [...retained.entries()].filter(([, entry]) => (
          entry.operationId === facts.operationId
          && entry.sourceMachineId === facts.sourceMachineId
          && entry.targetMachineId === facts.targetMachineId
        ));
      }
      if (matches.length !== 1) {
        throw authorityError('peer_unavailable', 'Workspace sync machine ingress is not owned by a ready target');
      }
      const [authorityKey, entry] = matches[0]!;
      const target = resolveWorkspaceRef(getSnapshot(), entry.targetWorkspaceRefId);
      assertTargetMachine(target, localMachineId);
      const currentRoot = await assertRetainedRootIdentity({
        authorityKey,
        entry,
        rootPath: target.rootPath,
        renew: true,
      });

      const agentAbort = new AbortController();
      let closeIngress: (() => Promise<void>) | null = null;
      const abortFromCaller = () => {
        agentAbort.abort(request.signal?.reason);
        if (closeIngress) void closeIngress();
      };
      request.signal?.addEventListener('abort', abortFromCaller, { once: true });
      const agent = await dependencies.openRootedAgent({
        operationId: facts.operationId,
        role: entry.endpointRole,
        workspaceRefId: entry.targetWorkspaceRefId,
        canonicalRoot: currentRoot,
        signal: agentAbort.signal,
      }).catch((error) => {
        request.signal?.removeEventListener('abort', abortFromCaller);
        throw error;
      });
      const server = createServer({ allowHalfOpen: true });
      let accepted: Socket | null = null;
      let closed = false;
      let closePromise: Promise<void> | null = null;
      const close = (): Promise<void> => {
        closePromise ??= (async () => {
          if (closed) return;
          closed = true;
          request.signal?.removeEventListener('abort', abortFromCaller);
          agentAbort.abort();
          accepted?.destroy();
          agent.destroy();
          await closeListeningServer(server);
          const ingressClosers = activeIngresses.get(authorityKey);
          ingressClosers?.delete(close);
          if (ingressClosers?.size === 0) activeIngresses.delete(authorityKey);
        })();
        return closePromise;
      };
      closeIngress = close;
      server.on('connection', (socket) => {
        if (closed || accepted || socket.remoteAddress !== '127.0.0.1') {
          socket.destroy();
          return;
        }
        accepted = socket;
        void closeListeningServer(server);
        socket.setNoDelay(true);
        socket.pipe(agent, { end: false });
        agent.pipe(socket, { end: false });
        socket.once('end', () => agent.end());
        agent.once('end', () => { if (!socket.destroyed) socket.end(); });
        socket.once('error', () => { void close(); });
        socket.once('close', () => { void close(); });
        agent.once('error', () => { void close(); });
        agent.once('close', () => { void close(); });
      });
      try {
        await new Promise<void>((resolveListen, rejectListen) => {
          server.once('error', rejectListen);
          server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
            server.off('error', rejectListen);
            resolveListen();
          });
        });
      } catch (error) {
        await close();
        throw error;
      }
      const address = server.address();
      if (!address || typeof address === 'string' || !Number.isSafeInteger(address.port) || address.port < 1) {
        await close();
        throw authorityError('agent_unavailable', 'Workspace sync loopback ingress did not bind a port');
      }
      if (request.signal?.aborted) {
        await close();
        request.signal.throwIfAborted();
      }
      if (retained.get(authorityKey) !== entry) {
        await close();
        throw authorityError('peer_unavailable', 'Workspace sync target ownership ended before ingress was ready');
      }
      const ingressClosers = activeIngresses.get(authorityKey) ?? new Set<() => Promise<void>>();
      ingressClosers.add(close);
      activeIngresses.set(authorityKey, ingressClosers);
      return Object.freeze({ port: address.port, close });
    },

    reconcileRetainedBootstraps: async () => {
      const snapshot = getSnapshot();
      for (const [authorityKey, entry] of [...retained.entries()]) {
        if (entry.relationshipId && !relationshipStillOwnsEndpoint(snapshot, entry)) {
          await discardRetained(authorityKey);
        }
      }
      if (!snapshot || !bootstrap) return;
      for (const relationship of snapshot.settings.workspaceSyncRelationshipsV1 ?? []) {
        if (!relationship.enabled) continue;
        const alpha = resolveWorkspaceRefById(snapshot.settings.workspaceRefsV1 ?? [], relationship.alphaWorkspaceRefId);
        const beta = resolveWorkspaceRefById(snapshot.settings.workspaceRefsV1 ?? [], relationship.betaWorkspaceRefId);
        if (!alpha || !beta) continue;
        if (alpha.machineId.trim() === localMachineId) {
          await rehydrateRelationshipEndpoint({
            relationship,
            endpointRole: 'alpha',
            targetWorkspace: alpha,
            sourceWorkspace: beta,
          });
        }
        if (beta.machineId.trim() === localMachineId) {
          await rehydrateRelationshipEndpoint({
            relationship,
            endpointRole: 'beta',
            targetWorkspace: beta,
            sourceWorkspace: alpha,
          });
        }
      }
    },

    releaseAllRetainedBootstraps: async () => {
      for (const authorityKey of [...retained.keys()]) {
        await discardRetained(authorityKey);
      }
    },
  };
  return authority;
}
