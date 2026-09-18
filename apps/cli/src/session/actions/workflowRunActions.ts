import { createHash, randomBytes as nodeRandomBytes, randomUUID } from 'node:crypto';

import {
  AgentPermissionIntentV1Schema,
  deriveWorkflowSessionInputLocalIdV2,
  EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
  measureExternalActionResultResponseEnvelopeUtf8BytesV1,
  SessionInputCausalPermissionAuthorityV1Schema,
  SessionAgentSpawnPolicyV1StrictSchema,
  WorkflowAcceptedSnapshotV1Schema,
  WorkflowAuthoredInputV1Schema,
  WorkflowActionOutputSchemasV1,
  WorkflowCheckpointEnvelopeV1Schema,
  WorkflowDefinitionV1Schema,
  WorkflowProgressEnvelopeV1Schema,
  WorkflowRunInvocationIndexV1Schema,
  WorkflowRunSummaryV1Schema,
  WorkflowRunAcceptedContextV1Schema,
  StrictJsonValueSchema,
  assertNonEscalatingPermissionMode,
  deriveWorkflowAcceptedPermissionCeilingV1,
  resolveEffectivePermissionMode,
  openWorkflowAcceptedSnapshotStoredEnvelopeV1,
  openWorkflowCheckpointStoredEnvelopeV1,
  openWorkflowFinalResultStoredEnvelopeV1,
  openWorkflowProgressStoredEnvelopeV1,
  parseWorkflowStoredContentEnvelopeV1,
  sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  sealWorkflowCheckpointStoredEnvelopeV1,
  sealWorkflowProgressStoredEnvelopeV1,
  serializeWorkflowStoredContentEnvelopeV1,
  validateWorkflowDefinition,
  sameStrictJsonValue,
  type WorkflowActionExecuteArgs,
  type WorkflowActionIdV1,
  type WorkflowAuthoredInputV1,
  type WorkflowDefinitionV1,
  type WorkflowRunPrivateMetadataV1,
  type WorkflowProgressEnvelopeV1,
  type WorkflowUsageV1,
  type WorkflowIngressContextV1,
  type WorkflowBlock,
  type WorkflowSessionAuthoringSelection,
  type SessionAgentSpawnPolicyV1,
} from '@happier-dev/protocol';
import type { WorkflowAcceptedWorkspaceTargetPreparation, WorkflowWorkspaceRestoreResult } from '@/daemon/workflows/resolveWorkflowWorkspace';
import type { AvailableAutomationAccountEncryptionV1 } from '@/plugins/runtime/automations/automationAccountCurrentness';
import { isAvailableE2eeAutomationAccountEncryptionV1 } from '@/plugins/runtime/automations/automationAccountCurrentness';
import { resolveCanonicalAbsolutePath } from '@/utils/path/expandHomeDirPath';

import type { WorkflowRunActionOwner } from './workflowActionExecutor';

type RunActionId = Extract<WorkflowActionIdV1, `workflow.run.${string}`>;
type RunArgs = { [TActionId in RunActionId]: WorkflowActionExecuteArgs<TActionId> }[RunActionId];
type WorkflowMachineTarget = Extract<NonNullable<RunArgs['context']['externalActionTarget']>, { kind: 'machine' }>;
type WorkflowAcceptedAuthorizationCurrentness = (input: Readonly<{
  authorization: ReturnType<typeof WorkflowAcceptedSnapshotV1Schema.parse>['authorization'];
  signal?: AbortSignal;
}>) => boolean | Promise<boolean>;

function workflowProjectTarget(context: RunArgs['context']): WorkflowMachineTarget['project'] {
  return context.externalActionTarget?.kind === 'machine'
    ? context.externalActionTarget.project
    : undefined;
}

function normalizeProjectTargetForComparison(target: NonNullable<WorkflowMachineTarget['project']>) {
  const resolved = resolveCanonicalAbsolutePath(target.directory);
  if (!resolved) return null;
  return {
    machineId: target.machineId,
    directory: resolved.path,
    ...(target.workspaceRefId ? { workspaceRefId: target.workspaceRefId } : {}),
  };
}

type Storage = Readonly<{
  execute: (operation: Readonly<Record<string, unknown>>, options?: Readonly<{
    signal?: AbortSignal;
    /** Exact daemon machine that is authorized to publish this operation. */
    publisherMachineId?: string;
  }>) => Promise<unknown>;
}>;

type WorkflowCheckpoint = ReturnType<typeof WorkflowCheckpointEnvelopeV1Schema.parse>;

type DefinitionReader = Readonly<{
  get: (input: Readonly<{ definitionId: string }>) => Promise<Readonly<{
    definitionId: string;
    revision: Readonly<{ headerVersion: number; bodyVersion: number }>;
    definition: WorkflowDefinitionV1;
    metadata: ReturnType<typeof WorkflowRunAcceptedContextV1Schema.parse>['metadata'];
  }>>;
}>;

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw workflowError('content_unavailable');
  return value as Readonly<Record<string, unknown>>;
}

function workflowError(code: string, details?: unknown): Error & { code: string; details?: unknown } {
  return Object.assign(new Error(code), { code, ...(details === undefined ? {} : { details }) });
}

function resolvePreparedOriginalInput(progress: WorkflowProgressEnvelopeV1): WorkflowAuthoredInputV1 {
  const prepared = WorkflowAuthoredInputV1Schema.safeParse(progress.input);
  if (prepared.success) return prepared.data;
  throw workflowError('content_unavailable');
}

function normalizeRecoveryInput(
  progress: WorkflowProgressEnvelopeV1,
  input: { kind: 'original' } | { kind: 'replacement'; value: WorkflowAuthoredInputV1 },
): { kind: 'replacement'; value: WorkflowAuthoredInputV1 } {
  return {
    kind: 'replacement',
    value: input.kind === 'original'
      ? resolvePreparedOriginalInput(progress)
      : input.value,
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object'
    && ((error as { response?: { status?: unknown } }).response?.status === 404
      || (error as { code?: unknown }).code === 'run_not_found'));
}

function isIndeterminateWrite(error: unknown): boolean {
  return Boolean(error && typeof error === 'object'
    && !(error as { response?: unknown }).response
    && (error as { code?: unknown }).code !== 'ERR_CANCELED');
}

function deriveWorkflowReplacementId(parts: readonly unknown[]): string {
  const hex = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function openMode(encryption: AvailableAutomationAccountEncryptionV1) {
  return isAvailableE2eeAutomationAccountEncryptionV1(encryption)
    ? { mode: 'e2ee' as const, material: encryption.material.material }
    : { mode: 'plain' as const };
}

function sealMode(encryption: AvailableAutomationAccountEncryptionV1, randomBytes: (length: number) => Uint8Array) {
  return isAvailableE2eeAutomationAccountEncryptionV1(encryption)
    ? { mode: 'e2ee' as const, material: encryption.material.material, randomBytes }
    : { mode: 'plain' as const };
}

function resolveInputs(definition: WorkflowDefinitionV1, supplied: Readonly<Record<string, unknown>> | undefined) {
  const inputs: Record<string, unknown> = {};
  const known = new Set(definition.inputs.map((input) => input.name));
  for (const key of Object.keys(supplied ?? {})) {
    if (!known.has(key)) throw workflowError('invalid_input');
  }
  for (const input of definition.inputs) {
    const value = supplied && Object.prototype.hasOwnProperty.call(supplied, input.name)
      ? supplied[input.name]
      : input.default;
    if (value === undefined) {
      if (input.required) throw workflowError('missing_reference');
      continue;
    }
    if ((input.valueType === 'string' && typeof value !== 'string')
      || (input.valueType === 'number' && typeof value !== 'number')
      || (input.valueType === 'boolean' && typeof value !== 'boolean')) throw workflowError('invalid_input');
    inputs[input.name] = value;
  }
  return inputs;
}

function parseSnapshot(value: unknown) {
  const parsed = record(value);
  return {
    run: WorkflowRunSummaryV1Schema.parse(parsed.run),
    acceptedEnvelope: typeof parsed.acceptedEnvelope === 'string' ? parsed.acceptedEnvelope : (() => { throw workflowError('content_unavailable'); })(),
    checkpointEnvelope: parsed.checkpointEnvelope === null || typeof parsed.checkpointEnvelope === 'string' ? parsed.checkpointEnvelope : (() => { throw workflowError('content_unavailable'); })(),
    resultEnvelope: parsed.resultEnvelope === null || typeof parsed.resultEnvelope === 'string' ? parsed.resultEnvelope : (() => { throw workflowError('content_unavailable'); })(),
  };
}

function principal(args: RunArgs) {
  if (args.context.externalActionCredential) return { kind: 'api' as const, ...args.context.externalActionCredential };
  if (args.context.actionCaller?.kind === 'plugin') return {
    kind: 'plugin' as const,
    pluginId: args.context.actionCaller.pluginId,
    ...(args.context.actionCaller.contributionLocalId ? { contributionLocalId: args.context.actionCaller.contributionLocalId } : {}),
    ...(args.context.actionCaller.immutableGenerationId ? { immutableGenerationId: args.context.actionCaller.immutableGenerationId } : {}),
  };
  return { kind: 'host' as const };
}

function currentControllerAuthorization(args: RunArgs) {
  const causalPresent = Object.prototype.hasOwnProperty.call(args.context, 'causalPermissionAuthority');
  const causal = causalPresent
    ? SessionInputCausalPermissionAuthorityV1Schema.safeParse(args.context.causalPermissionAuthority)
    : null;
  if (causal && !causal.success) throw workflowError('run_access_denied');
  const callerPermission = AgentPermissionIntentV1Schema.safeParse(args.context.callerPermissionMode);
  if (!callerPermission.success) throw workflowError('run_access_denied');
  const callerPermissionMode = callerPermission.data;
  const effective = causal?.success
    ? resolveEffectivePermissionMode({
        currentMode: callerPermissionMode,
        admittedPermissionCeiling: causal.data.admittedPermissionCeiling,
      })
    : { ok: true as const, effectiveMode: callerPermissionMode };
  if (!effective.ok) throw workflowError('run_access_denied');
  return {
    effectivePermissionMode: effective.effectiveMode,
    principal: principal(args),
    ...(causal?.success && causal.data.sourceAuthority ? {
      sourceAuthority: {
        mediatorPluginId: causal.data.sourceAuthority.mediatorPluginId,
        sourceRef: causal.data.sourceAuthority.sourceRef,
        sourceRevisionOrEpoch: causal.data.sourceAuthority.sourceRevisionOrEpoch,
        remoteApprovalMaxScope: causal.data.sourceAuthority.remoteApprovalMaxScope,
      },
    } : {}),
  };
}

function admittedAuthorization(args: RunArgs, definition: WorkflowDefinitionV1) {
  const current = currentControllerAuthorization(args);
  const requiredPermissionCeiling = deriveWorkflowAcceptedPermissionCeilingV1(definition);
  if (!assertNonEscalatingPermissionMode({
    requestedMode: requiredPermissionCeiling,
    callerMode: current.effectivePermissionMode,
  }).ok) throw workflowError('run_access_denied');
  return {
    admittedPermissionCeiling: current.effectivePermissionMode,
    principal: current.principal,
    ...('sourceAuthority' in current ? { sourceAuthority: current.sourceAuthority } : {}),
  };
}

function projectAcceptedContext(accepted: ReturnType<typeof WorkflowAcceptedSnapshotV1Schema.parse>) {
  return WorkflowRunAcceptedContextV1Schema.parse('origin' in accepted
    ? {
        source: accepted.source,
        ...(accepted.metadata ? { metadata: accepted.metadata } : {}),
        inputs: accepted.inputs,
        machineId: accepted.machineId,
        executionTarget: accepted.executionTarget,
        workspaceTarget: accepted.workspaceTarget,
        origin: accepted.origin,
      }
    : {
        source: accepted.source,
        ...(accepted.metadata ? { metadata: accepted.metadata } : {}),
        inputs: accepted.inputs,
        machineId: accepted.machineId,
        executionTarget: accepted.executionTarget,
        workspaceTarget: accepted.workspaceTarget,
      });
}

function workflowUsesDeniedConfiguration(
  definition: WorkflowDefinitionV1,
  policy: SessionAgentSpawnPolicyV1,
  ingressContext: WorkflowIngressContextV1 | undefined,
): boolean {
  const selections: WorkflowSessionAuthoringSelection[] = [definition.defaults];
  const visit = (blocks: readonly WorkflowBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === 'step') {
        if (block.execution) selections.push(block.execution);
        continue;
      }
      if (block.kind === 'parallel') {
        for (const branch of block.branches) visit(branch.blocks);
      } else if (block.kind === 'if') {
        visit(block.then);
        visit(block.otherwise);
      } else {
        visit(block.body);
        if (block.repetition.kind === 'evaluate') visit([block.repetition.evaluator]);
      }
    }
  };
  visit(definition.blocks);

  for (const selection of selections) {
    if (!policy.allowBackendTargetOverride && selection.agentTarget !== undefined
      && JSON.stringify(selection.agentTarget) !== JSON.stringify(ingressContext?.agentTarget)) return true;
    if (!policy.allowModelOverride && selection.modelSelection !== undefined) return true;
    if (!policy.allowPermissionModeOverride && selection.permissionMode !== undefined) return true;
    if (!policy.allowAgentModeOverride && selection.acpSessionModeId !== undefined) return true;
    if (
      !policy.allowConfigOptionOverrides
      && selection.sessionConfigOptionOverrides !== undefined
      && (
        selection.sessionConfigOptionOverrides === null
        || Object.keys(selection.sessionConfigOptionOverrides).length > 0
      )
    ) return true;
    if (!policy.allowProfileOverride && selection.profileId !== undefined) return true;
    if (!policy.allowConnectedServicesOverride && selection.connectedServices !== undefined) return true;
    if (!policy.allowMcpSelectionOverride && selection.mcpSelection !== undefined) return true;
    if (!policy.allowTranscriptStorageOverride && selection.transcriptStorage !== undefined) return true;
  }
  return false;
}

async function assertControllerDominates(
  args: RunArgs,
  accepted: ReturnType<typeof WorkflowAcceptedSnapshotV1Schema.parse>,
  ingressContext: WorkflowIngressContextV1 | undefined,
  isAcceptedAuthorizationCurrent: WorkflowAcceptedAuthorizationCurrentness | undefined,
): Promise<void> {
  // Recompute the complete live caller authority, including causal Session
  // admission. This is a control gate: a narrower caller is rejected rather
  // than silently clamping the Run's immutable admitted ceiling.
  const current = currentControllerAuthorization(args);
  if (!assertNonEscalatingPermissionMode({
    requestedMode: accepted.authorization.admittedPermissionCeiling,
    callerMode: current.effectivePermissionMode,
  }).ok) {
    throw workflowError('run_access_denied');
  }

  if (args.context.authority !== 'present_user') {
    if (JSON.stringify(current.principal) !== JSON.stringify(accepted.authorization.principal)) {
      throw workflowError('run_access_denied');
    }
    if (accepted.authorization.sourceAuthority
      && JSON.stringify('sourceAuthority' in current ? current.sourceAuthority : undefined)
        !== JSON.stringify(accepted.authorization.sourceAuthority)) {
      throw workflowError('run_access_denied');
    }
  }

  const target = args.context.externalActionTarget;
  if (target !== undefined) {
    if (target.kind !== 'machine' || target.machineId !== accepted.machineId) {
      throw workflowError('target_unavailable');
    }
    if (target.project) {
      const requestedProject = normalizeProjectTargetForComparison(target.project);
      const acceptedProject = normalizeProjectTargetForComparison(accepted.workspaceTarget.project);
      if (!requestedProject || !acceptedProject
        || JSON.stringify(requestedProject) !== JSON.stringify(acceptedProject)) {
        throw workflowError('target_unavailable');
      }
    }
  }

  if (args.context.surface === 'agent') {
    const policy = SessionAgentSpawnPolicyV1StrictSchema.safeParse(
      args.context.sessionAgentSpawnPolicyV1,
    );
    if (!policy.success) throw workflowError('run_access_denied');
    if (!policy.data.allowCrossMachine
      && ingressContext?.machineId !== accepted.machineId) throw workflowError('target_unavailable');
    if (!policy.data.allowCustomDirectory) {
      const currentDirectory = ingressContext?.directory
        ? resolveCanonicalAbsolutePath(ingressContext.directory)
        : null;
      const acceptedDirectory = resolveCanonicalAbsolutePath(accepted.workspaceTarget.project.directory);
      if (!currentDirectory || !acceptedDirectory || currentDirectory.path !== acceptedDirectory.path) {
        throw workflowError('target_unavailable');
      }
    }
    if (workflowUsesDeniedConfiguration(accepted.definition, policy.data, ingressContext)) {
      throw workflowError('run_access_denied');
    }
  }

  const hasRevocableAuthority = accepted.authorization.principal.kind !== 'host'
    || accepted.authorization.sourceAuthority !== undefined;
  if ((isAcceptedAuthorizationCurrent
    && !(await isAcceptedAuthorizationCurrent({
      authorization: accepted.authorization,
      signal: args.context.signal,
    })))
    || (!isAcceptedAuthorizationCurrent && hasRevocableAuthority)) {
    throw workflowError('run_access_denied');
  }
}

function translateStorageError(error: unknown): never {
  const responseError = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  if (typeof responseError === 'string' && responseError.length > 0) throw workflowError(responseError);
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && code.length > 0 && !code.startsWith('ERR_') && !code.startsWith('ECONN') && code !== 'AxiosError') {
    throw workflowError(code);
  }
  throw workflowError('content_unavailable');
}

export function createWorkflowRunActionOwner(deps: Readonly<{
  resolveAccountId: (signal?: AbortSignal) => Promise<string>;
  storage: Storage;
  definitions: DefinitionReader;
  resolveEncryption: (signal?: AbortSignal) => Promise<AvailableAutomationAccountEncryptionV1>;
  prepareWorkspace: (input: Readonly<{ projectTarget: NonNullable<WorkflowMachineTarget['project']>; definition: WorkflowDefinitionV1 }>) => Promise<WorkflowAcceptedWorkspaceTargetPreparation>;
  restoreWorkspace?: (workspace: NonNullable<WorkflowProgressEnvelopeV1['workspace']>) => Promise<WorkflowWorkspaceRestoreResult>;
  doesImmediateEligibleStepTargetSession?: (input: Readonly<{
    definition: WorkflowDefinitionV1;
    checkpoint: WorkflowCheckpoint | null;
    executionTarget: ReturnType<typeof WorkflowAcceptedSnapshotV1Schema.parse>['executionTarget'];
    sessionId: string;
  }>) => boolean;
  isAcceptedAuthorizationCurrent?: WorkflowAcceptedAuthorizationCurrentness;
  randomBytes?: (length: number) => Uint8Array;
}>): WorkflowRunActionOwner {
  const encryption = async (signal?: AbortSignal) => await deps.resolveEncryption(signal);
  const getSnapshot = async (runId: string, signal?: AbortSignal, publisherMachineId?: string) => {
    try {
      return parseSnapshot(await deps.storage.execute(
        { operation: 'get', runId },
        { ...(signal ? { signal } : {}), ...(publisherMachineId ? { publisherMachineId } : {}) },
      ));
    } catch (error) {
      if (isNotFound(error)) throw workflowError('run_not_found');
      translateStorageError(error);
    }
  };
  const openAccepted = async (runId: string, signal?: AbortSignal, publisherMachineId?: string) => {
    const accountId = await deps.resolveAccountId(signal);
    const enc = await encryption(signal);
    const snapshot = await getSnapshot(runId, signal, publisherMachineId);
    const envelope = parseWorkflowStoredContentEnvelopeV1(snapshot.acceptedEnvelope);
    if (!envelope) throw workflowError('content_unavailable');
    const opened = openWorkflowAcceptedSnapshotStoredEnvelopeV1({
      ...openMode(enc), binding: { v: 1, purpose: 'accepted_snapshot', accountId, runId }, envelope,
    });
    if (opened.kind !== 'available') throw workflowError('content_unavailable');
    return { accountId, enc, snapshot, accepted: WorkflowAcceptedSnapshotV1Schema.parse(opened.content) };
  };

  const assertWaitDoesNotOccupyTargetConversation = async (args: WorkflowActionExecuteArgs<'workflow.run.wait'>): Promise<number | undefined> => {
    const sessionId = args.context.defaultSessionId ?? undefined;
    if (!sessionId || (args.context.surface !== 'agent' && args.context.surface !== 'mcp')) return undefined;
    const enc = await encryption(args.context.signal);
    const accountId = await deps.resolveAccountId(args.context.signal);
    let cursor: string | undefined;
    do {
      const page = record(await deps.storage.execute({
        operation: 'invocations.list', runId: args.input.runId,
        lifecycles: ['pending', 'waiting_for_capacity', 'admitting', 'running', 'waiting_for_approval', 'needs_attention', 'cancel_requested'],
        ...(cursor ? { cursor } : {}),
        pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
      }, args.context.signal ? { signal: args.context.signal } : {}));
      for (const raw of Array.isArray(page.invocations) ? page.invocations : []) {
        const index = WorkflowRunInvocationIndexV1Schema.parse(raw);
        const detail = record(await deps.storage.execute({
          operation: 'invocations.get', runId: args.input.runId, invocationId: index.id,
        }, args.context.signal ? { signal: args.context.signal } : {}));
        const invocation = record(detail.invocation);
        if (typeof invocation.contentEnvelope !== 'string') throw workflowError('content_unavailable');
        const envelope = parseWorkflowStoredContentEnvelopeV1(invocation.contentEnvelope);
        const opened = envelope && openWorkflowProgressStoredEnvelopeV1({
          ...openMode(enc), envelope,
          binding: {
            v: 1, purpose: 'invocation_progress', accountId, runId: args.input.runId,
            recordId: index.id, sequence: index.sequence, parentRecordId: index.parentRecordId,
            memberOrdinal: index.memberOrdinal, attempt: index.attempt,
          },
        });
        if (!opened || opened.kind !== 'available') throw workflowError('content_unavailable');
        const execution = WorkflowProgressEnvelopeV1Schema.parse(opened.content).execution;
        if (execution?.kind !== 'detached_run' && execution?.sessionId === sessionId) {
          throw workflowError('workflow_wait_self_dependency', { runId: args.input.runId });
        }
      }
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
    } while (cursor);
    if (deps.doesImmediateEligibleStepTargetSession) {
      const opened = await openAccepted(args.input.runId, args.context.signal);
      const checkpoint = await openSnapshotCheckpoint({
        runId: args.input.runId,
        checkpointEnvelope: opened.snapshot.checkpointEnvelope,
        accountId: opened.accountId,
        enc: opened.enc,
        ...(args.context.signal ? { signal: args.context.signal } : {}),
      });
      if (deps.doesImmediateEligibleStepTargetSession({
        definition: opened.accepted.definition,
        checkpoint,
        executionTarget: opened.accepted.executionTarget,
        sessionId,
      })) {
        throw workflowError('workflow_wait_self_dependency', { runId: args.input.runId });
      }
      return opened.snapshot.run.revision;
    }
    return undefined;
  };

  const start = async (args: WorkflowActionExecuteArgs<'workflow.run.start'>, ingressContext?: WorkflowIngressContextV1) => {
    const input = args.input;
    const executionTarget = input.executionTarget ?? { kind: 'session' as const };
    const checkedInline = input.source.kind === 'inline'
      ? validateWorkflowDefinition(
          input.source.definition,
          ingressContext ? { context: ingressContext } : {},
        )
      : undefined;
    const normalizedInline = checkedInline?.normalizedDefinition;
    if (input.source.kind === 'inline' && (!checkedInline?.valid || !normalizedInline)) {
      throw workflowError('invalid_input');
    }
    const projectExisting = async () => {
      const existing = await openAccepted(
        input.runId,
        args.context.signal,
        workflowProjectTarget(args.context)?.machineId,
      );
      const sameSource = input.source.kind === 'inline'
        ? existing.accepted.source.kind === 'inline'
          && normalizedInline !== undefined
          && sameStrictJsonValue(existing.accepted.definition, normalizedInline)
        : existing.accepted.source.kind === 'saved'
          && existing.accepted.source.definitionId === input.source.definitionId
          && sameStrictJsonValue(existing.accepted.source.revision, input.source.revision);
      const expectedMetadata = input.source.kind === 'inline' ? input.metadata : undefined;
      const expectedTarget = workflowProjectTarget(args.context);
      const normalizedExpectedTarget = expectedTarget
        ? normalizeProjectTargetForComparison(expectedTarget)
        : null;
      const acceptedProjectTarget = {
        machineId: existing.accepted.machineId,
        directory: existing.accepted.workspaceTarget.project.directory,
        ...(existing.accepted.workspaceTarget.project.workspaceRefId
          ? { workspaceRefId: existing.accepted.workspaceTarget.project.workspaceRefId }
          : {}),
      };
      if (!sameSource
        || (expectedMetadata !== undefined && !sameStrictJsonValue(existing.accepted.metadata, expectedMetadata))
        || !sameStrictJsonValue(existing.accepted.inputs, resolveInputs(existing.accepted.definition, input.inputs))
        || existing.accepted.executionTarget.kind !== executionTarget.kind
        || Boolean('resultDelivery' in existing.accepted && existing.accepted.resultDelivery) !== Boolean(input.onComplete)
        || !normalizedExpectedTarget
        || !sameStrictJsonValue(acceptedProjectTarget, normalizedExpectedTarget)) {
        throw workflowError('currentness_conflict');
      }
      return WorkflowActionOutputSchemasV1['workflow.run.start'].parse({ run: existing.snapshot.run, admission: 'existing' });
    };
    try {
      return await projectExisting();
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    let definition: WorkflowDefinitionV1;
    let metadata = input.metadata;
    let source: { kind: 'inline' } | { kind: 'saved'; definitionId: string; revision: { headerVersion: number; bodyVersion: number } };
    if (input.source.kind === 'inline') {
      definition = normalizedInline!;
      source = { kind: 'inline' };
    } else {
      let saved: Awaited<ReturnType<DefinitionReader['get']>>;
      try {
        saved = await deps.definitions.get({ definitionId: input.source.definitionId });
      } catch (sourceError) {
        // An admission may commit between the initial missing read and mutable
        // Artifact resolution. Rejoin that immutable effect before surfacing a
        // source edit/deletion failure.
        try {
          return await projectExisting();
        } catch (rejoinError) {
          if (!isNotFound(rejoinError)) throw rejoinError;
          throw sourceError;
        }
      }
      if (!sameStrictJsonValue(saved.revision, input.source.revision)) throw workflowError('currentness_conflict');
      definition = WorkflowDefinitionV1Schema.parse(saved.definition);
      metadata = saved.metadata;
      source = { kind: 'saved', definitionId: input.source.definitionId, revision: input.source.revision };
    }
    const projectTarget = workflowProjectTarget(args.context);
    if (!projectTarget) throw workflowError('target_unavailable');
    const prepared = await deps.prepareWorkspace({ projectTarget, definition });
    if (!prepared.ok) throw workflowError('target_unavailable');
    const originSessionId = args.context.defaultSessionId ?? undefined;
    if (input.onComplete && !originSessionId) throw workflowError('invalid_input');
    const authorization = admittedAuthorization(args, definition);
    const accepted = WorkflowAcceptedSnapshotV1Schema.parse({
      definition, ...(metadata ? { metadata } : {}), source, inputs: resolveInputs(definition, input.inputs), machineId: projectTarget.machineId,
      executionTarget,
      workspaceTarget: prepared.workspaceTarget,
      origin: { kind: 'direct', ...(originSessionId ? { originSessionId } : {}) },
      authorization,
      ...(input.onComplete && originSessionId ? {
        resultDelivery: {
          kind: 'originating_session',
          originSessionId,
          localInputId: deriveWorkflowSessionInputLocalIdV2({ purpose: 'result_delivery', runId: input.runId }),
        },
      } : {}),
    });
    const enc = await encryption(args.context.signal);
    const accountId = await deps.resolveAccountId(args.context.signal);
    const acceptedEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      ...sealMode(enc, deps.randomBytes ?? ((length) => nodeRandomBytes(length))),
      binding: { v: 1, purpose: 'accepted_snapshot', accountId, runId: input.runId }, acceptedSnapshot: accepted,
    }));
    let result: Readonly<Record<string, unknown>>;
    try {
      result = record(await deps.storage.execute({
        operation: 'admit', runId: input.runId, origin: 'origin' in accepted ? accepted.origin : { kind: 'automation', automationId: accepted.source.automationId }, machineId: projectTarget.machineId,
        accountCurrentness: enc.witness, acceptedEnvelope,
        ...(input.onComplete ? { resultDelivery: input.onComplete } : {}),
      }, {
        ...(args.context.signal ? { signal: args.context.signal } : {}),
        publisherMachineId: projectTarget.machineId,
      }));
    } catch (error) {
      const responseCode = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
      const errorCode = (error as { code?: unknown })?.code;
      if (responseCode === 'currentness_conflict' || errorCode === 'currentness_conflict') {
        // Another admission may have won the caller-allocated Run id race. The
        // accepted E2EE envelope is randomized, so only the Action host can
        // reopen the committed snapshot and compare semantic correspondence.
        return await projectExisting();
      }
      translateStorageError(error);
    }
    return WorkflowActionOutputSchemasV1['workflow.run.start'].parse({ run: result.run, admission: result.kind });
  };

  const readPriorProgress = async (
    runId: string,
    invocationId: string,
    resolvedEncryption: Readonly<{
      accountId: string;
      enc: AvailableAutomationAccountEncryptionV1;
    }>,
    signal?: AbortSignal,
  ) => {
    const { accountId, enc } = resolvedEncryption;
    let detail: unknown;
    try {
      detail = await deps.storage.execute({ operation: 'invocations.get', runId, invocationId }, signal ? { signal } : {});
    } catch (error) {
      translateStorageError(error);
    }
    const body = record(detail);
    const invocation = record(body.invocation);
    const index = WorkflowRunInvocationIndexV1Schema.parse(invocation.index);
    const parentRevision = invocation.parentRevision;
    if (!Number.isSafeInteger(parentRevision) || Number(parentRevision) < 0) {
      throw workflowError('content_unavailable');
    }
    if (typeof invocation.contentEnvelope !== 'string') throw workflowError('content_unavailable');
    const envelope = parseWorkflowStoredContentEnvelopeV1(invocation.contentEnvelope);
    const opened = envelope && openWorkflowProgressStoredEnvelopeV1({
      ...openMode(enc),
      envelope,
      binding: {
        v: 1, purpose: 'invocation_progress', accountId, runId,
        recordId: index.id, sequence: index.sequence, parentRecordId: index.parentRecordId,
        memberOrdinal: index.memberOrdinal, attempt: index.attempt,
      },
    });
    if (!opened || opened.kind !== 'available') throw workflowError('content_unavailable');
    return {
      accountId,
      enc,
      index,
      parentRevision: Number(parentRevision),
      progress: WorkflowProgressEnvelopeV1Schema.parse(opened.content),
    };
  };

  const readRunUsage = async (
    runId: string,
    resolvedEncryption: Readonly<{
      accountId: string;
      enc: AvailableAutomationAccountEncryptionV1;
    }>,
    signal?: AbortSignal,
  ): Promise<WorkflowUsageV1 | undefined> => {
    let cursor: string | undefined;
    let applicableExecutions = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let inputTokensComplete = true;
    let outputTokensComplete = true;
    let costUsdComplete = true;

    do {
      const page = record(await deps.storage.execute({
        operation: 'invocations.list',
        runId,
        ...(cursor ? { cursor } : {}),
        pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
      }, signal ? { signal } : {}));
      for (const raw of Array.isArray(page.invocations) ? page.invocations : []) {
        const index = WorkflowRunInvocationIndexV1Schema.parse(raw);
        const { progress } = await readPriorProgress(
          runId,
          index.id,
          resolvedEncryption,
          signal,
        );
        // Execution correspondence is the private admission fact. Containers,
        // skipped leaves and attempts that never reached admission do not
        // contribute a synthetic zero to any usage dimension.
        if (!progress.execution) continue;
        applicableExecutions += 1;

        if (progress.usage?.inputTokens === undefined) {
          inputTokensComplete = false;
        } else if (Number.isSafeInteger(inputTokens + progress.usage.inputTokens)) {
          inputTokens += progress.usage.inputTokens;
        } else {
          inputTokensComplete = false;
        }
        if (progress.usage?.outputTokens === undefined) {
          outputTokensComplete = false;
        } else if (Number.isSafeInteger(outputTokens + progress.usage.outputTokens)) {
          outputTokens += progress.usage.outputTokens;
        } else {
          outputTokensComplete = false;
        }
        if (progress.usage?.costUsd === undefined) {
          costUsdComplete = false;
        } else if (Number.isFinite(costUsd + progress.usage.costUsd)) {
          costUsd += progress.usage.costUsd;
        } else {
          costUsdComplete = false;
        }
      }
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
    } while (cursor);

    if (applicableExecutions === 0) return undefined;
    const usage: WorkflowUsageV1 = {
      ...(inputTokensComplete ? { inputTokens } : {}),
      ...(outputTokensComplete ? { outputTokens } : {}),
      ...(costUsdComplete ? { costUsd } : {}),
    };
    return Object.keys(usage).length === 0 ? undefined : usage;
  };

  const sealProgress = async (params: Readonly<{
    accountId: string;
    runId: string;
    recordId: string;
    sequence: string;
    parentRecordId: string | null;
    memberOrdinal: string;
    attempt: string;
    progress: WorkflowProgressEnvelopeV1;
    enc: AvailableAutomationAccountEncryptionV1;
    signal?: AbortSignal;
  }>): Promise<string> => {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      ...sealMode(params.enc, deps.randomBytes ?? ((length) => nodeRandomBytes(length))),
      binding: {
        v: 1, purpose: 'invocation_progress', accountId: params.accountId, runId: params.runId,
        recordId: params.recordId, sequence: params.sequence, parentRecordId: params.parentRecordId,
        memberOrdinal: params.memberOrdinal, attempt: params.attempt,
      },
      progress: params.progress,
    }));
  };

  const openSnapshotCheckpoint = async (params: Readonly<{
    runId: string;
    checkpointEnvelope: string | null;
    accountId: string;
    enc: AvailableAutomationAccountEncryptionV1;
    signal?: AbortSignal;
  }>): Promise<WorkflowCheckpoint | null> => {
    if (!params.checkpointEnvelope) return null;
    const envelope = parseWorkflowStoredContentEnvelopeV1(params.checkpointEnvelope);
    const opened = envelope && openWorkflowCheckpointStoredEnvelopeV1({
      ...openMode(params.enc),
      binding: { v: 1, purpose: 'checkpoint', accountId: params.accountId, runId: params.runId },
      envelope,
    });
    if (!opened || opened.kind !== 'available') throw workflowError('content_unavailable');
    return WorkflowCheckpointEnvelopeV1Schema.parse(opened.content);
  };

  const sealCheckpoint = async (params: Readonly<{
    runId: string;
    checkpoint: WorkflowCheckpoint;
    accountId: string;
    enc: AvailableAutomationAccountEncryptionV1;
    signal?: AbortSignal;
  }>): Promise<string> => {
    return serializeWorkflowStoredContentEnvelopeV1(sealWorkflowCheckpointStoredEnvelopeV1({
      ...sealMode(params.enc, deps.randomBytes ?? ((length) => nodeRandomBytes(length))),
      binding: { v: 1, purpose: 'checkpoint', accountId: params.accountId, runId: params.runId },
      checkpoint: params.checkpoint,
    }));
  };

  const bumpCheckpointForNewSequences = (checkpoint: WorkflowCheckpoint, lastNewSequence: bigint): WorkflowCheckpoint => ({
    ...checkpoint,
    nextSequence: (lastNewSequence + 1n).toString(),
  });

  const retryInvocation = async (
    args: WorkflowActionExecuteArgs<'workflow.run.invocations.retry'>,
    openedAccepted: Awaited<ReturnType<typeof openAccepted>>,
    ingressContext: WorkflowIngressContextV1 | undefined,
  ) => {
    await assertControllerDominates(args, openedAccepted.accepted, ingressContext, deps.isAcceptedAuthorizationCurrent);
    const signal = args.context.signal;
    const resolvedEncryption = { accountId: openedAccepted.accountId, enc: openedAccepted.enc };
    const prior = await readPriorProgress(
      args.input.runId,
      args.input.invocation.recordId,
      resolvedEncryption,
      signal,
    );
    const stoppedWithUncertainEffects = prior.progress.uncertainPriorEffects?.activity === 'stopped';
    if (prior.index.lifecycle === 'outcome_uncertain'
      || (stoppedWithUncertainEffects && args.input.acknowledgeUncertainPriorEffects !== true)) {
      throw workflowError('workflow_outcome_unresolved');
    }
    if (args.input.acknowledgeUncertainPriorEffects === true && !stoppedWithUncertainEffects) {
      throw workflowError('invalid_input');
    }
    const newAttempt = (BigInt(prior.index.attempt) + 1n).toString();
    const newId = deriveWorkflowReplacementId([
      'workflow.run.invocations.retry',
      args.context.actionRequestId ?? args.input,
      args.input.runId,
      prior.index.id,
      args.input.expectedRevision,
    ]);
    const {
      execution: _priorExecution,
      result: _priorResult,
      containerResult: _priorContainerResult,
      reason: _priorReason,
      observationDeadline: _priorObservationDeadline,
      recovery: _priorRecovery,
      uncertainPriorEffects: _priorUncertainPriorEffects,
      previousAttemptRecordId: _priorPreviousAttemptRecordId,
      ...priorReusableProgress
    } = prior.progress;
    const recoveryInput = normalizeRecoveryInput(prior.progress, args.input.input);
    const progress: WorkflowProgressEnvelopeV1 = {
      ...priorReusableProgress,
      attempt: newAttempt,
      logicalInvocationRecordId: prior.progress.logicalInvocationRecordId,
      previousAttemptRecordId: prior.index.id,
      input: StrictJsonValueSchema.parse(recoveryInput.value),
      recovery: {
        conversation: args.input.conversation,
        input: recoveryInput,
        ...(args.input.acknowledgeUncertainPriorEffects !== undefined ? { acknowledgeUncertainPriorEffects: args.input.acknowledgeUncertainPriorEffects } : {}),
      },
    };
    if (prior.index.lifecycle === 'superseded') {
      try {
        const replacement = await readPriorProgress(args.input.runId, newId, resolvedEncryption, signal);
        const existingCheckpoint = await openSnapshotCheckpoint({
          runId: args.input.runId,
          checkpointEnvelope: openedAccepted.snapshot.checkpointEnvelope,
          ...resolvedEncryption,
          ...(signal ? { signal } : {}),
        });
        if (openedAccepted.snapshot.run.revision === args.input.expectedRevision + 1
          && replacement.parentRevision === openedAccepted.snapshot.run.revision
          && replacement.index.runId === args.input.runId
          && replacement.index.parentRecordId === prior.index.parentRecordId
          && replacement.index.memberOrdinal === prior.index.memberOrdinal
          && replacement.index.attempt === newAttempt
          && replacement.index.lifecycle === 'pending'
          && sameStrictJsonValue(replacement.progress, progress)
          && existingCheckpoint?.nextSequence === (BigInt(replacement.index.sequence) + 1n).toString()) {
          return WorkflowActionOutputSchemasV1['workflow.run.invocations.retry'].parse({
            run: openedAccepted.snapshot.run,
            invocation: replacement.index,
            disposition: 'accepted',
          });
        }
      } catch (error) {
        if ((error as { code?: unknown }).code === 'content_unavailable') throw error;
      }
      throw workflowError('currentness_conflict');
    }
    const checkpoint = await openSnapshotCheckpoint({
      runId: args.input.runId,
      checkpointEnvelope: openedAccepted.snapshot.checkpointEnvelope,
      ...resolvedEncryption,
      ...(signal ? { signal } : {}),
    });
    if (!checkpoint) throw workflowError('content_unavailable');
    const newSequence = checkpoint.nextSequence;
    const checkpointEnvelope = await sealCheckpoint({
      runId: args.input.runId,
      checkpoint: bumpCheckpointForNewSequences(checkpoint, BigInt(checkpoint.nextSequence)),
      ...resolvedEncryption,
      ...(signal ? { signal } : {}),
    });
    const contentEnvelope = await sealProgress({
      accountId: prior.accountId, runId: args.input.runId, recordId: newId, sequence: newSequence,
      parentRecordId: prior.index.parentRecordId, memberOrdinal: prior.index.memberOrdinal, attempt: newAttempt,
      progress, enc: openedAccepted.enc, ...(signal ? { signal } : {}),
    });
    let stored: unknown;
    try {
      stored = await deps.storage.execute({
        operation: 'invocations.retry', runId: args.input.runId, expectedRevision: args.input.expectedRevision,
        accountCurrentness: openedAccepted.enc.witness,
        invocationId: prior.index.id, newInvocationId: newId, checkpointEnvelope, contentEnvelope,
      }, signal ? { signal } : {});
    } catch (error) {
      const code = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
      if (code === 'ineligible_state' || code === 'conflict' || code === 'currentness_conflict') {
        const disposition = code === 'ineligible_state' ? 'ineligible' as const : 'conflict' as const;
        try {
          const fresh = await getSnapshot(args.input.runId, signal);
          return WorkflowActionOutputSchemasV1['workflow.run.invocations.retry'].parse({ run: fresh.run, invocation: prior.index, disposition });
        } catch {
          translateStorageError(error);
        }
      }
      if (isIndeterminateWrite(error)) {
        try {
          const fresh = await openAccepted(args.input.runId, signal);
          const freshEncryption = { accountId: fresh.accountId, enc: fresh.enc };
          const [freshPrior, replacement] = await Promise.all([
            readPriorProgress(args.input.runId, prior.index.id, freshEncryption, signal),
            readPriorProgress(args.input.runId, newId, freshEncryption, signal),
          ]);
          const freshCheckpoint = await openSnapshotCheckpoint({
            runId: args.input.runId,
            checkpointEnvelope: fresh.snapshot.checkpointEnvelope,
            ...freshEncryption,
            ...(signal ? { signal } : {}),
          });
          if (fresh.snapshot.run.revision === args.input.expectedRevision + 1
            && freshPrior.index.lifecycle === 'superseded'
            && replacement.parentRevision === fresh.snapshot.run.revision
            && replacement.index.runId === args.input.runId
            && replacement.index.parentRecordId === prior.index.parentRecordId
            && replacement.index.memberOrdinal === prior.index.memberOrdinal
            && replacement.index.attempt === newAttempt
            && replacement.index.lifecycle === 'pending'
            && replacement.progress.previousAttemptRecordId === prior.index.id
            && sameStrictJsonValue(replacement.progress, progress)
            && freshCheckpoint?.nextSequence === (BigInt(replacement.index.sequence) + 1n).toString()) {
            return WorkflowActionOutputSchemasV1['workflow.run.invocations.retry'].parse({
              run: fresh.snapshot.run,
              invocation: replacement.index,
              disposition: 'accepted',
            });
          }
          throw workflowError('currentness_conflict');
        } catch (rejoinError) {
          if ((rejoinError as { code?: unknown }).code === 'content_unavailable') throw rejoinError;
          throw workflowError('currentness_conflict');
        }
      }
      translateStorageError(error);
    }
    const body = record(stored);
    const disposition = body.disposition === 'existing' ? 'accepted' : body.disposition;
    return WorkflowActionOutputSchemasV1['workflow.run.invocations.retry'].parse({ run: body.run, invocation: body.invocation, disposition });
  };

  const recoverContinuations = async (
    args: WorkflowActionExecuteArgs<'workflow.run.resume'>,
    openedAccepted: Awaited<ReturnType<typeof openAccepted>>,
    ingressContext: WorkflowIngressContextV1 | undefined,
  ) => {
    if (args.input.mode !== 'recover') throw workflowError('continuation_unavailable');
    if (args.input.invocations.some((choice) => choice.kind !== 'reattach')) {
      await assertControllerDominates(args, openedAccepted.accepted, ingressContext, deps.isAcceptedAuthorizationCurrent);
    }
    const restoresWorkspace = args.input.invocations.some((choice) => choice.kind === 'restore_workspace');
    const restoreMachineTarget = args.context.externalActionTarget?.kind === 'machine'
      ? args.context.externalActionTarget
      : null;
    if (restoresWorkspace
      && (!restoreMachineTarget || restoreMachineTarget.machineId !== openedAccepted.accepted.machineId)) {
      throw workflowError('target_unavailable');
    }
    const signal = args.context.signal;
    const resolvedEncryption = { accountId: openedAccepted.accountId, enc: openedAccepted.enc };
    const makeRecoveryProgress = (
      prior: Awaited<ReturnType<typeof readPriorProgress>>,
      choice: (typeof args.input.invocations)[number],
    ): WorkflowProgressEnvelopeV1 => {
      if (choice.kind === 'reattach') throw workflowError('invalid_input');
      const {
        execution: _priorExecution,
        result: _priorResult,
        containerResult: _priorContainerResult,
        reason: _priorReason,
        observationDeadline: _priorObservationDeadline,
        recovery: _priorRecovery,
        uncertainPriorEffects: _priorUncertainPriorEffects,
        previousAttemptRecordId: _priorPreviousAttemptRecordId,
        ...priorReusableProgress
      } = prior.progress;
      const recoveryInput = choice.kind === 'restore_workspace'
        ? normalizeRecoveryInput(
            prior.progress,
            choice.input as { kind: 'original' } | { kind: 'replacement'; value: WorkflowAuthoredInputV1 },
          )
        : {
            kind: 'replacement' as const,
            value: choice.input as WorkflowAuthoredInputV1,
          };
      return {
        ...priorReusableProgress,
        attempt: (BigInt(prior.index.attempt) + 1n).toString(),
        logicalInvocationRecordId: prior.progress.logicalInvocationRecordId,
        previousAttemptRecordId: prior.index.id,
        input: StrictJsonValueSchema.parse(recoveryInput.value),
        recovery: {
          conversation: choice.conversation as 'same_conversation' | 'fresh_agent',
          input: recoveryInput,
          ...(choice.acknowledgeUncertainPriorEffects !== undefined ? { acknowledgeUncertainPriorEffects: true as const } : {}),
        },
      };
    };
    const checkpoint = await openSnapshotCheckpoint({
      runId: args.input.runId,
      checkpointEnvelope: openedAccepted.snapshot.checkpointEnvelope,
      ...resolvedEncryption,
      ...(signal ? { signal } : {}),
    });
    const priors: Array<Awaited<ReturnType<typeof readPriorProgress>>> = [];
    for (const choice of args.input.invocations) {
      const prior = await readPriorProgress(
        args.input.runId,
        choice.invocation.recordId,
        resolvedEncryption,
        signal,
      );
      if (choice.kind === 'reattach') {
        if (!prior.progress.execution
          || !['admitting', 'running', 'waiting_for_approval', 'needs_attention', 'cancel_requested', 'outcome_uncertain'].includes(prior.index.lifecycle)) {
          throw workflowError('continuation_unavailable');
        }
      } else {
        const stoppedWithUncertainEffects = prior.progress.uncertainPriorEffects?.activity === 'stopped';
        if (prior.index.lifecycle === 'outcome_uncertain'
          || (stoppedWithUncertainEffects && choice.acknowledgeUncertainPriorEffects !== true)) {
          throw workflowError('workflow_outcome_unresolved');
        }
        if (choice.acknowledgeUncertainPriorEffects === true && !stoppedWithUncertainEffects) {
          throw workflowError('invalid_input');
        }
        if (choice.kind === 'restore_workspace') {
          // Only the request that still owns the expected Run revision may
          // touch SCM. The +1 case is the deterministic response-loss rejoin
          // below and must observe, never repeat, that filesystem effect.
          if (openedAccepted.snapshot.run.revision !== args.input.expectedRevision) {
            if (openedAccepted.snapshot.run.revision === args.input.expectedRevision + 1
              && prior.index.lifecycle === 'superseded') {
              priors.push(prior);
              continue;
            }
            throw workflowError('currentness_conflict');
          }
          if (prior.progress.reason?.code !== 'workspace_unavailable'
            || !prior.progress.workspace
            || prior.progress.workspace.descriptor?.machineId !== openedAccepted.accepted.machineId) {
            throw workflowError('workflow_workspace_restore_unavailable');
          }
          const restored = await deps.restoreWorkspace?.(prior.progress.workspace)
            ?? { ok: false as const, code: 'workflow_workspace_restore_unavailable' as const };
          if (!restored.ok) throw workflowError(restored.code);
        }
      }
      priors.push(prior);
    }
    if (args.input.invocations.every((choice) => choice.kind === 'reattach')) {
      return WorkflowActionOutputSchemasV1['workflow.run.resume'].parse({
        run: openedAccepted.snapshot.run,
        intent: 'recovery_required',
      });
    }
    const continuing = args.input.invocations.flatMap((choice, index) => choice.kind === 'reattach'
      ? []
      : [{ choice, choiceIndex: index, prior: priors[index]! }]);
    if (continuing.some(({ prior }) => prior.index.lifecycle === 'superseded')) {
      if (!checkpoint
        || continuing.some(({ prior }) => prior.index.lifecycle !== 'superseded')
        || openedAccepted.snapshot.run.revision !== args.input.expectedRevision + 1) {
        throw workflowError('currentness_conflict');
      }
      const replacements = await Promise.all(continuing.map(({ choiceIndex, prior }) => readPriorProgress(
        args.input.runId,
        deriveWorkflowReplacementId(['workflow.run.resume.recover', args.context.actionRequestId ?? args.input, args.input.runId, prior.index.id, choiceIndex, args.input.expectedRevision]),
        resolvedEncryption,
        signal,
      )));
      const exact = continuing.every(({ choice, prior }, index) => {
        const replacement = replacements[index]!;
        return replacement.parentRevision === openedAccepted.snapshot.run.revision
          && replacement.index.runId === args.input.runId
          && replacement.index.parentRecordId === prior.index.parentRecordId
          && replacement.index.memberOrdinal === prior.index.memberOrdinal
          && replacement.index.attempt === (BigInt(prior.index.attempt) + 1n).toString()
          && replacement.index.lifecycle === 'pending'
          && sameStrictJsonValue(replacement.progress, makeRecoveryProgress(prior, choice));
      });
      const lastSequence = replacements.reduce((maximum, replacement) => {
        const sequence = BigInt(replacement.index.sequence);
        return sequence > maximum ? sequence : maximum;
      }, -1n);
      if (!exact || checkpoint.nextSequence !== (lastSequence + 1n).toString()) throw workflowError('currentness_conflict');
      return WorkflowActionOutputSchemasV1['workflow.run.resume'].parse({ run: openedAccepted.snapshot.run, intent: 'resumed' });
    }
    if (!checkpoint) throw workflowError('content_unavailable');
    const start = BigInt(checkpoint.nextSequence);
    const recoveries: Array<{ invocationId: string; newInvocationId: string; contentEnvelope: string }> = [];
    const preparedRecoveries: Array<Readonly<{
      prior: Awaited<ReturnType<typeof readPriorProgress>>;
      newId: string;
      newSequence: string;
      newAttempt: string;
      progress: WorkflowProgressEnvelopeV1;
    }>> = [];
    let nextSequence = start;
    for (const [choiceIndex, choice] of args.input.invocations.entries()) {
      const prior = priors[choiceIndex]!;
      if (choice.kind === 'reattach') {
        continue;
      }
      const newAttempt = (BigInt(prior.index.attempt) + 1n).toString();
      const newId = deriveWorkflowReplacementId([
        'workflow.run.resume.recover',
        args.context.actionRequestId ?? args.input,
        args.input.runId,
        prior.index.id,
        choiceIndex,
        args.input.expectedRevision,
      ]);
      const newSequenceString = nextSequence.toString();
      nextSequence += 1n;
      const progress = makeRecoveryProgress(prior, choice);
      const contentEnvelope = await sealProgress({
        accountId: openedAccepted.accountId, enc: openedAccepted.enc,
        runId: args.input.runId, recordId: newId, sequence: newSequenceString,
        parentRecordId: prior.index.parentRecordId, memberOrdinal: prior.index.memberOrdinal, attempt: newAttempt,
        progress, ...(signal ? { signal } : {}),
      });
      recoveries.push({ invocationId: prior.index.id, newInvocationId: newId, contentEnvelope });
      preparedRecoveries.push({ prior, newId, newSequence: newSequenceString, newAttempt, progress });
    }
    const lastNewSequence = nextSequence - 1n;
    const nextCheckpoint = bumpCheckpointForNewSequences(checkpoint, lastNewSequence);
    const checkpointEnvelope = await sealCheckpoint({
      runId: args.input.runId,
      checkpoint: nextCheckpoint,
      ...resolvedEncryption,
      ...(signal ? { signal } : {}),
    });
    let stored: unknown;
    try {
      stored = await deps.storage.execute({
        operation: 'invocations.recover', runId: args.input.runId, expectedRevision: args.input.expectedRevision,
        accountCurrentness: openedAccepted.enc.witness, checkpointEnvelope, recoveries,
      }, signal ? { signal } : {});
    } catch (error) {
      if (isIndeterminateWrite(error)) {
        try {
          const fresh = await openAccepted(args.input.runId, signal);
          const freshEncryption = { accountId: fresh.accountId, enc: fresh.enc };
          const rows = await Promise.all(preparedRecoveries.flatMap((prepared) => [
            readPriorProgress(args.input.runId, prepared.prior.index.id, freshEncryption, signal),
            readPriorProgress(args.input.runId, prepared.newId, freshEncryption, signal),
          ]));
          const freshCheckpoint = await openSnapshotCheckpoint({
            runId: args.input.runId,
            checkpointEnvelope: fresh.snapshot.checkpointEnvelope,
            ...freshEncryption,
            ...(signal ? { signal } : {}),
          });
          const exact = fresh.snapshot.run.revision === args.input.expectedRevision + 1
            && preparedRecoveries.every((prepared, index) => {
              const freshPrior = rows[index * 2]!;
              const replacement = rows[index * 2 + 1]!;
              return freshPrior.index.lifecycle === 'superseded'
                && replacement.parentRevision === fresh.snapshot.run.revision
                && replacement.index.runId === args.input.runId
                && replacement.index.parentRecordId === prepared.prior.index.parentRecordId
                && replacement.index.memberOrdinal === prepared.prior.index.memberOrdinal
                && replacement.index.sequence === prepared.newSequence
                && replacement.index.attempt === prepared.newAttempt
                && replacement.index.lifecycle === 'pending'
                && replacement.progress.previousAttemptRecordId === prepared.prior.index.id
                && sameStrictJsonValue(replacement.progress, prepared.progress);
            })
            && freshCheckpoint?.nextSequence === nextSequence.toString();
          if (exact) return WorkflowActionOutputSchemasV1['workflow.run.resume'].parse({ run: fresh.snapshot.run, intent: 'resumed' });
          throw workflowError('currentness_conflict');
        } catch (rejoinError) {
          if ((rejoinError as { code?: unknown }).code === 'content_unavailable') throw rejoinError;
          throw workflowError('currentness_conflict');
        }
      }
      translateStorageError(error);
    }
    const body = record(stored);
    return WorkflowActionOutputSchemasV1['workflow.run.resume'].parse({ run: body.run, intent: 'resumed' });
  };

  const execute: WorkflowRunActionOwner['execute'] = async (args, ingressContext) => {
    if (args.actionId === 'workflow.run.start') return await start(args, ingressContext);
    if (args.actionId === 'workflow.run.list') {
      try {
        // `null` is a cached readable-but-untitled Run, distinct from a row this
        // host has not opened yet.
        const metadataCache = new Map<string, WorkflowRunPrivateMetadataV1 | null>();
        const projectPage = async (raw: unknown) => {
          const page = WorkflowActionOutputSchemasV1[args.actionId].parse(raw);
          const metadataByRunId: Record<string, WorkflowRunPrivateMetadataV1> = {};
          for (const run of page.runs) {
            let projected = metadataCache.get(run.id) ?? null;
            if (!metadataCache.has(run.id)) {
              try {
                const opened = await openAccepted(run.id, args.context.signal);
                // An opened snapshot with no authored metadata is an untitled
                // Run, not unreadable private content. The sidecar omits its
                // key so the consumer keeps its ordinary unknown-name state
                // instead of reporting a content-unavailable Run.
                projected = opened.accepted.metadata
                  ? { kind: 'available', value: opened.accepted.metadata }
                  : null;
              } catch {
                // The public row remains useful even when this Account cannot
                // open its private accepted content on the current host.
                projected = { kind: 'unavailable' };
              }
              metadataCache.set(run.id, projected);
            }
            if (projected) metadataByRunId[run.id] = projected;
          }
          return WorkflowActionOutputSchemasV1[args.actionId].parse({
            runs: page.runs,
            metadataByRunId,
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          });
        };
        const fetchPage = async (limit?: number) => await projectPage(await deps.storage.execute({
          operation: 'list',
          request: {
            ...args.input,
            ...(limit === undefined ? {} : { limit: Math.min(args.input.limit ?? limit, limit) }),
          },
          pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES,
        }, args.context.signal ? { signal: args.context.signal } : {}));
        let page = await fetchPage();
        if (measureExternalActionResultResponseEnvelopeUtf8BytesV1(page) <= EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES) {
          return page;
        }
        let low = 1;
        let high = page.runs.length - 1;
        let best: typeof page | null = null;
        while (low <= high) {
          const candidate = await fetchPage(Math.floor((low + high) / 2));
          if (measureExternalActionResultResponseEnvelopeUtf8BytesV1(candidate) <= EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES) {
            best = candidate;
            low = candidate.runs.length + 1;
          } else {
            high = candidate.runs.length - 1;
          }
        }
        if (best) return best;
        throw workflowError('content_unavailable');
      } catch (error) {
        translateStorageError(error);
      }
    }
    if (args.actionId === 'workflow.run.pause' || args.actionId === 'workflow.run.cancel' || args.actionId === 'workflow.run.delete') {
      try {
        return WorkflowActionOutputSchemasV1[args.actionId].parse(await deps.storage.execute({ operation: args.actionId.slice('workflow.run.'.length), ...args.input }, args.context.signal ? { signal: args.context.signal } : {}));
      } catch (error) {
        translateStorageError(error);
      }
    }
    if (args.actionId === 'workflow.run.resume') {
      const restorePublisherMachineId = args.input.mode === 'recover'
        && args.input.invocations.some((choice) => choice.kind === 'restore_workspace')
        && args.context.externalActionTarget?.kind === 'machine'
        ? args.context.externalActionTarget.machineId
        : undefined;
      const opened = await openAccepted(args.input.runId, args.context.signal, restorePublisherMachineId);
      if (args.input.mode === 'boundary') {
        await assertControllerDominates(args, opened.accepted, ingressContext, deps.isAcceptedAuthorizationCurrent);
        try {
          return WorkflowActionOutputSchemasV1[args.actionId].parse(await deps.storage.execute({ operation: 'resume', runId: args.input.runId, expectedRevision: args.input.expectedRevision }, args.context.signal ? { signal: args.context.signal } : {}));
        } catch (error) {
          translateStorageError(error);
        }
      }
      if (args.input.mode === 'recover') {
        return await recoverContinuations(args, opened, ingressContext);
      }
      throw workflowError('continuation_unavailable');
    }
    if (args.actionId === 'workflow.run.get') {
      const { accountId, enc, snapshot, accepted } = await openAccepted(args.input.runId, args.context.signal);
      let checkpoint = null;
      if (snapshot.checkpointEnvelope) {
        const envelope = parseWorkflowStoredContentEnvelopeV1(snapshot.checkpointEnvelope);
        const opened = envelope && openWorkflowCheckpointStoredEnvelopeV1({ ...openMode(enc), binding: { v: 1, purpose: 'checkpoint', accountId, runId: args.input.runId }, envelope });
        if (!opened || opened.kind !== 'available') throw workflowError('content_unavailable');
        checkpoint = WorkflowCheckpointEnvelopeV1Schema.parse(opened.content);
      }
      let result: unknown;
      let finalOutputInvocationId: string | undefined;
      if (snapshot.resultEnvelope) {
        const envelope = parseWorkflowStoredContentEnvelopeV1(snapshot.resultEnvelope);
        const opened = envelope && openWorkflowFinalResultStoredEnvelopeV1({ ...openMode(enc), binding: { v: 1, purpose: 'final_result', accountId, runId: args.input.runId }, envelope });
        if (!opened || opened.kind !== 'available') throw workflowError('content_unavailable');
        result = opened.content.result.value;
        finalOutputInvocationId = opened.content.producerInvocation.recordId;
      }
      const usage = await readRunUsage(
        args.input.runId,
        { accountId, enc },
        args.context.signal,
      );
      return WorkflowActionOutputSchemasV1[args.actionId].parse({
        run: snapshot.run,
        definition: accepted.definition,
        acceptedContext: projectAcceptedContext(accepted),
        checkpoint,
        ...(result === undefined ? {} : { result }),
        ...(finalOutputInvocationId === undefined ? {} : { finalOutputInvocationId }),
        ...(usage === undefined ? {} : { usage }),
        availability: snapshot.run.availability,
      });
    }
    if (args.actionId === 'workflow.run.wait') {
      const waitArgs = args;
      const deadline = args.input.timeoutSeconds === undefined
        ? undefined
        : Date.now() + args.input.timeoutSeconds * 1_000;
      let stored: unknown;
      for (;;) {
        const afterRevision = await assertWaitDoesNotOccupyTargetConversation(waitArgs);
        const timeoutSeconds = deadline === undefined
          ? undefined
          : Math.max(Number.EPSILON, (deadline - Date.now()) / 1_000);
        try {
          stored = await deps.storage.execute({
            operation: 'wait', runId: args.input.runId,
            ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
            ...(afterRevision === undefined ? {} : { afterRevision }),
          }, args.context.signal ? { signal: args.context.signal } : {});
        } catch (error) {
          if (args.context.signal?.aborted) throw args.context.signal.reason;
          translateStorageError(error);
        }
        await assertWaitDoesNotOccupyTargetConversation(waitArgs);
        if (record(stored).observation !== 'changed') break;
      }
      const raw = record(stored);
      if (typeof raw.resultEnvelope !== 'string') return WorkflowActionOutputSchemasV1[args.actionId].parse(raw);
      const enc = await encryption(args.context.signal);
      const accountId = await deps.resolveAccountId(args.context.signal);
      const envelope = parseWorkflowStoredContentEnvelopeV1(raw.resultEnvelope);
      const opened = envelope && openWorkflowFinalResultStoredEnvelopeV1({ ...openMode(enc), binding: { v: 1, purpose: 'final_result', accountId, runId: args.input.runId }, envelope });
      if (!opened || opened.kind !== 'available') throw workflowError('content_unavailable');
      const { resultEnvelope: _ignored, ...base } = raw;
      return WorkflowActionOutputSchemasV1[args.actionId].parse({ ...base, result: opened.content.result.value });
    }
    if (args.actionId === 'workflow.run.invocations.list') {
      try {
        return WorkflowActionOutputSchemasV1[args.actionId].parse(await deps.storage.execute({ operation: 'invocations.list', ...args.input, pageByteLimit: EXTERNAL_ACTION_RESPONSE_MAX_SERIALIZED_BYTES }, args.context.signal ? { signal: args.context.signal } : {}));
      } catch (error) {
        translateStorageError(error);
      }
    }
    if (args.actionId === 'workflow.run.invocations.get') {
      const accountId = await deps.resolveAccountId(args.context.signal);
      const enc = await encryption(args.context.signal);
      const opened = await readPriorProgress(
        args.input.runId,
        args.input.invocationId,
        { accountId, enc },
        args.context.signal,
      );
      return WorkflowActionOutputSchemasV1[args.actionId].parse({
        invocation: {
          index: opened.index,
          progress: opened.progress,
          parentRevision: opened.parentRevision,
        },
      });
    }
    if (args.actionId === 'workflow.run.invocations.retry') {
      const opened = await openAccepted(args.input.runId, args.context.signal);
      return await retryInvocation(
        args,
        opened,
        ingressContext,
      );
    }
    throw workflowError('continuation_unavailable');
  };
  return { execute };
}
