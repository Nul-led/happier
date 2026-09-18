import * as React from 'react';
import { Pressable, View } from 'react-native';

import type { WorkflowConversationSelection } from '@happier-dev/protocol/workflows/workflowReferenceV1';
import type { WorkflowWorkspaceSelection } from '@happier-dev/protocol/workflows/workflowWorkspaceV1';

import { SelectionList, type SelectionListStep } from '@/components/ui/selectionList';
import { Text } from '@/components/ui/text/Text';
import {
    listWorkflowProducerOptions,
    type WorkflowExistingSessionOption,
} from '@/sync/domains/workflows/workflowAuthoring';
import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';
import { t } from '@/text';

import { workflowEditorStyles } from './workflowEditorStyles';

/**
 * The step's conversation and workspace continuity, authored as the canonical
 * selection vocabulary. Both are separate from dataflow: continuing a
 * conversation never implies reusing a workspace, and sharing a workspace
 * never implies sharing history.
 *
 * An existing Session is chosen through the same `SelectionList` the
 * Automation trigger editor uses to pick a Session, from options the host
 * projects through its canonical Session candidacy and machine owners. The
 * editor never lists Sessions itself and never fabricates a Session id.
 */

const NO_EXISTING_SESSIONS: readonly WorkflowExistingSessionOption[] = [];

export function WorkflowContinuityControls(props: Readonly<{
    draft: WorkflowEditorDraft;
    consumerBlockId?: string;
    conversation: WorkflowConversationSelection | undefined;
    workspace: WorkflowWorkspaceSelection | undefined;
    /** Existing Sessions the host offers for continuation; absent means none can be offered here. */
    existingSessions?: readonly WorkflowExistingSessionOption[];
    onChangeConversation: (value: WorkflowConversationSelection | undefined) => void;
    onChangeWorkspace: (value: WorkflowWorkspaceSelection | undefined) => void;
    testIDPrefix: string;
}>): React.ReactElement {
    const { onChangeConversation } = props;
    const producers = props.consumerBlockId === undefined
        ? []
        : listWorkflowProducerOptions(props.draft, props.consumerBlockId);
    const firstProducer = producers[0];
    const conversationKind = props.conversation?.kind ?? 'shared_run';
    const workspaceKind = props.workspace?.kind ?? 'inherit';
    const newWorktreeSource = props.workspace?.kind === 'new_worktree'
        ? props.workspace.source
        : undefined;

    const existingSessions = props.existingSessions ?? NO_EXISTING_SESSIONS;
    const existingSession = props.conversation?.kind === 'existing_session' ? props.conversation : null;
    const selectedExistingSession = existingSession === null
        ? null
        : existingSessions.find((option) => option.sessionId === existingSession.sessionId) ?? null;
    // Choosing "an existing session" needs a Session before it is a selection,
    // so the radio opens the picker; the selection is authored when a row is
    // chosen and the picker closes. Change reopens it for a recorded choice.
    const [choosingSession, setChoosingSession] = React.useState(false);
    const existingSessionStep = React.useMemo<SelectionListStep>(() => ({
        id: `${props.testIDPrefix}-conversation-existing-session`,
        inputPlaceholder: t('sessionsList.searchSessionsPlaceholder'),
        sections: [{
            kind: 'static',
            id: 'sessions',
            options: existingSessions.map((option) => ({
                id: option.sessionId,
                label: option.label,
                testID: `${props.testIDPrefix}-conversation-session-${option.sessionId}`,
            })),
        }],
    }), [existingSessions, props.testIDPrefix]);
    const selectExistingSession = React.useCallback((sessionId: string) => {
        const option = existingSessions.find((candidate) => candidate.sessionId === sessionId);
        if (option === undefined) return;
        onChangeConversation({ kind: 'existing_session', sessionId: option.sessionId, machineId: option.machineId });
        setChoosingSession(false);
    }, [existingSessions, onChangeConversation]);
    const existingSessionOffered = existingSessions.length > 0;
    const existingSessionLabel = existingSession === null
        ? null
        : selectedExistingSession?.label
            // A recorded Session this host cannot list (imported, or no longer
            // offered here) stays visible by its exact identity, never hidden.
            ?? t('workflows.conversation.existingSessionById', { sessionId: existingSession.sessionId });

    return (
        <View>
            <View style={workflowEditorStyles.metaRow} accessibilityRole="radiogroup">
                <Text style={workflowEditorStyles.metaText}>{t('workflows.conversation.title')}</Text>
                <Pressable
                    testID={`${props.testIDPrefix}-conversation-shared`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: conversationKind === 'shared_run' }}
                    onPress={() => props.onChangeConversation({ kind: 'shared_run' })}
                    style={workflowEditorStyles.actionTarget}
                ><Text style={conversationKind === 'shared_run' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.conversation.sharedRun')}</Text></Pressable>
                <Pressable
                    testID={`${props.testIDPrefix}-conversation-fresh`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: conversationKind === 'fresh' }}
                    onPress={() => props.onChangeConversation({ kind: 'fresh' })}
                    style={workflowEditorStyles.actionTarget}
                ><Text style={conversationKind === 'fresh' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.conversation.fresh')}</Text></Pressable>
                {firstProducer === undefined ? null : (
                    <Pressable
                        testID={`${props.testIDPrefix}-conversation-from-step`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: conversationKind === 'from_step' }}
                        onPress={() => props.onChangeConversation({
                            kind: 'from_step',
                            producer: { blockId: firstProducer.blockId, scope: firstProducer.scope },
                        })}
                        style={workflowEditorStyles.actionTarget}
                    ><Text style={conversationKind === 'from_step' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.conversation.fromStep', { block: firstProducer.label })}</Text></Pressable>
                )}
                {conversationKind !== 'from_step' ? null : producers.map((producer) => (
                    <Pressable
                        key={`conversation-${producer.blockId}-${JSON.stringify(producer.scope)}`}
                        testID={`${props.testIDPrefix}-conversation-producer-${producer.blockId}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: props.conversation?.kind === 'from_step'
                            && props.conversation.producer.blockId === producer.blockId
                            && JSON.stringify(props.conversation.producer.scope) === JSON.stringify(producer.scope) }}
                        onPress={() => props.onChangeConversation({
                            kind: 'from_step', producer: { blockId: producer.blockId, scope: producer.scope },
                        })}
                        style={workflowEditorStyles.actionTarget}
                    ><Text style={props.conversation?.kind === 'from_step'
                        && props.conversation.producer.blockId === producer.blockId
                        ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{producer.label}</Text></Pressable>
                ))}
                <Pressable
                    testID={`${props.testIDPrefix}-conversation-existing`}
                    accessibilityRole="radio"
                    accessibilityLabel={t('workflows.conversation.existingSession')}
                    accessibilityState={{
                        selected: conversationKind === 'existing_session',
                        ...(existingSessionOffered ? {} : { disabled: true }),
                    }}
                    // The reason reaches assistive technology on the control
                    // itself, not only as nearby text.
                    {...(existingSessionOffered
                        ? {}
                        : { accessibilityHint: t('workflows.conversation.noExistingSessions') })}
                    disabled={!existingSessionOffered}
                    onPress={() => setChoosingSession(true)}
                    style={workflowEditorStyles.actionTarget}
                ><Text style={conversationKind === 'existing_session' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.conversation.existingSession')}</Text></Pressable>
                {existingSessionLabel === null ? null : (
                    <Text
                        testID={`${props.testIDPrefix}-conversation-existing-selected`}
                        style={workflowEditorStyles.metaText}
                    >{existingSessionLabel}</Text>
                )}
            </View>
            {existingSessionOffered ? null : (
                <Text
                    testID={`${props.testIDPrefix}-conversation-existing-unavailable`}
                    style={workflowEditorStyles.groupSummary}
                >{t('workflows.conversation.noExistingSessions')}</Text>
            )}
            {choosingSession && existingSessionOffered ? (
                <SelectionList
                    testID={`${props.testIDPrefix}-conversation-session-picker`}
                    rootStep={existingSessionStep}
                    selectedOptionId={existingSession?.sessionId ?? null}
                    listAccessibilityLabel={t('workflows.conversation.chooseExistingSession')}
                    onSelect={(sessionId) => selectExistingSession(sessionId)}
                    onRequestClose={() => setChoosingSession(false)}
                    autoFocusInputOnWeb
                    maxHeight={360}
                    heightBehavior="stabilizedContentHeight"
                />
            ) : null}
            <View style={workflowEditorStyles.metaRow} accessibilityRole="radiogroup">
                <Text style={workflowEditorStyles.metaText}>{t('workflows.workspace.title')}</Text>
                <Pressable
                    testID={`${props.testIDPrefix}-workspace-inherit`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: workspaceKind === 'inherit' }}
                    onPress={() => props.onChangeWorkspace({ kind: 'inherit' })}
                    style={workflowEditorStyles.actionTarget}
                ><Text style={workspaceKind === 'inherit' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.workspace.inherit')}</Text></Pressable>
                <Pressable
                    testID={`${props.testIDPrefix}-workspace-project`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: workspaceKind === 'project_checkout' }}
                    onPress={() => props.onChangeWorkspace({ kind: 'project_checkout' })}
                    style={workflowEditorStyles.actionTarget}
                ><Text style={workspaceKind === 'project_checkout' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.workspace.projectCheckout')}</Text></Pressable>
                {firstProducer === undefined ? null : (
                    <Pressable
                        testID={`${props.testIDPrefix}-workspace-from-step`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: workspaceKind === 'from_step' }}
                        onPress={() => props.onChangeWorkspace({
                            kind: 'from_step',
                            producer: { blockId: firstProducer.blockId, scope: firstProducer.scope },
                        })}
                        style={workflowEditorStyles.actionTarget}
                    ><Text style={workspaceKind === 'from_step' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.workspace.fromStep', { block: firstProducer.label })}</Text></Pressable>
                )}
                {workspaceKind !== 'from_step' ? null : producers.map((producer) => (
                    <Pressable
                        key={`workspace-${producer.blockId}-${JSON.stringify(producer.scope)}`}
                        testID={`${props.testIDPrefix}-workspace-producer-${producer.blockId}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: props.workspace?.kind === 'from_step'
                            && props.workspace.producer.blockId === producer.blockId
                            && JSON.stringify(props.workspace.producer.scope) === JSON.stringify(producer.scope) }}
                        onPress={() => props.onChangeWorkspace({
                            kind: 'from_step', producer: { blockId: producer.blockId, scope: producer.scope },
                        })}
                        style={workflowEditorStyles.actionTarget}
                    ><Text style={props.workspace?.kind === 'from_step'
                        && props.workspace.producer.blockId === producer.blockId
                        ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{producer.label}</Text></Pressable>
                ))}
                <Pressable
                    testID={`${props.testIDPrefix}-workspace-worktree`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: workspaceKind === 'new_worktree' }}
                    onPress={() => props.onChangeWorkspace({ kind: 'new_worktree', source: { kind: 'original' } })}
                    style={workflowEditorStyles.actionTarget}
                ><Text style={workspaceKind === 'new_worktree' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.workspace.newWorktreeOriginal')}</Text></Pressable>
            </View>
            {newWorktreeSource === undefined ? null : (
                <View style={workflowEditorStyles.metaRow} accessibilityRole="radiogroup">
                    <Pressable accessibilityRole="radio" accessibilityState={{ selected: newWorktreeSource.kind === 'original' }}
                        onPress={() => props.onChangeWorkspace({ kind: 'new_worktree', source: { kind: 'original' } })} style={workflowEditorStyles.actionTarget}>
                        <Text style={newWorktreeSource.kind === 'original' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.workspace.newWorktreeOriginal')}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="radio" accessibilityState={{ selected: newWorktreeSource.kind === 'workflow' }}
                        onPress={() => props.onChangeWorkspace({ kind: 'new_worktree', source: { kind: 'workflow' } })} style={workflowEditorStyles.actionTarget}>
                        <Text style={newWorktreeSource.kind === 'workflow' ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.workspace.newWorktreeWorkflow')}</Text>
                    </Pressable>
                    {producers.map((producer) => (
                        <Pressable key={`worktree-${producer.blockId}-${JSON.stringify(producer.scope)}`} accessibilityRole="radio"
                            accessibilityState={{ selected: newWorktreeSource.kind === 'step'
                                && newWorktreeSource.producer.blockId === producer.blockId
                                && JSON.stringify(newWorktreeSource.producer.scope) === JSON.stringify(producer.scope) }}
                            onPress={() => props.onChangeWorkspace({ kind: 'new_worktree', source: {
                                kind: 'step', producer: { blockId: producer.blockId, scope: producer.scope },
                            } })} style={workflowEditorStyles.actionTarget}>
                            <Text style={newWorktreeSource.kind === 'step'
                                && newWorktreeSource.producer.blockId === producer.blockId
                                ? workflowEditorStyles.metaAction : workflowEditorStyles.metaText}>{t('workflows.workspace.newWorktreeStep', { block: producer.label })}</Text>
                        </Pressable>
                    ))}
                    <Text style={workflowEditorStyles.groupSummary}>{t('workflows.workspace.committedOnlyNote')}</Text>
                </View>
            )}
        </View>
    );
}
