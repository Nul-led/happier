import { describe, expect, it } from 'vitest';

import { createAutomationWorkflowAcceptedSnapshotV1 } from './automationWorkflowSnapshotV1.js';
import {
  AutomationStoredWorkflowDefinitionRecipeV2Schema,
  parseAutomationStoredWorkflowDefinitionRecipeV2,
  serializeAutomationStoredWorkflowDefinitionRecipeV2,
} from './automationWorkflowRecipeV2.js';
import {
  AutomationDefinitionCreateRequestSchema,
  AutomationV3WorkerClaimedRunSchema,
} from './automationApiV3.js';

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
    id: 'review',
    document: { text: 'Review the repository', references: [], attachments: [] },
    input: [],
    result: { kind: 'text' as const },
  }],
};

const workspaceTarget = {
  project: {
    machineId: 'machine-1',
    directory: '/workspace/project',
    checkoutRootPath: '/workspace/project',
  },
} as const;

const projectTarget = {
  machineId: 'machine-1',
  directory: '/workspace/project',
} as const;

describe('createAutomationWorkflowAcceptedSnapshotV1', () => {
  it('validates through the canonical workflow definition and stamps Automation origin', () => {
    expect(createAutomationWorkflowAcceptedSnapshotV1({
      automationId: 'automation-1',
      definition,
      inputs: {},
      machineId: 'machine-1',
      workspaceTarget,
    })).toEqual({
      kind: 'available',
      snapshot: {
        definition,
        inputs: {},
        machineId: 'machine-1',
        executionTarget: { kind: 'session' },
        workspaceTarget,
        authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
        source: { kind: 'automation', automationId: 'automation-1' },
      },
    });
  });

  it('freezes an explicit strict Run-level execution target', () => {
    expect(createAutomationWorkflowAcceptedSnapshotV1({
      automationId: 'automation-1',
      definition,
      inputs: {},
      machineId: 'machine-1',
      executionTarget: { kind: 'detached_run' },
      workspaceTarget,
    })).toMatchObject({
      kind: 'available',
      snapshot: { executionTarget: { kind: 'detached_run' } },
    });
  });

  it('freezes private Automation display metadata into the accepted snapshot', () => {
    expect(createAutomationWorkflowAcceptedSnapshotV1({
      automationId: 'automation-1',
      definition,
      metadata: { title: 'Nightly release check', description: 'Frozen when admitted' },
      inputs: {},
      machineId: 'machine-1',
      workspaceTarget,
    })).toMatchObject({
      kind: 'available',
      snapshot: { metadata: { title: 'Nightly release check', description: 'Frozen when admitted' } },
    });
  });

  it('preserves the optional source Artifact identity without inventing a second revision', () => {
    expect(createAutomationWorkflowAcceptedSnapshotV1({
      automationId: 'automation-1',
      definition,
      inputs: {},
      machineId: 'machine-1',
      workspaceTarget,
      source: {
        definitionId: 'definition-1',
        revision: { headerVersion: 3, bodyVersion: 5 },
      },
    })).toEqual({
      kind: 'available',
      snapshot: {
        definition,
        inputs: {},
        machineId: 'machine-1',
        executionTarget: { kind: 'session' },
        workspaceTarget,
        authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
        source: {
          kind: 'automation',
          automationId: 'automation-1',
          definitionId: 'definition-1',
          revision: { headerVersion: 3, bodyVersion: 5 },
        },
      },
    });
  });

  it('fails closed for an invalid workflow instead of accepting a legacy prompt shape', () => {
    expect(createAutomationWorkflowAcceptedSnapshotV1({
      automationId: 'automation-1',
      definition: { prompt: 'legacy prompt' },
      inputs: {},
      machineId: 'machine-1',
      workspaceTarget,
    })).toMatchObject({ kind: 'contentInvalid' });
  });
});

describe('AutomationStoredWorkflowDefinitionRecipeV2', () => {
  const recipe = {
    v: 2 as const,
    templateVersion: 4,
    workflow: {
      t: 'plain' as const,
      v: {
        definition,
        metadata: { title: 'Daily review' },
        project: projectTarget,
      },
    },
    triggerEvidence: null,
  };

  it('stores the canonical definition inside the incumbent private Automation envelope', () => {
    expect(AutomationStoredWorkflowDefinitionRecipeV2Schema.parse(recipe)).toEqual(recipe);
    const serialized = serializeAutomationStoredWorkflowDefinitionRecipeV2(recipe);
    expect(serialized.kind).toBe('available');
    if (serialized.kind !== 'available') throw new Error('expected available recipe');
    expect(parseAutomationStoredWorkflowDefinitionRecipeV2(serialized.serialized)).toEqual(serialized);
  });

  it('is accepted by the existing Automation definition writer contract', () => {
    expect(AutomationDefinitionCreateRequestSchema.safeParse({
      automationId: 'automation-1',
      name: 'Daily review',
      enabled: true,
      executionRecipe: recipe,
      assignments: [{ machineId: 'machine-1' }],
      triggers: [],
    }).success).toBe(true);
  });

  it('rejects legacy prompt content, occurrence evidence, and authored authority', () => {
    expect(AutomationStoredWorkflowDefinitionRecipeV2Schema.safeParse({
      ...recipe,
      workflow: { t: 'plain', v: { prompt: 'legacy' } },
    }).success).toBe(false);
    expect(AutomationStoredWorkflowDefinitionRecipeV2Schema.safeParse({
      ...recipe,
      triggerEvidence: { t: 'encrypted', c: 'opaque' },
    }).success).toBe(false);
    expect(AutomationDefinitionCreateRequestSchema.safeParse({
      automationId: 'automation-1',
      name: 'Untrusted workflow',
      enabled: true,
      executionRecipe: {
        ...recipe,
        authorization: { admittedPermissionCeiling: 'yolo' },
      },
      assignments: [{ machineId: 'machine-1' }],
      triggers: [],
    }).success).toBe(false);
  });

  it('keeps Automation occurrence evidence separate on the private workflow claim', () => {
    expect(AutomationV3WorkerClaimedRunSchema.parse({
      id: 'run-1',
      automationId: 'automation-1',
      attempt: 1,
      revision: 2,
      recipeKind: 'workflow-v2',
      executionInputEnvelope: JSON.stringify(recipe.workflow),
      automationEvidenceEnvelope: JSON.stringify({ t: 'plain', v: { event: 'created' } }),
      triggerId: null,
      triggerRetired: false,
      cause: { kind: 'manual', invokedAt: 1 },
    }).automationEvidenceEnvelope).toBe(JSON.stringify({ t: 'plain', v: { event: 'created' } }));
  });

  it('requires an explicit claim recipe discriminator', () => {
    const workflowClaim = {
      id: 'run-1',
      automationId: 'automation-1',
      attempt: 1,
      revision: 2,
      executionInputEnvelope: JSON.stringify(recipe.workflow),
      automationEvidenceEnvelope: null,
      triggerId: null,
      triggerRetired: false,
      cause: { kind: 'manual' as const, invokedAt: 1 },
    };

    expect(AutomationV3WorkerClaimedRunSchema.safeParse(workflowClaim).success).toBe(false);
    expect(AutomationV3WorkerClaimedRunSchema.safeParse({
      ...workflowClaim,
      recipeKind: 'workflow-v2',
    }).success).toBe(true);
    expect(AutomationV3WorkerClaimedRunSchema.safeParse({
      id: workflowClaim.id,
      automationId: workflowClaim.automationId,
      attempt: workflowClaim.attempt,
      revision: workflowClaim.revision,
      recipeKind: 'legacy',
      executionInputEnvelope: workflowClaim.executionInputEnvelope,
      triggerId: workflowClaim.triggerId,
      triggerRetired: workflowClaim.triggerRetired,
      cause: workflowClaim.cause,
    }).success).toBe(true);
  });
});
