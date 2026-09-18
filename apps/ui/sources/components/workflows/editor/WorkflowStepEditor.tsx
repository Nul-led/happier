import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import {
    ScopedAuthoringComposer,
    type AuthoringComposerScope,
    type ScopedAuthoringComposerHandle,
    type ScopedAuthoringDocument,
} from '@/components/sessions/authoring/ScopedAuthoringComposer';
import { randomUUID } from '@/platform/randomUUID';
import { t } from '@/text';

import { PluginJsonValueV2Schema } from '@happier-dev/protocol';
import type { WorkflowStep } from '@happier-dev/protocol/workflows/workflowV1';
import type { WorkflowResultContract } from '@happier-dev/protocol/workflows/workflowV1';
import type { WorkflowValueReference } from '@happier-dev/protocol/workflows/workflowReferenceV1';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import { workflowStepPromptLabel } from '@/sync/domains/workflows/workflowBlockLabel';

import {
    listWorkflowStepOverriddenFields,
    type WorkflowDraftValidation,
    workflowIssuesForBlock,
} from '@/sync/domains/workflows/workflowAuthoring';

import { WorkflowBlockActionsMenu, type WorkflowBlockAction } from './WorkflowBlockActionsMenu';
import { workflowEditorStyles } from './workflowEditorStyles';
import { WorkflowStepDataEditor } from './WorkflowStepDataEditor';

/**
 * One repeatable authored step: a stable ordinal, a prompt-derived label, the prompt,
 * and a quiet line describing whether its settings are inherited.
 *
 * The prompt is the visual centre. Inherited configuration collapses to one line
 * rather than repeating chrome on every step, and Customize reveals the same
 * controlled values without changing what the step can express.
 */

type WorkflowStepPromptFieldProps = Readonly<{
    composerRef: React.ComponentProps<typeof ScopedAuthoringComposer>['composerRef'];
    /** Where this document's references, files and attachments are addressed from. */
    composerScope: AuthoringComposerScope;
    testID: string;
    document: WorkflowStep['document'];
    accessibilityLabel: string;
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
        // carries the row's stable prompt identity for focus and assistive
        // technology; it deliberately adds no second input styling.
        <View testID={props.testID} accessibilityLabel={props.accessibilityLabel}>
            <ScopedAuthoringComposer
                ref={ref}
                composerRef={props.composerRef}
                scope={props.composerScope}
                document={props.document}
                onChangeDocument={props.onChangeDocument}
                attachmentsEnabled
                placeholder={t('workflows.editor.promptPlaceholder')}
                editable
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
    validation: WorkflowDraftValidation;
    actions: readonly WorkflowBlockAction[];
    onSelect: () => void;
    onChangeDocument: (document: WorkflowStep['document']) => void;
    onCustomize: () => void;
    onChangeInput: (input: readonly WorkflowValueReference[]) => void;
    onChangeResult: (result: WorkflowResultContract) => void;
    /** Registers the prompt input so Add can focus it once layout is ready. */
    registerPromptRef?: (blockId: string, focus: (() => void) | null) => void;
    testIDPrefix: string;
}>): React.ReactElement {
    const {
        step, ordinal, total, validation, actions,
        onSelect, onChangeDocument, onCustomize, registerPromptRef, testIDPrefix,
    } = props;

    const inputRef = React.useRef<ScopedAuthoringComposerHandle>(null);
    const [composerInstanceId] = React.useState(randomUUID);
    const composerRef = React.useMemo(() => ({
        kind: 'workflowAuthoring' as const,
        draftId: props.draft.draftId,
        blockId: step.id,
        instanceId: composerInstanceId,
    }), [composerInstanceId, props.draft.draftId, step.id]);
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
            accessible={false}
            accessibilityLabel={accessibilityLabel}
            style={workflowEditorStyles.blockBody}
        >
            <View style={workflowEditorStyles.heading}>
                <Text style={workflowEditorStyles.ordinal} accessibilityElementsHidden>
                    {t('workflows.editor.stepOrdinal', { position: ordinal })}
                </Text>
                <Text
                    testID={`${testIDPrefix}-step-${step.id}-label`}
                    style={workflowEditorStyles.headingNameInput}
                    onPress={onSelect}
                >
                    {displayName}
                </Text>
                <View style={workflowEditorStyles.headingActions}>
                    <WorkflowBlockActionsMenu
                        blockLabel={displayName}
                        actions={actions}
                        testID={`${testIDPrefix}-step-${step.id}-actions`}
                    />
                </View>
            </View>

            <View style={workflowEditorStyles.promptFrame}>
                <WorkflowStepPromptField
                    ref={inputRef}
                    composerRef={composerRef}
                    composerScope={props.composerScope}
                    testID={`${testIDPrefix}-step-${step.id}-prompt`}
                    document={step.document}
                    accessibilityLabel={accessibilityLabel}
                    onChangeDocument={handleChangeDocument}
                    onFocusPrompt={handleFocusPrompt}
                />
            </View>

            <View style={workflowEditorStyles.metaRow}>
                <Text
                    testID={`${testIDPrefix}-step-${step.id}-inheritance`}
                    style={workflowEditorStyles.metaText}
                >
                    {overriddenFields.length === 0
                        ? t('workflows.editor.usingWorkflowSettings')
                        : t('workflows.a11y.overridden')}
                </Text>
                <Pressable
                    testID={`${testIDPrefix}-step-${step.id}-customize`}
                    accessibilityRole="button"
                    accessibilityLabel={t('workflows.editor.customize')}
                    onPress={onCustomize}
                    style={workflowEditorStyles.actionTarget}
                >
                    <Text style={workflowEditorStyles.metaAction}>{t('workflows.editor.customize')}</Text>
                </Pressable>
            </View>

            <WorkflowStepDataEditor
                draft={props.draft}
                step={step}
                onChangeInput={props.onChangeInput}
                onChangeResult={props.onChangeResult}
                testIDPrefix={testIDPrefix}
            />

            {issues.map((issue) => (
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
