import type {
  AutomationDefinitionCreateRequest, AutomationDefinitionDetail, AutomationDefinitionListResponse,
  AutomationDefinitionReconcileRequest, AutomationTriggerReconcileExistingItem, AutomationDefinitionListRequest,
} from '../../automations/automationApiV3.js';
import { AutomationTriggerIdSchema } from '../../automations/automationTriggerIdentity.js';
import {
  AutomationStoredWorkflowDefinitionV2Schema,
  type AutomationStoredWorkflowDefinitionRecipeV2, type WorkflowTriggerContextV1,
} from '../../automations/automationWorkflowRecipeV2.js';
import { readTriggerTargetV1, type TriggerTargetV1 } from '../../workflows/triggers/triggerTargetV1.js';
import { parseWorkflowDefinitionRefV1 } from '../../workflows/workflowDefinitionRefV1.js';
import { resolveWorkflowRunVisibleTeamV1 } from '../../workflows/workflowRunVisibilityV1.js';
import {
  WorkflowTriggerAddRequestV1Schema, WorkflowTriggerListRequestV1Schema,
  WorkflowTriggerUpdateRequestV1Schema, WorkflowTriggerRemoveRequestV1Schema,
  type WorkflowTriggerAddRequestV1, type WorkflowTriggerListRequestV1,
  type WorkflowTriggerUpdateRequestV1, type WorkflowTriggerRemoveRequestV1,
  type WorkflowTriggerSetV1,
  SessionTriggerListRequestV1Schema, SessionTriggerAddRequestV1Schema,
  SessionTriggerUpdateRequestV1Schema, SessionTriggerRemoveRequestV1Schema,
  type SessionTriggerListRequestV1, type SessionTriggerAddRequestV1,
  type SessionTriggerUpdateRequestV1, type SessionTriggerRemoveRequestV1,
} from '../../workflows/triggers/workflowTriggerActionsV1.js';
import { admitAgentStartV1 } from '../../account/settings/admitAgentStartV1.js';
import { SessionAgentSpawnPolicyV1StrictSchema } from '../../account/settings/sessionAgentSpawnPolicyV1.js';
import { materializeWorkflowAcceptedSnapshotV1, type MaterializeWorkflowAcceptedSnapshotV1Input } from '../../workflows/materializeWorkflowAcceptedSnapshotV1.js';
import { validateWorkflowDefinition } from '../../workflows/workflowValidationV1.js';
import type { WorkflowDefinitionV1 } from '../../workflows/workflowV1.js';
import type { WorkflowActionExecuteArgs } from './types.js';

type Caller = WorkflowActionExecuteArgs['context'];
export type WorkflowTriggerAutomationOperations = Readonly<{
  list: (input: Readonly<Partial<AutomationDefinitionListRequest>>) => Promise<AutomationDefinitionListResponse>;
  get: (automationId: string) => Promise<AutomationDefinitionDetail | null>;
  create: (input: AutomationDefinitionCreateRequest) => Promise<AutomationDefinitionDetail>;
  reconcile: (automationId: string, input: AutomationDefinitionReconcileRequest,
    current?: AutomationDefinitionDetail) => Promise<AutomationDefinitionDetail>;
  delete: (automationId: string) => Promise<void>;
}>;
export type WorkflowTriggerActionsDependencies = Readonly<{
  automations: WorkflowTriggerAutomationOperations;
  openContext: (automation: AutomationDefinitionDetail) => Promise<unknown>;
  sealContext: (input: Readonly<{ automationId: string; templateVersion: number; context: WorkflowTriggerContextV1 }>) => Promise<AutomationStoredWorkflowDefinitionRecipeV2>;
  newId: (kind: 'automation' | 'trigger') => string;
  resolveWorkflow: (ref: string) => Promise<WorkflowDefinitionV1>;
  /** Authorized Artifact grant transport; visibility policy remains shared with Run admission. */
  resolveWorkflowTeamIds?: (artifactId: string) => Promise<readonly string[]>;
  /** Session transport authorizes and opens the Session; callers cannot choose placement. */
  resolveSession?: (sessionId: string, caller?: Caller, options?: Readonly<{ checkNativeGoalOwner: boolean }>) => Promise<Readonly<{
    project: WorkflowTriggerAddRequestV1['project']; nativeGoalOwner: boolean | null;
  }>>;
  resolveRunTrigger?: (runId: string) => Promise<Readonly<{ sessionId: string; triggerId: string }> | null>;
  resolveMaterializer?: (target: WorkflowTriggerAddRequestV1['project'], caller: Caller) => Promise<Pick<MaterializeWorkflowAcceptedSnapshotV1Input, 'effects' | 'roleSelection'>>;
  /** The legacy owner supplies its typed conversion; no second mapping here. */
  convertLegacy?: (automation: AutomationDefinitionDetail) => Promise<Readonly<{ target: TriggerTargetV1; context: WorkflowTriggerContextV1 }>>;
  /** Read projection never grants conversion/write authority or changes retained V1 bytes. */
  readLegacyContext?: (automation: AutomationDefinitionDetail) => Promise<Readonly<{ target: TriggerTargetV1; context: WorkflowTriggerContextV1;
    placements?: NonNullable<WorkflowTriggerSetV1['legacy']>['placements'] }>>;
}>;

function refuse(code: string, details?: unknown): never {
  throw Object.assign(new Error(code), { code, ...(details === undefined ? {} : { details }) });
}
function isAgent(caller?: Caller) {
  return caller?.surface === 'agent' || caller?.actionCaller?.kind === 'workflowRun'
    || caller?.actionCaller?.kind === 'automationRun';
}
function retainedTriggers(row: AutomationDefinitionDetail): AutomationTriggerReconcileExistingItem[] {
  return row.triggers.map((trigger) => ({ kind: 'existing', triggerId: trigger.id, expectedRevision: trigger.revision }));
}

async function automationRows(automations: Pick<WorkflowTriggerAutomationOperations, 'list'>,
  filter: Readonly<Partial<AutomationDefinitionListRequest>>) {
  const rows: AutomationDefinitionListResponse['automations'] = [];
  let cursor: string | undefined;
  do {
    const page = await automations.list({ ...filter, ...(cursor ? { cursor } : {}) });
    rows.push(...page.automations);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}
async function scopedRows(automations: Pick<WorkflowTriggerAutomationOperations, 'list'>, sessionId: string | null = null,
  filter: Readonly<Partial<AutomationDefinitionListRequest>> = {}) {
  return (await automationRows(automations, { ...filter, ...(sessionId ? { scopeSessionId: sessionId } : {}) }))
    .filter((row) => (row.scopeSessionId ?? null) === sessionId);
}

/** Definition deletion needs the Automation census, not private trigger context. */
export async function removeWorkflowTriggersForDefinition(
  automations: Pick<WorkflowTriggerAutomationOperations, 'list' | 'delete'>,
  workflow: string,
): Promise<void> {
  for (const row of await automationRows(automations, { workflowDefinitionId: workflow })) {
    if (row.workflowDefinitionId === workflow) await automations.delete(row.id);
  }
}

/** Trigger semantics compose the one Automation owner; no trigger storage or claim policy lives here. */
export function createWorkflowTriggerActions(deps: WorkflowTriggerActionsDependencies) {
  const read = async (automationId: string, sessionId: string | null = null) => {
    const row = await deps.automations.get(automationId);
    if (!row || (row.scopeSessionId ?? null) !== sessionId) refuse('content_unavailable');
    return row;
  };
  const opened = async (row: AutomationDefinitionDetail, projectionOnly = false): Promise<Readonly<{
    target: TriggerTargetV1; context: WorkflowTriggerContextV1; placements?: NonNullable<WorkflowTriggerSetV1['legacy']>['placements'];
  }>> => {
    if (row.executionRecipe?.v !== 2) {
      if (projectionOnly && deps.readLegacyContext) return deps.readLegacyContext(row);
      if (!deps.convertLegacy) refuse('legacy_conversion_unsupported', { reason: 'runtime_descriptor_unsupported' });
      return deps.convertLegacy(row);
    }
    const context = AutomationStoredWorkflowDefinitionV2Schema.safeParse(await deps.openContext(row));
    const target = readTriggerTargetV1(row, context.success ? context.data : null);
    if (!context.success || target.kind !== 'available') refuse('source_unavailable');
    return { context: context.data, target: target.target };
  };
  const project = (row: AutomationDefinitionDetail, context: WorkflowTriggerContextV1) => {
    if (row.assignments.length !== 1) refuse('source_unavailable');
    return { machineId: row.assignments[0]!.machineId, ...context.workspace };
  };
  const assertTarget = async (target: TriggerTargetV1) => {
    const definition = target.kind === 'inline' ? target.definition : await deps.resolveWorkflow(target.ref);
    const checked = validateWorkflowDefinition(definition);
    if (!checked.valid) refuse('invalid_input', { issues: checked.issues });
  };
  const assertWrite = async (target: TriggerTargetV1, context: WorkflowTriggerContextV1, targetProject: WorkflowTriggerAddRequestV1['project'], caller?: Caller, sessionId?: string) => {
    await assertTarget(target);
    const source = target.kind === 'workflow' ? parseWorkflowDefinitionRefV1(target.ref) : null;
    const resolveTeamIds = deps.resolveWorkflowTeamIds;
    if (source?.kind === 'artifact' && !resolveTeamIds) refuse('target_unavailable');
    const teamIds = source?.kind === 'artifact' && resolveTeamIds ? await resolveTeamIds(source.artifactId) : [];
    const visibility = resolveWorkflowRunVisibleTeamV1(teamIds, context.visibleTeamId);
    if (!visibility.ok) refuse(visibility.code);
    if (source?.kind === 'artifact') context.visibleTeamId = visibility.visibleTeamId;
    if (isAgent(caller)) {
      const authority = caller?.agentStartContext;
      const policy = SessionAgentSpawnPolicyV1StrictSchema.safeParse(caller?.sessionAgentSpawnPolicyV1);
      if (!caller || !authority || !policy.success || !deps.resolveMaterializer) refuse('target_unavailable');
      const definition = target.kind === 'inline' ? target.definition : await deps.resolveWorkflow(target.ref);
      const materializer = await deps.resolveMaterializer(targetProject, caller);
      const materialized = await materializeWorkflowAcceptedSnapshotV1({ definition, ...materializer,
        roleOverrides: context.roleOverrides,
        context: { source: { kind: 'inline' }, inputs: context.inputs ?? {}, machineId: targetProject.machineId,
          executionTarget: context.executionTarget, workspaceTarget: { project: { ...targetProject, checkoutRootPath: targetProject.directory } },
          origin: { kind: 'direct', ...(sessionId ? { originSessionId: sessionId } : {}) }, authorization: { principal: { kind: 'host' } } },
        admission: { kind: 'user' },
      });
      if (!materialized.ok) refuse(materialized.error.code, materialized.error);
      const sourceKeys = new Set(materialized.agentStartLeaves.map((leaf) => leaf.sourceKey ?? '$root'));
      if (sourceKeys.size === 0) sourceKeys.add('$root');
      for (const sourceKey of sourceKeys) {
        const roles = { ...authority.roles };
        for (const leaf of materialized.snapshot.materializedLeaves) {
          if (leaf.sourceKey === sourceKey && leaf.role) roles[leaf.role.roleId] = leaf.role;
        }
        const admitted = admitAgentStartV1(policy.data, { kind: 'trigger_write', scope: sessionId ? 'session' : 'workflow',
          ...(sessionId ? { targetSessionId: sessionId } : {}),
          leaves: materialized.agentStartLeaves.filter((leaf) => (leaf.sourceKey ?? '$root') === sourceKey) }, { ...authority, roles });
        if (!admitted.ok) refuse(admitted.refusal.code, admitted.refusal);
      }
    }
  };
  const projection = async (row: AutomationDefinitionDetail): Promise<WorkflowTriggerSetV1> => {
    const base = { automationId: row.id, revision: row.templateVersion, enabled: row.enabled, triggers: row.triggers,
      ...(row.templateCiphertext !== undefined ? { legacy: { editable: false as const, reason: 'created_in_0_2' as const } } : {}) };
    try {
      const value = await opened(row, true);
      const targetProject = base.legacy && row.assignments.length !== 1 ? undefined : project(row, value.context);
      // Retained templates are readable even when their settings cannot become a current Workflow.
      if (!base.legacy) await assertTarget(value.target);
      return { ...base, ...(base.legacy && 'placements' in value ? { legacy: { ...base.legacy, placements: value.placements } } : {}),
        health: 'available', target: value.target, context: value.context, ...(targetProject ? { project: targetProject } : {}) };
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
      // A retained existing-Session target may have lost its Session. It does not block listing or removal.
      if (code !== 'source_unavailable' && code !== 'invalid_input' && !(base.legacy && code === 'target_unavailable')) throw error;
      return { ...base, health: 'source_unavailable' };
    }
  };
  const writeResult = async (row: AutomationDefinitionDetail, triggerId?: ReturnType<typeof AutomationTriggerIdSchema.parse>) => {
    const trigger = triggerId ? row.triggers.find((item) => item.id === triggerId) : undefined;
    return { set: await projection(row), ...(triggerId ? { triggerId } : {}), ...(trigger ? { triggerRevision: trigger.revision } : {}) };
  };
  const reconcile = async (row: AutomationDefinitionDetail, context: WorkflowTriggerContextV1, target: TriggerTargetV1,
    targetProject: WorkflowTriggerAddRequestV1['project'], changes: Pick<AutomationDefinitionReconcileRequest, 'triggers' | 'removedTriggers'>,
    enabled = row.enabled) => deps.automations.reconcile(row.id, {
      expectedTemplateVersion: row.templateVersion, name: row.name, description: row.description, enabled,
      workflowDefinitionId: target.kind === 'workflow' ? target.ref : null,
      executionRecipe: await deps.sealContext({ automationId: row.id, templateVersion: row.templateVersion + 1, context }),
      assignments: [{ machineId: targetProject.machineId, enabled: row.assignments[0]?.enabled ?? true,
        ...(row.assignments[0]?.priority === undefined ? {} : { priority: row.assignments[0].priority }) }],
      ...changes,
    }, row);
  const actions = {
    list: async (raw: WorkflowTriggerListRequestV1) => {
      const input = WorkflowTriggerListRequestV1Schema.parse(raw);
      const rows = (await scopedRows(deps.automations, null, 'workflow' in input
        ? { workflowDefinitionId: input.workflow } : { scope: 'account_inline' })).filter((row) => 'workflow' in input
        ? row.workflowDefinitionId === input.workflow : row.workflowDefinitionId == null);
      const sets: WorkflowTriggerSetV1[] = [];
      for (const item of rows) {
        const row = await read(item.id);
        if ('scope' in input && row.executionRecipe?.v === 2) {
          // Invalid inline context remains visible as unavailable, rather than disappearing from the Triggers section.
          sets.push(await projection(row));
        } else if ('workflow' in input || row.templateCiphertext !== undefined) {
          sets.push(await projection(row));
        }
      }
      return { sets };
    },
    add: async (raw: WorkflowTriggerAddRequestV1, caller?: Caller, scope?: Readonly<{ sessionId: string; onComplete?: WorkflowTriggerContextV1['onComplete'] }>) => {
      const input = WorkflowTriggerAddRequestV1Schema.parse(raw);
      const target = input.target ?? { kind: 'workflow' as const, ref: input.workflow! };
      const { machineId, ...workspace } = input.project;
      const context = AutomationStoredWorkflowDefinitionV2Schema.parse({ workspace, executionTarget: input.executionTarget ?? { kind: 'session' },
        ...(input.inputs === undefined ? {} : { inputs: input.inputs }), ...(input.roleOverrides === undefined ? {} : { roleOverrides: input.roleOverrides }),
        ...(input.visibleTeamId === undefined ? {} : { visibleTeamId: input.visibleTeamId }),
        ...(scope?.onComplete === undefined ? {} : { onComplete: scope.onComplete }),
        ...(target.kind === 'inline' ? { inlineDefinition: target.definition } : {}) });
      const triggerId = AutomationTriggerIdSchema.parse(deps.newId('trigger'));
      const existing = target.kind === 'workflow' ? (await scopedRows(deps.automations, scope?.sessionId,
        { workflowDefinitionId: target.ref })).find((row) => row.workflowDefinitionId === target.ref) : undefined;
      if (existing) {
        const row = await read(existing.id, scope?.sessionId);
        const current = await opened(row);
        const mergedContext = AutomationStoredWorkflowDefinitionV2Schema.parse({ ...current.context, workspace,
          ...(input.executionTarget === undefined ? {} : { executionTarget: input.executionTarget }),
          ...(input.inputs === undefined ? {} : { inputs: input.inputs }),
          ...(input.visibleTeamId === undefined ? {} : { visibleTeamId: input.visibleTeamId }),
          ...(input.roleOverrides === undefined ? {} : { roleOverrides: input.roleOverrides }) });
        if (scope?.onComplete !== undefined) mergedContext.onComplete = scope.onComplete;
        await assertWrite(target, mergedContext, input.project, caller, scope?.sessionId);
        const committed = await reconcile(row, mergedContext, target, input.project, {
          triggers: [...retainedTriggers(row), { kind: 'new', triggerId, trigger: input.trigger }], removedTriggers: [],
        });
        return writeResult(committed, triggerId);
      }
      await assertWrite(target, context, input.project, caller, scope?.sessionId);
      const automationId = deps.newId('automation');
      const row = await deps.automations.create({ automationId, name: 'Workflow triggers', description: null, enabled: true,
        workflowDefinitionId: target.kind === 'workflow' ? target.ref : null, scopeSessionId: scope?.sessionId ?? null,
        executionRecipe: await deps.sealContext({ automationId, templateVersion: 1, context }),
        assignments: [{ machineId, enabled: true }], triggers: [{ triggerId, trigger: input.trigger }] });
      return writeResult(row, triggerId);
    },
    update: async (raw: WorkflowTriggerUpdateRequestV1, caller?: Caller, scope?: Readonly<{ sessionId: string; onComplete?: WorkflowTriggerContextV1['onComplete'] }>) => {
      const input = WorkflowTriggerUpdateRequestV1Schema.parse(raw);
      const row = await read(input.automationId, scope?.sessionId);
      if (row.templateVersion !== input.expectedRevision) refuse('currentness_conflict', { revision: row.templateVersion });
      if (input.triggerId && !row.triggers.some((item) => item.id === input.triggerId)) refuse('content_unavailable');
      const current = await opened(row);
      const { target: nextTarget, project: nextProject, enabled, trigger, ...contextPatch } = input.patch;
      const target = nextTarget ?? current.target;
      if (!scope && current.target.kind === 'workflow' && nextTarget && (nextTarget.kind !== 'workflow' || nextTarget.ref !== current.target.ref)) refuse('invalid_input');
      const targetProject = nextProject ?? project(row, current.context);
      const { machineId: _machineId, ...workspace } = targetProject;
      const { inlineDefinition: _inlineDefinition, ...previous } = current.context;
      const context = AutomationStoredWorkflowDefinitionV2Schema.parse({ ...previous, ...contextPatch, workspace,
        ...(scope?.onComplete === undefined ? {} : { onComplete: scope.onComplete }),
        ...(target.kind === 'inline' ? { inlineDefinition: target.definition } : {}) });
      if (target.kind === 'inline' && context.visibleTeamId !== undefined) refuse('invalid_input');
      await assertWrite(target, context, targetProject, caller, scope?.sessionId);
      const triggers = retainedTriggers(row).map((item) => item.triggerId === input.triggerId
        ? { ...item, ...(enabled === undefined ? {} : { enabled }), ...(trigger === undefined ? {} : { trigger }) } : item);
      return writeResult(await reconcile(row, context, target, targetProject, { triggers, removedTriggers: [] },
        input.triggerId === undefined && enabled !== undefined ? enabled : row.enabled), input.triggerId);
    },
    remove: async (raw: WorkflowTriggerRemoveRequestV1, sessionId?: string) => {
      const input = WorkflowTriggerRemoveRequestV1Schema.parse(raw);
      const row = await read(input.automationId, sessionId);
      const trigger = row.triggers.find((item) => item.id === input.triggerId);
      if (!trigger) return writeResult(row, input.triggerId);
      // Removing a missing-source trigger needs no private source or materializer.
      const committed = await deps.automations.reconcile(row.id, {
        expectedTemplateVersion: row.templateVersion, name: row.name, description: row.description, enabled: row.enabled,
        assignments: row.assignments.map(({ machineId, enabled, priority }) => ({ machineId, enabled, priority })),
        triggers: retainedTriggers(row).filter((item) => item.triggerId !== input.triggerId),
        removedTriggers: [{ triggerId: trigger.id, expectedRevision: trigger.revision }],
      }, row);
      return writeResult(committed, input.triggerId);
    },
    removeForWorkflow: (workflow: string) => removeWorkflowTriggersForDefinition(deps.automations, workflow),
  };
  const session = async (sessionId: string, caller?: Caller, ownRemoval = false) => {
    if (isAgent(caller) && !ownRemoval) {
      const authority = caller?.agentStartContext;
      const policy = SessionAgentSpawnPolicyV1StrictSchema.safeParse(caller?.sessionAgentSpawnPolicyV1);
      if (!authority || !policy.success) refuse('target_unavailable');
      if (authority.caller.kind === 'originless') refuse('run_access_denied');
      const admitted = admitAgentStartV1(policy.data, { kind: 'session_target', targetSessionId: sessionId }, authority);
      if (!admitted.ok) refuse(admitted.refusal.code, admitted.refusal);
    }
    if (!deps.resolveSession) refuse('target_unavailable');
    return deps.resolveSession(sessionId, caller, { checkNativeGoalOwner: false });
  };
  const findScoped = async (sessionId: string, triggerId: string) => {
    const row = (await scopedRows(deps.automations, sessionId)).find((row) => row.triggers.some((trigger) => trigger.id === triggerId));
    if (!row) refuse('content_unavailable');
    return read(row.id, sessionId);
  };
  const assertScopedTrigger = (trigger: WorkflowTriggerAddRequestV1['trigger'], sessionId: string) => {
    // Session PR/CI sources require the Channel binding and its permission
    // evidence. The generic Event writer cannot establish either authority.
    if (trigger.kind === 'pluginEvent') refuse('target_unavailable');
    if (trigger.kind === 'sessionLifecycle') {
      if (trigger.events.includes('sessionStarted')) refuse('session_already_started');
      if (trigger.sourceSessionId !== sessionId) refuse('invalid_input');
    }
  };
  const assertContinuationOwner = async (target: TriggerTargetV1, sessionId: string, caller?: Caller) => {
    if (target.kind !== 'workflow' || target.ref !== 'builtin:keep-going') return;
    if (!deps.resolveSession) refuse('target_unavailable');
    const { nativeGoalOwner } = await deps.resolveSession(sessionId, caller, { checkNativeGoalOwner: true });
    if (nativeGoalOwner === true) refuse('native_goal_owner');
    if (nativeGoalOwner === null) refuse('target_unavailable');
  };
  return { ...actions,
    add: (raw: WorkflowTriggerAddRequestV1, caller?: Caller) => actions.add(raw, caller),
    update: (raw: WorkflowTriggerUpdateRequestV1, caller?: Caller) => actions.update(raw, caller),
    remove: (raw: WorkflowTriggerRemoveRequestV1) => actions.remove(raw),
    sessionList: async (raw: SessionTriggerListRequestV1, caller?: Caller) => {
      const input = SessionTriggerListRequestV1Schema.parse(raw);
      await session(input.sessionId, caller);
      const sets: WorkflowTriggerSetV1[] = [];
      for (const row of await scopedRows(deps.automations, input.sessionId)) sets.push(await projection(await read(row.id, input.sessionId)));
      return { sets, pullRequestLinks: [] };
    },
    sessionAdd: async (raw: SessionTriggerAddRequestV1, caller?: Caller) => {
      const { sessionId, onComplete, ...input } = SessionTriggerAddRequestV1Schema.parse(raw);
      const authorized = await session(sessionId, caller);
      await assertContinuationOwner(input.target, sessionId, caller);
      assertScopedTrigger(input.trigger, sessionId);
      return actions.add({ ...input, project: authorized.project }, caller, { sessionId, onComplete });
    },
    sessionUpdate: async (raw: SessionTriggerUpdateRequestV1, caller?: Caller) => {
      const input = SessionTriggerUpdateRequestV1Schema.parse(raw);
      const authorized = await session(input.sessionId, caller);
      const row = await findScoped(input.sessionId, input.triggerId);
      // Retained Event rows cannot bypass the Channel binding/permission
      // prerequisite by changing only their enablement or set context.
      if (row.triggers.some((trigger) => trigger.kind === 'pluginEvent')) refuse('target_unavailable');
      const current = await opened(row);
      await assertContinuationOwner(input.patch.target ?? current.target, input.sessionId, caller);
      if (input.patch.trigger) assertScopedTrigger({ ...input.patch.trigger, enabled: input.patch.enabled ?? true }, input.sessionId);
      const { onComplete, ...patch } = input.patch;
      return actions.update({ automationId: row.id, triggerId: input.triggerId, expectedRevision: input.expectedRevision,
        patch: { ...patch, project: authorized.project } }, caller, { sessionId: input.sessionId, onComplete });
    },
    sessionRemove: async (raw: SessionTriggerRemoveRequestV1, caller?: Caller) => {
      const input = SessionTriggerRemoveRequestV1Schema.parse(raw);
      const runId = caller?.actionCaller?.kind === 'workflowRun' ? caller.actionCaller.runId
        : caller?.actionCaller?.kind === 'automationRun' ? caller.actionCaller.runId : undefined;
      if (runId) {
        const firing = await deps.resolveRunTrigger?.(runId);
        if (!firing || firing.sessionId !== input.sessionId || firing.triggerId !== input.triggerId) refuse('run_access_denied');
      }
      await session(input.sessionId, caller, runId !== undefined);
      const row = await findScoped(input.sessionId, input.triggerId);
      return actions.remove({ automationId: row.id, triggerId: input.triggerId }, input.sessionId);
    },
  };
}
export type WorkflowTriggerActions = ReturnType<typeof createWorkflowTriggerActions>;
