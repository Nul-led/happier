import { getFeatureBuildPolicyDecision } from '@/sync/domains/features/featureBuildPolicy';
import { readConfiguredServerUrlEnv } from '../readConfiguredServerUrlEnv';
import { desktopHostKind } from '@/utils/platform/desktopHost';

export type SetupSurfacePolicy = Readonly<{
    relay: Readonly<{
        allowRelaySelection: boolean;
        allowHappierCloud: boolean;
        allowCustomRelayUrl: boolean;
        allowLocalRelayHost: boolean;
        allowRemoteSshRelayHost: boolean;
        enforcedServerUrl: string | null;
    }>;
    machine: Readonly<{
        allowLocalMachineSetup: boolean;
        allowRemoteSshMachineSetup: boolean;
    }>;
    providers: Readonly<{
        allowProviderSetup: boolean;
    }>;
    relayAccess: Readonly<{
        allowTailscale: boolean;
        allowCloudflareTunnel: boolean;
    }>;
}>;

function isAllowedByBuildPolicy(featureId: Parameters<typeof getFeatureBuildPolicyDecision>[0]): boolean {
    return getFeatureBuildPolicyDecision(featureId) !== 'deny';
}

export function resolveSetupSurfacePolicy(): SetupSurfacePolicy {
    const allowRelaySelection = isAllowedByBuildPolicy('setup.relay.allowRelaySelection');
    const configuredServerUrl = readConfiguredServerUrlEnv();

    return {
        relay: {
            allowRelaySelection,
            allowHappierCloud: isAllowedByBuildPolicy('setup.relay.allowHappierCloud'),
            allowCustomRelayUrl: isAllowedByBuildPolicy('setup.relay.allowCustomRelayUrl'),
            allowLocalRelayHost: isAllowedByBuildPolicy('setup.relay.allowLocalRelayHost'),
            allowRemoteSshRelayHost: isAllowedByBuildPolicy('setup.relay.allowRemoteSshRelayHost'),
            enforcedServerUrl: !allowRelaySelection && configuredServerUrl ? configuredServerUrl : null,
        },
        machine: {
            allowLocalMachineSetup: isAllowedByBuildPolicy('setup.machine.allowLocalMachineSetup'),
            allowRemoteSshMachineSetup: isAllowedByBuildPolicy('setup.machine.allowRemoteSshMachineSetup'),
        },
        providers: {
            allowProviderSetup: isAllowedByBuildPolicy('setup.providers.allowProviderSetup'),
        },
        relayAccess: {
            allowTailscale: isAllowedByBuildPolicy('setup.relayAccess.allowTailscale'),
            allowCloudflareTunnel: isAllowedByBuildPolicy('setup.relayAccess.allowCloudflareTunnel'),
        },
    };
}

/**
 * Whether this device can create and run a Personal Home: only the desktop app hosts one, and only
 * where the build lets the person choose a Home and host it locally. Every "Create a Personal Home"
 * entry (welcome, the Add a Home sheet) asks this one question.
 */
export function canHostPersonalHomeHere(policy: SetupSurfacePolicy = resolveSetupSurfacePolicy()): boolean {
    return desktopHostKind() === 'tauri'
        && policy.relay.allowRelaySelection
        && policy.relay.allowLocalRelayHost;
}

/** Server Home setup also allows the desktop SSH relay-host task. */
export function canSetUpServerHomeHere(policy: SetupSurfacePolicy = resolveSetupSurfacePolicy()): boolean {
    return desktopHostKind() === 'tauri'
        && policy.relay.allowRelaySelection
        && (policy.relay.allowLocalRelayHost || policy.relay.allowRemoteSshRelayHost);
}
