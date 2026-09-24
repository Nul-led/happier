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

export type BackgroundServiceSetupReconciliationAction =
  | Readonly<{ kind: 'remove-existing' }>
  | Readonly<{ kind: 'install'; takeover: boolean }>
  | Readonly<{ kind: 'start'; takeover: boolean }>
  | Readonly<{ kind: 'restart' }>;

export function resolveBackgroundServiceSetupReconciliationDisposition(params: Readonly<{
  guidance: BackgroundServiceSetupGuidance;
  targetChanged: boolean;
  tookOverManualRelayRuntime: boolean;
  replacedExistingServices: boolean;
}>): readonly BackgroundServiceSetupReconciliationAction[] {
  if (params.replacedExistingServices) {
    return [
      { kind: 'remove-existing' },
      { kind: 'install', takeover: params.tookOverManualRelayRuntime },
      { kind: 'start', takeover: params.tookOverManualRelayRuntime },
    ];
  }
  if (!params.guidance.exactDefaultServiceExists) {
    return [
      { kind: 'install', takeover: params.tookOverManualRelayRuntime },
      { kind: 'start', takeover: params.tookOverManualRelayRuntime },
    ];
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
}>): BackgroundServiceSetupGuidance {
  const targetReleaseChannel = resolveReleaseChannelLabel(params.targetReleaseChannel);
  const currentDefaultReleaseChannel = resolvePublicReleaseRingLabelForId(
    params.managedReleaseChannelInventory.defaultReleaseChannel,
  );
  const target: DaemonServiceInstallTarget = {
    platform: params.platform,
    backend: resolveDaemonServiceBackend(params.platform, params.mode),
    targetMode: 'default-following',
    ring: null,
    instanceId: null,
    serverUrl: null,
    happierHomeDir: typeof params.currentHappierHomeDir === 'string' && params.currentHappierHomeDir.trim()
      ? params.currentHappierHomeDir.trim()
      : null,
  };
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
    targetServerUrl: typeof params.targetServerUrl === 'string' && params.targetServerUrl.trim()
      ? params.targetServerUrl.trim()
      : null,
    currentHappierHomeDir,
    currentDefaultReleaseChannel,
    managedReleaseChannels: params.managedReleaseChannelInventory.managedReleaseChannels,
    manualRelayOwner,
    exactDefaultServiceExists: conflictPlan.exactTargetExists,
    exactDefaultServiceRunning: conflictPlan.exactTargetRunning,
    conflictingServices,
    foreignHomeConflictingServices,
    shouldOfferDefaultReleaseChannelSwitch:
      currentDefaultReleaseChannel !== targetReleaseChannel
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
