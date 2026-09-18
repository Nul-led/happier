import { areWorkspaceSyncRelationshipDefinitionsEqual, DeleteWorkspaceSyncConflictLoserV1Schema, ReadWorkspaceSyncFileV1Schema, WorkspaceSyncCopyOnceV1Schema, type WorkspaceSyncConflictResolveActionInputV1 } from '@happier-dev/protocol';
import { machineCarrierUnavailableError } from '@/daemon/peer/iroh/machineCarrier';
import { validateWorkspaceSyncRelationship, validateWorkspaceSyncRelationships } from './workspaceSyncSettings';
import { deriveWorkspaceSyncEndpointId } from './transport/workspaceSyncBrokerProtocol';
import {
  connectWorkspaceSyncMachineTunnel,
  type WorkspaceSyncMachineTunnel,
  type WorkspaceSyncMachineTunnelOpenInput,
} from './workspaceSyncMachineCarrierStream';
import type { Duplex } from 'node:stream';
import { realpath } from 'node:fs/promises';
import type { WorkspaceRootOwnershipHandle, WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import { getPathRemainderWithinBase } from '@/session/handoff/paths/sessionHandoffPathNormalization';
import { resolveWorkspaceSyncRelationshipEndpointRoles } from './workspaceSyncRelationshipEndpoints';
import { probeScmExecutableAvailable } from '@/scm/runtime';
import type { DeleteWorkspaceSyncConflictLoserV1, ManagedWorkspaceSync, ReadWorkspaceSyncFileResultV1, ReadWorkspaceSyncFileV1, WorkspaceContentPolicyV1, WorkspaceSyncConflictPageRequestV1, WorkspaceSyncConflictPageV1, WorkspaceSyncCopyOnceV1, WorkspaceSyncRelationshipPreparation, WorkspaceSyncRelationshipV1, WorkspaceSyncStatusV1 } from './workspaceSyncTypes';
import { deleteWorkspaceSyncConflictLoserAtRoot } from './workspaceSyncConflicts';
import { readWorkspaceSyncFileAtRoot } from './workspaceSyncFileRead';

export type WorkspaceSyncResolvedRef = Readonly<{
  serverId?: string;
  machineId: string;
  rootPath: string;
}>;
export type WorkspaceSyncTargetConflictDelete = (input: Readonly<{
  actionReceiptId: string;
  actionInput: WorkspaceSyncConflictResolveActionInputV1;
  relationshipId: string;
  targetMachineId: string;
  targetWorkspaceRefId: string;
  path: string;
  expectedDigest?: string;
  expectedKind: DeleteWorkspaceSyncConflictLoserV1['expectedKind'];
  signal?: AbortSignal;
}>) => Promise<void>;
export type WorkspaceSyncConflictResolutionAuthorizationAssert = (
  actionReceiptId: string,
  actionInput: WorkspaceSyncConflictResolveActionInputV1,
) => Promise<void>;
export type WorkspaceSyncTargetFileRead = (input: Readonly<{
  relationshipId: string;
  targetMachineId: string;
  targetWorkspaceRefId: string;
  path: string;
  expectedDigest?: string;
  maxBytes: number;
  signal?: AbortSignal;
}>) => Promise<ReadWorkspaceSyncFileResultV1>;
export type WorkspaceSyncCopyOnceTargetRecovery = (operation: WorkspaceSyncCopyOnceV1) => Promise<Readonly<{
  release(reason: 'abort' | 'commit'): Promise<void>;
}>>;
/**
 * Composition supplies this through the verified Mutagen artifact plus the
 * managed-child/process-custody owner. It must launch the exact-build agent as
 * `happier-mutagen-agent synchronizer --external --root <canonicalRoot>` without a shell.
 * The Mutagen synchronizer command uses standard input/output implicitly.
 */
export type WorkspaceSyncOwnedLocalAgent = Readonly<{
  stream: Duplex;
  stop(): Promise<void>;
}>;
type ActiveWorkspaceSyncIngress = {
  stream: Duplex;
  stop: () => Promise<void>;
  cleanupAttempt: Promise<void> | null;
  cleanupFailure?: unknown;
};
export type WorkspaceSyncLocalAgentStreamOpen = (input: Readonly<{
  operationId: string;
  role: 'alpha' | 'beta';
  workspaceRefId: string;
  canonicalRoot: string;
  signal?: AbortSignal;
}>) => Promise<WorkspaceSyncOwnedLocalAgent>;
export interface WorkspaceSyncMutagenAdapter {
  discoverCopyOnceRecoveries(signal?: AbortSignal): Promise<readonly WorkspaceSyncCopyOnceV1[]>;
  rehydrate(
    definitions: readonly WorkspaceSyncRelationshipV1[],
    signal?: AbortSignal,
  ): Promise<readonly WorkspaceSyncStatusV1[]>;
  ensure(definition: WorkspaceSyncRelationshipV1, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  copyOnce(input: WorkspaceSyncCopyOnceV1, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  get(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1 | null>;
  list(signal?: AbortSignal): Promise<readonly WorkspaceSyncStatusV1[]>;
  flush(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  pause(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  resume(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  terminate(relationshipId: string, signal?: AbortSignal): Promise<void>;
  listConflicts(request: WorkspaceSyncConflictPageRequestV1, signal?: AbortSignal): Promise<WorkspaceSyncConflictPageV1>;
}
export type WorkspaceSyncControllerOptions = Readonly<{
  adapter: WorkspaceSyncMutagenAdapter;
  lifecycle: Readonly<{ start(): Promise<void>; stop(): Promise<void> }>;
  /** Stable Home/server placement of this daemon's registered Machine. */
  localServerId?: string;
  localMachineId: string;
  resolveWorkspaceRef(id: string): WorkspaceSyncResolvedRef | null | Promise<WorkspaceSyncResolvedRef | null>;
  rootOwnershipManager: WorkspaceRootOwnershipManager;
  resolveRelationshipDefinition?(relationshipId: string): WorkspaceSyncRelationshipV1 | null | Promise<WorkspaceSyncRelationshipV1 | null>;
  prepareRelationshipTarget?(definition: WorkspaceSyncRelationshipV1, signal?: AbortSignal, preparation?: WorkspaceSyncRelationshipPreparation): Promise<Readonly<{
    /** Borrowed custody; its bootstrap/target authority remains the release owner. */
    ownershipHandles?: readonly WorkspaceRootOwnershipHandle[];
  }> | void>;
  recoverCopyOnceTarget?: WorkspaceSyncCopyOnceTargetRecovery;
  openMachineCarrierTunnel?: (
    input: Extract<WorkspaceSyncMachineTunnelOpenInput, { flow: 'workspace_sync' }>,
  ) => Promise<WorkspaceSyncMachineTunnel>;
  openLocalWorkspaceAgentStream?: WorkspaceSyncLocalAgentStreamOpen;
  deleteConflictLoserAtTarget?: WorkspaceSyncTargetConflictDelete;
  readFileAtTarget?: WorkspaceSyncTargetFileRead;
  assertConflictResolutionAuthorized?: WorkspaceSyncConflictResolutionAuthorizationAssert;
  /**
   * Explicit runtime-dependency probe for the `git_worktree` content
   * selection, whose ignore decisions are owned by the persistent Git
   * check-ignore oracle at each endpoint. `all_files` never consults it.
   * Defaults to the canonical SCM command resolution owner.
   */
  probeGitRuntimeDependency?: (signal?: AbortSignal) => Promise<boolean>;
  /**
   * Derived once from the retired-state inspection at the daemon composition
   * boundary. Throws the exact typed legacy-state code when workspace sync
   * must stay disabled; called before any state mutation or engine process
   * action. Subscription registration stays passive and is not gated.
   */
  assertLegacyStateAvailable?: () => void;
  /** Publishes the controller's derived status through the daemon Machine runtime channel. */
  onStatusPublished?: (status: WorkspaceSyncStatusV1) => void;
}>;

function abortIfRequested(signal?: AbortSignal): void { if (signal?.aborted) throw Object.assign(new Error('Workspace sync operation cancelled'), { name: 'AbortError', code: 'cancelled' }); }

function isIndeterminate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'indeterminate';
}

function areCopyOnceDefinitionsEqual(left: WorkspaceSyncCopyOnceV1, right: WorkspaceSyncCopyOnceV1): boolean {
  return left.operationId === right.operationId
    && left.controllerMachineId === right.controllerMachineId
    && left.alphaWorkspaceRefId === right.alphaWorkspaceRefId
    && left.betaWorkspaceRefId === right.betaWorkspaceRefId
    && left.contentPolicy.policyDigest === right.contentPolicy.policyDigest;
}

function areContentPoliciesEqual(left: WorkspaceContentPolicyV1, right: WorkspaceContentPolicyV1): boolean {
  return left.v === right.v
    && left.selection === right.selection
    && left.policyDigest === right.policyDigest
    && left.extraIgnorePatterns.length === right.extraIgnorePatterns.length
    && left.extraIgnorePatterns.every((pattern, index) => pattern === right.extraIgnorePatterns[index])
    && left.extraIncludePatterns.length === right.extraIncludePatterns.length
    && left.extraIncludePatterns.every((pattern, index) => pattern === right.extraIncludePatterns[index]);
}

// The manager exposes status through bounded GET/LIST requests rather than a
// push stream. Keep active relationship subscriptions responsive without
// turning status projection into a continuous manager hot loop.
const WORKSPACE_SYNC_STATUS_OBSERVATION_INTERVAL_MS = 1_000;

function areWorkspaceSyncStatusesEqual(left: WorkspaceSyncStatusV1, right: WorkspaceSyncStatusV1): boolean {
  return left.relationshipId === right.relationshipId
    && left.controllerMachineId === right.controllerMachineId
    && left.state === right.state
    && left.alphaPath === right.alphaPath
    && left.betaPath === right.betaPath
    && left.mode === right.mode
    && left.changedFiles === right.changedFiles
    && left.conflictCount === right.conflictCount
    && left.lastSuccessfulSyncAtMs === right.lastSuccessfulSyncAtMs
    && left.errorCode === right.errorCode;
}

async function waitForStatusObservation(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, WORKSPACE_SYNC_STATUS_OBSERVATION_INTERVAL_MS);
    timer.unref?.();
    signal.addEventListener('abort', finish, { once: true });
  });
}

const requiredAdapterMethods = ['discoverCopyOnceRecoveries', 'rehydrate', 'ensure', 'copyOnce', 'get', 'list', 'flush', 'pause', 'resume', 'terminate', 'listConflicts'] as const;

function assertCompleteAdapter(adapter: WorkspaceSyncMutagenAdapter): void {
  const record = adapter as unknown as Readonly<Record<string, unknown>>;
  const missing = requiredAdapterMethods.find((method) => typeof record[method] !== 'function');
  if (missing) throw Object.assign(new Error(`Workspace sync adapter does not implement ${missing}`), { code: 'workspace_sync_unavailable' });
}

export class WorkspaceSyncController implements ManagedWorkspaceSync {
  private readonly adapter: WorkspaceSyncMutagenAdapter;
  private readonly localServerId: string | null;
  private readonly localMachineId: string;
  private readonly resolveRef: WorkspaceSyncControllerOptions['resolveWorkspaceRef'];
  private readonly lifecycle: WorkspaceSyncControllerOptions['lifecycle'];
  private readonly rootOwnershipManager: WorkspaceRootOwnershipManager;
  private readonly resolveDefinition: NonNullable<WorkspaceSyncControllerOptions['resolveRelationshipDefinition']>;
  private readonly prepareTarget: NonNullable<WorkspaceSyncControllerOptions['prepareRelationshipTarget']>;
  private readonly recoverCopyTarget?: WorkspaceSyncCopyOnceTargetRecovery;
  private readonly openMachineCarrier?: WorkspaceSyncControllerOptions['openMachineCarrierTunnel'];
  private readonly openLocalAgent?: WorkspaceSyncLocalAgentStreamOpen;
  private readonly deleteAtTarget?: WorkspaceSyncTargetConflictDelete;
  private readonly readAtTarget?: WorkspaceSyncTargetFileRead;
  private readonly assertConflictResolutionAuthorized?: WorkspaceSyncConflictResolutionAuthorizationAssert;
  private readonly probeGit: NonNullable<WorkspaceSyncControllerOptions['probeGitRuntimeDependency']>;
  private readonly assertStateAvailable: () => void;
  private readonly onStatusPublished: (status: WorkspaceSyncStatusV1) => void;
  private readonly observePersistentStatus: boolean;
  private readonly definitions = new Map<string, WorkspaceSyncRelationshipV1>();
  /** Prepared Action relationships retained until their matching Settings record is published. */
  private readonly transientDefinitions = new Set<string>();
  private readonly copyOperations = new Map<string, WorkspaceSyncCopyOnceV1>();
  private readonly copyFences = new Map<string, readonly WorkspaceRootOwnershipHandle[]>();
  private readonly copyOwnedFences = new Map<string, readonly WorkspaceRootOwnershipHandle[]>();
  private readonly copyTargetReleases = new Map<string, (reason: 'abort' | 'commit') => Promise<void>>();
  private readonly copyTerminalPending = new Set<string>();
  private readonly pendingRootReleases = new Set<WorkspaceRootOwnershipHandle>();
  private readonly statuses = new Map<string, WorkspaceSyncStatusV1>();
  private readonly fences = new Map<string, Readonly<{
    handles: WorkspaceRootOwnershipHandle[];
    ownedHandles: WorkspaceRootOwnershipHandle[];
  }>>();
  private readonly ownershipLost = new Set<string>();
  private readonly activeIngress = new Map<string, Set<ActiveWorkspaceSyncIngress>>();
  private readonly sourceSeedAuthorizations = new Map<string, Readonly<{
    operation: WorkspaceSyncRelationshipV1 | WorkspaceSyncCopyOnceV1;
    ownershipHandles: readonly WorkspaceRootOwnershipHandle[];
  }>>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, Set<(status: WorkspaceSyncStatusV1) => void>>();
  private readonly statusObservations = new Map<string, Readonly<{
    abort: AbortController;
    task: Promise<void>;
  }>>();
  private shuttingDown = false;

  constructor(options: WorkspaceSyncControllerOptions) { assertCompleteAdapter(options.adapter); this.adapter = options.adapter; this.lifecycle = options.lifecycle; this.localServerId = options.localServerId?.trim() || null; this.localMachineId = options.localMachineId; this.resolveRef = options.resolveWorkspaceRef; this.rootOwnershipManager = options.rootOwnershipManager; this.resolveDefinition = options.resolveRelationshipDefinition ?? (() => null); this.prepareTarget = options.prepareRelationshipTarget ?? (async () => undefined); this.recoverCopyTarget = options.recoverCopyOnceTarget; this.openMachineCarrier = options.openMachineCarrierTunnel; this.openLocalAgent = options.openLocalWorkspaceAgentStream; this.deleteAtTarget = options.deleteConflictLoserAtTarget; this.readAtTarget = options.readFileAtTarget; this.assertConflictResolutionAuthorized = options.assertConflictResolutionAuthorized; this.probeGit = options.probeGitRuntimeDependency ?? (async (signal) => await probeScmExecutableAvailable({ bin: 'git', ...(signal ? { signal } : {}) })); this.assertStateAvailable = options.assertLegacyStateAvailable ?? (() => undefined); this.observePersistentStatus = options.onStatusPublished !== undefined; this.onStatusPublished = options.onStatusPublished ?? (() => undefined); }

  private assertLocalSourcePlacement(ref: WorkspaceSyncResolvedRef | null): asserts ref is WorkspaceSyncResolvedRef {
    const serverMatches = this.localServerId === null || ref?.serverId?.trim() === this.localServerId;
    if (!ref || ref.machineId.trim() !== this.localMachineId.trim() || !serverMatches) {
      throw Object.assign(
        new Error('Workspace sync source machine is not enrolled in this Home'),
        { code: 'workspace_machine_not_enrolled' },
      );
    }
  }

  private async resolveLocalSourceAccess(
    definition: WorkspaceSyncRelationshipV1,
    endpointRole: 'alpha' | 'beta',
  ): Promise<Readonly<{ canonicalRoot: string; assertCurrentAuthority(): Promise<void> }> | null> {
    const [alpha, beta] = await Promise.all([
      this.resolveRef(definition.alphaWorkspaceRefId),
      this.resolveRef(definition.betaWorkspaceRefId),
    ]);
    if (!alpha || !beta) return null;
    const roles = resolveWorkspaceSyncRelationshipEndpointRoles({
      mode: definition.mode,
      controllerMachineId: definition.controllerMachineId,
      alphaMachineId: alpha.machineId,
      betaMachineId: beta.machineId,
    });
    if (roles?.sourceEndpointRole !== endpointRole) return null;
    const source = endpointRole === 'alpha' ? alpha : beta;
    if (source.machineId.trim() !== this.localMachineId.trim()) return null;
    this.assertLocalSourcePlacement(source);
    const canonicalRoot = await realpath(source.rootPath).catch(() => source.rootPath);
    const custody = this.fences.get(definition.relationshipId);
    const sourceHandle = custody?.handles.find((handle) => (
      getPathRemainderWithinBase(handle.owner.canonicalRoot, canonicalRoot) === ''
      && getPathRemainderWithinBase(canonicalRoot, handle.owner.canonicalRoot) === ''
    ));
    if (!custody || !sourceHandle) {
      throw Object.assign(new Error('Workspace sync source root is not retained by the relationship'), {
        code: 'workspace_root_ownership_lost',
      });
    }
    return {
      canonicalRoot: sourceHandle.owner.canonicalRoot,
      assertCurrentAuthority: async () => {
        if (this.definitions.get(definition.relationshipId) !== definition
          || this.fences.get(definition.relationshipId) !== custody
          || this.ownershipLost.has(definition.relationshipId)) {
          throw Object.assign(new Error('Workspace root ownership was lost'), { code: 'workspace_root_ownership_lost' });
        }
        await this.assertRelationshipOwnershipCurrent(definition.relationshipId, sourceHandle);
      },
    };
  }

  /**
   * `git_worktree` selection is owned by Git's persistent check-ignore oracle,
   * so Git is an explicit runtime dependency of that mode. A missing or
   * unusable Git fails closed here, before the relationship or copy operation
   * is accepted and before any target, root custody, or engine work starts.
   */
  private async assertContentSelectionRuntimeDependencies(contentPolicy: WorkspaceContentPolicyV1, signal?: AbortSignal): Promise<void> {
    if (contentPolicy.selection !== 'git_worktree') return;
    if (await this.probeGit(signal)) return;
    throw Object.assign(new Error('Git is unavailable for the git_worktree workspace sync selection'), { code: 'git_selection_unavailable' });
  }

  private enqueue<T>(id: string, signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    abortIfRequested(signal);
    const prior = this.queues.get(id);
    const run = (): Promise<T> => { abortIfRequested(signal); return action(); };
    const next = prior ? prior.catch(() => {}).then(run) : run();
    this.queues.set(id, next);
    void next.then(() => { if (this.queues.get(id) === next) this.queues.delete(id); }, () => { if (this.queues.get(id) === next) this.queues.delete(id); });
    return next;
  }
  private enqueueAll<T>(ids: readonly string[], action: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(ids)].sort();
    const acquire = (index: number): Promise<T> => index >= ordered.length
      ? action()
      : this.enqueue(ordered[index]!, undefined, async () => await acquire(index + 1));
    return acquire(0);
  }
  private publish(status: WorkspaceSyncStatusV1): WorkspaceSyncStatusV1 {
    this.statuses.set(status.relationshipId, status);
    for (const listener of this.listeners.get(status.relationshipId) ?? []) listener(status);
    this.onStatusPublished(status);
    this.reconcileStatusObservation(status.relationshipId);
    return status;
  }

  private shouldObserveStatus(id: string): boolean {
    if (this.shuttingDown) return false;
    if ((this.listeners.get(id)?.size ?? 0) > 0) return true;
    const definition = this.definitions.get(id);
    return this.observePersistentStatus
      && definition?.enabled === true
      && !this.transientDefinitions.has(id);
  }

  private reconcileStatusObservation(id: string): void {
    const current = this.statusObservations.get(id);
    if (!this.shouldObserveStatus(id)) {
      current?.abort.abort();
      return;
    }
    if (current) return;
    const abort = new AbortController();
    const observation = {
      abort,
      task: this.observeStatus(id, abort.signal),
    };
    this.statusObservations.set(id, observation);
    void observation.task.finally(() => {
      if (this.statusObservations.get(id) !== observation) return;
      this.statusObservations.delete(id);
      this.reconcileStatusObservation(id);
    }).catch(() => undefined);
  }

  private async observeStatus(id: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.shouldObserveStatus(id)) {
      try {
        const observed = await this.enqueue(id, signal, async () => {
          if (!this.shouldObserveStatus(id)) return null;
          await this.lifecycle.start();
          return await this.adapter.get(id, signal);
        });
        if (observed && !signal.aborted && this.shouldObserveStatus(id)) {
          const previous = this.statuses.get(id);
          if (!previous || !areWorkspaceSyncStatusesEqual(previous, observed)) this.publish(observed);
        }
      } catch (error) {
        if (signal.aborted || this.shuttingDown || (error instanceof Error && error.name === 'AbortError')) return;
        // Runtime readiness owns engine availability errors. Preserve the
        // last known relationship projection and retry while demand remains.
      }
      if (!signal.aborted && this.shouldObserveStatus(id)) await waitForStatusObservation(signal);
    }
  }

  private async stopAllStatusObservations(): Promise<void> {
    const observations = [...this.statusObservations.values()];
    for (const observation of observations) observation.abort.abort();
    await Promise.all(observations.map(async ({ task }) => await task));
  }
  private async acquireRoots(
    definition: WorkspaceSyncRelationshipV1,
    carriedHandles: readonly WorkspaceRootOwnershipHandle[] = [],
    roles: readonly ('alpha' | 'beta')[] = ['alpha', 'beta'],
  ): Promise<WorkspaceRootOwnershipHandle[]> {
    const candidates: { role: 'alpha' | 'beta'; canonicalRoot: string }[] = [];
    for (const role of roles) {
      const id = role === 'alpha' ? definition.alphaWorkspaceRefId : definition.betaWorkspaceRefId;
      const ref = await this.resolveRef(id);
      if (!ref || ref.machineId !== this.localMachineId) continue;
      const canonicalRoot = await realpath(ref.rootPath).catch(() => ref.rootPath);
      if (carriedHandles.some((handle) => (
        getPathRemainderWithinBase(handle.owner.canonicalRoot, canonicalRoot) === ''
        && getPathRemainderWithinBase(canonicalRoot, handle.owner.canonicalRoot) === ''
      ))) continue;
      candidates.push({ role, canonicalRoot });
    }
    // Same-machine endpoints are fenced in one canonical order, so two
    // relationships naming the same pair in opposite roles still contend for
    // those roots in the same sequence.
    candidates.sort((left, right) => (
      left.canonicalRoot < right.canonicalRoot ? -1 : left.canonicalRoot > right.canonicalRoot ? 1 : 0
    ));
    const handles: WorkspaceRootOwnershipHandle[] = [];
    try {
      for (const { role, canonicalRoot } of candidates) {
        const result = await this.rootOwnershipManager.tryAcquire({ ownerId: definition.relationshipId, canonicalRoot, operation: 'sync' });
        if ('kind' in result) throw Object.assign(new Error('Workspace root is already in use'), { code: 'workspace_root_in_use', existing: result.existing, role });
        handles.push(result);
      }
      return handles;
    } catch (error) {
      await this.releaseRootHandles(handles);
      throw error;
    }
  }
  /**
   * Target preparation reads, packages and materializes the source workspace,
   * so the controller-local source root must already be fenced when it runs.
   * The handle is carried into the remaining acquisition instead of being taken
   * twice, because the root owner rejects an exact re-acquisition.
   */
  private async acquireSourceRoots(definition: WorkspaceSyncRelationshipV1): Promise<WorkspaceRootOwnershipHandle[]> {
    const [alpha, beta] = await Promise.all([
      this.resolveRef(definition.alphaWorkspaceRefId),
      this.resolveRef(definition.betaWorkspaceRefId),
    ]);
    if (!alpha || !beta) return [];
    const roles = resolveWorkspaceSyncRelationshipEndpointRoles({
      mode: definition.mode,
      controllerMachineId: definition.controllerMachineId,
      alphaMachineId: alpha.machineId,
      betaMachineId: beta.machineId,
    });
    // An unresolvable direction is target preparation's typed error to raise.
    if (!roles) return [];
    this.assertLocalSourcePlacement(roles.sourceEndpointRole === 'alpha' ? alpha : beta);
    return await this.acquireRoots(definition, [], [roles.sourceEndpointRole]);
  }
  private async releaseRootHandles(handles: readonly WorkspaceRootOwnershipHandle[]): Promise<void> {
    const uniqueHandles = [...new Set(handles)];
    for (const handle of uniqueHandles) this.pendingRootReleases.add(handle);
    const results = await Promise.allSettled(uniqueHandles.map(async (handle) => {
      await handle.release();
      this.pendingRootReleases.delete(handle);
    }));
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Workspace root custody cleanup failed');
  }
  private async assertRelationshipOwnershipCurrent(
    id: string,
    finalHandle?: WorkspaceRootOwnershipHandle,
  ): Promise<void> {
    const custody = this.fences.get(id);
    const handles = custody?.handles ?? [];
    try {
      const retainedFinalHandle = finalHandle && handles.includes(finalHandle) ? finalHandle : undefined;
      await Promise.all(handles
        .filter((handle) => handle !== retainedFinalHandle)
        .map((handle) => handle.bindCurrentRootIdentity()));
      await retainedFinalHandle?.bindCurrentRootIdentity();
    } catch {
      this.ownershipLost.add(id);
      await this.closeActiveIngress(id);
      let paused: WorkspaceSyncStatusV1 | undefined;
      try {
        paused = await this.adapter.pause(id);
      } catch {
        const previous = this.statuses.get(id);
        if (previous) this.publish({ ...previous, state: 'error', errorCode: 'workspace_root_ownership_lost' });
      } finally {
        if (this.fences.get(id) === custody) await this.releaseRelationshipOwnership(id);
        else await this.releaseRootHandles(custody?.ownedHandles ?? []);
      }
      if (paused) this.publish({ ...paused, state: 'paused', errorCode: 'workspace_root_ownership_lost' });
      throw Object.assign(new Error('Workspace root ownership was lost'), { code: 'workspace_root_ownership_lost' });
    }
  }
  private async releaseRelationshipOwnership(id: string): Promise<void> {
    const custody = this.fences.get(id);
    await this.releaseRootHandles(custody?.ownedHandles ?? []);
    if (this.fences.get(id) === custody) this.fences.delete(id);
  }
  private async closeActiveIngress(id: string): Promise<void> {
    const entries = [...this.activeIngress.get(id) ?? []];
    for (const entry of entries) entry.stream.destroy();
    const results = await Promise.allSettled(entries.map(async (entry) => {
      await this.settleOwnedIngress(id, entry);
    }));
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Workspace sync ingress cleanup failed');
  }
  private trackOwnedIngress(
    id: string,
    owned: WorkspaceSyncOwnedLocalAgent,
  ): Duplex {
    const entries = this.activeIngress.get(id) ?? new Set();
    const entry: ActiveWorkspaceSyncIngress = {
      stream: owned.stream,
      stop: owned.stop,
      cleanupAttempt: null,
    };
    entries.add(entry);
    this.activeIngress.set(id, entries);
    owned.stream.once('close', () => {
      const cleanup = this.settleOwnedIngress(id, entry);
      void cleanup.then(undefined, (error: unknown) => {
        // The controller remains the owner after event-driven cleanup fails.
        // A concurrent terminate observes this same rejection, while a later
        // terminate/shutdown retries the retained entry.
        entry.cleanupFailure = error;
      });
    });
    return owned.stream;
  }
  private async settleOwnedIngress(
    id: string,
    entry: ActiveWorkspaceSyncIngress,
  ): Promise<void> {
    if (entry.cleanupAttempt) return await entry.cleanupAttempt;
    const attempt = entry.stop().then(() => {
      const entries = this.activeIngress.get(id);
      entries?.delete(entry);
      if (entries?.size === 0) this.activeIngress.delete(id);
    });
    entry.cleanupAttempt = attempt;
    try {
      await attempt;
    } catch (error) {
      if (entry.cleanupAttempt === attempt) entry.cleanupAttempt = null;
      throw error;
    }
  }
  private async releaseCopyOperation(id: string): Promise<void> {
    const handles = this.copyOwnedFences.get(id) ?? [];
    await this.releaseRootHandles(handles);
    this.copyOwnedFences.delete(id);
    this.copyFences.delete(id);
    this.copyOperations.delete(id);
  }
  private async settleRecoveredCopyOperation(id: string, reason: 'abort' | 'commit'): Promise<void> {
    const releaseTarget = this.copyTargetReleases.get(id);
    if (releaseTarget) {
      await releaseTarget(reason);
      this.copyTargetReleases.delete(id);
    }
    await this.releaseCopyOperation(id);
  }
  private async recoverCopyOnce(operation: WorkspaceSyncCopyOnceV1): Promise<WorkspaceSyncStatusV1 | null> {
    const valid = WorkspaceSyncCopyOnceV1Schema.parse(operation);
    if (this.copyTerminalPending.has(valid.operationId)) {
      try {
        await this.settleRecoveredCopyOperation(valid.operationId, 'commit');
        this.copyTerminalPending.delete(valid.operationId);
        return null;
      } catch (cleanupError) {
        throw Object.assign(new Error('Workspace copy completed but terminal recovery cleanup is pending'), {
          code: 'indeterminate', cleanupError,
        });
      }
    }
    await this.assertContentSelectionRuntimeDependencies(valid.contentPolicy);
    const [alpha, beta] = await Promise.all([
      this.resolveRef(valid.alphaWorkspaceRefId),
      this.resolveRef(valid.betaWorkspaceRefId),
    ]);
    if (valid.controllerMachineId !== this.localMachineId || !alpha || !beta
      || alpha.machineId !== this.localMachineId) {
      await this.adapter.terminate(valid.operationId);
      return null;
    }
    const retained = this.copyOperations.get(valid.operationId);
    if (retained && !areCopyOnceDefinitionsEqual(retained, valid)) {
      await this.adapter.terminate(valid.operationId);
      return null;
    }
    if (!retained) {
      const acquired = await this.acquireRoots({
        v: 1, relationshipId: valid.operationId, controllerMachineId: valid.controllerMachineId,
        alphaWorkspaceRefId: valid.alphaWorkspaceRefId, betaWorkspaceRefId: valid.betaWorkspaceRefId,
        mode: 'keep_synced', contentPolicy: valid.contentPolicy, enabled: true, createdAtMs: 0, updatedAtMs: 0,
      });
      this.copyOperations.set(valid.operationId, valid);
      this.copyFences.set(valid.operationId, acquired);
      this.copyOwnedFences.set(valid.operationId, acquired);
      try {
        if (beta.machineId !== this.localMachineId) {
          if (!this.recoverCopyTarget) throw Object.assign(new Error('Workspace copy target recovery is unavailable'), { code: 'peer_unavailable' });
          const target = await this.recoverCopyTarget(valid);
          this.copyTargetReleases.set(valid.operationId, target.release);
        }
      } catch (error) {
        try {
          await this.adapter.terminate(valid.operationId);
          await this.settleRecoveredCopyOperation(valid.operationId, 'abort');
        } catch (cleanupError) {
          throw Object.assign(new Error('Workspace copy recovery cleanup is pending'), { code: 'indeterminate', cause: error, cleanupError });
        }
        return null;
      }
    }
    try {
      await Promise.all((this.copyFences.get(valid.operationId) ?? []).map((handle) => handle.bindCurrentRootIdentity()));
      const result = this.publish(await this.adapter.copyOnce(valid));
      this.copyTerminalPending.add(valid.operationId);
      try {
        await this.settleRecoveredCopyOperation(valid.operationId, 'commit');
        this.copyTerminalPending.delete(valid.operationId);
      } catch (cleanupError) {
        throw Object.assign(new Error('Workspace copy completed but terminal recovery cleanup is pending'), {
          code: 'indeterminate', cleanupError,
        });
      }
      return result;
    } catch (error) {
      if (!isIndeterminate(error)) {
        try {
          await this.settleRecoveredCopyOperation(valid.operationId, 'abort');
        } catch (cleanupError) {
          throw Object.assign(new Error('Workspace copy failed but terminal recovery cleanup is pending'), {
            code: 'indeterminate', cause: error, cleanupError,
          });
        }
      }
      throw error;
    }
  }
  private async ensureWithinQueue(
    valid: WorkspaceSyncRelationshipV1,
    signal?: AbortSignal,
    preparation?: WorkspaceSyncRelationshipPreparation,
  ): Promise<WorkspaceSyncStatusV1> {
    if (valid.controllerMachineId !== this.localMachineId) {
      throw Object.assign(new Error('Workspace sync controller machine is unavailable'), { code: 'controller_unavailable' });
    }
    const previous = this.definitions.get(valid.relationshipId);
    const recoveringOwnership = previous !== undefined && this.ownershipLost.has(valid.relationshipId);
    const needsOwnership = !previous || recoveringOwnership || !this.fences.has(valid.relationshipId);
    if (previous && !areWorkspaceSyncRelationshipDefinitionsEqual(previous, valid)) {
      throw Object.assign(new Error('Workspace sync relationship definition conflicts with active relationship'), { code: 'relationship_definition_conflict' });
    }
    await this.assertContentSelectionRuntimeDependencies(valid.contentPolicy, signal);
    let acquiredHandles: WorkspaceRootOwnershipHandle[] | undefined;
    let sourceHandles: WorkspaceRootOwnershipHandle[] = [];
    try {
      if (needsOwnership) {
        sourceHandles = await this.acquireSourceRoots(valid);
      }
      const targetPreparation = await this.withSourceSeedAuthorization(valid, sourceHandles, async () => (
        await this.prepareTarget(valid, signal, preparation)
      ));
      const carriedHandles = [...sourceHandles, ...(targetPreparation?.ownershipHandles ?? [])];
      if (needsOwnership) {
        acquiredHandles = await this.acquireRoots(valid, carriedHandles);
        this.fences.set(valid.relationshipId, {
          handles: [...carriedHandles, ...acquiredHandles],
          ownedHandles: [...sourceHandles, ...acquiredHandles],
        });
      }
      await this.lifecycle.start();
      if (!previous) this.definitions.set(valid.relationshipId, valid);
      await this.assertRelationshipOwnershipCurrent(valid.relationshipId);
      const status = await this.adapter.ensure(
        !valid.enabled && preparation?.transient ? { ...valid, enabled: true } : valid,
        signal,
      );
      if (preparation?.transient) this.transientDefinitions.add(valid.relationshipId);
      else this.transientDefinitions.delete(valid.relationshipId);
      this.ownershipLost.delete(valid.relationshipId);
      return this.publish(status);
    } catch (error) {
      if (needsOwnership) {
        if (!previous) this.definitions.delete(valid.relationshipId);
        if (!previous) this.transientDefinitions.delete(valid.relationshipId);
        await this.releaseRootHandles([...sourceHandles, ...(acquiredHandles ?? [])]);
        this.fences.delete(valid.relationshipId);
      }
      throw error;
    }
  }
  async get(id: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1 | null> { this.assertStateAvailable(); abortIfRequested(signal); await this.lifecycle.start(); return await this.adapter.get(id, signal); }
  async list(signal?: AbortSignal): Promise<readonly WorkspaceSyncStatusV1[]> { this.assertStateAvailable(); abortIfRequested(signal); await this.lifecycle.start(); return await this.adapter.list(signal); }
  async ensure(definition: WorkspaceSyncRelationshipV1, signal?: AbortSignal, preparation?: WorkspaceSyncRelationshipPreparation): Promise<WorkspaceSyncStatusV1> {
    this.assertStateAvailable();
    const valid = validateWorkspaceSyncRelationship(definition);
    return this.enqueue(valid.relationshipId, signal, async () => await this.ensureWithinQueue(valid, signal, preparation));
  }
  async copyOnce(input: WorkspaceSyncCopyOnceV1, signal?: AbortSignal, ownershipHandles?: readonly WorkspaceRootOwnershipHandle[]): Promise<WorkspaceSyncStatusV1> {
    this.assertStateAvailable();
    const valid = WorkspaceSyncCopyOnceV1Schema.parse(input);
    return this.enqueue(valid.operationId, signal, async () => {
      if (valid.controllerMachineId !== this.localMachineId) {
        throw Object.assign(new Error('Workspace sync controller machine is unavailable'), { code: 'controller_unavailable' });
      }
      const retained = this.copyOperations.get(valid.operationId);
      if (retained && !areCopyOnceDefinitionsEqual(retained, valid)) {
        throw Object.assign(new Error('Workspace copy operation definition conflicts with active operation'), { code: 'relationship_definition_conflict' });
      }
      await this.assertContentSelectionRuntimeDependencies(valid.contentPolicy, signal);
      const source = await this.resolveRef(valid.alphaWorkspaceRefId);
      this.assertLocalSourcePlacement(source);
      const acquiredHandles = retained ? [] : await this.acquireRoots({
          v: 1, relationshipId: valid.operationId, controllerMachineId: valid.controllerMachineId,
          alphaWorkspaceRefId: valid.alphaWorkspaceRefId, betaWorkspaceRefId: valid.betaWorkspaceRefId,
          mode: 'keep_synced', contentPolicy: valid.contentPolicy, enabled: true, createdAtMs: 0, updatedAtMs: 0,
        }, ownershipHandles);
      const handles = retained
        ? this.copyFences.get(valid.operationId) ?? []
        : [...(ownershipHandles ?? []), ...acquiredHandles];
      if (!retained) {
        this.copyOperations.set(valid.operationId, valid);
        this.copyFences.set(valid.operationId, handles);
        this.copyOwnedFences.set(valid.operationId, acquiredHandles);
      }
      try {
        await this.lifecycle.start();
        try {
          await Promise.all(handles.map((handle) => handle.bindCurrentRootIdentity()));
        } catch {
          await this.closeActiveIngress(valid.operationId);
          if (retained) {
            try {
              await this.adapter.terminate(valid.operationId, signal);
            } catch (cleanupError) {
              throw Object.assign(new Error('Workspace copy ownership was lost and terminal cleanup is pending'), {
                code: 'indeterminate', cleanupError,
              });
            }
          }
          await this.releaseCopyOperation(valid.operationId);
          throw Object.assign(new Error('Workspace root ownership was lost'), { code: 'workspace_root_ownership_lost' });
        }
        const result = this.publish(await this.adapter.copyOnce(valid, signal));
        await this.releaseCopyOperation(valid.operationId);
        return result;
      } catch (error) {
        if (!isIndeterminate(error)) await this.releaseCopyOperation(valid.operationId);
        throw error;
      }
    });
  }
  async flush(id: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> { return this.enqueue(id, signal, async () => {
    this.assertStateAvailable();
    if (this.ownershipLost.has(id)) throw Object.assign(new Error('Workspace root ownership was lost'), { code: 'workspace_root_ownership_lost' });
    if (!this.definitions.has(id)) {
      const definition = await this.resolveDefinition(id);
      if (!definition) throw Object.assign(new Error('Workspace sync relationship is not ready'), { code: 'relationship_not_ready' });
      await this.ensureWithinQueue(validateWorkspaceSyncRelationship(definition), signal);
    }
    await this.lifecycle.start();
    await this.assertRelationshipOwnershipCurrent(id);
    return this.publish(await this.adapter.flush(id, signal));
  }); }
  async pause(id: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> { return this.enqueue(id, signal, async () => { this.assertStateAvailable(); await this.lifecycle.start(); return this.publish(await this.adapter.pause(id, signal)); }); }
  async resume(id: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> { return this.enqueue(id, signal, async () => {
    this.assertStateAvailable();
    if (this.ownershipLost.has(id)) {
      const definition = this.definitions.get(id) ?? await this.resolveDefinition(id);
      if (!definition) throw Object.assign(new Error('Workspace sync relationship is not ready'), { code: 'relationship_not_ready' });
      return await this.ensureWithinQueue(validateWorkspaceSyncRelationship(definition), signal);
    }
    await this.lifecycle.start();
    await this.assertRelationshipOwnershipCurrent(id);
    return this.publish(await this.adapter.resume(id, signal));
  }); }
  async terminate(id: string, signal?: AbortSignal): Promise<void> { return this.enqueue(id, signal, async () => {
    this.assertStateAvailable();
    await this.lifecycle.start();
    const previousStatus = this.statuses.get(id) ?? await this.adapter.get(id, signal);
    await this.adapter.terminate(id, signal);
    await this.closeActiveIngress(id);
    if (this.copyOperations.has(id)) {
      if (this.copyTargetReleases.has(id)) await this.settleRecoveredCopyOperation(id, 'abort');
      else await this.releaseCopyOperation(id);
      this.copyTerminalPending.delete(id);
    } else {
      await this.releaseRelationshipOwnership(id);
      this.ownershipLost.delete(id);
      this.definitions.delete(id);
      this.transientDefinitions.delete(id);
      this.statuses.delete(id);
    }
    if (previousStatus) this.publish({ ...previousStatus, state: 'stopped', changedFiles: 0 });
  }); }
  async listConflicts(request: WorkspaceSyncConflictPageRequestV1, signal?: AbortSignal): Promise<WorkspaceSyncConflictPageV1> { this.assertStateAvailable(); abortIfRequested(signal); await this.lifecycle.start(); return await this.adapter.listConflicts(request, signal); }
  async deleteConflictLoser(request: DeleteWorkspaceSyncConflictLoserV1, signal?: AbortSignal, actionReceiptId?: string): Promise<WorkspaceSyncStatusV1> {
    this.assertStateAvailable();
    const valid = DeleteWorkspaceSyncConflictLoserV1Schema.parse(request);
    if (!actionReceiptId?.trim()) {
      throw Object.assign(new Error('Confirmed workspace conflict Action receipt is required'), { code: 'approval_required' });
    }
    return this.enqueue(valid.relationshipId, signal, async () => {
      if (this.ownershipLost.has(valid.relationshipId)) throw Object.assign(new Error('Workspace root ownership was lost'), { code: 'workspace_root_ownership_lost' });
      const definition = this.definitions.get(valid.relationshipId);
      if (!definition) throw Object.assign(new Error('Workspace sync relationship is not ready'), { code: 'relationship_not_ready' });
      const losingRole = valid.keep === 'alpha' ? 'beta' : 'alpha';
      const losingRefId = valid.keep === 'alpha' ? definition.betaWorkspaceRefId : definition.alphaWorkspaceRefId;
      const target = await this.resolveRef(losingRefId);
      if (!target) throw Object.assign(new Error('Workspace sync conflict target is unavailable'), { code: 'peer_unavailable' });
      await this.lifecycle.start();
      await this.assertRelationshipOwnershipCurrent(valid.relationshipId);
      const actionInput: WorkspaceSyncConflictResolveActionInputV1 = {
        controllerMachineId: this.localMachineId,
        request: valid,
      };
      const localSource = await this.resolveLocalSourceAccess(definition, losingRole);
      if (localSource) {
        const assertConflictResolutionAuthorized = this.assertConflictResolutionAuthorized;
        if (!assertConflictResolutionAuthorized) {
          throw Object.assign(new Error('Workspace conflict Action receipt authority is unavailable'), { code: 'approval_required' });
        }
        await deleteWorkspaceSyncConflictLoserAtRoot({
          rootPath: localSource.canonicalRoot,
          relativePath: valid.path,
          expectedKind: valid.expectedKind,
          ...(valid.expectedDigest === undefined ? {} : { expectedDigest: valid.expectedDigest }),
          assertCurrentAuthority: async () => {
            await assertConflictResolutionAuthorized(actionReceiptId, actionInput);
            await localSource.assertCurrentAuthority();
          },
        });
        return this.publish(await this.adapter.flush(valid.relationshipId, signal));
      }
      if (!this.deleteAtTarget) {
        throw Object.assign(new Error('Authenticated target conflict resolution is unavailable'), { code: 'agent_unavailable' });
      }
      await this.deleteAtTarget({
        actionReceiptId,
        actionInput,
        relationshipId: valid.relationshipId,
        targetMachineId: target.machineId,
        targetWorkspaceRefId: losingRefId,
        path: valid.path,
        expectedKind: valid.expectedKind,
        ...(valid.expectedDigest === undefined ? {} : { expectedDigest: valid.expectedDigest }),
        signal,
      });
      return this.publish(await this.adapter.flush(valid.relationshipId, signal));
    });
  }
  async readFile(request: ReadWorkspaceSyncFileV1, signal?: AbortSignal): Promise<ReadWorkspaceSyncFileResultV1> {
    this.assertStateAvailable();
    abortIfRequested(signal);
    const valid = ReadWorkspaceSyncFileV1Schema.parse(request);
    const definition = this.definitions.get(valid.relationshipId);
    if (!definition) throw Object.assign(new Error('Workspace sync relationship is not ready'), { code: 'relationship_not_ready' });
    const localSource = await this.resolveLocalSourceAccess(definition, valid.side);
    if (localSource) {
      return await this.enqueue(valid.relationshipId, signal, async () => {
        const currentDefinition = this.definitions.get(valid.relationshipId);
        if (!currentDefinition) throw Object.assign(new Error('Workspace sync relationship is not ready'), { code: 'relationship_not_ready' });
        const currentLocalSource = await this.resolveLocalSourceAccess(currentDefinition, valid.side);
        if (!currentLocalSource) {
          throw Object.assign(new Error('Workspace sync source endpoint is no longer local'), { code: 'relationship_not_ready' });
        }
        return await readWorkspaceSyncFileAtRoot({
          rootPath: currentLocalSource.canonicalRoot,
          relativePath: valid.path,
          ...(valid.expectedDigest === undefined ? {} : { expectedDigest: valid.expectedDigest }),
          maxBytes: valid.maxBytes,
          assertCurrentAuthority: currentLocalSource.assertCurrentAuthority,
        });
      });
    }
    if (!this.readAtTarget) throw Object.assign(new Error('Authenticated target file preview is unavailable'), { code: 'agent_unavailable' });
    const targetWorkspaceRefId = valid.side === 'alpha'
      ? definition.alphaWorkspaceRefId
      : definition.betaWorkspaceRefId;
    const target = await this.resolveRef(targetWorkspaceRefId);
    if (!target) throw Object.assign(new Error('Workspace sync preview target is unavailable'), { code: 'peer_unavailable' });
    return await this.readAtTarget({
      relationshipId: valid.relationshipId,
      targetMachineId: target.machineId,
      targetWorkspaceRefId,
      path: valid.path,
      ...(valid.expectedDigest === undefined ? {} : { expectedDigest: valid.expectedDigest }),
      maxBytes: valid.maxBytes,
      signal,
    });
  }
  async withAuthorizedSourceSeedExport<T>(
    request: Readonly<{
      operationId: string;
      sourceWorkspaceRefId: string;
      targetMachineId: string;
      contentPolicy: WorkspaceContentPolicyV1;
    }>,
    exportSource: (canonicalSourcePath: string) => Promise<T>,
  ): Promise<T> {
    const authorization = this.sourceSeedAuthorizations.get(request.operationId);
    if (!authorization) {
      throw Object.assign(new Error('Workspace sync source seed operation is not active'), { code: 'relationship_not_ready' });
    }
    const { operation } = authorization;
    if (!areContentPoliciesEqual(operation.contentPolicy, request.contentPolicy)) {
      throw Object.assign(new Error('Workspace sync source seed policy does not match the active operation'), { code: 'relationship_definition_conflict' });
    }
    const [alpha, beta] = await Promise.all([
      this.resolveRef(operation.alphaWorkspaceRefId),
      this.resolveRef(operation.betaWorkspaceRefId),
    ]);
    if (!alpha || !beta) {
      throw Object.assign(new Error('Workspace sync source seed endpoint is unavailable'), { code: 'peer_unavailable' });
    }
    const roles = resolveWorkspaceSyncRelationshipEndpointRoles({
      mode: 'relationshipId' in operation ? operation.mode : 'keep_synced',
      controllerMachineId: operation.controllerMachineId,
      alphaMachineId: alpha.machineId,
      betaMachineId: beta.machineId,
    });
    if (!roles) {
      throw Object.assign(new Error('Workspace sync source seed operation placement is invalid'), { code: 'controller_unavailable' });
    }
    const sourceWorkspaceRefId = roles.sourceEndpointRole === 'alpha'
      ? operation.alphaWorkspaceRefId
      : operation.betaWorkspaceRefId;
    const source = roles.sourceEndpointRole === 'alpha' ? alpha : beta;
    const target = roles.targetEndpointRole === 'alpha' ? alpha : beta;
    this.assertLocalSourcePlacement(source);
    if (sourceWorkspaceRefId !== request.sourceWorkspaceRefId
      || target.machineId !== request.targetMachineId) {
      throw Object.assign(new Error('Workspace sync source seed request does not match the active operation'), { code: 'target_unavailable' });
    }
    const canonicalSourcePath = await realpath(source.rootPath).catch(() => {
      throw Object.assign(new Error('Workspace sync source seed root is unavailable'), { code: 'root_changed' });
    });
    const sourceFence = authorization.ownershipHandles.find((handle) => (
      getPathRemainderWithinBase(handle.owner.canonicalRoot, canonicalSourcePath) === ''
      && getPathRemainderWithinBase(canonicalSourcePath, handle.owner.canonicalRoot) === ''
    ));
    if (!sourceFence) {
      throw Object.assign(new Error('Workspace sync source seed root is not fenced'), { code: 'root_changed' });
    }
    try {
      await sourceFence.bindCurrentRootIdentity();
    } catch {
      throw Object.assign(new Error('Workspace sync source seed root changed after admission'), { code: 'root_changed' });
    }
    return await exportSource(canonicalSourcePath);
  }
  async withSourceSeedAuthorization<T>(
    operation: WorkspaceSyncRelationshipV1 | WorkspaceSyncCopyOnceV1,
    ownershipHandles: readonly WorkspaceRootOwnershipHandle[],
    action: () => Promise<T>,
  ): Promise<T> {
    const operationId = 'relationshipId' in operation ? operation.relationshipId : operation.operationId;
    if (this.sourceSeedAuthorizations.has(operationId)) {
      throw Object.assign(new Error('Workspace sync source seed operation is already active'), { code: 'relationship_definition_conflict' });
    }
    this.sourceSeedAuthorizations.set(operationId, { operation, ownershipHandles });
    try {
      return await action();
    } finally {
      this.sourceSeedAuthorizations.delete(operationId);
    }
  }
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const cleanupFailures: unknown[] = [];
    try {
      await this.stopAllStatusObservations();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await this.lifecycle.stop();
    } catch (error) {
      cleanupFailures.push(error);
    }
    const activeIngressIds = [...this.activeIngress.keys()];
    const ingressCleanup = await Promise.allSettled(
      activeIngressIds.map(async (id) => await this.closeActiveIngress(id)),
    );
    const failedIngressIds = new Set<string>();
    for (let index = 0; index < ingressCleanup.length; index += 1) {
      const result = ingressCleanup[index]!;
      if (result.status === 'rejected') {
        cleanupFailures.push(result.reason);
        failedIngressIds.add(activeIngressIds[index]!);
      }
    }
    for (const [id, custody] of [...this.fences]) {
      if (failedIngressIds.has(id)) continue;
      const results = await Promise.allSettled(custody.ownedHandles.map(async (handle) => {
        this.pendingRootReleases.add(handle);
        await handle.release();
        this.pendingRootReleases.delete(handle);
        return handle;
      }));
      const failedHandles: WorkspaceRootOwnershipHandle[] = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index]!;
        if (result.status === 'rejected') {
          cleanupFailures.push(result.reason);
          failedHandles.push(custody.ownedHandles[index]!);
        }
      }
      if (failedHandles.length === 0) this.fences.delete(id);
      else this.fences.set(id, { handles: failedHandles, ownedHandles: failedHandles });
    }
    for (const [id, handles] of [...this.copyOwnedFences]) {
      if (failedIngressIds.has(id)) continue;
      const results = await Promise.allSettled(handles.map(async (handle) => {
        this.pendingRootReleases.add(handle);
        await handle.release();
        this.pendingRootReleases.delete(handle);
        return handle;
      }));
      const failedHandles: WorkspaceRootOwnershipHandle[] = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index]!;
        if (result.status === 'rejected') {
          cleanupFailures.push(result.reason);
          failedHandles.push(handles[index]!);
        }
      }
      if (failedHandles.length === 0) this.copyOwnedFences.delete(id);
      else this.copyOwnedFences.set(id, failedHandles);
    }
    const associatedHandles = new Set([
      ...[...this.fences.values()].flatMap((custody) => custody.ownedHandles),
      ...[...this.copyOwnedFences.values()].flat(),
    ]);
    const detachedRootReleases = [...this.pendingRootReleases].filter((handle) => !associatedHandles.has(handle));
    await this.releaseRootHandles(detachedRootReleases).catch((error: unknown) => {
      cleanupFailures.push(error);
    });
    for (const [id, release] of [...this.copyTargetReleases]) {
      try {
        await release('abort');
        this.copyTargetReleases.delete(id);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    this.copyFences.clear();
    this.copyOperations.clear();
    this.copyTerminalPending.clear();
    this.transientDefinitions.clear();
    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, 'Workspace sync controller cleanup failed');
    }
  }
  async rehydrateFromSettings(value: unknown): Promise<readonly WorkspaceSyncStatusV1[]> {
    this.assertStateAvailable();
    const relationships = validateWorkspaceSyncRelationships(value).filter((relationship) => (
      relationship.controllerMachineId === this.localMachineId
    ));
    const disabledRelationships = relationships.filter((relationship) => !relationship.enabled);
    const enabledRelationships = relationships.filter((relationship) => relationship.enabled);
    const gitRelationships = enabledRelationships.filter(({ contentPolicy }) => contentPolicy.selection === 'git_worktree');
    const gitUnavailable = gitRelationships.length > 0 && !(await this.probeGit());
    const rejectUnavailableGit = gitUnavailable
      && gitRelationships.length === enabledRelationships.length
      && disabledRelationships.length === 0;
    const activeRelationships = gitUnavailable
      ? enabledRelationships.filter(({ contentPolicy }) => contentPolicy.selection !== 'git_worktree')
      : enabledRelationships;
    return await this.enqueueAll([
      ...relationships.map(({ relationshipId }) => relationshipId),
      ...this.definitions.keys(),
      ...this.copyOperations.keys(),
    ], async () => {
      // Disabled records remain settings intent. Their local roots are fenced
      // before runtime discovery so an existing sidecar cannot race its
      // terminal transition. They never bootstrap a target or create a new
      // runtime session during cold rehydration.
      const desired = new Map(
        [...activeRelationships, ...disabledRelationships]
          .map((relationship) => [relationship.relationshipId, relationship]),
      );
      for (const id of this.transientDefinitions) {
        const definition = this.definitions.get(id);
        if (definition && !desired.has(id)) desired.set(id, definition);
      }
      const pendingFences = new Map<string, Readonly<{
        handles: WorkspaceRootOwnershipHandle[];
        ownedHandles: WorkspaceRootOwnershipHandle[];
      }>>();
      try {
        for (const relationship of activeRelationships) {
          const current = this.definitions.get(relationship.relationshipId);
          if (current && areWorkspaceSyncRelationshipDefinitionsEqual(current, relationship)
            && this.fences.has(relationship.relationshipId)
            && !this.ownershipLost.has(relationship.relationshipId)) {
            try {
              await this.assertRelationshipOwnershipCurrent(relationship.relationshipId);
            } catch (error) {
              if (!(typeof error === 'object' && error !== null && 'code' in error
                && error.code === 'workspace_root_ownership_lost')) throw error;
            }
          }
          if (!current || !areWorkspaceSyncRelationshipDefinitionsEqual(current, relationship)
            || !this.fences.has(relationship.relationshipId)
            || this.ownershipLost.has(relationship.relationshipId)) {
            const sourceHandles = await this.acquireSourceRoots(relationship);
            // Recorded before target preparation so a failure there still
            // releases the source fence through the loop's cleanup.
            pendingFences.set(relationship.relationshipId, {
              handles: [...sourceHandles],
              ownedHandles: [...sourceHandles],
            });
            const targetPreparation = await this.prepareTarget(relationship, undefined);
            const carriedHandles = [...sourceHandles, ...(targetPreparation?.ownershipHandles ?? [])];
            const acquiredHandles = await this.acquireRoots(relationship, carriedHandles);
            pendingFences.set(relationship.relationshipId, {
              handles: [...carriedHandles, ...acquiredHandles],
              ownedHandles: [...sourceHandles, ...acquiredHandles],
            });
          }
        }
        for (const relationship of disabledRelationships) {
          const current = this.definitions.get(relationship.relationshipId);
          if (current && areWorkspaceSyncRelationshipDefinitionsEqual(current, relationship)
            && this.fences.has(relationship.relationshipId)) {
            await this.assertRelationshipOwnershipCurrent(relationship.relationshipId);
            continue;
          }
          const acquiredHandles = await this.acquireRoots(relationship);
          pendingFences.set(relationship.relationshipId, {
            handles: acquiredHandles,
            ownedHandles: acquiredHandles,
          });
        }
      } catch (error) {
        await this.releaseRootHandles(
          [...pendingFences.values()].flatMap((custody) => custody.ownedHandles),
        );
        throw error;
      }
      const stagedPrevious = new Map<string, Readonly<{
        definition: WorkspaceSyncRelationshipV1 | undefined;
        custody: Readonly<{ handles: WorkspaceRootOwnershipHandle[]; ownedHandles: WorkspaceRootOwnershipHandle[] }> | undefined;
        ingress: ReadonlySet<ActiveWorkspaceSyncIngress>;
      }>>();
      for (const relationship of [...activeRelationships, ...disabledRelationships]) {
        const custody = pendingFences.get(relationship.relationshipId);
        if (!custody) continue;
        stagedPrevious.set(relationship.relationshipId, {
          definition: this.definitions.get(relationship.relationshipId),
          custody: this.fences.get(relationship.relationshipId),
          ingress: new Set(this.activeIngress.get(relationship.relationshipId) ?? []),
        });
        this.definitions.set(relationship.relationshipId, relationship);
        this.fences.set(relationship.relationshipId, custody);
      }
      const rollbackStaged = async (): Promise<void> => {
        for (const [id, previous] of stagedPrevious) {
          for (const entry of this.activeIngress.get(id) ?? []) {
            if (!previous.ingress.has(entry)) entry.stream.destroy();
          }
          if (previous.definition) this.definitions.set(id, previous.definition);
          else this.definitions.delete(id);
          if (previous.custody) this.fences.set(id, previous.custody);
          else this.fences.delete(id);
        }
        await this.releaseRootHandles(
          [...pendingFences.values()].flatMap((custody) => custody.ownedHandles),
        );
      };
      let existing: Map<string, WorkspaceSyncStatusV1>;
      try {
        await this.lifecycle.start();
        const recoveries = new Map([...this.copyOperations.values()].map((operation) => [operation.operationId, operation]));
        for (const recovery of await this.adapter.discoverCopyOnceRecoveries()) recoveries.set(recovery.operationId, recovery);
        for (const recovery of recoveries.values()) await this.recoverCopyOnce(recovery);
        existing = new Map((await this.adapter.rehydrate([...desired.values()])).map((item) => [item.relationshipId, item]));
      } catch (error) {
        await rollbackStaged();
        throw error;
      }
      await this.releaseRootHandles(
        [...stagedPrevious.values()].flatMap((previous) => previous.custody?.ownedHandles ?? []),
      );
      for (const relationship of disabledRelationships) {
        await this.closeActiveIngress(relationship.relationshipId);
        await this.releaseRelationshipOwnership(relationship.relationshipId);
        this.ownershipLost.delete(relationship.relationshipId);
        this.definitions.set(relationship.relationshipId, relationship);
        this.transientDefinitions.delete(relationship.relationshipId);
      }
      for (const [id, current] of this.definitions) {
        const next = desired.get(id);
        if (next && areWorkspaceSyncRelationshipDefinitionsEqual(next, current)) continue;
        await this.closeActiveIngress(id);
        await this.releaseRelationshipOwnership(id);
        this.definitions.delete(id);
        this.transientDefinitions.delete(id);
        this.statuses.delete(id);
        this.reconcileStatusObservation(id);
      }
      const statuses: WorkspaceSyncStatusV1[] = [];
      for (const relationship of activeRelationships) {
        const adopted = existing.get(relationship.relationshipId);
        const recoveringOwnership = this.ownershipLost.has(relationship.relationshipId);
        if (!this.definitions.has(relationship.relationshipId) || recoveringOwnership) {
          const custody = pendingFences.get(relationship.relationshipId) ?? { handles: [], ownedHandles: [] };
          this.definitions.set(relationship.relationshipId, relationship);
          this.transientDefinitions.delete(relationship.relationshipId);
          this.fences.set(relationship.relationshipId, custody);
        }
        try {
          await this.assertRelationshipOwnershipCurrent(relationship.relationshipId);
          const status = recoveringOwnership
            ? await this.adapter.ensure(relationship, undefined)
            : adopted ?? await this.adapter.ensure(relationship, undefined);
          this.definitions.set(relationship.relationshipId, relationship);
          if (recoveringOwnership) this.ownershipLost.delete(relationship.relationshipId);
          statuses.push(this.publish(status));
        } catch (error) {
          if (pendingFences.has(relationship.relationshipId)) {
            await this.releaseRelationshipOwnership(relationship.relationshipId);
            this.definitions.delete(relationship.relationshipId);
          }
          throw error;
        }
      }
      for (const relationship of disabledRelationships) {
        const adopted = existing.get(relationship.relationshipId);
        if (adopted) {
          statuses.push(this.publish({ ...adopted, state: 'paused' }));
          continue;
        }
        const [alpha, beta] = await Promise.all([
          this.resolveRef(relationship.alphaWorkspaceRefId),
          this.resolveRef(relationship.betaWorkspaceRefId),
        ]);
        statuses.push(this.publish({
          relationshipId: relationship.relationshipId,
          controllerMachineId: relationship.controllerMachineId,
          state: 'paused',
          alphaPath: alpha?.rootPath ?? relationship.alphaWorkspaceRefId,
          betaPath: beta?.rootPath ?? relationship.betaWorkspaceRefId,
          mode: relationship.mode,
          changedFiles: 0,
          conflictCount: 0,
          lastSuccessfulSyncAtMs: null,
        }));
      }
      if (gitUnavailable) {
        for (const relationship of gitRelationships) {
          const [alpha, beta] = await Promise.all([
            this.resolveRef(relationship.alphaWorkspaceRefId),
            this.resolveRef(relationship.betaWorkspaceRefId),
          ]);
          statuses.push(this.publish({
            relationshipId: relationship.relationshipId,
            controllerMachineId: relationship.controllerMachineId,
            state: 'error',
            alphaPath: alpha?.rootPath ?? relationship.alphaWorkspaceRefId,
            betaPath: beta?.rootPath ?? relationship.betaWorkspaceRefId,
            mode: relationship.mode,
            changedFiles: 0,
            conflictCount: 0,
            lastSuccessfulSyncAtMs: null,
            errorCode: 'git_selection_unavailable',
          }));
        }
      }
      if (rejectUnavailableGit) {
        throw Object.assign(new Error('Git is unavailable for the git_worktree workspace sync selection'), { code: 'git_selection_unavailable' });
      }
      return statuses;
    });
  }
  async openExternalStream(input: Readonly<{ endpointId: string; signal?: AbortSignal }>): Promise<Duplex> {
    this.assertStateAvailable();
    if (this.shuttingDown) {
      throw Object.assign(new Error('Workspace sync endpoint is not owned'), { code: 'relationship_not_owned' });
    }
    const candidates = [...this.definitions.values(), ...this.copyOperations.values()];
    const match = candidates.flatMap((operation) => {
      const operationId = 'relationshipId' in operation ? operation.relationshipId : operation.operationId;
      return (['alpha', 'beta'] as const).map((role) => ({ operation, operationId, role }));
    }).find(({ operationId, role }) => deriveWorkspaceSyncEndpointId(operationId, role) === input.endpointId);
    if (!match) throw Object.assign(new Error('Workspace sync endpoint is not owned'), { code: 'relationship_not_owned' });
    const { operation, operationId, role } = match;
    if (this.ownershipLost.has(operationId)) {
      throw Object.assign(new Error('Workspace root ownership was lost'), { code: 'workspace_root_ownership_lost' });
    }
    if (operation.controllerMachineId !== this.localMachineId) {
      throw Object.assign(new Error('Workspace sync controller machine is unavailable'), { code: 'controller_unavailable' });
    }
    const [alpha, beta] = await Promise.all([
      this.resolveRef(operation.alphaWorkspaceRefId), this.resolveRef(operation.betaWorkspaceRefId),
    ]);
    if (!alpha || !beta) throw Object.assign(new Error('Workspace sync endpoint is unavailable'), { code: 'peer_unavailable' });
    const endpoint = role === 'alpha' ? alpha : beta;
    const counterpart = role === 'alpha' ? beta : alpha;
    const endpointRefId = role === 'alpha' ? operation.alphaWorkspaceRefId : operation.betaWorkspaceRefId;
    const retainIfStillOwned = async (owned: WorkspaceSyncOwnedLocalAgent): Promise<Duplex> => {
      const current = 'relationshipId' in operation
        ? this.definitions.get(operationId)
        : this.copyOperations.get(operationId);
      if (!this.shuttingDown && current === operation && !this.ownershipLost.has(operationId)) {
        return this.trackOwnedIngress(operationId, owned);
      }
      owned.stream.destroy();
      await owned.stop();
      const ownershipLost = this.ownershipLost.has(operationId);
      throw Object.assign(
        new Error(ownershipLost ? 'Workspace root ownership was lost' : 'Workspace sync endpoint is not owned'),
        { code: ownershipLost ? 'workspace_root_ownership_lost' : 'relationship_not_owned' },
      );
    };
    if (endpoint.machineId === this.localMachineId) {
      if (!this.openLocalAgent) throw Object.assign(new Error('Verified local workspace agent is unavailable'), { code: 'agent_unavailable' });
      const canonicalRoot = await realpath(endpoint.rootPath).catch(() => {
        throw Object.assign(new Error('Workspace sync endpoint root is unavailable'), { code: 'root_mismatch' });
      });
      const handles = 'relationshipId' in operation
        ? this.fences.get(operationId)?.handles ?? []
        : this.copyFences.get(operationId) ?? [];
      const ownedRoot = handles.find((handle) => (
        getPathRemainderWithinBase(handle.owner.canonicalRoot, canonicalRoot) === ''
        && getPathRemainderWithinBase(canonicalRoot, handle.owner.canonicalRoot) === ''
      ));
      if (!ownedRoot) {
        throw Object.assign(new Error('Workspace sync endpoint root is not fenced'), { code: 'root_changed' });
      }
      if ('relationshipId' in operation) {
        await this.assertRelationshipOwnershipCurrent(operationId);
      } else {
        try {
          await ownedRoot.bindCurrentRootIdentity();
        } catch {
          throw Object.assign(new Error('Workspace sync endpoint root changed after admission'), { code: 'root_changed' });
        }
      }
      return await retainIfStillOwned(await this.openLocalAgent({ operationId, role, workspaceRefId: endpointRefId, canonicalRoot, ...(input.signal ? { signal: input.signal } : {}) }));
    }
    if (!this.openMachineCarrier) throw machineCarrierUnavailableError();
    const tunnel = await this.openMachineCarrier({
      operationId,
      sourceMachineId: counterpart.machineId,
      targetMachineId: endpoint.machineId,
      flow: 'workspace_sync',
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const ownedTunnel = await connectWorkspaceSyncMachineTunnel(tunnel, input.signal);
    return await retainIfStillOwned({ stream: ownedTunnel.stream, stop: ownedTunnel.stop });
  }
  subscribe(id: string, signal: AbortSignal): AsyncIterable<WorkspaceSyncStatusV1> {
    const self = this;
    return { async *[Symbol.asyncIterator]() {
      const queue: WorkspaceSyncStatusV1[] = [];
      let wake: (() => void) | null = null;
      const listener = (status: WorkspaceSyncStatusV1) => { queue.push(status); wake?.(); };
      const wakeOnAbort = () => wake?.();
      const listeners = self.listeners.get(id) ?? new Set();
      listeners.add(listener);
      self.listeners.set(id, listeners);
      self.reconcileStatusObservation(id);
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        signal.removeEventListener('abort', abortAndWake);
        listeners.delete(listener);
        if (listeners.size === 0) self.listeners.delete(id);
        self.reconcileStatusObservation(id);
      };
      const abortAndWake = () => {
        cleanup();
        wakeOnAbort();
      };
      signal.addEventListener('abort', abortAndWake);
      try {
        while (!signal.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve;
              if (signal.aborted) resolve();
            });
            wake = null;
          }
          if (!signal.aborted && queue.length) yield queue.shift()!;
        }
      } finally {
        signal.removeEventListener('abort', abortAndWake);
        cleanup();
      }
    } };
  }
}
