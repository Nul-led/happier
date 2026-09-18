import * as React from 'react';
import { useRouter } from 'expo-router';
import type { MachinePoolViewV1 } from '@happier-dev/protocol';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import { useMachinePoolProjections } from '@/sync/engine/machines/useMachinePoolProjections';
import type { Machine } from '@/sync/domains/state/storageTypes';
import type { ActiveSelectionMachineGroup } from '../hooks/useActiveSelectionMachineGroups';
import { invalidateMachinePoolProjection } from '@/sync/engine/machines/machinePoolProjection';
import { isMachinePoolHomeOffline, isMachinePoolRefreshFailed } from '../pools/machinePoolEditorModel';
import { buildMachinePoolRowPresentations, resolveMachinePoolEnabledMemberLabels } from '@/components/machines/pools/machinePoolRowPresentation';
import { useNavigationFocusReturn } from '@/utils/navigation/useNavigationFocusReturn';

const MEMBER_PREVIEW_LIMIT = 2;

export function machinePoolSettingsRowTestId(serverId: string, poolId: string): string {
    return `settings.machinePools.row.${serverId}.${poolId}`;
}

export function machinePoolSettingsAddTestId(serverId: string): string {
    return `settings.machinePools.add.${serverId}`;
}

export function resolveMachinePoolDeleteFocusTargetTestId(
    serverId: string,
    pools: readonly MachinePoolViewV1[],
    deletedPoolId: string,
): string {
    const deletedIndex = pools.findIndex((view) => view.pool.id === deletedPoolId);
    const next = deletedIndex >= 0 ? pools[deletedIndex + 1] : undefined;
    if (next) return machinePoolSettingsRowTestId(serverId, next.pool.id);
    const previous = deletedIndex > 0 ? pools[deletedIndex - 1] : undefined;
    return previous
        ? machinePoolSettingsRowTestId(serverId, previous.pool.id)
        : machinePoolSettingsAddTestId(serverId);
}

function availabilityText(view: MachinePoolViewV1): string {
    return view.availability.state === 'known'
        ? t('machinePools.availabilityKnown', { connected: view.availability.connectedCount, enabled: view.availability.enabledCount })
        : t('machinePools.availabilityUnknown');
}

function memberPreview(view: MachinePoolViewV1, machines: ReadonlyArray<Machine>): string {
    return resolveMachinePoolEnabledMemberLabels(view, machines, { limit: MEMBER_PREVIEW_LIMIT }).join(', ');
}

export const MachinePoolsSection = React.memo(function MachinePoolsSection(props: Readonly<{
    groups: readonly ActiveSelectionMachineGroup[];
}>) {
    const router = useRouter();
    const projections = useMachinePoolProjections(props.groups);
    const focusReturnReady = projections.every((projection) => Boolean(
        projection
        && projection.featureStatus !== 'loading'
        && (projection.status !== 'loading' || projection.pools.length > 0),
    ));
    const navigateWithFocusReturn = useNavigationFocusReturn({ ready: focusReturnReady });

    return <>
        {props.groups.map((group, index) => {
            const projection = projections[index];
            const title = props.groups.length > 1 ? `${t('machinePools.title')} · ${group.serverName}` : t('machinePools.title');
            const featurePending = !projection || projection.featureStatus === 'loading';
            const featureError = projection?.featureStatus === 'error';
            const featureEnabled = projection?.featureStatus === 'enabled';
            const homeOffline = isMachinePoolHomeOffline(group.status)
                || isMachinePoolHomeOffline(projection?.status ?? 'loading');
            // A failed read is not an offline Home. Rows stay readable and administration stays
            // reachable; only the connection summary stops claiming to be a current observation.
            const refreshFailed = featureEnabled && !homeOffline
                && (isMachinePoolRefreshFailed(group.status) || isMachinePoolRefreshFailed(projection.status));
            const unavailable = !featureEnabled || homeOffline || refreshFailed;
            const rows = buildMachinePoolRowPresentations(projection?.pools ?? [], (view) => memberPreview(view, group.machines));
            // A settled disabled Home has no Pool administration surface. Cold discovery and cold
            // discovery failure also stay absent: without an enabled decision or retained Pool row,
            // Settings must not advertise administration that this Home may not support. Once the
            // feature or retained data establishes this surface, failures remain truthful below.
            if (projection?.featureStatus === 'disabled') return null;
            if ((featurePending || featureError) && rows.length === 0) return null;
            return (
                <ItemGroup key={group.serverId} title={title} footer={t('machinePools.privacy')}>
                    {featurePending ? <Item
                        testID={`settings.machinePools.featureLoading.${group.serverId}`}
                        title={t('common.loading')}
                        mode="info"
                    /> : null}
                    {featureError ? <Item
                        testID={`settings.machinePools.featureFailed.${group.serverId}`}
                        title={t('machinePools.refreshFailed')}
                        mode="info"
                    /> : null}
                    {featureError ? <Item
                        testID={`settings.machinePools.featureRetry.${group.serverId}`}
                        title={t('common.retry')}
                        onPress={() => { void invalidateMachinePoolProjection(group.serverId, { forceFeatures: true }).catch(() => {}); }}
                    /> : null}
                    {homeOffline ? <Item
                        testID={`settings.machinePools.unavailable.${group.serverId}`}
                        title={t('machinePools.homeOffline')}
                        mode="info"
                    /> : null}
                    {refreshFailed ? <Item
                        testID={`settings.machinePools.refreshFailed.${group.serverId}`}
                        title={t('machinePools.refreshFailed')}
                        mode="info"
                    /> : null}
                    {refreshFailed ? <Item
                        testID={`settings.machinePools.retry.${group.serverId}`}
                        title={t('common.retry')}
                        onPress={() => { void invalidateMachinePoolProjection(group.serverId, { forceFeatures: true }).catch(() => {}); }}
                    /> : null}
                    {rows.map(({ view, memberPreview: preview, identityDetail, accessibilityName }) => {
                        const availability = availabilityText(view);
                        const rowTestId = machinePoolSettingsRowTestId(group.serverId, view.pool.id);
                        // A Home that is signed out or failed to refresh keeps its last known rows;
                        // the row says so instead of presenting a stale connection count as current.
                        const detail = [
                            unavailable ? t('machinePools.unavailable') : availability,
                            identityDetail,
                        ].filter(Boolean).join(' · ');
                        return <Item
                            key={view.pool.id}
                            testID={rowTestId}
                            pressableRef={featureEnabled && !homeOffline
                                ? navigateWithFocusReturn.targetRef(rowTestId)
                                : undefined}
                            title={view.pool.name}
                            subtitle={preview || t('machinePools.noMembers')}
                            detail={detail}
                            accessibilityLabel={[
                                accessibilityName,
                                preview,
                                unavailable ? t('machinePools.unavailable') : availability,
                                props.groups.length > 1 ? group.serverName : null,
                            ].filter(Boolean).join('. ')}
                            disabled={!featureEnabled || homeOffline}
                            onPress={featureEnabled && !homeOffline
                                ? () => navigateWithFocusReturn.navigateFrom(rowTestId, () => router.push(`/(app)/settings/machines/pools/${encodeURIComponent(view.pool.id)}?serverId=${encodeURIComponent(group.serverId)}`))
                                : undefined}
                        />;
                    })}
                    {rows.length === 0 && featureEnabled && projection.status === 'loading' ? <Item title={t('common.loading')} mode="info" /> : null}
                    {featureEnabled ? <Item
                        testID={machinePoolSettingsAddTestId(group.serverId)}
                        pressableRef={!homeOffline
                            ? navigateWithFocusReturn.targetRef(machinePoolSettingsAddTestId(group.serverId))
                            : undefined}
                        title={t('machinePools.add')}
                        subtitle={rows.length === 0 ? t('machinePools.benefit') : undefined}
                        disabled={homeOffline}
                        onPress={() => navigateWithFocusReturn.navigateFrom(machinePoolSettingsAddTestId(group.serverId), () => router.push(`/(app)/settings/machines/pools/new?serverId=${encodeURIComponent(group.serverId)}`))}
                    /> : null}
                </ItemGroup>
            );
        })}
    </>;
});
