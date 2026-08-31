import { areWorkspaceSyncRelationshipDefinitionsEqual, DeleteWorkspaceSyncConflictLoserV1Schema, ReadWorkspaceSyncFileV1Schema, WorkspaceSyncCopyOnceV1Schema } from '@happier-dev/protocol';
import { machineCarrierUnavailableError } from '@/daemon/peer/iroh/machineCarrier';
import { MAX_WORKSPACE_SYNC_RELATIONSHIPS, validateWorkspaceSyncRelationship, validateWorkspaceSyncRelationships } from './workspaceSyncSettings';
import { deriveWorkspaceSyncEndpointId } from './transport/workspaceSyncBrokerProtocol';
import {
  connectWorkspaceSyncMachineTunnel,
  type WorkspaceSyncMachineTunnelOpen,
} from './workspaceSyncMachineCarrierStream';
import type { Duplex } from 'node:stream';
import { realpath } from 'node:fs/promises';
import type { WorkspaceRootOwnershipHandle, WorkspaceRootOwnershipManager } from './workspaceSyncRootOwnership';
import { getPathRemainderWithinBase } from '@/session/handoff/paths/sessionHandoffPathNormalization';
import type { DeleteWorkspaceSyncConflictLoserV1, ManagedWorkspaceSync, ReadWorkspaceSyncFileResultV1, ReadWorkspaceSyncFileV1, WorkspaceSyncConflictListV1, WorkspaceSyncCopyOnceV1, WorkspaceSyncRelationshipV1, WorkspaceSyncStatusV1 } from './workspaceSyncTypes';

export type WorkspaceSyncResolvedRef = Readonly<{ machineId: string; rootPath: string }>;
export type WorkspaceSyncTargetConflictDelete = (input: Readonly<{
  relationshipId: string;
  targetMachineId: string;
  targetWorkspaceRefId: string;
  path: string;
  expectedDigest?: string;
  expectedKind: DeleteWorkspaceSyncConflictLoserV1['expectedKind'];
  signal?: AbortSignal;
}>) => Promise<void>;
export type WorkspaceSyncTargetFileRead = (input: Readonly<{
  relationshipId: string;
  targetMachineId: string;
  targetWorkspaceRefId: string;
  path: string;
  expectedDigest?: string;
  maxBytes: number;
  signal?: AbortSignal;
}>) => Promise<ReadWorkspaceSyncFileResultV1>;
/**
 * Composition supplies this through the verified Mutagen artifact plus the
 * managed-child/process-custody owner. It must launch the exact-build agent as
 * `happier-mutagen-agent synchronizer --root <canonicalRoot>` without a shell.
 * The Mutagen synchronizer command uses standard input/output implicitly.
 */
export type WorkspaceSyncLocalAgentStreamOpen = (input: Readonly<{
  operationId: string;
  role: 'alpha' | 'beta';
  workspaceRefId: string;
  canonicalRoot: string;
  signal?: AbortSignal;
}>) => Promise<Duplex>;
export interface WorkspaceSyncMutagenAdapter {
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
  listConflicts(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncConflictListV1>;
}
export type WorkspaceSyncControllerOptions = Readonly<{
  adapter: WorkspaceSyncMutagenAdapter;
  lifecycle: Readonly<{ start(): Promise<void>; stop(): Promise<void> }>;
  localMachineId: string;
  resolveWorkspaceRef(id: string): WorkspaceSyncResolvedRef | null | Promise<WorkspaceSyncResolvedRef | null>;
  rootOwnershipManager: WorkspaceRootOwnershipManager;
  resolveRelationshipDefinition?(relationshipId: string): WorkspaceSyncRelationshipV1 | null | Promise<WorkspaceSyncRelationshipV1 | null>;
  prepareRelationshipTarget?(definition: WorkspaceSyncRelationshipV1, signal?: AbortSignal): Promise<void>;
  ownershipRenewIntervalMs?: number;
  openMachineCarrierTunnel?: WorkspaceSyncMachineTunnelOpen;
  openLocalWorkspaceAgentStream?: WorkspaceSyncLocalAgentStreamOpen;
  deleteConflictLoserAtTarget?: WorkspaceSyncTargetConflictDelete;
  readFileAtTarget?: WorkspaceSyncTargetFileRead;
  /**
   * Derived once from the retired-state inspection at the daemon composition
   * boundary. Throws the exact typed legacy-state code when workspace sync
   * must stay disabled; called before any state mutation or engine process
   * action. Subscription registration stays passive and is not gated.
   */
  assertLegacyStateAvailable?: () => void;
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

const requiredAdapterMethods = ['rehydrate', 'ensure', 'copyOnce', 'get', 'list', 'flush', 'pause', 'resume', 'terminate', 'listConflicts'] as const;

function assertCompleteAdapter(adapter: WorkspaceSyncMutagenAdapter): void {
  const record = adapter as unknown as Readonly<Record<string, unknown>>;
  const missing = requiredAdapterMethods.find((method) => typeof record[method] !== 'function');
  if (missing) throw Object.assign(new Error(`Workspace sync adapter does not implement ${missing}`), { code: 'workspace_sync_unavailable' });
}

export class WorkspaceSyncController implements ManagedWorkspaceSync {
  private readonly adapter: WorkspaceSyncMutagenAdapter;
  private readonly localMachineId: string;
  private readonly resolveRef: WorkspaceSyncControllerOptions['resolveWorkspaceRef'];
  private readonly lifecycle: WorkspaceSyncControllerOptions['lifecycle'];
  private readonly rootOwnershipManager: WorkspaceRootOwnershipManager;
  private readonly resolveDefinition: NonNullable<WorkspaceSyncControllerOptions['resolveRelationshipDefinition']>;
  private readonly prepareTarget: NonNullable<WorkspaceSyncControllerOptions['prepareRelationshipTarget']>;
  private readonly ownershipRenewIntervalMs: number;
  private readonly openMachineCarrier?: WorkspaceSyncMachineTunnelOpen;
  private readonly openLocalAgent?: WorkspaceSyncLocalAgentStreamOpen;
  private readonly deleteAtTarget?: WorkspaceSyncTargetConflictDelete;
  private readonly readAtTarget?: WorkspaceSyncTargetFileRead;
  private readonly assertStateAvailable: () => void;
  private readonly definitions = new Map<string, WorkspaceSyncRelationshipV1>();
  private readonly copyOperations = new Map<string, WorkspaceSyncCopyOnceV1>();
  private readonly copyFences = new Map<string, readonly WorkspaceRootOwnershipHandle[]>();
  private readonly copyOwnedFences = new Map<string, readonly WorkspaceRootOwnershipHandle[]>();
  private readonly statuses = new Map<string, WorkspaceSyncStatusV1>();
  private readonly fences = new Map<string, WorkspaceRootOwnershipHandle[]>();
  private readonly ownershipLost = new Set<string>();
  private readonly activeIngress = new Map<string, Set<Duplex>>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, Set<(status: WorkspaceSyncStatusV1) => void>>();
  private readonly renewalTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: WorkspaceSyncControllerOptions) { assertCompleteAdapter(options.adapter); this.adapter = options.adapter; this.lifecycle = options.lifecycle; this.localMachineId = options.localMachineId; this.resolveRef = options.resolveWorkspaceRef; this.rootOwnershipManager = options.rootOwnershipManager; this.resolveDefinition = options.resolveRelationshipDefinition ?? (() => null); this.prepareTarget = options.prepareRelationshipTarget ?? (async () => undefined); this.ownershipRenewIntervalMs = options.ownershipRenewIntervalMs ?? 15_000; this.openMachineCarrier = options.openMachineCarrierTunnel; this.openLocalAgent = options.openLocalWorkspaceAgentStream; this.deleteAtTarget = options.deleteConflictLoserAtTarget; this.readAtTarget = options.readFileAtTarget; this.assertStateAvailable = options.assertLegacyStateAvailable ?? (() => undefined); }

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
  private publish(status: WorkspaceSyncStatusV1): WorkspaceSyncStatusV1 { this.statuses.set(status.relationshipId, status); for (const listener of this.listeners.get(status.relationshipId) ?? []) listener(status); return status; }
  private async acquireRoots(definition: WorkspaceSyncRelationshipV1): Promise<WorkspaceRootOwnershipHandle[]> {
    const handles: WorkspaceRootOwnershipHandle[] = [];
    try {
      for (const [id, role] of [[definition.alphaWorkspaceRefId, 'alpha'], [definition.betaWorkspaceRefId, 'beta']] as const) {
        const ref = await this.resolveRef(id);
        if (!ref || ref.machineId !== this.localMachineId) continue;
        const result = await this.rootOwnershipManager.tryAcquire({ ownerId: definition.relationshipId, canonicalRoot: ref.rootPath, operation: 'sync' });
        if ('kind' in result) throw Object.assign(new Error('Workspace root is already in use'), { code: 'workspace_root_in_use', existing: result.existing, role });
        handles.push(result);
      }
      return handles;
    } catch (error) { await Promise.all(handles.map((handle) => handle.release())); throw error; }
  }
  private startOwnershipRenewal(id: string, handles: readonly WorkspaceRootOwnershipHandle[]): void {
    if (handles.length === 0 || this.renewalTimers.has(id)) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          await Promise.all(handles.map((handle) => handle.renew()));
        } catch {
          this.stopOwnershipRenewal(id);
          this.ownershipLost.add(id);
          void this.enqueue(id, undefined, async () => {
            if (this.fences.get(id) !== handles) return;
            this.closeActiveIngress(id);
            let paused: WorkspaceSyncStatusV1 | undefined;
            try {
              paused = await this.adapter.pause(id);
            } finally {
              this.fences.delete(id);
              await Promise.all(handles.map((handle) => handle.release()));
            }
            this.publish({ ...paused, state: 'paused', errorCode: 'workspace_root_ownership_lost' });
          }).catch(() => {
            const previous = this.statuses.get(id);
            if (previous) this.publish({ ...previous, state: 'error', errorCode: 'workspace_root_ownership_lost' });
          });
        }
      })();
    }, this.ownershipRenewIntervalMs);
    timer.unref?.();
    this.renewalTimers.set(id, timer);
  }
  private stopOwnershipRenewal(id: string): void {
    const timer = this.renewalTimers.get(id);
    if (timer) clearInterval(timer);
    this.renewalTimers.delete(id);
  }
  private async releaseRelationshipOwnership(id: string): Promise<void> {
    this.stopOwnershipRenewal(id);
    const handles = this.fences.get(id) ?? [];
    this.fences.delete(id);
    await Promise.all(handles.map((handle) => handle.release()));
  }
  private closeActiveIngress(id: string): void {
    for (const stream of this.activeIngress.get(id) ?? []) stream.destroy();
    this.activeIngress.delete(id);
  }
  private trackActiveIngress(id: string, stream: Duplex): Duplex {
    const streams = this.activeIngress.get(id) ?? new Set<Duplex>();
    streams.add(stream);
    this.activeIngress.set(id, streams);
    stream.once('close', () => {
      streams.delete(stream);
      if (streams.size === 0) this.activeIngress.delete(id);
    });
    return stream;
  }
  private async releaseCopyOperation(id: string): Promise<void> {
    const handles = this.copyOwnedFences.get(id) ?? [];
    this.copyOwnedFences.delete(id);
    this.copyFences.delete(id);
    this.copyOperations.delete(id);
    await Promise.all(handles.map((handle) => handle.release()));
  }
  private async ensureWithinQueue(
    valid: WorkspaceSyncRelationshipV1,
    signal?: AbortSignal,
  ): Promise<WorkspaceSyncStatusV1> {
    if (!valid.enabled) throw Object.assign(new Error('Workspace sync relationship is disabled'), { code: 'relationship_not_ready' });
    if (valid.controllerMachineId !== this.localMachineId) {
      throw Object.assign(new Error('Workspace sync controller machine is unavailable'), { code: 'controller_unavailable' });
    }
    const previous = this.definitions.get(valid.relationshipId);
    const recoveringOwnership = previous !== undefined && this.ownershipLost.has(valid.relationshipId);
    if (!previous && this.definitions.size >= MAX_WORKSPACE_SYNC_RELATIONSHIPS) {
      throw Object.assign(new Error('Workspace sync relationship limit reached'), { code: 'workspace_sync_relationship_limit' });
    }
    if (previous && !areWorkspaceSyncRelationshipDefinitionsEqual(previous, valid)) {
      throw Object.assign(new Error('Workspace sync relationship definition conflicts with active relationship'), { code: 'relationship_definition_conflict' });
    }
    let acquiredHandles: WorkspaceRootOwnershipHandle[] | undefined;
    if (!previous || recoveringOwnership) {
      acquiredHandles = await this.acquireRoots(valid);
      this.fences.set(valid.relationshipId, acquiredHandles);
    }
    try {
      await this.prepareTarget(valid, signal);
      await this.lifecycle.start();
      if (!previous) this.definitions.set(valid.relationshipId, valid);
      const status = await this.adapter.ensure(valid, signal);
      this.ownershipLost.delete(valid.relationshipId);
      this.startOwnershipRenewal(valid.relationshipId, this.fences.get(valid.relationshipId) ?? []);
      return this.publish(status);
    } catch (error) {
      if (!previous || recoveringOwnership) {
        if (!previous) this.definitions.delete(valid.relationshipId);
        this.stopOwnershipRenewal(valid.relationshipId);
        await Promise.all((acquiredHandles ?? []).map((handle) => handle.release()));
        this.fences.delete(valid.relationshipId);
      }
      throw error;
    }
  }
  async get(id: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1 | null> { this.assertStateAvailable(); abortIfRequested(signal); await this.lifecycle.start(); return await this.adapter.get(id, signal); }
  async list(signal?: AbortSignal): Promise<readonly WorkspaceSyncStatusV1[]> { this.assertStateAvailable(); abortIfRequested(signal); await this.lifecycle.start(); return await this.adapter.list(signal); }
  async ensure(definition: WorkspaceSyncRelationshipV1, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> {
    this.assertStateAvailable();
    const valid = validateWorkspaceSyncRelationship(definition);
    return this.enqueue(valid.relationshipId, signal, async () => await this.ensureWithinQueue(valid, signal));
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
      const acquiredHandles = retained ? [] : await this.acquireRoots({
          v: 1, relationshipId: valid.operationId, controllerMachineId: valid.controllerMachineId,
          alphaWorkspaceRefId: valid.alphaWorkspaceRefId, betaWorkspaceRefId: valid.betaWorkspaceRefId,
          mode: 'keep_synced', contentPolicy: valid.contentPolicy, enabled: true, createdAtMs: 0, updatedAtMs: 0,
        });
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
    return this.publish(await this.adapter.resume(id, signal));
  }); }
  async terminate(id: string, signal?: AbortSignal): Promise<void> { return this.enqueue(id, signal, async () => {
    this.assertStateAvailable();
    await this.lifecycle.start();
    await this.adapter.terminate(id, signal);
    if (this.copyOperations.has(id)) {
      await this.releaseCopyOperation(id);
    } else {
      await this.releaseRelationshipOwnership(id);
      this.ownershipLost.delete(id);
      this.closeActiveIngress(id);
      this.definitions.delete(id);
      this.statuses.delete(id);
    }
  }); }
  async listConflicts(id: string, signal?: AbortSignal): Promise<WorkspaceSyncConflictListV1> { this.assertStateAvailable(); abortIfRequested(signal); await this.lifecycle.start(); return await this.adapter.listConflicts(id, signal); }
  async deleteConflictLoser(request: DeleteWorkspaceSyncConflictLoserV1, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> {
    this.assertStateAvailable();
    const valid = DeleteWorkspaceSyncConflictLoserV1Schema.parse(request);
    return this.enqueue(valid.relationshipId, signal, async () => {
      if (this.ownershipLost.has(valid.relationshipId)) throw Object.assign(new Error('Workspace root ownership was lost'), { code: 'workspace_root_ownership_lost' });
      const definition = this.definitions.get(valid.relationshipId);
      if (!definition) throw Object.assign(new Error('Workspace sync relationship is not ready'), { code: 'relationship_not_ready' });
      if (!this.deleteAtTarget) {
        throw Object.assign(new Error('Authenticated target conflict resolution is unavailable'), { code: 'agent_unavailable' });
      }
      const losingRefId = valid.keep === 'alpha' ? definition.betaWorkspaceRefId : definition.alphaWorkspaceRefId;
      const target = await this.resolveRef(losingRefId);
      if (!target) throw Object.assign(new Error('Workspace sync conflict target is unavailable'), { code: 'peer_unavailable' });
      await this.lifecycle.start();
      await this.deleteAtTarget({
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
  async shutdown(): Promise<void> { for (const id of this.renewalTimers.keys()) this.stopOwnershipRenewal(id); for (const id of this.activeIngress.keys()) this.closeActiveIngress(id); await this.lifecycle.stop(); await Promise.all([...this.fences.values(), ...this.copyOwnedFences.values()].flat().map((handle) => handle.release())); this.fences.clear(); this.copyOwnedFences.clear(); this.copyFences.clear(); this.copyOperations.clear(); }
  async rehydrateFromSettings(value: unknown): Promise<readonly WorkspaceSyncStatusV1[]> {
    this.assertStateAvailable();
    const relationships = validateWorkspaceSyncRelationships(value).filter((relationship) => relationship.enabled
      && relationship.controllerMachineId === this.localMachineId);
    const desired = new Map(relationships.map((relationship) => [relationship.relationshipId, relationship]));
    return await this.enqueueAll([...desired.keys(), ...this.definitions.keys()], async () => {
      const pendingFences = new Map<string, WorkspaceRootOwnershipHandle[]>();
      try {
        for (const relationship of relationships) {
          const current = this.definitions.get(relationship.relationshipId);
          if (!current || !areWorkspaceSyncRelationshipDefinitionsEqual(current, relationship)) {
            pendingFences.set(relationship.relationshipId, await this.acquireRoots(relationship));
          }
          await this.prepareTarget(relationship, undefined);
        }
      } catch (error) {
        await Promise.all([...pendingFences.values()].flat().map((handle) => handle.release()));
        throw error;
      }
      let existing: Map<string, WorkspaceSyncStatusV1>;
      try {
        await this.lifecycle.start();
        existing = new Map((await this.adapter.rehydrate(relationships)).map((item) => [item.relationshipId, item]));
      } catch (error) {
        await Promise.all([...pendingFences.values()].flat().map((handle) => handle.release()));
        throw error;
      }
      for (const [id, current] of this.definitions) {
        const next = desired.get(id);
        if (next && areWorkspaceSyncRelationshipDefinitionsEqual(next, current)) continue;
        await this.releaseRelationshipOwnership(id);
        this.definitions.delete(id);
        this.statuses.delete(id);
      }
      const statuses: WorkspaceSyncStatusV1[] = [];
      for (const relationship of relationships) {
        const adopted = existing.get(relationship.relationshipId);
        if (!this.definitions.has(relationship.relationshipId)) {
          const handles = pendingFences.get(relationship.relationshipId) ?? [];
          this.definitions.set(relationship.relationshipId, relationship);
          this.fences.set(relationship.relationshipId, handles);
          this.startOwnershipRenewal(relationship.relationshipId, handles);
        }
        try {
          statuses.push(this.publish(adopted ?? await this.adapter.ensure(relationship, undefined)));
        } catch (error) {
          if (pendingFences.has(relationship.relationshipId)) {
            await this.releaseRelationshipOwnership(relationship.relationshipId);
            this.definitions.delete(relationship.relationshipId);
          }
          throw error;
        }
      }
      return statuses;
    });
  }
  async openExternalStream(input: Readonly<{ endpointId: string; signal?: AbortSignal }>): Promise<Duplex> {
    this.assertStateAvailable();
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
    if (endpoint.machineId === this.localMachineId) {
      if (!this.openLocalAgent) throw Object.assign(new Error('Verified local workspace agent is unavailable'), { code: 'agent_unavailable' });
      const canonicalRoot = await realpath(endpoint.rootPath).catch(() => {
        throw Object.assign(new Error('Workspace sync endpoint root is unavailable'), { code: 'root_mismatch' });
      });
      const handles = 'relationshipId' in operation
        ? this.fences.get(operationId) ?? []
        : this.copyFences.get(operationId) ?? [];
      const ownedRoot = handles.find((handle) => (
        getPathRemainderWithinBase(handle.owner.canonicalRoot, canonicalRoot) === ''
        && getPathRemainderWithinBase(canonicalRoot, handle.owner.canonicalRoot) === ''
      ));
      if (!ownedRoot) {
        throw Object.assign(new Error('Workspace sync endpoint root is not fenced'), { code: 'root_changed' });
      }
      try {
        await ownedRoot.bindCurrentRootIdentity();
      } catch {
        throw Object.assign(new Error('Workspace sync endpoint root changed after admission'), { code: 'root_changed' });
      }
      return this.trackActiveIngress(operationId, await this.openLocalAgent({ operationId, role, workspaceRefId: endpointRefId, canonicalRoot, ...(input.signal ? { signal: input.signal } : {}) }));
    }
    if (!this.openMachineCarrier) throw machineCarrierUnavailableError();
    const tunnel = await this.openMachineCarrier({
      operationId,
      sourceMachineId: counterpart.machineId,
      targetMachineId: endpoint.machineId,
      flow: 'workspace_sync',
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return this.trackActiveIngress(operationId, await connectWorkspaceSyncMachineTunnel(tunnel, input.signal));
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
      signal.addEventListener('abort', wakeOnAbort);
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
        signal.removeEventListener('abort', wakeOnAbort);
        listeners.delete(listener);
        if (listeners.size === 0) self.listeners.delete(id);
      }
    } };
  }
}

export function createWorkspaceSyncController(options: WorkspaceSyncControllerOptions): ManagedWorkspaceSync { return new WorkspaceSyncController(options); }
