import type {
  WorkflowBlock,
  WorkflowDefinitionV1,
  WorkflowRepetition,
} from '@happier-dev/protocol/workflows/workflowV1';
import type { WorkflowInvocationLifecycleV1 } from '@happier-dev/protocol/workflows/workflowProgressV1';
import type { SessionWorkflowAgentStatusV1, SessionWorkflowRunSnapshotV1 } from '@happier-dev/protocol';
import { t } from '@/text';
import { workflowStepPromptLabel } from '@/sync/domains/workflows/workflowBlockLabel';

/**
 * The one derived Flow projection.
 *
 * Flow is a reading mode over structure that already exists: an executable
 * definition, or an observed native-activity snapshot. It is not persisted, is
 * not an engine input, and has no independently editable edges, node positions
 * or inferred dependencies. Structure is carried by parent/ordinal rails, so a
 * renderer never needs a directional edge it cannot justify.
 */

export type WorkflowFlowNodeKind =
  | 'step'
  | 'parallel'
  | 'branch'
  | 'loop'
  | 'if'
  | 'thenBranch'
  | 'otherwiseBranch'
  | 'evaluator'
  | 'observedPhase'
  | 'observedAgent';

export type WorkflowFlowRepetitionSummary = Readonly<{
  kind: WorkflowRepetition['kind'];
  /** Present only when the author set it; omission means no workflow limit. */
  maxConcurrent?: number;
  itemExecution?: 'sequential' | 'parallel';
  failurePolicy?: 'fail_stop' | 'collect_outcomes';
  maxIterations?: number;
}>;

/**
 * What Flow's Edit action reveals for a node.
 *
 * `blockId` is always a real authored `WorkflowBlock` the editor can find and
 * select. A step or evaluator is a `prompt`: its composer takes focus. A
 * container is a `block`: it is revealed and selected, and so is a branch or
 * conditional frame, which is not a block of its own and therefore resolves to
 * the group that owns it. Observed activity has no edit target at all.
 */
export type WorkflowFlowEditTarget = Readonly<{
  kind: 'prompt' | 'block';
  blockId: string;
}>;

export type WorkflowFlowNode = Readonly<{
  /** Stable join key across Steps, Flow, Activity and the inspector. */
  nodeId: string;
  /** The authored block or branch this node presents; branches carry their own id. */
  blockId: string;
  kind: WorkflowFlowNodeKind;
  editTarget: WorkflowFlowEditTarget | null;
  label: string;
  depth: number;
  /** 1-based position within the node's own sibling list, for the rail ordinal. */
  ordinal: number;
  parentNodeId: string | null;
  childNodeIds: readonly string[];
  /** Authored container policy shown compactly on collapsed groups. */
  failurePolicy?: 'fail_stop' | 'collect_outcomes';
  maxConcurrent?: number;
  repetition?: WorkflowFlowRepetitionSummary;
  /** True when the node came from an observed snapshot rather than a definition. */
  observed: boolean;
  /** Authoritative observed state; distinct from managed invocation lifecycle. */
  observedStatus?: SessionWorkflowAgentStatusV1;
}>;

export type WorkflowFlowProjection = Readonly<{
  source: 'definition' | 'observed';
  nodes: readonly WorkflowFlowNode[];
  nodesById: ReadonlyMap<string, WorkflowFlowNode>;
  rootNodeIds: readonly string[];
  /**
   * Whether executable relationships between nodes are known. An observed
   * snapshot records phases and agents but not dataflow, so its relationships
   * stay explicitly unknown rather than being inferred from order or timing.
   */
  relationships: 'authored' | 'unknown';
}>;

function labelForBlock(block: WorkflowBlock, fallback: string): string {
  if (block.kind === 'step') return workflowStepPromptLabel(block) ?? fallback;
  return fallback;
}

function summarizeRepetition(repetition: WorkflowRepetition): WorkflowFlowRepetitionSummary {
  switch (repetition.kind) {
    case 'count':
      return { kind: 'count' };
    case 'items':
      return {
        kind: 'items',
        itemExecution: repetition.execution,
        failurePolicy: repetition.failurePolicy,
        ...(repetition.maxConcurrent === undefined ? {} : { maxConcurrent: repetition.maxConcurrent }),
      };
    case 'until':
      return { kind: 'until', maxIterations: repetition.maxIterations };
    case 'evaluate':
      return { kind: 'evaluate', maxIterations: repetition.maxIterations };
  }
}

/**
 * Projects a definition's real structure: ordered steps, parallel branches,
 * conditional branches, loop body and continuation. Nothing is added that the
 * author did not write.
 */
export function projectWorkflowFlow(definition: WorkflowDefinitionV1): WorkflowFlowProjection {
  const nodes: WorkflowFlowNode[] = [];
  const childIdsByNode = new Map<string, string[]>();

  const pushNode = (node: Omit<WorkflowFlowNode, 'childNodeIds'>): void => {
    nodes.push({ ...node, childNodeIds: [] });
    childIdsByNode.set(node.nodeId, []);
    if (node.parentNodeId !== null) childIdsByNode.get(node.parentNodeId)?.push(node.nodeId);
  };

  const visitList = (
    list: readonly WorkflowBlock[],
    parentNodeId: string | null,
    depth: number,
  ): void => {
    list.forEach((block, index) => {
      const ordinal = index + 1;
      switch (block.kind) {
        case 'step':
          pushNode({
            nodeId: block.id,
            blockId: block.id,
            kind: 'step',
            editTarget: { kind: 'prompt', blockId: block.id },
            label: labelForBlock(block, t('workflows.editor.unnamedStep', { position: ordinal })),
            depth,
            ordinal,
            parentNodeId,
            observed: false,
          });
          break;
        case 'parallel': {
          pushNode({
            nodeId: block.id,
            blockId: block.id,
            kind: 'parallel',
            editTarget: { kind: 'block', blockId: block.id },
            label: `${t('workflows.editor.unnamedParallel')} ${ordinal}`,
            depth,
            ordinal,
            parentNodeId,
            failurePolicy: block.failurePolicy,
            ...(block.maxConcurrent === undefined ? {} : { maxConcurrent: block.maxConcurrent }),
            observed: false,
          });
          block.branches.forEach((branch, branchIndex) => {
            const branchNodeId = `${block.id}#${branch.id}`;
            pushNode({
              nodeId: branchNodeId,
              blockId: branch.id,
              kind: 'branch',
              // A branch is a frame inside its group, not a block: the group is
              // the editor that can be revealed for it.
              editTarget: { kind: 'block', blockId: block.id },
              label: `${t('workflows.editor.branch')} ${branchIndex + 1}`,
              depth: depth + 1,
              ordinal: branchIndex + 1,
              parentNodeId: block.id,
              observed: false,
            });
            visitList(branch.blocks, branchNodeId, depth + 2);
          });
          break;
        }
        case 'loop': {
          pushNode({
            nodeId: block.id,
            blockId: block.id,
            kind: 'loop',
            editTarget: { kind: 'block', blockId: block.id },
            label: `${t('workflows.editor.unnamedLoop')} ${ordinal}`,
            depth,
            ordinal,
            parentNodeId,
            repetition: summarizeRepetition(block.repetition),
            ...(block.repetition.kind === 'items'
              ? {
                failurePolicy: block.repetition.failurePolicy,
                ...(block.repetition.maxConcurrent === undefined
                  ? {}
                  : { maxConcurrent: block.repetition.maxConcurrent }),
              }
              : {}),
            observed: false,
          });
          visitList(block.body, block.id, depth + 1);
          if (block.repetition.kind === 'evaluate') {
            const evaluator = block.repetition.evaluator;
            pushNode({
              nodeId: evaluator.id,
              blockId: evaluator.id,
              kind: 'evaluator',
              editTarget: { kind: 'prompt', blockId: evaluator.id },
              label: labelForBlock(evaluator, t('workflows.editor.evaluator')),
              depth: depth + 1,
              // The continuation follows the body visually and runs after it.
              ordinal: block.body.length + 1,
              parentNodeId: block.id,
              observed: false,
            });
          }
          break;
        }
        case 'if': {
          pushNode({
            nodeId: block.id,
            blockId: block.id,
            kind: 'if',
            editTarget: { kind: 'block', blockId: block.id },
            label: `${t('workflows.editor.unnamedIf')} ${ordinal}`,
            depth,
            ordinal,
            parentNodeId,
            observed: false,
          });
          const thenNodeId = `${block.id}#then`;
          pushNode({
            nodeId: thenNodeId,
            blockId: block.id,
            kind: 'thenBranch',
            editTarget: { kind: 'block', blockId: block.id },
            label: t('workflows.editor.ifTrue'),
            depth: depth + 1,
            ordinal: 1,
            parentNodeId: block.id,
            observed: false,
          });
          visitList(block.then, thenNodeId, depth + 2);
          if (block.otherwise.length > 0) {
            const otherwiseNodeId = `${block.id}#otherwise`;
            pushNode({
              nodeId: otherwiseNodeId,
              blockId: block.id,
              kind: 'otherwiseBranch',
              editTarget: { kind: 'block', blockId: block.id },
              label: t('workflows.editor.otherwise'),
              depth: depth + 1,
              ordinal: 2,
              parentNodeId: block.id,
              observed: false,
            });
            visitList(block.otherwise, otherwiseNodeId, depth + 2);
          }
          break;
        }
      }
    });
  };

  visitList(definition.blocks, null, 0);

  const withChildren = nodes.map((node) => ({
    ...node,
    childNodeIds: childIdsByNode.get(node.nodeId) ?? [],
  }));
  return {
    source: 'definition',
    nodes: withChildren,
    nodesById: new Map(withChildren.map((node) => [node.nodeId, node])),
    rootNodeIds: withChildren.filter((node) => node.parentNodeId === null).map((node) => node.nodeId),
    relationships: 'authored',
  };
}

/**
 * Projects an observed native-activity snapshot.
 *
 * Phases and agents are the only structure the snapshot proves. Phase order,
 * shared workspaces, timing overlap and parent identifiers do not establish
 * executable dependencies, so this projection records `relationships: 'unknown'`
 * and produces no edges the observation cannot support.
 */
export function projectObservedWorkflowFlow(
  snapshot: SessionWorkflowRunSnapshotV1,
): WorkflowFlowProjection {
  const nodes: WorkflowFlowNode[] = [];
  const childIdsByNode = new Map<string, string[]>();
  const agentById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const placed = new Set<string>();

  const pushNode = (node: Omit<WorkflowFlowNode, 'childNodeIds'>): void => {
    nodes.push({ ...node, childNodeIds: [] });
    childIdsByNode.set(node.nodeId, []);
    if (node.parentNodeId !== null) childIdsByNode.get(node.parentNodeId)?.push(node.nodeId);
  };

  const orderedPhases = [...snapshot.phases].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  orderedPhases.forEach((phase, phaseIndex) => {
    const phaseNodeId = `phase:${phase.id}`;
    pushNode({
      nodeId: phaseNodeId,
      blockId: phase.id,
      kind: 'observedPhase',
      editTarget: null,
      label: phase.title ?? phase.id,
      depth: 0,
      ordinal: phaseIndex + 1,
      parentNodeId: null,
      observed: true,
    });
    phase.agentIds.forEach((agentId, agentIndex) => {
      const agent = agentById.get(agentId);
      if (agent === undefined) return;
      placed.add(agentId);
      pushNode({
        nodeId: `agent:${agentId}`,
        blockId: agentId,
        kind: 'observedAgent',
        editTarget: null,
        label: agent.title,
        depth: 1,
        ordinal: agentIndex + 1,
        parentNodeId: phaseNodeId,
        observed: true,
        observedStatus: agent.status,
      });
    });
  });

  // Agents the snapshot never assigned to a phase stay visible at the root
  // rather than being attached to a phase by guesswork.
  let rootOrdinal = orderedPhases.length;
  for (const agent of snapshot.agents) {
    if (placed.has(agent.id)) continue;
    rootOrdinal += 1;
    pushNode({
      nodeId: `agent:${agent.id}`,
      blockId: agent.id,
      kind: 'observedAgent',
      editTarget: null,
      label: agent.title,
      depth: 0,
      ordinal: rootOrdinal,
      parentNodeId: null,
      observed: true,
      observedStatus: agent.status,
    });
  }

  const withChildren = nodes.map((node) => ({
    ...node,
    childNodeIds: childIdsByNode.get(node.nodeId) ?? [],
  }));
  return {
    source: 'observed',
    nodes: withChildren,
    nodesById: new Map(withChildren.map((node) => [node.nodeId, node])),
    rootNodeIds: withChildren.filter((node) => node.parentNodeId === null).map((node) => node.nodeId),
    relationships: 'unknown',
  };
}

/**
 * Run state supplied by the canonical invocation owner. Flow renders exactly
 * what it is handed; it never derives a lifecycle from structure or timing.
 */
export type WorkflowFlowNodeRunState = Readonly<{
  nodeId: string;
  /** Exact physical invocation row selected by Run detail. */
  invocationId: string;
  lifecycle: WorkflowInvocationLifecycleV1;
  /** Scoped occurrence identity, e.g. the current item or iteration. */
  occurrenceLabel?: string;
  attempt?: string;
}>;

export function indexWorkflowFlowRunStates(
  states: readonly WorkflowFlowNodeRunState[],
): ReadonlyMap<string, readonly WorkflowFlowNodeRunState[]> {
  const byNode = new Map<string, WorkflowFlowNodeRunState[]>();
  for (const state of states) {
    const occurrences = byNode.get(state.nodeId);
    if (occurrences === undefined) byNode.set(state.nodeId, [state]);
    else occurrences.push(state);
  }
  return byNode;
}

/**
 * A node's accessible ancestry, used for the "group / iteration" context a
 * screen-reader user needs and for the linear reading order in wide layouts.
 */
export function resolveWorkflowFlowAncestry(
  projection: WorkflowFlowProjection,
  nodeId: string,
): readonly WorkflowFlowNode[] {
  const ancestry: WorkflowFlowNode[] = [];
  let current = projection.nodesById.get(nodeId) ?? null;
  while (current?.parentNodeId != null) {
    const parent = projection.nodesById.get(current.parentNodeId) ?? null;
    if (parent === null) break;
    ancestry.unshift(parent);
    current = parent;
  }
  return ancestry;
}

/**
 * Flow selection joins Steps, Activity and the inspector on the same authored
 * identity. Edit resolves every node to a real editor: a step or evaluator to
 * its prompt, a container to itself, and a branch or conditional frame — which
 * is not a block — to the group that owns it. This is the one owner of that
 * decision; a renderer never reads `blockId` for it.
 */
export function resolveWorkflowFlowEditTarget(
  projection: WorkflowFlowProjection,
  nodeId: string,
): WorkflowFlowEditTarget | null {
  return projection.nodesById.get(nodeId)?.editTarget ?? null;
}
