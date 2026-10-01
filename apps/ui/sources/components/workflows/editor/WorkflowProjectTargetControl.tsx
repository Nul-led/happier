import { useAuthoringMemoryField } from '@/sync/domains/state/storage';
import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { HappierPressable } from '@happier-dev/plugin-ui/presentation';

import type { WorkflowProjectTargetV1 } from '@happier-dev/protocol/workflows';

import { AgentInputSelectionListPopover } from '@/components/sessions/agentInput/components/AgentInputSelectionListPopover';
import { MachineSelector } from '@/components/sessions/new/components/MachineSelector';
import { useCheckoutSelectionPicker } from '@/components/sessions/new/hooks/screenModel/useCheckoutSelectionPicker';
import { useNewSessionRepoScmSnapshot } from '@/components/sessions/new/hooks/screenModel/useNewSessionRepoScmSnapshot';
import { resolveNewSessionCheckoutChipModel } from '@/components/sessions/new/modules/newSessionCheckoutChipModel';
import { Icon } from '@/components/ui/icons/Icon';
import { openMachinePathBrowserModal } from '@/components/ui/pathBrowser/openMachinePathBrowserModal';
import { SelectionListFilterChip } from '@/components/ui/selectionList';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useActiveServerAccountScope, useSetting } from '@/sync/domains/state/storage';
import type { Machine } from '@/sync/domains/state/storageTypes';
import {
    selectWorkflowProjectMachine,
    setWorkflowProjectDirectory,
    isWorkflowProjectTarget,
    type WorkflowAuthoringTarget,
} from '@/sync/domains/workflows/workflowProjectTarget';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import { t } from '@/text';
import { formatPathRelativeToHome } from '@/utils/sessions/formatPathRelativeToHome';
import { resolveDefaultDirectoryForMachine } from '@/utils/sessions/machineDefaultDirectory';
import { useStableRecentPathsResolver } from '@/utils/sessions/useStableRecentPathsForMachine';

import { workflowEditorStyles, workflowPressFeedbackStyle } from './workflowEditorStyles';

/**
 * Where a workflow runs: one exact Machine, its project folder and the checkout
 * of that folder's repository.
 *
 * Every choice here is the one New Session already offers. The Machine comes
 * from the canonical `MachineSelector`, a Machine's starting folder from the
 * shared default-directory policy, the folder from the canonical Machine path
 * browser, and the checkout from the one checkout picker New Session's chip
 * presents — so a workflow and a Session opened side by side agree about
 * "where". What stays Workflow-specific is only the value shape: the thin
 * `workflowProjectTarget` adapter keeps `workspaceRefId` truthful whenever the
 * folder moves. A new worktree is not a project choice here; it is authored as
 * the workflow's Workspace policy, which is why this picker offers no creation.
 */

const styles = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.margins.sm,
        flexWrap: 'wrap',
    },
    value: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    unresolved: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.placeholder,
        flexShrink: 1,
    },
    popover: {
        minWidth: 320,
        gap: theme.margins.xs,
        paddingVertical: theme.margins.xs,
    },
    control: {
        minWidth: 0,
        flexShrink: 1,
        paddingHorizontal: theme.margins.sm,
        borderRadius: theme.borderRadius.md,
    },
}));

const EMPTY_WORKSPACE_REFS: ReadonlyArray<WorkspaceRefV1> = [];

/**
 * The one "where it runs" summary: "{machine} / {folder}". The header chip, the
 * Workflow settings field and the phone value row all show this string, so a
 * compacted surface truncates it and never rephrases it. `null` means no
 * Machine is chosen yet.
 */
export function formatWorkflowWhereSummary(params: Readonly<{
    target: WorkflowAuthoringTarget | null | undefined;
    machineName: string | null;
    machineHomeDir?: string | null;
}>): string | null {
    const { target } = params;
    if (target === null || target === undefined || params.machineName === null) return null;
    if (!isWorkflowProjectTarget(target) || target.directory.trim().length === 0) return params.machineName;
    return `${params.machineName} / ${formatPathRelativeToHome(target.directory, params.machineHomeDir ?? undefined)}`;
}

/** Opens the Where owner's picker from elsewhere (Run now with no Machine chosen). */
export type WorkflowProjectTargetControlHandle = Readonly<{ openPicker: () => void }>;

type WorkflowProjectTargetControlProps = Readonly<{
    target: WorkflowAuthoringTarget | null | undefined;
    /** The display name of the target Machine; `null` stays visibly unresolved. */
    machineName: string | null;
    /** Supplying both makes the target editable; a host that omits them shows it read-only. */
    machines?: readonly Machine[];
    onChange?: (target: WorkflowAuthoringTarget) => void;
    /**
     * `chip`: the editor header's chip ("MacBook Pro / ~/src/happier", or the
     * quiet "Choose where it runs" while missing), opening one content-sized
     * popover with the same Machine, folder and checkout choices. `field` (the
     * default): those choices in place, for the Workflow settings row.
     */
    presentation?: 'chip' | 'field';
    testIDPrefix: string;
}>;

/**
 * Where a workflow runs, as one owner with two presentations and one summary
 * string ({@link formatWorkflowWhereSummary}).
 */
export const WorkflowProjectTargetControl = React.forwardRef<
    WorkflowProjectTargetControlHandle,
    WorkflowProjectTargetControlProps
>(function WorkflowProjectTargetControl(props, ref): React.ReactElement {
    const { target, testIDPrefix } = props;
    const machine = target === undefined || target === null
        ? undefined
        : props.machines?.find((candidate) => candidate.id === target.machineId);
    const machineHomeDir = machine?.metadata?.homeDir;
    const editable = props.machines !== undefined && props.onChange !== undefined;
    const [pickerOpen, setPickerOpen] = React.useState(false);
    React.useImperativeHandle(ref, () => ({
        openPicker: () => { if (editable) setPickerOpen(true); },
    }), [editable]);

    if (props.presentation === 'chip') {
        const summary = formatWorkflowWhereSummary({ target, machineName: props.machineName, machineHomeDir });
        return (
            <SelectionListFilterChip
                filter={{
                    id: 'workflow-where',
                    label: t('workflows.page.where.label'),
                    valueLabel: summary ?? t('workflows.page.where.choose'),
                    icon: <WhereChipIcon />,
                    muted: summary === null,
                    disabled: !editable,
                    open: pickerOpen,
                    onOpenChange: setPickerOpen,
                    renderPopoverContent: () => (
                        <View testID={`${testIDPrefix}-where-popover`} style={styles.popover}>
                            {props.machines !== undefined && props.onChange !== undefined ? (
                                <EditableProjectTarget
                                    target={target ?? null}
                                    machines={props.machines}
                                    onChange={props.onChange}
                                    testIDPrefix={testIDPrefix}
                                />
                            ) : null}
                        </View>
                    ),
                    testID: `${testIDPrefix}-where-chip`,
                }}
            />
        );
    }

    return (
        <View testID={`${testIDPrefix}-machine-row`} style={styles.row}>
            {editable && props.machines !== undefined && props.onChange !== undefined ? (
                <EditableProjectTarget
                    target={target ?? null}
                    machines={props.machines}
                    onChange={props.onChange}
                    testIDPrefix={testIDPrefix}
                />
            ) : (
                <>
                    <Text
                        testID={`${testIDPrefix}-machine`}
                        style={props.machineName === null ? styles.unresolved : styles.value}
                    >
                        {props.machineName ?? t('workflows.editor.targetRequired')}
                    </Text>
                    {target === undefined || target === null ? null : (
                        <Text testID={`${testIDPrefix}-project-directory-readonly`} style={styles.value}>
                            {isWorkflowProjectTarget(target) ? formatPathRelativeToHome(target.directory, machineHomeDir) : t('newSession.folder.noFolder')}
                        </Text>
                    )}
                </>
            )}
        </View>
    );
});

function WhereChipIcon(): React.ReactElement {
    const { theme } = useUnistyles();
    return <Icon name="desktop" size={14} color={theme.colors.text.secondary} />;
}

function EditableProjectTarget(props: Readonly<{
    target: WorkflowAuthoringTarget | null;
    machines: readonly Machine[];
    onChange: (target: WorkflowAuthoringTarget) => void;
    testIDPrefix: string;
}>): React.ReactElement {
    const { machines, onChange, target, testIDPrefix } = props;
    const activeScope = useActiveServerAccountScope();
    const serverId = activeScope?.serverId ?? null;
    const recentMachinePaths = useAuthoringMemoryField('recentMachinePaths');
    const workspaceRefsSetting = useSetting('workspaceRefsV1');
    const workspaceRefs = Array.isArray(workspaceRefsSetting) ? workspaceRefsSetting : EMPTY_WORKSPACE_REFS;
    const resolveRecentPathsForMachine = useStableRecentPathsResolver({
        recentMachinePaths: Array.isArray(recentMachinePaths) ? recentMachinePaths : [],
        // The Account's own recent-folder list is the canonical source here;
        // deriving paths from every Session would subscribe an open editor to
        // the whole Session list for a default it rarely needs.
        sessions: null,
    });

    const machine = target === null ? undefined : machines.find((candidate) => candidate.id === target.machineId);
    const machineHomeDir = machine?.metadata?.homeDir ?? null;
    const machinePlatform = machine?.metadata?.platform ?? null;
    const { theme } = useUnistyles();

    // A picker result belongs to the target it was opened for. A folder or
    // checkout chosen for one Machine/folder is never applied to another — the
    // host may have switched source, or the person may have changed Machine,
    // while the browser was open.
    const targetRef = React.useRef(target);
    targetRef.current = target;
    const latest = React.useRef({ onChange, serverId, workspaceRefs });
    latest.current = { onChange, serverId, workspaceRefs };
    const moveToDirectory = React.useCallback((openedFor: WorkflowAuthoringTarget, directory: string) => {
        if (targetRef.current !== openedFor) return;
        latest.current.onChange(setWorkflowProjectDirectory({
            current: openedFor,
            directory,
            serverId: latest.current.serverId,
            workspaceRefs: latest.current.workspaceRefs,
        }));
    }, []);

    const selectMachine = React.useCallback((selected: Machine) => {
        onChange(selectWorkflowProjectMachine({
            current: target,
            machineId: selected.id,
            defaultDirectory: resolveDefaultDirectoryForMachine({
                machineId: selected.id,
                machines,
                recentPaths: resolveRecentPathsForMachine(selected.id),
            }),
            serverId,
            workspaceRefs,
        }));
    }, [machines, onChange, resolveRecentPathsForMachine, serverId, target, workspaceRefs]);

    const browseDirectory = React.useCallback(() => {
        if (target === null) return;
        const openedFor = target;
        void (async () => {
            const directory = await openMachinePathBrowserModal({
                machineId: openedFor.machineId,
                initialPath: isWorkflowProjectTarget(openedFor) ? openedFor.directory : machineHomeDir ?? undefined,
                selectionMode: 'directory',
                title: t('workflows.workspace.projectCheckout'),
            });
            if (directory !== null) moveToDirectory(openedFor, directory);
        })();
    }, [machineHomeDir, moveToDirectory, target]);

    const directoryLabel = target === null ? null : isWorkflowProjectTarget(target)
        ? formatPathRelativeToHome(target.directory, machineHomeDir ?? undefined)
        : t('newSession.folder.noFolder');

    return (
        <>
            <MachineSelector
                machines={machines}
                selectedMachine={machine ?? null}
                onSelect={selectMachine}
                presentation="dropdown"
                showFavorites={false}
                showRecent={false}
                showCliGlyphs={false}
                dropdownTitle={t('workflows.editor.whereTitle')}
                dropdownTestID={`${testIDPrefix}-machine`}
                testIdPrefix={`${testIDPrefix}-machine`}
            />
            {target === null || directoryLabel === null ? null : (
                <>
                    <HappierPressable
                        testID={`${testIDPrefix}-project-directory`}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('workflows.workspace.projectCheckout')}: ${directoryLabel}`}
                        onPress={browseDirectory}
                        style={(state) => [
                            workflowEditorStyles.actionTarget,
                            styles.control,
                            workflowPressFeedbackStyle(state, theme.colors.border.focus),
                        ]}
                    >
                        <Text numberOfLines={1} style={styles.value}>{directoryLabel}</Text>
                    </HappierPressable>
                    {isWorkflowProjectTarget(target) ? <ProjectCheckoutPicker
                        target={target}
                        serverId={serverId}
                        machineHomeDir={machineHomeDir}
                        machinePlatform={machinePlatform}
                        onSelectDirectory={moveToDirectory}
                        testIDPrefix={testIDPrefix}
                    /> : null}
                </>
            )}
        </>
    );
}

/** The canonical checkout picker for the selected project folder, when it is a Git repository. */
function ProjectCheckoutPicker(props: Readonly<{
    target: WorkflowProjectTargetV1;
    serverId: string | null;
    machineHomeDir: string | null;
    machinePlatform: string | null;
    onSelectDirectory: (openedFor: WorkflowProjectTargetV1, directory: string) => void;
    testIDPrefix: string;
}>): React.ReactElement | null {
    const { onSelectDirectory, target } = props;
    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(false);
    const anchorRef = React.useRef<React.ComponentRef<typeof View> | null>(null);
    const repoScmSnapshot = useNewSessionRepoScmSnapshot({
        serverId: props.serverId,
        machineId: target.machineId,
        path: target.directory,
        machineHomeDir: props.machineHomeDir,
        machinePlatform: props.machinePlatform,
    });
    const checkoutChipModel = React.useMemo(() => resolveNewSessionCheckoutChipModel({
        selectedPath: target.directory,
        machineHomeDir: props.machineHomeDir,
        machinePlatform: props.machinePlatform,
        checkoutCreationDraft: null,
        repoSnapshot: repoScmSnapshot,
    }), [props.machineHomeDir, props.machinePlatform, repoScmSnapshot, target.directory]);
    const selectCheckoutPath = React.useCallback((path: string | null) => {
        setOpen(false);
        if (path !== null) onSelectDirectory(target, path);
    }, [onSelectDirectory, target]);
    const picker = useCheckoutSelectionPicker({
        repoScmSnapshot,
        checkoutChipModel,
        serverId: props.serverId,
        selectedMachineId: target.machineId,
        selectedPath: target.directory,
        machineHomeDir: props.machineHomeDir,
        machinePlatform: props.machinePlatform,
        onSelectCheckoutPath: selectCheckoutPath,
    });
    if (picker === null) return null;

    return (
        <>
            <View ref={anchorRef} collapsable={false}>
                <HappierPressable
                    testID={`${props.testIDPrefix}-project-checkout`}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('newSession.checkout.selectTitle')}: ${picker.selectedLabel}`}
                    expanded={open}
                    onPress={() => setOpen((current) => !current)}
                    style={(state) => [
                        workflowEditorStyles.actionTarget,
                        styles.control,
                        workflowPressFeedbackStyle(state, theme.colors.border.focus),
                    ]}
                >
                    <Text numberOfLines={1} style={styles.value}>{picker.selectedLabel}</Text>
                </HappierPressable>
            </View>
            <AgentInputSelectionListPopover
                open={open}
                anchorRef={anchorRef}
                rootStep={picker.rootStep}
                selectedOptionId={picker.selectedOptionId}
                onSelect={() => {
                    // Each option's own `onSelect` is the action source; this
                    // wrapper owns only the close path.
                }}
                onRequestClose={() => setOpen(false)}
                maxHeightCap={480}
            />
        </>
    );
}
