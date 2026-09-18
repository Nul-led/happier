import * as React from 'react';
import { View } from 'react-native';

import type { AuthoringComposerScope } from '@/components/sessions/authoring/ScopedAuthoringComposer';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import type {
    WorkflowBlock,
    WorkflowEvaluatorHistoryMode,
    WorkflowFailurePolicy,
    WorkflowItemExecutionMode,
    WorkflowRepetition,
    WorkflowStep,
} from '@happier-dev/protocol/workflows/workflowV1';

import type { WorkflowDraftValidation } from '@/sync/domains/workflows/workflowAuthoring';
import {
    collectWorkflowBlockIds,
    createWorkflowBlock,
    createWorkflowBlockId,
    createWorkflowParallelBranch,
    insertWorkflowBlock,
    moveWorkflowBlock,
    removeWorkflowBlock,
    resolveSelectionAfterRemoval,
    updateWorkflowBlock,
    type WorkflowBlockKind,
    type WorkflowBlockListRef,
    type WorkflowBlockRemoval,
    type WorkflowEditorDraft,
} from '@/sync/domains/workflows/workflowEditorDraft';

import { WorkflowAddBlockMenu } from './WorkflowAddBlockMenu';
import type { WorkflowBlockAction } from './WorkflowBlockActionsMenu';
import { WorkflowGroupEditor } from './WorkflowGroupEditor';
import { WorkflowLoopEditor } from './WorkflowLoopEditor';
import { WorkflowStepEditor } from './WorkflowStepEditor';
import { WorkflowConditionEditor } from './WorkflowConditionEditor';
import { WorkflowValueReferenceEditor } from './WorkflowStepDataEditor';
import { WorkflowBlockActionsMenu } from './WorkflowBlockActionsMenu';
import { workflowEditorStyles } from './workflowEditorStyles';

/**
 * The one recursive ordered block list.
 *
 * Root, parallel branches, loop bodies and conditional branches all render
 * through this component, so there is exactly one insertion, reorder, removal
 * and selection model rather than four editor implementations. It is fully
 * controlled: it holds no draft state and every mutation goes back out through
 * `onChange`.
 */

export type WorkflowBlockListEditorProps = Readonly<{
    draft: WorkflowEditorDraft;
    list: WorkflowBlockListRef;
    blocks: readonly WorkflowBlock[];
    depth: number;
    selectedBlockId: string | null;
    validation: WorkflowDraftValidation;
    /**
     * Where every prompt in this list addresses reference search, file search
     * and portable attachment pickers: a captured Session, or the exact Machine
     * and project folder the workflow already selected.
     */
    composerScope: AuthoringComposerScope;
    onChange: (next: WorkflowEditorDraft) => void;
    onSelect: (blockId: string | null) => void;
    onCustomize: (blockId: string) => void;
    registerPromptRef?: (blockId: string, focus: (() => void) | null) => void;
    requestPromptFocus?: (blockId: string) => void;
    /**
     * Reports an exact removal so the page can offer an in-place Undo.
     *
     * The coordinate travels, not a whole-draft snapshot: restoring therefore
     * composes with anything edited afterwards instead of reverting it. Nested
     * lists inherit this through the same props spread, so one Undo owner
     * serves every depth.
     */
    onBlockRemoved?: (removal: WorkflowBlockRemoval) => void;
    /** Names the scope for the Add control's accessible hint. */
    scopeLabel?: string;
    testIDPrefix?: string;
}>;

function describeBlock(block: WorkflowBlock, ordinal: number): string {
    switch (block.kind) {
        case 'step':
            return t('workflows.editor.unnamedStep', { position: ordinal });
        case 'parallel':
            return t('workflows.editor.unnamedParallel');
        case 'loop':
            return t('workflows.editor.unnamedLoop');
        case 'if':
            return t('workflows.editor.unnamedIf');
    }
}

function repetitionForMode(
    kind: WorkflowRepetition['kind'],
    current: WorkflowRepetition,
    takenIds: ReadonlySet<string>,
): WorkflowRepetition {
    if (kind === current.kind) return current;
    switch (kind) {
        case 'count':
            return { kind: 'count', count: { kind: 'literal', value: 2 } };
        case 'items':
            // Current writers always emit item execution and failure policy
            // explicitly; only the documented legacy ingress may omit them.
            return {
                kind: 'items',
                items: { kind: 'literal', value: [] },
                execution: 'sequential',
                failurePolicy: 'fail_stop',
            };
        case 'until':
            return {
                kind: 'until',
                maxIterations: 3,
                stopWhen: { kind: 'exists', value: { kind: 'literal', value: true } },
            };
        case 'evaluate':
            return {
                kind: 'evaluate',
                maxIterations: 3,
                history: 'latest',
                evaluator: {
                    kind: 'step',
                    id: createWorkflowBlockId('evaluator', takenIds),
                    document: { text: '', references: [], attachments: [] },
                    input: [],
                    result: { kind: 'decision', decisions: ['continue', 'stop'] },
                },
            };
    }
}

export function WorkflowBlockListEditor(props: WorkflowBlockListEditorProps): React.ReactElement {
    const {
        draft, list, blocks, depth, selectedBlockId, validation,
        onChange, onSelect, onCustomize, registerPromptRef, requestPromptFocus,
    } = props;
    const testIDPrefix = props.testIDPrefix ?? 'workflow-editor';
    const scopeLabel = props.scopeLabel ?? t('workflows.a11y.blockList');
    const composerScope = React.useMemo<AuthoringComposerScope>(() => (
        props.composerScope.kind === 'session'
            ? {
                kind: 'session',
                sessionId: props.composerScope.sessionId,
                ...(props.composerScope.serverId === undefined
                    ? {}
                    : { serverId: props.composerScope.serverId }),
            }
            : {
                kind: 'machine',
                machineId: props.composerScope.machineId,
                ...(props.composerScope.serverId === undefined
                    ? {}
                    : { serverId: props.composerScope.serverId }),
                ...(props.composerScope.directory === undefined
                    ? {}
                    : { directory: props.composerScope.directory }),
                ...(props.composerScope.machineHomeDir === undefined
                    ? {}
                    : { machineHomeDir: props.composerScope.machineHomeDir }),
            }
    ), [
        props.composerScope.kind,
        props.composerScope.serverId,
        props.composerScope.kind === 'session' ? props.composerScope.sessionId : props.composerScope.machineId,
        props.composerScope.kind === 'machine' ? props.composerScope.directory : undefined,
        props.composerScope.kind === 'machine' ? props.composerScope.machineHomeDir : undefined,
    ]);

    const addBlock = React.useCallback((kind: WorkflowBlockKind, afterBlockId?: string) => {
        const block = createWorkflowBlock(kind, collectWorkflowBlockIds(draft));
        onChange(insertWorkflowBlock(draft, {
            list,
            block,
            ...(afterBlockId === undefined ? {} : { afterBlockId }),
        }));
        onSelect(block.id);
        requestPromptFocus?.(block.id);
    }, [draft, list, onChange, onSelect, requestPromptFocus]);

    const buildActions = React.useCallback((block: WorkflowBlock, index: number): readonly WorkflowBlockAction[] => {
        const actions: WorkflowBlockAction[] = [];
        if (index > 0) {
            actions.push({
                id: 'moveUp',
                label: t('workflows.editor.moveUp'),
                onSelect: () => onChange(moveWorkflowBlock(draft, block.id, 'up')),
            });
            const previous = blocks[index - 1];
            if (previous !== undefined && previous.kind !== 'step') {
                actions.push({
                    id: 'moveIn',
                    label: t('workflows.editor.moveIn'),
                    onSelect: () => onChange(moveWorkflowBlock(draft, block.id, 'in')),
                });
            }
        }
        if (index < blocks.length - 1) {
            actions.push({
                id: 'moveDown',
                label: t('workflows.editor.moveDown'),
                onSelect: () => onChange(moveWorkflowBlock(draft, block.id, 'down')),
            });
        }
        if (list.kind !== 'root') {
            actions.push({
                id: 'moveOut',
                label: t('workflows.editor.moveOut'),
                onSelect: () => onChange(moveWorkflowBlock(draft, block.id, 'out')),
            });
        }
        actions.push({
            id: 'remove',
            label: t('workflows.editor.remove'),
            destructive: true,
            onSelect: () => {
                // Focus moves to a surviving meaningful control before the row
                // disappears, so assistive technology is never left on nothing.
                const survivor = resolveSelectionAfterRemoval({
                    draftBeforeRemoval: draft,
                    removedBlockId: block.id,
                });
                onSelect(survivor);
                if (survivor !== null) requestPromptFocus?.(survivor);
                const removal = removeWorkflowBlock(draft, block.id);
                onChange(removal.draft);
                if (removal.removal !== null) props.onBlockRemoved?.(removal.removal);
            },
        });
        return actions;
    }, [blocks, draft, list.kind, onChange, onSelect, props.onBlockRemoved, requestPromptFocus]);

    return (
        <View
            testID={`${testIDPrefix}-list-${list.kind}`}
            accessibilityRole="list"
            accessibilityLabel={scopeLabel}
            style={depth === 0 ? workflowEditorStyles.blockList : workflowEditorStyles.nestedList}
        >
            {blocks.map((block, index) => {
                const ordinal = index + 1;
                const selected = selectedBlockId === block.id;
                const actions = buildActions(block, index);

                return (
                    <View
                        key={block.id}
                        accessibilityRole="none"
                        style={depth === 0 ? undefined : workflowEditorStyles.railRow}
                    >
                        {depth === 0 ? null : (
                            <View
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                style={[
                                    workflowEditorStyles.rail,
                                    selected ? workflowEditorStyles.railSelected : null,
                                ]}
                            />
                        )}
                        {block.kind === 'step' ? (
                            <WorkflowStepEditor
                                draft={draft}
                                step={block}
                                ordinal={ordinal}
                                total={blocks.length}
                                composerScope={composerScope}
                                validation={validation}
                                actions={actions}
                                onSelect={() => onSelect(block.id)}
                                onChangeDocument={(document) => onChange(updateWorkflowBlock(
                                    draft,
                                    block.id,
                                    (current) => current.kind === 'step' ? { ...current, document } : current,
                                ))}
                                onCustomize={() => onCustomize(block.id)}
                                onChangeInput={(input) => onChange(updateWorkflowBlock(draft, block.id, (current) => (
                                    current.kind === 'step' ? { ...current, input: [...input] } : current
                                )))}
                                onChangeResult={(result) => onChange(updateWorkflowBlock(draft, block.id, (current) => (
                                    current.kind === 'step' ? { ...current, result } : current
                                )))}
                                {...(registerPromptRef === undefined ? {} : { registerPromptRef })}
                                testIDPrefix={testIDPrefix}
                            />
                        ) : null}

                        {block.kind === 'parallel' ? (
                            <WorkflowGroupEditor
                                block={block}
                                ordinal={ordinal}
                                actions={actions}
                                onSelect={() => onSelect(block.id)}
                                onChangeFailurePolicy={(failurePolicy: WorkflowFailurePolicy) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => (
                                        current.kind === 'parallel' ? { ...current, failurePolicy } : current
                                    )),
                                )}
                                onChangeMaxConcurrent={(maxConcurrent) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => {
                                        if (current.kind !== 'parallel') return current;
                                        if (maxConcurrent === undefined) {
                                            const { maxConcurrent: _dropped, ...rest } = current;
                                            return rest;
                                        }
                                        return { ...current, maxConcurrent };
                                    }),
                                )}
                                onAddBranch={() => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => (
                                        current.kind === 'parallel'
                                            ? {
                                                ...current,
                                                branches: [
                                                    ...current.branches,
                                                    createWorkflowParallelBranch(collectWorkflowBlockIds(draft)),
                                                ],
                                            }
                                            : current
                                    )),
                                )}
                                onRemoveBranch={(branchId) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => current.kind !== 'parallel'
                                        || current.branches.length <= 1
                                        ? current
                                        : { ...current, branches: current.branches.filter((branch) => branch.id !== branchId) }),
                                )}
                                renderBranch={(branch, branchIndex) => (
                                    <WorkflowBlockListEditor
                                        {...props}
                                        list={{ kind: 'parallelBranch', parallelId: block.id, branchId: branch.id }}
                                        blocks={branch.blocks}
                                        depth={depth + 1}
                                        scopeLabel={`${t('workflows.editor.branch')} ${branchIndex + 1}`}
                                    />
                                )}
                                testIDPrefix={testIDPrefix}
                            />
                        ) : null}

                        {block.kind === 'loop' ? (
                            <WorkflowLoopEditor
                                block={block}
                                ordinal={ordinal}
                                actions={actions}
                                onSelect={() => onSelect(block.id)}
                                onChangeMode={(kind) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => (
                                        current.kind === 'loop'
                                            ? {
                                                ...current,
                                                repetition: repetitionForMode(
                                                    kind,
                                                    current.repetition,
                                                    collectWorkflowBlockIds(draft),
                                                ),
                                            }
                                            : current
                                    )),
                                )}
                                onChangeItemExecution={(execution: WorkflowItemExecutionMode) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => {
                                        if (current.kind !== 'loop' || current.repetition.kind !== 'items') return current;
                                        // Concurrency is a parallel-only authored value; switching back to
                                        // sequential drops it rather than leaving an inert number behind.
                                        const { maxConcurrent, ...rest } = current.repetition;
                                        return execution === 'parallel'
                                            ? {
                                                ...current,
                                                repetition: {
                                                    ...rest,
                                                    execution,
                                                    ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
                                                },
                                            }
                                            : { ...current, repetition: { ...rest, execution } };
                                    }),
                                )}
                                onChangeItemFailurePolicy={(failurePolicy: WorkflowFailurePolicy) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => (
                                        current.kind === 'loop' && current.repetition.kind === 'items'
                                            ? { ...current, repetition: { ...current.repetition, failurePolicy } }
                                            : current
                                    )),
                                )}
                                onChangeMaxConcurrent={(maxConcurrent) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => {
                                        if (current.kind !== 'loop' || current.repetition.kind !== 'items') return current;
                                        if (maxConcurrent === undefined) {
                                            const { maxConcurrent: _dropped, ...rest } = current.repetition;
                                            return { ...current, repetition: rest };
                                        }
                                        return { ...current, repetition: { ...current.repetition, maxConcurrent } };
                                    }),
                                )}
                                onChangeMaxIterations={(maxIterations) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => (
                                        current.kind === 'loop'
                                            && (current.repetition.kind === 'until' || current.repetition.kind === 'evaluate')
                                            ? { ...current, repetition: { ...current.repetition, maxIterations } }
                                            : current
                                    )),
                                )}
                                onChangeEvaluatorHistory={(history: WorkflowEvaluatorHistoryMode) => onChange(
                                    updateWorkflowBlock(draft, block.id, (current) => (
                                        current.kind === 'loop' && current.repetition.kind === 'evaluate'
                                            ? { ...current, repetition: { ...current.repetition, history } }
                                            : current
                                    )),
                                )}
                                renderCount={(count) => (
                                    <WorkflowValueReferenceEditor
                                        reference={count}
                                        index={0}
                                        draft={draft}
                                        stepId={block.id}
                                        onChange={(next) => onChange(updateWorkflowBlock(draft, block.id, (current) => (
                                            current.kind === 'loop' && current.repetition.kind === 'count'
                                                ? { ...current, repetition: { ...current.repetition, count: next } }
                                                : current
                                        )))}
                                        testIDPrefix={`${testIDPrefix}-loop-${block.id}-count`}
                                    />
                                )}
                                renderItems={(items) => (
                                    <WorkflowValueReferenceEditor
                                        reference={items}
                                        index={0}
                                        draft={draft}
                                        stepId={block.id}
                                        onChange={(next) => onChange(updateWorkflowBlock(draft, block.id, (current) => (
                                            current.kind === 'loop' && current.repetition.kind === 'items'
                                                ? { ...current, repetition: { ...current.repetition, items: next } }
                                                : current
                                        )))}
                                        testIDPrefix={`${testIDPrefix}-loop-${block.id}-items-source`}
                                    />
                                )}
                                renderBody={() => (
                                    <WorkflowBlockListEditor
                                        {...props}
                                        list={{ kind: 'loopBody', loopId: block.id }}
                                        blocks={block.body}
                                        depth={depth + 1}
                                        scopeLabel={t('workflows.editor.loopBody')}
                                    />
                                )}
                                renderContinuation={block.repetition.kind === 'evaluate'
                                    ? () => (
                                        <WorkflowStepEditor
                                            draft={draft}
                                            step={(block.repetition as Extract<WorkflowRepetition, { kind: 'evaluate' }>).evaluator}
                                            ordinal={block.body.length + 1}
                                            total={block.body.length + 1}
                                            composerScope={composerScope}
                                            validation={validation}
                                            actions={[]}
                                            onSelect={() => onSelect((block.repetition as Extract<WorkflowRepetition, { kind: 'evaluate' }>).evaluator.id)}
                                            onChangeDocument={(document) => onChange(updateWorkflowBlock(
                                                draft,
                                                (block.repetition as Extract<WorkflowRepetition, { kind: 'evaluate' }>).evaluator.id,
                                                (current) => (current.kind === 'step'
                                                    ? { ...current, document }
                                                    : current),
                                            ))}
                                            onCustomize={() => onCustomize(
                                                (block.repetition as Extract<WorkflowRepetition, { kind: 'evaluate' }>).evaluator.id,
                                            )}
                                            onChangeInput={(input) => onChange(updateWorkflowBlock(
                                                draft,
                                                (block.repetition as Extract<WorkflowRepetition, { kind: 'evaluate' }>).evaluator.id,
                                                (current) => current.kind === 'step' ? { ...current, input: [...input] } : current,
                                            ))}
                                            onChangeResult={(result) => onChange(updateWorkflowBlock(
                                                draft,
                                                (block.repetition as Extract<WorkflowRepetition, { kind: 'evaluate' }>).evaluator.id,
                                                (current) => current.kind === 'step' ? { ...current, result } : current,
                                            ))}
                                            {...(registerPromptRef === undefined ? {} : { registerPromptRef })}
                                            testIDPrefix={testIDPrefix}
                                        />
                                    )
                                    : undefined}
                                testIDPrefix={testIDPrefix}
                            />
                        ) : null}

                        {block.kind === 'if' ? (
                            <View testID={`${testIDPrefix}-if-${block.id}`} style={workflowEditorStyles.blockBody}>
                                <View style={workflowEditorStyles.heading}>
                                    <Text style={workflowEditorStyles.ordinal} accessibilityElementsHidden>
                                        {t('workflows.editor.stepOrdinal', { position: ordinal })}
                                    </Text>
                                    <Text
                                        testID={`${testIDPrefix}-if-${block.id}-label`}
                                        style={workflowEditorStyles.headingNameInput}
                                        onPress={() => onSelect(block.id)}
                                    >
                                        {`${describeBlock(block, ordinal)} ${ordinal}`}
                                    </Text>
                                    <View style={workflowEditorStyles.headingActions}>
                                        <WorkflowBlockActionsMenu
                                            blockLabel={describeBlock(block, ordinal)}
                                            actions={actions}
                                            testID={`${testIDPrefix}-if-${block.id}-actions`}
                                        />
                                    </View>
                                </View>
                                <Text style={workflowEditorStyles.branchLabel}>
                                    {t('workflows.editor.ifTrue')}
                                </Text>
                                <WorkflowBlockListEditor
                                    {...props}
                                    list={{ kind: 'ifThen', ifId: block.id }}
                                    blocks={block.then}
                                    depth={depth + 1}
                                    scopeLabel={t('workflows.editor.ifTrue')}
                                />
                                <Text style={workflowEditorStyles.branchLabel}>
                                    {t('workflows.editor.otherwise')}
                                </Text>
                                <WorkflowBlockListEditor
                                    {...props}
                                    list={{ kind: 'ifOtherwise', ifId: block.id }}
                                    blocks={block.otherwise}
                                    depth={depth + 1}
                                    scopeLabel={t('workflows.editor.otherwise')}
                                />
                            </View>
                        ) : null}

                        <WorkflowConditionEditor
                            label={block.kind === 'if'
                                ? t('workflows.condition.ifWhen')
                                : t('workflows.condition.onlyWhen')}
                            condition={block.kind === 'if' ? block.when : block.onlyWhen}
                            draft={draft}
                            consumerBlockId={block.id}
                            required={block.kind === 'if'}
                            onChange={(condition) => onChange(updateWorkflowBlock(draft, block.id, (current) => {
                                if (current.kind === 'if') return condition === undefined ? current : { ...current, when: condition };
                                if (condition === undefined) {
                                    const { onlyWhen: _removed, ...rest } = current;
                                    return rest;
                                }
                                return { ...current, onlyWhen: condition };
                            }))}
                            testIDPrefix={`${testIDPrefix}-${block.kind}-${block.id}-condition`}
                        />

                        {block.kind === 'loop' && block.repetition.kind === 'until' ? (
                            <WorkflowConditionEditor
                                label={t('workflows.condition.stopWhen')}
                                condition={block.repetition.stopWhen}
                                draft={draft}
                                consumerBlockId={block.id}
                                // Evaluated after each round, inside the body scope.
                                continuation
                                required
                                onChange={(condition) => {
                                    if (condition === undefined) return;
                                    onChange(updateWorkflowBlock(draft, block.id, (current) => (
                                        current.kind === 'loop' && current.repetition.kind === 'until'
                                            ? { ...current, repetition: { ...current.repetition, stopWhen: condition } }
                                            : current
                                    )));
                                }}
                                testIDPrefix={`${testIDPrefix}-loop-${block.id}-stop-condition`}
                            />
                        ) : null}
                    </View>
                );
            })}

            <WorkflowAddBlockMenu
                onAdd={(kind) => addBlock(kind, blocks[blocks.length - 1]?.id)}
                scopeLabel={scopeLabel}
                testID={`${testIDPrefix}-add-${list.kind}`}
            />
        </View>
    );
}
