import * as React from 'react';
import type { ScrollView, ScrollViewProps } from 'react-native';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { AccountDirectoryCapabilities } from '@happier-dev/protocol';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { KeyboardAwareScrollView } from '@/components/ui/keyboardAvoidance';
import { SavedServersSection } from '@/components/settings/server/sections/SavedServersSection';
import { AddTargetsSection } from '@/components/settings/server/sections/AddTargetsSection';
import { ServerGroupsSection } from '@/components/settings/server/sections/ServerGroupsSection';
import { HomeDeviceApprovalSection } from '@/components/settings/server/sections/HomeDeviceApprovalSection';
import { ServerRetentionSection } from '@/components/settings/server/sections/ServerRetentionSection';
import { RelayDriftActionCard } from '@/components/settings/server/RelayDriftActionCard';
import { LocalRelayRuntimeControlSection } from '@/components/settings/server/localControl/LocalRelayRuntimeControlSection';
import {
    PersonalHomeRuntimeControlSection,
    type PersonalHomeRuntimeControlOperations,
    type PersonalHomeRelocationRecovery,
    type PersonalHomeRelocationDestination,
} from '@/components/settings/server/localControl/PersonalHomeRuntimeControlSection';
import {
    createPersonalHomeRelocationPromptResponder,
    createPersonalHomeRelocationPromptResponderWithPublication,
} from '@/components/settings/server/localControl/personalHomeRelocationPromptResponder';
import { isEligiblePersonalHomeRelocationHost } from '@/components/settings/server/localControl/personalHomeRelocationEligibility';
import { runRelayRuntimeUninstallTask } from '@/components/settings/server/localControl/useLocalRelayRuntimeControl';
import { getDefaultSystemTaskRunner } from '@/components/systemTasks';
import { buildRemoteSshManageHostSystemTaskSpec } from '@/components/systemTasks/specs/remoteSsh/buildRemoteSshManageHostSystemTaskSpec';
import { LocalRelayAccessControlSection } from '@/components/settings/server/localControl/LocalRelayAccessControlSection';
import { resolveKnownLocalRelayUrl } from '@/sync/domains/server/url/resolveKnownLocalRelayUrl';
import { useServerSettingsScreenController } from '@/components/settings/server/hooks/useServerSettingsScreenController';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { resolveSetupSurfacePolicy } from '@/sync/domains/server/setup/setupSurfacePolicy';
import { t } from '@/text';
import { buildRelaySetupWizardHref } from '@/utils/routes/setupWizardHref';
import { invokeDesktopHost } from '@/utils/platform/desktopHost';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { resolveHomeMemorySearchReadiness } from '@/sync/domains/memory/useMemorySearchProvider';
import { useSetting } from '@/sync/domains/state/storage';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { sync } from '@/sync/sync';
import { randomUUID } from '@/platform/randomUUID';
import { readRemoteHosts } from '@/sync/domains/remoteHosts/remoteHostModel';
import { getRemoteHostLocalOverrides } from '@/sync/domains/remoteHosts/remoteHostLocalOverrides';
import { resolveRemoteHostEffectiveSshConfig } from '@/sync/domains/remoteHosts/resolveRemoteHostEffectiveSshConfig';
import { resolvePreferredPublicReleaseRingLabelForCurrentApp } from '@/sync/runtime/resolvePublicReleaseRing';
import {
    createAccountDirectorySession,
    parseAccountDirectoryCapability,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import { accountDirectoryCredentialStorage } from '@/auth/accountDirectory/accountDirectoryCredentialStorage';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import {
    adoptHomeProfile,
    buildHomeConnectionDescriptorForProfile,
    getAccountServiceEndpointSnapshot,
    findPersonalHomeBootstrapCompletedProfile,
    getServerProfileById,
    subscribeAccountServiceEndpoint,
    type AccountServiceEndpointV1,
} from '@/sync/domains/server/serverProfiles';

const stylesheet = StyleSheet.create((_theme) => ({
    itemListContainer: {
        flex: 1,
    },
}));

type KeyboardAwareItemListProps = ScrollViewProps & Readonly<{
    children?: React.ReactNode;
}>;

const ServerSettingsKeyboardAwareItemList = React.forwardRef<ScrollView, KeyboardAwareItemListProps>(
    function ServerSettingsKeyboardAwareItemList({ children, ...props }, ref) {
        return (
            <ItemList ref={ref} {...props}>
                {children}
            </ItemList>
        );
    },
);

type RelocationDirectoryPublication = Readonly<{
    endpoint: string;
    serverIdentityId: string;
    capability: AccountDirectoryCapabilities;
}>;

async function resolveRelocationDirectoryPublication(
    endpoint: AccountServiceEndpointV1 | null,
): Promise<RelocationDirectoryPublication | null> {
    if (!endpoint?.url.trim()) return null;
    const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
    const serverIdentityId = observed.status === 'ready' ? observed.serverIdentityId?.trim() ?? '' : '';
    const capability = parseAccountDirectoryCapability(
        observed.status === 'ready' ? observed.features.capabilities.accountDirectory : null,
    );
    if (!serverIdentityId || capability?.homeDirectory !== true
        || (endpoint.serverIdentityId && endpoint.serverIdentityId !== serverIdentityId)) {
        return null;
    }
    const credential = await accountDirectoryCredentialStorage.read({ endpoint: endpoint.url, serverIdentityId });
    return credential.kind === 'valid' ? { endpoint: endpoint.url, serverIdentityId, capability } : null;
}

function useRelocationDirectoryPublication(enabled: boolean): RelocationDirectoryPublication | null {
    const [endpoint, setEndpoint] = React.useState<AccountServiceEndpointV1 | null>(getAccountServiceEndpointSnapshot);
    const [publication, setPublication] = React.useState<RelocationDirectoryPublication | null>(null);

    React.useEffect(() => subscribeAccountServiceEndpoint(setEndpoint), []);

    React.useEffect(() => {
        let cancelled = false;
        if (!enabled || !endpoint?.url.trim()) {
            setPublication(null);
            return undefined;
        }
        setPublication(null);
        void (async () => {
            const resolved = await resolveRelocationDirectoryPublication(endpoint);
            if (!cancelled) setPublication(resolved);
        })().catch(() => {
            if (!cancelled) setPublication(null);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, endpoint]);

    return publication;
}

export function ServerSettingsScreen() {
    useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const controller = useServerSettingsScreenController();
    const isDesktop = isDesktopHost();
    const isWeb = Platform.OS === 'web';
    const setupPolicy = React.useMemo(() => resolveSetupSurfacePolicy(), []);
    const [localRelayUrl, setLocalRelayUrl] = React.useState<string | null>(null);
    const knownLocalRelayUrl = React.useMemo(() => resolveKnownLocalRelayUrl({
        activeServerUrl: controller.activeServerUrl,
        activeLocalRelayUrl: controller.activeLocalRelayUrl,
    }), [controller.activeLocalRelayUrl, controller.activeServerUrl]);
    // The managed Home runtime is this machine's local runtime, not the focused profile's;
    // it is found across all saved profiles and its section never changes focus.
    const personalHomeProfile = React.useMemo(
        () => findPersonalHomeBootstrapCompletedProfile(controller.servers),
        [controller.servers],
    );
    const personalHomeFeatures = useServerFeaturesSnapshotForServerId(personalHomeProfile?.id, {
        enabled: personalHomeProfile !== null,
    });
    const personalHomeSearchReadiness = React.useMemo(() => resolveHomeMemorySearchReadiness(
        personalHomeFeatures.status === 'ready'
            ? personalHomeFeatures.features.capabilities.homeSearch
            : undefined,
    ), [personalHomeFeatures]);
    const remoteHostsRaw = useSetting('remoteHostsV1');
    const remoteHostsManagementEnabled = useFeatureEnabled('remoteHosts.management');
    const remoteHostsSecretMaterialEnabled = useFeatureEnabled('remoteHosts.secretMaterial');
    const relocationDirectoryPublication = useRelocationDirectoryPublication(personalHomeProfile !== null);
    const eligibleRelocationHosts = React.useMemo(
        () => (remoteHostsManagementEnabled ? readRemoteHosts(remoteHostsRaw).filter((host) => (
            isEligiblePersonalHomeRelocationHost(host, remoteHostsSecretMaterialEnabled)
        )) : []),
        [remoteHostsManagementEnabled, remoteHostsRaw, remoteHostsSecretMaterialEnabled],
    );
    const relocationDestinations = React.useMemo<readonly PersonalHomeRelocationDestination[]>(
        () => eligibleRelocationHosts.map((host) => ({
                id: host.id,
                title: host.name,
                subtitle: host.ssh.target,
            })),
        [eligibleRelocationHosts],
    );
    const prepareRelocation = React.useCallback(async (
        destinationId: string,
        recovery?: PersonalHomeRelocationRecovery,
    ) => {
        if (!personalHomeProfile?.serverIdentityId) {
            throw new Error(t('errors.operationFailed'));
        }
        const destination = eligibleRelocationHosts.find((host) => host.id === destinationId);
        if (!destination) {
            throw new Error(t('errors.operationFailed'));
        }
        const resolved = await resolveRemoteHostEffectiveSshConfig({
            remoteHost: destination,
            localOverrides: getRemoteHostLocalOverrides(destination.id),
            secretMaterialAllowed: remoteHostsSecretMaterialEnabled,
            decryptSecretValue: (input) => sync.decryptSecretValue(input),
        });
        if (!resolved.ok) {
            throw new Error(resolved.error.message);
        }
        const channel = resolvePreferredPublicReleaseRingLabelForCurrentApp();
        const operationId = recovery?.operationId ?? `relocation-${randomUUID()}`;
        const sourceDescriptorRevision = recovery?.sourceDescriptorRevision
            ?? personalHomeProfile.connectionDescriptorRevision
            ?? 1;
        // Resolve again at the commit boundary so a configured Directory wins
        // even when the screen's capability probe has not settled yet.
        const directoryPublication = relocationDirectoryPublication
            ?? await resolveRelocationDirectoryPublication(getAccountServiceEndpointSnapshot());
        const respondToPrompt = directoryPublication
            ? createPersonalHomeRelocationPromptResponder({
                operationId,
                homeServerIdentityId: personalHomeProfile.serverIdentityId,
                homeLabel: personalHomeProfile.name,
                session: createAccountDirectorySession({
                    endpoint: directoryPublication.endpoint,
                    serverIdentityId: directoryPublication.serverIdentityId,
                }, { capability: directoryPublication.capability }),
            })
            : createPersonalHomeRelocationPromptResponderWithPublication({
                operationId,
                homeServerIdentityId: personalHomeProfile.serverIdentityId,
                homeLabel: personalHomeProfile.name,
                publication: {
                    // Without Account Directory, relocation updates only this initiating
                    // client's canonical profile. Other clients explicitly re-pair.
                    publish: async (input) => {
                        const adopted = await adoptHomeProfile({
                            descriptor: {
                                v: 1,
                                homeServerIdentityId: input.homeServerIdentityId,
                                canonicalServerUrl: input.canonicalServerUrl,
                                revision: input.minimumOuterRevisionExclusive + 1,
                                endpoints: input.endpoints,
                            },
                            source: personalHomeProfile.source,
                            preserveUserLabel: true,
                            preserveProfileSource: true,
                            descriptorAuthority: 'current_connection_observation',
                        });
                        const descriptor = buildHomeConnectionDescriptorForProfile(
                            getServerProfileById(adopted.id) ?? adopted,
                        );
                        if (!descriptor) throw new Error(t('errors.operationFailed'));
                        return descriptor;
                    },
                    read: async (homeServerIdentityId) => {
                        if (homeServerIdentityId !== personalHomeProfile.serverIdentityId) {
                            throw new Error(t('errors.operationFailed'));
                        }
                        const current = getServerProfileById(personalHomeProfile.id);
                        return current ? buildHomeConnectionDescriptorForProfile(current) : null;
                    },
                },
            });
        return {
            spec: buildRemoteSshManageHostSystemTaskSpec({
                action: 'personalHome.relocate',
                channel,
                sshTarget: resolved.value.sshTarget,
                sshPort: resolved.value.sshPort ? String(resolved.value.sshPort) : '',
                sshAuth: resolved.value.sshAuth,
                identityFilePath: resolved.value.identityFilePath,
                identityPrivateKey: resolved.value.identityPrivateKey,
                sshConfigFilePath: resolved.value.sshConfigFilePath,
                sshPassword: resolved.value.password,
                knownHostsMode: 'app',
                serviceMode: 'user',
                relayRuntime: { channel, mode: 'user' },
                personalHomeRelocation: {
                    operationId,
                    destinationMachineId: destination.id,
                    sourceDescriptorRevision,
                    ...(recovery ? { recoveryAction: recovery.recoveryAction } : {}),
                },
            }),
            respondToPrompt,
        };
    }, [eligibleRelocationHosts, personalHomeProfile, relocationDirectoryPublication, remoteHostsSecretMaterialEnabled]);
    const prepareRelocationRecovery = React.useCallback(async (recovery: PersonalHomeRelocationRecovery) => {
        return await prepareRelocation(recovery.destinationMachineId, recovery);
    }, [prepareRelocation]);
    const personalHomeOperations = React.useMemo<PersonalHomeRuntimeControlOperations | undefined>(() => {
        if (!personalHomeProfile) return undefined;
        const openPath = async (path: string) => {
            const normalizedPath = path.trim();
            if (!normalizedPath) throw new Error(t('settings.systemTaskOpenLogsFailed'));
            await invokeDesktopHost('system_tasks_open_log_path', { path: normalizedPath });
        };
        return {
            removeProfile: async () => {
                await controller.onRemoveServer(personalHomeProfile);
            },
            uninstallRuntime: async () => {
                await runRelayRuntimeUninstallTask(getDefaultSystemTaskRunner());
            },
            openDataLocation: openPath,
            openLogs: openPath,
            revealBackupOutput: async (path: string) => {
                const normalizedPath = path.trim();
                if (!normalizedPath) throw new Error(t('settings.systemTaskOpenLogsFailed'));
                await invokeDesktopHost('system_tasks_reveal_output_path', { path: normalizedPath });
            },
            selectBackupArchive: async () => await invokeDesktopHost<string | null>(
                'desktop_pick_personal_home_backup_archive',
            ),
            selectBackupExportDestination: async () => await invokeDesktopHost<string | null>(
                'desktop_save_personal_home_backup_archive',
            ),
            ...(relocationDestinations.length > 0
                ? {
                    relocation: {
                        destinations: relocationDestinations,
                        prepare: prepareRelocation,
                        prepareRecovery: prepareRelocationRecovery,
                    },
                }
                : {}),
        };
    }, [controller.onRemoveServer, personalHomeProfile, prepareRelocation, prepareRelocationRecovery, relocationDestinations]);
    const handleLocalRelayStatusChange = React.useCallback((status: Readonly<{ relayUrl: string }> | null | undefined) => {
        const nextRelayUrl = typeof status?.relayUrl === 'string' && status.relayUrl.trim().length > 0
            ? status.relayUrl.trim()
            : null;
        setLocalRelayUrl((current) => current === nextRelayUrl ? current : nextRelayUrl);
    }, []);

    return (
            <KeyboardAwareScrollView
                style={styles.itemListContainer}
                ScrollViewComponent={ServerSettingsKeyboardAwareItemList}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                {...(Platform.OS === 'ios' ? { automaticallyAdjustKeyboardInsets: true } : {})}
            >
                    {controller.relayDriftBanner ? (
                        isDesktop ? (
                            <RelayDriftActionCard banner={controller.relayDriftBanner} />
                        ) : (
                            <ItemGroup title={controller.relayDriftBanner.title}>
                                <Item
                                    testID="settings.server.relayDrift.readOnlyNotice"
                                    title={controller.relayDriftBanner.title}
                                    subtitle={controller.relayDriftBanner.description}
                                    showChevron={false}
                                    mode="info"
                                />
                            </ItemGroup>
                        )
                    ) : null}
                    <SavedServersSection
                        servers={controller.servers}
                        serverGroups={controller.serverGroups}
                        activeServerId={controller.activeServerId}
                        deviceDefaultServerId={controller.deviceDefaultServerId}
                        activeTargetKey={controller.activeTargetKey}
                        authStatusByServerId={controller.authStatusByServerId}
                        connectionStatusByServerId={controller.connectionStatusByServerId}
                        onSwitch={controller.onSwitchServer}
                        onSwitchGroup={controller.onSwitchGroup}
                        onRenameGroup={controller.onRenameGroup}
                        onRemoveGroup={controller.onRemoveGroup}
                        onRename={controller.onRenameServer}
                        onRemove={controller.onRemoveServer}
                    />

                    <HomeDeviceApprovalSection homes={controller.servers} />

                    <ServerRetentionSection serverId={controller.activeServerId || null} />

                    {setupPolicy.relay.allowRelaySelection ? (
                        <ItemGroup title={t('common.actions')}>
                            <Item
                                testID="settings.server.openSetupWizard"
                                title={t('setupOnboarding.setupNewRelayAction')}
                                subtitle={t('setupOnboarding.openSetupWizardSubtitle')}
                                onPress={() => router.push(buildRelaySetupWizardHref({ step: 'setup_chooser' }))}
                            />
                        </ItemGroup>
                    ) : null}

                    {isDesktop && setupPolicy.relay.allowLocalRelayHost ? (
                        <>
                            {personalHomeProfile ? (
                                <PersonalHomeRuntimeControlSection
                                    onStatusChange={handleLocalRelayStatusChange}
                                    operations={personalHomeOperations}
                                    homeLabel={personalHomeProfile.name}
                                    searchReadiness={personalHomeSearchReadiness}
                                />
                            ) : (
                                <LocalRelayRuntimeControlSection onStatusChange={handleLocalRelayStatusChange} />
                            )}
                            <LocalRelayAccessControlSection upstreamUrl={localRelayUrl ?? knownLocalRelayUrl} />
                        </>
                    ) : isWeb ? null : (
                        <ItemGroup title={t('settingsAgents.localControlTitle')}>
                            <Item
                                testID="settings.server.localControl.desktopOnlyNotice"
                                title={t('settingsAgents.localControlTitle')}
                                subtitle={t('settings.systemTaskBridgeUnavailable')}
                                showChevron={false}
                                mode="info"
                            />
                        </ItemGroup>
                    )}

                    {setupPolicy.relay.allowRelaySelection && setupPolicy.relay.allowCustomRelayUrl ? (
                        <AddTargetsSection
                            autoMode={controller.autoMode}
                            inputUrl={controller.inputUrl}
                            inputName={controller.inputName}
                            error={controller.error}
                            isValidating={controller.isValidating}
                            reachabilityRemediation={controller.reachabilityRemediation}
                            reachabilityRemediationTaskSnapshot={controller.reachabilityRemediationTaskSnapshot}
                            prefillHint={controller.addServerPrefillHint}
                            defaultExpanded={controller.addServerDefaultExpanded}
                            onChangeUrl={controller.onChangeUrl}
                            onChangeName={controller.onChangeName}
                            onResetServer={controller.onResetServer}
                            onAddServer={controller.onAddServer}
                            onReachabilityRemediationAction={controller.onReachabilityRemediationAction}
                            servers={controller.servers}
                            activeServerId={controller.activeServerId}
                            onCreateServerGroup={controller.onCreateServerGroup}
                        />
                    ) : null}

                    {controller.activeServerGroupId ? (
                        <ServerGroupsSection
                            groupSelectionPresentation={controller.groupSelectionPresentation}
                            activeServerGroupId={controller.activeServerGroupId}
                            selectedGroupServerIds={controller.selectedGroupServerIds}
                            servers={controller.servers}
                            onToggleGroupPresentation={controller.onToggleGroupPresentation}
                            onToggleGroupServer={controller.onToggleGroupServer}
                        />
                    ) : null}
            </KeyboardAwareScrollView>
    );
}
