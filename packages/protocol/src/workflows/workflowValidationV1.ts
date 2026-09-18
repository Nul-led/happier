import { z } from 'zod';

import {
  WorkflowBlockSchema,
  WorkflowDefinitionBaseSchema,
  WorkflowInputDefinitionSchema,
  WorkflowStepExecutionSelectionSchema,
  type WorkflowBlock,
  type WorkflowDefinitionV1,
  type WorkflowIngressContextV1,
  type WorkflowStep,
  type WorkflowStepExecutionSelection,
  type WorkflowTargetValidationState,
  type WorkflowValidationIssue,
  type WorkflowValidationIssueCode,
  type WorkflowValidationResult,
} from './workflowV1.js';
import {
  collectWorkflowConditionValueReferences,
  WorkflowAuthoredResultReferenceSchema,
  type WorkflowCondition,
  type WorkflowReferenceScope,
  type WorkflowValueReference,
} from './workflowReferenceV1.js';
import { readWorkflowWorkspaceProducerRef } from './workflowWorkspaceV1.js';

/**
 * Normalization and semantic validation for the canonical workflow definition.
 *
 * The same functions back `workflow.validate`, the editor's local feedback and
 * the Action host's pre-effect check before save or start. There is no second
 * validator: a disagreement here would be a split-brain, not a convenience.
 */

const BLOCK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Loose outer envelope for the ingress dialect. Its members are parsed against
 * their own canonical schemas below so each failure keeps its exact path and
 * issue code instead of collapsing into one union error.
 */
const WorkflowIngressEnvelopeSchema = z.object({
  version: z.literal(1).optional(),
  inputs: z.array(WorkflowInputDefinitionSchema).optional(),
  defaults: z.unknown().optional(),
  blocks: z.array(z.unknown()).min(1),
  finalOutput: WorkflowAuthoredResultReferenceSchema.optional(),
}).strict();

function issue(
  code: WorkflowValidationIssueCode,
  path: string,
  message: string,
  blockId?: string,
): WorkflowValidationIssue {
  return blockId === undefined
    ? { code, path, message, severity: 'error' }
    : { code, path, message, blockId, severity: 'error' };
}

/** Escapes a path segment for the JSON-pointer-like issue path. */
function joinPath(prefix: string, ...segments: ReadonlyArray<string | number>): string {
  let path = prefix;
  for (const segment of segments) {
    path += `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Ingress normalization
// ---------------------------------------------------------------------------

/** Escapes a container path so an assigned id stays inside `WorkflowBlockIdSchema`. */
function escapeAssignedIdPathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '_');
}

/**
 * Deterministic id for a string ingress block: `wf-<parent-path>-step-<ordinal>`.
 *
 * The parent path is the chain of enclosing container segments — empty at the
 * root, `<parallelId>.<branchId>` inside a branch, `<loopId>.body` inside a loop
 * body and `<ifId>.then` / `<ifId>.otherwise` inside a conditional branch — with
 * non-alphanumeric characters escaped to `_`. The algorithm never hashes prompt
 * text and never uses a database row id, so re-normalizing the same authored
 * document is a no-op and a saved document keeps its assigned ids through
 * rename and reorder.
 */
export function assignWorkflowIngressBlockId(params: Readonly<{
  parentPath: string;
  ordinal: number;
  takenIds: ReadonlySet<string>;
}>): string {
  const base = `wf-${escapeAssignedIdPathSegment(params.parentPath)}-step-${params.ordinal}`;
  if (!params.takenIds.has(base)) return base;
  let suffix = 2;
  while (params.takenIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Every id an authored object block already claims, so an assigned id never collides. */
function collectAuthoredIngressIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectAuthoredIngressIds(entry, into);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value['id'] === 'string') into.add(value['id']);
  for (const entry of Object.values(value)) collectAuthoredIngressIds(entry, into);
}

/**
 * Expands prompt-only string entries into text-only steps at every block-list
 * position, assigning each a deterministic scoped id. Structured blocks are
 * returned untouched — an authored id is never rewritten.
 */
function expandIngressStringBlocks(rootBlocks: readonly unknown[]): readonly unknown[] {
  const takenIds = new Set<string>();
  collectAuthoredIngressIds(rootBlocks, takenIds);

  const expandList = (list: readonly unknown[], parentPath: string): unknown[] => list.map((entry, index) => {
    if (typeof entry === 'string') {
      const id = assignWorkflowIngressBlockId({ parentPath, ordinal: index, takenIds });
      takenIds.add(id);
      return {
        kind: 'step',
        id,
        document: { text: entry, references: [], attachments: [] },
        input: [],
        result: { kind: 'text' },
      } satisfies WorkflowStep;
    }
    if (!isRecord(entry)) return entry;

    const ownId = typeof entry['id'] === 'string' ? entry['id'] : '';
    if (entry['kind'] === 'parallel' && Array.isArray(entry['branches'])) {
      return {
        ...entry,
        branches: entry['branches'].map((branch) => {
          if (!isRecord(branch) || !Array.isArray(branch['blocks'])) return branch;
          const branchId = typeof branch['id'] === 'string' ? branch['id'] : '';
          return { ...branch, blocks: expandList(branch['blocks'], `${ownId}.${branchId}`) };
        }),
      };
    }
    if (entry['kind'] === 'loop' && Array.isArray(entry['body'])) {
      return { ...entry, body: expandList(entry['body'], `${ownId}.body`) };
    }
    if (entry['kind'] === 'if') {
      const next: Record<string, unknown> = { ...entry };
      if (Array.isArray(entry['then'])) next['then'] = expandList(entry['then'], `${ownId}.then`);
      if (Array.isArray(entry['otherwise'])) {
        next['otherwise'] = expandList(entry['otherwise'], `${ownId}.otherwise`);
      }
      return next;
    }
    return entry;
  });

  return expandList(rootBlocks, '');
}

type IngressNormalizationOutcome =
  | Readonly<{ kind: 'parsed'; definition: WorkflowDefinitionV1 }>
  | Readonly<{ kind: 'issues'; issues: readonly WorkflowValidationIssue[] }>;

function mapZodIssueCode(zodIssue: z.core.$ZodIssue): WorkflowValidationIssueCode {
  const path = zodIssue.path.map((segment) => String(segment));
  if (zodIssue.code === 'unrecognized_keys') return 'unknown_field';
  if (path[0] === 'version') return 'invalid_version';
  const last = path[path.length - 1];
  if (last === 'id') return 'invalid_id';
  if (path.includes('attachments')) return 'unsupported_persisted_attachment';
  if (path.includes('maxConcurrent')) return 'invalid_max_concurrent';
  if (path.includes('repetition')) return 'invalid_repetition';
  if (path.includes('onlyWhen') || path.includes('when') || path.includes('stopWhen')) return 'invalid_condition';
  if (path.includes('result')) return 'invalid_result_contract';
  // The remaining structural failures are malformed authored values. The closed
  // Protocol union has no generic parse code, and `invalid_input` is its
  // "this authored value cannot be accepted" member.
  return 'invalid_input';
}

function issuesFromZodError(error: z.ZodError<unknown>, pathPrefix = ''): readonly WorkflowValidationIssue[] {
  return error.issues.map((zodIssue) => issue(
    mapZodIssueCode(zodIssue),
    joinPath(pathPrefix, ...zodIssue.path.map((segment) => String(segment))),
    zodIssue.message,
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rejects transfer-owned staged media before parsing so the author sees the
 * exact repairable reason instead of an unrecognized-key message. A staged
 * claim is device-local; a portable definition needs a durable Account-backed
 * reference first.
 */
function collectStagedAttachmentIssues(input: unknown): readonly WorkflowValidationIssue[] {
  const found: WorkflowValidationIssue[] = [];
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, joinPath(path, index)));
      return;
    }
    if (!isRecord(value)) return;
    const attachments = value['attachments'];
    if (Array.isArray(attachments)) {
      attachments.forEach((attachment, index) => {
        if (isRecord(attachment) && attachment['content'] !== undefined) {
          found.push(issue(
            'unsupported_persisted_attachment',
            joinPath(path, 'attachments', index, 'content'),
            'Staged media must have a durable Account-backed reference before it can be saved in a workflow.',
            typeof value['id'] === 'string' ? value['id'] : undefined,
          ));
        }
      });
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'attachments') continue;
      walk(entry, joinPath(path, key));
    }
  };
  walk(input, '');
  return found;
}

/**
 * Accepts the ingress dialect (prompt-only string blocks, omitted version and
 * defaults) and produces exactly one canonical definition. It applies the
 * documented legacy sequential/fail-stop item defaults only here; current
 * writers emit those fields explicitly.
 */
function normalizeIngressShape(
  input: unknown,
  context: WorkflowIngressContextV1 | undefined,
): IngressNormalizationOutcome {
  const stagedIssues = collectStagedAttachmentIssues(input);
  if (stagedIssues.length > 0) return { kind: 'issues', issues: stagedIssues };

  const parsedEnvelope = WorkflowIngressEnvelopeSchema.safeParse(input);
  if (!parsedEnvelope.success) {
    return { kind: 'issues', issues: issuesFromZodError(parsedEnvelope.error) };
  }
  const envelope = parsedEnvelope.data;

  // Blocks and defaults are parsed against their own schemas rather than
  // through the ingress union, so an unrecognized key or a structured block
  // missing its id produces its exact path-addressed code instead of one
  // opaque union failure.
  const memberIssues: WorkflowValidationIssue[] = [];
  const parsedDefaults = WorkflowStepExecutionSelectionSchema.safeParse(envelope.defaults ?? {});
  if (!parsedDefaults.success) {
    memberIssues.push(...issuesFromZodError(parsedDefaults.error, '/defaults'));
  }

  // Strings are expanded everywhere a block may appear, before any strict parse,
  // so the canonical schema only ever sees structured blocks with real ids.
  const expandedBlocks = expandIngressStringBlocks(envelope.blocks);

  const parsedBlocks: WorkflowBlock[] = [];
  expandedBlocks.forEach((entry, index) => {
    const parsedBlock = WorkflowBlockSchema.safeParse(entry);
    if (!parsedBlock.success) {
      memberIssues.push(...issuesFromZodError(parsedBlock.error, joinPath('/blocks', index)));
      return;
    }
    parsedBlocks.push(parsedBlock.data);
  });

  if (memberIssues.length > 0) return { kind: 'issues', issues: memberIssues };

  const blocks: readonly WorkflowBlock[] = parsedBlocks;

  const defaults = parsedDefaults.success ? parsedDefaults.data : {};
  const effectiveDefaults = defaults.agentTarget === undefined && context?.agentTarget !== undefined
    ? { ...defaults, agentTarget: context.agentTarget }
    : defaults;

  const candidate = {
    version: 1 as const,
    inputs: envelope.inputs ?? [],
    defaults: effectiveDefaults,
    blocks,
    ...(envelope.finalOutput === undefined ? {} : { finalOutput: envelope.finalOutput }),
  };

  // Reparse the normalized result through the canonical definition schema so
  // storage only ever holds a shape this schema accepts.
  const reparsed = WorkflowDefinitionBaseSchema.safeParse(candidate);
  if (!reparsed.success) {
    return { kind: 'issues', issues: issuesFromZodError(reparsed.error) };
  }
  return { kind: 'parsed', definition: reparsed.data as WorkflowDefinitionV1 };
}

/**
 * Public normalization entry point. Returns the canonical definition or the
 * path-addressed issues that prevented it.
 */
export function normalizeWorkflowIngress(
  input: unknown,
  context?: WorkflowIngressContextV1,
): IngressNormalizationOutcome {
  return normalizeIngressShape(input, context);
}

// ---------------------------------------------------------------------------
// Semantic walk
// ---------------------------------------------------------------------------

type ScopeLevel = Readonly<{
  /** Ordered members of this block list. */
  blocks: readonly WorkflowBlock[];
  /** Branch ids each parallel member exposes as an addressable producer. */
  branchIdsByIndex: ReadonlyMap<number, readonly string[]>;
  /** Set when this level is a loop body, so `previous_iteration` can name it. */
  loopBlockId: string | null;
  /** Whether the enclosing loop iterates a resolved item list. */
  loopHasItems: boolean;
}>;

type WalkState = {
  readonly issues: WorkflowValidationIssue[];
  readonly seenIds: Map<string, string>;
  readonly inputNames: ReadonlySet<string>;
  readonly hasWorkflowAgentDefault: boolean;
  readonly workflowDefaults: WorkflowStepExecutionSelection;
  readonly levels: ScopeLevel[];
  /** Index currently being visited at each level; parallel to `levels`. */
  readonly positions: number[];
};

function recordId(state: WalkState, id: string, path: string): void {
  if (!BLOCK_ID_PATTERN.test(id)) {
    state.issues.push(issue('invalid_id', path, `"${id}" is not a valid block id.`, id));
    return;
  }
  const existing = state.seenIds.get(id);
  if (existing !== undefined) {
    state.issues.push(issue('duplicate_id', path, `Block id "${id}" is already used at ${existing}.`, id));
    return;
  }
  state.seenIds.set(id, path);
}

function producerCandidatesAt(level: ScopeLevel, exclusivePosition: number): ReadonlySet<string> {
  const candidates = new Set<string>();
  const limit = Math.min(exclusivePosition, level.blocks.length);
  for (let index = 0; index < limit; index += 1) {
    candidates.add(level.blocks[index]!.id);
    for (const branchId of level.branchIdsByIndex.get(index) ?? []) candidates.add(branchId);
  }
  return candidates;
}

type ResolvedScope =
  | Readonly<{ kind: 'resolved'; level: ScopeLevel; exclusivePosition: number }>
  | Readonly<{ kind: 'unresolvable'; message: string }>;

function resolveReferenceScope(state: WalkState, scope: WorkflowReferenceScope): ResolvedScope {
  const depth = state.levels.length;
  if (scope.kind === 'current') {
    return {
      kind: 'resolved',
      level: state.levels[depth - 1]!,
      exclusivePosition: state.positions[depth - 1]!,
    };
  }
  if (scope.kind === 'outer') {
    const levelIndex = depth - 1 - scope.levels;
    if (levelIndex < 0) {
      return { kind: 'unresolvable', message: `There are not ${scope.levels} enclosing levels here.` };
    }
    return {
      kind: 'resolved',
      level: state.levels[levelIndex]!,
      exclusivePosition: state.positions[levelIndex]!,
    };
  }
  for (let levelIndex = depth - 1; levelIndex >= 0; levelIndex -= 1) {
    const level = state.levels[levelIndex]!;
    if (level.loopBlockId === scope.loopBlockId) {
      // A previous iteration of an enclosing loop has completed its whole body,
      // so every member of that body is addressable.
      return { kind: 'resolved', level, exclusivePosition: level.blocks.length };
    }
  }
  return {
    kind: 'unresolvable',
    message: `"${scope.loopBlockId}" is not an enclosing loop of this block.`,
  };
}

function validateValueReference(
  state: WalkState,
  reference: WorkflowValueReference,
  path: string,
  blockId: string,
): void {
  switch (reference.kind) {
    case 'literal':
      return;
    case 'input': {
      if (!state.inputNames.has(reference.name)) {
        state.issues.push(issue(
          'missing_reference',
          joinPath(path, 'name'),
          `No workflow input named "${reference.name}" is declared.`,
          blockId,
        ));
      }
      return;
    }
    case 'item': {
      const insideItemsLoop = state.levels.some((level) => level.loopHasItems);
      if (!insideItemsLoop) {
        state.issues.push(issue(
          'invalid_reference_scope',
          path,
          'The current item is only available inside a for-each loop.',
          blockId,
        ));
      }
      return;
    }
    case 'iteration': {
      const insideLoop = state.levels.some((level) => level.loopBlockId !== null);
      if (!insideLoop) {
        state.issues.push(issue(
          'invalid_reference_scope',
          path,
          'Iteration facts are only available inside a loop.',
          blockId,
        ));
      }
      return;
    }
    case 'result':
    case 'workspace': {
      const resolved = resolveReferenceScope(state, reference.producer.scope);
      if (resolved.kind === 'unresolvable') {
        state.issues.push(issue(
          'invalid_reference_scope',
          joinPath(path, 'producer', 'scope'),
          resolved.message,
          blockId,
        ));
        return;
      }
      const candidates = producerCandidatesAt(resolved.level, resolved.exclusivePosition);
      if (!candidates.has(reference.producer.blockId)) {
        const known = state.seenIds.has(reference.producer.blockId);
        state.issues.push(known
          ? issue(
            'invalid_reference_scope',
            joinPath(path, 'producer', 'blockId'),
            `"${reference.producer.blockId}" does not complete before this block in the selected scope.`,
            blockId,
          )
          : issue(
            'missing_reference',
            joinPath(path, 'producer', 'blockId'),
            `No block named "${reference.producer.blockId}" is available here.`,
            blockId,
          ));
      }
      return;
    }
  }
}

function validateCondition(
  state: WalkState,
  condition: WorkflowCondition,
  path: string,
  blockId: string,
): void {
  for (const reference of collectWorkflowConditionValueReferences(condition)) {
    validateValueReference(state, reference, path, blockId);
  }
  const pending: WorkflowCondition[] = [condition];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.kind === 'compare' && current.operator !== 'eq' && current.operator !== 'neq') {
      const left = current.left;
      const right = current.right;
      if (left.kind === 'literal' && right.kind === 'literal') {
        const comparable = (typeof left.value === 'number' && typeof right.value === 'number')
          || (typeof left.value === 'string' && typeof right.value === 'string');
        if (!comparable) {
          state.issues.push(issue(
            'invalid_condition',
            path,
            `"${current.operator}" needs two numbers or two strings to compare.`,
            blockId,
          ));
        }
      }
    } else if (current.kind === 'all' || current.kind === 'any') {
      pending.push(...current.conditions);
    } else if (current.kind === 'not') {
      pending.push(current.condition);
    }
  }
}

function validateStepExecution(state: WalkState, step: WorkflowStep, path: string): void {
  const execution = step.execution;
  const hasEffectiveAgent = execution?.agentTarget !== undefined
    ? execution.agentTarget !== null
    : state.hasWorkflowAgentDefault;
  if (!hasEffectiveAgent) {
    state.issues.push(issue(
      'target_unavailable',
      joinPath(path, 'execution', 'agentTarget'),
      'This step has no Agent. Choose a workflow default Agent or set one on the step.',
      step.id,
    ));
  }

  const effectiveConversation = execution?.conversation ?? state.workflowDefaults.conversation;
  const effectiveWorkspace = execution?.workspace ?? state.workflowDefaults.workspace;
  if (effectiveConversation?.kind === 'existing_session' && effectiveWorkspace?.kind === 'new_worktree') {
    state.issues.push(issue(
      'conversation_workspace_mismatch',
      joinPath(path, 'execution', 'workspace'),
      'An existing Session keeps its current workspace and cannot use a new workflow worktree.',
      step.id,
    ));
  }

  if (execution?.conversation?.kind === 'from_step') {
    validateValueReference(
      state,
      { kind: 'result', producer: execution.conversation.producer, path: [] },
      joinPath(path, 'execution', 'conversation'),
      step.id,
    );
  }
  if (execution?.workspace !== undefined) {
    const producer = readWorkflowWorkspaceProducerRef(execution.workspace);
    if (producer !== null) {
      validateValueReference(
        state,
        { kind: 'result', producer, path: [] },
        joinPath(path, 'execution', 'workspace'),
        step.id,
      );
    }
  }
}

function validateStep(
  state: WalkState,
  step: WorkflowStep,
  path: string,
  options?: Readonly<{ requireDecisionResult?: boolean }>,
): void {
  validateStepExecution(state, step, path);
  step.input.forEach((reference, index) => {
    validateValueReference(state, reference, joinPath(path, 'input', index), step.id);
  });
  if (step.onlyWhen !== undefined) {
    validateCondition(state, step.onlyWhen, joinPath(path, 'onlyWhen'), step.id);
  }
  if (options?.requireDecisionResult === true && step.result.kind !== 'decision') {
    state.issues.push(issue(
      'invalid_result_contract',
      joinPath(path, 'result'),
      'An evaluator step must return a continue/stop decision.',
      step.id,
    ));
  }
  if (options?.requireDecisionResult !== true && step.result.kind === 'decision') {
    state.issues.push(issue(
      'invalid_result_contract',
      joinPath(path, 'result'),
      'Only a loop evaluator can return a continue/stop decision.',
      step.id,
    ));
  }
  if (step.result.kind === 'json' && !isRecord(step.result.schema)) {
    state.issues.push(issue(
      'invalid_result_contract',
      joinPath(path, 'result', 'schema'),
      'A structured result contract needs a JSON Schema object.',
      step.id,
    ));
  }
}

function withScope<T>(
  state: WalkState,
  level: ScopeLevel,
  run: (enter: (position: number) => void) => T,
): T {
  state.levels.push(level);
  state.positions.push(0);
  try {
    return run((position) => {
      state.positions[state.positions.length - 1] = position;
    });
  } finally {
    state.levels.pop();
    state.positions.pop();
  }
}

function buildScopeLevel(
  blocks: readonly WorkflowBlock[],
  loop: Readonly<{ blockId: string; hasItems: boolean }> | null,
): ScopeLevel {
  const branchIdsByIndex = new Map<number, readonly string[]>();
  blocks.forEach((block, index) => {
    if (block.kind === 'parallel') {
      branchIdsByIndex.set(index, block.branches.map((branch) => branch.id));
    }
  });
  return {
    blocks,
    branchIdsByIndex,
    loopBlockId: loop?.blockId ?? null,
    loopHasItems: loop?.hasItems ?? false,
  };
}

function collectDeclaredIds(state: WalkState, blocks: readonly WorkflowBlock[], path: string): void {
  blocks.forEach((block, index) => {
    const blockPath = joinPath(path, index);
    recordId(state, block.id, joinPath(blockPath, 'id'));
    switch (block.kind) {
      case 'step':
        break;
      case 'parallel':
        block.branches.forEach((branch, branchIndex) => {
          const branchPath = joinPath(blockPath, 'branches', branchIndex);
          recordId(state, branch.id, joinPath(branchPath, 'id'));
          collectDeclaredIds(state, branch.blocks, joinPath(branchPath, 'blocks'));
        });
        break;
      case 'loop':
        if (block.repetition.kind === 'evaluate') {
          recordId(
            state,
            block.repetition.evaluator.id,
            joinPath(blockPath, 'repetition', 'evaluator', 'id'),
          );
        }
        collectDeclaredIds(state, block.body, joinPath(blockPath, 'body'));
        break;
      case 'if':
        collectDeclaredIds(state, block.then, joinPath(blockPath, 'then'));
        collectDeclaredIds(state, block.otherwise, joinPath(blockPath, 'otherwise'));
        break;
    }
  });
}

function validateBlockList(state: WalkState, level: ScopeLevel, path: string): void {
  withScope(state, level, (enter) => {
    level.blocks.forEach((block, index) => {
      enter(index);
      const blockPath = joinPath(path, index);
      switch (block.kind) {
        case 'step':
          validateStep(state, block, blockPath);
          break;
        case 'parallel': {
          if (block.onlyWhen !== undefined) {
            validateCondition(state, block.onlyWhen, joinPath(blockPath, 'onlyWhen'), block.id);
          }
          block.branches.forEach((branch, branchIndex) => {
            const branchPath = joinPath(blockPath, 'branches', branchIndex, 'blocks');
            validateBlockList(state, buildScopeLevel(branch.blocks, null), branchPath);
          });
          break;
        }
        case 'loop': {
          if (block.onlyWhen !== undefined) {
            validateCondition(state, block.onlyWhen, joinPath(blockPath, 'onlyWhen'), block.id);
          }
          validateLoop(state, block, blockPath);
          break;
        }
        case 'if': {
          validateCondition(state, block.when, joinPath(blockPath, 'when'), block.id);
          validateBlockList(state, buildScopeLevel(block.then, null), joinPath(blockPath, 'then'));
          validateBlockList(state, buildScopeLevel(block.otherwise, null), joinPath(blockPath, 'otherwise'));
          break;
        }
      }
    });
  });
}

function validateLoop(
  state: WalkState,
  block: Extract<WorkflowBlock, Readonly<{ kind: 'loop' }>>,
  blockPath: string,
): void {
  const repetition = block.repetition;
  const repetitionPath = joinPath(blockPath, 'repetition');

  // Entry-time references resolve in the loop's own scope, which is already the
  // active level when this runs.
  if (repetition.kind === 'count') {
    validateValueReference(state, repetition.count, joinPath(repetitionPath, 'count'), block.id);
    if (repetition.count.kind === 'literal') {
      const count = repetition.count.value;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
        state.issues.push(issue(
          'invalid_repetition',
          joinPath(repetitionPath, 'count'),
          'A repeat count must be a whole number of at least 1.',
          block.id,
        ));
      }
    }
  }
  if (repetition.kind === 'items') {
    validateValueReference(state, repetition.items, joinPath(repetitionPath, 'items'), block.id);
    if (repetition.items.kind === 'literal' && !Array.isArray(repetition.items.value)) {
      state.issues.push(issue(
        'invalid_repetition',
        joinPath(repetitionPath, 'items'),
        'A for-each list must be a list.',
        block.id,
      ));
    }
    if (repetition.execution === 'sequential' && repetition.maxConcurrent !== undefined) {
      state.issues.push(issue(
        'invalid_max_concurrent',
        joinPath(repetitionPath, 'maxConcurrent'),
        'Maximum concurrent items applies only to parallel items.',
        block.id,
      ));
    }
  }

  const bodyLevel = buildScopeLevel(block.body, {
    blockId: block.id,
    hasItems: repetition.kind === 'items',
  });
  validateBlockList(state, bodyLevel, joinPath(blockPath, 'body'));

  // The continuation section runs after the body, so it resolves inside the
  // body scope with every body member already complete.
  if (repetition.kind === 'until' || repetition.kind === 'evaluate') {
    withScope(state, bodyLevel, (enter) => {
      enter(bodyLevel.blocks.length);
      if (repetition.kind === 'until') {
        validateCondition(state, repetition.stopWhen, joinPath(repetitionPath, 'stopWhen'), block.id);
      } else {
        validateStep(
          state,
          repetition.evaluator,
          joinPath(repetitionPath, 'evaluator'),
          { requireDecisionResult: true },
        );
      }
    });
  }
}

function validateInputs(state: WalkState, definition: WorkflowDefinitionV1): void {
  const seen = new Set<string>();
  definition.inputs.forEach((input, index) => {
    const path = joinPath('/inputs', index);
    if (seen.has(input.name)) {
      state.issues.push(issue('invalid_input', joinPath(path, 'name'), `Input "${input.name}" is declared twice.`));
    }
    seen.add(input.name);
    if (input.default !== undefined) {
      const matches = input.valueType === 'json'
        || (input.valueType === 'string' && typeof input.default === 'string')
        || (input.valueType === 'number' && typeof input.default === 'number')
        || (input.valueType === 'boolean' && typeof input.default === 'boolean');
      if (!matches) {
        state.issues.push(issue(
          'invalid_input',
          joinPath(path, 'default'),
          `The default value for "${input.name}" is not a ${input.valueType}.`,
        ));
      }
    }
  });
}

function validateFinalOutput(state: WalkState, definition: WorkflowDefinitionV1): void {
  const finalOutput = definition.finalOutput;
  if (finalOutput === undefined) return;
  const path = '/finalOutput';
  if (finalOutput.producer.scope.kind !== 'current') {
    state.issues.push(issue(
      'invalid_reference_scope',
      joinPath(path, 'producer', 'scope'),
      'The final output must name a top-level block of this workflow.',
    ));
    return;
  }
  const rootLevel = buildScopeLevel(definition.blocks, null);
  const candidates = producerCandidatesAt(rootLevel, rootLevel.blocks.length);
  if (!candidates.has(finalOutput.producer.blockId)) {
    state.issues.push(state.seenIds.has(finalOutput.producer.blockId)
      ? issue(
        'invalid_reference_scope',
        joinPath(path, 'producer', 'blockId'),
        `"${finalOutput.producer.blockId}" is nested inside another block and cannot be the final output.`,
      )
      : issue(
        'missing_reference',
        joinPath(path, 'producer', 'blockId'),
        `No block named "${finalOutput.producer.blockId}" exists in this workflow.`,
      ));
  }
}

export type ValidateWorkflowDefinitionOptions = Readonly<{
  /** Trusted host context; used only when the definition supplies no effective value. */
  context?: WorkflowIngressContextV1;
  /**
   * Contextual target diagnostics resolved by the caller (machine reachability,
   * Agent availability). Absence is reported as `not_requested`, and an
   * unavailable check never withholds the normalized definition.
   */
  targetValidation?: WorkflowTargetValidationState;
  targetIssues?: readonly WorkflowValidationIssue[];
}>;

/**
 * Normalizes and semantically validates a workflow definition or its ingress
 * dialect. `normalizedDefinition` is present whenever parsing and normalization
 * succeed, even when target diagnostics are unavailable.
 */
export function validateWorkflowDefinition(
  input: unknown,
  options: ValidateWorkflowDefinitionOptions = {},
): WorkflowValidationResult {
  const targetValidation = options.targetValidation ?? 'not_requested';
  const normalized = normalizeIngressShape(input, options.context);
  if (normalized.kind === 'issues') {
    return { valid: false, issues: normalized.issues, targetValidation };
  }

  const definition = normalized.definition;
  const state: WalkState = {
    issues: [],
    seenIds: new Map<string, string>(),
    inputNames: new Set(definition.inputs.map((declared) => declared.name)),
    hasWorkflowAgentDefault: definition.defaults.agentTarget != null,
    workflowDefaults: definition.defaults,
    levels: [],
    positions: [],
  };

  validateInputs(state, definition);
  collectDeclaredIds(state, definition.blocks, '/blocks');
  validateBlockList(state, buildScopeLevel(definition.blocks, null), '/blocks');
  validateFinalOutput(state, definition);

  const targetIssues = options.targetIssues ?? [];
  const issues = [...state.issues, ...targetIssues];
  const valid = issues.every((entry) => entry.severity !== 'error');
  return { valid, normalizedDefinition: definition, issues, targetValidation };
}
