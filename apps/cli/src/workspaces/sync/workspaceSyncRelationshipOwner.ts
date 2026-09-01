import { createHash, randomUUID } from 'node:crypto';

import {
  WorkspaceRefV1Schema,
  areWorkspaceSyncRelationshipDefinitionsEqual,
  type AccountSettingsMutationResult,
  type WorkspaceContentPolicyV1,
  type WorkspaceRefV1,
  type WorkspaceSyncPersistentModeV1,
  type WorkspaceSyncRelationshipV1,
  type WorkspaceSyncStatusV1,
  type HandoffTargetReplacementApprovalV1,
} from '@happier-dev/protocol';

import { materializeWorkspaceRefForMachineRoot } from '@/settings/accountSettings/workspaceRefsV1';
import {
  updateAccountSettingsV2OnceAgainstLatest,
} from '@/settings/accountSettings/updateAccountSettingsV2WithRetry';
import type { StoredCredentials } from '@/persistence';
import { validateWorkspaceSyncRelationship, validateWorkspaceSyncRelationships } from './workspaceSyncSettings';

export type WorkspaceSyncRelationshipSettingsMutation = (
  mutate: (settings: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>,
  signal?: AbortSignal,
) => Promise<AccountSettingsMutationResult>;

type SettingsDocument = Readonly<Record<string, unknown>>;

export type PrepareWorkspaceSyncRelationshipInput = Readonly<{
  operationId: string;
  /** Host-derived Account Home scope; never accepted as a user-entered identity. */
  serverId: string;
  sourceMachineId: string;
  sourceRootPath: string;
  targetMachineId: string;
  targetRootPath: string;
  mode: WorkspaceSyncPersistentModeV1;
  contentPolicy: WorkspaceContentPolicyV1;
  targetBootstrap: 'use_existing' | 'materialize_from_source_workspace';
  targetReplacementApproval?: HandoffTargetReplacementApprovalV1;
  flushBeforeCommit: true;
  signal?: AbortSignal;
}>;

export type PreparedWorkspaceSyncRelationship = Readonly<{
  relationship: WorkspaceSyncRelationshipV1;
  status: WorkspaceSyncStatusV1;
  reused: boolean;
  commit(): Promise<WorkspaceSyncRelationshipV1>;
  abort(): Promise<void>;
}>;

export type MaterializedWorkspaceSyncEndpoints = Readonly<{
  source: WorkspaceRefV1;
  target: WorkspaceRefV1;
}>;

export type WorkspaceSyncRelationshipOwner = Readonly<{
  materializeEndpoints(input: Readonly<{
    serverId: string;
    sourceMachineId: string;
    sourceRootPath: string;
    targetMachineId: string;
    targetRootPath: string;
    signal?: AbortSignal;
  }>): Promise<MaterializedWorkspaceSyncEndpoints>;
  prepareCreate(input: PrepareWorkspaceSyncRelationshipInput): Promise<PreparedWorkspaceSyncRelationship>;
  setEnabled(relationshipId: string, enabled: boolean, signal?: AbortSignal): Promise<void>;
  stop(relationshipId: string, signal?: AbortSignal): Promise<void>;
}>;

export type WorkspaceSyncRelationshipOwnerOptions = Readonly<{
  localMachineId: string;
  mutateSettings: WorkspaceSyncRelationshipSettingsMutation;
  /** Reads the authoritative latest Account Settings document, not a stale UI/cache projection. */
  readSettings(): Promise<SettingsDocument>;
  ensureRelationship(
    definition: WorkspaceSyncRelationshipV1,
    signal?: AbortSignal,
    preparation?: Readonly<{
      transient: true;
      targetBootstrap: 'use_existing' | 'materialize_from_source_workspace';
      targetReplacementApproval?: HandoffTargetReplacementApprovalV1;
    }>,
  ): Promise<WorkspaceSyncStatusV1>;
  flushRelationship(relationshipId: string, signal?: AbortSignal): Promise<WorkspaceSyncStatusV1>;
  commitRelationshipTarget(relationship: WorkspaceSyncRelationshipV1): Promise<void>;
  terminateRelationshipRuntime(relationship: WorkspaceSyncRelationshipV1): Promise<void>;
  waitForSettingsReconciliation(settingsVersion: number, signal?: AbortSignal): Promise<void>;
  createId?: () => string;
  deriveRelationshipId?: (operationId: string) => string;
  nowMs?: () => number;
}>;

function ownerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function isSettledMutation(
  result: AccountSettingsMutationResult,
): result is Extract<AccountSettingsMutationResult, { status: 'applied' | 'satisfied' | 'unchanged' }> {
  return result.status === 'applied' || result.status === 'satisfied' || result.status === 'unchanged';
}

function parseRefs(settings: SettingsDocument): readonly WorkspaceRefV1[] {
  const parsed = WorkspaceRefV1Schema.array().safeParse(settings.workspaceRefsV1 ?? []);
  if (!parsed.success) throw ownerError('workspace_sync_settings_invalid', 'Workspace references are invalid');
  const ids = new Set<string>();
  for (const ref of parsed.data) {
    if (ids.has(ref.id)) throw ownerError('workspace_sync_settings_invalid', 'Workspace reference ids must be unique');
    ids.add(ref.id);
  }
  return parsed.data;
}

function parseRelationships(settings: SettingsDocument): readonly WorkspaceSyncRelationshipV1[] {
  try {
    return validateWorkspaceSyncRelationships(settings.workspaceSyncRelationshipsV1 ?? []);
  } catch (cause) {
    throw ownerError('workspace_sync_settings_invalid', cause instanceof Error ? cause.message : 'Workspace relationships are invalid');
  }
}

function unorderedPairMatches(
  relationship: WorkspaceSyncRelationshipV1,
  alphaRefId: string,
  betaRefId: string,
): boolean {
  return (relationship.alphaWorkspaceRefId === alphaRefId && relationship.betaWorkspaceRefId === betaRefId)
    || (relationship.alphaWorkspaceRefId === betaRefId && relationship.betaWorkspaceRefId === alphaRefId);
}

function definitionsMatchAllowingTwoWayReverse(
  relationship: WorkspaceSyncRelationshipV1,
  requested: WorkspaceSyncRelationshipV1,
): boolean {
  if (areWorkspaceSyncRelationshipDefinitionsEqual(relationship, requested)) return true;
  return relationship.mode === 'keep_both_in_sync'
    && requested.mode === 'keep_both_in_sync'
    && relationship.controllerMachineId === requested.controllerMachineId
    && relationship.alphaWorkspaceRefId === requested.betaWorkspaceRefId
    && relationship.betaWorkspaceRefId === requested.alphaWorkspaceRefId
    && relationship.contentPolicy.policyDigest === requested.contentPolicy.policyDigest;
}

function resolveEndpointPair(
  relationships: readonly WorkspaceSyncRelationshipV1[],
  requested: WorkspaceSyncRelationshipV1,
): WorkspaceSyncRelationshipV1 | null {
  const matches = relationships.filter((relationship) => unorderedPairMatches(
    relationship,
    requested.alphaWorkspaceRefId,
    requested.betaWorkspaceRefId,
  ));
  if (matches.length > 1) throw ownerError('relationship_definition_conflict', 'Multiple relationships own this workspace pair');
  const existing = matches[0];
  if (!existing) return null;
  if (!definitionsMatchAllowingTwoWayReverse(existing, requested)) {
    throw ownerError('relationship_replacement_required', 'This workspace pair already has a different relationship');
  }
  return existing;
}

function mutationFailure(result: AccountSettingsMutationResult): Error & { code: string } {
  if (result.status === 'conflict') return ownerError('workspace_sync_settings_conflict', 'Account Settings changed concurrently');
  if (result.status === 'cancelled') return ownerError('cancelled', 'Workspace relationship mutation was cancelled');
  if (result.status === 'outcomeUnknown') return ownerError('indeterminate', 'Workspace relationship settings outcome is unknown');
  return ownerError('workspace_sync_settings_unavailable', `Workspace relationship settings mutation failed: ${result.status}`);
}

function isIndeterminate(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'indeterminate';
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function sameRelationshipRecord(
  left: WorkspaceSyncRelationshipV1 | undefined,
  right: WorkspaceSyncRelationshipV1 | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined
      && left.v === right.v
      && left.relationshipId === right.relationshipId
      && left.controllerMachineId === right.controllerMachineId
      && left.alphaWorkspaceRefId === right.alphaWorkspaceRefId
      && left.betaWorkspaceRefId === right.betaWorkspaceRefId
      && left.mode === right.mode
      && left.contentPolicy.policyDigest === right.contentPolicy.policyDigest
      && left.enabled === right.enabled
      && left.createdAtMs === right.createdAtMs
      && left.updatedAtMs === right.updatedAtMs;
}

function transitionAndCompensationFailure(
  transitionFailure: unknown,
  compensationFailure: unknown,
): AggregateError & Readonly<{ code: string; cause: unknown }> {
  return Object.assign(
    new AggregateError(
      [transitionFailure, compensationFailure],
      'Workspace relationship transition and compensation both failed',
    ),
    {
      code: errorCode(transitionFailure) ?? 'workspace_sync_transition_failed',
      cause: transitionFailure,
    },
  );
}

function defaultRelationshipId(operationId: string): string {
  return `relationship_${createHash('sha256').update(operationId).digest('hex')}`;
}

/** Production adapter to the one Account Settings compare-and-swap owner. */
export function createAccountSettingsWorkspaceSyncRelationshipMutation(
  credentials: StoredCredentials,
): WorkspaceSyncRelationshipSettingsMutation {
  return async (mutate, signal) => await updateAccountSettingsV2OnceAgainstLatest({
    credentials,
    mutate,
    signal,
  });
}

export function createWorkspaceSyncRelationshipOwner(
  options: WorkspaceSyncRelationshipOwnerOptions,
): WorkspaceSyncRelationshipOwner {
  const createId = options.createId ?? randomUUID;
  const deriveRelationshipId = options.deriveRelationshipId ?? defaultRelationshipId;
  const nowMs = options.nowMs ?? Date.now;

  const materializeEndpoints = async (input: Readonly<{
    serverId: string;
    sourceMachineId: string;
    sourceRootPath: string;
    targetMachineId: string;
    targetRootPath: string;
    signal?: AbortSignal;
  }>): Promise<MaterializedWorkspaceSyncEndpoints> => {
    let sourceRef!: WorkspaceRefV1;
    let targetRef!: WorkspaceRefV1;
    const result = await options.mutateSettings((settings) => {
      const first = materializeWorkspaceRefForMachineRoot(parseRefs(settings), {
        serverId: input.serverId,
        machineId: input.sourceMachineId,
        rootPath: input.sourceRootPath,
        nowMs: nowMs(),
        createId,
      });
      const second = materializeWorkspaceRefForMachineRoot(first.workspaceRefs, {
        serverId: input.serverId,
        machineId: input.targetMachineId,
        rootPath: input.targetRootPath,
        nowMs: nowMs(),
        createId,
      });
      sourceRef = first.workspaceRef;
      targetRef = second.workspaceRef;
      return { ...settings, workspaceRefsV1: second.workspaceRefs };
    }, input.signal);
    if (!isSettledMutation(result)) throw mutationFailure(result);
    const current = await options.readSettings();
    await options.waitForSettingsReconciliation(result.version, input.signal);
    return {
      source: parseRefs(current).find((ref) => ref.id === sourceRef.id) ?? sourceRef,
      target: parseRefs(current).find((ref) => ref.id === targetRef.id) ?? targetRef,
    };
  };

  const mutateDesiredRelationships = async (
    relationshipId: string,
    mutate: (relationships: readonly WorkspaceSyncRelationshipV1[]) => readonly WorkspaceSyncRelationshipV1[],
    signal?: AbortSignal,
  ): Promise<number> => {
    const desiredRelationships: { value: readonly WorkspaceSyncRelationshipV1[] | null } = { value: null };
    const result = await options.mutateSettings((settings) => {
      desiredRelationships.value = mutate(parseRelationships(settings));
      return {
        ...settings,
        workspaceSyncRelationshipsV1: desiredRelationships.value,
      };
    }, signal);
    if (!isSettledMutation(result)) {
      if (result.status === 'outcomeUnknown') {
        const current = parseRelationships(await options.readSettings());
        const present = current.find((relationship) => relationship.relationshipId === relationshipId);
        const expectedPresent = desiredRelationships.value?.find((relationship) => relationship.relationshipId === relationshipId);
        if ((present?.enabled ?? null) === (expectedPresent?.enabled ?? null)) return result.lastKnownVersion;
      }
      throw mutationFailure(result);
    }
    return result.version;
  };

  const transitionDesiredRelationship = async (
    relationshipId: string,
    project: (relationship: WorkspaceSyncRelationshipV1) => WorkspaceSyncRelationshipV1 | null,
    signal?: AbortSignal,
  ): Promise<void> => {
    let previous: WorkspaceSyncRelationshipV1 | undefined;
    let desired: WorkspaceSyncRelationshipV1 | undefined;
    const result = await options.mutateSettings((settings) => {
      const relationships = parseRelationships(settings);
      const matches = relationships.filter((relationship) => relationship.relationshipId === relationshipId);
      if (matches.length !== 1) throw ownerError('relationship_not_ready', 'Workspace relationship is unavailable');
      previous = matches[0]!;
      const projected = project(previous);
      desired = projected ?? undefined;
      return {
        ...settings,
        workspaceSyncRelationshipsV1: projected === null
          ? relationships.filter((relationship) => relationship.relationshipId !== relationshipId)
          : relationships.map((relationship) => relationship.relationshipId === relationshipId ? projected : relationship),
      };
    }, signal);

    let settingsVersion: number;
    if (isSettledMutation(result)) {
      settingsVersion = result.version;
    } else {
      // Direct lifecycle RPCs do not currently carry an action-operation id.
      // A lost settings acknowledgement therefore cannot be promoted to
      // success from a later read or safely compensated under a new identity.
      throw mutationFailure(result);
    }

    try {
      await options.waitForSettingsReconciliation(settingsVersion, signal);
    } catch (transitionFailure) {
      if (isIndeterminate(transitionFailure)) throw transitionFailure;
      try {
        const compensation = await options.mutateSettings((settings) => {
          const relationships = parseRelationships(settings);
          const observed = relationships.find((relationship) => relationship.relationshipId === relationshipId);
          if (sameRelationshipRecord(observed, previous)) return settings;
          if (!sameRelationshipRecord(observed, desired)) {
            throw ownerError(
              'workspace_sync_compensation_conflict',
              'Workspace relationship changed before transition compensation',
            );
          }
          return {
            ...settings,
            workspaceSyncRelationshipsV1: previous === undefined
              ? relationships.filter((relationship) => relationship.relationshipId !== relationshipId)
              : observed === undefined
                ? [...relationships, previous]
                : relationships.map((relationship) => relationship.relationshipId === relationshipId ? previous! : relationship),
          };
        });
        if (!isSettledMutation(compensation)) throw mutationFailure(compensation);
        await options.waitForSettingsReconciliation(compensation.version);
      } catch (compensationFailure) {
        throw transitionAndCompensationFailure(transitionFailure, compensationFailure);
      }
      throw transitionFailure;
    }
  };

  return Object.freeze({
    materializeEndpoints,
    async prepareCreate(input): Promise<PreparedWorkspaceSyncRelationship> {
      input.signal?.throwIfAborted();
      if (input.sourceMachineId !== options.localMachineId) {
        throw ownerError('workspace_sync_controller_mismatch', 'Relationship creation must run on its source controller machine');
      }

      const endpoints = await materializeEndpoints(input);
      const current = await options.readSettings();
      const timestamp = nowMs();
      const candidate = validateWorkspaceSyncRelationship({
        v: 1,
        relationshipId: deriveRelationshipId(input.operationId),
        controllerMachineId: options.localMachineId,
        alphaWorkspaceRefId: endpoints.source.id,
        betaWorkspaceRefId: endpoints.target.id,
        mode: input.mode,
        contentPolicy: input.contentPolicy,
        enabled: true,
        createdAtMs: timestamp,
        updatedAtMs: timestamp,
      });
      const existing = resolveEndpointPair(parseRelationships(current), candidate);
      const relationship = existing ?? candidate;
      const reused = existing !== null;
      const runtimeOwnedByTransaction = existing?.enabled !== true;
      let status: WorkspaceSyncStatusV1;
      try {
        status = await options.ensureRelationship(
          relationship,
          input.signal,
          existing?.enabled === true
            ? undefined
            : {
                transient: true,
                targetBootstrap: input.targetBootstrap,
                ...(input.targetReplacementApproval
                  ? { targetReplacementApproval: input.targetReplacementApproval }
                  : {}),
              },
        );
        status = await options.flushRelationship(relationship.relationshipId, input.signal);
      } catch (error) {
        if (runtimeOwnedByTransaction && !isIndeterminate(error)) await options.terminateRelationshipRuntime(relationship);
        throw error;
      }

      let closed = false;
      let published = false;
      let publishedRelationship = relationship;
      let publishedSettingsVersion: number | null = null;
      let reconciliationComplete = false;
      let targetCommitted = false;
      return Object.freeze({
        relationship,
        status,
        reused,
        async commit(): Promise<WorkspaceSyncRelationshipV1> {
          if (closed) return publishedRelationship;
          let outcomeUnknownThisAttempt = false;
          try {
            if (!published) {
              const result = await options.mutateSettings((settings) => {
                const relationships = parseRelationships(settings);
                const winner = resolveEndpointPair(relationships, relationship);
                if (winner && winner.relationshipId !== relationship.relationshipId) return settings;
                if (winner?.enabled) return settings;
                const committed = winner
                  ? { ...winner, enabled: true, updatedAtMs: nowMs() }
                  : relationship;
                return {
                  ...settings,
                  workspaceSyncRelationshipsV1: winner
                    ? relationships.map((value) => value.relationshipId === winner.relationshipId ? committed : value)
                    : [...relationships, committed],
                };
              }, input.signal);
              if (!isSettledMutation(result)) {
                outcomeUnknownThisAttempt = result.status === 'outcomeUnknown';
                const observed = resolveEndpointPair(parseRelationships(await options.readSettings()), relationship);
                if (!observed) throw mutationFailure(result);
                published = true;
                publishedRelationship = observed;
                publishedSettingsVersion = result.status === 'outcomeUnknown' ? result.lastKnownVersion : null;
                if (observed.relationshipId !== relationship.relationshipId && runtimeOwnedByTransaction) {
                  await options.terminateRelationshipRuntime(relationship);
                }
              } else {
                published = true;
                publishedSettingsVersion = result.version;
              }
            }
            if (!reconciliationComplete && publishedSettingsVersion !== null) {
              await options.waitForSettingsReconciliation(publishedSettingsVersion, input.signal);
              reconciliationComplete = true;
            }
            const committedSettings = await options.readSettings();
            publishedRelationship = resolveEndpointPair(parseRelationships(committedSettings), relationship) ?? publishedRelationship;
            if (publishedRelationship.relationshipId !== relationship.relationshipId && runtimeOwnedByTransaction) {
              await options.terminateRelationshipRuntime(relationship);
              closed = true;
              return publishedRelationship;
            }
            if (!targetCommitted) {
              await options.commitRelationshipTarget(relationship);
              targetCommitted = true;
            }
            return publishedRelationship;
          } catch (error) {
            const failure = !published && outcomeUnknownThisAttempt && !isIndeterminate(error)
              ? ownerError('indeterminate', 'Workspace relationship settings outcome is unknown')
              : error;
            if (!published && runtimeOwnedByTransaction && !isIndeterminate(failure)) {
              await options.terminateRelationshipRuntime(relationship);
              closed = true;
            }
            throw failure;
          }
        },
        async abort(): Promise<void> {
          if (closed) return;
          if (published && runtimeOwnedByTransaction && publishedRelationship.relationshipId === relationship.relationshipId) {
            const rollbackVersion = await mutateDesiredRelationships(relationship.relationshipId, (relationships) => {
              const current = relationships.find((value) => value.relationshipId === relationship.relationshipId);
              if (!current) return relationships;
              if (existing) {
                return relationships.map((value) => value.relationshipId === relationship.relationshipId ? existing : value);
              }
              return relationships.filter((value) => value.relationshipId !== relationship.relationshipId);
            });
            await options.waitForSettingsReconciliation(rollbackVersion);
          }
          if (runtimeOwnedByTransaction) await options.terminateRelationshipRuntime(relationship);
          closed = true;
        },
      });
    },

    async setEnabled(relationshipId, enabled, signal): Promise<void> {
      await transitionDesiredRelationship(
        relationshipId,
        (relationship) => ({ ...relationship, enabled, updatedAtMs: nowMs() }),
        signal,
      );
    },

    async stop(relationshipId, signal): Promise<void> {
      await transitionDesiredRelationship(relationshipId, () => null, signal);
    },
  });
}
