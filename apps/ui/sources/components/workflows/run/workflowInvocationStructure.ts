import type {
    WorkflowBlock,
    WorkflowDefinitionV1,
} from '@happier-dev/protocol/workflows/workflowV1';
import type {
    WorkflowInvocationPathV1,
    WorkflowProgressEnvelopeV1,
    WorkflowRunInvocationIndexV1,
} from '@happier-dev/protocol/workflows/workflowProgressV1';

/**
 * Navigable identity for invocation rows that have not been opened.
 *
 * The approved disclosure (FLOW §5.2) deliberately keeps authored block ids,
 * branch ids and scope paths out of the server-readable invocation index, and
 * widening it is a separate privacy decision. An authorized client, however,
 * already holds the frozen definition it read with the Run, and the index does
 * expose parent links, local member order and retry number — which is exactly
 * the coordinator's own slot mapping. Walking one against the other recovers
 * "which node, which occurrence" for every loaded row without decrypting
 * anything, without a second store and without eagerly opening private detail.
 *
 * When an exact row *has* been opened, its recorded `invocationPath` is
 * authoritative and is used instead of the derivation: this owner returns one
 * map, so Activity, Flow and the detail selection cannot disagree.
 */

export type WorkflowOccurrenceCoordinate =
    | Readonly<{ kind: 'branch'; blockId: string; branchId: string }>
    | Readonly<{ kind: 'item'; blockId: string; index: number }>
    | Readonly<{ kind: 'iteration'; blockId: string; index: number }>;

export type WorkflowInvocationStructureEntry = Readonly<{
    invocationId: string;
    /**
     * The Flow node this row belongs to, or `null` when the public index cannot
     * resolve exactly one. `null` is a truthful "not known yet", never a guess.
     */
    nodeId: string | null;
    /** The authored block, `'$root'` for the structural root, or `null` when unresolved. */
    blockId: string | null;
    /** Scoped occurrence coordinates, outermost first. */
    occurrence: readonly WorkflowOccurrenceCoordinate[];
    /** True for a structural frame row (root, parallel branch body, loop iteration body). */
    isFrame: boolean;
}>;

type Scope = WorkflowInvocationPathV1['scope'];

type ParallelBlock = Extract<WorkflowBlock, { kind: 'parallel' }>;
type LoopBlock = Extract<WorkflowBlock, { kind: 'loop' }>;
type IfBlock = Extract<WorkflowBlock, { kind: 'if' }>;

/**
 * What a row's *children* mean. The coordinator assigns `memberOrdinal` inside
 * exactly one of these containers, so this union is the whole mapping rule.
 */
type MemberContext =
    | Readonly<{ kind: 'list'; blocks: readonly WorkflowBlock[]; scope: Scope }>
    | Readonly<{ kind: 'conditionalBlocks'; block: IfBlock; scope: Scope }>
    | Readonly<{ kind: 'branchFrames'; block: ParallelBlock; scope: Scope }>
    | Readonly<{ kind: 'memberFrames'; block: LoopBlock; scope: Scope }>
    | Readonly<{ kind: 'loopBody'; block: LoopBlock; scope: Scope }>;

type ResolvedMember = Readonly<{
    blockId: string | null;
    isFrame: boolean;
    scope: Scope;
    children: MemberContext | null;
}>;

function toIndex(decimal: string): number | null {
    // Canonical nonnegative decimal strings; anything else is not a slot we can
    // reason about and stays unresolved rather than being coerced.
    if (!/^\d+$/.test(decimal)) return null;
    const value = Number(decimal);
    return Number.isSafeInteger(value) ? value : null;
}

function childContextForBlock(block: WorkflowBlock, scope: Scope): MemberContext | null {
    switch (block.kind) {
        case 'step': return null;
        case 'parallel': return { kind: 'branchFrames', block, scope };
        case 'loop': return { kind: 'memberFrames', block, scope };
        case 'if': return { kind: 'conditionalBlocks', block, scope };
    }
}

function resolveListMember(
    blocks: readonly WorkflowBlock[],
    ordinal: number,
    scope: Scope,
): ResolvedMember | null {
    const block = blocks[ordinal];
    if (block === undefined) return null;
    return { blockId: block.id, isFrame: false, scope, children: childContextForBlock(block, scope) };
}

const UNRESOLVED: ResolvedMember = { blockId: null, isFrame: false, scope: [], children: null };

function resolveMember(context: MemberContext, ordinal: number): ResolvedMember | null {
    switch (context.kind) {
        case 'list':
            return resolveListMember(context.blocks, ordinal, context.scope);
        case 'conditionalBlocks': {
            // Which branch executed is a private decision. When only one branch
            // can hold this ordinal the answer is structural; otherwise the row
            // stays unresolved until it is opened.
            const inThen = ordinal < context.block.then.length;
            const inOtherwise = ordinal < context.block.otherwise.length;
            if (inThen && inOtherwise) return UNRESOLVED;
            if (inThen) return resolveListMember(context.block.then, ordinal, context.scope);
            if (inOtherwise) return resolveListMember(context.block.otherwise, ordinal, context.scope);
            return null;
        }
        case 'branchFrames': {
            const branch = context.block.branches[ordinal];
            if (branch === undefined) return null;
            const scope: Scope = [
                ...context.scope,
                { kind: 'branch', blockId: context.block.id, branchId: branch.id },
            ];
            return {
                blockId: context.block.id,
                isFrame: true,
                scope,
                children: { kind: 'list', blocks: branch.blocks, scope },
            };
        }
        case 'memberFrames': {
            const scope: Scope = [
                ...context.scope,
                { kind: 'iteration', blockId: context.block.id, index: ordinal },
            ];
            return {
                blockId: context.block.id,
                isFrame: true,
                scope,
                children: { kind: 'loopBody', block: context.block, scope },
            };
        }
        case 'loopBody': {
            const body = context.block.body;
            if (ordinal < body.length) return resolveListMember(body, ordinal, context.scope);
            // The evaluator continuation runs after the body and occupies the
            // slot immediately past it.
            const repetition = context.block.repetition;
            if (repetition.kind === 'evaluate' && ordinal === body.length) {
                return {
                    blockId: repetition.evaluator.id,
                    isFrame: false,
                    scope: context.scope,
                    children: null,
                };
            }
            return null;
        }
    }
}

/**
 * The Flow node id for a resolved row.
 *
 * A parallel branch frame belongs to its own branch node so an occurrence is
 * attributed precisely; every other row belongs to its authored block.
 */
export function resolveWorkflowFlowNodeIdForInvocation(params: Readonly<{
    blockId: string | null;
    scope: Scope;
    isFrame: boolean;
}>): string | null {
    if (params.blockId === null || params.blockId === '$root') return null;
    if (params.isFrame) {
        const tail = params.scope[params.scope.length - 1];
        if (tail !== undefined && tail.kind === 'branch' && tail.blockId === params.blockId) {
            return `${params.blockId}#${tail.branchId}`;
        }
    }
    return params.blockId;
}

function findWorkflowBlockById(blocks: readonly WorkflowBlock[], id: string): WorkflowBlock | null {
    for (const block of blocks) {
        if (block.id === id) return block;
        switch (block.kind) {
            case 'step': break;
            case 'parallel':
                for (const branch of block.branches) {
                    const found = findWorkflowBlockById(branch.blocks, id);
                    if (found !== null) return found;
                }
                break;
            case 'loop': {
                const found = findWorkflowBlockById(block.body, id);
                if (found !== null) return found;
                break;
            }
            case 'if': {
                const found = findWorkflowBlockById(block.then, id) ?? findWorkflowBlockById(block.otherwise, id);
                if (found !== null) return found;
                break;
            }
        }
    }
    return null;
}

/**
 * The member context an *opened* row establishes for its own children. An
 * opened conditional additionally records which branch it selected, so its
 * subtree stops being ambiguous.
 */
function childContextFromProgress(
    progress: WorkflowProgressEnvelopeV1,
    definition: WorkflowDefinitionV1,
): MemberContext | null {
    const path = progress.invocationPath;
    if (path.blockId === '$root') return { kind: 'list', blocks: definition.blocks, scope: [] };
    const block = findWorkflowBlockById(definition.blocks, path.blockId);
    if (block === null) return null;
    if (progress.frame !== undefined) {
        if (block.kind === 'parallel') {
            const tail = path.scope[path.scope.length - 1];
            const branch = tail !== undefined && tail.kind === 'branch'
                ? block.branches.find((candidate) => candidate.id === tail.branchId)
                : undefined;
            return branch === undefined
                ? null
                : { kind: 'list', blocks: branch.blocks, scope: path.scope };
        }
        if (block.kind === 'loop') return { kind: 'loopBody', block, scope: path.scope };
        return null;
    }
    if (block.kind === 'if' && progress.container?.kind === 'if') {
        const selected = progress.container.selected === 'then' ? block.then : block.otherwise;
        return { kind: 'list', blocks: selected, scope: path.scope };
    }
    return childContextForBlock(block, path.scope);
}

function collectLoopBlocksById(
    blocks: readonly WorkflowBlock[],
    into: Map<string, LoopBlock>,
): void {
    for (const block of blocks) {
        switch (block.kind) {
            case 'step': break;
            case 'parallel':
                for (const branch of block.branches) collectLoopBlocksById(branch.blocks, into);
                break;
            case 'loop':
                into.set(block.id, block);
                collectLoopBlocksById(block.body, into);
                break;
            case 'if':
                collectLoopBlocksById(block.then, into);
                collectLoopBlocksById(block.otherwise, into);
                break;
        }
    }
}

/**
 * Scope coordinates carry the authored distinction between an item occurrence
 * and a plain iteration, which the private path alone does not record.
 *
 * The frozen definition is the authority. `frameHint` is consulted only for a
 * loop the read definition cannot explain — an observed or partially readable
 * definition — where an opened row's own frame is the single remaining fact.
 */
function describeOccurrence(
    scope: Scope,
    loopsById: ReadonlyMap<string, LoopBlock>,
    frameHint?: WorkflowProgressEnvelopeV1['frame'],
): readonly WorkflowOccurrenceCoordinate[] {
    return scope.map((entry) => {
        if (entry.kind === 'branch') return entry;
        const loop = loopsById.get(entry.blockId);
        const isItem = loop !== undefined
            ? loop.repetition.kind === 'items'
            : frameHint?.ownerBlockId === entry.blockId && frameHint.source.kind === 'item';
        return isItem
            ? { kind: 'item' as const, blockId: entry.blockId, index: entry.index }
            : { kind: 'iteration' as const, blockId: entry.blockId, index: entry.index };
    });
}

export function projectWorkflowInvocationStructure(params: Readonly<{
    definition: WorkflowDefinitionV1 | null;
    invocations: readonly WorkflowRunInvocationIndexV1[];
    /** Exact rows already opened through the authorized Action; authoritative when present. */
    progressByInvocationId?: ReadonlyMap<string, WorkflowProgressEnvelopeV1>;
}>): ReadonlyMap<string, WorkflowInvocationStructureEntry> {
    const entries = new Map<string, WorkflowInvocationStructureEntry>();
    const definition = params.definition;
    if (definition === null) return entries;

    const loopsById = new Map<string, LoopBlock>();
    collectLoopBlocksById(definition.blocks, loopsById);

    const record = (
        invocationId: string,
        resolved: Readonly<{ blockId: string | null; scope: Scope; isFrame: boolean }>,
        frameHint?: WorkflowProgressEnvelopeV1['frame'],
    ): void => {
        entries.set(invocationId, {
            invocationId,
            nodeId: resolveWorkflowFlowNodeIdForInvocation(resolved),
            blockId: resolved.blockId,
            occurrence: describeOccurrence(resolved.scope, loopsById, frameHint),
            isFrame: resolved.isFrame,
        });
    };

    // An opened row states its own path; nothing below may contradict it.
    const progressById = params.progressByInvocationId;
    if (progressById !== undefined) {
        for (const invocation of params.invocations) {
            const progress = progressById.get(invocation.id);
            if (progress === undefined) continue;
            // A row is a structural frame only when the frame it records is its
            // own block's. A leaf step may also carry the enclosing item frame,
            // which describes where it ran — not that it is a container.
            record(invocation.id, {
                blockId: progress.invocationPath.blockId,
                scope: progress.invocationPath.scope,
                isFrame: progress.blockKind === 'root'
                    || (progress.frame !== undefined
                        && progress.frame.ownerBlockId === progress.invocationPath.blockId),
            }, progress.frame);
        }
    }

    const childrenByParent = new Map<string, WorkflowRunInvocationIndexV1[]>();
    let rootInvocation: WorkflowRunInvocationIndexV1 | null = null;
    for (const invocation of params.invocations) {
        if (invocation.parentRecordId === null) {
            // Exactly one root frame exists per Run; a merged attention page can
            // repeat it but never introduce a second.
            if (rootInvocation === null) rootInvocation = invocation;
            continue;
        }
        const siblings = childrenByParent.get(invocation.parentRecordId);
        if (siblings === undefined) childrenByParent.set(invocation.parentRecordId, [invocation]);
        else siblings.push(invocation);
    }
    if (rootInvocation === null) return entries;

    if (!entries.has(rootInvocation.id)) {
        record(rootInvocation.id, { blockId: '$root', scope: [], isFrame: true });
    }

    const queue: Array<Readonly<{ invocationId: string; children: MemberContext | null }>> = [{
        invocationId: rootInvocation.id,
        children: { kind: 'list', blocks: definition.blocks, scope: [] },
    }];

    // Breadth-first over loaded ancestry only: a row whose parent page is not
    // loaded stays absent rather than being attached to a plausible neighbour.
    while (queue.length > 0) {
        const current = queue.shift()!;
        const children = childrenByParent.get(current.invocationId);
        if (children === undefined || current.children === null) continue;
        for (const child of children) {
            const progress = progressById?.get(child.id);
            if (progress !== undefined) {
                queue.push({ invocationId: child.id, children: childContextFromProgress(progress, definition) });
                continue;
            }
            const ordinal = toIndex(child.memberOrdinal);
            const resolved = ordinal === null ? null : resolveMember(current.children, ordinal);
            if (resolved === null) {
                // An ordinal the frozen definition cannot explain is recorded as
                // unresolved so the row still appears, without a fabricated node.
                if (!entries.has(child.id)) record(child.id, { blockId: null, scope: [], isFrame: false });
                continue;
            }
            record(child.id, resolved);
            queue.push({ invocationId: child.id, children: resolved.children });
        }
    }

    return entries;
}
