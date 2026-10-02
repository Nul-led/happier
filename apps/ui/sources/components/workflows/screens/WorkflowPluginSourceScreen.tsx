import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { JsonValue, RoleOverrideV1, WorkflowPluginSourceV1 } from '@happier-dev/protocol';

import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SectionContentRow } from '@/components/ui/lists/SectionContentRow';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import { useMountedRef } from '@/hooks/ui/useMountedRef';
import { randomUUID } from '@/platform/randomUUID';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { useActiveServerAccountScope, useAllMachines, useAuthoringMemoryField } from '@/sync/domains/state/storage';
import { createWorkflowDefinition } from '@/sync/domains/workflows/workflowDefinitionActions';
import { exportWorkflowDefinition } from '@/sync/domains/workflows/workflowInterchange';
import { isWorkflowProjectTarget, type WorkflowAuthoringTarget } from '@/sync/domains/workflows/workflowProjectTarget';
import { createWorkflowDefinitionRoute, createWorkflowRunRoute } from '@/sync/domains/workflows/workflowRunRoute';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';

import { confirmWorkflowDocumentExport } from '../actions/confirmWorkflowDocumentExport';
import { formatWorkflowWhereSummary, WorkflowProjectTargetControl } from '../editor/WorkflowProjectTargetControl';
import { createExecutionRunStartContentChip } from '@/components/sessions/runs/launcher/executionRunStartChips';
import { WorkflowFlowView } from '../flow/WorkflowFlowView';
import { projectWorkflowFlow } from '../flow/workflowFlowProjection';
import { useWorkflowDefinitionLibrary } from '../library/workflowLibraryReads';
import { formatWorkflowProblemMessage } from '../presentation/workflowProblemPresentation';
import { useWorkflowRunComposerModal } from '../run/useWorkflowRunComposerModal';
import { useWorkflowRunNowController } from '../run/useWorkflowRunNowController';
import { resolveContextualWorkflowProjectTarget } from './resolveContextualWorkflowTarget';
import { WorkflowMissingDefinitionState } from './WorkflowMissingDefinitionState';

/** A read-only catalog source, read through the same paged library owner as every picker. */
export function WorkflowPluginSourceScreen(props: Readonly<{ workflow: string; intent?: 'run' }>): React.ReactElement {
    const library = useWorkflowDefinitionLibrary();
    const scope = useActiveServerAccountScope();
    const router = useRouter();
    const plugin = library.pluginWorkflows.find((entry) => entry.workflow === props.workflow);
    React.useEffect(() => {
        if (plugin === undefined && library.status === 'loaded' && library.hasMore && !library.loadingMore && !library.loadMoreFailed) library.loadMore();
    }, [plugin, library.status, library.hasMore, library.loadingMore, library.loadMoreFailed, library.loadMore]);
    if (plugin === undefined) {
        if (library.status === 'failed' || library.loadMoreFailed) return <SurfaceStateCard kind="error"
            title={t('workflows.loadFailedTitle')} reason={t('workflows.loadFailedBody')}
            action={{ label: t('workflows.retry'), onPress: library.loadMoreFailed ? library.loadMore : library.retry }} />;
        if (library.status !== 'loaded' || library.hasMore) return <SurfaceStateCard kind="loading" title={t('workflows.editor.loadingTitle')} />;
        return <WorkflowMissingDefinitionState onOpenCollection={() => router.replace('/workflows' as never)} />;
    }
    return <PluginDefinition key={`${scope?.serverId}/${scope?.accountId}/${plugin.workflow}/${plugin.version}`}
        plugin={plugin} serverId={scope?.serverId ?? null} intent={props.intent} />;
}

function PluginDefinition(props: Readonly<{ plugin: WorkflowPluginSourceV1; serverId: string | null; intent?: 'run' }>): React.ReactElement {
    const { plugin } = props;
    const router = useRouter();
    const machines = useAllMachines();
    const recentMachinePaths = useAuthoringMemoryField('recentMachinePaths');
    const [target, setTarget] = React.useState<WorkflowAuthoringTarget | null>(() => resolveContextualWorkflowProjectTarget({ machines, recentMachinePaths }));
    const [lifetime] = React.useState(captureActiveServerAccountScopeLifetime);
    const mounted = useMountedRef();
    const isCurrent = React.useCallback(() => mounted.current && lifetime?.isCurrent() === true, [lifetime, mounted]);
    const [duplicating, setDuplicating] = React.useState(false);
    const duplicatePending = React.useRef(false);
    const [open, setOpen] = React.useState(props.intent === 'run');
    const [values, setValues] = React.useState<Readonly<Record<string, JsonValue | undefined>>>({});
    const [rawTextValues, setRawTextValues] = React.useState<Readonly<Record<string, string>>>({});
    const runId = React.useRef<string | null>(null);
    const runNow = useWorkflowRunNowController();
    const projection = React.useMemo(() => projectWorkflowFlow(plugin.definition), [plugin.definition]);
    const machine = machines.find((entry) => entry.id === target?.machineId);

    const duplicate = async () => {
        if (!isCurrent() || duplicatePending.current) return;
        duplicatePending.current = true;
        setDuplicating(true);
        try {
            const result = await createWorkflowDefinition({ definitionId: randomUUID(), definition: plugin.definition,
                metadata: { title: plugin.title, ...(plugin.description === undefined ? {} : { description: plugin.description }) } });
            if (isCurrent()) router.push(createWorkflowDefinitionRoute(result.definitionId) as never);
        } catch (error) {
            if (isCurrent()) await Modal.alert(t('workflows.save.failedTitle'), formatWorkflowProblemMessage(error));
        } finally {
            duplicatePending.current = false;
            if (isCurrent()) setDuplicating(false);
        }
    };
    const admit = async (inputs: Readonly<Record<string, JsonValue>> | undefined, roleOverrides?: readonly RoleOverrideV1[]) => {
        if (!isCurrent() || target === null || !isWorkflowProjectTarget(target) || target.directory.trim().length === 0) return;
        runId.current ??= randomUUID();
        const accepted = await runNow.runNow({ runId: runId.current,
            source: { kind: 'catalog', workflow: plugin.workflow, pluginVersion: plugin.version },
            metadata: { title: plugin.title }, ...(inputs === undefined ? {} : { inputs: { ...inputs } }),
            ...(roleOverrides === undefined ? {} : { roleOverrides: [...roleOverrides] }), project: target, isInvocationCurrent: isCurrent });
        if (accepted !== null && isCurrent()) {
            setOpen(false);
            runId.current = null;
            router.push(createWorkflowRunRoute(accepted.run.id) as never);
        }
    };
    useWorkflowRunComposerModal({ open, props: {
        inputs: plugin.definition.inputs, definition: plugin.definition, workflowName: plugin.title,
        preview: plugin.description ?? '', values, onChangeValues: setValues, rawTextValues, onChangeRawTextValues: setRawTextValues,
        machineId: target?.machineId ?? null, serverId: props.serverId,
        extraActionChips: [{ ...createExecutionRunStartContentChip({
            key: 'workflow-start-where', icon: 'folder', title: t('workflows.page.where.label'),
            label: formatWorkflowWhereSummary({ target, machineName: machine ? getMachineDisplayName(machine) : null }) ?? t('workflows.page.where.choose'),
            testID: 'workflow-plugin:run-where',
            renderContent: <WorkflowProjectTargetControl target={target} machines={machines} onChange={setTarget}
                machineName={machine ? getMachineDisplayName(machine) : null} testIDPrefix="workflow-plugin:run" />,
        }), controlId: 'path' }],
        onRun: (inputs, overrides) => { void admit(inputs, overrides); }, onCancel: () => setOpen(false),
        pending: runNow.stateFor(runId.current ?? '') === 'submitting',
        startDisabled: target === null || !isWorkflowProjectTarget(target) || target.directory.trim().length === 0,
    } });
    const exportSource = async () => {
        if (!isCurrent()) return;
        const result = exportWorkflowDefinition({ definition: plugin.definition });
        if (result.ok) await confirmWorkflowDocumentExport({ name: plugin.title, json: result.json, isCurrent });
    };
    return <ItemList>
        <PageHeader title={plugin.title} description={plugin.description} meta={[{ key: 'plugin', text: `${plugin.pluginId} · ${plugin.version}` }]}
            actions={<View style={styles.actions}>
                <RoundButton testID="workflow-plugin:export" title={t('workflows.exportJson')} size="small" display="inverted" onPress={() => { void exportSource(); }} />
                <RoundButton testID="workflow-plugin:duplicate" title={t('workflows.plugins.duplicateToLibrary')} size="small" display="inverted" disabled={duplicating} onPress={duplicate} />
                <RoundButton testID="workflow-plugin:run" title={t('workflows.destination.rowMenu.runNow')} size="small" onPress={() => { runId.current = null; setOpen(true); }} />
            </View>} />
        <ItemGroup><SectionContentRow><View style={styles.body}>
            <Text testID="workflow-plugin:read-only">{t('workflows.plugins.readOnly')}</Text>
            <WorkflowProjectTargetControl target={target} machines={machines} onChange={setTarget}
                machineName={machine ? getMachineDisplayName(machine) : null} testIDPrefix="workflow-plugin" />
            <WorkflowFlowView projection={projection} selectedNodeId={null} testIDPrefix="workflow-plugin:flow" />
        </View></SectionContentRow></ItemGroup>
    </ItemList>;
}

const styles = StyleSheet.create((theme) => ({
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.margins.sm },
    body: { gap: theme.margins.md },
}));
