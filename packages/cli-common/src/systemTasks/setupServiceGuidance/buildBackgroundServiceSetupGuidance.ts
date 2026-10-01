import {
  resolvePublicReleaseRingIdForLabel,
  resolvePublicReleaseRingLabelForId,
  type PublicReleaseRingId,
  type PublicReleaseRingLabel,
} from '@happier-dev/release-runtime/releaseRings';
import type { MachineDaemonOwnershipMetadata } from '@happier-dev/protocol';

import type { ManagedReleaseChannelInventory } from '../../happierRuntime/deriveManagedReleaseChannelInventory.js';
import {
  resolveDaemonServiceInstallConflictPlan,
  type DaemonServiceInstallTarget,
} from '../../happierRuntime/daemonInstallConflict.js';
import type { HappierService, HappierServiceBackend, HappierServicePlatform, HappierServiceTargetMode } from '../../happierRuntime/types.js';

export type BackgroundServiceSetupGuidanceService = Readonly<{
  label: string;
  releaseChannel: PublicReleaseRingLabel | null;
  targetMode: HappierServiceTargetMode | null;
  running: boolean;
  serverUrl: string | null;
  happierHomeDir: string | null;
}>;

export type BackgroundServiceSetupGuidanceManualRelayOwner = Readonly<{
  currentReleaseChannel: string | null;
  currentCliVersion: string | null;
}>;

export type BackgroundServiceSetupGuidance = Readonly<{
  targetReleaseChannel: PublicReleaseRingLabel;
  targetServerUrl: string | null;
  currentHappierHomeDir: string | null;
  currentDefaultReleaseChannel: PublicReleaseRingLabel;
  managedReleaseChannels: ManagedReleaseChannelInventory['managedReleaseChannels'];
  manualRelayOwner: BackgroundServiceSetupGuidanceManualRelayOwner | null;
  exactDefaultServiceExists: boolean;
  exactDefaultServiceRunning: boolean;
  conflictingServices: readonly BackgroundServiceSetupGuidanceService[];
  foreignHomeConflictingServices: readonly BackgroundServiceSetupGuidanceService[];
  shouldOfferDefaultReleaseChannelSwitch: boolean;
  shouldPromptForManualRelayTakeover: boolean;
  shouldPromptForServiceReplacement: boolean;
}>;

/**
 * Which background service this setup converges.
 *
 * - `pinned`: an explicitly selected Home gets its own service for its server id. Daemons are
 *   per-server, so it coexists with the user's default-following service and other Homes' services
 *   (R10 D3); `serverId` is `null` until the Home has a saved profile.
 * - `default-following`: the one service that follows the terminal's active server, owned by the
 *   default release channel (R10 D2). `followedServerId` names the server it follows today so only
 *   services serving that same server compete with it.
 */
export type BackgroundServiceSetupServiceTarget =
  | Readonly<{ targetMode: 'pinned'; serverId: string | null }>
  | Readonly<{ targetMode: 'default-following'; followedServerId: string | null }>;

export type BackgroundServiceSetupReconciliationAction =
  | Readonly<{ kind: 'install'; takeover: boolean; replaceExisting?: boolean }>
  | Readonly<{ kind: 'start'; takeover: boolean }>
  | Readonly<{ kind: 'restart' }>;

export function resolveBackgroundServiceSetupReconciliationDisposition(params: Readonly<{
  guidance: BackgroundServiceSetupGuidance;
  targetChanged: boolean;
  tookOverManualRelayRuntime: boolean;
  replacedExistingServices: boolean;
  /**
   * This run changed which CLI runs this computer's service (the R12 answer is that consent): the
   * existing definition's launcher must be rewritten through the strict install, and restarted.
   */
  runtimeChanged?: boolean;
}>): readonly BackgroundServiceSetupReconciliationAction[] {
  if (params.replacedExistingServices) {
    // The install removes exactly the conflict plan's `servicesToRemove` for this target
    // (`--replace-existing=all`), never every service on the machine (R3-7).
    return [
      { kind: 'install', takeover: params.tookOverManualRelayRuntime, replaceExisting: true },
      { kind: 'start', takeover: params.tookOverManualRelayRuntime },
    ];
  }
  if (!params.guidance.exactDefaultServiceExists) {
    return [
      { kind: 'install', takeover: params.tookOverManualRelayRuntime },
      { kind: 'start', takeover: params.tookOverManualRelayRuntime },
    ];
  }
  if (params.runtimeChanged) {
    return [{ kind: 'install', takeover: params.tookOverManualRelayRuntime }, { kind: 'restart' }];
  }
  if (params.tookOverManualRelayRuntime) {
    return [{ kind: 'start', takeover: true }];
  }
  if (params.targetChanged) {
    return [{ kind: 'restart' }];
  }
  return params.guidance.exactDefaultServiceRunning
    ? []
    : [{ kind: 'start', takeover: false }];
}

function normalizeServiceSummary(service: HappierService): BackgroundServiceSetupGuidanceService | null {
  if (service.serviceType !== 'daemon') {
    return null;
  }

  const label = String(service.label ?? '').trim();
  if (!label) {
    return null;
  }

  const releaseChannel = service.ring === 'stable' || service.ring === 'preview' || service.ring === 'dev'
    ? service.ring
    : null;
  const targetMode = service.targetMode === 'default-following' || service.targetMode === 'pinned'
    ? service.targetMode
    : null;
  const serverUrl = typeof service.serverUrl === 'string' && service.serverUrl.trim()
    ? service.serverUrl.trim()
    : null;

  return {
    label,
    releaseChannel,
    targetMode,
    running: service.running === true,
    serverUrl,
    happierHomeDir: typeof service.happierHomeDir === 'string' && service.happierHomeDir.trim()
      ? service.happierHomeDir.trim()
      : null,
  };
}

export function resolveDaemonServiceBackend(platform: HappierServicePlatform, mode: 'user' | 'system'): HappierServiceBackend {
  if (platform === 'darwin') return 'launchd';
  if (platform === 'win32') return mode === 'system' ? 'schtasks-system' : 'schtasks-user';
  return mode === 'system' ? 'systemd-system' : 'systemd-user';
}

function resolveReleaseChannelLabel(value: PublicReleaseRingId | PublicReleaseRingLabel): PublicReleaseRingLabel {
  return value === 'stable' || value === 'preview' || value === 'dev'
    ? value
    : resolvePublicReleaseRingLabelForId(value);
}

function normalizeManualRelayOwner(
  owner: Pick<MachineDaemonOwnershipMetadata, 'serviceManaged' | 'publicReleaseChannel' | 'cliVersion'> | null | undefined,
): BackgroundServiceSetupGuidanceManualRelayOwner | null {
  if (!owner || owner.serviceManaged !== false) {
    return null;
  }

  const currentReleaseChannel = typeof owner.publicReleaseChannel === 'string' && owner.publicReleaseChannel.trim()
    ? owner.publicReleaseChannel.trim()
    : null;
  const currentCliVersion = typeof owner.cliVersion === 'string' && owner.cliVersion.trim()
    ? owner.cliVersion.trim()
    : null;

  return {
    currentReleaseChannel,
    currentCliVersion,
  };
}

export function resolveBackgroundServiceSetupServicesRequiringReplacement(
  guidance: Pick<BackgroundServiceSetupGuidance, 'conflictingServices' | 'foreignHomeConflictingServices'>,
): readonly BackgroundServiceSetupGuidanceService[] {
  return [
    ...guidance.conflictingServices,
    ...guidance.foreignHomeConflictingServices,
  ];
}

export function buildBackgroundServiceSetupGuidance(params: Readonly<{
  targetReleaseChannel: PublicReleaseRingId | PublicReleaseRingLabel;
  targetServerUrl?: string | null;
  currentHappierHomeDir?: string | null;
  managedReleaseChannelInventory: ManagedReleaseChannelInventory;
  services: readonly HappierService[];
  currentRelayOwner?: Pick<MachineDaemonOwnershipMetadata, 'serviceManaged' | 'publicReleaseChannel' | 'cliVersion'> | null;
  platform: HappierServicePlatform;
  mode: 'user' | 'system';
  /** Absent: the legacy ambient default-following target (terminal setup). */
  serviceTarget?: BackgroundServiceSetupServiceTarget;
  /**
   * Whether this setup may offer to switch the default release channel. An app of another channel
   * adopts the default channel's service instead of replacing it (R10 D2), so explicit desktop
   * targets pass `false`; a pinned target runs its own ring and never needs the switch.
   */
  offerDefaultReleaseChannelSwitch?: boolean;
}>): BackgroundServiceSetupGuidance {
  const targetReleaseChannel = resolveReleaseChannelLabel(params.targetReleaseChannel);
  const currentDefaultReleaseChannel = resolvePublicReleaseRingLabelForId(
    params.managedReleaseChannelInventory.defaultReleaseChannel,
  );
  const targetServerUrl = typeof params.targetServerUrl === 'string' && params.targetServerUrl.trim()
    ? params.targetServerUrl.trim()
    : null;
  const happierHomeDir = typeof params.currentHappierHomeDir === 'string' && params.currentHappierHomeDir.trim()
    ? params.currentHappierHomeDir.trim()
    : null;
  const target: DaemonServiceInstallTarget = params.serviceTarget?.targetMode === 'pinned'
    ? {
        platform: params.platform,
        backend: resolveDaemonServiceBackend(params.platform, params.mode),
        targetMode: 'pinned',
        ring: targetReleaseChannel,
        instanceId: params.serviceTarget.serverId,
        serverUrl: targetServerUrl,
        happierHomeDir,
      }
    : {
        platform: params.platform,
        backend: resolveDaemonServiceBackend(params.platform, params.mode),
        targetMode: 'default-following',
        ring: null,
        instanceId: null,
        serverUrl: null,
        happierHomeDir,
        followedServerId: params.serviceTarget?.followedServerId ?? null,
      };
  const mayOfferDefaultReleaseChannelSwitch = target.targetMode === 'default-following'
    && params.offerDefaultReleaseChannelSwitch !== false;
  const conflictPlan = resolveDaemonServiceInstallConflictPlan({
    target,
    strategy: 'require-explicit',
    services: params.services,
  });
  const currentHappierHomeDir = target.happierHomeDir ?? null;
  const foreignHomeConflictingServices = conflictPlan.foreignHomeConflicts
    .map((service) => normalizeServiceSummary(service))
    .filter((service): service is BackgroundServiceSetupGuidanceService => service != null);
  const foreignHomeConflicts = new Set(conflictPlan.foreignHomeConflicts);
  const conflictingServices = conflictPlan.competingServices
    .filter((service) => !foreignHomeConflicts.has(service))
    .map((service) => normalizeServiceSummary(service))
    .filter((service): service is BackgroundServiceSetupGuidanceService => service != null);
  const manualRelayOwner = normalizeManualRelayOwner(params.currentRelayOwner);

  return {
    targetReleaseChannel,
    targetServerUrl,
    currentHappierHomeDir,
    currentDefaultReleaseChannel,
    managedReleaseChannels: params.managedReleaseChannelInventory.managedReleaseChannels,
    manualRelayOwner,
    exactDefaultServiceExists: conflictPlan.exactTargetExists,
    exactDefaultServiceRunning: conflictPlan.exactTargetRunning,
    conflictingServices,
    foreignHomeConflictingServices,
    shouldOfferDefaultReleaseChannelSwitch:
      mayOfferDefaultReleaseChannelSwitch
      && currentDefaultReleaseChannel !== targetReleaseChannel
      && params.managedReleaseChannelInventory.managedReleaseChannels.some((entry) => (
        resolveReleaseChannelLabel(entry.releaseChannel) === targetReleaseChannel
      )),
    shouldPromptForManualRelayTakeover: manualRelayOwner != null,
    shouldPromptForServiceReplacement: resolveBackgroundServiceSetupServicesRequiringReplacement({
      conflictingServices,
      foreignHomeConflictingServices,
    }).length > 0,
  };
}
