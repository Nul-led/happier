import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { HomeSettingsProjectionV1 } from '@happier-dev/protocol/home/governance';

import type { HomeAdministrationContext } from '@/components/settings/home/governance/homeAdministrationContext';
import { homeAdministrationRuntimePath } from '@/components/settings/home/governance/homeAdministrationRoutes';
import { PersonalHomeRuntimeControlSection } from '@/components/settings/server/localControl/PersonalHomeRuntimeControlSection';
import { usePersonalHomeRuntimeOperations } from '@/components/settings/server/localControl/usePersonalHomeRuntimeOperations';
import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon } from '@/components/ui/icons/Icon';
import { AttentionBanner } from '@/components/ui/lists/AttentionBanner';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SectionContentRow } from '@/components/ui/lists/SectionContentRow';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { Modal } from '@/modal';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { t } from '@/text';

import {
    homeRuntimeExecutorCanAct,
    restartHomeRuntime,
    useHomeRuntimeExecutor,
    type HomeRuntimeExecutor,
} from './homeRuntimeExecutor';

/** The running server's version and flavour, as the Home itself publishes them (`capabilities.server`). */
export type HomeServerRelease = Readonly<{ version: string | null; flavor: 'light' | 'full' | null }>;

export function useHomeServerRelease(serverId: string, enabled: boolean): HomeServerRelease {
    const snapshot = useServerFeaturesSnapshotForServerId(serverId, { enabled });
    const server = snapshot.status === 'ready' ? snapshot.features.capabilities.serverRelease : null;
    return React.useMemo(
        () => ({ version: server?.version ?? null, flavor: server?.flavor ?? null }),
        [server?.version, server?.flavor],
    );
}

/** Stored restart values the running server has not applied yet (from the startup snapshot only). */
export function countPendingRestartChanges(settings: HomeSettingsProjectionV1 | null): number {
    return settings?.entries.filter((entry) => entry.applied?.pending === true).length ?? 0;
}

function managedElsewhereCopy(executor: HomeRuntimeExecutor): Readonly<{ title: string; body: string }> {
    switch (executor.kind) {
        case 'deployment':
            return { title: t('homeGovernance.runtime.deploymentTitle'), body: t('homeGovernance.runtime.deploymentBody') };
        case 'elsewhere':
        case 'connected_machine':
        case 'remote_host':
            return executor.hostName
                ? { title: t('homeGovernance.runtime.managedFrom', { host: executor.hostName }), body: t('homeGovernance.runtime.managedFromBody') }
                : { title: t('homeGovernance.runtime.managedElsewhere'), body: t('homeGovernance.runtime.managedFromBody') };
        case 'hosting_desktop':
            return { title: '', body: '' };
    }
}

/**
 * "n changes apply after restart" with Restart now (plan §3.14): offered only when changes are
 * pending AND this device has an executor for the runtime; otherwise the banner says where the
 * restart happens. The one restart path is `restartHomeRuntime`. Server settings mounts it too.
 */
export const HomeRestartNowBanner = React.memo(function HomeRestartNowBanner(props: Readonly<{
    context: HomeAdministrationContext;
    executor: HomeRuntimeExecutor;
    pendingCount: number;
    /** The pending settings by name, said before where the restart happens (Server settings). */
    pendingSummary?: string;
    /**
     * Discard (§3.14 r3): offered beside Restart now, or as the banner's own action when this device
     * cannot restart the runtime. Owners only.
     */
    discard?: Readonly<{ onPress: () => void; loading: boolean }>;
    onRestarted?: () => void;
}>) {
    const { context, executor, pendingCount, onRestarted, discard } = props;
    const secretMaterialAllowed = useFeatureEnabled('remoteHosts.secretMaterial');
    const [restarting, setRestarting] = React.useState(false);
    const restart = React.useCallback(async () => {
        setRestarting(true);
        try {
            const outcome = await restartHomeRuntime(executor, { serverId: context.scope.serverId, secretMaterialAllowed });
            if (outcome.kind === 'failed') {
                await Modal.alertAsync(t('homeGovernance.runtime.restartFailed'), outcome.message ?? t('errors.operationFailed'));
                return;
            }
            onRestarted?.();
        } finally {
            setRestarting(false);
        }
    }, [context.scope.serverId, executor, onRestarted, secretMaterialAllowed]);
    if (pendingCount === 0) return null;
    const canRestart = homeRuntimeExecutorCanAct(executor) && context.projection.capabilities.manageHomeSettings;
    const where = executor.kind === 'deployment'
        ? t('homeGovernance.runtime.restartFromDeployment')
        : executor.kind === 'hosting_desktop' || executor.kind === 'remote_host' || executor.kind === 'connected_machine'
            ? t('homeGovernance.runtime.restartToApply')
            : executor.hostName
                ? t('homeGovernance.runtime.restartFromHost', { host: executor.hostName })
                : t('homeGovernance.runtime.restartFromHostingComputer');
    const canDiscard = discard !== undefined && context.projection.capabilities.manageHomeSettings;
    const discardAction = canDiscard
        ? {
            label: t('homeSettings.banner.discard'),
            testID: 'home-runtime-pending-restart.discard',
            onPress: discard.onPress,
            loading: discard.loading,
            disabled: !context.mutationsAvailable,
        }
        : null;
    // The banner carries one action. With both, Restart now is the banner's and Discard sits
    // right under it (AttentionBanner has no second action slot yet; its owner decides that).
    const bannerAction = canRestart
        ? { label: t('homeGovernance.runtime.restartNow'), onPress: () => { void restart(); }, loading: restarting }
        : discardAction;
    return (
        <>
            <AttentionBanner
                testID="home-runtime-pending-restart"
                title={t('homeGovernance.runtime.pendingRestart', { count: pendingCount })}
                description={props.pendingSummary ? `${props.pendingSummary} ${where}` : where}
                action={bannerAction}
            />
            {canRestart && discardAction ? (
                <ItemGroup surface="none">
                    <SectionContentRow showDivider={false}>
                        <View style={styles.trailingAction}>
                            <RoundButton
                                testID={discardAction.testID}
                                size="small"
                                display="inverted"
                                title={discardAction.label}
                                accessibilityLabel={t('homeSettings.banner.discardA11y')}
                                loading={discardAction.loading}
                                disabled={discardAction.disabled}
                                onPress={discardAction.onPress}
                            />
                        </View>
                    </SectionContentRow>
                </ItemGroup>
            ) : null}
        </>
    );
});

const styles = StyleSheet.create(() => ({
    trailingAction: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
}));

/** The server that runs this Home: its release, and the controls of whoever can act on it. */
export const HomeRuntimeSection = React.memo(function HomeRuntimeSection(props: Readonly<{
    context: HomeAdministrationContext;
    release: HomeServerRelease;
    executor: HomeRuntimeExecutor;
}>) {
    const { context, release, executor } = props;
    const secretMaterialAllowed = useFeatureEnabled('remoteHosts.secretMaterial');
    const [restarting, setRestarting] = React.useState(false);
    const canAct = homeRuntimeExecutorCanAct(executor) && context.projection.capabilities.manageHomeSettings;
    const restart = React.useCallback(async () => {
        setRestarting(true);
        try {
            const outcome = await restartHomeRuntime(executor, { serverId: context.scope.serverId, secretMaterialAllowed });
            if (outcome.kind === 'failed') {
                await Modal.alertAsync(t('homeGovernance.runtime.restartFailed'), outcome.message ?? t('errors.operationFailed'));
            }
        } finally {
            setRestarting(false);
        }
    }, [context.scope.serverId, executor, secretMaterialAllowed]);
    const flavorLabel = release.flavor === 'full'
        ? t('homeGovernance.runtime.flavorFull')
        : release.flavor === 'light'
            ? t('homeGovernance.runtime.flavorLight')
            : null;
    const elsewhere = managedElsewhereCopy(executor);
    return (
        <>
            <ItemGroup title={t('homeGovernance.runtime.version')}>
                <Item
                    testID="home-runtime-version"
                    title={release.version ? t('homeGovernance.runtime.versionValue', { version: release.version }) : t('homeGovernance.runtime.versionUnknown')}
                    subtitle={flavorLabel ?? undefined}
                    mode="info"
                    showChevron={false}
                />
            </ItemGroup>
            {executor.kind === 'hosting_desktop' ? null : (
                <ItemGroup title={t('homeGovernance.runtime.server')}>
                    <Item
                        testID={`home-runtime-managed:${executor.kind}`}
                        title={elsewhere.title}
                        subtitle={elsewhere.body}
                        subtitleLines={0}
                        mode={canAct ? undefined : 'info'}
                        showChevron={false}
                        rightElement={canAct ? (
                            <RoundButton
                                testID="home-runtime-restart"
                                size="small"
                                display="inverted"
                                title={t('homeGovernance.runtime.restart')}
                                loading={restarting}
                                disabled={!context.mutationsAvailable}
                                onPress={() => { void restart(); }}
                            />
                        ) : undefined}
                    />
                </ItemGroup>
            )}
        </>
    );
});

/**
 * The hosting desktop's own controls for its Personal Home — status, backups, restore, move,
 * search repair, logs, uninstall and erase — rendered once, with the same hook and operations the
 * Homes page used to host (Lane 07 §15.3 placement, AM-3).
 */
export const HostedPersonalHomeRuntimeSection = React.memo(function HostedPersonalHomeRuntimeSection() {
    const { personalHomeProfile, operations } = usePersonalHomeRuntimeOperations();
    return (
        <PersonalHomeRuntimeControlSection
            operations={operations}
            {...(personalHomeProfile ? { homeLabel: resolveHomeDisplayLabel(personalHomeProfile, personalHomeProfile.id) } : {})}
        />
    );
});

/**
 * Backups on the Data page (lab `hcData-*`), executor-selected: the hosting desktop runs them from
 * the runtime controls; elsewhere the section names where backups are made; a full-flavour Home's
 * backups belong to its deployment.
 */
export const HomeBackupsSection = React.memo(function HomeBackupsSection(props: Readonly<{ context: HomeAdministrationContext }>) {
    const { context } = props;
    const router = useRouter();
    const release = useHomeServerRelease(context.scope.serverId, context.projection.capabilities.viewAdministration);
    const executor = useHomeRuntimeExecutor(context.scope.serverId, release.flavor);
    const subtitle = executor.kind === 'deployment'
        ? t('homeGovernance.runtime.backupsDeployment')
        : executor.kind === 'hosting_desktop'
            ? t('homeGovernance.runtime.backupsHere')
            : executor.hostName
                ? t('homeGovernance.runtime.backupsFromHost', { host: executor.hostName })
                : t('homeGovernance.runtime.backupsFromHostingComputer');
    return (
        <ItemGroup title={t('homeGovernance.runtime.backups')}>
            <Item
                testID={`home-data-backups:${executor.kind}`}
                icon={executor.kind === 'hosting_desktop' ? <Icon name="hard-drives" /> : undefined}
                title={t('homeGovernance.runtime.backups')}
                subtitle={subtitle}
                subtitleLines={0}
                mode={executor.kind === 'hosting_desktop' ? undefined : 'info'}
                showChevron={executor.kind === 'hosting_desktop'}
                {...(executor.kind === 'hosting_desktop'
                    ? { onPress: () => router.push(homeAdministrationRuntimePath(context.scope.serverId)) }
                    : {})}
            />
        </ItemGroup>
    );
});
