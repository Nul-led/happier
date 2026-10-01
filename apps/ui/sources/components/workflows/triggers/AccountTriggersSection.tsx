import * as React from 'react';
import { View } from 'react-native';
import type { TriggerTargetV1, WorkflowTriggerSetV1 } from '@happier-dev/protocol';
import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';

import { Icon } from '@/components/ui/icons/Icon';
import { CollectionListGroupLabel, CollectionNavigationRow } from '@/components/ui/lists/collection/CollectionList';
import { Modal } from '@/modal';
import { getStorage, useAllMachines } from '@/sync/domains/state/storage';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { createWorkflowTriggerChangeSelector, createWorkflowTriggerSetSelector } from '@/sync/store/domains/automations';
import {
    addWorkflowTrigger,
    listWorkflowTriggerSets,
    removeWorkflowTrigger,
    updateWorkflowTrigger,
} from '@/sync/domains/workflows/workflowTriggerActions';
import { sync } from '@/sync/sync';
import { t } from '@/text';

import { projectAccountTriggerRows, type AccountTriggerRow } from './accountTriggerRows';
import { TriggerPopover } from './TriggerPopover';
import { TriggerRow } from './TriggerRow';
import { TriggerRunsOnRow } from './TriggerRunsOnRow';
import { buildTriggerExecutionTarget, readTriggerThen, readTriggerWhen, type TriggerFormValue } from './sessionTriggerForm';
import { useTriggerThenOptions } from './useTriggerThenOptions';
import { useOpenTriggerAsWorkflow } from './useOpenTriggerAsWorkflow';

/**
 * The Account's inline trigger sets through `workflow.trigger.list {scope:'account_inline'}`, the one
 * membership the column and agents share. The Automation projection is only a change signal: when an
 * unscoped row changes (an agent wrote a trigger, a run finished) the list is read again.
 */
function useAccountTriggerSets(): Readonly<{ sets: readonly WorkflowTriggerSetV1[]; refresh: () => void }> {
    const changeSelector = React.useMemo(() => createWorkflowTriggerChangeSelector(null), []);
    const changeSignal = getStorage()(changeSelector);
    const selector = React.useMemo(() => createWorkflowTriggerSetSelector('account_inline'), []);
    const sets = getStorage()(selector);
    const [attempt, setAttempt] = React.useState(0);
    React.useEffect(() => {
        const controller = new AbortController();
        listWorkflowTriggerSets({ scope: 'account_inline' }, { signal: controller.signal })
            // The last-known rows stay; the next change signal or write reads again.
            .catch(() => undefined);
        return () => controller.abort();
    }, [attempt, changeSignal]);
    const refresh = React.useCallback(() => setAttempt((value) => value + 1), []);
    return { sets, refresh };
}

/**
 * The Workflows column's **Triggers** section (FIN 04 §3.3, F1; 07 S1, S16b): the Account's triggers
 * that hold their own steps, never a saved workflow's or a session's. A row opens the one trigger
 * popover; its writes go through `workflow.trigger.update | remove`. Absent when empty.
 */
export const AccountTriggersSection = React.memo(function AccountTriggersSection(props: Readonly<{ first?: boolean }>) {
    const { sets, refresh } = useAccountTriggerSets();
    const thenOptions = useTriggerThenOptions();
    const openTriggerAsWorkflow = useOpenTriggerAsWorkflow();
    const machines = useAllMachines();
    const rows = React.useMemo(
        () => projectAccountTriggerRows({ sets, resolveWorkflowTitle: thenOptions.resolveWorkflowTitle,
            resolveMachineTitle: (id) => getMachineDisplayName(machines.find((machine) => machine.id === id) ?? { id, absence: 'unlisted' }) }),
        [sets, thenOptions.resolveWorkflowTitle, machines],
    );
    const [open, setOpen] = React.useState<Readonly<{ automationId: string; anchor: React.RefObject<View | null> }> | null>(null);
    if (rows.length === 0) return null;
    const openSet = open === null ? undefined : sets.find((set) => set.automationId === open.automationId);
    return (
        <>
            <CollectionListGroupLabel
                testID="workflows-column:group:triggers"
                title={t('workflows.destination.sections.triggers')}
                count={rows.length}
                {...(props.first ? { first: true } : {})}
            />
            {rows.map((row) => (
                <AccountTriggerRowView
                    key={row.automationId}
                    row={row}
                    onOpen={(anchor) => {
                        const set = sets.find((candidate) => candidate.automationId === row.automationId);
                        if (set?.legacy) {
                            if (set.triggers.length === 0) {
                                void Modal.alert(t('workflows.triggers.editor.editInWorkflows'));
                                return;
                            }
                            void Modal.confirm(t('workflows.triggers.editor.editInWorkflows'), undefined, {
                                confirmText: t('workflows.triggers.popover.deleteTrigger'), destructive: true,
                            }).then(async (confirmed) => {
                                if (!confirmed) return;
                                for (const trigger of set.triggers) await removeWorkflowTrigger({ automationId: set.automationId, triggerId: trigger.id });
                                refresh();
                            }).catch((error: unknown) => {
                                refresh();
                                void Modal.alert(t('common.error'), error instanceof Error ? error.message : t('workflows.triggers.section.saveFailed'));
                            });
                            return;
                        }
                        // A set this popover cannot read back (a retained 0.2 shape the owner reports as
                        // unavailable) keeps running as it is (07 S16b).
                        if (!set || readAccountTriggerForm(set) === null) {
                            void Modal.alert(t('workflows.problem.legacyConversionUnsupported'));
                            return;
                        }
                        setOpen({ automationId: row.automationId, anchor });
                    }}
                />
            ))}
            {open === null || openSet === undefined ? null : (
                <AccountTriggerPopover
                    set={openSet}
                    anchorRef={open.anchor}
                    workflowOptions={thenOptions.workflowOptions}
                    onRequestClose={() => setOpen(null)}
                    onWritten={refresh}
                    onSaveAsWorkflow={(target) => openTriggerAsWorkflow(target, {
                        scope: 'account',
                        automationId: openSet.automationId,
                        triggerId: openSet.triggers[0]?.id ?? '',
                        expectedRevision: openSet.revision,
                    })}
                />
            )}
        </>
    );
});

function readAccountTriggerForm(set: WorkflowTriggerSetV1): Readonly<{ triggerId: string; initial: TriggerFormValue }> | null {
    const trigger = set.triggers[0];
    const when = trigger ? readTriggerWhen(trigger) : null;
    if (set.health !== 'available' || !set.target || !trigger || !when) return null;
    return { triggerId: trigger.id, initial: { when, then: readTriggerThen(set.target, set.context?.executionTarget), enabled: set.enabled && trigger.enabled } };
}

const AccountTriggerRowView = React.memo(function AccountTriggerRowView(props: Readonly<{
    row: AccountTriggerRow;
    onOpen: (anchor: React.RefObject<View | null>) => void;
}>) {
    const anchorRef = React.useRef<View>(null);
    const { row } = props;
    return (
        <View ref={anchorRef} collapsable={false}>
            {row.legacy ? (
                <TriggerRow
                    testID={`workflows-column:trigger:${row.automationId}`}
                    title={row.legacy.title}
                    qualifier={row.legacy.qualifier}
                    enabled={!row.off}
                    multiline
                    toggleDisabled
                    onToggle={() => {}}
                    onPress={() => props.onOpen(anchorRef)}
                />
            ) : <CollectionNavigationRow
                testID={`workflows-column:trigger:${row.automationId}`}
                title={row.title}
                subtitle={row.subtitle}
                icon={<Icon name="timer" />}
                {...(row.off ? { detail: t('workflows.destination.off') } : {})}
                selected={false}
                onPress={() => props.onOpen(anchorRef)}
            />}
        </View>
    );
});

/** Edits the set's first trigger and its Then through `workflow.trigger.update | remove`. */
function AccountTriggerPopover(props: Readonly<{
    set: WorkflowTriggerSetV1;
    anchorRef: React.RefObject<View | null>;
    workflowOptions: ReturnType<typeof useTriggerThenOptions>['workflowOptions'];
    onRequestClose: () => void;
    onWritten: () => void;
    onSaveAsWorkflow: (target: TriggerTargetV1) => void;
}>) {
    const form = readAccountTriggerForm(props.set);
    if (form === null) return null;
    const { set } = props;
    const { triggerId } = form;
    return (
        <TriggerPopover
            testID="workflows-column-trigger-popover"
            anchorRef={props.anchorRef}
            onRequestClose={props.onRequestClose}
            whenKinds={['schedule']}
            sessionId={null}
            initial={form.initial}
            workflowOptions={props.workflowOptions}
            machineId={set.project?.machineId ?? null}
            onSaveAsWorkflow={props.onSaveAsWorkflow}
            onSubmit={async (value, write) => {
                if (write.target === null) return;
                const { enabled: _enabled, ...definition } = write.trigger;
                await updateWorkflowTrigger({
                    automationId: set.automationId,
                    triggerId,
                    expectedRevision: set.revision,
                    patch: {
                        target: write.target,
                        trigger: definition,
                        enabled: value.enabled,
                        executionTarget: buildTriggerExecutionTarget(value.then),
                    },
                });
                props.onWritten();
            }}
            onToggleEnabled={async (next) => {
                await updateWorkflowTrigger({ automationId: set.automationId, triggerId, expectedRevision: set.revision, patch: { enabled: next } });
                props.onWritten();
            }}
            onDelete={async () => {
                await removeWorkflowTrigger({ automationId: set.automationId, triggerId });
                props.onWritten();
            }}
        />
    );
}

/**
 * The column "+" menu's **New trigger** (04 §3.3, F1): an Account trigger that holds its own steps,
 * with its set's Runs on, written through `workflow.trigger.add`. It joins the Triggers section.
 */
export function NewAccountTriggerPopover(props: Readonly<{
    anchorRef: React.RefObject<View | null>;
    onRequestClose: () => void;
}>): React.ReactElement {
    const thenOptions = useTriggerThenOptions();
    const [project, setProject] = React.useState<WorkflowProjectTargetV1 | null>(null);
    return (
        <TriggerPopover
            testID="workflows-column-new-trigger-popover"
            anchorRef={props.anchorRef}
            onRequestClose={props.onRequestClose}
            whenKinds={['schedule']}
            sessionId={null}
            initial={null}
            workflowOptions={thenOptions.workflowOptions}
            machineId={project?.machineId ?? null}
            hostComplete={project !== null}
            setRows={(
                <TriggerRunsOnRow
                    testID="workflows-column-new-trigger-runs-on"
                    target={project}
                    onChange={setProject}
                    description={t('workflows.triggers.editor.runsOnAccountDescription')}
                />
            )}
            onSubmit={async (value, write) => {
                if (write.target === null || project === null) return;
                await addWorkflowTrigger({
                    target: write.target,
                    project,
                    trigger: write.trigger,
                    executionTarget: buildTriggerExecutionTarget(value.then),
                });
                await sync.refreshAutomations().catch(() => undefined);
            }}
        />
    );
}
