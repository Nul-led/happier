import { describe, expect, it, vi } from 'vitest';

import { validateWorkflowDefinition } from '../../workflows/workflowValidationV1.js';
import { sealWorkflowAcceptedSnapshotStoredEnvelopeV1, sealWorkflowProgressStoredEnvelopeV1, serializeWorkflowStoredContentEnvelopeV1 } from '../../workflows/workflowStoredContentV1.js';
import { WorkflowRunSummaryV1Schema } from '../../workflows/workflowProgressV1.js';
import { openWorkflowAcceptedSnapshotStoredEnvelopeV1, parseWorkflowStoredContentEnvelopeV1 } from '../../workflows/workflowStoredContentV1.js';
import { SessionAgentSpawnPolicyV1StrictSchema } from '../../account/settings/sessionAgentSpawnPolicyV1.js';
import { createWorkflowAccountRunActionOwner, type WorkflowAccountRunActionDeps } from './workflowRunActions.js';
import { WorkflowRunRecipientCensusResponseV1Schema } from '../../workflows/workflowRunKeyV1.js';

const runId = '11111111-1111-4111-8111-111111111111';
const definition = validateWorkflowDefinition({
  version: 1,
  defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } } },
  blocks: ['work'],
}).normalizedDefinition!;

function runSnapshot() {
  const run = WorkflowRunSummaryV1Schema.parse({ sourceArtifactId: null, ownerAccountId: 'account-1', visibleTeamId: null,
    id: runId, origin: { kind: 'direct' }, state: 'queued', revision: 0,
    machineId: 'machine-a', workflowCustodyState: 'pending', originDeliveryAckRevision: null,
    availability: { pause: true, resumeBoundary: false,
       restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  return {
    run,
    acceptedEnvelope: serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
      acceptedSnapshot: {
        definition, metadata: null, source: { kind: 'saved', definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 }, savedBy: null },
        inputs: {}, machineId: 'machine-a', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-a', directory: '/repo', checkoutRootPath: '/repo' } },
        origin: { kind: 'direct', originSessionId: 'origin-1' },
        authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
      },
    })),
    checkpointEnvelope: null, resultEnvelope: null,
    keyCensus: WorkflowRunRecipientCensusResponseV1Schema.parse({
      runId, ownerAccountId: 'account-1', visibleTeamId: null, encryptionMode: 'plain', access: 'owner',
      ownerAccountCurrentness: { mode: 'plain', version: 1, contentKeyFingerprint: null },
      dataEncryptionKey: null, callerDataEncryptionKey: null, recipients: [],
    }),
  };
}

function ownerDeps(storage: WorkflowAccountRunActionDeps['storage']): WorkflowAccountRunActionDeps {
  return {
    resolveAccountId: async () => 'account-1', storage,
    definitions: { get: async () => ({ definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 }, definition, metadata: { title: 'Work' } }) },
    resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
    normalizeAbsolutePath: (directory) => directory.startsWith('/') ? directory : null,
    randomBytes: () => { throw new Error('plain_account_does_not_need_keys'); },
  };
}

describe('shared Account workflow run owner', () => {
  it.each(['agent', 'ui'] as const)('requires materialized agent-start leaves only for an %s run', async (surface) => {
    let writes = 0;
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async (operation) => {
        if (operation.operation === 'get') throw Object.assign(new Error('run_not_found'), { code: 'run_not_found' });
        writes += 1;
        return { kind: 'created', run: runSnapshot().run };
      } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-a', directory: '/repo', checkoutRootPath: '/repo' } } }),
      resolveMaterializationContext: async () => ({ effects: { resolveTargetAvailability: async () => true } }),
      resolveAgentStartContext: async () => ({ caller: { kind: 'originless', runId: 'calling-run', runDepth: 1 },
        baseline: { machineId: 'machine-a', directory: '/repo' },
        roles: {}, callerPermissionCeiling: 'safe-yolo', ledSubtreeSessionIds: [], workDepthLimit: 4 }),
    });
    const result = owner.execute({ actionId: 'workflow.run.start', input: { runId, source: { kind: 'inline', definition: {
      version: 1, blocks: [{ kind: 'wait', id: 'wait', document: { text: 'Choose', references: [], attachments: [] } }],
    } } }, context: { surface, ...(surface === 'ui' ? { authority: 'present_user' as const } : {}), callerPermissionMode: 'safe-yolo',
      externalActionTarget: { kind: 'machine', machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } } } });
    if (surface === 'agent') await expect(result).rejects.toMatchObject({ code: 'target_unavailable' });
    else await expect(result).resolves.toMatchObject({ admission: 'created' });
    expect(writes).toBe(surface === 'agent' ? 0 : 1);
  });

  it('records boundary Resume without opening encrypted content or checking private authority', async () => {
    const calls: string[] = [];
    const resumed = { ...runSnapshot().run, state: 'queued' as const, revision: 4 };
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async (operation) => {
        calls.push(String(operation.operation));
        if (operation.operation !== 'resume') throw new Error('key_free_resume_cannot_read_private_content');
        return { run: resumed, intent: 'resumed' };
      } }),
      resolveEncryption: async () => { throw new Error('encrypted_run_key_not_available'); },
      isAcceptedAuthorizationCurrent: async () => { throw new Error('worker_checks_private_authority'); },
    });
    await expect(owner.execute({ actionId: 'workflow.run.resume',
      input: { mode: 'boundary', runId, expectedRevision: 3 },
      context: { surface: 'ui', authority: 'present_user' } })).resolves.toEqual({ run: resumed, intent: 'resumed' });
    expect(calls).toEqual(['resume']);
  });

  it('preserves the typed Can-edit refusal from key-free boundary Resume', async () => {
    const owner = createWorkflowAccountRunActionOwner(ownerDeps({ execute: async (operation) => {
      if (operation.operation !== 'resume') throw new Error('key_free_resume_cannot_read_private_content');
      throw Object.assign(new Error('run_access_denied'), { response: { status: 403, data: { error: 'run_access_denied' } } });
    } }));
    await expect(owner.execute({ actionId: 'workflow.run.resume',
      input: { mode: 'boundary', runId, expectedRevision: 3 },
      context: { surface: 'ui', authority: 'present_user' } })).rejects.toMatchObject({ code: 'run_access_denied' });
  });

  it.each([
    { target: { kind: 'machine' as const, machineId: 'machine-a' }, allowed: true },
    { target: { kind: 'machine' as const, machineId: 'machine-b' }, allowed: false },
    { target: { kind: 'machine' as const, machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } }, allowed: false },
    { target: { kind: 'machine' as const, machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/other' } }, allowed: false },
  ])('enforces resource restrictions without opening private Resume content ($target)', async ({ target, allowed }) => {
    let resumed = false;
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async operation => {
        if (operation.operation === 'get') return { ...runSnapshot(), acceptedEnvelope: 'unreadable' };
        if (operation.operation === 'resume') { resumed = true; return { run: runSnapshot().run, intent: 'resumed' }; }
        throw new Error('unexpected_storage_operation');
      } }),
      resolveEncryption: async () => { throw new Error('key_free_resume_must_not_resolve_keys'); },
    });
    const result = owner.execute({ actionId: 'workflow.run.resume', input: { mode: 'boundary', runId, expectedRevision: 0 },
      context: { surface: 'ui', authority: 'present_user', externalActionTarget: target } });
    if (allowed) await expect(result).resolves.toMatchObject({ intent: 'resumed' });
    else await expect(result).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(resumed).toBe(allowed);
  });

  it.each([
    { surface: 'agent', authority: 'account_automation', originSessionId: 'origin-1', explicit: false, delivery: true },
    { surface: 'agent', authority: 'present_user', originSessionId: 'origin-1', explicit: false, delivery: false },
    { surface: 'ui', authority: 'present_user', originSessionId: 'origin-1', explicit: false, delivery: false },
    { surface: 'ui', authority: 'present_user', originSessionId: 'origin-1', explicit: true, delivery: true },
    { surface: 'agent', authority: 'account_automation', originSessionId: undefined, explicit: false, delivery: false },
  ] as const)('normalizes direct origin delivery once for $surface/$authority/$explicit/$originSessionId and rejoin', async (scenario) => {
    let committed: ReturnType<typeof runSnapshot> | undefined;
    let writes = 0;
    let deliveryRequest: unknown;
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async (operation) => {
        if (operation.operation === 'get') {
          if (!committed) throw Object.assign(new Error('run_not_found'), { code: 'run_not_found' });
          return committed;
        }
        if (operation.operation !== 'admit') throw new Error('unexpected_storage_operation');
        writes += 1;
        deliveryRequest = operation.resultDelivery;
        committed = { ...runSnapshot(), acceptedEnvelope: String(operation.acceptedEnvelope) };
        return { kind: 'created', run: committed.run };
      } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-a', directory: '/repo', checkoutRootPath: '/repo' } } }),
      resolveMaterializationContext: async () => ({ effects: { resolveTargetAvailability: async () => true } }),
      resolveAgentStartContext: async () => ({ caller: { kind: 'originless', runId, runDepth: 0,
        ...(scenario.originSessionId ? { runOriginSessionId: scenario.originSessionId } : {}) },
        baseline: { machineId: 'machine-a', directory: '/repo', configuration: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } }, permissionMode: 'default' } },
        roles: {}, callerPermissionCeiling: 'safe-yolo', ledSubtreeSessionIds: [], workDepthLimit: 4 }),
    });
    const args = { actionId: 'workflow.run.start' as const,
      input: { runId, source: { kind: 'inline' as const, definition },
        ...(scenario.explicit ? { onComplete: { kind: 'originating_session' as const } } : {}) },
      context: { surface: scenario.surface, authority: scenario.authority, callerPermissionMode: 'safe-yolo',
        ...(scenario.originSessionId ? { defaultSessionId: scenario.originSessionId } : {}),
        externalActionTarget: { kind: 'machine' as const, machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } } } };
    await expect(owner.execute(args)).resolves.toMatchObject({ admission: 'created' });
    const opened = openWorkflowAcceptedSnapshotStoredEnvelopeV1({ mode: 'plain',
      envelope: parseWorkflowStoredContentEnvelopeV1(committed!.acceptedEnvelope)!,
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId } });
    if (opened.kind !== 'available') throw new Error('accepted_snapshot_unavailable');
    const acceptedDelivery = 'resultDelivery' in opened.content ? opened.content.resultDelivery : undefined;
    expect(acceptedDelivery).toEqual(scenario.delivery
      ? { kind: 'originating_session', originSessionId: scenario.originSessionId } : undefined);
    expect(deliveryRequest).toEqual(scenario.delivery ? { kind: 'originating_session' } : undefined);
    await expect(owner.execute(args)).resolves.toMatchObject({ admission: 'existing' });
    expect(writes).toBe(1);
  });

  it.each([
    { activity: 'active', lifecycle: 'failed', same: false, fresh: false, reattach: false, continuation: true },
    { activity: 'not_active', lifecycle: 'failed', same: true, fresh: true, reattach: false, continuation: true },
    { activity: 'not_active', lifecycle: 'failed', same: false, fresh: true, reattach: false, continuation: false },
    { activity: 'unknown', lifecycle: 'needs_attention', same: false, fresh: false, reattach: true, continuation: true },
    { activity: 'active', lifecycle: 'cancel_requested', same: false, fresh: false, reattach: true, continuation: true },
    { activity: 'unknown', lifecycle: 'failed', same: false, fresh: false, reattach: false, continuation: false },
    { activity: 'not_active', lifecycle: 'needs_attention', same: true, fresh: true, reattach: false, continuation: true },
    { activity: 'not_active', lifecycle: 'failed', same: false, fresh: false, reattach: false, continuation: true, stale: true },
    { activity: 'not_active', lifecycle: 'failed', same: false, fresh: false, reattach: false, continuation: false, workspace: true, restore: true },
    { activity: 'unknown', lifecycle: 'needs_attention', same: false, fresh: false, reattach: false, continuation: false, workspace: true, restore: false },
  ] as const)('uses exact observation for offered and enforced recovery: $activity/$lifecycle', async (scenario) => {
    const recordId = '33333333-3333-4333-8333-333333333333';
    const snapshot = runSnapshot();
    snapshot.run.state = 'interrupted';
    snapshot.run.revision = 2;
    // These are initially stored envelope snapshots, matching the persisted
    // WorkflowRunInvocation default and canonical storage testkit admission.
    const index = { id: recordId, runId, sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0', contentRevision: '0',
      lifecycle: scenario.lifecycle, createdAt: snapshot.run.createdAt, updatedAt: snapshot.run.updatedAt };
    const contentEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId,
        sequence: '0', parentRecordId: null, memberOrdinal: '0', attempt: '0' },
      progress: { kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] },
        blockKind: 'step', attempt: '0', logicalInvocationRecordId: recordId,
        execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
        ...('workspace' in scenario ? { reason: { code: 'workspace_unavailable' }, workspace: {
          creationIntent: { kind: 'git_worktree' as const, sourceDirectory: '/repo', baseRef: 'a'.repeat(40), displayName: 'work', branchMode: 'new' as const },
          descriptor: { machineId: 'machine-a', directory: '/repo/work', checkoutRootPath: '/repo/work', checkout: { kind: 'git_worktree' as const, branchName: 'work' } },
        } } : {}),
        ...(scenario.activity === 'not_active' && scenario.lifecycle === 'needs_attention'
          ? { uncertainPriorEffects: { activity: 'stopped' as const } } : {}),
        recovery: { conversation: 'same_conversation', input: { kind: 'replacement', value: { document: { text: 'prepared', references: [], attachments: [] }, input: [] } } } },
    }));
    const latestId = '44444444-4444-4444-8444-444444444444';
    const latestIndex = { ...index, id: latestId, attempt: '1', sequence: '1', lifecycle: 'pending' };
    const latestEnvelope = serializeWorkflowStoredContentEnvelopeV1(sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain', binding: { v: 1, purpose: 'invocation_progress', accountId: 'account-1', runId, recordId: latestId,
        sequence: '1', parentRecordId: null, memberOrdinal: '0', attempt: '1' },
      progress: { kind: 'happier.workflow-progress.v1', invocationPath: { blockId: 'work', scope: [] },
        blockKind: 'step', attempt: '1', logicalInvocationRecordId: recordId, previousAttemptRecordId: recordId },
    }));
    let reattachments = 0;
    let replacements = 0;
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async (operation) => {
        if (operation.operation === 'get') return snapshot;
        if (operation.operation === 'invocations.get') return { invocation: operation.invocationId === latestId
          ? { index: latestIndex, contentEnvelope: latestEnvelope, parentRevision: 2 } : { index, contentEnvelope, parentRevision: 2 } };
        if (operation.operation === 'invocations.list') return { invocations: [index, ...('stale' in scenario ? [latestIndex] : [])], nextCursor: null };
        replacements += 1;
        throw new Error('unexpected_replacement');
      } }),
      observeRecovery: async () => ({ activity: scenario.activity, canReattach: scenario.reattach, canContinueConversation: scenario.continuation }),
      reattachInvocation: async () => { reattachments += 1; },
    });
    const detail = await owner.execute({ actionId: 'workflow.run.invocations.get', input: { runId, invocationId: recordId }, context: {} });
    expect(detail).toMatchObject({ invocation: { recoveryAvailability: { restoreWorkspace: { kind: 'unavailable' as const, reason: 'recovery_not_prepared' as const },
      reattach: { kind: scenario.reattach ? 'available' : 'unavailable' },
      continueSameConversation: { kind: scenario.same ? 'available' : 'unavailable' },
      continueFreshAgent: { kind: scenario.fresh ? 'available' : 'unavailable' },
      retry: { kind: scenario.fresh ? 'available' : 'unavailable' },
      ...('restore' in scenario ? { restoreWorkspace: { kind: scenario.restore ? 'available' : 'unavailable' } } : {}),
    } } });
    if (!scenario.same) {
      await expect(owner.execute({ actionId: 'workflow.run.resume', input: { mode: 'recover', runId, expectedRevision: 2,
        invocations: [{ kind: 'continue', invocation: { recordId }, conversation: 'same_conversation', input: { document: { text: 'new', references: [], attachments: [] }, input: [] } }] },
        context: { authority: 'present_user', callerPermissionMode: 'safe-yolo' } })).rejects.toMatchObject({ code: 'ineligible_state' });
    }
    if (scenario.activity === 'not_active' && scenario.lifecycle === 'needs_attention') {
      await expect(owner.execute({ actionId: 'workflow.run.resume', input: { mode: 'recover', runId, expectedRevision: 2,
        invocations: [{ kind: 'continue', invocation: { recordId }, conversation: 'fresh_agent', input: { document: { text: 'new', references: [], attachments: [] }, input: [] } }] },
        context: { authority: 'present_user', callerPermissionMode: 'safe-yolo' } })).rejects.toMatchObject({ code: 'workflow_outcome_unresolved' });
    }
    if (scenario.reattach) {
      await owner.execute({ actionId: 'workflow.run.resume', input: { mode: 'recover', runId, expectedRevision: 2,
        invocations: [{ kind: 'reattach', invocation: { recordId } }] }, context: {} });
      expect(reattachments).toBe(1);
    }
    expect(replacements).toBe(0);
  });

  it.each(['inline', 'saved'] as const)('materializes run overrides before authority and freezes them across %s admission rejoin', async (sourceKind) => {
    const authored = {
      version: 1,
      defaults: { engine: { role: 'writer' } },
      roles: [{ roleId: 'writer', name: 'Writer', instructions: 'Write carefully',
        engine: { agentTargetKey: 'happier.agent.test/test', modelId: 'pinned' },
        runsAs: { kind: 'session' }, workspaceWrites: 'allow', secondOpinion: 'off' }],
      blocks: ['work'],
    };
    const roleOverrides = [{ roleId: 'writer', engine: { agentTargetKey: 'happier.agent.test/test', modelId: 'override' } }];
    let committed: ReturnType<typeof runSnapshot> | undefined;
    let writes = 0;
    let resolutions = 0;
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async (operation) => {
        if (operation.operation === 'get') {
          if (!committed) throw Object.assign(new Error('run_not_found'), { code: 'run_not_found' });
          return committed;
        }
        if (operation.operation !== 'admit') throw new Error('unexpected_storage_operation');
        writes += 1;
        committed = { ...runSnapshot(), acceptedEnvelope: String(operation.acceptedEnvelope) };
        return { kind: 'created', run: committed.run };
      } }),
      definitions: { get: async () => ({ definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 },
        definition: validateWorkflowDefinition(authored).normalizedDefinition!, metadata: { title: 'Saved roles' },
        savedBy: { kind: 'agent', accountId: 'editor-account', sessionId: 'editor-session' } }) },
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-a', directory: '/repo', checkoutRootPath: '/repo' } } }),
      resolveMaterializationContext: async () => {
        resolutions += 1;
        return { effects: { resolveTargetAvailability: async () => true } };
      },
    });
    const source = sourceKind === 'inline' ? { kind: 'inline' as const, definition: authored }
      : { kind: 'saved' as const, definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 } };
    const args = { actionId: 'workflow.run.start' as const, input: { runId, source, roleOverrides },
      context: { authority: 'present_user' as const, callerPermissionMode: 'safe-yolo', defaultSessionId: 'origin-1',
        externalActionTarget: { kind: 'machine' as const, machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } } } };
    await expect(owner.execute(args)).resolves.toMatchObject({ admission: 'created' });
    const envelope = parseWorkflowStoredContentEnvelopeV1(committed!.acceptedEnvelope)!;
    const opened = openWorkflowAcceptedSnapshotStoredEnvelopeV1({ mode: 'plain', envelope,
      binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId } });
    expect(opened).toMatchObject({ kind: 'available', content: { roleOverrides, workDepth: 0,
      definition: { blocks: [{ execution: { modelSelection: { ref: { modelId: 'override' } } } }] } } });
    if (sourceKind === 'saved') expect(opened).toMatchObject({ content: { source: {
      savedBy: { kind: 'agent', accountId: 'editor-account', sessionId: 'editor-session' },
    } } });
    await expect(owner.execute(args)).resolves.toMatchObject({ admission: 'existing' });
    expect(writes).toBe(1);
    expect(resolutions).toBe(1);
    await expect(owner.execute({ ...args, input: { ...args.input, roleOverrides: [] } })).rejects.toMatchObject({ code: 'currentness_conflict' });
  });

  it.each(['availability', 'depth', 'model_policy'] as const)('refuses %s before writing a direct Run', async (scenario) => {
    let writes = 0;
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async (operation) => {
        if (operation.operation === 'get') throw Object.assign(new Error('run_not_found'), { code: 'run_not_found' });
        writes += 1;
        throw new Error('must_not_write_refused_run');
      } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine-a', directory: '/repo', checkoutRootPath: '/repo' } } }),
      resolveMaterializationContext: async () => ({ effects: { resolveTargetAvailability: async () => scenario !== 'availability' } }),
      resolveAgentStartContext: async () => ({ caller: { kind: 'session', sessionId: 'origin-1', starterDepth: scenario === 'depth' ? 4 : 1, turnDepth: 0 },
        baseline: { machineId: 'machine-a', directory: '/repo', configuration: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } }, permissionMode: 'default' } },
        roles: {}, callerPermissionCeiling: 'safe-yolo', ledSubtreeSessionIds: [], workDepthLimit: 4 }),
    });
    const result = owner.execute({ actionId: 'workflow.run.start', input: { runId, source: { kind: 'inline', definition: {
      version: 1, defaults: { engine: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } },
        modelSelection: { v: 1, updatedAt: 0, ref: { agentTargetKey: 'happier.agent.test/test', providerConnectionId: null, modelId: 'override' } } } }, blocks: ['work'],
    } } }, context: { surface: scenario === 'availability' ? 'cli' : 'agent', authority: scenario === 'availability' ? 'present_user' : undefined,
      callerPermissionMode: 'safe-yolo', defaultSessionId: 'origin-1',
      sessionAgentSpawnPolicyV1: SessionAgentSpawnPolicyV1StrictSchema.parse({ allowModelOverride: scenario !== 'model_policy' }),
      externalActionTarget: { kind: 'machine', machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } } } });
    await expect(result).rejects.toMatchObject({ code: scenario === 'availability' ? 'target_unavailable' : scenario === 'depth' ? 'work_depth_exceeded' : 'policy_denied_field' });
    expect(writes).toBe(0);
  });
  it('reads one lean summary batch without resolving definitions or Account keys', async () => {
    const result = { summaries: [{ sourceArtifactId: 'def-1', lastRun: null, recent: [], needsYouCount: 0, needsYouRunId: null }], remainingSourceArtifactIds: ['def-2'] };
    const deps = ownerDeps({ execute: async (operation, options) => {
      if (operation.operation !== 'summaries' || options?.publisherMachineId) throw new Error('unexpected_storage_boundary');
      return result;
    } });
    const owner = createWorkflowAccountRunActionOwner({
      ...deps,
      definitions: { get: async () => { throw new Error('must_not_read_definition'); } },
      resolveEncryption: async () => { throw new Error('must_not_resolve_private_keys'); },
    });
    await expect(owner.execute({ actionId: 'workflow.run.summaries', input: { sourceArtifactIds: ['def-1', 'def-2'], recent: 3 }, context: {} })).resolves.toEqual(result);
  });
  it('refuses unaccepted plugin catalog sources before any run effect', async () => {
    const owner = createWorkflowAccountRunActionOwner(ownerDeps({ execute: async () => { throw new Error('must_not_access_run'); } }));
    await expect(owner.execute({ actionId: 'workflow.run.start', input: {
      runId, source: { kind: 'catalog', workflow: 'plugin:happier.test/workflow' },
    }, context: {} })).rejects.toMatchObject({ code: 'source_unavailable' });
  });

  it('fails role admission closed when the materialization host is unavailable', async () => {
    const owner = createWorkflowAccountRunActionOwner(ownerDeps({ execute: async (operation) => {
      if (operation.operation === 'get') throw Object.assign(new Error('run_not_found'), { code: 'run_not_found' });
      throw new Error('must_not_write_unavailable_run');
    } }));
    await expect(owner.execute({ actionId: 'workflow.run.start', input: {
      runId, source: { kind: 'inline', definition }, roleOverrides: [{ roleId: 'reviewer', workspaceWrites: 'deny' }],
    }, context: { externalActionTarget: { kind: 'machine', machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } } } })).rejects.toMatchObject({ code: 'target_unavailable' });
  });
  it.each(['revision_changed', 'source_deleted', 'run_absent', 'different_origin'] as const)(
    'rechecks the exact immutable admission after mutable source failure: %s', async (scenario) => {
      const snapshot = runSnapshot();
      let reads = 0;
      const deps = ownerDeps({ execute: async (operation) => {
        if (operation.operation !== 'get') throw new Error('must_not_repeat_effect');
        reads += 1;
        if (reads === 1 || scenario === 'run_absent') throw Object.assign(new Error('run_not_found'), { code: 'run_not_found' });
        return snapshot;
      } });
      const prepareWorkspace = vi.fn();
      const owner = createWorkflowAccountRunActionOwner({
        ...deps, prepareWorkspace,
        definitions: { get: async () => {
          if (scenario === 'source_deleted') throw Object.assign(new Error('source_unavailable'), { code: 'source_unavailable' });
          return { definitionId: 'def-1', revision: { headerVersion: 2, bodyVersion: 2 }, definition, metadata: { title: 'Changed' } };
        } },
      });
      const result = owner.execute({ actionId: 'workflow.run.start', input: {
        runId, source: { kind: 'saved', definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 } },
      }, context: {
        callerPermissionMode: 'safe-yolo',
        defaultSessionId: scenario === 'different_origin' ? 'origin-2' : 'origin-1',
        externalActionTarget: { kind: 'machine', machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } },
      } });
      if (scenario === 'run_absent' || scenario === 'different_origin') {
        await expect(result).rejects.toMatchObject({ code: 'currentness_conflict' });
      } else {
        await expect(result).resolves.toMatchObject({ admission: 'existing', run: { id: runId } });
      }
      expect(reads).toBe(2);
      expect(prepareWorkspace).not.toHaveBeenCalled();
    },
  );

  it('reads, waits and records durable cancellation without a machine host or Account keys', async () => {
    const snapshot = runSnapshot();
    const owner = createWorkflowAccountRunActionOwner(ownerDeps({ execute: async (operation, options) => {
      expect(options?.publisherMachineId).toBeUndefined();
      if (operation.operation === 'get') return snapshot;
      if (operation.operation === 'invocations.list') return { invocations: [] };
      if (operation.operation === 'wait') return { run: snapshot.run, observation: 'timeout' };
      if (operation.operation === 'cancel') return { run: { ...snapshot.run, state: 'cancelled' }, intent: 'cancel_requested' };
      throw new Error(`unexpected:${String(operation.operation)}`);
    } }));
    await expect(owner.execute({ actionId: 'workflow.run.get', input: { runId }, context: {} })).resolves.toMatchObject({ definition });
    await expect(owner.execute({ actionId: 'workflow.run.wait', input: { runId, timeoutSeconds: 1 }, context: {} })).resolves.toMatchObject({ observation: 'timeout' });
    await expect(owner.execute({ actionId: 'workflow.run.cancel', input: { runId, expectedRevision: 0 }, context: {} })).resolves.toMatchObject({ run: { state: 'cancelled' }, intent: 'cancel_requested' });
  });

  it.each(['workflow.run.get', 'workflow.run.cancel', 'workflow.run.invocations.list'] as const)(
    'rejects an explicit resource restriction that disagrees with the retained Run for %s', async (actionId) => {
      const snapshot = runSnapshot();
      const operations: string[] = [];
      const owner = createWorkflowAccountRunActionOwner(ownerDeps({ execute: async (operation) => {
        operations.push(String(operation.operation));
        if (operation.operation === 'get') return snapshot;
        if (operation.operation === 'invocations.list') return { invocations: [] };
        if (operation.operation === 'cancel') return { run: snapshot.run, intent: 'cancel_requested' };
        throw new Error('unexpected_storage_operation');
      } }));
      const context = { authority: 'present_user' as const,
        externalActionTarget: { kind: 'machine' as const, machineId: 'another-machine' } };
      const pending = actionId === 'workflow.run.cancel'
        ? owner.execute({ actionId, input: { runId, expectedRevision: 0 }, context })
        : owner.execute({ actionId, input: { runId }, context });
      await expect(pending).rejects.toMatchObject({ code: 'target_unavailable' });
      expect(operations).not.toContain('cancel');
      expect(operations).not.toContain('invocations.list');
    },
  );

  it('uses the accepted project restriction for reads and never substitutes the relay project', async () => {
    const snapshot = runSnapshot();
    const owner = createWorkflowAccountRunActionOwner(ownerDeps({ execute: async (operation) => {
      if (operation.operation === 'get') return snapshot;
      if (operation.operation === 'invocations.list') return { invocations: [] };
      throw new Error('unexpected_storage_operation');
    } }));
    await expect(owner.execute({ actionId: 'workflow.run.get', input: { runId }, context: {
      externalActionTarget: { kind: 'machine', machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/other-project' } },
    } })).rejects.toMatchObject({ code: 'target_unavailable' });
    await expect(owner.execute({ actionId: 'workflow.run.get', input: { runId }, context: {
      externalActionTarget: { kind: 'machine', machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } },
    } })).resolves.toMatchObject({ definition });
  });

  it('narrows a listed resource to the explicit Machine and refuses restrictions the batch cannot represent', async () => {
    const snapshot = runSnapshot();
    const owner = createWorkflowAccountRunActionOwner(ownerDeps({ execute: async (operation) => {
      if (operation.operation !== 'list') throw new Error('must_not_read_unrestricted_summary_batch');
      const request = operation.request as Readonly<{ machineId?: string }>;
      return {
        runs: request.machineId === 'machine-a' ? [snapshot.run] : [],
        acceptedEnvelopesByRunId: { [runId]: snapshot.acceptedEnvelope },
        keyCensusByRunId: { [runId]: snapshot.keyCensus },
      };
    } }));
    const target = { kind: 'machine' as const, machineId: 'machine-a' };
    await expect(owner.execute({ actionId: 'workflow.run.list', input: {}, context: { externalActionTarget: target } }))
      .resolves.toMatchObject({ runs: [{ id: runId }] });
    await expect(owner.execute({ actionId: 'workflow.run.list', input: { machineId: 'machine-b' }, context: { externalActionTarget: target } }))
      .rejects.toMatchObject({ code: 'target_unavailable' });
    await expect(owner.execute({ actionId: 'workflow.run.summaries', input: { sourceArtifactIds: ['def-1'] }, context: { externalActionTarget: target } }))
      .rejects.toMatchObject({ code: 'target_unavailable' });
  });

  it('rejoins the frozen Team choice but rejects a different explicit admission audience', async () => {
    const snapshot = runSnapshot();
    snapshot.keyCensus.visibleTeamId = 'team-a';
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async operation => {
        if (operation.operation !== 'get') throw new Error('must_not_repeat_admission');
        return snapshot;
      } }),
      definitions: { get: async () => { throw new Error('must_not_read_mutable_grants_on_rejoin'); } },
    });
    const source = { kind: 'saved' as const, definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 } };
    const context = { callerPermissionMode: 'safe-yolo', defaultSessionId: 'origin-1',
      externalActionTarget: { kind: 'machine' as const, machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } } };
    await expect(owner.execute({ actionId: 'workflow.run.start', input: { runId, source }, context }))
      .resolves.toMatchObject({ admission: 'existing' });
    await expect(owner.execute({ actionId: 'workflow.run.start', input: { runId, source: { ...source, visibleTeamId: 'team-a' } }, context }))
      .resolves.toMatchObject({ admission: 'existing' });
    await expect(owner.execute({ actionId: 'workflow.run.start', input: { runId, source: { ...source, visibleTeamId: 'team-b' } }, context }))
      .rejects.toMatchObject({ code: 'currentness_conflict' });
  });

  it('does not rejoin an exact accepted admission after its authorization is revoked', async () => {
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async () => runSnapshot() }),
      isAcceptedAuthorizationCurrent: async () => false,
    });
    await expect(owner.execute({ actionId: 'workflow.run.start', input: {
      runId, source: { kind: 'saved', definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 } },
    }, context: {
      externalActionTarget: { kind: 'machine', machineId: 'machine-a', project: { machineId: 'machine-a', directory: '/repo' } },
    } })).rejects.toMatchObject({ code: 'run_access_denied' });
  });

  it('discloses nothing from an asynchronous read after Account retirement and performs no later mutation', async () => {
    const snapshot = runSnapshot();
    let retired = false;
    let writes = 0;
    const owner = createWorkflowAccountRunActionOwner({
      ...ownerDeps({ execute: async (operation) => {
        if (operation.operation === 'get') { retired = true; return snapshot; }
        if (operation.operation === 'invocations.list') return { invocations: [] };
        writes += 1;
        return { run: snapshot.run, intent: 'cancel_requested' };
      } }),
      assertCurrent: () => { if (retired) throw Object.assign(new Error('account_retired'), { code: 'account_retired' }); },
    });
    await expect(owner.execute({ actionId: 'workflow.run.get', input: { runId }, context: {} })).rejects.toMatchObject({ code: 'account_retired' });
    await expect(owner.execute({ actionId: 'workflow.run.cancel', input: { runId, expectedRevision: 0 }, context: {} })).rejects.toMatchObject({ code: 'account_retired' });
    expect(writes).toBe(0);
  });
});
