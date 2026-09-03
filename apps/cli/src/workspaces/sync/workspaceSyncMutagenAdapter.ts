import { randomUUID } from 'node:crypto';
import { WorkspaceSyncCopyOnceV1Schema } from '@happier-dev/protocol';

import type { WorkspaceSyncMutagenAdapter, WorkspaceSyncResolvedRef } from './workspaceSyncController';
import {
  deriveWorkspaceSyncEndpointId,
  type MutagenControlCommandV1,
  type MutagenSessionDefinition,
} from './transport/workspaceSyncBrokerProtocol';
import type {
  WorkspaceSyncConflictListV1,
  WorkspaceSyncConflictV1,
  WorkspaceSyncCopyOnceV1,
  WorkspaceSyncRelationshipV1,
  WorkspaceSyncStatusV1,
} from './workspaceSyncTypes';
import { computeWorkspaceSyncPolicyDigest } from './workspaceSyncTypes';

export type WorkspaceSyncMutagenCommandTransport = (command: MutagenControlCommandV1, signal?: AbortSignal) => Promise<unknown>;
export type WorkspaceSyncMutagenAdapterOptions = Readonly<{
  send: WorkspaceSyncMutagenCommandTransport;
  resolveWorkspaceRef(id: string): WorkspaceSyncResolvedRef | null | Promise<WorkspaceSyncResolvedRef | null>;
  createRequestId?: () => string;
  nowMs?: () => number;
}>;

type GenericEndpoint = Readonly<{ protocol: 'external'; endpointId: string; connected: boolean; scanned: boolean }>;
type GenericConflict = Readonly<{ root: string; alphaChanges: readonly unknown[]; betaChanges: readonly unknown[] }>;
type GenericSession = Readonly<{
  identifier: string;
  name: string;
  labels: Readonly<Record<string, string>>;
  alpha: GenericEndpoint;
  beta: GenericEndpoint;
  mode: 'one-way-safe' | 'one-way-replica' | 'two-way-safe';
  paused: boolean;
  status: string;
  successfulCycles: number;
  conflicts: readonly GenericConflict[];
  excludedConflicts: number;
  ignorePaths: readonly string[];
  lastError?: string;
}>;
type GenericSessionCandidate = Readonly<{ raw: unknown; generic: GenericSession }>;

const statuses = new Set([
  'disconnected', 'halted-on-root-emptied', 'halted-on-root-deletion', 'halted-on-root-type-change',
  'connecting-alpha', 'connecting-beta', 'watching', 'scanning', 'waiting-for-rescan', 'reconciling',
  'staging-alpha', 'staging-beta', 'transitioning', 'saving',
]);
const expectedLabels = (definition: WorkspaceSyncRelationshipV1 | WorkspaceSyncCopyOnceV1) => {
  const id = 'relationshipId' in definition ? definition.relationshipId : definition.operationId;
  return {
    'external.owner': 'happier-workspace-sync',
    'external.relationship_id': id,
    'external.endpoint_role': 'alpha|beta',
    'external.schema': 'workspace-sync-v1',
    'external.policy_digest': definition.contentPolicy.policyDigest,
    'external.alpha_workspace_ref_id': definition.alphaWorkspaceRefId,
    'external.beta_workspace_ref_id': definition.betaWorkspaceRefId,
    'external.controller_machine_id': definition.controllerMachineId,
    'external.operation_kind': 'relationshipId' in definition ? 'relationship' : 'copy_once',
    'external.policy_selection': definition.contentPolicy.selection,
    'external.include_git_directory': String(definition.contentPolicy.includeGitDirectory),
  };
};
const modeByProduct = {
  keep_synced: 'one-way-safe',
  mirror_exactly: 'one-way-replica',
  keep_both_in_sync: 'two-way-safe',
} as const;

function sessionDefinition(
  definition: WorkspaceSyncRelationshipV1 | WorkspaceSyncCopyOnceV1,
): MutagenSessionDefinition {
  const operationId = 'relationshipId' in definition ? definition.relationshipId : definition.operationId;
  const { selection, extraIgnorePatterns, extraIncludePatterns, includeGitDirectory } = definition.contentPolicy;
  return {
    alpha: `external://${deriveWorkspaceSyncEndpointId(operationId, 'alpha')}`,
    beta: `external://${deriveWorkspaceSyncEndpointId(operationId, 'beta')}`,
    mode: 'mode' in definition ? modeByProduct[definition.mode] : 'one-way-safe',
    contentPolicy: { selection, extraIgnorePatterns, extraIncludePatterns, includeGitDirectory },
    name: operationId,
    labels: expectedLabels(definition),
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid generic Mutagen ${name}`);
  return value as Record<string, unknown>;
}
function boundedString(value: unknown, name: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max) throw new Error(`Invalid generic Mutagen ${name}`);
  return value;
}
function boundedCount(value: unknown, name: string): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error(`Invalid generic Mutagen ${name}`);
  return value;
}
function endpoint(value: unknown, name: string): GenericEndpoint {
  const input = record(value, name);
  if (input.protocol !== 'external' || typeof input.connected !== 'boolean' || input.path !== '') {
    throw new Error(`Invalid generic Mutagen ${name}`);
  }
  return {
    protocol: 'external', endpointId: boundedString(input.host, `${name}.host`, 256), connected: input.connected,
    scanned: input.scanned === undefined ? false : input.scanned === true,
  };
}
function conflict(value: unknown): GenericConflict {
  const input = record(value, 'conflict');
  if (!Array.isArray(input.alphaChanges) || !Array.isArray(input.betaChanges)
    || input.alphaChanges.length > 1_000 || input.betaChanges.length > 1_000) throw new Error('Invalid generic Mutagen conflict changes');
  return { root: boundedString(input.root, 'conflict.root'), alphaChanges: input.alphaChanges, betaChanges: input.betaChanges };
}
function session(value: unknown): GenericSession {
  const input = record(value, 'session');
  const labelsInput = record(input.labels, 'session.labels');
  if (Object.keys(labelsInput).length > 16) throw new Error('Invalid generic Mutagen session labels');
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(labelsInput)) labels[boundedString(key, 'label key', 256)] = boundedString(label, 'label value', 256);
  if (input.mode !== 'one-way-safe' && input.mode !== 'one-way-replica' && input.mode !== 'two-way-safe') throw new Error('Invalid generic Mutagen mode');
  const status = boundedString(input.status, 'status', 64);
  if (!statuses.has(status) || typeof input.paused !== 'boolean') throw new Error('Invalid generic Mutagen status');
  const conflicts = input.conflicts === undefined ? [] : input.conflicts;
  if (!Array.isArray(conflicts) || conflicts.length > 1_000) throw new Error('Invalid generic Mutagen conflicts');
  const ignore = record(input.ignore, 'session.ignore');
  if (!Array.isArray(ignore.paths) || ignore.paths.length > 258) throw new Error('Invalid generic Mutagen ignore paths');
  const ignorePaths = ignore.paths.map((path) => boundedString(path, 'session.ignore.paths'));
  return {
    identifier: boundedString(input.identifier, 'identifier', 256), name: boundedString(input.name, 'name', 256), labels,
    alpha: endpoint(input.alpha, 'alpha'), beta: endpoint(input.beta, 'beta'), mode: input.mode, paused: input.paused, status,
    successfulCycles: boundedCount(input.successfulCycles, 'successfulCycles'), conflicts: conflicts.map(conflict),
    excludedConflicts: boundedCount(input.excludedConflicts, 'excludedConflicts'),
    ignorePaths,
    ...(input.lastError === undefined ? {} : { lastError: boundedString(input.lastError, 'lastError') }),
  };
}

function recoverCopyOnceDefinition(generic: GenericSession): WorkspaceSyncCopyOnceV1 | null {
  const labels = generic.labels;
  if (labels['external.owner'] !== 'happier-workspace-sync'
    || labels['external.operation_kind'] !== 'copy_once') return null;
  const operationId = labels['external.relationship_id'];
  const selection = labels['external.policy_selection'];
  const includeGitDirectory = labels['external.include_git_directory'];
  if (!operationId || generic.name !== operationId
    || labels['external.endpoint_role'] !== 'alpha|beta'
    || labels['external.schema'] !== 'workspace-sync-v1'
    || generic.mode !== 'one-way-safe'
    || (selection !== 'git_worktree' && selection !== 'all_files')
    || includeGitDirectory !== 'false'
    || generic.alpha.endpointId !== deriveWorkspaceSyncEndpointId(operationId, 'alpha')
    || generic.beta.endpointId !== deriveWorkspaceSyncEndpointId(operationId, 'beta')) return null;
  const policySelection: 'git_worktree' | 'all_files' = selection;
  const policyDigest = labels['external.policy_digest'];
  const controllerMachineId = labels['external.controller_machine_id'];
  const alphaWorkspaceRefId = labels['external.alpha_workspace_ref_id'];
  const betaWorkspaceRefId = labels['external.beta_workspace_ref_id'];
  if (!policyDigest || !controllerMachineId || !alphaWorkspaceRefId || !betaWorkspaceRefId
    || alphaWorkspaceRefId === betaWorkspaceRefId) return null;
  const paths = generic.ignorePaths;
  if (paths.at(-1) !== '.git/') return null;
  const body = paths.slice(0, -1);
  const candidates: WorkspaceSyncCopyOnceV1[] = [];
  for (let split = 0; split <= body.length; split += 1) {
    let extraIgnorePatterns: readonly string[];
    let extraIncludePatterns: readonly string[];
    if (policySelection === 'git_worktree') {
      if (body[0] !== ':git-worktree-v1' || split < 1) continue;
      const includePaths = body.slice(split);
      if (includePaths.some((path) => !path.startsWith(':git-worktree-include:'))) continue;
      extraIgnorePatterns = body.slice(1, split);
      extraIncludePatterns = includePaths.map((path) => path.slice(':git-worktree-include:'.length));
    } else {
      const includePaths = body.slice(split);
      if (includePaths.some((path) => !path.startsWith('!'))) continue;
      extraIgnorePatterns = body.slice(0, split);
      extraIncludePatterns = includePaths.map((path) => path.slice(1));
    }
    const policyInput = {
      v: 1 as const,
      selection: policySelection,
      extraIgnorePatterns,
      extraIncludePatterns,
      includeGitDirectory: false,
    };
    if (computeWorkspaceSyncPolicyDigest(policyInput) !== policyDigest) continue;
    const candidate = WorkspaceSyncCopyOnceV1Schema.safeParse({
      v: 1,
      operationId,
      controllerMachineId,
      alphaWorkspaceRefId,
      betaWorkspaceRefId,
      contentPolicy: { ...policyInput, policyDigest },
    });
    if (candidate.success) candidates.push(candidate.data);
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

function definitionConflict(message: string): Error {
  return Object.assign(new Error(message), { code: 'relationship_definition_conflict' });
}

function runtimeMismatch(error: Error): Error {
  return Object.assign(new Error(error.message, { cause: error }), { code: 'relationship_runtime_mismatch' });
}

function isIndeterminate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'indeterminate';
}

function entryFromChanges(changes: readonly unknown[]): WorkspaceSyncConflictV1['alpha'] {
  const last = changes.at(-1);
  if (!last) return { kind: 'missing' };
  const change = record(last, 'conflict change');
  const rawEntry = change.new ?? change.old;
  if (rawEntry === null || rawEntry === undefined) return { kind: 'missing' };
  const input = record(rawEntry, 'conflict entry');
  if (input.kind !== 'file' && input.kind !== 'directory' && input.kind !== 'symlink') throw new Error('Invalid generic Mutagen conflict entry kind');
  const digest = input.kind === 'file' && input.digest !== undefined ? boundedString(input.digest, 'conflict digest', 256) : undefined;
  return { kind: input.kind, ...(digest ? { digest } : {}) };
}

export class WorkspaceSyncMutagenAdapterClient implements WorkspaceSyncMutagenAdapter {
  private readonly definitions = new Map<string, WorkspaceSyncRelationshipV1 | WorkspaceSyncCopyOnceV1>();
  /** Runtime-only Mutagen identity, discovered from create/list responses and never persisted. */
  private readonly sessionIdentifiers = new Map<string, string>();
  private readonly successfulCycles = new Map<string, number>();
  private readonly lastSuccessfulSyncAtMs = new Map<string, number>();
  private readonly createRequestId: () => string;
  private readonly nowMs: () => number;

  constructor(private readonly options: WorkspaceSyncMutagenAdapterOptions) {
    this.createRequestId = options.createRequestId ?? randomUUID;
    this.nowMs = options.nowMs ?? Date.now;
  }
  private replaceDefinitions(definitions: readonly WorkspaceSyncRelationshipV1[]): void {
    for (const [id, definition] of this.definitions) {
      if ('relationshipId' in definition) {
        this.definitions.delete(id);
        this.sessionIdentifiers.delete(id);
      }
    }
    for (const definition of definitions) this.definitions.set(definition.relationshipId, definition);
  }
  private requestId(): string { const id = this.createRequestId().trim(); if (!id) throw new Error('Workspace sync request ID is empty'); return id; }
  private async findClaimedSession(identity: string, signal?: AbortSignal): Promise<GenericSessionCandidate | undefined> {
    const listed = await this.options.send({ t: 'list', requestId: this.requestId() }, signal);
    if (!Array.isArray(listed)) {
      throw new Error('Invalid workspace sync list returned by Mutagen adapter');
    }
    const candidates = listed
      .map((raw) => ({ raw, generic: session(raw) }))
      .filter(({ generic }) => generic.name === identity
        || generic.labels['external.relationship_id'] === identity);
    if (candidates.length > 1) {
      throw definitionConflict('Multiple Mutagen sessions claim one workspace sync identity');
    }
    return candidates[0];
  }
  private acceptSession(
    value: unknown,
    definition: WorkspaceSyncRelationshipV1 | WorkspaceSyncCopyOnceV1,
  ): GenericSession {
    const generic = session(value);
    const operationId = 'relationshipId' in definition ? definition.relationshipId : definition.operationId;
    const labels = expectedLabels(definition);
    if (generic.name !== operationId || Object.keys(generic.labels).length !== Object.keys(labels).length
      || Object.entries(labels).some(([key, label]) => generic.labels[key] !== label)
      || generic.alpha.endpointId !== deriveWorkspaceSyncEndpointId(operationId, 'alpha')
      || generic.beta.endpointId !== deriveWorkspaceSyncEndpointId(operationId, 'beta')) throw definitionConflict('Mutagen session identity does not match workspace sync settings');
    const expectedMode = 'mode' in definition ? modeByProduct[definition.mode] : 'one-way-safe';
    if (generic.mode !== expectedMode) throw definitionConflict('Mutagen session mode does not match workspace sync settings');
    const previousIdentifier = this.sessionIdentifiers.get(operationId);
    if (previousIdentifier !== undefined && previousIdentifier !== generic.identifier) {
      throw definitionConflict('Mutagen session identifier changed for an active workspace sync operation');
    }
    this.sessionIdentifiers.set(operationId, generic.identifier);
    return generic;
  }
  private async project(value: unknown, definition: WorkspaceSyncRelationshipV1 | WorkspaceSyncCopyOnceV1, successObservation: 'none' | 'first_cycle' | 'operation'): Promise<WorkspaceSyncStatusV1> {
    const generic = this.acceptSession(value, definition);
    const operationId = 'relationshipId' in definition ? definition.relationshipId : definition.operationId;
    const [alpha, beta] = await Promise.all([
      this.options.resolveWorkspaceRef(definition.alphaWorkspaceRefId), this.options.resolveWorkspaceRef(definition.betaWorkspaceRefId),
    ]);
    if (!alpha || !beta) throw Object.assign(new Error('Workspace sync endpoint is unavailable'), { code: 'peer_unavailable' });
    const previousCycles = this.successfulCycles.get(operationId);
    if (successObservation === 'operation'
      || (successObservation === 'first_cycle' && generic.successfulCycles > 0)
      || (previousCycles !== undefined && generic.successfulCycles > previousCycles)) this.lastSuccessfulSyncAtMs.set(operationId, this.nowMs());
    this.successfulCycles.set(operationId, generic.successfulCycles);
    const conflictCount = generic.conflicts.length + generic.excludedConflicts;
    const halted = generic.status.startsWith('halted-');
    const active = ['scanning', 'reconciling', 'staging-alpha', 'staging-beta', 'transitioning', 'saving'].includes(generic.status);
    const state: WorkspaceSyncStatusV1['state'] = generic.paused ? 'paused'
      : conflictCount > 0 ? 'conflicted'
        : halted || generic.lastError ? 'error'
          : generic.status === 'watching' ? 'watching'
            : generic.status === 'disconnected' ? 'disconnected'
              : active && successObservation === 'operation' ? 'flushing' : 'starting';
    return {
      relationshipId: operationId, controllerMachineId: definition.controllerMachineId, state,
      alphaPath: alpha.rootPath, betaPath: beta.rootPath, mode: 'mode' in definition ? definition.mode : 'copy_once',
      changedFiles: 0, conflictCount, lastSuccessfulSyncAtMs: this.lastSuccessfulSyncAtMs.get(operationId) ?? null,
      ...(generic.lastError ? { errorCode: 'engine_error' } : {}),
    };
  }
  private async reconcileRelationshipState(
    value: unknown,
    relationship: WorkspaceSyncRelationshipV1,
    signal?: AbortSignal,
  ): Promise<WorkspaceSyncStatusV1> {
    const generic = this.acceptSession(value, relationship);
    if (generic.paused === !relationship.enabled) {
      return await this.project(value, relationship, 'none');
    }
    return await this.project(await this.options.send({
      t: relationship.enabled ? 'resume' : 'pause',
      requestId: this.requestId(),
      sessionIdentifier: generic.identifier,
    }, signal), relationship, relationship.enabled ? 'first_cycle' : 'none');
  }
  async discoverCopyOnceRecoveries(signal?: AbortSignal): Promise<readonly WorkspaceSyncCopyOnceV1[]> {
    const value = await this.options.send({ t: 'list', requestId: this.requestId() }, signal);
    if (!Array.isArray(value)) throw new Error('Invalid workspace sync list returned by Mutagen adapter');
    const validById = new Map<string, Readonly<{ definition: WorkspaceSyncCopyOnceV1; sessionIdentifier: string }>>();
    const duplicates = new Set<string>();
    for (const item of value) {
      const generic = session(item);
      if (generic.labels['external.operation_kind'] !== 'copy_once'
        || generic.labels['external.owner'] !== 'happier-workspace-sync') continue;
      const definition = recoverCopyOnceDefinition(generic);
      if (!definition || Object.keys(generic.labels).length !== Object.keys(expectedLabels(definition)).length
        || Object.entries(expectedLabels(definition)).some(([key, label]) => generic.labels[key] !== label)) {
        await this.terminateRuntimeSession(generic.name, generic.identifier, signal);
        continue;
      }
      const previous = validById.get(definition.operationId);
      if (previous || duplicates.has(definition.operationId)) {
        await this.terminateRuntimeSession(definition.operationId, generic.identifier, signal);
        if (previous) {
          await this.terminateRuntimeSession(definition.operationId, previous.sessionIdentifier, signal);
          validById.delete(definition.operationId);
        }
        duplicates.add(definition.operationId);
        continue;
      }
      validById.set(definition.operationId, { definition, sessionIdentifier: generic.identifier });
    }
    for (const { definition, sessionIdentifier } of validById.values()) {
      this.definitions.set(definition.operationId, definition);
      this.sessionIdentifiers.set(definition.operationId, sessionIdentifier);
    }
    return [...validById.values()].map(({ definition }) => definition);
  }
  async ensure(relationship: WorkspaceSyncRelationshipV1, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> {
    this.definitions.set(relationship.relationshipId, relationship);
    try {
      const existing = await this.findClaimedSession(relationship.relationshipId, signal);
      if (existing) {
        try {
          return await this.reconcileRelationshipState(existing.raw, relationship, signal);
        } catch (error) {
          if (!(error instanceof Error)
            || (error as Error & { code?: string }).code !== 'relationship_definition_conflict') {
            throw error;
          }
          await this.terminateRuntimeSession(relationship.relationshipId, existing.generic.identifier, signal);
          throw runtimeMismatch(error);
        }
      }
      return await this.reconcileRelationshipState(await this.options.send({
        t: 'create',
        requestId: this.requestId(),
        session: sessionDefinition(relationship),
      }, signal), relationship, signal);
    } catch (error) {
      this.definitions.delete(relationship.relationshipId);
      throw error;
    }
  }
  async rehydrate(
    definitions: readonly WorkspaceSyncRelationshipV1[],
    signal?: AbortSignal,
  ): Promise<readonly WorkspaceSyncStatusV1[]> {
    this.replaceDefinitions(definitions);
    const value = await this.options.send({ t: 'list', requestId: this.requestId() }, signal);
    if (!Array.isArray(value)) {
      throw new Error('Invalid workspace sync list returned by Mutagen adapter');
    }
    const results: WorkspaceSyncStatusV1[] = [];
    for (const item of value) {
      const generic = session(item);
      const id = generic.labels['external.relationship_id'];
      const persistedClaimId = id && this.definitions.has(id)
        ? id
        : this.definitions.has(generic.name) ? generic.name : undefined;
      if (!id || generic.name !== id
        || generic.labels['external.owner'] !== 'happier-workspace-sync'
        || generic.labels['external.endpoint_role'] !== 'alpha|beta'
        || generic.labels['external.schema'] !== 'workspace-sync-v1'
        || generic.alpha.endpointId !== deriveWorkspaceSyncEndpointId(id, 'alpha')
        || generic.beta.endpointId !== deriveWorkspaceSyncEndpointId(id, 'beta')) {
        if (persistedClaimId) {
          await this.terminateRuntimeSession(persistedClaimId, generic.identifier, signal);
          continue;
        }
        throw definitionConflict('Mutagen session identity is not owned by workspace sync');
      }
      const definition = this.definitions.get(id);
      if (!definition || !('relationshipId' in definition)) {
        await this.terminateRuntimeSession(id, generic.identifier, signal);
        continue;
      }
      try {
        results.push(await this.reconcileRelationshipState(item, definition, signal));
      } catch (error) {
        if (!(error instanceof Error) || (error as Error & { code?: string }).code !== 'relationship_definition_conflict') {
          throw error;
        }
        await this.terminateRuntimeSession(id, generic.identifier, signal);
      }
    }
    return results;
  }
  async copyOnce(operation: WorkspaceSyncCopyOnceV1, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> {
    this.definitions.set(operation.operationId, operation);
    let operationError: unknown;
    let cleanupRequired = false;
    let retainForRecovery = false;
    try {
      const existing = await this.findClaimedSession(operation.operationId, signal);
      if (existing) {
        cleanupRequired = true;
        await this.project(existing.raw, operation, 'none');
        if (existing.generic.successfulCycles > 0) {
          return await this.project(existing.raw, operation, 'operation');
        }
        if (!existing.generic.paused) {
          return await this.project(await this.options.send({
            t: 'flush', requestId: this.requestId(), sessionIdentifier: existing.generic.identifier,
          }, signal), operation, 'operation');
        }
      } else {
        cleanupRequired = true;
        await this.project(await this.options.send({
          t: 'create', requestId: this.requestId(), session: sessionDefinition(operation),
        }, signal), operation, 'none');
      }
      const sessionIdentifier = this.requireSessionIdentifier(operation.operationId);
      await this.project(await this.options.send({
        t: 'resume', requestId: this.requestId(), sessionIdentifier,
      }, signal), operation, 'none');
      return await this.project(await this.options.send({
        t: 'flush', requestId: this.requestId(), sessionIdentifier,
      }, signal), operation, 'operation');
    } catch (error) {
      operationError = error;
      retainForRecovery = isIndeterminate(error);
      throw error;
    } finally {
      if (!retainForRecovery) {
        let cleanupFailure: unknown;
        try {
          if (cleanupRequired) {
            let sessionIdentifier = this.sessionIdentifiers.get(operation.operationId);
            if (!sessionIdentifier) {
              const discovered = await this.findClaimedSession(operation.operationId);
              if (discovered) {
                this.acceptSession(discovered.raw, operation);
                sessionIdentifier = discovered.generic.identifier;
              }
            }
            if (sessionIdentifier) {
              await this.options.send({ t: 'terminate', requestId: this.requestId(), sessionIdentifier });
            }
          }
        } catch (cleanupError) {
          cleanupFailure = cleanupError;
          if (operationError instanceof Error) {
            Object.assign(operationError, { cleanupError });
          }
        }
        if (operationError === undefined && cleanupFailure !== undefined) {
          throw Object.assign(new Error('Workspace copy completed but terminal cleanup is pending'), {
            code: 'indeterminate',
            cleanupError: cleanupFailure,
          });
        }
        this.definitions.delete(operation.operationId);
        this.sessionIdentifiers.delete(operation.operationId);
        this.successfulCycles.delete(operation.operationId);
        this.lastSuccessfulSyncAtMs.delete(operation.operationId);
      }
    }
  }
  async get(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1 | null> {
    const definition = this.definitions.get(relationshipId);
    if (!definition) return null;
    let sessionIdentifier = this.sessionIdentifiers.get(relationshipId);
    if (!sessionIdentifier) {
      const discovered = await this.findClaimedSession(relationshipId, signal);
      if (!discovered) return null;
      this.acceptSession(discovered.raw, definition);
      sessionIdentifier = discovered.generic.identifier;
    }
    const value = await this.options.send({ t: 'get', requestId: this.requestId(), sessionIdentifier }, signal);
    return value === null ? null : await this.project(value, definition, 'none');
  }
  async list(signal?: AbortSignal): Promise<readonly WorkspaceSyncStatusV1[]> {
    const value = await this.options.send({ t: 'list', requestId: this.requestId() }, signal);
    if (!Array.isArray(value)) throw new Error('Invalid workspace sync list returned by Mutagen adapter');
    const results: WorkspaceSyncStatusV1[] = [];
    for (const item of value) {
      const generic = session(item);
      const id = generic.labels['external.relationship_id'];
      const definition = id ? this.definitions.get(id) : undefined;
      if (!definition || !('relationshipId' in definition)) throw definitionConflict('Mutagen session has no exact workspace sync settings owner');
      results.push(await this.project(item, definition, 'none'));
    }
    return results;
  }
  private requireSessionIdentifier(relationshipId: string): string {
    const sessionIdentifier = this.sessionIdentifiers.get(relationshipId);
    if (!sessionIdentifier) {
      throw Object.assign(new Error('Workspace sync relationship runtime is not ready'), { code: 'relationship_not_ready' });
    }
    return sessionIdentifier;
  }
  private async selected(relationshipId: string, command: 'get' | 'flush' | 'pause' | 'resume', signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> {
    const definition = this.definitions.get(relationshipId);
    if (!definition || !('relationshipId' in definition)) throw Object.assign(new Error('Workspace sync relationship is not ready'), { code: 'relationship_not_ready' });
    return await this.project(await this.options.send({
      t: command, requestId: this.requestId(), sessionIdentifier: this.requireSessionIdentifier(relationshipId),
    }, signal), definition, command === 'flush' ? 'operation' : 'none');
  }
  async flush(id: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> { return await this.selected(id, 'flush', signal); }
  async pause(id: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> { return await this.selected(id, 'pause', signal); }
  async resume(id: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1> { return await this.selected(id, 'resume', signal); }
  private async terminateRuntimeSession(relationshipId: string, sessionIdentifier: string, signal?: AbortSignal): Promise<void> {
    await this.options.send({ t: 'terminate', requestId: this.requestId(), sessionIdentifier }, signal);
    this.sessionIdentifiers.delete(relationshipId);
    this.successfulCycles.delete(relationshipId);
    this.lastSuccessfulSyncAtMs.delete(relationshipId);
  }
  async terminate(relationshipId: string, signal?: AbortSignal): Promise<void> {
    const definition = this.definitions.get(relationshipId);
    let sessionIdentifier = this.sessionIdentifiers.get(relationshipId);
    if (!sessionIdentifier && definition) {
      const discovered = await this.findClaimedSession(relationshipId, signal);
      if (discovered) {
        this.acceptSession(discovered.raw, definition);
        sessionIdentifier = discovered.generic.identifier;
      }
    }
    if (sessionIdentifier) await this.terminateRuntimeSession(relationshipId, sessionIdentifier, signal);
    this.definitions.delete(relationshipId);
  }
  async listConflicts(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncConflictListV1> {
    const value = record(await this.options.send({
      t: 'list_conflicts', requestId: this.requestId(), sessionIdentifier: this.requireSessionIdentifier(relationshipId), limit: 100,
    }, signal), 'conflict list');
    if (!Array.isArray(value.conflicts) || value.conflicts.length > 100) throw new Error('Invalid generic Mutagen conflict list');
    const conflicts = value.conflicts.map((item): WorkspaceSyncConflictV1 => {
      const generic = conflict(item);
      return { relationshipId, path: generic.root, alpha: entryFromChanges(generic.alphaChanges), beta: entryFromChanges(generic.betaChanges) };
    });
    const totalCount = boundedCount(value.totalCount, 'totalCount');
    const shownCount = boundedCount(value.shownCount, 'shownCount');
    const truncatedCount = boundedCount(value.truncatedCount, 'truncatedCount');
    if (shownCount !== conflicts.length || totalCount < shownCount || truncatedCount !== totalCount - shownCount) {
      throw new Error('Invalid generic Mutagen conflict counts');
    }
    return { relationshipId, totalCount, shownCount, truncatedCount, conflicts };
  }
}

export function createWorkspaceSyncMutagenAdapter(options: WorkspaceSyncMutagenAdapterOptions): WorkspaceSyncMutagenAdapter {
  return new WorkspaceSyncMutagenAdapterClient(options);
}
