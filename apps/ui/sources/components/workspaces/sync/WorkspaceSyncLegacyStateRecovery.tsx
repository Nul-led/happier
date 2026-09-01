import * as React from 'react';
import type { WorkspaceSyncLegacyStateInspectionV1 } from '@happier-dev/protocol';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useLocalDaemonControl } from '@/components/settings/machines/localControl/useLocalDaemonControl';
import { useAllMachines } from '@/sync/domains/state/storage';
import { inspectWorkspaceSyncLegacyState } from '@/sync/ops/workspaceSync';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { invokeDesktopHost, isDesktopHost } from '@/utils/platform/desktopHost';

type Finding = Readonly<{
    machineId: string;
    machineName: string;
    inspection: Exclude<WorkspaceSyncLegacyStateInspectionV1, { status: 'absent' }>;
}>;

export const WorkspaceSyncLegacyStateRecovery = React.memo(function WorkspaceSyncLegacyStateRecovery() {
    const machines = useAllMachines();
    const localDaemon = useLocalDaemonControl();
    const [findings, setFindings] = React.useState<readonly Finding[]>([]);
    const [checking, setChecking] = React.useState(false);
    const [inspectionFailed, setInspectionFailed] = React.useState(false);

    const inspect = React.useCallback(async () => {
        setChecking(true);
        const settled = await Promise.allSettled(machines.map(async (machine): Promise<Finding | null> => {
            const inspection = await inspectWorkspaceSyncLegacyState({ controllerMachineId: machine.id });
            return inspection.status === 'absent' ? null : {
                machineId: machine.id,
                machineName: getMachineDisplayName(machine) ?? machine.id,
                inspection,
            };
        }));
        setFindings((previous) => {
            const next = new Map(
                previous
                    .filter((finding) => machines.some((machine) => machine.id === finding.machineId))
                    .map((finding) => [finding.machineId, finding] as const),
            );
            settled.forEach((result, index) => {
                const machine = machines[index];
                if (!machine || result.status === 'rejected') return;
                if (result.value) next.set(machine.id, result.value);
                else next.delete(machine.id);
            });
            return [...next.values()];
        });
        setInspectionFailed(settled.some((result) => result.status === 'rejected'));
        setChecking(false);
    }, [machines]);

    React.useEffect(() => { void inspect(); }, [inspect]);

    if (!checking && findings.length === 0 && !inspectionFailed) return null;
    return (
        <ItemGroup
            title={t('workspaceSync.legacyRecovery.title')}
            footer={t('workspaceSync.legacyRecovery.footer')}
        >
            {checking ? <Item title={t('workspaceSync.legacyRecovery.checking')} showChevron={false} /> : null}
            {inspectionFailed ? (
                <Item
                    testID="workspace-sync-legacy-inspection-failed"
                    title={t('workspaceSync.legacyRecovery.inspectFailed')}
                    showChevron={false}
                />
            ) : null}
            {findings.map((finding) => {
                const inspection = finding.inspection;
                if (inspection.status === 'legacy_workspace_sync_state_unknown') {
                    return (
                        <Item
                            key={finding.machineId}
                            title={finding.machineName}
                            subtitle={t('workspaceSync.legacyRecovery.unknown', { path: inspection.path, reason: inspection.reason })}
                            subtitleLines={0}
                            copy={inspection.path}
                            showChevron={false}
                        />
                    );
                }
                const canOpen = isDesktopHost() && localDaemon.status?.machineId === finding.machineId;
                return (
                    <React.Fragment key={finding.machineId}>
                        <Item
                            title={finding.machineName}
                            subtitle={t('workspaceSync.legacyRecovery.explanation')}
                            subtitleLines={0}
                            showChevron={false}
                        />
                        <Item
                            testID={`workspace-sync-legacy-quarantine-${finding.machineId}`}
                            title={t('workspaceSync.legacyRecovery.quarantinePath')}
                            subtitle={inspection.quarantinePath}
                            subtitleLines={0}
                            copy={inspection.quarantinePath}
                            showChevron={false}
                        />
                        {canOpen ? (
                            <Item
                                testID={`workspace-sync-legacy-open-${finding.machineId}`}
                                title={t('workspaceSync.legacyRecovery.openFolder')}
                                onPress={() => { void invokeDesktopHost('system_tasks_open_log_path', { path: inspection.quarantinePath }); }}
                            />
                        ) : null}
                        <Item
                            testID={`workspace-sync-legacy-offline-${finding.machineId}`}
                            title={t('workspaceSync.legacyRecovery.offlineTitle')}
                            subtitle={t('workspaceSync.legacyRecovery.offlineSteps', { path: inspection.quarantinePath })}
                            subtitleLines={0}
                            copy={inspection.quarantinePath}
                            showChevron={false}
                        />
                    </React.Fragment>
                );
            })}
            <Item
                testID="workspace-sync-legacy-reinspect"
                title={t('workspaceSync.legacyRecovery.reinspect')}
                onPress={() => { void inspect(); }}
            />
        </ItemGroup>
    );
});
