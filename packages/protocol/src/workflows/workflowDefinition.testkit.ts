import type { WorkflowBlock, WorkflowDefinitionV1 } from './workflowV1.js';

/** Deep mixed structure exercises every block-list boundary; depth is a fixture, not a limit. */
export function createDeepWorkflowDefinition(depth = 1_200): WorkflowDefinitionV1 {
  let block: WorkflowBlock = {
    kind: 'step', id: 'leaf', document: { text: 'Finish', references: [], attachments: [] },
    input: [], result: { kind: 'text' },
    execution: { modelSelection: null, permissionMode: 'default' },
  };
  for (let index = depth - 1; index >= 0; index -= 1) {
    const id = `container_${index}`;
    switch (index % 3) {
      case 0:
        block = { kind: 'if', id, when: { kind: 'exists', value: { kind: 'literal', value: true } }, then: [block], otherwise: [] };
        break;
      case 1:
        block = { kind: 'parallel', id, failurePolicy: 'collect_outcomes', branches: [{ id: `branch_${index}`, blocks: [block] }] };
        break;
      default:
        block = { kind: 'loop', id, repetition: { kind: 'count', count: { kind: 'literal', value: 1 } }, body: [block] };
    }
  }
  return {
    version: 1, inputs: [], defaults: {
      agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
      modelSelection: null, permissionMode: 'default',
    }, blocks: [block],
  };
}

export function deepWorkflowLeafPath(depth = 1_200): (string | number)[] {
  const path: (string | number)[] = ['blocks', 0];
  for (let index = 0; index < depth; index += 1) {
    if (index % 3 === 0) path.push('then', 0);
    else if (index % 3 === 1) path.push('branches', 0, 'blocks', 0);
    else path.push('body', 0);
  }
  return path;
}
