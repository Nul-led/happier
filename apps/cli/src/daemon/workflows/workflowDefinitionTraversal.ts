import type { WorkflowBlock, WorkflowStep } from '@happier-dev/protocol';

export function findWorkflowStepById(
  blocks: readonly WorkflowBlock[],
  blockId: string,
): WorkflowStep | undefined {
  for (const block of blocks) {
    if (block.kind === 'step' && block.id === blockId) return block;
    const nested = block.kind === 'parallel'
      ? block.branches.flatMap((branch) => branch.blocks)
      : block.kind === 'if'
        ? [...block.then, ...block.otherwise]
        : block.kind === 'loop'
          ? [...block.body, ...(block.repetition.kind === 'evaluate' ? [block.repetition.evaluator] : [])]
          : [];
    const found = findWorkflowStepById(nested, blockId);
    if (found) return found;
  }
  return undefined;
}
