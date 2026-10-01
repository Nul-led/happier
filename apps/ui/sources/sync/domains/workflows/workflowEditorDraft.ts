import { createWorkflowBlock, findWorkflowBlockListRef, getWorkflowBlockList, type WorkflowDefinitionDraftV1 } from '@happier-dev/protocol/workflows/workflowDefinitionEditV1';
import type { WorkflowBlock, WorkflowStepExecutionSelection } from '@happier-dev/protocol/workflows/workflowV1';

export type WorkflowEditorDraft = WorkflowDefinitionDraftV1 & Readonly<{ draftId: string }>;

export type WorkflowEditorViewState = Readonly<{
  /** The one selected block, shared by Steps, Flow and the inspector. */
  selectedBlockId: string | null;
  /** Blocks whose controls or bodies the author collapsed. Collapse never discards values. */
  collapsedBlockIds: ReadonlySet<string>;
  /**
   * Settings groups the person opened or closed themselves (04 §5.2). Absent
   * groups follow the inspector's open rule; a recorded choice lasts for the
   * draft's lifetime and is never written into the definition.
   */
  inspectorGroupDisclosure: ReadonlyMap<string, boolean>;
}>;

export const EMPTY_WORKFLOW_EDITOR_VIEW_STATE: WorkflowEditorViewState = {
  selectedBlockId: null,
  collapsedBlockIds: new Set<string>(),
  inspectorGroupDisclosure: new Map<string, boolean>(),
};

export function createWorkflowEditorDraft(params: Readonly<{
  draftId: string;
  name?: string;
  defaults?: WorkflowStepExecutionSelection;
  blocks?: readonly WorkflowBlock[];
}>): WorkflowEditorDraft {
  const blocks = params.blocks ?? [createWorkflowBlock('step', new Set<string>())];
  return {
    draftId: params.draftId,
    name: params.name ?? '',
    inputs: [],
    defaults: params.defaults ?? {},
    blocks,
  };
}

export function selectWorkflowBlock(
  view: WorkflowEditorViewState,
  blockId: string | null,
): WorkflowEditorViewState {
  return view.selectedBlockId === blockId ? view : { ...view, selectedBlockId: blockId };
}

export function toggleWorkflowBlockCollapsed(
  view: WorkflowEditorViewState,
  blockId: string,
): WorkflowEditorViewState {
  const next = new Set(view.collapsedBlockIds);
  if (next.has(blockId)) next.delete(blockId); else next.add(blockId);
  return { ...view, collapsedBlockIds: next };
}

export function setWorkflowInspectorGroupExpanded(
  view: WorkflowEditorViewState,
  groupId: string,
  expanded: boolean,
): WorkflowEditorViewState {
  if (view.inspectorGroupDisclosure.get(groupId) === expanded) return view;
  const next = new Map(view.inspectorGroupDisclosure);
  next.set(groupId, expanded);
  return { ...view, inspectorGroupDisclosure: next };
}

/**
 * After a removal, focus must land on a surviving meaningful control rather
 * than disappearing. Prefer the following sibling, then the previous one, then
 * the enclosing container.
 */
export function resolveSelectionAfterRemoval(params: Readonly<{
  draftBeforeRemoval: WorkflowEditorDraft;
  removedBlockId: string;
}>): string | null {
  const listRef = findWorkflowBlockListRef(params.draftBeforeRemoval, params.removedBlockId);
  if (listRef === null) return null;
  const siblings = getWorkflowBlockList(params.draftBeforeRemoval, listRef) ?? [];
  const index = siblings.findIndex((block) => block.id === params.removedBlockId);
  const next = siblings[index + 1] ?? siblings[index - 1];
  if (next !== undefined) return next.id;
  switch (listRef.kind) {
    case 'root':
      return null;
    case 'loopBody':
      return listRef.loopId;
    case 'ifThen':
    case 'ifOtherwise':
      return listRef.ifId;
    case 'parallelBranch':
      return listRef.parallelId;
  }
}
