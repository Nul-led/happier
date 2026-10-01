import { describe, expect, it } from 'vitest';
import { AutomationTriggerIdSchema } from '../../automations/automationTriggerIdentity.js';
import type { AutomationDefinitionDetail, AutomationTriggerDetail } from '../../automations/automationApiV3.js';
import { WorkflowDefinitionV1Schema } from '../../workflows/workflowV1.js';
import { resolveWorkflowDefinitionRefV1 } from '../../workflows/workflowDefinitionResolverV1.js';
import { createWorkflowTriggerActions, type WorkflowTriggerActionsDependencies } from './workflowTriggerActions.js';
import { createWorkflowDefinitionActions, type WorkflowDefinitionArtifactOperations } from './workflowDefinitions.js';
import { DEFAULT_SESSION_AGENT_SPAWN_POLICY_V1 } from '../../account/settings/sessionAgentSpawnPolicyV1.js';
import { createWorkflowActionExecutor } from './workflowAccountActions.js';
import { createActionExecutor } from '../actionExecutor.js';
import type { ActionExecutorContext } from './types.js';
import { ApprovalRequestV2Schema, type ApprovalRequest } from '../../approvals/approvalRequestV1.js';

const definition = WorkflowDefinitionV1Schema.parse({ version: 1,
  defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } } },
  blocks: [{ kind: 'step', id: 'prompt', document: { text: 'Review', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
});
const trigger = { kind: 'schedule' as const, enabled: true,
  schedule: { kind: 'interval' as const, scheduleExpr: null, everyMs: 60_000, timezone: null } };
const project = { machineId: 'machine-one', directory: '/workspace' };
const workflow = '11111111-1111-4111-8111-111111111111';
const ownCaller = { surface: 'agent' as const, sessionAgentSpawnPolicyV1: DEFAULT_SESSION_AGENT_SPAWN_POLICY_V1,
  agentStartContext: { caller: { kind: 'session' as const, sessionId: 'session-one', starterDepth: 0, turnDepth: 0 },
    baseline: { ...project, configuration: { agentTarget: definition.defaults!.agentTarget! } }, ledSubtreeSessionIds: [],
    workDepthLimit: 4, roles: {}, callerPermissionCeiling: 'default' as const } };

function fixture() {
  // These operations are the persistent/network Automation boundary; all Action semantics and validation run real.
  const rows = new Map<string, AutomationDefinitionDetail>();
  let nextId = 0;
  const artifact = { artifactId: workflow, ownerAccountId: 'owner', access: 'owner' as const,
    header: { kind: 'workflow-definition.v1', definitionId: workflow,
      revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Review' } },
    body: JSON.stringify({ kind: 'workflow-definition.v1', definition }), revision: { headerVersion: 1, bodyVersion: 1 } };
  const artifacts = new Map([[workflow, artifact]]);
  // Artifact reads/writes are the external persistent boundary; resolution and validation stay real.
  const artifactStore: WorkflowDefinitionArtifactOperations = {
    read: async (id) => artifacts.get(id) ?? null,
    list: async () => ({ items: [] }),
    create: async () => { throw new Error('Unexpected fixture Artifact write'); },
    update: async () => { throw new Error('Unexpected fixture Artifact write'); },
    delete: async (id) => { artifacts.delete(id); return { ok: true }; },
  };
  const definitions = createWorkflowDefinitionActions({ artifactStore,
    encodeListCursor: (row) => row.artifactId, assertDefinitionWriteAllowed: () => { throw new Error('Unexpected fixture definition policy write'); } });
  const toTrigger = (id: string): AutomationTriggerDetail => ({ ...trigger, id: AutomationTriggerIdSchema.parse(id),
    revision: 0, createdAt: 1, updatedAt: 1, nextRunAt: 2, triggerDefinitionEnvelope: null });
  const deps: WorkflowTriggerActionsDependencies = {
    newId: (kind) => `${kind}-${++nextId}`,
    resolveWorkflow: async (ref) => {
      const source = await resolveWorkflowDefinitionRefV1(ref, { readArtifact: (definitionId) => definitions.get({ definitionId }) });
      if (!source) throw Object.assign(new Error('source_unavailable'), { code: 'source_unavailable' });
      return source.definition;
    },
    resolveWorkflowTeamIds: async () => [],
    openContext: async (row) => row.executionRecipe?.v === 2 && row.executionRecipe.workflow.t === 'plain' ? row.executionRecipe.workflow.v : null,
    sealContext: async ({ templateVersion, context }) => ({ v: 2, templateVersion, workflow: { t: 'plain', v: context }, triggerEvidence: null }),
    automations: {
      list: async () => ({ automations: [...rows.values()], nextCursor: null }),
      get: async (id) => rows.get(id) ?? null,
      create: async (input) => {
        const row: AutomationDefinitionDetail = { id: input.automationId, name: input.name, description: input.description ?? null,
          enabled: input.enabled, targetType: null, existingSessionId: null, templateVersion: 1, lastRunAt: null, createdAt: 1, updatedAt: 1,
          workflowDefinitionId: input.workflowDefinitionId ?? null, scopeSessionId: input.scopeSessionId ?? null,
          assignments: (input.assignments ?? []).map((value) => ({ machineId: value.machineId, enabled: value.enabled ?? true, priority: value.priority ?? 0, updatedAt: 1 })),
          triggers: input.triggers.map((value) => toTrigger(value.triggerId)), executionRecipe: input.executionRecipe };
        rows.set(row.id, row); return row;
      },
      reconcile: async (id, input) => {
        const current = rows.get(id)!;
        if (current.templateVersion !== input.expectedTemplateVersion) throw Object.assign(new Error('conflict'), { code: 'currentness_conflict' });
        const triggers = input.triggers.map((item): AutomationTriggerDetail => {
          if (item.kind === 'new') return toTrigger(item.triggerId);
          const old = current.triggers.find((value) => value.id === item.triggerId)!;
          return { ...old, ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
            ...(item.enabled === undefined && item.trigger === undefined ? {} : { revision: old.revision + 1 }) };
        });
        const row: AutomationDefinitionDetail = { ...current,
          templateVersion: input.executionRecipe === undefined ? current.templateVersion : current.templateVersion + 1, enabled: input.enabled,
          assignments: input.assignments.map((value) => ({ machineId: value.machineId, enabled: value.enabled ?? true, priority: value.priority ?? 0, updatedAt: 1 })),
          workflowDefinitionId: input.workflowDefinitionId === undefined ? current.workflowDefinitionId : input.workflowDefinitionId,
          executionRecipe: input.executionRecipe ?? current.executionRecipe, triggers };
        rows.set(id, row); return row;
      },
      delete: async (id) => { rows.delete(id); },
    },
  };
  return { rows, deps, actions: createWorkflowTriggerActions(deps), loseSource: () => { artifacts.delete(workflow); } };
}

describe('workflow trigger Automation composition', () => {
  it('keeps a Session caller under agent policy through Account trigger approval and replay', async () => {
    const { deps, rows } = fixture();
    const triggers = createWorkflowTriggerActions({ ...deps,
      resolveSession: async () => ({ project, nativeGoalOwner: false }),
      resolveMaterializer: async () => ({ effects: { resolveTargetAvailability: async () => true } }) });
    const definitions = createWorkflowDefinitionActions({ artifactStore: {
      list: async () => ({ items: [] }), read: async () => null,
      create: async () => { throw new Error('Unexpected Artifact write'); },
      update: async () => { throw new Error('Unexpected Artifact write'); }, delete: async () => ({ ok: true }),
    }, encodeListCursor: (row) => row.artifactId, assertDefinitionWriteAllowed: async () => undefined });
    let storedRequest: ApprovalRequest | null = null;
    const observations: ActionExecutorContext[] = [];
    const executor = createActionExecutor({ workflowAction: createWorkflowActionExecutor({
      isWorkflowFeatureEnabled: () => true, definitions, triggers,
      runs: { execute: async () => { throw new Error('Unexpected Run write'); } },
    }),
      approvalsCreate: async ({ request }) => {
        storedRequest = ApprovalRequestV2Schema.parse(JSON.parse(JSON.stringify(request)));
        return { artifactId: 'session-agent-approval' };
      },
      approvalsGet: async () => storedRequest,
      approvalsUpdate: async ({ request }) => { storedRequest = request; return { ok: true }; },
      isApprovalExecutionOriginCurrent: async ({ origin }) => origin.caller.kind === 'session'
        && origin.caller.sessionId === 'session-one',
      // Account trigger approval is mandatory even when configurable policy waives it.
      isActionApprovalRequired: () => false,
      resolveAgentStartContext: async () => ownCaller.agentStartContext,
      observeActionExecution: async ({ context }) => { observations.push(context); },
    });
    const context: ActionExecutorContext = { ...ownCaller, surface: 'cli', authority: 'account_automation',
      serverId: 'home-one', defaultSessionId: 'untrusted-default', callerPermissionMode: 'default',
      actionCaller: { kind: 'session', sessionId: 'session-one' } };
    expect(await executor.execute('workflow.trigger.list', { scope: 'account_inline' }, context)).toMatchObject({ ok: true, result: { sets: [] } });
    expect(await executor.execute('session.trigger.add', {
      sessionId: 'foreign-session', target: { kind: 'inline', definition }, trigger,
    }, context)).toMatchObject({ ok: false });
    expect(rows.size).toBe(0);
    expect(await executor.execute('session.trigger.add', {
      sessionId: 'session-one', target: { kind: 'inline', definition }, trigger,
    }, context)).toMatchObject({ ok: true, result: { set: { health: 'available' } } });
    expect(rows.size).toBe(1);
    expect(observations.at(-1)).toMatchObject({ surface: 'agent', defaultSessionId: 'session-one',
      actionCaller: { kind: 'session', sessionId: 'session-one' } });
    expect(await executor.execute('workflow.trigger.add', {
      target: { kind: 'inline', definition }, project, trigger,
    }, context)).toMatchObject({ ok: true, result: { kind: 'approval_request_created' } });
    expect(rows.size).toBe(1);
    expect(storedRequest).toMatchObject({ executionOriginV1: { surface: 'agent',
      caller: { kind: 'session', sessionId: 'session-one' } } });
    expect(await executor.execute('approval.request.decide', {
      artifactId: 'session-agent-approval', decision: 'approve',
    }, { surface: 'ui', authority: 'present_user', serverId: 'home-one' })).toMatchObject({ ok: true });
    expect(rows.size).toBe(2);
    expect(storedRequest).toMatchObject({ status: 'executed', execution: { ok: true } });
    expect(observations.findLast((entry) => entry.bypassApprovals)).toMatchObject({ surface: 'agent',
      defaultSessionId: 'session-one', actionCaller: { kind: 'session', sessionId: 'session-one' } });
  });
  it('validates and retains the selected Team before add or update', async () => {
    const { deps, rows } = fixture();
    const actions = createWorkflowTriggerActions({ ...deps, resolveWorkflowTeamIds: async () => ['team-one', 'team-two'] });
    for (const visibleTeamId of [undefined, null, 'ungranted']) {
      await expect(actions.add({ workflow, project, trigger, ...(visibleTeamId === undefined ? {} : { visibleTeamId }) }))
        .rejects.toMatchObject({ code: 'visible_team_not_granted' });
    }
    expect(rows.size).toBe(0);
    const added = await actions.add({ workflow, project, trigger, visibleTeamId: 'team-two' });
    expect(added.set.context?.visibleTeamId).toBe('team-two');
    await expect(actions.update({ automationId: added.set.automationId, expectedRevision: added.set.revision,
      patch: { visibleTeamId: 'ungranted' } })).rejects.toMatchObject({ code: 'visible_team_not_granted' });
    expect(rows.get(added.set.automationId)?.templateVersion).toBe(1);
    const updated = await actions.update({ automationId: added.set.automationId, expectedRevision: added.set.revision, patch: { enabled: false } });
    expect(updated.set.context?.visibleTeamId).toBe('team-two');
  });
  it('does not project current one-shot recipes as predecessor Workflow triggers', async () => {
    const { rows, actions } = fixture();
    const added = await actions.add({ target: { kind: 'inline', definition }, project, trigger });
    const row = rows.get(added.set.automationId)!;
    rows.set(row.id, { ...row, targetType: 'newSession', executionRecipe: {
      v: 1, templateVersion: 1, template: { t: 'plain', v: { v: 1, prompt: 'Review retained prompt' } }, triggerEvidence: null,
      target: { kind: 'newSession', spawn: { executionTarget: { serverId: 'source-server', machineId: project.machineId },
        directory: { kind: 'path', path: project.directory }, agentTarget: definition.defaults!.agentTarget! } },
    } });
    const listed = await actions.list({ scope: 'account_inline' });
    expect(listed.sets).toEqual([]);
    expect(rows.get(row.id)?.executionRecipe?.v).toBe(1);
  });
  it('excludes Session-scoped rows from the Account-inline census', async () => {
    const { actions, rows } = fixture();
    const scoped = await actions.add({ target: { kind: 'inline', definition }, project, trigger });
    const row = rows.get(scoped.set.automationId)!;
    rows.set(row.id, { ...row, scopeSessionId: 'session-owned' });
    const account = await actions.add({ target: { kind: 'inline', definition }, project, trigger });
    expect((await actions.list({ scope: 'account_inline' })).sets.map((set) => set.automationId)).toEqual([account.set.automationId]);
  });
  it('reuses the workflow set without resetting its frozen run context when another trigger is added', async () => {
    const { actions, rows } = fixture();
    const first = await actions.add({ workflow, project, trigger, executionTarget: { kind: 'detached_run' }, inputs: { repository: 'repo' } });
    const second = await actions.add({ workflow, project, trigger });
    expect(rows.size).toBe(1);
    expect(second.set.automationId).toBe(first.set.automationId);
    expect(second.set.triggers).toHaveLength(2);
    expect(second.set.context).toMatchObject({ executionTarget: { kind: 'detached_run' }, inputs: { repository: 'repo' } });
  });
  it('keeps inline definitions only in their payload and changes machine and workspace in one set write', async () => {
    const { actions, rows } = fixture();
    const added = await actions.add({ target: { kind: 'inline', definition }, project, trigger });
    expect(rows.get(added.set.automationId)?.workflowDefinitionId).toBeNull();
    expect((await actions.list({ scope: 'account_inline' })).sets[0]?.target).toEqual({ kind: 'inline', definition });
    const updated = await actions.update({ automationId: added.set.automationId, expectedRevision: added.set.revision,
      patch: { project: { machineId: 'machine-two', directory: '/other' } } });
    expect(updated.set.project).toEqual({ machineId: 'machine-two', directory: '/other' });
    expect(rows.get(added.set.automationId)?.assignments.map((assignment) => assignment.machineId)).toEqual(['machine-two']);
    await expect(actions.update({ automationId: added.set.automationId, expectedRevision: added.set.revision, patch: { enabled: false } }))
      .rejects.toMatchObject({ code: 'currentness_conflict', details: { revision: updated.set.revision } });
    expect(rows.get(added.set.automationId)?.enabled).toBe(true);
  });
  it('shows missing sources and still removes their final trigger without deleting the Manual set', async () => {
    const { actions, rows, loseSource } = fixture();
    const added = await actions.add({ workflow, project, trigger });
    loseSource();
    expect((await actions.list({ workflow })).sets[0]?.health).toBe('source_unavailable');
    const removed = await actions.remove({ automationId: added.set.automationId, triggerId: added.triggerId! });
    expect(removed.set.triggers).toEqual([]);
    expect(rows.size).toBe(1);
    await actions.removeForWorkflow(workflow);
    expect(rows.size).toBe(0);
  });
  it('deletes every Account and Session trigger set referencing a deleted Artifact', async () => {
    const { deps, rows } = fixture();
    const actions = createWorkflowTriggerActions({ ...deps, resolveSession: async () => ({ project, nativeGoalOwner: false }) });
    await actions.add({ workflow, project, trigger });
    await actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'workflow', ref: workflow }, trigger });
    await actions.sessionAdd({ sessionId: 'session-two', target: { kind: 'inline', definition }, trigger });
    await actions.removeForWorkflow(workflow);
    expect([...rows.values()]).toMatchObject([{ scopeSessionId: 'session-two', workflowDefinitionId: null }]);
  });
  it('admits Account agent add/update through the same materialized ORC trigger policy', async () => {
    const { deps, rows } = fixture();
    const actions = createWorkflowTriggerActions({ ...deps,
      resolveMaterializer: async () => ({ effects: { resolveTargetAvailability: async () => true } }) });
    const added = await actions.add({ target: { kind: 'inline', definition }, project, trigger }, ownCaller);
    expect(added.set.health).toBe('available');
    const updated = await actions.update({ automationId: added.set.automationId, expectedRevision: added.set.revision,
      patch: { enabled: false } }, ownCaller);
    expect(updated.set.enabled).toBe(false);
    await expect(actions.add({ workflow, project, trigger }, { ...ownCaller,
      agentStartContext: { ...ownCaller.agentStartContext, caller: { ...ownCaller.agentStartContext.caller, turnDepth: 4 } },
    })).rejects.toMatchObject({ code: 'work_depth_exceeded' });
    expect(rows.size).toBe(1);
  });
  it('keeps transient source reads retryable in the trigger list', async () => {
    const { deps } = fixture();
    const actions = createWorkflowTriggerActions(deps);
    await actions.add({ workflow, project, trigger });
    const failure = Object.assign(new Error('Home unavailable'), { code: 'ECONNRESET' });
    const reader = createWorkflowTriggerActions({ ...deps, resolveWorkflow: async () => { throw failure; } });
    await expect(reader.list({ workflow })).rejects.toBe(failure);
  });
  it('uses the Automation owner filters for workflow, inline and scoped reads and deletion', async () => {
    const { deps } = fixture();
    const inputs: unknown[] = [];
    const actions = createWorkflowTriggerActions({ ...deps, automations: { ...deps.automations,
      list: async (input) => { inputs.push(input); return { automations: [], nextCursor: null }; } },
      resolveSession: async () => ({ project, nativeGoalOwner: false }) });
    await actions.list({ workflow });
    await actions.list({ scope: 'account_inline' });
    await actions.sessionList({ sessionId: 'session-one' });
    await actions.removeForWorkflow(workflow);
    expect(inputs).toEqual([{ workflowDefinitionId: workflow }, { scope: 'account_inline' },
      { scopeSessionId: 'session-one' }, { workflowDefinitionId: workflow }]);
  });
  it('refuses agent writes when materialized trigger policy is absent', async () => {
    const { actions, rows } = fixture();
    await expect(actions.add({ target: { kind: 'inline', definition }, project, trigger }, { surface: 'agent' }))
      .rejects.toMatchObject({ code: 'target_unavailable' });
    expect(rows.size).toBe(0);
  });
  it('attaches, lists, updates and removes scoped triggers using the authorized Session placement', async () => {
    const { deps, rows } = fixture();
    const actions = createWorkflowTriggerActions({ ...deps, resolveSession: async () => ({ project, nativeGoalOwner: false }) });
    const added = await actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'inline', definition }, trigger,
      onComplete: { kind: 'originating_session' } });
    expect(rows.get(added.set.automationId)).toMatchObject({ scopeSessionId: 'session-one', assignments: [{ machineId: project.machineId }] });
    expect(added.set.context).toMatchObject({ workspace: { directory: project.directory }, onComplete: { kind: 'originating_session' } });
    expect((await actions.sessionList({ sessionId: 'session-other' })).sets).toEqual([]);
    expect((await actions.list({ scope: 'account_inline' })).sets).toEqual([]);
    const updated = await actions.sessionUpdate({ sessionId: 'session-one', triggerId: added.triggerId!, expectedRevision: added.set.revision,
      patch: { enabled: false } });
    expect(updated.set.triggers[0]?.enabled).toBe(false);
    await actions.sessionRemove({ sessionId: 'session-one', triggerId: added.triggerId! });
    expect((await actions.sessionList({ sessionId: 'session-one' })).sets[0]?.triggers).toEqual([]);
  });
  it('refuses native Keep going for humans and agents and never accepts caller placement', async () => {
    const { deps, rows } = fixture();
    const actions = createWorkflowTriggerActions({ ...deps, resolveSession: async () => ({ project, nativeGoalOwner: true }) });
    for (const caller of [undefined, ownCaller]) {
      await expect(actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'workflow', ref: 'builtin:keep-going' }, trigger }, caller))
        .rejects.toMatchObject({ code: 'native_goal_owner' });
    }
    const unauthorizedPlacement = { sessionId: 'session-one', target: { kind: 'inline' as const, definition }, trigger,
      project: { machineId: 'elsewhere', directory: '/elsewhere' } };
    await expect(actions.sessionAdd(unauthorizedPlacement)).rejects.toBeDefined();
    expect(rows.size).toBe(0);
  });
  it('reads and removes scoped triggers without requiring a reachable native goal control', async () => {
    const { deps } = fixture();
    const actions = createWorkflowTriggerActions({ ...deps, resolveSession: async (_sessionId, _caller, options) => {
      // The Session transport is reachable, but its opened-runtime RPC is not.
      if (options?.checkNativeGoalOwner !== false) throw Object.assign(new Error('target_unavailable'), { code: 'target_unavailable' });
      return { project, nativeGoalOwner: null };
    } });
    const added = await actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'inline', definition }, trigger });
    expect((await actions.sessionList({ sessionId: 'session-one' })).sets).toHaveLength(1);
    expect((await actions.sessionRemove({ sessionId: 'session-one', triggerId: added.triggerId! })).set.triggers).toEqual([]);
    await expect(actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'workflow', ref: 'builtin:keep-going' }, trigger }))
      .rejects.toMatchObject({ code: 'target_unavailable' });
  });
  it('refuses scoped Event updates without Channel permission evidence but permits removal', async () => {
    const { deps, rows } = fixture();
    const actions = createWorkflowTriggerActions({ ...deps, resolveSession: async () => ({ project, nativeGoalOwner: false }) });
    const added = await actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'inline', definition }, trigger });
    const row = rows.get(added.set.automationId)!;
    // Persisted network input may predate this Action's Channel-aware writer.
    rows.set(row.id, { ...row, triggers: [{ id: added.triggerId!, revision: 0, enabled: false, createdAt: 1, updatedAt: 1,
      kind: 'pluginEvent', eventRef: { pluginId: 'happier.channel.github', localId: 'pull-request-comment' }, sourceSelectorId: 'source',
      sourceContractVersion: 1, observation: { kind: 'checkpointedPull', watcher: null }, sourceStatus: null,
      sourceCatalogStatus: null, triggerDefinitionEnvelope: '{}',
    }] });
    await expect(actions.sessionUpdate({ sessionId: 'session-one', triggerId: added.triggerId!, expectedRevision: added.set.revision,
      patch: { enabled: true } })).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(rows.get(row.id)?.triggers[0]?.enabled).toBe(false);
    expect((await actions.sessionRemove({ sessionId: 'session-one', triggerId: added.triggerId! })).set.triggers).toEqual([]);
  });
  it('admits direct own-session agent writes through ORC and denies unrelated Session writes', async () => {
    const { deps, rows } = fixture();
    const actions = createWorkflowTriggerActions({ ...deps, resolveSession: async () => ({ project, nativeGoalOwner: false }),
      resolveMaterializer: async () => ({ effects: { resolveTargetAvailability: async () => true } }) });
    const caller = ownCaller;
    await expect(actions.sessionAdd({ sessionId: 'unrelated', target: { kind: 'inline', definition }, trigger }, caller))
      .rejects.toMatchObject({ code: 'subtree_denied' });
    await expect(actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'inline', definition }, trigger }, {
      ...caller, agentStartContext: { ...caller.agentStartContext, caller: { ...caller.agentStartContext.caller, turnDepth: 4 } },
    })).rejects.toMatchObject({ code: 'work_depth_exceeded' });
    expect(rows.size).toBe(0);
    const own = await actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'inline', definition }, trigger }, caller);
    expect(own.set.health).toBe('available');
  });
  it('permits an originless run to remove exactly its own firing trigger without opening a missing source', async () => {
    const { deps, loseSource } = fixture();
    let firing: { sessionId: string; triggerId: string } | null = null;
    const actions = createWorkflowTriggerActions({ ...deps, resolveSession: async () => ({ project, nativeGoalOwner: false }),
      resolveRunTrigger: async () => firing });
    const added = await actions.sessionAdd({ sessionId: 'session-one', target: { kind: 'workflow', ref: workflow }, trigger });
    firing = { sessionId: 'session-one', triggerId: added.triggerId! };
    const caller = { surface: 'agent' as const, actionCaller: { kind: 'workflowRun' as const, runId: 'run-one',
      authorization: { principal: { kind: 'host' as const }, admittedPermissionCeiling: 'read-only' as const } } };
    await expect(actions.sessionRemove({ sessionId: 'other', triggerId: added.triggerId! }, caller)).rejects.toMatchObject({ code: 'run_access_denied' });
    await expect(actions.sessionRemove({ sessionId: 'session-one', triggerId: 'other-trigger' }, caller)).rejects.toMatchObject({ code: 'run_access_denied' });
    loseSource();
    expect((await actions.sessionRemove({ sessionId: 'session-one', triggerId: added.triggerId! }, caller)).set.triggers).toEqual([]);
  });
  it('consumes session trigger writes directly through the real Action executor without an approval', async () => {
    const { deps, rows } = fixture();
    let nativeGoalOwner = false;
    const triggers = createWorkflowTriggerActions({ ...deps, resolveSession: async () => ({ project, nativeGoalOwner }),
      resolveMaterializer: async () => ({ effects: { resolveTargetAvailability: async () => true } }) });
    const definitions = createWorkflowDefinitionActions({ artifactStore: {
      list: async () => ({ items: [] }), read: async () => null,
      create: async () => { throw new Error('Unexpected Artifact write'); },
      update: async () => { throw new Error('Unexpected Artifact write'); }, delete: async () => ({ ok: true }),
    }, encodeListCursor: (row) => row.artifactId, assertDefinitionWriteAllowed: async () => undefined });
    const executor = createActionExecutor({ workflowAction: createWorkflowActionExecutor({
      isWorkflowFeatureEnabled: () => true, definitions, triggers,
      runs: { execute: async () => { throw new Error('Unexpected Run write'); } },
    }) });
    expect(await executor.execute('session.trigger.add', { sessionId: 'session-one', target: { kind: 'inline', definition }, trigger }, ownCaller))
      .toMatchObject({ ok: true, result: { set: { health: 'available' } } });
    expect(rows.size).toBe(1);
    nativeGoalOwner = true;
    expect(await executor.execute('session.trigger.add', { sessionId: 'session-one', target: { kind: 'workflow', ref: 'builtin:keep-going' }, trigger }, ownCaller))
      .toMatchObject({ ok: false, errorCode: 'native_goal_owner' });
    expect(await executor.execute('session.trigger.add', { sessionId: 'session-one', target: { kind: 'inline', definition }, trigger: {
      kind: 'sessionLifecycle', enabled: true, sourceSessionId: 'session-one', events: ['sessionStarted'], policy: { kind: 'everyMatch' },
    } }, ownCaller)).toMatchObject({ ok: false, errorCode: 'session_already_started' });
    expect(await executor.execute('session.trigger.add', { sessionId: 'session-one', target: { kind: 'inline', definition }, trigger: {
      kind: 'sessionLifecycle', enabled: true, sourceSessionId: 'foreign-session', events: ['parentTurnCompleted'], policy: { kind: 'everyMatch' },
    } }, ownCaller)).toMatchObject({ ok: false, errorCode: 'invalid_input' });
    expect(rows.size).toBe(1);
    const [row] = rows.values();
    expect(await executor.execute('session.trigger.remove', {
      sessionId: 'session-one', triggerId: row!.triggers[0]!.id,
    }, ownCaller)).toMatchObject({ ok: true, result: { set: { triggers: [] } } });
    expect(rows.get(row!.id)?.triggers).toEqual([]);
  });
});
