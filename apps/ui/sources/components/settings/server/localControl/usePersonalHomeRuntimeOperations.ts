import * as React from 'react';
import type { AccountDirectoryCapabilities } from '@happier-dev/protocol';

import { accountDirectoryCredentialStorage } from '@/auth/accountDirectory/accountDirectoryCredentialStorage';
import type {
    PersonalHomeRelocationDestination,
    PersonalHomeRelocationRecovery,
    PersonalHomeRuntimeControlOperations,
} from '@/components/settings/server/localControl/PersonalHomeRuntimeControlSection';
import {
    createPersonalHomeRelocationProfilePublication,
    createPersonalHomeRelocationPromptResponder,
    createPersonalHomeRelocationPromptResponderWithPublication,
} from '@/components/settings/server/localControl/personalHomeRelocationPromptResponder';
import { isEligiblePersonalHomeRelocationHost } from '@/components/settings/server/localControl/personalHomeRelocationEligibility';
import { runRelayRuntimeUninstallTask } from '@/components/settings/server/localControl/useLocalRelayRuntimeControl';
import { getDefaultSystemTaskRunner } from '@/components/systemTasks';
import { buildRemoteSshManageHostSystemTaskSpec } from '@/components/systemTasks/specs/remoteSsh/buildRemoteSshManageHostSystemTaskSpec';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { randomUUID } from '@/platform/randomUUID';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import {
    createAccountDirectorySession,
    parseAccountDirectoryCapability,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import { rebuildHomeSearchIndex } from '@/sync/domains/memory/searchHomeMemory';
import { getRemoteHostLocalOverrides } from '@/sync/domains/remoteHosts/remoteHostLocalOverrides';
import { readRemoteHosts } from '@/sync/domains/remoteHosts/remoteHostModel';
import { resolveRemoteHostEffectiveSshConfig } from '@/sync/domains/remoteHosts/resolveRemoteHostEffectiveSshConfig';
import {
    findPersonalHomeBootstrapCompletedProfile,
    getAccountServiceEndpointSnapshot,
    listServerProfiles,
    resolveServerProfileScopeId,
    subscribeAccountServiceEndpoint,
    type AccountServiceEndpointV1,
    type ServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { useSetting } from '@/sync/domains/state/storage';
import { resolvePreferredPublicReleaseRingLabelForCurrentApp } from '@/sync/runtime/resolvePublicReleaseRing';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { invokeDesktopHost } from '@/utils/platform/desktopHost';

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

export type PersonalHomeRuntimeOperations = Readonly<{
    /** This desktop's Personal Home profile (the receipt written at setup), when exactly one exists. */
    personalHomeProfile: ServerProfile | null;
    operations: PersonalHomeRuntimeControlOperations;
}>;

/**
 * The operations the Personal Home runtime section runs on the desktop that hosts it: backups,
 * restore, relocation to a Remote host, search repair, logs and data location, uninstall (plan
 * `2026-09-26-home-owner-console` §3.7, AM-3 — one composition, rendered by the Home console's
 * Runtime and Data pages). Runtime-scoped operations follow the managed runtime itself; only
 * profile-scoped ones (search repair, relocation, profile removal) need the Personal Home receipt.
 */
export function usePersonalHomeRuntimeOperations(params: Readonly<{
    /** Removes the saved profile from this app; offered only where the surface owns profile removal. */
    removeProfile?: (profile: ServerProfile) => Promise<void>;
    /** The saved profiles the surface already holds; defaults to the profile store. */
    profiles?: readonly ServerProfile[];
}> = {}): PersonalHomeRuntimeOperations {
    const { removeProfile, profiles } = params;
    const profilesGeneration = useServerProfilesGeneration();
    const personalHomeProfile = React.useMemo(
        () => findPersonalHomeBootstrapCompletedProfile(profiles ?? listServerProfiles()),
        [profiles, profilesGeneration],
    );
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
            ?? personalHomeProfile.homeConnectionDescriptor?.revision
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
                publication: createPersonalHomeRelocationProfilePublication(personalHomeProfile),
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
    // Runtime-scoped Personal Home operations follow the authoritative managed runtime, not a saved
    // profile receipt: removing the profile from this app must not disarm backup, restore, verify,
    // diagnostics, or safe runtime uninstall for the Home still running on this computer. Only
    // genuinely profile-scoped actions are withheld when no completed profile remains, because they
    // have no target rather than because the Home is gone.
    const personalHomeOperations = React.useMemo<PersonalHomeRuntimeControlOperations>(() => {
        const openPath = async (path: string) => {
            const normalizedPath = path.trim();
            if (!normalizedPath) throw new Error(t('settings.systemTaskOpenLogsFailed'));
            await invokeDesktopHost('system_tasks_open_log_path', { path: normalizedPath });
        };
        return {
            ...(personalHomeProfile ? {
                repairSearch: async () => {
                    await rebuildHomeSearchIndex({ serverId: resolveServerProfileScopeId(personalHomeProfile) });
                },
                ...(removeProfile ? { removeProfile: async () => await removeProfile(personalHomeProfile) } : {}),
            } : {}),
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
            // Relocation needs the adopted profile's stable Home identity and descriptor revision,
            // so it stays profile-scoped alongside search repair and profile removal.
            ...(personalHomeProfile && relocationDestinations.length > 0
                ? {
                    relocation: {
                        destinations: relocationDestinations,
                        prepare: prepareRelocation,
                        prepareRecovery: prepareRelocationRecovery,
                    },
                }
                : {}),
        };
    }, [removeProfile, personalHomeProfile, prepareRelocation, prepareRelocationRecovery, relocationDestinations]);

    return React.useMemo(() => ({ personalHomeProfile, operations: personalHomeOperations }), [personalHomeProfile, personalHomeOperations]);
}
