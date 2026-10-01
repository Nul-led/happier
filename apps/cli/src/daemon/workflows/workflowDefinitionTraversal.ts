import type { WorkflowBlock, WorkflowStep } from '@happier-dev/protocol';

export function findWorkflowStepById(
  blocks: readonly WorkflowBlock[],
  blockId: string,
): WorkflowStep | undefined {
  const pending: WorkflowBlock[] = [...blocks].reverse();
  while (pending.length > 0) {
    const block = pending.pop()!;
    if (block.kind === 'step' && block.id === blockId) return block;
    const nested = block.kind === 'parallel'
      ? block.branches.flatMap((branch) => branch.blocks)
      : block.kind === 'if'
        ? [...block.then, ...block.otherwise]
        : block.kind === 'loop'
          ? [...block.body, ...(block.repetition.kind === 'evaluate' ? [block.repetition.evaluator] : [])]
          : [];
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      pending.push(nested[index]!);
    }
  }
  return undefined;
}
