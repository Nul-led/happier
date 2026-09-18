import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderScreen, standardCleanup } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) });
});
vi.mock('@/components/ui/icons/Icon', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
}));
// The popover portal is a platform boundary; the menu content itself is the
// behaviour under test, so it renders inline here.
const MACHINE_COMPOSER_SCOPE = {
    kind: 'machine' as const,
    machineId: 'machine-1',
    serverId: 'server-a',
    directory: '/repo/project',
    machineHomeDir: '/Users/me',
};

// The composer host is the boundary; the scoped authoring composer and its
// document owner stay real beneath it.
vi.mock('@/components/sessions/agentInput', async () => {
    const { createAgentInputModuleMock } = await import('@/dev/testkit');
    return createAgentInputModuleMock({
        resolveTestID: (props) => {
            const composerRef = props.composerRef as { blockId?: string } | undefined;
            return composerRef?.blockId === undefined ? undefined : `composer:${composerRef.blockId}`;
        },
    });
});
vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => ({ phase: 'idle', inputs: null }),
}));
vi.mock('@/components/plugins/surfaces/PluginContextualResourceStoreProvider', () => ({
    PluginContextualResourceStoreProvider: (props: Readonly<{ children?: React.ReactNode }>) =>
        React.createElement(React.Fragment, null, props.children),
}));
vi.mock('@/components/ui/popover/Popover', () => ({
    Popover: (props: { open: boolean; children: (render: unknown) => React.ReactNode }) =>
        (props.open ? React.createElement(React.Fragment, null, props.children({})) : null),
}));

afterEach(async () => {
    await standardCleanup();
});

const AGENT_TARGET = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.claude', localId: 'claude' } };

async function loadHarness() {
    const editor = await import('./WorkflowBlockListEditor');
    const draftModule = await import('@/sync/domains/workflows/workflowEditorDraft');
    const authoring = await import('@/sync/domains/workflows/workflowAuthoring');
    return { ...editor, ...draftModule, ...authoring };
}

type Harness = Awaited<ReturnType<typeof loadHarness>>;

function buildDraft(harness: Harness, blocks?: Parameters<Harness['createWorkflowEditorDraft']>[0]['blocks']) {
    return harness.setWorkflowDefaultField(
        harness.createWorkflowEditorDraft({
            draftId: 'draft-1',
            name: 'Review',
            ...(blocks === undefined ? {} : { blocks }),
        }),
        'agentTarget',
        AGENT_TARGET,
    );
}

async function renderList(harness: Harness, options: Readonly<{
    draft: ReturnType<typeof buildDraft>;
    onChange?: (next: unknown) => void;
    onSelect?: (id: string | null) => void;
    selectedBlockId?: string | null;
}>) {
    const element = React.createElement(harness.WorkflowBlockListEditor, {
        draft: options.draft,
        list: { kind: 'root' },
        blocks: options.draft.blocks,
        depth: 0,
        composerScope: MACHINE_COMPOSER_SCOPE,
        selectedBlockId: options.selectedBlockId ?? null,
        validation: harness.validateWorkflowEditorDraft(options.draft),
        onChange: options.onChange ?? (() => {}),
        onSelect: options.onSelect ?? (() => {}),
        onCustomize: () => {},
    });
    return renderScreen(element);
}

describe('workflow block list editor', () => {
    it('renders every authored step with a stable ordinal and its prompt', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'analyze', document: { text: 'Analyze', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
            { kind: 'step', id: 'implement', document: { text: 'Implement', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const screen = await renderList(harness, { draft });

        expect(screen.findByTestId('workflow-editor-step-analyze')).not.toBeNull();
        expect(screen.findByTestId('workflow-editor-step-implement')).not.toBeNull();
        expect(screen.findByProps({ testID: 'composer:implement' }).props.value).toBe('Implement');
    });

    it('keeps portable references controlled by the workflow document and retires only deleted tokens', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [{
            kind: 'step',
            id: 'analyze',
            document: {
                text: 'Review @src/a.ts and @src/b.ts',
                references: [
                    { kind: 'happier.file', ref: 'file:src/a.ts', token: '@src/a.ts' },
                    { kind: 'happier.file', ref: 'file:src/b.ts', token: '@src/b.ts' },
                ],
                attachments: [],
            },
            input: [],
            result: { kind: 'text' },
        }]);
        const changes: ReturnType<typeof buildDraft>[] = [];
        const screen = await renderList(harness, { draft, onChange: (next) => changes.push(next as ReturnType<typeof buildDraft>) });

        await act(async () => {
            screen.findByProps({ testID: 'composer:analyze' }).props.onChangeText(
                'Review @src/b.ts',
            );
        });

        const step = changes.at(-1)?.blocks[0];
        expect(step?.kind).toBe('step');
        if (step?.kind === 'step') {
            expect(step.document.references).toEqual([
                { kind: 'happier.file', ref: 'file:src/b.ts', token: '@src/b.ts' },
            ]);
        }
    });

    it('adds a block at the active scope and selects it without touching other scopes', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'analyze', document: { text: 'Analyze', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const changes: unknown[] = [];
        const selections: (string | null)[] = [];
        const screen = await renderList(harness, {
            draft,
            onChange: (next) => changes.push(next),
            onSelect: (id) => selections.push(id),
        });

        await screen.pressByTestIdAsync('workflow-editor-add-root');
        await screen.pressByTestIdAsync('workflow-editor-add-root-step');

        expect(changes).toHaveLength(1);
        const next = changes[0] as ReturnType<typeof buildDraft>;
        expect(next.blocks.map((block) => block.id)).toEqual(['analyze', expect.any(String)]);
        expect(next.blocks[1]!.id).not.toBe('analyze');
        expect(selections).toEqual([next.blocks[1]!.id]);
    });

    it('reorders through Move up without changing any block id', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'a', document: { text: 'A', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
            { kind: 'step', id: 'b', document: { text: 'B', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const changes: unknown[] = [];
        const screen = await renderList(harness, { draft, onChange: (next) => changes.push(next) });

        await screen.pressByTestIdAsync('workflow-editor-step-b-actions');
        await screen.pressByTestIdAsync('workflow-editor-step-b-actions-moveUp');

        const next = changes[0] as ReturnType<typeof buildDraft>;
        expect(next.blocks.map((block) => block.id)).toEqual(['b', 'a']);
    });

    it('offers Move up only where it can make progress', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'a', document: { text: 'A', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
            { kind: 'step', id: 'b', document: { text: 'B', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const screen = await renderList(harness, { draft });

        await screen.pressByTestIdAsync('workflow-editor-step-a-actions');
        expect(screen.findByTestId('workflow-editor-step-a-actions-moveUp')).toBeNull();
        expect(screen.findByTestId('workflow-editor-step-a-actions-moveDown')).not.toBeNull();
    });

    it('moves selection to a surviving control before removing a block', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'a', document: { text: 'A', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
            { kind: 'step', id: 'b', document: { text: 'B', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const changes: unknown[] = [];
        const selections: (string | null)[] = [];
        const screen = await renderList(harness, {
            draft,
            onChange: (next) => changes.push(next),
            onSelect: (id) => selections.push(id),
        });

        await screen.pressByTestIdAsync('workflow-editor-step-a-actions');
        await screen.pressByTestIdAsync('workflow-editor-step-a-actions-remove');

        expect(selections).toEqual(['b']);
        expect((changes[0] as ReturnType<typeof buildDraft>).blocks.map((block) => block.id)).toEqual(['b']);
    });

    it('edits a prompt through the controlled owner rather than local state', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'a', document: { text: 'A', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const changes: unknown[] = [];
        const screen = await renderList(harness, { draft, onChange: (next) => changes.push(next) });

        await screen.changeTextByTestId('composer:a', 'Analyze the repository');
        const next = changes[0] as ReturnType<typeof buildDraft>;
        expect((next.blocks[0] as { document: { text: string } }).document.text).toBe('Analyze the repository');
    });

    it('shows a parallel group with its authored policy and says No workflow limit when concurrency is omitted', async () => {
        const harness = await loadHarness();
        const parallel = harness.createWorkflowBlock('parallel', new Set<string>());
        const draft = buildDraft(harness, [parallel]);
        const screen = await renderList(harness, { draft });

        expect(screen.findByTestId(`workflow-editor-parallel-${parallel.id}`)).not.toBeNull();
        expect(screen.findByTestId(`workflow-editor-parallel-${parallel.id}-failure-policy-fail_stop`)).not.toBeNull();
        expect(screen.findByTestId(`workflow-editor-parallel-${parallel.id}-max-concurrent-omitted`)).not.toBeNull();
    });

    it('renders each parallel branch as its own nested block list', async () => {
        const harness = await loadHarness();
        const parallel = harness.createWorkflowBlock('parallel', new Set<string>());
        if (parallel.kind !== 'parallel') throw new Error('unreachable');
        const draft = buildDraft(harness, [parallel]);
        const screen = await renderList(harness, { draft });

        for (const branch of parallel.branches) {
            for (const block of branch.blocks) {
                expect(screen.findByTestId(`workflow-editor-step-${block.id}`)).not.toBeNull();
            }
        }
        expect(screen.findAllByTestId('workflow-editor-list-parallelBranch').length).toBe(parallel.branches.length);
    });

    it('keeps an empty Otherwise branch reachable through the same recursive Add control', async () => {
        const harness = await loadHarness();
        const conditional = harness.createWorkflowBlock('if', new Set<string>());
        if (conditional.kind !== 'if') throw new Error('unreachable');
        const draft = buildDraft(harness, [conditional]);
        const changes: ReturnType<typeof buildDraft>[] = [];
        const screen = await renderList(harness, {
            draft,
            onChange: (next) => changes.push(next as ReturnType<typeof buildDraft>),
        });

        await screen.pressByTestIdAsync('workflow-editor-add-ifOtherwise');
        await screen.pressByTestIdAsync('workflow-editor-add-ifOtherwise-step');

        const next = changes[0]!;
        expect(next.blocks[0]).toMatchObject({
            kind: 'if',
            otherwise: [{ kind: 'step', id: expect.any(String) }],
        });
    });

    it('reveals the parallel-items concurrency field only in parallel mode', async () => {
        const harness = await loadHarness();
        const loop = harness.createWorkflowBlock('loop', new Set<string>());
        const withItems = harness.updateWorkflowBlock(
            buildDraft(harness, [loop]),
            loop.id,
            (block) => (block.kind === 'loop'
                ? {
                    ...block,
                    repetition: {
                        kind: 'items',
                        items: { kind: 'literal', value: [] },
                        execution: 'sequential',
                        failurePolicy: 'fail_stop',
                    },
                }
                : block),
        );

        const sequential = await renderList(harness, { draft: withItems });
        expect(sequential.findByTestId(`workflow-editor-loop-${loop.id}-max-concurrent`)).toBeNull();
        await sequential.unmount();

        const asParallel = harness.updateWorkflowBlock(withItems, loop.id, (block) => (
            block.kind === 'loop' && block.repetition.kind === 'items'
                ? { ...block, repetition: { ...block.repetition, execution: 'parallel' } }
                : block
        ));
        const parallel = await renderList(harness, { draft: asParallel });
        expect(parallel.findByTestId(`workflow-editor-loop-${loop.id}-max-concurrent`)).not.toBeNull();
    });

    it('drops an inert concurrency value when the author returns items to sequential', async () => {
        const harness = await loadHarness();
        const loop = harness.createWorkflowBlock('loop', new Set<string>());
        const draft = harness.updateWorkflowBlock(
            buildDraft(harness, [loop]),
            loop.id,
            (block) => (block.kind === 'loop'
                ? {
                    ...block,
                    repetition: {
                        kind: 'items',
                        items: { kind: 'literal', value: [] },
                        execution: 'parallel',
                        failurePolicy: 'collect_outcomes',
                        maxConcurrent: 4,
                    },
                }
                : block),
        );
        const changes: unknown[] = [];
        const screen = await renderList(harness, { draft, onChange: (next) => changes.push(next) });

        await screen.pressByTestIdAsync(`workflow-editor-loop-${loop.id}-items-sequential`);
        const next = changes[0] as ReturnType<typeof buildDraft>;
        const repetition = (next.blocks[0] as { repetition: Record<string, unknown> }).repetition;
        expect(repetition.execution).toBe('sequential');
        expect(repetition).not.toHaveProperty('maxConcurrent');
        expect(repetition.failurePolicy).toBe('collect_outcomes');
    });

    it('assigns a globally unique evaluator step id when multiple loops switch to agent evaluation', async () => {
        const harness = await loadHarness();
        const firstLoop = harness.createWorkflowBlock('loop', new Set<string>());
        const takenAfterFirst = new Set(harness.walkWorkflowBlocks([firstLoop]).map((block) => block.id));
        const secondLoop = harness.createWorkflowBlock('loop', takenAfterFirst);
        if (firstLoop.kind !== 'loop' || secondLoop.kind !== 'loop') throw new Error('unreachable');

        const firstChanges: ReturnType<typeof buildDraft>[] = [];
        const initial = buildDraft(harness, [firstLoop, secondLoop]);
        const firstScreen = await renderList(harness, {
            draft: initial,
            onChange: (next) => firstChanges.push(next as ReturnType<typeof buildDraft>),
        });
        await firstScreen.pressByTestIdAsync(`workflow-editor-loop-${firstLoop.id}-mode-evaluate`);
        await firstScreen.unmount();

        const afterFirst = firstChanges[0]!;
        const secondChanges: ReturnType<typeof buildDraft>[] = [];
        const secondScreen = await renderList(harness, {
            draft: afterFirst,
            onChange: (next) => secondChanges.push(next as ReturnType<typeof buildDraft>),
        });
        await secondScreen.pressByTestIdAsync(`workflow-editor-loop-${secondLoop.id}-mode-evaluate`);

        const ids = harness.walkWorkflowBlocks(secondChanges[0]!.blocks).map((block) => block.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('shows a blocking validation issue on the exact step it belongs to', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'a', document: { text: 'A', references: [], attachments: [] }, input: [{ kind: 'result', producer: { blockId: 'ghost', scope: { kind: 'current' } }, path: [] }], result: { kind: 'text' } },
            { kind: 'step', id: 'b', document: { text: 'B', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const screen = await renderList(harness, { draft });

        expect(screen.findByTestId('workflow-editor-step-a-issue')).not.toBeNull();
        expect(screen.findByTestId('workflow-editor-step-b-issue')).toBeNull();
    });

    it('labels the per-block overflow trigger as more actions, not as Add', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'analyze', document: { text: 'Analyze', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const screen = await renderList(harness, { draft });

        const trigger = screen.findByTestId('workflow-editor-step-analyze-actions');
        // Announcing "Add a block to this workflow" on the overflow menu told
        // every screen-reader user the wrong thing about what pressing it does.
        expect(trigger?.props.accessibilityLabel).toBe('common.moreActions');
        expect(trigger?.props.accessibilityHint).toContain('Analyze');
    });

    it('reports a removal so the editor can offer an in-place Undo', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'analyze', document: { text: 'Analyze', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
            { kind: 'step', id: 'implement', document: { text: 'Implement', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const removals: unknown[] = [];
        const element = React.createElement(harness.WorkflowBlockListEditor, {
            draft,
            list: { kind: 'root' },
            blocks: draft.blocks,
            depth: 0,
            composerScope: MACHINE_COMPOSER_SCOPE,
            selectedBlockId: null,
            validation: harness.validateWorkflowEditorDraft(draft),
            onChange: () => {},
            onSelect: () => {},
            onCustomize: () => {},
            onBlockRemoved: (removal: unknown) => removals.push(removal),
        } as never);
        const screen = await renderScreen(element);

        await screen.pressByTestIdAsync('workflow-editor-step-analyze-actions');
        await screen.pressByTestIdAsync('workflow-editor-step-analyze-actions-remove');
        await act(async () => {});

        expect(removals).toEqual([{
            list: { kind: 'root' },
            index: 0,
            block: draft.blocks[0],
        }]);
    });

    it('restores a removed block at its original position through the draft owner', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'analyze', document: { text: 'Analyze', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
            { kind: 'step', id: 'implement', document: { text: 'Implement', references: [], attachments: [] }, input: [], result: { kind: 'text' } },
        ]);
        const removal = harness.removeWorkflowBlock(draft, 'analyze');
        expect(removal.removal).toEqual({ list: { kind: 'root' }, index: 0, block: draft.blocks[0] });

        const restored = harness.restoreWorkflowBlock(removal.draft, removal.removal!);
        expect(restored.blocks.map((block) => block.id)).toEqual(['analyze', 'implement']);
    });

    /**
     * An authored number is the exact text's meaning or nothing. "0", "1.5",
     * "1x" and "-2" are recorded as the unresolved values the canonical
     * validator rejects — never read as a limit of 1, as no limit, or dropped —
     * while the exact text stays on screen; clearing an optional field is the
     * precise "no workflow limit" omission.
     */
    it('records unresolved concurrency text for the validator instead of coercing or dropping it', async () => {
        const harness = await loadHarness();
        const parallel = harness.createWorkflowBlock('parallel', new Set<string>());
        if (parallel.kind !== 'parallel') throw new Error('unreachable');
        // Authored branch prompts, so the validator reaches the concurrency
        // field instead of stopping at the strict schema's empty-prompt parse.
        let draft = buildDraft(harness, [{
            ...parallel,
            maxConcurrent: 4,
            branches: parallel.branches.map((branch) => ({
                ...branch,
                blocks: branch.blocks.map((block) => (block.kind === 'step'
                    ? { ...block, document: { ...block.document, text: 'Review' } }
                    : block)),
            })),
        }]);
        function Controlled(): React.ReactElement {
            const [current, setCurrent] = React.useState(draft);
            draft = current;
            return React.createElement(harness.WorkflowBlockListEditor, {
                draft: current,
                list: { kind: 'root' },
                blocks: current.blocks,
                depth: 0,
                composerScope: MACHINE_COMPOSER_SCOPE,
                selectedBlockId: null,
                validation: harness.validateWorkflowEditorDraft(current),
                onChange: setCurrent,
                onSelect: () => {},
                onCustomize: () => {},
            });
        }
        const screen = await renderScreen(React.createElement(Controlled));
        const fieldId = `workflow-editor-parallel-${parallel.id}-max-concurrent`;
        const readMax = () => (draft.blocks[0] as { maxConcurrent?: number }).maxConcurrent;

        for (const [text, expected] of [['0', 0], ['1.5', 1.5], ['-2', -2]] as const) {
            await act(async () => { screen.changeTextByTestId(fieldId, text); });
            expect(readMax(), text).toBe(expected);
            expect(screen.findByTestId(fieldId)?.props.value, text).toBe(text);
            expect(screen.findByTestId(`${fieldId}-error`), text).not.toBeNull();
            expect(harness.validateWorkflowEditorDraft(draft).valid, text).toBe(false);
        }
        await act(async () => { screen.changeTextByTestId(fieldId, '1x'); });
        expect(Number.isNaN(readMax())).toBe(true);
        expect(screen.findByTestId(fieldId)?.props.value).toBe('1x');
        expect(screen.findByTestId(`${fieldId}-error`)?.props.accessibilityRole).toBe('alert');

        await act(async () => { screen.changeTextByTestId(fieldId, '3'); });
        expect(readMax()).toBe(3);
        expect(screen.findByTestId(`${fieldId}-error`)).toBeNull();

        await act(async () => { screen.changeTextByTestId(fieldId, ''); });
        expect(draft.blocks[0]).not.toHaveProperty('maxConcurrent');
        expect(screen.findByTestId(`${fieldId}-omitted`)).not.toBeNull();
        expect(harness.validateWorkflowEditorDraft(draft).valid).toBe(true);
    });

    it('keeps a cleared required round guard unresolved rather than silently keeping the old value', async () => {
        const harness = await loadHarness();
        const loop = harness.createWorkflowBlock('loop', new Set<string>());
        const draft = harness.updateWorkflowBlock(buildDraft(harness, [loop]), loop.id, (block) => (
            block.kind === 'loop'
                ? { ...block, repetition: { kind: 'until', maxIterations: 3, stopWhen: { kind: 'exists', value: { kind: 'literal', value: true } } } }
                : block
        ));
        const changes: ReturnType<typeof buildDraft>[] = [];
        const screen = await renderList(harness, { draft, onChange: (next) => changes.push(next as ReturnType<typeof buildDraft>) });

        await act(async () => { screen.changeTextByTestId(`workflow-editor-loop-${loop.id}-max-iterations`, ''); });
        const cleared = changes.at(-1)!.blocks[0] as { repetition: { maxIterations: number } };
        expect(Number.isNaN(cleared.repetition.maxIterations)).toBe(true);
        expect(harness.validateWorkflowEditorDraft(changes.at(-1)!).issues.map((issue) => issue.code))
            .toContain('invalid_repetition');
    });

    /**
     * Item and iteration facts are authorable by their canonical field, and are
     * offered only where the validator accepts them: the current item inside a
     * for-each loop, round facts inside any loop, neither at the root.
     */
    it('offers item and iteration reference fields only inside the loops that provide them', async () => {
        const harness = await loadHarness();
        const loop = harness.createWorkflowBlock('loop', new Set<string>());
        if (loop.kind !== 'loop') throw new Error('unreachable');
        const inside = loop.body[0]!.id;
        const itemsLoop = harness.updateWorkflowBlock(
            buildDraft(harness, [
                { kind: 'step', id: 'root-step', document: { text: 'Root', references: [], attachments: [] }, input: [{ kind: 'literal', value: '' }], result: { kind: 'text' } },
                loop,
            ]),
            loop.id,
            (block) => (block.kind === 'loop'
                ? { ...block, repetition: { kind: 'items', items: { kind: 'literal', value: ['a'] }, execution: 'sequential', failurePolicy: 'fail_stop' } }
                : block),
        );
        // The body prompt is authored so the validator reaches the reference
        // scope instead of stopping at the strict schema's empty-prompt parse.
        const withInput = harness.updateWorkflowBlock(itemsLoop, inside, (block) => (
            block.kind === 'step'
                ? {
                    ...block,
                    document: { ...block.document, text: 'Inspect the current item' },
                    input: [{ kind: 'literal', value: '' }],
                }
                : block
        ));
        const changes: ReturnType<typeof buildDraft>[] = [];
        const screen = await renderList(harness, { draft: withInput, onChange: (next) => changes.push(next as ReturnType<typeof buildDraft>) });

        // The root step is outside every loop: no item or round facts.
        expect(screen.findByTestId('workflow-editor-step-root-step-input-0-kind-item')).toBeNull();
        expect(screen.findByTestId('workflow-editor-step-root-step-input-0-kind-iteration')).toBeNull();
        // The body step of a for-each loop can author both.
        await screen.pressByTestIdAsync(`workflow-editor-step-${inside}-input-0-kind-item`);
        const readInput = () => harness.findWorkflowBlock(changes.at(-1)!, inside) as { input: unknown[] };
        expect(readInput().input[0]).toEqual({ kind: 'item', field: 'value' });

        // Rerender with the authored reference to reach its field choices.
        await screen.unmount();
        const authored = harness.updateWorkflowBlock(withInput, inside, (block) => (
            block.kind === 'step' ? { ...block, input: [{ kind: 'iteration', field: 'index' }] } : block
        ));
        const fields = await renderList(harness, { draft: authored, onChange: (next) => changes.push(next as ReturnType<typeof buildDraft>) });
        for (const field of ['index', 'position', 'count', 'stopReason']) {
            expect(fields.findByTestId(`workflow-editor-step-${inside}-input-0-iteration-field-${field}`), field).not.toBeNull();
        }
        await fields.pressByTestIdAsync(`workflow-editor-step-${inside}-input-0-iteration-field-stopReason`);
        expect(readInput().input[0]).toEqual({ kind: 'iteration', field: 'stopReason' });
        expect(harness.validateWorkflowEditorDraft(changes.at(-1)!).valid).toBe(true);
    });

    it('keeps an out-of-scope item reference visible for repair while the validator names it', async () => {
        const harness = await loadHarness();
        const draft = buildDraft(harness, [
            { kind: 'step', id: 'root-step', document: { text: 'Root', references: [], attachments: [] }, input: [{ kind: 'item', field: 'count' }], result: { kind: 'text' } },
        ]);
        const screen = await renderList(harness, { draft });
        expect(screen.findByTestId('workflow-editor-step-root-step-input-0-item-field-count')?.props.accessibilityState)
            .toMatchObject({ selected: true });
        expect(harness.validateWorkflowEditorDraft(draft).issues.map((issue) => issue.code))
            .toContain('invalid_reference_scope');
    });
});
