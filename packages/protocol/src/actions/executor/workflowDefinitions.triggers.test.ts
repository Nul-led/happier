import { describe, expect, it } from 'vitest';
import { createWorkflowDefinitionActions, type WorkflowDefinitionArtifactOperations } from './workflowDefinitions.js';

describe('workflow deletion trigger custody', () => {
  it('retires triggers before deleting the Artifact and retains the Artifact when retirement fails', async () => {
    const definitionId = '11111111-1111-4111-8111-111111111111';
    const effects: string[] = [];
    let retirementFails = true;
    const store: WorkflowDefinitionArtifactOperations = {
      read: async () => ({ artifactId: definitionId, revision: { headerVersion: 1, bodyVersion: 1 }, body: null,
        header: { kind: 'workflow-definition.v1', definitionId, revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Test' } } }),
      list: async () => ({ items: [] }), create: async () => undefined,
      update: async () => ({ ok: false, errorCode: 'not_found', error: 'not_found' }),
      delete: async () => { effects.push('artifact'); return { ok: true }; },
    };
    const params = { artifactStore: store, encodeListCursor: () => '', assertDefinitionWriteAllowed: () => {},
      removeWorkflowTriggers: async () => { effects.push('triggers'); if (retirementFails) throw new Error('offline'); } };
    const actions = createWorkflowDefinitionActions(params);
    await expect(actions.delete({ definitionId })).rejects.toThrow('offline');
    expect(effects).toEqual(['triggers']);
    effects.length = 0;
    retirementFails = false;
    await actions.delete({ definitionId });
    expect(effects).toEqual(['triggers', 'artifact']);
  });
});
