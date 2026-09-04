import {
  areWorkspaceSyncRelationshipDefinitionsEqual,
  HandoffTargetReplacementApprovalV1Schema,
  HandoffTargetReplacementPreflightResultV1Schema,
  HandoffTargetReplacementPreflightV1Schema,
  ReadWorkspaceSyncFileResultV1Schema,
  WorkspaceSyncTargetBootstrapPrepareResultV1Schema,
  WorkspaceSyncTargetBootstrapPrepareV1Schema,
  WorkspaceSyncTargetBootstrapReleaseResultV1Schema,
  WorkspaceSyncTargetBootstrapReleaseV1Schema,
  WorkspaceSyncTargetConflictDeleteV1Schema,
  WorkspaceSyncTargetFileReadV1Schema,
  type ReadWorkspaceSyncFileResultV1,
  type HandoffTargetReplacementPreflightResultV1,
  type HandoffTargetReplacementPreflightV1,
  type WorkspaceContentPolicyV1,
  type WorkspaceRefV1,
  type WorkspaceSyncCopyOnceV1,
  type WorkspaceSyncRelationshipV1,
  type WorkspaceSyncTargetBootstrapPrepareResultV1,
  type WorkspaceSyncTargetBootstrapPrepareV1,
  type WorkspaceSyncTargetBootstrapReleaseResultV1,
  type WorkspaceSyncTargetBootstrapReleaseV1,
  type WorkspaceSyncTargetConflictDeleteV1,
  type WorkspaceSyncTargetFileReadV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';

import {
  getActiveAccountSettingsSnapshot,
  type ActiveAccountSettingsSnapshot,
} from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveWorkspaceRefById } from '@/settings/accountSettings/workspaceRefsV1';
import { deleteWorkspaceSyncConflictLoserAtRoot } from './workspaceSyncConflicts';
import { readWorkspaceSyncFileAtRoot } from './workspaceSyncFileRead';
import type { WorkspaceSyncOwnedLocalAgent } from './workspaceSyncController';
import { deriveWorkspaceSyncRelationshipId } from './workspaceSyncRelationshipIdentity';
import { computeWorkspaceSyncAbsentRootFingerprint } from './workspaceSyncRootIdentity';
import {
  computeWorkspaceSyncRootFingerprint,
  rehydrateWorkspaceSyncTargetBootstrap,
  workspaceSyncTargetBootstrap,
  type WorkspaceSyncTargetBootstrapInput,
} from './workspaceSyncTargetBootstrap';
import type { WorkspaceRootOwnershipHandle, WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import type { DirectPeerOnDemandTransferScope } from '@/machines/transfer/directPeerTransport';
import type { TransferPayloadSource } from '@/machines/transfer/transferPayloadSource';
import { prepareExistingGitWorkspaceSyncTarget } from './workspaceSyncTargetBootstrap';
import type { WorkspaceExportMaterializationCustody } from '@/scm/workspace/workspaceExportMaterialization';
import {
  createFirstBytesLocalCapability,
  matchesFirstBytesLocalCapability,
  readFirstBytesLocalCapability,
} from '@/daemon/peer/mediation/loopback/firstBytesLocalCapability';

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
export type WorkspaceSyncTargetBootstrapAtTargetResult = WorkspaceSyncTargetBootstrapPrepareResultV1 & Readonly<{
  /**
   * Owner-local custody borrowed by the controller. This is never serialized
   * across the machine RPC boundary; release remains owned by this authority.
   */
  ownershipHandles?: readonly WorkspaceRootOwnershipHandle[];
}>;

export type AcquireWorkspaceSyncMachineIngressRequest = Readonly<{
  operationId: string;
  sourceMachineId: string;
  targetMachineId: string;
  signal?: AbortSignal;
}>;

export type WorkspaceSyncMachineIngress = Readonly<{
  port: number;
  /** One-use local listener capability consumed before any rooted-agent bytes. */
  localCapability: string;
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
  materializeRemoteSeed?: (input: Readonly<{
    operationId: string;
    sourceMachineId: string;
    sourceWorkspaceRefId: string;
    canonicalRoot: string;
    /** Complete bounded selection policy: a seed that drops it loses explicitly included ignored paths. */
    contentPolicy: WorkspaceContentPolicyV1;
    materializationReceiptPath: string;
    originalTargetExists: boolean;
    signal?: AbortSignal;
  }>) => Promise<WorkspaceExportMaterializationCustody>;
  materializeLocalSeed?: (input: Readonly<{
    operationId: string;
    sourcePath: string;
    canonicalRoot: string;
    contentPolicy: WorkspaceContentPolicyV1;
    materializationReceiptPath: string;
    originalTargetExists: boolean;
  }>) => Promise<WorkspaceExportMaterializationCustody>;
}>;

export type WorkspaceSyncTargetAuthority = Readonly<{
  preflightHandoffTargetReplacementHere(request: HandoffTargetReplacementPreflightV1, signal?: AbortSignal): Promise<HandoffTargetReplacementPreflightResultV1>;
  preflightHandoffTargetReplacementAtTarget(request: HandoffTargetReplacementPreflightV1 & Readonly<{ signal?: AbortSignal }>): Promise<HandoffTargetReplacementPreflightResultV1>;
  deleteConflictLoserHere(request: WorkspaceSyncTargetConflictDeleteV1, signal?: AbortSignal): Promise<void>;
  readFileHere(request: WorkspaceSyncTargetFileReadV1, signal?: AbortSignal): Promise<ReadWorkspaceSyncFileResultV1>;
  deleteConflictLoserAtTarget(request: WorkspaceSyncTargetConflictDeleteRequest): Promise<void>;
  readFileAtTarget(request: WorkspaceSyncTargetFileReadRequest): Promise<ReadWorkspaceSyncFileResultV1>;
  prepareBootstrapHere(request: WorkspaceSyncTargetBootstrapPrepareV1, signal?: AbortSignal): Promise<WorkspaceSyncTargetBootstrapPrepareResultV1>;
  releaseBootstrapHere(request: WorkspaceSyncTargetBootstrapReleaseV1, signal?: AbortSignal): Promise<WorkspaceSyncTargetBootstrapReleaseResultV1>;
  prepareBootstrapAtTarget(request: WorkspaceSyncTargetBootstrapPrepareRequest): Promise<WorkspaceSyncTargetBootstrapAtTargetResult>;
  releaseBootstrapAtTarget(request: WorkspaceSyncTargetBootstrapReleaseRequest): Promise<WorkspaceSyncTargetBootstrapReleaseResultV1>;
  acquireWorkspaceSyncMachineIngress(request: AcquireWorkspaceSyncMachineIngressRequest): Promise<WorkspaceSyncMachineIngress>;
  /** Owner-local, non-wire: release retained relationship fences the settings no longer own. */
  reconcileRetainedBootstraps(): Promise<void>;
  /** Owner-local, non-wire: release every retained handle on daemon shutdown. */
  releaseAllRetainedBootstraps(): Promise<void>;
  prepareSourceSeedExport(request: Readonly<{ operationId: string; sourceWorkspaceRefId: string; targetMachineId: string; contentPolicy: WorkspaceContentPolicyV1 }>): Promise<Readonly<{
    payloadSource: TransferPayloadSource;
    onDemandScope: DirectPeerOnDemandTransferScope;
  }>>;
}>;

export type WorkspaceSyncTargetAuthorityDependencies = Readonly<{
  localServerId: string;
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
  }>): Promise<WorkspaceSyncOwnedLocalAgent>;
  /**
   * Derived once from the retired-state inspection at the daemon composition
   * boundary. Throws the exact typed legacy-state code before any local
   * delete/read/bootstrap-prepare mutation, routed target call, or rooted
   * agent ingress. Release/cleanup paths stay available: they never mutate
   * workspace state.
   */
  assertLegacyStateAvailable?: () => void;
  prepareSourceSeedExport?: (input: Readonly<{
    operationId: string;
    sourceWorkspaceRefId: string;
    targetMachineId: string;
    contentPolicy: WorkspaceContentPolicyV1;
  }>) => Promise<Readonly<{ payloadSource: TransferPayloadSource; onDemandScope: DirectPeerOnDemandTransferScope }>>;
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

/**
 * A workspace may name this machine while belonging to another Personal Home.
 * Local target authority exists only for a workspace enrolled through this
 * daemon's current Home; transport reachability is a separate Lane 06 check.
 */
function assertLocalWorkspacePlacement(
  workspace: WorkspaceRefV1,
  localServerId: string,
  localMachineId: string,
): void {
  if (
    !localServerId.trim()
    || workspace.serverId.trim() !== localServerId.trim()
    || !localMachineId.trim()
    || workspace.machineId.trim() !== localMachineId.trim()
  ) {
    throw authorityError(
      'workspace_machine_not_enrolled',
      'Workspace sync target machine is not enrolled in this Home',
    );
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
  contentPolicy: WorkspaceContentPolicyV1;
  relationship: WorkspaceSyncRelationshipV1 | null;
}> {
  const target = resolveWorkspaceRef(snapshot, request.targetWorkspaceRefId);
  if (request.owner.kind === 'relationship') {
    const relationshipId = request.owner.relationshipId;
    const relationships = snapshot?.settings.workspaceSyncRelationshipsV1 ?? [];
    const persistedMatches = relationships.filter((candidate) => (
      candidate.relationshipId === relationshipId && candidate.enabled
    ));
    const transient = request.transientRelationship;
    if (transient) {
      const sameId = relationships.filter((candidate) => candidate.relationshipId === relationshipId);
      if (sameId.length > 1 || (sameId[0] && !areWorkspaceSyncRelationshipDefinitionsEqual(sameId[0], transient))) {
        throw authorityError('bootstrap_definition_conflict', 'Transient relationship conflicts with Account Settings');
      }
    } else if (persistedMatches.length !== 1) {
      throw authorityError('relationship_not_ready', 'Workspace sync relationship is not ready');
    }
    const relationship = transient ?? persistedMatches[0]!;
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
    const controllerMachineId = relationship.controllerMachineId.trim();
    if (relationship.mode !== 'keep_both_in_sync' && request.endpointRole !== 'beta') {
      throw authorityError('bootstrap_definition_conflict', 'One-way workspace sync can bootstrap only its beta endpoint');
    }
    const controllerOwnsRelationship = relationship.mode === 'keep_both_in_sync'
      ? controllerMachineId === source.machineId.trim() || controllerMachineId === target.machineId.trim()
      : controllerMachineId === source.machineId.trim();
    if (!controllerOwnsRelationship) {
      throw authorityError('bootstrap_definition_conflict', 'Workspace sync relationship controller does not own the source endpoint');
    }
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
      contentPolicy: relationship.contentPolicy,
      relationship,
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
    contentPolicy: operation.contentPolicy,
    relationship: null,
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
          policyDigest: request.owner.operation.contentPolicy.policyDigest,
        },
      },
    };
  return JSON.stringify({
    v: request.v,
    bootstrapOperationId: request.bootstrapOperationId,
    owner,
    ...(request.transientRelationship ? { transientRelationship: request.transientRelationship } : {}),
    targetWorkspaceRefId: request.targetWorkspaceRefId,
    endpointRole: request.endpointRole,
    policyDigest: request.policyDigest,
    createIfMissing: request.createIfMissing,
    ...(request.targetBootstrap ? { targetBootstrap: request.targetBootstrap } : {}),
    ...(request.targetReplacementApproval
      ? { targetReplacementApproval: request.targetReplacementApproval }
      : {}),
  });
}

type RetainedBootstrap = Readonly<{
  bootstrapOperationId: string;
  definition: string;
  result: WorkspaceSyncTargetBootstrapPrepareResultV1;
  handle: WorkspaceRootOwnershipHandle;
  materializationCustody?: WorkspaceExportMaterializationCustody;
  relationshipId: string | null;
  operationId: string;
  sourceWorkspaceRefId: string;
  sourceMachineId: string;
  sourceRootPath: string;
  targetWorkspaceRefId: string;
  targetMachineId: string;
  targetRootPath: string;
  endpointRole: 'alpha' | 'beta';
  relationshipDefinition: WorkspaceSyncRelationshipV1 | null;
  createIfMissing: boolean;
}>;

type ResolvedBootstrapOwner = ReturnType<typeof resolveBootstrapOwner>;

function retainedBootstrapMatchesOwner(
  entry: RetainedBootstrap,
  owner: ResolvedBootstrapOwner,
  request: WorkspaceSyncTargetBootstrapPrepareV1,
): boolean {
  return entry.relationshipId === owner.relationshipId
    && entry.operationId === owner.operationId
    && entry.sourceWorkspaceRefId === owner.sourceWorkspaceRefId
    && entry.sourceMachineId === owner.sourceWorkspace.machineId.trim()
    && entry.sourceRootPath === owner.sourceRootPath
    && entry.targetWorkspaceRefId === owner.targetWorkspaceRefId
    && entry.targetMachineId === owner.targetWorkspace.machineId.trim()
    && entry.targetRootPath === owner.targetRootPath
    && entry.endpointRole === owner.endpointRole
    && entry.result.policyDigest === request.policyDigest
    && (entry.relationshipDefinition === null
      ? owner.relationship === null
      : owner.relationship !== null
        && areWorkspaceSyncRelationshipDefinitionsEqual(entry.relationshipDefinition, owner.relationship));
}

/**
 * Relationship creation prepares the target from transient intent, then the
 * same operation re-enters after that exact definition is published to
 * Account Settings. Bootstrap mechanics are intentionally absent on the
 * settings-owned replay; every stable relationship/endpoint fact must still
 * match the retained authority.
 */
function isExactPersistedRelationshipReentry(
  entry: RetainedBootstrap,
  owner: ResolvedBootstrapOwner,
  request: WorkspaceSyncTargetBootstrapPrepareV1,
): boolean {
  return request.owner.kind === 'relationship'
    && request.transientRelationship === undefined
    && request.targetBootstrap === undefined
    && request.targetReplacementApproval === undefined
    && entry.bootstrapOperationId === request.bootstrapOperationId
    && entry.relationshipDefinition !== null
    && entry.createIfMissing === request.createIfMissing
    && retainedBootstrapMatchesOwner(entry, owner, request);
}

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
  const localServerId = dependencies.localServerId.trim();
  if (!localMachineId) throw new TypeError('Workspace sync target authority requires a local machine id');
  if (!localServerId) throw new TypeError('Workspace sync target authority requires a local server id');
  const getSnapshot = dependencies.getSettingsSnapshot ?? getActiveAccountSettingsSnapshot;
  const bootstrap = dependencies.bootstrap ?? null;
  const assertStateAvailable = dependencies.assertLegacyStateAvailable ?? (() => undefined);

  // Process-local custody is keyed by stable relationship endpoint authority,
  // not by the handoff request that happened to prepare it. The settings and
  // bootstrap marker remain the restart sources; no runtime id is persisted.
  const retained = new Map<string, RetainedBootstrap>();
  const inFlight = new Map<string, Promise<unknown>>();
  const activeIngresses = new Map<string, Set<() => Promise<void>>>();

  const exclusive = <T>(id: string, action: () => Promise<T>): Promise<T> => {
    const prior = inFlight.get(id) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(action);
    const registered = next.catch(() => undefined);
    inFlight.set(id, registered);
    void registered.then(() => { if (inFlight.get(id) === registered) inFlight.delete(id); });
    return next;
  };

  const discardRetained = async (
    authorityKey: string,
    outcome: 'commit' | 'abort' = 'abort',
  ): Promise<void> => {
    const entry = retained.get(authorityKey);
    if (!entry) return;
    const cleanupFailures: unknown[] = [];
    let materializationCustodyExternalized = false;
    const ingressClosers = [...(activeIngresses.get(authorityKey) ?? [])];
    const ingressResults = await Promise.allSettled(ingressClosers.map(async (close) => await close()));
    for (const result of ingressResults) {
      if (result.status === 'rejected') cleanupFailures.push(result.reason);
    }
    try {
      if (outcome === 'commit') await entry.materializationCustody?.commit();
      else await entry.materializationCustody?.abort();
    } catch (error) {
      materializationCustodyExternalized = (error as { code?: unknown }).code
        === 'workspace_target_materialization_manual_recovery';
      // The durable receipt is now the sole recovery authority. Keeping this
      // process-local entry would retry a destructive action that has already
      // failed its object-custody proof on every later reconcile/shutdown.
      if (!materializationCustodyExternalized) cleanupFailures.push(error);
    }
    await entry.handle.release().catch((error: unknown) => {
      cleanupFailures.push(error);
    });
    if (cleanupFailures.length === 0 || materializationCustodyExternalized) {
      retained.delete(authorityKey);
      activeIngresses.delete(authorityKey);
      if (cleanupFailures.length === 0) return;
    }
    if (cleanupFailures.length === 1) throw cleanupFailures[0];
    throw new AggregateError(cleanupFailures, 'Workspace sync target authority cleanup failed');
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
      && target?.serverId.trim() === localServerId.trim()
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
    assertLocalWorkspacePlacement(input.targetWorkspace, localServerId, localMachineId);
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
        sourceRootPath: input.sourceWorkspace.rootPath,
        targetWorkspaceRefId: input.targetWorkspace.id,
        targetMachineId: input.targetWorkspace.machineId.trim(),
        targetRootPath: input.targetWorkspace.rootPath,
        endpointRole: input.endpointRole,
        relationshipDefinition: input.relationship,
        createIfMissing: false,
      };
      retained.set(authorityKey, entry);
      return entry;
    });
  };

  const rehydrateCopyOnceEndpoint = async (input: Readonly<{
    request: WorkspaceSyncTargetBootstrapPrepareV1 & Readonly<{ owner: Readonly<{ kind: 'copy_once'; operation: WorkspaceSyncCopyOnceV1 }> }>;
    targetWorkspace: WorkspaceRefV1;
    sourceWorkspace: WorkspaceRefV1;
  }>): Promise<RetainedBootstrap | null> => {
    if (!bootstrap || input.targetWorkspace.machineId.trim() !== localMachineId) return null;
    assertLocalWorkspacePlacement(input.targetWorkspace, localServerId, localMachineId);
    const operation = input.request.owner.operation;
    const authorityKey = retainedAuthorityKey({
      relationshipId: null,
      operationId: operation.operationId,
      endpointRole: 'beta',
      targetWorkspaceRefId: input.targetWorkspace.id,
    });
    return await exclusive(authorityKey, async () => {
      const existing = retained.get(authorityKey);
      if (existing) return existing;
      const prepared = await rehydrateWorkspaceSyncTargetBootstrap({
        rootPath: input.targetWorkspace.rootPath,
        relationshipId: operation.operationId,
        endpointRole: 'beta',
        policyDigest: operation.contentPolicy.policyDigest,
        contentSelection: operation.contentPolicy.selection,
        stagingDirectory: bootstrap.stagingDirectory,
        rootOwnershipManager: bootstrap.rootOwnershipManager,
      });
      if (!prepared) return null;
      const result = WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse({
        v: 1,
        bootstrapOperationId: input.request.bootstrapOperationId,
        targetWorkspaceRefId: input.targetWorkspace.id,
        state: 'ready',
        created: false,
        rootFingerprint: prepared.rootFingerprint,
        policyDigest: prepared.policyDigest,
      });
      const entry: RetainedBootstrap = {
        bootstrapOperationId: input.request.bootstrapOperationId,
        definition: canonicalBootstrapDefinition(input.request),
        result,
        handle: prepared.ownershipHandles[0]!,
        relationshipId: null,
        operationId: operation.operationId,
        sourceWorkspaceRefId: input.sourceWorkspace.id,
        sourceMachineId: input.sourceWorkspace.machineId.trim(),
        sourceRootPath: input.sourceWorkspace.rootPath,
        targetWorkspaceRefId: input.targetWorkspace.id,
        targetMachineId: input.targetWorkspace.machineId.trim(),
        targetRootPath: input.targetWorkspace.rootPath,
        endpointRole: 'beta',
        relationshipDefinition: null,
        createIfMissing: input.request.createIfMissing,
      };
      retained.set(authorityKey, entry);
      return entry;
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
  }>): Promise<string> => {
    try {
      await input.entry.handle.bindCurrentRootIdentity();
    } catch {
      await discardRetained(input.authorityKey);
      throw authorityError('root_changed', 'Workspace sync target root identity changed');
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
    assertLocalWorkspacePlacement(workspace, localServerId, localMachineId);
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
    const { relationship, workspace } = resolveOwnedWorkspace(getSnapshot(), request.relationshipId, request.workspaceRefId);
    assertLocalWorkspacePlacement(workspace, localServerId, localMachineId);
    // Disclosure uses the same retained relationship/root object authority as
    // conflict deletion. A replacement root at the granted pathname is not the
    // root the relationship was granted, so it must yield no bytes.
    const retainedEndpoint = await requireRetainedRelationshipEndpoint({ relationship, workspace });
    signal?.throwIfAborted();
    return ReadWorkspaceSyncFileResultV1Schema.parse(await readWorkspaceSyncFileAtRoot({
      rootPath: retainedEndpoint.canonicalRoot,
      relativePath: request.path,
      maxBytes: request.maxBytes,
      ...(request.expectedDigest === undefined ? {} : { expectedDigest: request.expectedDigest }),
    }));
  };

  const authority: WorkspaceSyncTargetAuthority = {
    preflightHandoffTargetReplacementHere: async (rawRequest, signal) => {
      assertStateAvailable();
      signal?.throwIfAborted();
      const request = HandoffTargetReplacementPreflightV1Schema.parse(rawRequest);
      if (request.serverId !== localServerId || request.machineId !== localMachineId) {
        throw authorityError('target_unavailable', 'Handoff target placement does not match this daemon');
      }
      const requested = normalize(resolve(request.targetPath));
      if (requested === resolve('/')) {
        throw authorityError('workspace_root_unsafe', 'Handoff target root is invalid');
      }
      const before = await lstat(requested).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (before && (!before.isDirectory() || before.isSymbolicLink())) {
        throw authorityError('workspace_root_unsafe', 'Handoff target root must be a real directory');
      }
      const canonicalRoot = before
        ? await realpath(requested)
        : await realpath(dirname(requested))
          .then((parent) => normalize(join(parent, basename(requested))))
          .catch(() => null);
      if (!canonicalRoot || canonicalRoot === resolve('/')) {
        throw authorityError('workspace_root_unsafe', 'Handoff target parent is unavailable');
      }
      if (!bootstrap) throw authorityError('workspace_sync_unavailable', 'Workspace sync bootstrap authority is unavailable');
      const ownership = await bootstrap.rootOwnershipManager.tryAcquire({
        ownerId: request.operationId,
        canonicalRoot,
        operation: 'handoff',
        deferRootIdentityBinding: true,
      });
      if ('kind' in ownership) throw authorityError('workspace_root_in_use', 'Handoff target root overlaps an active operation');
      try {
        signal?.throwIfAborted();
        const current = await lstat(requested).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        });
        if (current && (!current.isDirectory() || current.isSymbolicLink())) {
          throw authorityError('workspace_root_unsafe', 'Handoff target root must be a real directory');
        }
        let replacesNonEmptyTarget = false;
        // An absent root has no object identity to fingerprint; its canonical
        // absence is the fact the approval binds, so a root appearing later
        // fails the replay comparison exactly like a changed root would.
        let rootFingerprint = computeWorkspaceSyncAbsentRootFingerprint(canonicalRoot);
        if (current) {
          const currentCanonicalRoot = await realpath(requested);
          if (currentCanonicalRoot !== canonicalRoot) {
            throw authorityError('root_changed', 'Handoff target root changed during inspection');
          }
          replacesNonEmptyTarget = (await readdir(currentCanonicalRoot)).length > 0;
          await ownership.bindCurrentRootIdentity();
          rootFingerprint = await computeWorkspaceSyncRootFingerprint(currentCanonicalRoot);
        }
        // Exact mirroring authorizes deleting target-only files for the life of
        // the relationship, so it needs the destination confirmation even when
        // there is nothing to replace today. Both consequences of one
        // destination decision travel in one proof.
        const consequences = [
          ...(replacesNonEmptyTarget ? ['replace_nonempty_workspace_target'] as const : []),
          ...(request.activatesExactMirror ? ['delete_target_only_files_during_exact_mirror'] as const : []),
        ];
        if (consequences.length === 0) {
          return HandoffTargetReplacementPreflightResultV1Schema.parse({ type: 'not_required' });
        }
        return HandoffTargetReplacementPreflightResultV1Schema.parse({
          type: 'approval_required',
          approval: HandoffTargetReplacementApprovalV1Schema.parse({
            v: 1,
            consequences,
            serverId: localServerId,
            machineId: localMachineId,
            canonicalRoot,
            rootFingerprint,
            operationId: request.operationId,
          }),
        });
      } finally {
        await ownership.release();
      }
    },

    preflightHandoffTargetReplacementAtTarget: async (request) => {
      const wireRequest = HandoffTargetReplacementPreflightV1Schema.parse(request);
      if (wireRequest.serverId !== localServerId) {
        throw authorityError('target_unavailable', 'Handoff target server does not match this daemon');
      }
      if (wireRequest.machineId === localMachineId) {
        return await authority.preflightHandoffTargetReplacementHere(wireRequest, request.signal);
      }
      return HandoffTargetReplacementPreflightResultV1Schema.parse(await dependencies.callMachineRpc({
        machineId: wireRequest.machineId,
        method: RPC_METHODS.DAEMON_WORKSPACE_SYNC_TARGET_REPLACEMENT_PREFLIGHT,
        request: wireRequest,
        ...(request.signal ? { signal: request.signal } : {}),
      }));
    },

    prepareSourceSeedExport: async (request) => {
      if (!dependencies.prepareSourceSeedExport) {
        throw authorityError('target_bootstrap_offline', 'Workspace sync source seed is unavailable');
      }
      return await dependencies.prepareSourceSeedExport({
        operationId: request.operationId,
        sourceWorkspaceRefId: request.sourceWorkspaceRefId,
        targetMachineId: request.targetMachineId,
        contentPolicy: request.contentPolicy,
      });
    },
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
      assertLocalWorkspacePlacement(owner.targetWorkspace, localServerId, localMachineId);
      // Exact mirroring authorizes deleting target-only files for the life of
      // the relationship. The approval that carries that consequence is only
      // representable alongside source materialization, which is the single
      // path that establishes a mirroring endpoint.
      const activatesExactMirror = owner.relationship?.mode === 'mirror_exactly'
        && request.targetBootstrap === 'materialize_from_source_workspace';
      // This daemon owns local authorization, and its prepare RPC is reachable
      // without the Action wrapper, so the complete binding is proven here
      // before any retained lookup or filesystem work. Canonical root and
      // object identity stay with bootstrap, which inspects the real target.
      if (request.targetReplacementApproval) {
        const approval = request.targetReplacementApproval;
        if (approval.serverId !== localServerId || approval.machineId !== localMachineId) {
          throw authorityError('approval_stale', 'Workspace target replacement approval placement is stale');
        }
        const boundToThisOwner = owner.relationshipId === null
          ? approval.operationId === owner.operationId
          : deriveWorkspaceSyncRelationshipId(approval.operationId) === owner.relationshipId;
        if (!boundToThisOwner) {
          throw authorityError('approval_stale', 'Workspace target replacement approval is stamped for another operation');
        }
        if (approval.consequences.includes('delete_target_only_files_during_exact_mirror') !== activatesExactMirror) {
          throw authorityError('approval_stale', 'Workspace target replacement approval does not match this relationship mode');
        }
      }
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
        && (operationBinding[0] !== authorityKey
          || (operationBinding[1].definition !== definition
            && !isExactPersistedRelationshipReentry(operationBinding[1], owner, request)))) {
        throw authorityError('bootstrap_definition_conflict', 'Workspace sync bootstrap operation id already owns a different definition');
      }
      if (!request.targetBootstrap && !retained.has(authorityKey)) {
        if (!owner.relationship) {
          const rehydrated = request.owner.kind === 'copy_once'
            ? await rehydrateCopyOnceEndpoint({
                request: request as WorkspaceSyncTargetBootstrapPrepareV1 & Readonly<{ owner: Readonly<{ kind: 'copy_once'; operation: WorkspaceSyncCopyOnceV1 }> }>,
                targetWorkspace: owner.targetWorkspace,
                sourceWorkspace: owner.sourceWorkspace,
              })
            : null;
          if (!rehydrated) {
            throw authorityError('target_bootstrap_required', 'Workspace sync target requires an explicit bootstrap choice');
          }
        } else {
          const rehydrated = await rehydrateRelationshipEndpoint({
            relationship: owner.relationship,
            endpointRole: owner.endpointRole,
            targetWorkspace: owner.targetWorkspace,
            sourceWorkspace: owner.sourceWorkspace,
          });
          if (!rehydrated) {
            throw authorityError('target_bootstrap_required', 'Existing workspace relationship has no verified target bootstrap');
          }
        }
      }
      return await exclusive(authorityKey, async () => {
        signal?.throwIfAborted();
        const retainedEntry = retained.get(authorityKey);
        if (retainedEntry) {
          const persistedRelationshipReentry = isExactPersistedRelationshipReentry(retainedEntry, owner, request);
          if (retainedEntry.bootstrapOperationId === request.bootstrapOperationId
            && retainedEntry.definition !== definition
            && !persistedRelationshipReentry) {
            throw authorityError('bootstrap_definition_conflict', 'Workspace sync bootstrap operation id already owns a different definition');
          }
          if (!retainedBootstrapMatchesOwner(retainedEntry, owner, request)) {
            throw authorityError('bootstrap_definition_conflict', 'Workspace sync target authority conflicts with the current settings owner');
          }
          if (retainedEntry.bootstrapOperationId === request.bootstrapOperationId) {
            if (persistedRelationshipReentry) {
              const currentRoot = await realpath(owner.targetRootPath).catch(() => null);
              const currentFingerprint = currentRoot
                ? await computeWorkspaceSyncRootFingerprint(currentRoot).catch(() => null)
                : null;
              if (currentRoot !== retainedEntry.handle.owner.canonicalRoot
                || currentFingerprint !== retainedEntry.result.rootFingerprint) {
                await discardRetained(authorityKey);
                throw authorityError('root_changed', 'Workspace sync target root identity changed before settings reconciliation');
              }
              retained.set(authorityKey, { ...retainedEntry, definition });
            }
            return retainedEntry.result;
          }
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
        const remoteMaterialize = request.targetBootstrap === 'materialize_from_source_workspace'
          && owner.sourceWorkspace.machineId.trim() !== localMachineId
          ? async (canonicalRoot: string, materializationReceiptPath: string, originalTargetExists: boolean): Promise<WorkspaceExportMaterializationCustody> => {
              if (!bootstrap.materializeRemoteSeed) {
                throw authorityError('target_bootstrap_offline', 'Workspace sync source seed is unavailable');
              }
              return await bootstrap.materializeRemoteSeed({
                operationId: owner.operationId,
                sourceMachineId: owner.sourceWorkspace.machineId.trim(),
                sourceWorkspaceRefId: owner.sourceWorkspaceRefId,
                canonicalRoot,
                contentPolicy: owner.contentPolicy,
                materializationReceiptPath,
                originalTargetExists,
                ...(signal ? { signal } : {}),
              });
            }
          : null;
        const localMaterialize = request.targetBootstrap === 'materialize_from_source_workspace'
          && owner.sourceWorkspace.machineId.trim() === localMachineId
          ? async (canonicalRoot: string, materializationReceiptPath: string, originalTargetExists: boolean): Promise<WorkspaceExportMaterializationCustody> => {
              if (!bootstrap.materializeLocalSeed) {
                throw authorityError('target_bootstrap_offline', 'Workspace sync local source seed is unavailable');
              }
              return await bootstrap.materializeLocalSeed({
                operationId: owner.operationId,
                sourcePath: owner.sourceRootPath,
                canonicalRoot,
                contentPolicy: owner.contentPolicy,
                materializationReceiptPath,
                originalTargetExists,
              });
            }
          : null;
        const prepared = await workspaceSyncTargetBootstrap({
          rootPath: owner.targetRootPath,
          ...(owner.sourceWorkspace.machineId.trim() === localMachineId
            ? { sourceRootPath: owner.sourceRootPath }
            : {}),
          relationshipId: owner.operationId,
          endpointRole: request.endpointRole,
          policyDigest: request.policyDigest,
          contentSelection: owner.contentPolicy.selection,
          ...(request.targetReplacementApproval
            ? { targetReplacementApproval: request.targetReplacementApproval }
            : {}),
          activatesExactMirror,
          stagingDirectory: bootstrap.stagingDirectory,
          rootOwnershipManager: bootstrap.rootOwnershipManager,
          ...(owner.contentPolicy.selection === 'git_worktree' && remoteMaterialize
            ? { prepareGitTarget: async ({ canonicalRoot, materializationReceiptPath, targetState }: { canonicalRoot: string; materializationReceiptPath: string; targetState: 'missing' | 'empty' | 'nonempty' }) => {
                const custody = await remoteMaterialize(canonicalRoot, materializationReceiptPath, targetState !== 'missing');
                await prepareExistingGitWorkspaceSyncTarget({ canonicalRoot, targetState: 'nonempty' });
                return custody;
              } }
            : bootstrap.prepareGitTarget ? { prepareGitTarget: bootstrap.prepareGitTarget } : {}),
          ...(owner.contentPolicy.selection === 'all_files' && remoteMaterialize
            ? { materializeSeed: async ({ canonicalRoot, materializationReceiptPath, originalTargetExists }: { canonicalRoot: string; materializationReceiptPath: string; originalTargetExists: boolean }) => await remoteMaterialize(canonicalRoot, materializationReceiptPath, originalTargetExists) }
            : owner.contentPolicy.selection === 'all_files' && localMaterialize
              ? { materializeSeed: async ({ canonicalRoot, materializationReceiptPath, originalTargetExists }: { canonicalRoot: string; materializationReceiptPath: string; originalTargetExists: boolean }) => await localMaterialize(canonicalRoot, materializationReceiptPath, originalTargetExists) }
            : {}),
          createIfMissing: request.createIfMissing,
          targetBootstrap: request.targetBootstrap!,
        });
        const result = WorkspaceSyncTargetBootstrapPrepareResultV1Schema.parse({
          v: 1,
          bootstrapOperationId: request.bootstrapOperationId,
          targetWorkspaceRefId: request.targetWorkspaceRefId,
          state: 'ready',
          created: prepared.created,
          rootFingerprint: prepared.rootFingerprint,
          policyDigest: prepared.policyDigest,
        });
        retained.set(authorityKey, {
          bootstrapOperationId: request.bootstrapOperationId,
          definition,
          result,
          handle: prepared.ownershipHandles[0]!,
          ...(prepared.materializationCustody
            ? { materializationCustody: prepared.materializationCustody }
            : {}),
          relationshipId: owner.relationshipId,
          operationId: owner.operationId,
          sourceWorkspaceRefId: owner.sourceWorkspaceRefId,
          sourceMachineId: owner.sourceWorkspace.machineId.trim(),
          sourceRootPath: owner.sourceRootPath,
          targetWorkspaceRefId: request.targetWorkspaceRefId,
          targetMachineId: owner.targetWorkspace.machineId.trim(),
          targetRootPath: owner.targetRootPath,
          endpointRole: owner.endpointRole,
          relationshipDefinition: owner.relationship,
          createIfMissing: request.createIfMissing,
        });
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
          if (request.reason === 'relationship_committed') {
            await entry.materializationCustody?.commit();
          }
          // The persistent relationship still owns this endpoint: its fence
          // must survive abort/copy_committed until the relationship is
          // disabled/terminated or the daemon shuts down.
          return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse({ ok: true, released: false });
        }
        await discardRetained(authorityKey, request.reason === 'abort' ? 'abort' : 'commit');
        return WorkspaceSyncTargetBootstrapReleaseResultV1Schema.parse({ ok: true, released: true });
      });
    },

    prepareBootstrapAtTarget: async (request) => {
      assertStateAvailable();
      const wireRequest = WorkspaceSyncTargetBootstrapPrepareV1Schema.parse({
        v: request.v,
        bootstrapOperationId: request.bootstrapOperationId,
        owner: request.owner,
        ...(request.transientRelationship ? { transientRelationship: request.transientRelationship } : {}),
        targetWorkspaceRefId: request.targetWorkspaceRefId,
        endpointRole: request.endpointRole,
        policyDigest: request.policyDigest,
        createIfMissing: request.createIfMissing,
        ...(request.targetBootstrap ? { targetBootstrap: request.targetBootstrap } : {}),
        ...(request.targetReplacementApproval
          ? { targetReplacementApproval: request.targetReplacementApproval }
          : {}),
      });
      const workspace = resolveWorkspaceRef(getSnapshot(), wireRequest.targetWorkspaceRefId);
      assertTargetMachine(workspace, request.targetMachineId);
      if (workspace.machineId.trim() === localMachineId) {
        const result = await authority.prepareBootstrapHere(wireRequest, request.signal);
        const retainedEntry = [...retained.values()].find((entry) => (
          entry.bootstrapOperationId === wireRequest.bootstrapOperationId
          && entry.targetWorkspaceRefId === wireRequest.targetWorkspaceRefId
        ));
        if (!retainedEntry) {
          throw authorityError('workspace_root_ownership_lost', 'Workspace sync target custody was not retained');
        }
        return { ...result, ownershipHandles: [retainedEntry.handle] };
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
      assertLocalWorkspacePlacement(target, localServerId, localMachineId);
      const currentRoot = await assertRetainedRootIdentity({
        authorityKey,
        entry,
        rootPath: target.rootPath,
      });

      if ((activeIngresses.get(authorityKey)?.size ?? 0) > 0) {
        throw authorityError('peer_unavailable', 'Workspace sync machine ingress is already active');
      }
      const agentAbort = new AbortController();
      let closeIngress: (() => Promise<void>) | null = null;
      const activeCloser = async (): Promise<void> => {
        agentAbort.abort();
        await closeIngress?.();
      };
      const ingressClosers = activeIngresses.get(authorityKey) ?? new Set<() => Promise<void>>();
      ingressClosers.add(activeCloser);
      activeIngresses.set(authorityKey, ingressClosers);
      // Event-driven cleanup (caller abort, peer socket or rooted-agent stream
      // end) consumes its own close rejection: a rooted agent that fails to
      // stop must not surface as an unhandled rejection in the daemon process.
      // Custody stays with `close`, which resets itself on failure so
      // `activeCloser` and the returned explicit closer can retry it.
      const scheduleClose = () => { void closeIngress?.().catch(() => undefined); };
      const abortFromCaller = () => {
        agentAbort.abort(request.signal?.reason);
        scheduleClose();
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
        ingressClosers.delete(activeCloser);
        if (ingressClosers.size === 0) activeIngresses.delete(authorityKey);
        throw error;
      });
      const server = createServer({ allowHalfOpen: true });
      const localCapability = createFirstBytesLocalCapability();
      const expectedLocalCapability = Buffer.from(localCapability, 'ascii');
      let accepted: Socket | null = null;
      const pendingCapabilitySockets = new Set<Socket>();
      let closed = false;
      let closePromise: Promise<void> | null = null;
      const close = (): Promise<void> => {
        if (closePromise) return closePromise;
        closePromise = (async () => {
          if (!closed) {
            closed = true;
            request.signal?.removeEventListener('abort', abortFromCaller);
            agentAbort.abort();
            for (const socket of pendingCapabilitySockets) socket.destroy();
            pendingCapabilitySockets.clear();
            accepted?.destroy();
            agent.stream.destroy();
            await closeListeningServer(server);
          }
          await agent.stop();
          ingressClosers.delete(activeCloser);
          if (ingressClosers.size === 0) activeIngresses.delete(authorityKey);
        })().catch((error: unknown) => {
          closePromise = null;
          throw error;
        });
        return closePromise;
      };
      closeIngress = close;
      server.on('connection', (socket) => {
        if (closed || accepted || socket.remoteAddress !== '127.0.0.1') {
          socket.destroy();
          return;
        }
        pendingCapabilitySockets.add(socket);
        socket.once('close', () => pendingCapabilitySockets.delete(socket));
        void (async () => {
          let supplied: Buffer;
          try {
            supplied = await readFirstBytesLocalCapability(socket);
          } catch {
            socket.destroy();
            return;
          }
          if (
            closed
            || accepted
            || !matchesFirstBytesLocalCapability(supplied, expectedLocalCapability)
          ) {
            socket.destroy();
            return;
          }
          accepted = socket;
          pendingCapabilitySockets.delete(socket);
          void closeListeningServer(server);
          socket.setNoDelay(true);
          socket.pipe(agent.stream, { end: false });
          agent.stream.pipe(socket, { end: false });
          socket.once('end', () => agent.stream.end());
          agent.stream.once('end', () => { if (!socket.destroyed) socket.end(); });
          socket.once('error', scheduleClose);
          socket.once('close', scheduleClose);
          agent.stream.once('error', scheduleClose);
          agent.stream.once('close', scheduleClose);
          socket.resume();
        })();
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
      return Object.freeze({ port: address.port, localCapability, close });
    },

    reconcileRetainedBootstraps: async () => {
      const snapshot = getSnapshot();
      const rehydrateAfterReconciliation = async (
        input: Parameters<typeof rehydrateRelationshipEndpoint>[0],
      ): Promise<void> => {
        await rehydrateRelationshipEndpoint(input).catch((error: unknown) => {
          const code = (error as { code?: unknown }).code;
          if (code === 'root_changed' || code === 'workspace_target_materialization_manual_recovery') return null;
          throw error;
        });
      };
      for (const [authorityKey, entry] of [...retained.entries()]) {
        if (entry.relationshipId && !relationshipStillOwnsEndpoint(snapshot, entry)) {
          await discardRetained(authorityKey);
          continue;
        }
        if (entry.relationshipId) {
          const workspace = resolveWorkspaceRefById(
            snapshot?.settings.workspaceRefsV1 ?? [],
            entry.targetWorkspaceRefId,
          );
          if (!workspace) {
            await discardRetained(authorityKey);
            continue;
          }
          await assertRetainedRootIdentity({
            authorityKey,
            entry,
            rootPath: workspace.rootPath,
          }).catch(() => undefined);
        }
      }
      if (!snapshot || !bootstrap) return;
      for (const relationship of snapshot.settings.workspaceSyncRelationshipsV1 ?? []) {
        if (!relationship.enabled) continue;
        const alpha = resolveWorkspaceRefById(snapshot.settings.workspaceRefsV1 ?? [], relationship.alphaWorkspaceRefId);
        const beta = resolveWorkspaceRefById(snapshot.settings.workspaceRefsV1 ?? [], relationship.betaWorkspaceRefId);
        if (!alpha || !beta) continue;
        if (alpha.machineId.trim() === localMachineId) {
          await rehydrateAfterReconciliation({
            relationship,
            endpointRole: 'alpha',
            targetWorkspace: alpha,
            sourceWorkspace: beta,
          });
        }
        if (beta.machineId.trim() === localMachineId) {
          await rehydrateAfterReconciliation({
            relationship,
            endpointRole: 'beta',
            targetWorkspace: beta,
            sourceWorkspace: alpha,
          });
        }
      }
    },

    releaseAllRetainedBootstraps: async () => {
      const failures: unknown[] = [];
      for (const authorityKey of [...retained.keys()]) {
        await discardRetained(authorityKey).catch((error: unknown) => { failures.push(error); });
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Workspace sync target authority shutdown failed');
      }
    },
  };
  return authority;
}
