import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import type { DaemonMcpServersDetectWarningV1, DetectedMcpServerV1 } from '@happier-dev/protocol';

import { MachineAdministrationTargetSelector } from '@/components/settings/machines/MachineAdministrationTargetSelector';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { ItemList } from '@/components/ui/lists/ItemList';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { Modal } from '@/modal';
import { randomUUID } from '@/platform/randomUUID';
import { machineMcpServersDetect } from '@/sync/ops/machineMcpServers';
import { resolveImportedMcpServerFromDetectedV1 } from '@/sync/domains/settings/mcpServers/importDetectedMcpServerV1';
import { MACHINE_ADMINISTRATION_SELECTION_KEYS_V1 } from '@/sync/domains/machines/administration/selectionPreferences';
import { useMachineAdministrationExecutionTargetBinding } from '@/sync/domains/machines/administration/useExecutionTargetBinding';
import { useMachineAdministrationTargetSelection } from '@/sync/domains/machines/administration/useTargetSelection';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { McpDetectedServersTab } from './McpDetectedServersTab';
import { mcpServerRoute } from './collection/mcpServerCollectionModel';
import { useMcpServersSettings } from './useMcpServersSettings';

/**
 * `/settings/mcp/on-machine`: the MCP servers other agents configure on the managed machine, with an
 * Import for each. The machine chip in the header scopes the whole page; it stays through loading,
 * offline and error states because it is the control that recovers them.
 */
export const McpDetectedServersScreen = React.memo(function McpDetectedServersScreen() {
    const router = useRouter();
    const { writable, setSettings } = useMcpServersSettings();
    const targetSelection = useMachineAdministrationTargetSelection(MACHINE_ADMINISTRATION_SELECTION_KEYS_V1.mcpServers);
    const selectedTarget = targetSelection.selectedTarget;
    const { selectionKey, resolveExactExecutionTarget, isExecutionTargetCurrent } = useMachineAdministrationExecutionTargetBinding(targetSelection);
    const [directory, setDirectory] = React.useState('');
    const [detected, setDetected] = React.useState<DetectedMcpServerV1[] | null>(null);
    const [warnings, setWarnings] = React.useState<DaemonMcpServersDetectWarningV1[] | null>(null);
    const previousSelectionKeyRef = React.useRef(selectionKey);

    // A different machine is a different place to look: its folder and its findings start empty.
    React.useLayoutEffect(() => {
        const previousSelectionKey = previousSelectionKeyRef.current;
        previousSelectionKeyRef.current = selectionKey;
        if (!previousSelectionKey || previousSelectionKey === selectionKey) return;
        setDirectory('');
    }, [selectionKey]);
    React.useEffect(() => {
        setDetected(null);
        setWarnings(null);
    }, [selectionKey]);

    const detectAction = React.useCallback(async () => {
        const requestedSelection = selectionKey;
        const executionTarget = resolveExactExecutionTarget(selectedTarget);
        if (!executionTarget) return;
        // No `providers` filter: the daemon on this exact machine owns the
        // current MCP discovery-source registry, including the sources an
        // installed Agent contributes. Sending this app binary's bundled Agent
        // list instead would drop every installed Agent's source before
        // detection even runs.
        const response = await machineMcpServersDetect(executionTarget.machine.id, {
            directory: directory.trim() || undefined,
        }, { serverId: executionTarget.serverId });
        if (!isExecutionTargetCurrent(requestedSelection, executionTarget)) return;
        if (!response.ok) {
            setDetected(null);
            setWarnings(null);
            Modal.alert(t('common.error'), response.error);
            return;
        }
        setDetected(response.servers);
        setWarnings(response.warnings ?? null);
    }, [directory, isExecutionTargetCurrent, resolveExactExecutionTarget, selectedTarget, selectionKey]);
    const [loading, runDetect] = useHappyAction(detectAction, { mode: 'rerun_latest' });

    React.useEffect(() => {
        void runDetect();
    }, [directory, runDetect, selectionKey]);

    const importServer = React.useCallback(async (server: DetectedMcpServerV1) => {
        if (!writable) {
            Modal.alert(t('common.error'), t('settings.mcpServersValidationFailed'));
            return;
        }
        const requestedSelection = selectionKey;
        const expectedTarget = selectedTarget;
        if (!expectedTarget) return;
        const confirmed = await Modal.confirm(
            t('settings.mcpServersImportTitle'),
            t('settings.mcpServersImportConfirm', { provider: server.provider, name: server.name }),
            { cancelText: t('common.cancel'), confirmText: t('settings.mcpServersImportAction') },
        );
        if (!confirmed) return;
        const executionTarget = resolveExactExecutionTarget(expectedTarget);
        if (!executionTarget || !isExecutionTargetCurrent(requestedSelection, executionTarget)) return;
        try {
            const imported = resolveImportedMcpServerFromDetectedV1({
                existingSettings: writable,
                detected: server,
                machineId: executionTarget.machine.id,
                nowMs: Date.now(),
                generateId: randomUUID,
            });
            if (imported.nextSettings !== writable) setSettings(imported.nextSettings);
            const result = runGuardedNavigation(() => router.replace(mcpServerRoute(imported.entry.id) as never));
            if (result !== true) fireAndForget(result, { tag: 'McpDetectedServersScreen.import' });
        } catch (error) {
            Modal.alert(t('common.error'), error instanceof Error ? error.message : t('errors.unknownError'));
        }
    }, [isExecutionTargetCurrent, resolveExactExecutionTarget, router, selectedTarget, selectionKey, setSettings, writable]);

    const executionTarget = resolveExactExecutionTarget(selectedTarget);
    return (
        <ItemList keyboardShouldPersistTaps="handled">
            <SettingsPageHeader
                description={t('mcpSettings.onMachinePurpose')}
                actions={(
                    <MachineAdministrationTargetSelector
                        selection={targetSelection}
                        presentation="chip"
                        testIDPrefix="settings.mcpServers.administration.target"
                    />
                )}
            />
            <McpDetectedServersTab
                selectedMachineId={executionTarget?.machine.id ?? null}
                selectedServerId={executionTarget?.serverId ?? null}
                canExecute={executionTarget !== null}
                directory={directory}
                onChangeDirectory={setDirectory}
                loading={loading}
                detected={detected}
                warnings={warnings}
                onRefresh={runDetect}
                onImport={(server) => { void importServer(server); }}
            />
        </ItemList>
    );
});
