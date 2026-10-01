import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { HappierPressable } from '@happier-dev/plugin-ui/presentation';

import { Text } from '@/components/ui/text/Text';
import {
    ScopedAuthoringComposer,
    type AuthoringComposerScope,
    type ScopedAuthoringComposerHandle,
    type ScopedAuthoringDocument,
} from '@/components/sessions/authoring/ScopedAuthoringComposer';
import type {
    AuthoringComposerCustodyEntry,
    WorkflowAuthoringComposerCustody,
} from '@/components/sessions/authoring/authoringComposerCustody';
import { t } from '@/text';

import { PluginJsonValueV2Schema } from '@happier-dev/protocol';
import type { WorkflowStep } from '@happier-dev/protocol/workflows/workflowV1';
import type { WorkflowValueReference } from '@happier-dev/protocol/workflows/workflowReferenceV1';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import { workflowStepPromptLabel } from '@happier-dev/protocol/workflows';

import {
    listWorkflowStepOverriddenFields,
    type WorkflowDraftValidation,
    workflowIssuesForBlock,
} from '@/sync/domains/workflows/workflowAuthoring';

import type { WorkflowBlockAction } from './WorkflowBlockActionsMenu';
import { WorkflowBlockHeading } from './WorkflowBlockHeading';
import { workflowEditorStyles, workflowPressFeedbackStyle } from './workflowEditorStyles';
import { formatWorkflowConversationLabel, formatWorkflowWorkspaceLabel } from './WorkflowContinuityControls';
import { WorkflowStepDataEditor } from './WorkflowStepDataEditor';
import { WorkflowStepSessionDropZone, type WorkflowSessionDrop } from './WorkflowStepSessionDropZone';
import type { WorkflowDocumentStepSlots } from './workflowDocumentPresentation';

/**
 * One repeatable authored step: a stable ordinal, a prompt-derived label, the prompt,
 * and a quiet line describing whether its settings are inherited.
 *
 * The prompt is the visual centre. Inherited configuration collapses to one line
 * rather than repeating chrome on every step, and Customize reveals the same
 * controlled values without changing what the step can express.
 */

type WorkflowStepPromptFieldProps = Readonly<{
    custody: AuthoringComposerCustodyEntry;
    /** Where this document's references, files and attachments are addressed from. */
    composerScope: AuthoringComposerScope;
    testID: string;
    document: WorkflowStep['document'];
    accessibilityLabel: string;
    editable: boolean;
    onChangeDocument: (document: ScopedAuthoringDocument) => void;
    onFocusPrompt: () => void;
}>;

/**
 * The prompt field, isolated at the row boundary.
 *
 * Every keystroke necessarily produces a new whole draft, so the recursive list
 * and each step's chrome re-render — that is cheap. The composer is not: it
 * mounts the text engine, dictation binding and presentation registration.
 * Isolating it here means typing in one step executes exactly one composer,
 * which is what the 100-step target actually requires. Its props are the row's
 * own facts and stable handlers, so an unrelated draft change cannot invalidate
 * it.
 *
 * There is exactly one composer here, not a reduced one for neutral workflows.
 * A step authored without a captured Session still runs on an exact Machine and
 * project folder, and that scope is all the canonical composer owners need to
 * offer the same mentions, references and plugin attachments a Session-origin
 * step gets.
 */
const WorkflowStepPromptField = React.memo(React.forwardRef<
    ScopedAuthoringComposerHandle,
    WorkflowStepPromptFieldProps
>(function WorkflowStepPromptField(props, ref): React.ReactElement {
    return (
        // The canonical composer owns its own field chrome, so this wrapper only
        // carries the row's stable test identity. The step-named label goes to
        // the composer's real text input, which is what assistive technology
        // focuses; a label on this view would never be read.
        <View testID={props.testID}>
            <ScopedAuthoringComposer
                inputAccessibilityLabel={props.accessibilityLabel}
                ref={ref}
                custody={props.custody}
                scope={props.composerScope}
                document={props.document}
                onChangeDocument={props.onChangeDocument}
                attachmentsEnabled
                placeholder={t('workflows.editor.promptPlaceholder')}
                editable={props.editable}
                onFocus={props.onFocusPrompt}
            />
        </View>
    );
}));

export function WorkflowStepEditor(props: Readonly<{
    step: WorkflowStep;
    draft: WorkflowEditorDraft;
    ordinal: number;
    total: number;
    /** Where this step's references, files and attachments are addressed from. */
    composerScope: AuthoringComposerScope;
    /**
     * The host's custody of every step document in this draft.
     *
     * Placement is recursive, so a move re-parents this row and React remounts
     * it. The live document, its exact mention ranges, staged attachment bytes
     * and caret therefore belong to the host, keyed by the block, not to a
     * mount-lifetime identity minted here.
     */
    composerCustody: WorkflowAuthoringComposerCustody;
    validation: WorkflowDraftValidation;
    actions: readonly WorkflowBlockAction[];
    onSelect: () => void;
    onChangeDocument: (document: WorkflowStep['document']) => void;
    /** Opens Step options, anchored beside this step's Customize control. */
    onCustomize: (anchorRef: React.RefObject<View | null>) => void;
    onChangeInput: (input: readonly WorkflowValueReference[]) => void;
    /** Registers the prompt input so Add can focus it once layout is ready. */
    registerPromptRef?: (blockId: string, focus: (() => void) | null) => void;
    /** `false`: the reading presentation (04 §4.11) — nothing here edits. */
    editable?: boolean;
    /** A reader's per-step facts, each in its fixed place (04 §4.11). */
    slots?: WorkflowDocumentStepSlots | null;
    /** The web Session drop target's resolver and binder; absent where no drag source exists. */
    sessionDrop?: WorkflowSessionDrop;
    /** `false` keeps this step's issue text silent until a refused Run/Save reveals it. */
    revealIssues?: boolean;
    testIDPrefix: string;
}>): React.ReactElement {
    const {
        step, ordinal, total, validation, actions,
        onSelect, onChangeDocument, onCustomize, registerPromptRef, testIDPrefix,
    } = props;

    const { theme } = useUnistyles();
    const editable = props.editable !== false;
    const inputRef = React.useRef<ScopedAuthoringComposerHandle>(null);
    const customizeAnchorRef = React.useRef<View>(null);
    const custody = props.composerCustody.entryFor(step.id);
    // The prompt's handlers close over the current document through a ref, so
    // they stay referentially stable while the whole draft changes underneath.
    const latestRef = React.useRef({ step, onChangeDocument, onSelect });
    latestRef.current = { step, onChangeDocument, onSelect };
    // The composer publishes its portable document through the protocol's
    // read-only projection of the same values the saved definition owns, so the
    // authored document is rebuilt here through the canonical value schema.
    const handleChangeDocument = React.useCallback((document: ScopedAuthoringDocument) => {
        latestRef.current.onChangeDocument({
            text: document.text,
            references: [...document.references],
            attachments: document.attachments.map((attachment) => ({
                ...attachment,
                value: PluginJsonValueV2Schema.parse(attachment.value),
            })),
        });
    }, []);
    const handleFocusPrompt = React.useCallback(() => {
        latestRef.current.onSelect();
    }, []);

    React.useEffect(() => {
        registerPromptRef?.(step.id, () => inputRef.current?.focus());
        return () => registerPromptRef?.(step.id, null);
    }, [registerPromptRef, step.id]);

    const overriddenFields = listWorkflowStepOverriddenFields(step);
    // The Step options chip reads the workflow's settings or what differs
    // ("Separate conversations", "A background run", "Reviews before continuing"), D-7.
    const stepDifferences = [
        ...(step.execution?.conversation === undefined
            ? []
            : [formatWorkflowConversationLabel({ draft: props.draft, conversation: step.execution.conversation })]),
        ...(step.execution?.workspace === undefined ? [] : [formatWorkflowWorkspaceLabel(props.draft, step.execution.workspace)]),
        ...(step.execution?.executionTarget?.kind === 'detached_run' ? [t('workflows.page.sections.aBackgroundRun')] : []),
        ...(step.pauseForReview === true ? [t('workflows.page.inspector.reviewsBeforeContinuing')] : []),
        ...(overriddenFields.length === 0 ? [] : [t('workflows.a11y.overridden')]),
    ];
    const issues = workflowIssuesForBlock(validation, step.id, props.draft);
    const displayName = workflowStepPromptLabel(step)
        ?? t('workflows.editor.unnamedStep', { position: ordinal });
    const accessibilityLabel = t('workflows.a11y.stepContext', {
        block: displayName,
        position: ordinal,
        total,
    });

    return (
        <View
            testID={`${testIDPrefix}-step-${step.id}`}
            style={workflowEditorStyles.blockBody}
        >
            <WorkflowBlockHeading
                ordinal={ordinal}
                displayName={displayName}
                accessibilityLabel={accessibilityLabel}
                issue={issues[0] === undefined ? null : t(`workflows.issue.${issues[0].code}`)}
                actions={editable ? actions : []}
                accessory={props.slots?.state}
                onSelect={onSelect}
                testID={`${testIDPrefix}-step-${step.id}-label`}
                actionsTestID={`${testIDPrefix}-step-${step.id}-actions`}
            />

            {/* A Session dragged onto the step continues it here (web; J19). The
                zone always wraps the prompt so enabling it never remounts the composer. */}
            <WorkflowStepSessionDropZone
                stepId={step.id}
                {...(editable && props.sessionDrop !== undefined ? { sessionDrop: props.sessionDrop } : {})}
                testID={`${testIDPrefix}-step-${step.id}-session-drop`}
            >
                <View style={workflowEditorStyles.promptFrame}>
                    <WorkflowStepPromptField
                        ref={inputRef}
                        custody={custody}
                        composerScope={props.composerScope}
                        testID={`${testIDPrefix}-step-${step.id}-prompt`}
                        document={step.document}
                        accessibilityLabel={accessibilityLabel}
                        editable={editable}
                        onChangeDocument={handleChangeDocument}
                        onFocusPrompt={handleFocusPrompt}
                    />
                </View>
            </WorkflowStepSessionDropZone>

            {props.slots?.reviewedCard ?? null}

            {!editable ? (
                props.slots?.engineChip || props.slots?.footer ? (
                    <View style={workflowEditorStyles.metaRow}>
                        {props.slots?.engineChip ?? null}
                        {props.slots?.footer ?? null}
                    </View>
                ) : null
            ) : (
            <View style={workflowEditorStyles.metaRow}>
                <Text
                    testID={`${testIDPrefix}-step-${step.id}-inheritance`}
                    style={workflowEditorStyles.metaText}
                >
                    {stepDifferences.length === 0
                        ? t('workflows.editor.usingWorkflowSettings')
                        : stepDifferences.join(' · ')}
                </Text>
                <View ref={customizeAnchorRef} collapsable={false}>
                    <HappierPressable
                        testID={`${testIDPrefix}-step-${step.id}-customize`}
                        accessibilityRole="button"
                        accessibilityLabel={t('workflows.editor.customize')}
                        hasPopup="dialog"
                        onPress={() => onCustomize(customizeAnchorRef)}
                        style={(state) => [
                            workflowEditorStyles.actionTarget,
                            workflowPressFeedbackStyle(state, theme.colors.border.focus),
                        ]}
                    >
                        <Text style={workflowEditorStyles.metaAction}>{t('workflows.editor.customize')}</Text>
                    </HappierPressable>
                </View>
            </View>
            )}

            {editable ? (
                <WorkflowStepDataEditor
                    draft={props.draft}
                    step={step}
                    onChangeInput={props.onChangeInput}
                    testIDPrefix={testIDPrefix}
                />
            ) : null}

            {!editable || props.revealIssues === false ? null : issues.map((issue) => (
                <Text
                    key={`${issue.code}:${issue.path}`}
                    testID={`${testIDPrefix}-step-${step.id}-issue`}
                    style={workflowEditorStyles.issueText}
                >
                    {t(`workflows.issue.${issue.code}`)}
                </Text>
            ))}
        </View>
    );
}
