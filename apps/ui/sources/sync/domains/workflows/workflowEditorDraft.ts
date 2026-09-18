import type { WorkflowAuthoredResultReference } from '@happier-dev/protocol/workflows/workflowReferenceV1';
import type {
  WorkflowBlock,
  WorkflowInputDefinition,
  WorkflowParallelBranch,
  WorkflowStep,
  WorkflowStepExecutionSelection,
} from '@happier-dev/protocol/workflows/workflowV1';

/**
 * The one neutral authored workflow draft.
 *
 * It holds exactly what the author wrote — name, declared inputs, workflow
 * defaults, the recursive block list and the optional final-output binding —
 * using the canonical Protocol block types rather than a second UI dialect. A
 * draft may be temporarily incomplete (an empty prompt, a dangling reference);
 * only the canonical validator decides whether it can be saved or run.
 *
 * This module owns no persistence, no lifecycle and no run state. The
 * Automation editor draft consumes it rather than keeping a rival copy.
 */

export type WorkflowEditorDraft = Readonly<{
  /** Stable identity of this editing session's document. */
  draftId: string;
  name: string;
  inputs: readonly WorkflowInputDefinition[];
  defaults: WorkflowStepExecutionSelection;
  blocks: readonly WorkflowBlock[];
  finalOutput?: WorkflowAuthoredResultReference;
}>;

/**
 * Where a block list lives. Addressing by owning block id rather than by
 * position keeps every reference valid across reorder, which is what makes
 * "reorder maintains ids" true rather than aspirational.
 */
export type WorkflowBlockListRef =
  | Readonly<{ kind: 'root' }>
  | Readonly<{ kind: 'loopBody'; loopId: string }>
  | Readonly<{ kind: 'ifThen'; ifId: string }>
  | Readonly<{ kind: 'ifOtherwise'; ifId: string }>
  | Readonly<{ kind: 'parallelBranch'; parallelId: string; branchId: string }>;

export type WorkflowEditorViewState = Readonly<{
  /** The one selected block, shared by Steps, Flow and the inspector. */
  selectedBlockId: string | null;
  /** Blocks whose controls or bodies the author collapsed. Collapse never discards values. */
  collapsedBlockIds: ReadonlySet<string>;
}>;

export const EMPTY_WORKFLOW_EDITOR_VIEW_STATE: WorkflowEditorViewState = {
  selectedBlockId: null,
  collapsedBlockIds: new Set<string>(),
};

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/** Every block in authored order, depth-first, including evaluator steps. */
export function walkWorkflowBlocks(blocks: readonly WorkflowBlock[]): readonly WorkflowBlock[] {
  const collected: WorkflowBlock[] = [];
  const visit = (list: readonly WorkflowBlock[]): void => {
    for (const block of list) {
      collected.push(block);
      switch (block.kind) {
        case 'step':
          break;
        case 'parallel':
          for (const branch of block.branches) visit(branch.blocks);
          break;
        case 'loop':
          if (block.repetition.kind === 'evaluate') collected.push(block.repetition.evaluator);
          visit(block.body);
          break;
        case 'if':
          visit(block.then);
          visit(block.otherwise);
          break;
      }
    }
  };
  visit(blocks);
  return collected;
}

export function collectWorkflowBlockIds(draft: WorkflowEditorDraft): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const block of walkWorkflowBlocks(draft.blocks)) {
    ids.add(block.id);
    if (block.kind === 'parallel') {
      for (const branch of block.branches) ids.add(branch.id);
    }
  }
  return ids;
}

export function findWorkflowBlock(draft: WorkflowEditorDraft, blockId: string): WorkflowBlock | null {
  for (const block of walkWorkflowBlocks(draft.blocks)) {
    if (block.id === blockId) return block;
  }
  return null;
}

/** The list a block belongs to, so Add and Move know their scope. */
export function findWorkflowBlockListRef(
  draft: WorkflowEditorDraft,
  blockId: string,
): WorkflowBlockListRef | null {
  const search = (list: readonly WorkflowBlock[], ref: WorkflowBlockListRef): WorkflowBlockListRef | null => {
    for (const block of list) {
      if (block.id === blockId) return ref;
      let found: WorkflowBlockListRef | null = null;
      switch (block.kind) {
        case 'parallel':
          for (const branch of block.branches) {
            found ??= search(branch.blocks, { kind: 'parallelBranch', parallelId: block.id, branchId: branch.id });
          }
          break;
        case 'loop':
          found = search(block.body, { kind: 'loopBody', loopId: block.id });
          break;
        case 'if':
          found = search(block.then, { kind: 'ifThen', ifId: block.id })
            ?? search(block.otherwise, { kind: 'ifOtherwise', ifId: block.id });
          break;
        case 'step':
          break;
      }
      if (found !== null) return found;
    }
    return null;
  };
  return search(draft.blocks, { kind: 'root' });
}

// ---------------------------------------------------------------------------
// Structural editing
// ---------------------------------------------------------------------------

/**
 * Rewrites exactly one block list and returns the same draft object when
 * nothing changed, so an edit inside one branch cannot rerender unrelated
 * siblings.
 */
function mapBlockList(
  blocks: readonly WorkflowBlock[],
  target: WorkflowBlockListRef,
  rewrite: (list: readonly WorkflowBlock[]) => readonly WorkflowBlock[],
): readonly WorkflowBlock[] {
  if (target.kind === 'root') {
    const next = rewrite(blocks);
    return next === blocks ? blocks : next;
  }

  let changed = false;
  const nextBlocks = blocks.map((block): WorkflowBlock => {
    switch (block.kind) {
      case 'step':
        return block;
      case 'parallel': {
        let branchChanged = false;
        const branches = block.branches.map((branch): WorkflowParallelBranch => {
          const isTarget = target.kind === 'parallelBranch'
            && target.parallelId === block.id
            && target.branchId === branch.id;
          const nextInner = isTarget
            ? rewrite(branch.blocks)
            : mapBlockList(branch.blocks, target, rewrite);
          if (nextInner === branch.blocks) return branch;
          branchChanged = true;
          return { ...branch, blocks: nextInner };
        });
        if (!branchChanged) return block;
        changed = true;
        return { ...block, branches };
      }
      case 'loop': {
        const isTarget = target.kind === 'loopBody' && target.loopId === block.id;
        const body = isTarget ? rewrite(block.body) : mapBlockList(block.body, target, rewrite);
        if (body === block.body) return block;
        changed = true;
        return { ...block, body };
      }
      case 'if': {
        const thenTarget = target.kind === 'ifThen' && target.ifId === block.id;
        const otherwiseTarget = target.kind === 'ifOtherwise' && target.ifId === block.id;
        const thenBlocks = thenTarget ? rewrite(block.then) : mapBlockList(block.then, target, rewrite);
        const otherwiseBlocks = otherwiseTarget
          ? rewrite(block.otherwise)
          : mapBlockList(block.otherwise, target, rewrite);
        if (thenBlocks === block.then && otherwiseBlocks === block.otherwise) return block;
        changed = true;
        return { ...block, then: thenBlocks, otherwise: otherwiseBlocks };
      }
    }
  });
  return changed ? nextBlocks : blocks;
}

/** Replaces one block wherever it lives, preserving untouched subtree identity. */
export function updateWorkflowBlock(
  draft: WorkflowEditorDraft,
  blockId: string,
  update: (block: WorkflowBlock) => WorkflowBlock,
): WorkflowEditorDraft {
  let changed = false;
  const rewriteList = (list: readonly WorkflowBlock[]): readonly WorkflowBlock[] => {
    let listChanged = false;
    const next = list.map((block): WorkflowBlock => {
      if (block.id === blockId) {
        const replacement = update(block);
        if (replacement === block) return block;
        listChanged = true;
        changed = true;
        return replacement;
      }
      switch (block.kind) {
        case 'step':
          return block;
        case 'parallel': {
          let branchChanged = false;
          const branches = block.branches.map((branch): WorkflowParallelBranch => {
            const inner = rewriteList(branch.blocks);
            if (inner === branch.blocks) return branch;
            branchChanged = true;
            return { ...branch, blocks: inner };
          });
          if (!branchChanged) return block;
          listChanged = true;
          return { ...block, branches };
        }
        case 'loop': {
          const body = rewriteList(block.body);
          let repetition = block.repetition;
          if (block.repetition.kind === 'evaluate' && block.repetition.evaluator.id === blockId) {
            const replacement = update(block.repetition.evaluator);
            if (replacement !== block.repetition.evaluator && replacement.kind === 'step') {
              repetition = { ...block.repetition, evaluator: replacement };
              changed = true;
            }
          }
          if (body === block.body && repetition === block.repetition) return block;
          listChanged = true;
          return { ...block, body, repetition };
        }
        case 'if': {
          const thenBlocks = rewriteList(block.then);
          const otherwiseBlocks = rewriteList(block.otherwise);
          if (thenBlocks === block.then && otherwiseBlocks === block.otherwise) return block;
          listChanged = true;
          return { ...block, then: thenBlocks, otherwise: otherwiseBlocks };
        }
      }
    });
    return listChanged ? next : list;
  };

  const blocks = rewriteList(draft.blocks);
  return changed || blocks !== draft.blocks ? { ...draft, blocks } : draft;
}

export function insertWorkflowBlock(
  draft: WorkflowEditorDraft,
  params: Readonly<{ list: WorkflowBlockListRef; block: WorkflowBlock; afterBlockId?: string | null }>,
): WorkflowEditorDraft {
  const blocks = mapBlockList(draft.blocks, params.list, (list) => {
    const anchor = params.afterBlockId == null
      ? list.length
      : list.findIndex((block) => block.id === params.afterBlockId) + 1;
    const position = anchor <= 0 ? list.length : anchor;
    return [...list.slice(0, position), params.block, ...list.slice(position)];
  });
  return blocks === draft.blocks ? draft : { ...draft, blocks };
}

/**
 * Removes a block and reports the references that became invalid, so the editor
 * can show them for repair instead of silently retargeting them to a
 * neighbouring step.
 */
/**
 * Exactly where a removed block sat, so an Undo can put it back rather than
 * append it. It is a coordinate, not a snapshot of the whole draft: restoring
 * therefore composes with any edit made in between instead of reverting it.
 */
export type WorkflowBlockRemoval = Readonly<{
  list: WorkflowBlockListRef;
  index: number;
  block: WorkflowBlock;
}>;

export function removeWorkflowBlock(
  draft: WorkflowEditorDraft,
  blockId: string,
): Readonly<{
  draft: WorkflowEditorDraft;
  removed: WorkflowBlock | null;
  removal: WorkflowBlockRemoval | null;
}> {
  const removed = findWorkflowBlock(draft, blockId);
  if (removed === null) return { draft, removed: null, removal: null };
  const listRef = findWorkflowBlockListRef(draft, blockId);
  if (listRef === null) return { draft, removed: null, removal: null };

  let removedIndex = -1;
  const blocks = mapBlockList(draft.blocks, listRef, (list) => {
    const index = list.findIndex((block) => block.id === blockId);
    if (index < 0) return list;
    removedIndex = index;
    return [...list.slice(0, index), ...list.slice(index + 1)];
  });
  const removal: WorkflowBlockRemoval | null = removedIndex < 0
    ? null
    : { list: listRef, index: removedIndex, block: removed };
  const finalOutput = draft.finalOutput?.producer.blockId === blockId ? undefined : draft.finalOutput;
  const next: WorkflowEditorDraft = finalOutput === draft.finalOutput
    ? { ...draft, blocks }
    : { ...draft, blocks, ...(finalOutput === undefined ? {} : { finalOutput }) };
  if (finalOutput === undefined && draft.finalOutput !== undefined) {
    const { finalOutput: _dropped, ...rest } = next;
    return { draft: { ...rest, blocks }, removed, removal };
  }
  return { draft: next, removed, removal };
}

/**
 * Puts a removed block back at its recorded position.
 *
 * The index is clamped to the list's current length, because the author may
 * have added or removed siblings before pressing Undo; restoring must not throw
 * away that work or fail. A `finalOutput` binding this removal cleared is not
 * resurrected: that selection is the author's, and re-deriving it here would be
 * a second decision-maker for it.
 */
export function restoreWorkflowBlock(
  draft: WorkflowEditorDraft,
  removal: WorkflowBlockRemoval,
): WorkflowEditorDraft {
  if (findWorkflowBlock(draft, removal.block.id) !== null) return draft;
  const blocks = mapBlockList(draft.blocks, removal.list, (list) => {
    const position = Math.min(Math.max(removal.index, 0), list.length);
    return [...list.slice(0, position), removal.block, ...list.slice(position)];
  });
  return blocks === draft.blocks ? draft : { ...draft, blocks };
}

export type WorkflowBlockMoveDirection = 'up' | 'down' | 'in' | 'out';

/**
 * Keyboard- and screen-reader-reachable reordering. `in` nests a block into the
 * container immediately above it; `out` lifts it to the enclosing list right
 * after that container. Ids never change, so references survive the move and an
 * invalid one stays visible for repair.
 */
export function moveWorkflowBlock(
  draft: WorkflowEditorDraft,
  blockId: string,
  direction: WorkflowBlockMoveDirection,
): WorkflowEditorDraft {
  const listRef = findWorkflowBlockListRef(draft, blockId);
  if (listRef === null) return draft;
  const block = findWorkflowBlock(draft, blockId);
  if (block === null) return draft;

  if (direction === 'up' || direction === 'down') {
    const blocks = mapBlockList(draft.blocks, listRef, (list) => {
      const index = list.findIndex((entry) => entry.id === blockId);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= list.length) return list;
      const next = [...list];
      next[index] = list[target]!;
      next[target] = list[index]!;
      return next;
    });
    return blocks === draft.blocks ? draft : { ...draft, blocks };
  }

  if (direction === 'in') {
    let container: WorkflowBlock | null = null;
    mapBlockList(draft.blocks, listRef, (list) => {
      const index = list.findIndex((entry) => entry.id === blockId);
      container = index > 0 ? list[index - 1]! : null;
      return list;
    });
    const previous = container as WorkflowBlock | null;
    if (previous === null || previous.kind === 'step') return draft;
    const destination = resolveDefaultChildListRef(previous);
    if (destination === null) return draft;
    const removedResult = removeWorkflowBlock(draft, blockId);
    return insertWorkflowBlock(removedResult.draft, { list: destination, block });
  }

  if (listRef.kind === 'root') return draft;
  const containerId = listRef.kind === 'parallelBranch' ? listRef.parallelId
    : listRef.kind === 'loopBody' ? listRef.loopId
      : listRef.ifId;
  const outerList = findWorkflowBlockListRef(draft, containerId);
  if (outerList === null) return draft;
  const removedResult = removeWorkflowBlock(draft, blockId);
  return insertWorkflowBlock(removedResult.draft, {
    list: outerList,
    block,
    afterBlockId: containerId,
  });
}

function resolveDefaultChildListRef(container: WorkflowBlock): WorkflowBlockListRef | null {
  switch (container.kind) {
    case 'parallel': {
      const branch = container.branches[0];
      return branch === undefined
        ? null
        : { kind: 'parallelBranch', parallelId: container.id, branchId: branch.id };
    }
    case 'loop':
      return { kind: 'loopBody', loopId: container.id };
    case 'if':
      return { kind: 'ifThen', ifId: container.id };
    case 'step':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Block creation
// ---------------------------------------------------------------------------

/**
 * Stable ids are assigned at object creation, before validation or save, so a
 * structured block never enters the optional-id dialect the Protocol rejects.
 */
export function createWorkflowBlockId(prefix: string, takenIds: ReadonlySet<string>): string {
  let ordinal = 1;
  while (takenIds.has(`${prefix}-${ordinal}`)) ordinal += 1;
  return `${prefix}-${ordinal}`;
}

export type WorkflowBlockKind = 'step' | 'parallel' | 'loop' | 'if';

export function createWorkflowBlock(
  kind: WorkflowBlockKind,
  takenIds: ReadonlySet<string>,
): WorkflowBlock {
  const assigned = new Set(takenIds);
  const nextId = (prefix: string): string => {
    const id = createWorkflowBlockId(prefix, assigned);
    assigned.add(id);
    return id;
  };
  const emptyStep = (): WorkflowStep => ({
    kind: 'step',
    id: nextId('step'),
    document: { text: '', references: [], attachments: [] },
    input: [],
    result: { kind: 'text' },
  });

  switch (kind) {
    case 'step':
      return emptyStep();
    case 'parallel': {
      const id = nextId('parallel');
      return {
        kind: 'parallel',
        id,
        // Current writers always emit the failure policy explicitly; only the
        // documented legacy ingress may supply the former default.
        failurePolicy: 'fail_stop',
        branches: [
          { id: nextId('branch'), blocks: [emptyStep()] },
          { id: nextId('branch'), blocks: [emptyStep()] },
        ],
      };
    }
    case 'loop': {
      const id = nextId('loop');
      return {
        kind: 'loop',
        id,
        repetition: { kind: 'count', count: { kind: 'literal', value: 2 } },
        body: [emptyStep()],
      };
    }
    case 'if': {
      const id = nextId('if');
      return {
        kind: 'if',
        id,
        when: { kind: 'exists', value: { kind: 'literal', value: true } },
        then: [emptyStep()],
        otherwise: [],
      };
    }
  }
}

export function createWorkflowParallelBranch(takenIds: ReadonlySet<string>): WorkflowParallelBranch {
  const assigned = new Set(takenIds);
  const branchId = createWorkflowBlockId('branch', assigned);
  assigned.add(branchId);
  return {
    id: branchId,
    blocks: [{
      kind: 'step',
      id: createWorkflowBlockId('step', assigned),
      document: { text: '', references: [], attachments: [] },
      input: [],
      result: { kind: 'text' },
    }],
  };
}

// ---------------------------------------------------------------------------
// Draft lifecycle
// ---------------------------------------------------------------------------

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

export function setWorkflowStepText(
  draft: WorkflowEditorDraft,
  blockId: string,
  text: string,
): WorkflowEditorDraft {
  return updateWorkflowBlock(draft, blockId, (block) => {
    if (block.kind !== 'step' || block.document.text === text) return block;
    return { ...block, document: { ...block.document, text } };
  });
}

/**
 * Applies a step override. Passing `undefined` for a field removes the
 * override so the step inherits again; passing `null` records an explicit
 * "automatic/none" choice, and a value equal to the current default stays an
 * explicit override.
 */
export function setWorkflowStepExecutionField<TField extends keyof WorkflowStepExecutionSelection>(
  draft: WorkflowEditorDraft,
  blockId: string,
  field: TField,
  value: WorkflowStepExecutionSelection[TField] | undefined,
): WorkflowEditorDraft {
  return updateWorkflowBlock(draft, blockId, (block) => {
    if (block.kind !== 'step') return block;
    const execution = block.execution ?? {};
    const hadField = Object.hasOwn(execution, field);
    if (value === undefined) {
      if (!hadField) return block;
      const { [field]: _removed, ...rest } = execution;
      if (Object.keys(rest).length === 0) {
        const { execution: _dropped, ...blockRest } = block;
        return blockRest as WorkflowStep;
      }
      return { ...block, execution: rest as WorkflowStepExecutionSelection };
    }
    if (hadField && execution[field] === value) return block;
    return { ...block, execution: { ...execution, [field]: value } };
  });
}

/**
 * Records the step's authored result-wait deadline exactly as chosen, or
 * removes the key so the saved definition carries no deadline at all. The
 * draft never supplies a default duration: omission means no workflow-authored
 * deadline. A value that is not yet a number is kept as the unresolved number
 * the canonical validator rejects, so the page states the repair instead of
 * silently dropping what was typed.
 */
export function setWorkflowStepTimeout(
  draft: WorkflowEditorDraft,
  blockId: string,
  timeoutMs: number | undefined,
): WorkflowEditorDraft {
  return updateWorkflowBlock(draft, blockId, (block) => {
    if (block.kind !== 'step') return block;
    if (timeoutMs === undefined) {
      if (!Object.hasOwn(block, 'timeoutMs')) return block;
      const { timeoutMs: _dropped, ...rest } = block;
      return rest as WorkflowStep;
    }
    if (Object.is(block.timeoutMs, timeoutMs)) return block;
    return { ...block, timeoutMs };
  });
}

export function setWorkflowDefaultField<TField extends keyof WorkflowStepExecutionSelection>(
  draft: WorkflowEditorDraft,
  field: TField,
  value: WorkflowStepExecutionSelection[TField] | undefined,
): WorkflowEditorDraft {
  const hadField = Object.hasOwn(draft.defaults, field);
  if (value === undefined) {
    if (!hadField) return draft;
    const { [field]: _removed, ...rest } = draft.defaults;
    return { ...draft, defaults: rest as WorkflowStepExecutionSelection };
  }
  if (hadField && draft.defaults[field] === value) return draft;
  return { ...draft, defaults: { ...draft.defaults, [field]: value } };
}

export function setWorkflowFinalOutput(
  draft: WorkflowEditorDraft,
  finalOutput: WorkflowAuthoredResultReference | null,
): WorkflowEditorDraft {
  if (finalOutput === null) {
    if (draft.finalOutput === undefined) return draft;
    const { finalOutput: _dropped, ...rest } = draft;
    return rest;
  }
  return { ...draft, finalOutput };
}

export function setWorkflowInputs(
  draft: WorkflowEditorDraft,
  inputs: readonly WorkflowInputDefinition[],
): WorkflowEditorDraft {
  return draft.inputs === inputs ? draft : { ...draft, inputs };
}

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

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
  let siblings: readonly WorkflowBlock[] = [];
  mapBlockList(params.draftBeforeRemoval.blocks, listRef, (list) => {
    siblings = list;
    return list;
  });
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
