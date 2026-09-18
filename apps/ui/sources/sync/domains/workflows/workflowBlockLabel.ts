import type { WorkflowBlock, WorkflowDefinitionV1, WorkflowStep } from '@happier-dev/protocol/workflows/workflowV1';

function workflowStepFirstPromptLine(step: WorkflowStep): string | null {
  return step.document.text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? null;
}

/**
 * A short, content-derived step label for private authoring and Run-detail UI.
 *
 * Labels are a view over the canonical prompt, never another authored or
 * persisted field. The visual bound keeps rows scannable without changing the
 * prompt or its identity.
 */
export function workflowStepPromptLabel(step: WorkflowStep): string | null {
  const firstNonemptyLine = workflowStepFirstPromptLine(step);
  if (firstNonemptyLine === null) return null;
  return firstNonemptyLine.length > 60
    ? `${firstNonemptyLine.slice(0, 60)}…`
    : firstNonemptyLine;
}

function firstWorkflowStep(blocks: readonly WorkflowBlock[]): WorkflowStep | null {
  for (const block of blocks) {
    if (block.kind === 'step') return block;
    if (block.kind === 'parallel') {
      for (const branch of block.branches) {
        const step = firstWorkflowStep(branch.blocks);
        if (step !== null) return step;
      }
      continue;
    }
    if (block.kind === 'if') {
      const step = firstWorkflowStep(block.then) ?? firstWorkflowStep(block.otherwise);
      if (step !== null) return step;
      continue;
    }
    const bodyStep = firstWorkflowStep(block.body);
    if (bodyStep !== null) return bodyStep;
    if (block.repetition.kind === 'evaluate') return block.repetition.evaluator;
  }
  return null;
}

/**
 * Default private title for saving a frozen Run as a new Artifact. The title
 * comes only from opened authored prompt content and is not derived from a
 * public summary, result preview, transcript, or opaque Run id.
 */
export function workflowDefinitionPromptTitle(definition: WorkflowDefinitionV1): string | null {
  const step = firstWorkflowStep(definition.blocks);
  return step === null ? null : workflowStepFirstPromptLine(step);
}

/** Exact ids remain the fallback for reference pickers, where identity matters. */
export function workflowBlockReferenceLabel(block: WorkflowBlock): string {
  return block.kind === 'step'
    ? workflowStepPromptLabel(block) ?? block.id
    : block.id;
}
