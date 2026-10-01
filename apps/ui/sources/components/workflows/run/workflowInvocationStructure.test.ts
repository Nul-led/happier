import { describe, expect, it } from 'vitest';

import { WorkflowDefinitionV1Schema } from '@happier-dev/protocol';
import type { WorkflowProgressEnvelopeV1 } from '@happier-dev/protocol';

import { createWorkflowInvocationIndexFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { summarizeWorkflowInvocationCoverage } from '@/components/workflows/presentation/workflowLifecyclePresentation';

import { projectWorkflowInvocationStructure } from './workflowInvocationStructure';

/**
 * The public invocation index deliberately withholds authored block ids
 * (FLOW §5.2). This owner recovers navigable identity from what the authorized
 * client already holds — the frozen definition plus the paged parent/ordinal
 * index — so Flow and Activity can name and select an occurrence that has never
 * been opened, without widening the approved server disclosure.
 */

function step(id: string) {
    return { kind: 'step', id, document: { text: id, references: [], attachments: [] }, input: [], result: { kind: 'text' } };
}

function definitionOf(blocks: readonly unknown[]) {
    return WorkflowDefinitionV1Schema.parse({ version: 1, inputs: [], defaults: {}, blocks });
}

const root = createWorkflowInvocationIndexFixture({ id: 'root', parentRecordId: null, memberOrdinal: '0', sequence: '0' });

function child(overrides: Readonly<{ id: string; parentRecordId: string; memberOrdinal: string; attempt?: string; sequence: string }>) {
    return createWorkflowInvocationIndexFixture({
        id: overrides.id,
        parentRecordId: overrides.parentRecordId,
        memberOrdinal: overrides.memberOrdinal,
        attempt: overrides.attempt ?? '0',
        sequence: overrides.sequence,
    });
}

describe('projectWorkflowInvocationStructure', () => {
    it('names a linear step row that was never opened, from parent links and member order alone', () => {
        const definition = definitionOf([step('analyze'), step('implement')]);
        const structure = projectWorkflowInvocationStructure({
            definition,
            invocations: [
                root,
                child({ id: 'a', parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
                child({ id: 'b', parentRecordId: 'root', memberOrdinal: '1', sequence: '2' }),
            ],
        });

        expect(structure.get('root')).toMatchObject({ blockId: '$root', nodeId: null, isFrame: true, coverageKind: 'structural' });
        expect(structure.get('a')).toMatchObject({ blockId: 'analyze', nodeId: 'analyze', isFrame: false, occurrence: [], coverageKind: 'executable' });
        expect(structure.get('b')).toMatchObject({ blockId: 'implement', nodeId: 'implement', isFrame: false });
    });

    it('resolves parallel branch frames to their branch node and carries branch scope into the body', () => {
        const definition = definitionOf([{
            kind: 'parallel',
            id: 'checks',
            failurePolicy: 'collect_outcomes',
            branches: [
                { id: 'left', blocks: [step('lint')] },
                { id: 'right', blocks: [step('types')] },
            ],
        }]);
        const structure = projectWorkflowInvocationStructure({
            definition,
            invocations: [
                root,
                child({ id: 'checks', parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
                child({ id: 'frame-left', parentRecordId: 'checks', memberOrdinal: '0', sequence: '2' }),
                child({ id: 'frame-right', parentRecordId: 'checks', memberOrdinal: '1', sequence: '3' }),
                child({ id: 'lint-row', parentRecordId: 'frame-left', memberOrdinal: '0', sequence: '4' }),
                child({ id: 'types-row', parentRecordId: 'frame-right', memberOrdinal: '0', sequence: '5' }),
            ],
        });

        expect(structure.get('checks')).toMatchObject({ nodeId: 'checks', blockId: 'checks', isFrame: false, coverageKind: 'structural' });
        expect(structure.get('frame-left')).toMatchObject({ nodeId: 'checks#left', isFrame: true, coverageKind: 'structural' });
        expect(structure.get('lint-row')).toMatchObject({
            nodeId: 'lint',
            occurrence: [{ kind: 'branch', blockId: 'checks', branchId: 'left' }],
        });
        expect(structure.get('types-row')).toMatchObject({
            nodeId: 'types',
            occurrence: [{ kind: 'branch', blockId: 'checks', branchId: 'right' }],
        });
    });

    it('counts Agent, Action and Wait steps without counting a nested Workflow container', () => {
        const definition = definitionOf([
            step('agent'),
            { kind: 'action', id: 'action', actionId: 'session.message.send', input: {} },
            { kind: 'workflow', id: 'nested', workflowRef: 'builtin:review', input: {} },
            { kind: 'wait', id: 'wait', document: { text: 'Continue?', references: [], attachments: [] } },
        ]);
        const invocations = [root, ...definition.blocks.map((block, ordinal) => child({
            id: block.id, parentRecordId: 'root', memberOrdinal: String(ordinal), sequence: String(ordinal + 1),
        }))].map((invocation) => ({ ...invocation, lifecycle: 'completed' as const }));
        const structure = projectWorkflowInvocationStructure({ definition, invocations });

        expect(structure.get('root')?.coverageKind).toBe('structural');
        for (const block of definition.blocks) {
            expect(structure.get(block.id)).toMatchObject({ blockId: block.id, nodeId: block.id,
                coverageKind: block.kind === 'workflow' ? 'structural' : 'executable' });
        }
        expect(summarizeWorkflowInvocationCoverage(invocations, {
            kindsByInvocationId: new Map([...structure].map(([id, entry]) => [id, entry.coverageKind])),
            historyComplete: false,
        })).toEqual({ observedLeafCounts: { completed: 3, failed: 0, attention: 0 }, coverage: 'partial', knownFailure: false });
    });

    it('uses the opened child kind and scope without mistaking a same-id parent block for its Flow node', () => {
        const definition = definitionOf([
            { kind: 'workflow', id: 'nested', workflowRef: 'builtin:review', input: {} },
        ]);
        const progress: WorkflowProgressEnvelopeV1 = {
            kind: 'happier.workflow-progress.v1',
            invocationPath: { blockId: 'nested', scope: [{ kind: 'workflow', blockId: 'nested' }] },
            blockKind: 'step',
            attempt: '0',
            logicalInvocationRecordId: 'nested-row',
        };
        const structure = projectWorkflowInvocationStructure({
            definition,
            invocations: [root, child({ id: 'nested-row', parentRecordId: 'unloaded-frame', memberOrdinal: '0', sequence: '2' })],
            progressByInvocationId: new Map([['nested-row', progress]]),
        });

        expect(structure.get('nested-row')).toMatchObject({
            blockId: 'nested',
            nodeId: null,
            occurrence: [{ kind: 'workflow', blockId: 'nested' }],
            coverageKind: 'executable',
        });
    });

    it('distinguishes item occurrences from plain iterations using the authored repetition', () => {
        const items = definitionOf([{
            kind: 'loop',
            id: 'files',
            repetition: { kind: 'items', items: { kind: 'input', name: 'files' }, execution: 'parallel', failurePolicy: 'collect_outcomes' },
            body: [step('inspect')],
        }]);
        const counted = definitionOf([{
            kind: 'loop',
            id: 'rounds',
            repetition: { kind: 'count', count: { kind: 'literal', value: 3 } },
            body: [step('poll')],
        }]);
        const invocations = (loopRowId: string) => [
            root,
            child({ id: loopRowId, parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
            child({ id: 'frame-1', parentRecordId: loopRowId, memberOrdinal: '1', sequence: '2' }),
            child({ id: 'body-1', parentRecordId: 'frame-1', memberOrdinal: '0', sequence: '3' }),
        ];

        expect(projectWorkflowInvocationStructure({ definition: items, invocations: invocations('files') }).get('body-1'))
            .toMatchObject({ nodeId: 'inspect', occurrence: [{ kind: 'item', blockId: 'files', index: 1 }] });
        expect(projectWorkflowInvocationStructure({ definition: counted, invocations: invocations('rounds') }).get('body-1'))
            .toMatchObject({ nodeId: 'poll', occurrence: [{ kind: 'iteration', blockId: 'rounds', index: 1 }] });
    });

    it('maps the evaluator slot that follows an evaluate loop body', () => {
        const definition = definitionOf([{
            kind: 'loop',
            id: 'judge',
            repetition: { kind: 'evaluate', maxIterations: 3, history: 'latest', evaluator: step('decide') },
            body: [step('summarize')],
        }]);
        const structure = projectWorkflowInvocationStructure({
            definition,
            invocations: [
                root,
                child({ id: 'judge', parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
                child({ id: 'frame-0', parentRecordId: 'judge', memberOrdinal: '0', sequence: '2' }),
                child({ id: 'body', parentRecordId: 'frame-0', memberOrdinal: '0', sequence: '3' }),
                child({ id: 'evaluator', parentRecordId: 'frame-0', memberOrdinal: '1', sequence: '4' }),
            ],
        });

        expect(structure.get('body')).toMatchObject({ nodeId: 'summarize' });
        expect(structure.get('evaluator')).toMatchObject({ nodeId: 'decide' });
    });

    it('refuses to guess which conditional branch ran when both are reachable at that ordinal', () => {
        const definition = definitionOf([{
            kind: 'if',
            id: 'gate',
            when: { kind: 'compare', operator: 'eq', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 1 } },
            then: [step('apply')],
            otherwise: [step('skipReport')],
        }]);
        const structure = projectWorkflowInvocationStructure({
            definition,
            invocations: [
                root,
                child({ id: 'gate', parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
                child({ id: 'selected', parentRecordId: 'gate', memberOrdinal: '0', sequence: '2' }),
            ],
        });

        expect(structure.get('gate')).toMatchObject({ nodeId: 'gate' });
        expect(structure.get('selected')).toMatchObject({ nodeId: null, blockId: null, coverageKind: 'unknown' });
    });

    it('prefers the authoritative opened path over derivation and uses it to resolve the ambiguous branch', () => {
        const definition = definitionOf([{
            kind: 'if',
            id: 'gate',
            when: { kind: 'compare', operator: 'eq', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 1 } },
            then: [step('apply')],
            otherwise: [step('skipReport')],
        }]);
        const progress: WorkflowProgressEnvelopeV1 = {
            kind: 'happier.workflow-progress.v1',
            invocationPath: { blockId: 'skipReport', scope: [] },
            blockKind: 'step',
            attempt: '0',
            logicalInvocationRecordId: 'selected',
        };
        const structure = projectWorkflowInvocationStructure({
            definition,
            invocations: [
                root,
                child({ id: 'gate', parentRecordId: 'root', memberOrdinal: '0', sequence: '1' }),
                child({ id: 'selected', parentRecordId: 'gate', memberOrdinal: '0', sequence: '2' }),
            ],
            progressByInvocationId: new Map([['selected', progress]]),
        });

        expect(structure.get('selected')).toMatchObject({ nodeId: 'skipReport', blockId: 'skipReport' });
    });

    it('keeps every retry attempt of one member slot as its own occurrence of the same node', () => {
        const definition = definitionOf([step('analyze')]);
        const structure = projectWorkflowInvocationStructure({
            definition,
            invocations: [
                root,
                child({ id: 'first', parentRecordId: 'root', memberOrdinal: '0', attempt: '0', sequence: '1' }),
                child({ id: 'second', parentRecordId: 'root', memberOrdinal: '0', attempt: '1', sequence: '2' }),
            ],
        });

        expect(structure.get('first')).toMatchObject({ nodeId: 'analyze' });
        expect(structure.get('second')).toMatchObject({ nodeId: 'analyze' });
    });

    it('leaves a row whose ancestry is not loaded unresolved instead of attaching it to the wrong node', () => {
        const definition = definitionOf([step('analyze')]);
        const structure = projectWorkflowInvocationStructure({
            definition,
            invocations: [child({ id: 'orphan', parentRecordId: 'unloaded-frame', memberOrdinal: '0', sequence: '9' })],
        });

        expect(structure.get('orphan')).toBeUndefined();
    });

    it('resolves nothing at all without a frozen definition', () => {
        const structure = projectWorkflowInvocationStructure({ definition: null, invocations: [root] });
        expect(structure.size).toBe(0);
    });
});
