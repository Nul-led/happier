import { describe, expect, it } from 'vitest';

import {
  WORKFLOW_ACTION_IDS_V1,
  WorkflowActionInputSchemasV1,
  WorkflowActionOutputSchemasV1,
  WorkflowInvocationListRequestV1Schema,
  WorkflowInvocationListResultV1Schema,
  WorkflowRunListRequestV1Schema,
  WorkflowActionFailureV1Schema,
  parseWorkflowRunStartActionResultReferenceV1,
} from './index.js';

describe('workflow Action contracts', () => {
  it('requires the exact Run recovery handle on self-wait failures only', () => {
    expect(WorkflowActionFailureV1Schema.safeParse({
      ok: false,
      errorCode: 'workflow_wait_self_dependency',
      error: 'release the calling turn',
    }).success).toBe(false);
    expect(WorkflowActionFailureV1Schema.parse({
      ok: false,
      errorCode: 'workflow_wait_self_dependency',
      error: 'release the calling turn',
      details: { runId: 'run-1' },
    }).details).toEqual({ runId: 'run-1' });
    expect(WorkflowActionFailureV1Schema.safeParse({
      ok: false,
      errorCode: 'run_not_found',
      error: 'missing',
      details: { runId: 'run-1' },
    }).success).toBe(false);
  });
  it('owns exactly the approved 12 Run/validation and five definition Actions', () => {
    expect(WORKFLOW_ACTION_IDS_V1).toEqual([
      'workflow.validate',
      'workflow.run.start',
      'workflow.run.list',
      'workflow.run.get',
      'workflow.run.wait',
      'workflow.run.pause',
      'workflow.run.resume',
      'workflow.run.cancel',
      'workflow.run.invocations.list',
      'workflow.run.invocations.get',
      'workflow.run.invocations.retry',
      'workflow.run.delete',
      'workflow.definition.list',
      'workflow.definition.get',
      'workflow.definition.create',
      'workflow.definition.update',
      'workflow.definition.delete',
    ]);
  });

  it('initializes the canonical workflow definition schema through the workflow public barrel', () => {
    expect(WORKFLOW_ACTION_IDS_V1).toContain('workflow.validate');
    expect(WorkflowActionInputSchemasV1['workflow.validate'].safeParse({
      definition: {
        blocks: ['Summarize the current work'],
      },
    }).success).toBe(true);
  });

  it('uses canonical identifiers at public Action boundaries', () => {
    expect(WorkflowActionInputSchemasV1['workflow.validate'].safeParse({
      definition: { blocks: ['Summarize the current work'] },
      inputs: { '$private': 'not an authored input' },
    }).success).toBe(false);
    expect(WorkflowActionInputSchemasV1['workflow.validate'].safeParse({
      definition: { blocks: ['Summarize the current work'] },
      target: { machineId: 'm'.repeat(192) },
    }).success).toBe(false);
    expect(WorkflowActionInputSchemasV1['workflow.run.list'].safeParse({
      originSessionId: 's'.repeat(192),
    }).success).toBe(false);
    expect(WorkflowActionInputSchemasV1['workflow.run.start'].safeParse({
      runId: 'not-a-caller-allocated-uuid',
      source: { kind: 'inline', definition: { blocks: ['Work'] } },
    }).success).toBe(false);
    expect(WorkflowActionInputSchemasV1['workflow.run.list'].safeParse({
      cursor: 'a'.repeat(1025),
    }).success).toBe(false);
    for (const cursor of ['', 'next page', 'next+page=']) {
      expect(WorkflowActionInputSchemasV1['workflow.run.list'].safeParse({ cursor }).success).toBe(false);
      expect(WorkflowActionInputSchemasV1['workflow.run.invocations.list'].safeParse({
        runId: 'run-1',
        cursor,
      }).success).toBe(false);
      expect(WorkflowActionInputSchemasV1['workflow.definition.list'].safeParse({ cursor }).success).toBe(false);
    }
  });

  it('projects accepted execution context without the admitted authorization', () => {
    const run = {
      id: 'run-1', origin: { kind: 'direct' }, state: 'succeeded', revision: 1,
      machineId: 'machine-1', workflowCustodyState: 'settled', workflowResultDeliveryState: null,
      availability: {
        pause: false, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: false, inspectExecution: true,
        disabledReasons: [],
      },
      createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    } as const;
    const definition = {
      version: 1, inputs: [],
      defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } } },
      blocks: [{ kind: 'step', id: 'work', document: { text: 'Work', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
    } as const;
    const acceptedContext = {
      source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1',
      metadata: { title: 'Frozen title' },
      executionTarget: { kind: 'session' },
      workspaceTarget: { project: { machineId: 'machine-1', directory: '/workspace', checkoutRootPath: '/workspace' } },
      origin: { kind: 'direct' },
    } as const;
    const result = { run, definition, acceptedContext, checkpoint: null, availability: run.availability };
    expect(WorkflowActionOutputSchemasV1['workflow.run.get'].safeParse(result).success).toBe(true);
    expect(WorkflowActionOutputSchemasV1['workflow.run.get'].safeParse({
      ...result,
      result: 'done',
    }).success).toBe(false);
    expect(WorkflowActionOutputSchemasV1['workflow.run.get'].safeParse({
      ...result,
      finalOutputInvocationId: 'inv-final',
    }).success).toBe(false);
    expect(WorkflowActionOutputSchemasV1['workflow.run.get'].safeParse({
      ...result,
      result: 'done',
      finalOutputInvocationId: 'inv-final',
    }).success).toBe(true);
    expect(WorkflowActionOutputSchemasV1['workflow.run.get'].safeParse({
      ...result,
      acceptedContext: {
        ...acceptedContext,
        authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    }).success).toBe(false);
  });

  it('keeps public Run summaries title-free while carrying private display metadata beside list rows', () => {
    const run = {
      id: 'run-1', origin: { kind: 'direct' }, state: 'running', revision: 1,
      machineId: 'machine-1', workflowCustodyState: 'pending', workflowResultDeliveryState: null,
      availability: { pause: true, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: true, inspectExecution: true, disabledReasons: [] },
      createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    } as const;
    expect(WorkflowActionOutputSchemasV1['workflow.run.list'].parse({
      runs: [run],
      metadataByRunId: { 'run-1': { kind: 'available', value: { title: 'Frozen title' } } },
    }).metadataByRunId).toEqual({ 'run-1': { kind: 'available', value: { title: 'Frozen title' } } });
    expect(WorkflowActionOutputSchemasV1['workflow.run.list'].safeParse({ runs: [{ ...run, title: 'leak' }] }).success).toBe(false);
    expect(WorkflowActionOutputSchemasV1['workflow.run.list'].safeParse({
      runs: [run], metadataByRunId: { 'run-1': { kind: 'unavailable' } },
    }).success).toBe(true);
    expect(WorkflowActionOutputSchemasV1['workflow.run.list'].safeParse({
      runs: [run],
      metadataByRunId: {
        'run-1': { kind: 'unavailable' },
        'off-page-run': { kind: 'available', value: { title: 'Not in this page' } },
      },
    }).success).toBe(false);
    // Metadata is optional; when omitted, consumers project unavailable for page rows.
    expect(WorkflowActionOutputSchemasV1['workflow.run.list'].safeParse({ runs: [run] }).success).toBe(true);
  });

  it('keeps physical retry allocation behind the Workflow owner', () => {
    const retry = {
      runId: 'run-1', expectedRevision: 2,
      invocation: { recordId: 'physical-attempt-2' },
      conversation: 'same_conversation', input: { kind: 'original' },
    } as const;
    expect(WorkflowActionInputSchemasV1['workflow.run.invocations.retry'].safeParse(retry).success).toBe(true);
    for (const callerOwnedField of [
      { sequence: '4' },
      { logicalInvocationRecordId: 'logical-1' },
      { workspace: { directory: '/other' } },
      { nextRecordId: 'physical-attempt-3' },
    ]) {
      expect(WorkflowActionInputSchemasV1['workflow.run.invocations.retry'].safeParse({
        ...retry,
        ...callerOwnedField,
      }).success).toBe(false);
    }
  });

  it('projects authorized opened progress without exposing the storage envelope', () => {
    const invocation = {
      index: {
        id: 'invocation-1', runId: 'run-1', sequence: '0', parentRecordId: null,
        memberOrdinal: '0', attempt: '0', lifecycle: 'completed',
        createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:01.000Z',
      },
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: '$root', scope: [] },
        blockKind: 'root', attempt: '0', logicalInvocationRecordId: 'invocation-1',
        result: 'done',
      },
      parentRevision: 1,
    } as const;

    expect(WorkflowActionOutputSchemasV1['workflow.run.invocations.get'].safeParse({ invocation }).success)
      .toBe(true);
    expect(WorkflowActionOutputSchemasV1['workflow.run.invocations.get'].safeParse({
      invocation: { ...invocation, progress: undefined, contentEnvelope: 'private-storage-envelope' },
    }).success).toBe(false);
  });

  it('accepts the V3 handbook start and admission-response examples', () => {
    const start = {
      runId: '0f2cf13d-4ad7-4f4b-b5e0-cc3b7dce7f11',
      source: {
        kind: 'inline',
        definition: {
          version: 1,
          inputs: [],
          defaults: {
            agentTarget: {
              kind: 'agent',
              identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
            },
            conversation: { kind: 'shared_run' },
          },
          blocks: [
            {
              kind: 'step', id: 'a',
              document: { text: 'Analyze', references: [], attachments: [] },
              input: [], result: { kind: 'text' },
            },
            {
              kind: 'step', id: 'b',
              document: { text: 'Implement from the supplied analysis', references: [], attachments: [] },
              execution: { conversation: { kind: 'shared_run' } },
              input: [{
                kind: 'result', producer: { blockId: 'a', scope: { kind: 'current' } }, path: [],
              }],
              result: { kind: 'text' },
            },
          ],
          finalOutput: {
            kind: 'result', producer: { blockId: 'b', scope: { kind: 'current' } }, path: [],
          },
        },
      },
      inputs: {},
      onComplete: { kind: 'originating_session' },
    } as const;
    expect(WorkflowActionInputSchemasV1['workflow.run.start'].safeParse(start).success).toBe(true);

    const response = {
      run: {
        id: start.runId,
        origin: { kind: 'direct', originSessionId: 'sess-7' },
        state: 'running', revision: 3, machineId: 'machine-1',
        workflowCustodyState: 'pending', workflowResultDeliveryState: 'pending',
        availability: {
          pause: true, resumeBoundary: false, recoverSameConversation: false,
          recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: true, inspectExecution: true,
          disabledReasons: [],
        },
        createdAt: '2026-09-08T12:00:00.000Z',
        updatedAt: '2026-09-08T12:00:01.000Z',
      },
      admission: 'created',
    } as const;
    expect(WorkflowActionOutputSchemasV1['workflow.run.start'].safeParse(response).success).toBe(true);
    expect(parseWorkflowRunStartActionResultReferenceV1(response)).toEqual({
      runId: start.runId,
      origin: { kind: 'direct', originSessionId: 'sess-7' },
    });
    expect(parseWorkflowRunStartActionResultReferenceV1({ ok: true, result: response })).toEqual({
      runId: start.runId,
      origin: { kind: 'direct', originSessionId: 'sess-7' },
    });
    expect(parseWorkflowRunStartActionResultReferenceV1({
      ok: false,
      errorCode: 'run_not_found',
      error: 'missing',
    })).toBeNull();
  });

  it('accepts only a strict optional Run-level execution target selector', () => {
    const base = {
      runId: '0f2cf13d-4ad7-4f4b-b5e0-cc3b7dce7f11',
      source: { kind: 'inline', definition: { blocks: ['Work'] } },
    } as const;
    expect(WorkflowActionInputSchemasV1['workflow.run.start'].safeParse(base).success).toBe(true);
    for (const kind of ['session', 'attached_run', 'detached_run'] as const) {
      expect(WorkflowActionInputSchemasV1['workflow.run.start'].safeParse({
        ...base,
        executionTarget: { kind },
      }).success).toBe(true);
    }
    expect(WorkflowActionInputSchemasV1['workflow.run.start'].safeParse({
      ...base,
      executionTarget: { kind: 'session', sessionId: 'forged' },
    }).success).toBe(false);
  });

  it('round-trips lifecycle and attention filters with decimal BigInt counters', () => {
    expect(WorkflowRunListRequestV1Schema.parse({ attention: 'required' }).attention).toBe('required');
    expect(WorkflowRunListRequestV1Schema.safeParse({ attention: 'suggested' }).success).toBe(false);

    const filtered = WorkflowInvocationListRequestV1Schema.parse({
      runId: 'run-1',
      lifecycles: ['waiting_for_approval', 'outcome_uncertain'],
    });
    expect(filtered.lifecycles).toEqual(['waiting_for_approval', 'outcome_uncertain']);
    expect(WorkflowInvocationListRequestV1Schema.safeParse({
      runId: 'run-1',
      lifecycles: ['unknown_lifecycle'],
    }).success).toBe(false);
    expect(WorkflowInvocationListRequestV1Schema.safeParse({
      runId: 'run-1',
      lifecycles: [],
    }).success).toBe(false);

    const page = WorkflowInvocationListResultV1Schema.parse({
      invocations: [{
        id: 'inv-1', runId: 'run-1', sequence: '0', parentRecordId: null,
        memberOrdinal: '12', attempt: '2', lifecycle: 'running',
        createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
      }],
      parentRevision: 4,
    });
    expect(page.parentRevision).toBe(4);
    expect(page.invocations[0]).toMatchObject({ sequence: '0', memberOrdinal: '12', attempt: '2' });
    expect(typeof page.invocations[0]?.sequence).toBe('string');
  });
});
