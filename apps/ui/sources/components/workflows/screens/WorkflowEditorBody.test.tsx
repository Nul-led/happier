import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { IModal } from '@/modal';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';

const announceSpy = vi.fn();
const modalShowSpy = vi.fn<IModal['show']>(() => 'workflow-inspector-modal');
const modalUpdateSpy = vi.fn<IModal['update']>();
/**
 * Each mounted step composer takes one generated instance id. Counting the ids
 * issued is how a remount is detected: a preserved caret, selection or IME
 * composition is only possible while the same instance stays mounted.
 */
const composerInstanceIds = vi.hoisted(() => ({ issued: [] as string[], next: 0 }));
const promptFocus = vi.fn();
let registeredHandlers: Record<string, () => void> = {};
let windowDimensions = { width: 1200, height: 800 };

const MACHINE_COMPOSER_SCOPE = {
    kind: 'machine' as const,
    machineId: 'machine-1',
    serverId: 'server-a',
    directory: '/Users/me/project',
    machineHomeDir: '/Users/me',
};

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        useWindowDimensions: () => windowDimensions,
    });
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
vi.mock('@/components/ui/popover/Popover', () => ({
    Popover: (props: { open: boolean; children: (render: unknown) => React.ReactNode }) =>
        (props.open ? React.createElement(React.Fragment, null, props.children({})) : null),
}));
vi.mock('@/components/ui/navigation/SegmentedTabBar', () => ({
    SegmentedTabBar: (props: {
        tabs: ReadonlyArray<{ id: string; label: string }>;
        activeTabId: string;
        onSelectTab: (id: string) => void;
        testIDPrefix?: string;
    }) => React.createElement(
        'SegmentedTabBar',
        { testID: props.testIDPrefix },
        props.tabs.map((tab) => React.createElement('Pressable', {
            key: tab.id,
            testID: `${props.testIDPrefix}:${tab.id}`,
            accessibilityState: { selected: props.activeTabId === tab.id },
            onPress: () => props.onSelectTab(tab.id),
        })),
    ),
}));
// The canonical Session picker is a real list/virtualization boundary; the
// step it is handed and its selection callback are the behaviour under test.
vi.mock('@/components/ui/selectionList', async () => {
    const { createPassThroughModule } = await import('@/dev/testkit/mocks/components');
    return createPassThroughModule(['SelectionList']);
});
vi.mock('@/components/sessions/new/components/MachineSelector', () => ({
    MachineSelector: (props: Record<string, unknown>) => React.createElement('MachineSelector', props),
}));
// The composer host is the boundary; the scoped authoring composer, its document
// owner and its scope projection all stay real beneath it.
vi.mock('@/components/sessions/agentInput', async () => {
    const { createAgentInputModuleMock } = await import('@/dev/testkit');
    return createAgentInputModuleMock({ onFocusRequest: () => promptFocus() });
});
vi.mock('@/agents/backendCatalog/useDaemonMergedProjectionInputs', () => ({
    useDaemonMergedProjectionInputs: () => ({ phase: 'idle', inputs: null }),
}));
vi.mock('@/components/plugins/surfaces/PluginContextualResourceStoreProvider', () => ({
    PluginContextualResourceStoreProvider: (props: Readonly<{ children?: React.ReactNode }>) =>
        React.createElement(React.Fragment, null, props.children),
}));
// The canonical keyboard catalog is a host boundary; this captures what the
// page registers so the shortcut contract can be asserted without a key event.
vi.mock('@/keyboard', () => ({
    useKeyboardShortcutHandlers: (handlers: Record<string, () => void>) => {
        registeredHandlers = handlers;
        return true;
    },
}));
vi.mock('@/components/ui/accessibility/announceAccessibilityMessage', () => ({
    announceAccessibilityMessage: announceSpy,
}));
vi.mock('@/platform/randomUUID', () => ({
    randomUUID: () => {
        composerInstanceIds.next += 1;
        const id = `composer-${composerInstanceIds.next}`;
        composerInstanceIds.issued.push(id);
        return id;
    },
}));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            show: modalShowSpy,
            update: modalUpdateSpy,
        },
    }).module;
});

beforeEach(() => {
    announceSpy.mockClear();
    modalShowSpy.mockClear();
    modalUpdateSpy.mockClear();
    promptFocus.mockClear();
    registeredHandlers = {};
    windowDimensions = { width: 1200, height: 800 };
    composerInstanceIds.issued = [];
    composerInstanceIds.next = 0;
});

afterEach(async () => {
    await standardCleanup();
});

const AGENT_TARGET = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.claude', localId: 'claude' } };

async function loadHarness() {
    const body = await import('./WorkflowEditorBody');
    const draftModule = await import('@/sync/domains/workflows/workflowEditorDraft');
    const authoring = await import('@/sync/domains/workflows/workflowAuthoring');
    return { ...body, ...draftModule, ...authoring };
}

type Harness = Awaited<ReturnType<typeof loadHarness>>;

function buildDraft(harness: Harness, overrides: Partial<{ name: string; text: string }> = {}) {
    const base = harness.setWorkflowDefaultField(
        harness.createWorkflowEditorDraft({
            draftId: 'draft-1',
            name: overrides.name ?? 'Review',
            blocks: [{
                kind: 'step',
                id: 'analyze',
                document: { text: overrides.text ?? 'Analyze the repository', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' },
            }],
        }),
        'agentTarget',
        AGENT_TARGET,
    );
    return base;
}

async function renderBody(
    harness: Harness,
    overrides: Record<string, unknown> = {},
    renderOptions?: Parameters<typeof renderScreen>[1],
) {
    const draft = (overrides.draft as ReturnType<typeof buildDraft>) ?? buildDraft(harness);
    const element = React.createElement(harness.WorkflowEditorBody, {
        draft,
        onChange: () => {},
        machineName: 'Mac Studio',
        composerScope: MACHINE_COMPOSER_SCOPE,
        selectedBlockId: null,
        onSelectBlock: () => {},
        onCustomizeBlock: () => {},
        view: 'steps',
        onChangeView: () => {},
        ...overrides,
    } as never);
    return renderScreen(element, renderOptions);
}

/**
 * The rendered document order of the named surfaces.
 *
 * Reading order is the contract these cases are about — a pinned command bar
 * before the document, and the first prompt before optional configuration — so
 * it is asserted from the painted tree rather than from props.
 */
function renderedOrder(
    screen: Awaited<ReturnType<typeof renderScreen>>,
    testIDs: readonly string[],
): string[] {
    const seen: string[] = [];
    for (const node of screen.findAll((candidate) => (
        typeof candidate.type === 'string'
        && typeof candidate.props?.testID === 'string'
        && testIDs.includes(candidate.props.testID)
    ))) {
        const testID = node.props.testID as string;
        if (!seen.includes(testID)) seen.push(testID);
    }
    return seen;
}

function flattenTestStyle(style: unknown): Record<string, unknown> {
    if (!style) return {};
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>((acc, entry) => ({ ...acc, ...flattenTestStyle(entry) }), {});
    }
    if (typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

function isInspectorModalConfig(value: unknown): value is Readonly<{
    chrome: Readonly<{ kind: string; bodyScroll: string }>;
    focusReturnRef: Readonly<{ current: Readonly<{ focus(): void }> }>;
    props: Readonly<{
        step: Readonly<{ id: string }>;
        draft: WorkflowEditorDraft;
        onChange(next: WorkflowEditorDraft): void;
    }>;
}> {
    if (typeof value !== 'object' || value === null) return false;
    if (!('chrome' in value) || !('focusReturnRef' in value) || !('props' in value)) return false;
    const chrome = value.chrome;
    const focusReturnRef = value.focusReturnRef;
    const props = value.props;
    return typeof chrome === 'object' && chrome !== null
        && typeof focusReturnRef === 'object' && focusReturnRef !== null
        && typeof props === 'object' && props !== null
        && 'step' in props && 'draft' in props && 'onChange' in props
        && typeof props.onChange === 'function';
}

describe('workflow editor body', () => {
    it('can suppress only its title field when a wrapper owns the visible name', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, {
            showNameField: false,
            projectTarget: { machineId: 'machine-1', directory: '/Users/me/project' },
            projectMachines: [{ id: 'machine-1', metadata: { displayName: 'Mac Studio', homeDir: '/Users/me' } }],
        });

        expect(screen.findByTestId('workflow-editor-name')).toBeNull();
        expect(screen.findByTestId('workflow-editor-machine-row')).not.toBeNull();
        expect(screen.findByTestId('workflow-editor-defaults')).not.toBeNull();
        expect(screen.findByTestId('workflow-editor-project-directory-readonly')).not.toBeNull();
        expect(screen.getTextContent()).toContain('~/project');
    });

    it('gives the editor page actions a real platform press target', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, {
            onRunNow: () => {},
            onSave: () => {},
            onSchedule: () => {},
            onImportJson: () => {},
            onExportJson: () => {},
        });

        // `hitSlop` is inert on react-native-web's `Pressable`, and the desktop
        // app IS the web bundle, so the target has to be real box model.
        for (const testID of [
            'workflow-editor-run-now',
            'workflow-editor-save',
            'workflow-editor-schedule',
            'workflow-editor-import-json',
            'workflow-editor-export-json',
        ]) {
            const node = screen.findByTestId(testID);
            expect(node, testID).not.toBeNull();
            expect(flattenTestStyle(node?.props.style).minHeight, testID).toBe(44);
            expect(node?.props.hitSlop, testID).toBeUndefined();
        }
    });

    it('authors loop count and item sources as canonical value references', async () => {
        const harness = await loadHarness();
        const changed = vi.fn();
        const draft = harness.createWorkflowEditorDraft({
            draftId: 'loop-draft', name: 'Loop', defaults: { agentTarget: AGENT_TARGET },
            blocks: [{
                kind: 'loop', id: 'repeat', repetition: { kind: 'count', count: { kind: 'literal', value: 2 } },
                body: [{ kind: 'step', id: 'inside', document: { text: 'Work', references: [], attachments: [] }, input: [], result: { kind: 'text' } }],
            }],
        });
        const screen = await renderBody(harness, { draft, onChange: changed });

        await screen.pressByTestIdAsync('workflow-editor-loop-repeat-count-input-0-kind-input');
        expect(changed.mock.calls[0]?.[0].blocks[0].repetition.count.kind).toBe('input');
    });

    it('authors named inputs in declaration order and keeps them separate from step prompts', async () => {
        const harness = await loadHarness();
        const changed = vi.fn();
        const screen = await renderBody(harness, { onChange: changed });

        await screen.pressByTestIdAsync('workflow-editor-inputs-add');
        const next = changed.mock.calls[0]?.[0];
        expect(next.inputs).toEqual([{
            name: 'input',
            valueType: 'string',
            required: false,
        }]);
        expect(next.blocks[0].document.text).toBe('Analyze the repository');
    });

    it('labels parallel branches by localized position without authoring a schema field', async () => {
        const harness = await loadHarness();
        const changed = vi.fn();
        const draft = harness.createWorkflowEditorDraft({
            draftId: 'parallel-draft', name: 'Review', defaults: { agentTarget: AGENT_TARGET },
            blocks: [{
                kind: 'parallel', id: 'parallel', failurePolicy: 'fail_stop',
                branches: [{
                    id: 'branch-a',
                    blocks: [{
                        kind: 'step', id: 'step-a',
                        document: { text: 'Review', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    }],
                }],
            }],
        });
        const screen = await renderBody(harness, { draft, onChange: changed });
        expect(screen.findByTestId('workflow-editor-parallel-parallel-branch-branch-a-label')).not.toBeNull();
        expect(screen.getTextContent()).toContain('workflows.editor.branch 1');
        expect(changed).not.toHaveBeenCalled();
    });

    it('uses the shared Session authoring controls for workflow defaults and the selected step inspector', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, { selectedBlockId: 'analyze' });

        expect(screen.findByTestId('workflow-editor-defaults')).not.toBeNull();
        expect(screen.findByTestId('workflow-editor-inspector')).not.toBeNull();
        expect(screen.findByTestId('workflow-editor-inspector-agentTarget')).not.toBeNull();
    });

    /**
     * The strict Workflow schema requires an effective Agent, so a host that
     * contributes its Agent catalog must produce a real picker here. Without
     * those facts the field stays explicitly unavailable rather than pretending
     * to offer a choice — both directions are the contract.
     */
    it('offers the host-contributed Agent targets and states unavailability without them', async () => {
        const harness = await loadHarness();
        const changed = vi.fn();
        const withoutFacts = await renderBody(harness);
        expect(withoutFacts.findByTestId('workflow-editor-defaults-agentTarget-unavailable')).not.toBeNull();
        expect(withoutFacts.findByTestId('workflow-editor-defaults-agentTarget')).toBeNull();
        await withoutFacts.unmount();

        const screen = await renderBody(harness, {
            onChange: changed,
            authoringFacts: {
                agentTargets: [
                    { id: 'backend:claude', label: 'Claude Code', target: AGENT_TARGET, agentId: 'claude' },
                    {
                        id: 'backend:codex',
                        label: 'Codex',
                        agentId: 'codex',
                        target: {
                            kind: 'agent' as const,
                            identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
                        },
                    },
                ],
            },
        });

        expect(screen.findByTestId('workflow-editor-defaults-agentTarget-unavailable')).toBeNull();
        const chip = screen.findByTestId('workflow-editor-defaults-agentTarget');
        expect(chip).not.toBeNull();
        expect(chip?.props.accessibilityLabel).toContain('Claude Code');
    });

    it('opens the same controlled step inspector in the canonical modal on compact viewports', async () => {
        windowDimensions = { width: 390, height: 844 };
        const harness = await loadHarness();
        const changed = vi.fn();
        const screen = await renderBody(harness, { onChange: changed });

        expect(screen.findByTestId('workflow-editor-inspector')).toBeNull();
        await screen.pressByTestIdAsync('workflow-editor-step-analyze-customize');

        expect(modalShowSpy).toHaveBeenCalledTimes(1);
        const config = modalShowSpy.mock.calls[0]?.[0];
        expect(isInspectorModalConfig(config)).toBe(true);
        if (!isInspectorModalConfig(config)) throw new Error('Expected the Workflow inspector modal configuration');
        expect(config.chrome).toMatchObject({ kind: 'card', bodyScroll: 'auto' });
        expect(config.focusReturnRef).toBeDefined();
        expect(config.props.step.id).toBe('analyze');
        config.props.onChange({ ...config.props.draft, name: 'Changed through inspector' });
        expect(changed).toHaveBeenCalledTimes(1);
        config.focusReturnRef.current.focus();
        expect(promptFocus).toHaveBeenCalledTimes(1);
    });

    /**
     * Flow's Edit action must land on an editor that exists. A branch frame is
     * not a block, so selecting it and pressing Edit used to select an id no
     * editor owns and request focus on a prompt that was never registered — an
     * inert action. The owning group is the real editor for a branch.
     */
    it('reveals the owning group editor when Edit is pressed on a Flow branch frame', async () => {
        const harness = await loadHarness();
        const changeView = vi.fn();
        const draft = harness.setWorkflowDefaultField(harness.createWorkflowEditorDraft({
            draftId: 'parallel-draft', name: 'Review',
            blocks: [{
                kind: 'parallel', id: 'parallel', failurePolicy: 'fail_stop',
                branches: [{
                    id: 'branch-a',
                    blocks: [{
                        kind: 'step', id: 'step-a',
                        document: { text: 'Review', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    }],
                }],
            }],
        }), 'agentTarget', AGENT_TARGET);
        const selections: Array<string | null> = [];
        function Host(): React.ReactElement {
            const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(null);
            return React.createElement(harness.WorkflowEditorBody, {
                draft,
                onChange: () => {},
                machineName: 'Mac Studio',
                composerScope: MACHINE_COMPOSER_SCOPE,
                selectedBlockId,
                onSelectBlock: (blockId: string | null) => { selections.push(blockId); setSelectedBlockId(blockId); },
                onCustomizeBlock: () => {},
                view: 'flow',
                onChangeView: changeView,
            } as never);
        }
        const screen = await renderScreen(React.createElement(Host));

        await screen.pressByTestIdAsync('workflow-editor-flow-node-parallel#branch-a');
        // The selection is the real block the editor can show, never the frame id.
        expect(selections.at(-1)).toBe('parallel');
        expect(harness.findWorkflowBlock(draft, selections.at(-1) ?? '')?.kind).toBe('parallel');

        const edit = screen.findByTestId('workflow-editor-flow-edit-step');
        expect(edit?.props.accessibilityLabel).toBe('workflows.a11y.editBlock');
        await screen.pressByTestIdAsync('workflow-editor-flow-edit-step');
        expect(changeView).toHaveBeenCalledWith('steps');
        expect(selections.at(-1)).toBe('parallel');
        // A group has no prompt; nothing is asked to focus that cannot.
        expect(promptFocus).not.toHaveBeenCalled();
    });

    it('returns focus to the evaluator prompt when Edit is pressed on its Flow node', async () => {
        const harness = await loadHarness();
        const changeView = vi.fn();
        const draft = harness.setWorkflowDefaultField(harness.createWorkflowEditorDraft({
            draftId: 'loop-draft', name: 'Judge',
            blocks: [{
                kind: 'loop', id: 'judge',
                repetition: {
                    kind: 'evaluate', maxIterations: 3, history: 'latest',
                    evaluator: {
                        kind: 'step', id: 'judge-step',
                        document: { text: 'Decide', references: [], attachments: [] },
                        input: [], result: { kind: 'decision', decisions: ['continue', 'stop'] },
                    },
                },
                body: [{
                    kind: 'step', id: 'summarize',
                    document: { text: 'Summarize', references: [], attachments: [] },
                    input: [], result: { kind: 'text' },
                }],
            }],
        }), 'agentTarget', AGENT_TARGET);
        const screen = await renderBody(harness, {
            draft, view: 'flow', selectedBlockId: 'judge-step', onChangeView: changeView,
        });

        expect(screen.findByTestId('workflow-editor-flow-edit-step')?.props.accessibilityLabel)
            .toBe('workflows.a11y.editStep');
        await screen.pressByTestIdAsync('workflow-editor-flow-edit-step');
        expect(changeView).toHaveBeenCalledWith('steps');
        expect(promptFocus).toHaveBeenCalledTimes(1);
    });

    it('lets the machine and project controls wrap without imposing a phone-breaking input minimum', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, {
            projectTarget: { machineId: 'machine-1', directory: '/workspace/project' },
            projectMachines: [{ id: 'machine-1', metadata: { displayName: 'Mac Studio', homeDir: '/Users/me' } }],
            onChangeProjectTarget: vi.fn(),
            onBrowseProjectDirectory: vi.fn(),
        });

        expect(flattenTestStyle(screen.findByTestId('workflow-editor-machine-row')?.props.style))
            .toMatchObject({ flexWrap: 'wrap' });
        expect(flattenTestStyle(screen.findByTestId('workflow-editor-project-directory')?.props.style))
            .toMatchObject({ minWidth: 0, flexShrink: 1 });
    });

    it('authors a typed step input reference without interpolating it into prompt text', async () => {
        const harness = await loadHarness();
        const changed = vi.fn();
        const screen = await renderBody(harness, { onChange: changed });

        await screen.pressByTestIdAsync('workflow-editor-step-analyze-add-input');
        const next = changed.mock.calls[0]?.[0];
        expect(next.blocks[0].input).toEqual([{ kind: 'literal', value: '' }]);
        expect(next.blocks[0].document.text).toBe('Analyze the repository');
    });

    it('authors a scoped producer workspace path for a downstream step', async () => {
        const harness = await loadHarness();
        const changed = vi.fn();
        const base = buildDraft(harness);
        const draft = {
            ...base,
            blocks: [...base.blocks, {
                kind: 'step' as const,
                id: 'implement',
                document: { text: 'Implement the analysis', references: [], attachments: [] },
                input: [{ kind: 'literal' as const, value: '' }],
                result: { kind: 'text' as const },
            }],
        };
        const screen = await renderBody(harness, { draft, onChange: changed });

        await screen.pressByTestIdAsync('workflow-editor-step-implement-input-0-kind-workspace');
        expect(changed.mock.calls[0]?.[0].blocks[1].input).toEqual([{
            kind: 'workspace',
            producer: { blockId: 'analyze', scope: { kind: 'current' } },
            field: 'directory',
        }]);
    });

    it('offers Run now, Save and Schedule as three separate commands', async () => {
        const harness = await loadHarness();
        const ran = vi.fn();
        const saved = vi.fn();
        const scheduled = vi.fn();
        const screen = await renderBody(harness, { onRunNow: ran, onSave: saved, onSchedule: scheduled });

        await screen.pressByTestIdAsync('workflow-editor-run-now');
        expect(ran).toHaveBeenCalledTimes(1);
        expect(saved).not.toHaveBeenCalled();
        expect(scheduled).not.toHaveBeenCalled();

        await screen.pressByTestIdAsync('workflow-editor-save');
        expect(saved).toHaveBeenCalledTimes(1);
        expect(ran).toHaveBeenCalledTimes(1);
    });

    /**
     * A page action that scrolls away is unreachable exactly when it is needed:
     * on a phone with the software keyboard open, the document is long and the
     * primary command sat at the very top of ordinary content.
     */
    it('pins the page commands above the scrolling document in one keyboard-safe surface', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, {
            onRunNow: () => {},
            onSave: () => {},
            onSchedule: () => {},
            onExportJson: () => {},
        });

        const { KeyboardAwareScrollView } = await import('@/components/ui/keyboardAvoidance/KeyboardAwareScrollView');
        // Exactly one scroll owner for the page, carrying the canonical
        // content-width constraint the host used to apply.
        expect(screen.findAllByType(KeyboardAwareScrollView as never)).toHaveLength(1);
        const scroll = screen.findHostByTestId('workflow-editor-scroll');
        expect(scroll).not.toBeNull();
        expect(scroll?.props.stickyHeaderIndices).toEqual([0]);
        expect(scroll?.props.keyboardShouldPersistTaps).toBe('handled');
        expect(screen.findByType(KeyboardAwareScrollView as never).props.contentContainerStyle)
            .toEqual(expect.arrayContaining([expect.objectContaining({ maxWidth: expect.any(Number) })]));

        // The pinned surface is the scroll container's first child, so it is the
        // one the platform keeps on screen, and every command lives inside it.
        const commandBar = screen.findHostByTestId('workflow-editor-command-bar');
        expect(commandBar).not.toBeNull();
        for (const testID of [
            'workflow-editor-run-now',
            'workflow-editor-save',
            'workflow-editor-schedule',
            'workflow-editor-export-json',
        ]) {
            expect(
                commandBar?.findAll((node) => node.props?.testID === testID).length,
                testID,
            ).toBeGreaterThan(0);
        }
        // The authored document is not inside the pinned surface.
        expect(commandBar?.findAll((node) => node.props?.testID === 'workflow-editor-steps-presentation'))
            .toHaveLength(0);
        expect(renderedOrder(screen, [
            'workflow-editor-command-bar',
            'workflow-editor-name',
        ])).toEqual(['workflow-editor-command-bar', 'workflow-editor-name']);
    });

    /**
     * A disabled command's reason travels with the command. Leaving the reason
     * in the scrolling document puts it somewhere else on the page from the
     * control it explains.
     */
    it('keeps each refused command reason inside the pinned command surface', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, {
            draft: buildDraft(harness, { name: '  ' }),
            // No reviewed target blocks Run; the blank name blocks Save.
            projectTarget: null,
            onRunNow: () => {},
            onSave: () => {},
        });

        const commandBar = screen.findHostByTestId('workflow-editor-command-bar');
        expect(commandBar?.findAll((node) => node.props?.testID === 'workflow-editor-save-reason').length)
            .toBeGreaterThan(0);
        expect(commandBar?.findAll((node) => node.props?.testID === 'workflow-editor-run-reason').length)
            .toBeGreaterThan(0);
    });

    /**
     * UX §1/§4.2: the first prompt is the visual center, not something reached
     * after a schema wall. Inputs and shared defaults are optional refinements
     * and follow the authored steps.
     */
    it('orders the first step prompt before the optional inputs and shared defaults', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, { onRunNow: () => {}, onSave: () => {} });

        expect(renderedOrder(screen, [
            'workflow-editor-steps-presentation',
            'workflow-editor-inputs',
            'workflow-editor-defaults',
        ])).toEqual([
            'workflow-editor-steps-presentation',
            'workflow-editor-inputs',
            'workflow-editor-defaults',
        ]);
    });

    /**
     * The phone is where a scrolling action row actually failed: one column, a
     * long document and a software keyboard over the bottom half.
     */
    it('keeps the pinned commands and one scroll owner on a small phone viewport', async () => {
        windowDimensions = { width: 390, height: 700 };
        const harness = await loadHarness();
        const { KeyboardAwareScrollView } = await import('@/components/ui/keyboardAvoidance/KeyboardAwareScrollView');
        const screen = await renderBody(harness, { onRunNow: () => {}, onSave: () => {} });

        expect(screen.findAllByType(KeyboardAwareScrollView as never)).toHaveLength(1);
        const scroll = screen.findHostByTestId('workflow-editor-scroll');
        expect(scroll?.props.stickyHeaderIndices).toEqual([0]);
        expect(renderedOrder(screen, [
            'workflow-editor-command-bar',
            'workflow-editor-steps-presentation',
            'workflow-editor-defaults',
        ])).toEqual([
            'workflow-editor-command-bar',
            'workflow-editor-steps-presentation',
            'workflow-editor-defaults',
        ]);
        // The inspector still uses the canonical focused modal on phones.
        expect(screen.findByTestId('workflow-editor-run-now')).not.toBeNull();
    });

    it('lets a wrapper host keep one page scroll by composing the body without its own', async () => {
        const harness = await loadHarness();
        // The Automation wrappers own their scroll and offer no page commands.
        const screen = await renderBody(harness, { showNameField: false });

        expect(screen.findHostByTestId('workflow-editor-scroll')).toBeNull();
        expect(screen.findHostByTestId('workflow-editor-command-bar')).toBeNull();
        expect(screen.findByTestId('workflow-editor-defaults')).not.toBeNull();
    });

    it('hides an effect the host cannot offer instead of rendering it inert', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, { onRunNow: vi.fn() });
        expect(screen.findByTestId('workflow-editor-save')).toBeNull();
        expect(screen.findByTestId('workflow-editor-schedule')).toBeNull();
    });

    it('blocks Save with a nearby actionable reason when the workflow has no name', async () => {
        const harness = await loadHarness();
        const saved = vi.fn();
        const screen = await renderBody(harness, {
            draft: buildDraft(harness, { name: '  ' }),
            onSave: saved,
        });

        expect(screen.findByProps({ testID: 'workflow-editor-save' }).props.accessibilityState)
            .toEqual({ disabled: true });
        expect(screen.getTextContent())
            .toContain('workflows.save.nameRequired');
        await screen.pressByTestIdAsync('workflow-editor-save');
        expect(saved).not.toHaveBeenCalled();
    });

    it('registers Save and Run through the canonical catalog and calls the visible-action owners', async () => {
        const harness = await loadHarness();
        const ran = vi.fn();
        const saved = vi.fn();
        await renderBody(harness, { onRunNow: ran, onSave: saved });
        expect(Object.keys(registeredHandlers).sort()).toEqual(['workflow.run', 'workflow.save']);

        registeredHandlers['workflow.save']!();
        expect(saved).toHaveBeenCalledTimes(1);
        registeredHandlers['workflow.run']!();
        expect(ran).toHaveBeenCalledTimes(1);
        expect(announceSpy).not.toHaveBeenCalled();
    });

    it('ignores a shortcut repeat while its command is pending, without a second submission', async () => {
        const harness = await loadHarness();
        const ran = vi.fn();
        const saved = vi.fn();
        await renderBody(harness, { onRunNow: ran, onSave: saved, runPending: true, savePending: true });
        registeredHandlers['workflow.run']!();
        registeredHandlers['workflow.save']!();
        expect(ran).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
        // A pending command is already acknowledged by its own label.
        expect(announceSpy).not.toHaveBeenCalled();
    });

    /**
     * A shortcut, press or host intent that cannot proceed is refused audibly
     * with the same reason the page shows beside the control, and focus lands
     * on the step that carries the cause. It never vanishes silently and never
     * reaches the effect owner.
     */
    it('refuses a blocked shortcut with the visible reason and focuses the offending step', async () => {
        const harness = await loadHarness();
        const ran = vi.fn();
        const onSelectBlock = vi.fn();
        await renderBody(harness, {
            draft: buildDraft(harness, { text: '' }),
            onRunNow: ran,
            onSelectBlock,
        });
        expect(registeredHandlers['workflow.run']).toBeDefined();
        registeredHandlers['workflow.run']!();

        expect(ran).not.toHaveBeenCalled();
        expect(announceSpy).toHaveBeenCalledTimes(1);
        expect(String(announceSpy.mock.calls[0]?.[0])).toContain('workflows.a11y.commandRefused');
        expect(String(announceSpy.mock.calls[0]?.[0])).toContain('workflows.issue.invalid_input');
        expect(onSelectBlock).toHaveBeenCalledWith('analyze');
        expect(promptFocus).toHaveBeenCalledTimes(1);
    });

    it('routes a host intent through the same gate as the visible action', async () => {
        const harness = await loadHarness();
        const ran = vi.fn();
        const scheduled = vi.fn();
        const commandsRef = React.createRef<import('./WorkflowEditorBody').WorkflowEditorCommands | null>();
        const blocked = await renderBody(harness, {
            draft: buildDraft(harness, { text: '' }),
            onRunNow: ran,
            onSchedule: scheduled,
            projectTarget: { machineId: 'machine-1', directory: '/Users/me/project' },
            commandsRef,
        });
        commandsRef.current!.runNow();
        commandsRef.current!.schedule();
        expect(ran).not.toHaveBeenCalled();
        expect(scheduled).not.toHaveBeenCalled();
        expect(announceSpy).toHaveBeenCalledTimes(2);
        await blocked.unmount();

        const eligible = await renderBody(harness, {
            onRunNow: ran,
            onSchedule: scheduled,
            projectTarget: { machineId: 'machine-1', directory: '/Users/me/project' },
            commandsRef,
        });
        commandsRef.current!.runNow();
        commandsRef.current!.schedule();
        expect(ran).toHaveBeenCalledTimes(1);
        expect(scheduled).toHaveBeenCalledTimes(1);
        await eligible.unmount();
    });

    it('blocks Schedule on an invalid definition with a nearby reason, not only on a missing target', async () => {
        const harness = await loadHarness();
        const scheduled = vi.fn();
        const screen = await renderBody(harness, {
            draft: buildDraft(harness, { text: '' }),
            onSchedule: scheduled,
            projectTarget: { machineId: 'machine-1', directory: '/Users/me/project' },
        });
        const schedule = screen.findByTestId('workflow-editor-schedule');
        expect(schedule?.props.accessibilityState).toEqual({ disabled: true });
        expect(schedule?.props.accessibilityHint).toBe('workflows.issue.invalid_input');
        expect(screen.findByTestId('workflow-editor-schedule-reason')).not.toBeNull();
        await screen.pressByTestIdAsync('workflow-editor-schedule');
        expect(scheduled).not.toHaveBeenCalled();
    });

    /**
     * Local invalid text is never a private editor fact: it enters the draft as
     * an unresolved value, so the one canonical validation blocks Run, Save,
     * Schedule and Export together and each states the same cause.
     */
    it('blocks every command on an unresolved input default and states the cause on each', async () => {
        const harness = await loadHarness();
        const handlers = { onRunNow: vi.fn(), onSave: vi.fn(), onSchedule: vi.fn(), onExportJson: vi.fn() };
        let draft: WorkflowEditorDraft = {
            ...buildDraft(harness),
            inputs: [{ name: 'count', valueType: 'number', required: false }],
        };
        function Controlled(): React.ReactElement {
            const [current, setCurrent] = React.useState(draft);
            draft = current;
            return React.createElement(harness.WorkflowEditorBody, {
                draft: current,
                onChange: setCurrent,
                machineName: 'Mac Studio',
                composerScope: MACHINE_COMPOSER_SCOPE,
                selectedBlockId: null,
                onSelectBlock: () => {},
                onCustomizeBlock: () => {},
                view: 'steps',
                onChangeView: () => {},
                projectTarget: { machineId: 'machine-1', directory: '/Users/me/project' },
                ...handlers,
            } as never);
        }
        const screen = await renderScreen(React.createElement(Controlled));
        await act(async () => { screen.changeTextByTestId('workflow-editor-input-0-default', 'many'); });

        expect(Number.isNaN(draft.inputs[0]?.default)).toBe(true);
        expect(screen.findByTestId('workflow-editor-input-0-default')?.props.value).toBe('many');
        expect(screen.findByTestId('workflow-editor-input-0-default-error')?.props.accessibilityRole).toBe('alert');
        for (const testID of ['workflow-editor-run-now', 'workflow-editor-save', 'workflow-editor-schedule', 'workflow-editor-export-json']) {
            const node = screen.findByTestId(testID);
            expect(node?.props.accessibilityState, testID).toEqual({ disabled: true });
            expect(node?.props.accessibilityHint, testID).toBe('workflows.issue.invalid_input');
        }
        registeredHandlers['workflow.save']!();
        registeredHandlers['workflow.run']!();
        expect(handlers.onSave).not.toHaveBeenCalled();
        expect(handlers.onRunNow).not.toHaveBeenCalled();

        await act(async () => { screen.changeTextByTestId('workflow-editor-input-0-default', '3'); });
        expect(draft.inputs[0]?.default).toBe(3);
        expect(screen.findByTestId('workflow-editor-run-now')?.props.accessibilityState).toEqual({ disabled: false });
    });

    it('authors a step result-wait timeout through the inspector and omits it when cleared', async () => {
        const harness = await loadHarness();
        let draft: WorkflowEditorDraft = buildDraft(harness);
        function Controlled(): React.ReactElement {
            const [current, setCurrent] = React.useState(draft);
            draft = current;
            return React.createElement(harness.WorkflowEditorBody, {
                draft: current,
                onChange: setCurrent,
                machineName: 'Mac Studio',
                composerScope: MACHINE_COMPOSER_SCOPE,
                selectedBlockId: 'analyze',
                onSelectBlock: () => {},
                onCustomizeBlock: () => {},
                view: 'steps',
                onChangeView: () => {},
            } as never);
        }
        const screen = await renderScreen(React.createElement(Controlled));
        await act(async () => { screen.changeTextByTestId('workflow-editor-inspector-timeout', '5000'); });
        expect((draft.blocks[0] as { timeoutMs?: number }).timeoutMs).toBe(5000);
        expect(harness.validateWorkflowEditorDraft(draft).normalizedDefinition?.blocks[0]).toMatchObject({ timeoutMs: 5000 });
        await act(async () => { screen.changeTextByTestId('workflow-editor-inspector-timeout', ''); });
        expect(draft.blocks[0]).not.toHaveProperty('timeoutMs');
    });

    /**
     * WF-05 / plan 04 §3.2: a step can continue an arbitrary existing Session,
     * chosen through the canonical Session picker from the host's candidates,
     * and the choice records the exact Session and Machine the coordinator
     * requires. Without candidates the choice is stated unavailable, and a
     * recorded Session this host cannot list stays visible by its identity.
     */
    it('authors an existing Session continuation from the host-supplied candidates', async () => {
        const harness = await loadHarness();
        const changed = vi.fn();
        const screen = await renderBody(harness, {
            onChange: changed,
            existingSessions: [
                { sessionId: 'session-1', machineId: 'machine-1', label: 'Fix login' },
                { sessionId: 'session-2', machineId: 'machine-1', label: 'Refactor sync' },
            ],
        });
        const radio = screen.findByTestId('workflow-editor-defaults-continuity-conversation-existing');
        expect(radio?.props.accessibilityState).toMatchObject({ selected: false });
        expect(radio?.props.disabled).toBe(false);
        expect(screen.findByTestId('workflow-editor-defaults-continuity-conversation-session-picker')).toBeNull();

        await screen.pressByTestIdAsync('workflow-editor-defaults-continuity-conversation-existing');
        const picker = screen.findByTestId('workflow-editor-defaults-continuity-conversation-session-picker');
        expect(picker).not.toBeNull();
        const options = picker!.props.rootStep.sections[0].options as Array<{ id: string; label: string }>;
        expect(options.map((option) => option.id)).toEqual(['session-1', 'session-2']);
        await act(async () => { picker!.props.onSelect('session-2', options[1]); });

        expect(changed).toHaveBeenCalledTimes(1);
        const next = changed.mock.calls[0]?.[0];
        expect(next.defaults.conversation).toEqual({ kind: 'existing_session', sessionId: 'session-2', machineId: 'machine-1' });
        expect(harness.validateWorkflowEditorDraft(next).normalizedDefinition?.defaults.conversation)
            .toEqual({ kind: 'existing_session', sessionId: 'session-2', machineId: 'machine-1' });
    });

    it('shows a recorded existing Session and states when none can be offered', async () => {
        const harness = await loadHarness();
        const recorded = harness.setWorkflowDefaultField(
            buildDraft(harness),
            'conversation',
            { kind: 'existing_session', sessionId: 'session-9', machineId: 'machine-1' },
        );
        const listed = await renderBody(harness, {
            draft: recorded,
            existingSessions: [{ sessionId: 'session-9', machineId: 'machine-1', label: 'Ship release' }],
        });
        expect(listed.findByTestId('workflow-editor-defaults-continuity-conversation-existing')?.props.accessibilityState)
            .toMatchObject({ selected: true });
        expect(listed.findByTestId('workflow-editor-defaults-continuity-conversation-existing-selected')?.props.children)
            .toBe('Ship release');
        await listed.unmount();

        const unlisted = await renderBody(harness, { draft: recorded });
        expect(unlisted.getTextContent()).toContain('workflows.conversation.existingSessionById');
        expect(unlisted.getTextContent()).toContain('session-9');
        await unlisted.unmount();

        const none = await renderBody(harness);
        const radio = none.findByTestId('workflow-editor-defaults-continuity-conversation-existing');
        expect(radio?.props.disabled).toBe(true);
        expect(radio?.props.accessibilityHint).toBe('workflows.conversation.noExistingSessions');
        expect(none.findByTestId('workflow-editor-defaults-continuity-conversation-existing-unavailable')).not.toBeNull();
        await none.unmount();
    });

    it('invites the first prompt only while the workflow is one empty step', async () => {
        const harness = await loadHarness();
        const empty = await renderBody(harness, { draft: buildDraft(harness, { text: '' }) });
        expect(empty.getTextContent()).toContain('workflows.editor.firstPromptTitle');
        await empty.unmount();

        const written = await renderBody(harness);
        expect(written.getTextContent()).not.toContain('workflows.editor.firstPromptTitle');
    });

    it('keeps the machine control visibly unresolved rather than fabricating a default', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, { machineName: null });
        expect(screen.getTextContent())
            .toContain('workflows.issue.target_unavailable');
    });

    it('switches to Flow and restores the exact prompt focus through the existing focus owner', async () => {
        const harness = await loadHarness();
        function ControlledBody() {
            const [view, setView] = React.useState<'steps' | 'flow'>('flow');
            const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>('analyze');
            return React.createElement(harness.WorkflowEditorBody, {
                draft: buildDraft(harness),
                onChange: () => {},
                machineName: 'Mac Studio',
                composerScope: MACHINE_COMPOSER_SCOPE,
                selectedBlockId,
                onSelectBlock: setSelectedBlockId,
                onCustomizeBlock: setSelectedBlockId,
                view,
                onChangeView: setView,
            });
        }
        const screen = await renderScreen(React.createElement(ControlledBody));

        expect(screen.findByTestId('workflow-editor-flow-node-analyze')).not.toBeNull();
        await screen.pressByTestIdAsync('workflow-editor-flow-edit-step');
        expect(screen.findByTestId('workflow-editor-step-analyze-prompt')).not.toBeNull();
        expect(promptFocus).toHaveBeenCalledTimes(1);
    });

    it('offers one page-level Run as choice and states an inactive target instead of hiding or downgrading it', async () => {
        const harness = await loadHarness();
        const { resolveWorkflowRunAsTargets } = await import('../run/workflowRunAsTargets');
        const onChangeExecutionTarget = vi.fn();
        const screen = await renderBody(harness, {
            selectedBlockId: 'analyze',
            executionTarget: 'session',
            runAsTargets: resolveWorkflowRunAsTargets({ detachedExecutionRun: 'unsupported' }),
            onChangeExecutionTarget,
        });

        expect(screen.findByTestId('workflow-editor-run-as-session')?.props.accessibilityState)
            .toMatchObject({ selected: true });
        await screen.pressByTestIdAsync('workflow-editor-run-as-attached_run');
        expect(onChangeExecutionTarget).toHaveBeenCalledWith('attached_run');

        const detached = screen.findByTestId('workflow-editor-run-as-detached_run');
        expect(detached).not.toBeNull();
        expect(detached?.props.accessibilityState).toMatchObject({ disabled: true });
        detached?.props.onPress?.();
        expect(onChangeExecutionTarget).toHaveBeenCalledTimes(1);
        expect(screen.getTextContent())
            .toContain('workflows.editor.runAsUnavailableReason.machine_does_not_support_detached_runs');

        // Run as is Run-scoped: it must never appear as a step override.
        expect(screen.findByTestId('workflow-editor-inspector-run-as')).toBeNull();
    });

    it('keeps the active step composer mounted across Steps and Flow instead of remounting it', async () => {
        const harness = await loadHarness();
        function ControlledBody() {
            const [view, setView] = React.useState<'steps' | 'flow'>('steps');
            return React.createElement(harness.WorkflowEditorBody, {
                draft: buildDraft(harness),
                onChange: () => {},
                machineName: 'Mac Studio',
                composerScope: MACHINE_COMPOSER_SCOPE,
                selectedBlockId: 'analyze',
                onSelectBlock: () => {},
                onCustomizeBlock: () => {},
                view,
                onChangeView: setView,
            });
        }
        const screen = await renderScreen(React.createElement(ControlledBody));
        expect(composerInstanceIds.issued).toHaveLength(1);
        const originalInstanceId = composerInstanceIds.issued[0];

        await screen.pressByTestIdAsync('workflow-editor-view:flow');
        // The document stays mounted so caret, selection and any active IME or
        // dictation binding survive the reading-mode switch, but it must not be
        // reachable by pointer or assistive technology while Flow is showing.
        const hiddenSteps = screen.findByTestId('workflow-editor-steps-presentation');
        expect(hiddenSteps).not.toBeNull();
        expect(hiddenSteps?.props.accessibilityElementsHidden).toBe(true);
        expect(hiddenSteps?.props.importantForAccessibility).toBe('no-hide-descendants');
        expect(hiddenSteps?.props.pointerEvents).toBe('none');

        await screen.pressByTestIdAsync('workflow-editor-view:steps');
        expect(composerInstanceIds.issued).toEqual([originalInstanceId]);
    });

    it('says no final output is selected until one is authored', async () => {
        const harness = await loadHarness();
        // Selection is the contract, not the presence of the copy: both options
        // are always rendered, so only the exclusive selected state can tell an
        // unauthored final output from an authored one.
        const none = await renderBody(harness);
        expect(none.findByTestId('workflow-editor-final-output-clear')?.props.accessibilityState)
            .toEqual({ selected: true });
        expect(none.findByTestId('workflow-editor-final-output-option-analyze')?.props.accessibilityState)
            .toEqual({ selected: false });
        expect(none.findByTestId('workflow-editor-final-output-path')).toBeNull();
        await none.unmount();

        const bound = await renderBody(harness, {
            draft: harness.setWorkflowFinalOutput(buildDraft(harness), {
                kind: 'result',
                producer: { blockId: 'analyze', scope: { kind: 'current' } },
                path: [],
            }),
        });
        expect(bound.findByTestId('workflow-editor-final-output-clear')?.props.accessibilityState)
            .toEqual({ selected: false });
        expect(bound.findByTestId('workflow-editor-final-output-option-analyze')?.props.accessibilityState)
            .toEqual({ selected: true });
        // The producer is named by its authored label, never by its internal id.
        expect(bound.getTextContent()).toContain('Analyze the repository');
        expect(bound.findByTestId('workflow-editor-final-output-path')).not.toBeNull();
    });

    it('authors and clears the deterministic final output through the shared draft owner', async () => {
        const harness = await loadHarness();
        const changed = vi.fn();
        const screen = await renderBody(harness, { onChange: changed });

        await screen.pressByTestIdAsync('workflow-editor-final-output-option-analyze');
        expect(changed.mock.calls[0]?.[0].finalOutput).toEqual({
            kind: 'result',
            producer: { blockId: 'analyze', scope: { kind: 'current' } },
            path: [],
        });
    });

    /**
     * UX §3.3: "A disabled primary action has a visible nearby reason and is
     * reachable to assistive technology." A silently inert Run/Schedule/Export
     * is the exact failure these cases refute.
     */
    it('states why Run now cannot proceed instead of going inert', async () => {
        const harness = await loadHarness();
        const runNow = vi.fn();
        const screen = await renderBody(harness, {
            draft: buildDraft(harness, { text: '' }),
            onRunNow: runNow,
            projectTarget: { machineId: 'machine-1', directory: '/Users/me/project' },
        });

        const action = screen.findByTestId('workflow-editor-run-now');
        expect(action?.props.accessibilityState?.disabled).toBe(true);
        expect(action?.props.accessibilityHint).toBeTruthy();
        expect(screen.findByTestId('workflow-editor-run-reason')).not.toBeNull();
        await screen.pressByTestIdAsync('workflow-editor-run-now');
        expect(runNow).not.toHaveBeenCalled();
    });

    it('names the unresolved contextual target rather than fabricating one', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, {
            onRunNow: vi.fn(),
            onSchedule: vi.fn(),
            projectTarget: null,
        });

        expect(screen.getTextContent()).toContain('workflows.editor.targetRequired');
        expect(screen.findByTestId('workflow-editor-schedule')?.props.accessibilityState?.disabled).toBe(true);
        expect(screen.findByTestId('workflow-editor-schedule-reason')).not.toBeNull();
    });

    it('refuses Export on a draft the canonical codec cannot serialize, with its reason', async () => {
        const harness = await loadHarness();
        const exportJson = vi.fn();
        const screen = await renderBody(harness, {
            draft: buildDraft(harness, { text: '' }),
            onExportJson: exportJson,
        });

        const action = screen.findByTestId('workflow-editor-export-json');
        expect(action?.props.accessibilityState?.disabled).toBe(true);
        await screen.pressByTestIdAsync('workflow-editor-export-json');
        expect(exportJson).not.toHaveBeenCalled();
        expect(screen.findByTestId('workflow-editor-export-reason')).not.toBeNull();
    });

    it('keeps every action live once the draft and its target are valid', async () => {
        const harness = await loadHarness();
        const runNow = vi.fn();
        const exportJson = vi.fn();
        const schedule = vi.fn();
        const screen = await renderBody(harness, {
            onRunNow: runNow,
            onExportJson: exportJson,
            onSchedule: schedule,
            projectTarget: { machineId: 'machine-1', directory: '/Users/me/project' },
        });

        expect(screen.findByTestId('workflow-editor-run-reason')).toBeNull();
        expect(screen.findByTestId('workflow-editor-export-reason')).toBeNull();
        await screen.pressByTestIdAsync('workflow-editor-run-now');
        await screen.pressByTestIdAsync('workflow-editor-export-json');
        await screen.pressByTestIdAsync('workflow-editor-schedule');
        expect(runNow).toHaveBeenCalledTimes(1);
        expect(exportJson).toHaveBeenCalledTimes(1);
        expect(schedule).toHaveBeenCalledTimes(1);
    });

    it('gives each unavailable Run as runtime its own reason instead of one blanket note', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness, {
            executionTarget: 'session',
            onChangeExecutionTarget: vi.fn(),
            runAsTargets: [
                { kind: 'session', available: true },
                { kind: 'attached_run', available: true },
                {
                    kind: 'detached_run',
                    available: false,
                    unavailableReason: 'machine_does_not_support_detached_runs',
                },
            ],
        });

        const option = screen.findByTestId('workflow-editor-run-as-detached_run');
        expect(option?.props.accessibilityState?.disabled).toBe(true);
        expect(option?.props.accessibilityHint)
            .toBe('workflows.editor.runAsUnavailableReason.machine_does_not_support_detached_runs');
        expect(screen.getTextContent())
            .toContain('workflows.editor.runAsUnavailableReason.machine_does_not_support_detached_runs');
    });

    it('offers an inline Undo after a block removal and restores it in place', async () => {
        const harness = await loadHarness();
        let draft = harness.setWorkflowDefaultField(
            harness.createWorkflowEditorDraft({
                draftId: 'draft-1',
                name: 'Review',
                blocks: [
                    {
                        kind: 'step', id: 'analyze',
                        document: { text: 'Analyze the repository', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    },
                    {
                        kind: 'step', id: 'implement',
                        document: { text: 'Implement the plan', references: [], attachments: [] },
                        input: [], result: { kind: 'text' },
                    },
                ],
            }),
            'agentTarget',
            AGENT_TARGET,
        );
        const screen = await renderBody(harness, {
            draft,
            onChange: (next: WorkflowEditorDraft) => { draft = next as typeof draft; },
        });

        await screen.pressByTestIdAsync('workflow-editor-step-analyze-actions');
        await screen.pressByTestIdAsync('workflow-editor-step-analyze-actions-remove');
        await act(async () => {});
        expect(draft.blocks.map((block) => block.id)).toEqual(['implement']);

        await screen.update(React.createElement(harness.WorkflowEditorBody, {
            draft,
            onChange: (next: WorkflowEditorDraft) => { draft = next as typeof draft; },
            machineName: 'Mac Studio',
            composerScope: MACHINE_COMPOSER_SCOPE,
            selectedBlockId: null,
            onSelectBlock: () => {},
            onCustomizeBlock: () => {},
            view: 'steps',
            onChangeView: () => {},
        } as never));

        expect(screen.getTextContent()).toContain('workflows.editor.removedBlock');
        await screen.pressByTestIdAsync('workflow-editor-undo-removal');
        // Restored at its original position, not appended to the end.
        expect(draft.blocks.map((block) => block.id)).toEqual(['analyze', 'implement']);
    });

    it('announces the first blocking validation issue exactly once', async () => {
        const harness = await loadHarness();
        const screen = await renderBody(harness);
        announceSpy.mockClear();
        await screen.update(React.createElement(harness.WorkflowEditorBody, {
            draft: buildDraft(harness, { text: '' }),
            onChange: () => {},
            machineName: 'Mac Studio',
            composerScope: MACHINE_COMPOSER_SCOPE,
            selectedBlockId: null,
            onSelectBlock: () => {},
            onCustomizeBlock: () => {},
            view: 'steps',
            onChangeView: () => {},
        } as never));
        expect(announceSpy).toHaveBeenCalledTimes(1);
    });
});
