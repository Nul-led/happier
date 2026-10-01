import * as React from 'react';

import { settingRendersOnHost } from '@/components/settings/catalog/settingDeclarations';
import { SERVERS_SETTINGS } from '@/components/settings/server/serverSettings';
import { getDefaultSystemTaskRunner } from '@/components/systemTasks';
import { buildRemoteSshManageHostSystemTaskSpec } from '@/components/systemTasks/specs/remoteSsh/buildRemoteSshManageHostSystemTaskSpec';
import { buildLocalRelayRuntimeSystemTaskSpec } from '@/components/systemTasks/specs/localControl/buildLocalRelayRuntimeSystemTaskSpec';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { useSetting } from '@/sync/domains/state/storage';
import { readRemoteHosts } from '@/sync/domains/remoteHosts/remoteHostModel';
import { getRemoteHostLocalOverrides } from '@/sync/domains/remoteHosts/remoteHostLocalOverrides';
import { resolveRemoteHostEffectiveSshConfig } from '@/sync/domains/remoteHosts/resolveRemoteHostEffectiveSshConfig';
import {
    findPersonalHomeBootstrapCompletedProfile,
    listServerProfiles,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';
import { machineCapabilitiesInvoke } from '@/sync/ops/capabilities';
import { resolvePreferredPublicReleaseRingLabelForCurrentApp } from '@/sync/runtime/resolvePublicReleaseRing';
import { sync } from '@/sync/sync';

import { resolveHomeRuntimeExecutor, type HomeRuntimeExecutor } from './resolveHomeRuntimeExecutor';

export { homeRuntimeExecutorCanAct, resolveHomeRuntimeExecutor, type HomeRuntimeExecutor } from './resolveHomeRuntimeExecutor';

/** The executor for one Home on this device, from the live profile and Remote host facts. */
export function useHomeRuntimeExecutor(serverId: string, flavor: 'light' | 'full' | null): HomeRuntimeExecutor {
    const profilesGeneration = useServerProfilesGeneration();
    const profiles = React.useMemo(() => listServerProfiles(), [profilesGeneration]);
    const remoteHostsRaw = useSetting('remoteHostsV1');
    return React.useMemo(() => {
        const locallyHosted = findPersonalHomeBootstrapCompletedProfile(profiles);
        const scopeIdById = new Map(profiles.map((profile) => [profile.id, resolveServerProfileScopeId(profile)]));
        return resolveHomeRuntimeExecutor({
            serverId,
            flavor,
            localBridgeAvailable: settingRendersOnHost(SERVERS_SETTINGS.settings.accessMethod)
                && getDefaultSystemTaskRunner().mode !== 'unavailable',
            locallyHostedServerId: locallyHosted ? resolveServerProfileScopeId(locallyHosted) : null,
            remoteHosts: readRemoteHosts(remoteHostsRaw),
            scopeIdOfProfile: (profileId) => scopeIdById.get(profileId) ?? null,
        });
    }, [serverId, flavor, profiles, remoteHostsRaw]);
}

export type HomeRuntimeRestartOutcome =
    | Readonly<{ kind: 'started' }>
    | Readonly<{ kind: 'failed'; message: string | null }>;

/**
 * Restarts the runtime of a Home through its executor: the same relay-runtime restart task every
 * surface runs (Runtime's Restart, Server settings' Restart now), never a second restart path.
 */
export async function restartHomeRuntime(
    executor: HomeRuntimeExecutor,
    context: Readonly<{ serverId: string; secretMaterialAllowed: boolean }>,
): Promise<HomeRuntimeRestartOutcome> {
    try {
        switch (executor.kind) {
            case 'hosting_desktop': {
                await getDefaultSystemTaskRunner().start(buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.restart.v1'));
                return { kind: 'started' };
            }
            case 'remote_host': {
                const host = executor.host;
                const resolved = await resolveRemoteHostEffectiveSshConfig({
                    remoteHost: host,
                    localOverrides: getRemoteHostLocalOverrides(host.id),
                    secretMaterialAllowed: context.secretMaterialAllowed,
                    decryptSecretValue: (input) => sync.decryptSecretValue(input),
                });
                if (!resolved.ok) return { kind: 'failed', message: resolved.error.message };
                const channel = resolvePreferredPublicReleaseRingLabelForCurrentApp();
                await getDefaultSystemTaskRunner().start(buildRemoteSshManageHostSystemTaskSpec({
                    action: 'relayRuntime.restart',
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
                }));
                return { kind: 'started' };
            }
            case 'connected_machine': {
                const started = await machineCapabilitiesInvoke(executor.machineId, {
                    id: 'tool.systemTasks',
                    method: 'start',
                    params: { spec: buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.restart.v1') },
                }, { serverId: context.serverId });
                if (!started.supported) return { kind: 'failed', message: null };
                return started.response.ok ? { kind: 'started' } : { kind: 'failed', message: null };
            }
            case 'elsewhere':
            case 'deployment':
                return { kind: 'failed', message: null };
        }
    } catch (error) {
        return { kind: 'failed', message: error instanceof Error ? error.message : null };
    }
}
