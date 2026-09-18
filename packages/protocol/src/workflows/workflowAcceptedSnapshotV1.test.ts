import { describe, expect, it } from 'vitest';

import {
  WorkflowAcceptedSnapshotV1Schema,
  deriveWorkflowAcceptedPermissionCeilingV1,
} from './workflowDefinitionV1.js';
import { validateWorkflowDefinition } from './workflowValidationV1.js';

const definition = {
  version: 1 as const,
  inputs: [],
  defaults: {
    agentTarget: {
      kind: 'agent' as const,
      identity: { pluginId: 'happier.agent.test', localId: 'test' },
    },
  },
  blocks: [{
    kind: 'step' as const,
    id: 'step',
    document: { text: 'Work', references: [], attachments: [] },
    input: [],
    result: { kind: 'text' as const },
  }],
};

const workspaceTarget = {
  project: {
    machineId: 'machine-1',
    directory: '/workspace/project/packages/app',
    checkoutRootPath: '/workspace/project',
    workspaceRefId: 'workspace-1',
  },
  originalCommittedRevision: 'a'.repeat(40),
} as const;

describe('WorkflowAcceptedSnapshotV1', () => {
  it('derives one canonical ceiling from every effective nested leaf and the omission default', () => {
    const normalized = validateWorkflowDefinition({
      version: 1,
      defaults: {
        agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } },
        permissionMode: 'read-only',
      },
      blocks: [
        { kind: 'step', id: 'one', document: { text: 'one' }, execution: { permissionMode: 'plan' } },
        {
          kind: 'loop', id: 'loop', body: ['body'],
          repetition: {
            kind: 'evaluate', maxIterations: 2, history: 'none',
            evaluator: {
              kind: 'step', id: 'judge', document: { text: 'judge' },
              execution: { permissionMode: 'safe-yolo' },
              result: { kind: 'decision', decisions: ['continue', 'stop'] },
            },
          },
        },
      ],
    }).normalizedDefinition!;

    expect(deriveWorkflowAcceptedPermissionCeilingV1(normalized)).toBe('safe-yolo');
    expect(deriveWorkflowAcceptedPermissionCeilingV1(validateWorkflowDefinition({
      version: 1,
      defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } } },
      blocks: ['uses canonical omission'],
    }).normalizedDefinition!)).toBe('default');
  });

  it('freezes the complete direct admission correspondence', () => {
    const snapshot = WorkflowAcceptedSnapshotV1Schema.parse({
      definition,
      metadata: { title: 'Frozen release check', description: 'Accepted once' },
      source: { kind: 'saved', definitionId: 'definition-1', revision: { headerVersion: 2, bodyVersion: 4 } },
      inputs: { topic: 'workflow' },
      machineId: 'machine-1',
      executionTarget: { kind: 'attached_run' },
      workspaceTarget,
      origin: { kind: 'direct', originSessionId: 'session-1' },
      authorization: {
        admittedPermissionCeiling: 'read-only',
        principal: { kind: 'api', accountId: 'account-1', principalId: 'principal-1', credentialId: 'credential-1' },
      },
      resultDelivery: {
        kind: 'originating_session', originSessionId: 'session-1', localInputId: 'workflow-input-v2:stable',
      },
    });
    expect(snapshot).toMatchObject({ machineId: 'machine-1', workspaceTarget, inputs: { topic: 'workflow' } });
    expect(snapshot.metadata).toEqual({ title: 'Frozen release check', description: 'Accepted once' });
    expect(snapshot.executionTarget).toEqual({ kind: 'attached_run' });
  });

  it('accepts legacy snapshots without display metadata but rejects malformed metadata', () => {
    const legacy = {
      definition,
      source: { kind: 'inline' as const },
      inputs: {},
      machineId: 'machine-1',
      executionTarget: { kind: 'session' as const },
      workspaceTarget,
      origin: { kind: 'direct' as const },
      authorization: { admittedPermissionCeiling: 'default' as const, principal: { kind: 'host' as const } },
    };
    expect(WorkflowAcceptedSnapshotV1Schema.safeParse(legacy).success).toBe(true);
    expect(WorkflowAcceptedSnapshotV1Schema.safeParse({ ...legacy, metadata: { title: '   ' } }).success).toBe(false);
  });

  it('requires the normalized Run execution target in accepted storage', () => {
    const base = {
      definition,
      source: { kind: 'inline' as const },
      inputs: {},
      machineId: 'machine-1',
      workspaceTarget,
      origin: { kind: 'direct' as const },
      authorization: { admittedPermissionCeiling: 'default' as const, principal: { kind: 'host' as const } },
    };
    expect(WorkflowAcceptedSnapshotV1Schema.safeParse(base).success).toBe(false);
    expect(WorkflowAcceptedSnapshotV1Schema.safeParse({
      ...base,
      executionTarget: { kind: 'session' },
    }).success).toBe(true);
    expect(WorkflowAcceptedSnapshotV1Schema.safeParse({
      ...base,
      executionTarget: { kind: 'detached_run', runId: 'forged' },
    }).success).toBe(false);
  });

  it('rejects delivery to a Session other than the frozen origin', () => {
    expect(WorkflowAcceptedSnapshotV1Schema.safeParse({
      definition,
      source: { kind: 'inline' },
      inputs: {},
      machineId: 'machine-1',
      executionTarget: { kind: 'session' },
      workspaceTarget,
      origin: { kind: 'direct', originSessionId: 'session-1' },
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      resultDelivery: {
        kind: 'originating_session', originSessionId: 'session-2', localInputId: 'workflow-input-v2:stable',
      },
    }).success).toBe(false);
  });

  it('rejects a project workspace from a machine other than the immutable Run target', () => {
    expect(WorkflowAcceptedSnapshotV1Schema.safeParse({
      definition,
      source: { kind: 'inline' },
      inputs: {},
      machineId: 'machine-2',
      executionTarget: { kind: 'session' },
      workspaceTarget,
      origin: { kind: 'direct' },
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
    }).success).toBe(false);
  });
});
