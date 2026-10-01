import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { HappierPressable } from '@happier-dev/plugin-ui/presentation';

import type { WorkflowBlockKind, WorkflowLeafBlockSeed } from '@happier-dev/protocol/workflows/workflowDefinitionEditV1';

import { AgentInputSelectionListPopover } from '@/components/sessions/agentInput/components/AgentInputSelectionListPopover';
import { Icon } from '@/components/ui/icons/Icon';
import type { SelectionListOption, SelectionListStep } from '@/components/ui/selectionList';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import { listWorkflowStepActionSpecs } from '@/components/workflows/presentation/workflowActionCatalog';
import {
    listBuiltinWorkflowReferenceOptions,
    useWorkflowLibraryReferenceOptions,
    type WorkflowReferenceOption,
} from '@/components/workflows/presentation/workflowReferenceOptions';
import { workflowEditorStyles, workflowPressFeedbackStyle } from './workflowEditorStyles';

/** What the Add menu asks its list to insert: a structure or Agent step by kind, or a step-kind seed. */
export type WorkflowAddBlockRequest =
    | Readonly<{ kind: WorkflowBlockKind }>
    | WorkflowLeafBlockSeed;

/**
 * One contextual Add control per block-list scope (04 §4.3, 07 S9): the step
 * kinds first — Agent step, Run a workflow ›, Action ›, Wait for you — then
 * structure — Side by side, Repeat, If. Run a workflow and Action push a
 * searchable step in the same canonical SelectionList popover.
 */
export function WorkflowAddBlockMenu(props: Readonly<{
    onAdd: (request: WorkflowAddBlockRequest) => void;
    /** Names the scope the new block joins, for the accessible label. */
    scopeLabel: string;
    /** This workflow's own reference, offered dimmed with its reason (it cannot run itself). */
    currentWorkflowRef?: string | null;
    /**
     * `row`: the end-of-list "+ Add". `inserter`: the gap between two blocks —
     * a hairline with a centred (+), revealed on hover or keyboard focus, and
     * shown on touch while a block in this list is selected (`revealed`). Both
     * open the same menu at the exact insertion position the caller binds.
     */
    variant?: 'row' | 'inserter';
    revealed?: boolean;
    testID?: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const anchorRef = React.useRef<View>(null);
    const [open, setOpen] = React.useState(false);
    const close = React.useCallback(() => setOpen(false), []);

    if (props.variant === 'inserter') {
        return (
            <View ref={anchorRef} collapsable={false}>
                <HappierPressable
                    testID={props.testID}
                    accessibilityRole="button"
                    accessibilityLabel={t('workflows.editor.addAccessibility')}
                    accessibilityHint={props.scopeLabel}
                    onPress={() => setOpen((value) => !value)}
                    expanded={open}
                    hasPopup="menu"
                    style={(state) => [
                        workflowEditorStyles.inserter,
                        open || props.revealed === true || state.hovered || state.focused
                            ? null
                            : workflowEditorStyles.inserterHidden,
                        workflowPressFeedbackStyle(state, theme.colors.border.focus),
                    ]}
                >
                    <View style={workflowEditorStyles.inserterLine} />
                    <Icon name="plus" size={14} color={theme.colors.text.secondary} />
                    <View style={workflowEditorStyles.inserterLine} />
                </HappierPressable>
                {open ? (
                    <WorkflowAddBlockMenuPopover
                        anchorRef={anchorRef}
                        onAdd={props.onAdd}
                        onClose={close}
                        {...(props.currentWorkflowRef === undefined ? {} : { currentWorkflowRef: props.currentWorkflowRef })}
                        {...(props.testID === undefined ? {} : { testID: props.testID })}
                    />
                ) : null}
            </View>
        );
    }

    return (
        <View style={workflowEditorStyles.addRow}>
            <View ref={anchorRef} collapsable={false}>
                <HappierPressable
                    testID={props.testID}
                    accessibilityRole="button"
                    accessibilityLabel={t('workflows.editor.addAccessibility')}
                    accessibilityHint={props.scopeLabel}
                    onPress={() => setOpen((value) => !value)}
                    expanded={open}
                    hasPopup="menu"
                    style={(state) => [
                        workflowEditorStyles.actionTarget,
                        workflowEditorStyles.addTrigger,
                        workflowPressFeedbackStyle(state, theme.colors.border.focus),
                    ]}
                >
                    <Icon name="plus" size={16} color={theme.colors.text.primary} />
                    <Text style={workflowEditorStyles.addLabel}>{t('workflows.editor.add')}</Text>
                </HappierPressable>
            </View>
            {open ? (
                <WorkflowAddBlockMenuPopover
                    anchorRef={anchorRef}
                    onAdd={props.onAdd}
                    onClose={close}
                    {...(props.currentWorkflowRef === undefined ? {} : { currentWorkflowRef: props.currentWorkflowRef })}
                    {...(props.testID === undefined ? {} : { testID: props.testID })}
                />
            ) : null}
        </View>
    );
}

/** The open menu: mounted only while open, so its catalog and library reads happen on demand. */
function WorkflowAddBlockMenuPopover(props: Readonly<{
    anchorRef: React.RefObject<View | null>;
    onAdd: (request: WorkflowAddBlockRequest) => void;
    onClose: () => void;
    currentWorkflowRef?: string | null;
    testID?: string;
}>): React.ReactElement {
    const libraryOptions = useWorkflowLibraryReferenceOptions();
    const { onAdd, onClose } = props;
    const rootStep = React.useMemo((): SelectionListStep => {
        const add = (request: WorkflowAddBlockRequest) => () => {
            onClose();
            onAdd(request);
        };
        const optionId = (suffix: string) => (props.testID === undefined ? suffix : `${props.testID}-${suffix}`);
        const workflowOption = (option: WorkflowReferenceOption): SelectionListOption => {
            const self = props.currentWorkflowRef !== undefined && props.currentWorkflowRef === option.ref;
            return {
                id: optionId(`workflow:${option.ref}`),
                label: option.title,
                ...(self
                    ? { subtitle: t('workflows.page.blocks.selfRef', { workflow: option.title }), disabled: true }
                    : {}),
                onSelect: add({ kind: 'workflow', workflowRef: option.ref }),
            };
        };
        const workflowsStep: SelectionListStep = {
            id: 'add-workflow',
            title: t('workflows.page.blocks.menuRun'),
            inputPlaceholder: t('workflows.page.blocks.workflowSearch'),
            sections: [
                {
                    kind: 'static',
                    id: 'builtin',
                    title: t('workflows.page.blocks.builtin'),
                    options: listBuiltinWorkflowReferenceOptions().map(workflowOption),
                },
                ...(libraryOptions.length === 0 ? [] : [{
                    kind: 'static' as const,
                    id: 'library',
                    title: t('workflows.page.blocks.libraryGroup'),
                    options: libraryOptions.map(workflowOption),
                }]),
            ],
        };
        const actionsStep: SelectionListStep = {
            id: 'add-action',
            title: t('workflows.page.blocks.menuAction'),
            inputPlaceholder: t('workflows.page.blocks.actionSearch'),
            sections: [{
                kind: 'static',
                id: 'actions',
                options: listWorkflowStepActionSpecs().map((spec) => ({
                    id: optionId(`action:${spec.id}`),
                    label: spec.title,
                    subtitle: spec.description ?? t('workflows.page.blocks.noAgentTurn'),
                    onSelect: add({ kind: 'action', actionId: spec.id }),
                })),
            }],
        };
        return {
            id: 'add-root',
            title: t('workflows.editor.add'),
            sections: [
                {
                    kind: 'static',
                    id: 'kinds',
                    options: [
                        { id: optionId('step'), label: t('workflows.editor.addStep'), onSelect: add({ kind: 'step' }) },
                        { id: optionId('workflow'), label: t('workflows.page.blocks.menuRun'), openStep: workflowsStep },
                        { id: optionId('action'), label: t('workflows.page.blocks.menuAction'), openStep: actionsStep },
                        { id: optionId('wait'), label: t('workflows.page.blocks.menuWait'), onSelect: add({ kind: 'wait' }) },
                    ],
                },
                {
                    kind: 'static',
                    id: 'structure',
                    options: [
                        { id: optionId('parallel'), label: t('workflows.editor.addParallel'), onSelect: add({ kind: 'parallel' }) },
                        { id: optionId('loop'), label: t('workflows.editor.addLoop'), onSelect: add({ kind: 'loop' }) },
                        { id: optionId('if'), label: t('workflows.editor.addIf'), onSelect: add({ kind: 'if' }) },
                    ],
                },
            ],
        };
    }, [libraryOptions, onAdd, onClose, props.currentWorkflowRef, props.testID]);

    return (
        <AgentInputSelectionListPopover
            open
            anchorRef={props.anchorRef}
            rootStep={rootStep}
            onSelect={() => {
                // Each option's own `onSelect` is the action source and closes the menu.
            }}
            onRequestClose={onClose}
            maxHeightCap={480}
            {...(props.testID === undefined ? {} : { testID: `${props.testID}-menu` })}
        />
    );
}
