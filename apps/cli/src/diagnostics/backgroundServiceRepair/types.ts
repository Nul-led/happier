import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import type { IrohRelayEnvConfig } from '@happier-dev/iroh-native/node';
import type { HomeApplicationCarrierEligibility } from '@happier-dev/cli-common/homeEnrollment';

import type { DaemonServiceListEntry } from '@/daemon/service/cli';
import type { DaemonServiceAutostartMode, DaemonServiceInstallEnablement, DaemonServiceManagedBy, DaemonServiceMode, DaemonServiceTargetMode } from '@/daemon/service/plan';

type PreservedServiceInstallOptions = Readonly<{
  autostart?: DaemonServiceAutostartMode;
  bundleId?: string | null;
  managedBy?: DaemonServiceManagedBy | null;
  enablement?: DaemonServiceInstallEnablement;
  preserveRunningWhenDisabled?: boolean;
}>;

export type BackgroundServiceRepairPlan = Readonly<{
  currentReleaseChannel: PublicReleaseRingId;
  existingServices: readonly DaemonServiceListEntry[];
  actions: readonly BackgroundServiceRepairAction[];
  manualWarnings: readonly string[];
}>;

export type BackgroundServiceRepairAction =
  | Readonly<{
      kind: 'remove-service';
      service: PreservedServiceInstallOptions & Readonly<{
        label: string;
        installedPath: string;
        mode: DaemonServiceMode;
        releaseChannel: PublicReleaseRingId;
        targetMode: DaemonServiceTargetMode;
        instanceId: string;
        irohRelayConfig?: IrohRelayEnvConfig;
        homeCarrierEligibility?: HomeApplicationCarrierEligibility;
      }>;
    }>
  | (PreservedServiceInstallOptions & Readonly<{
      kind: 'install-default-following-service';
      releaseChannel: PublicReleaseRingId;
      mode: DaemonServiceMode;
      irohRelayConfig?: IrohRelayEnvConfig;
      homeCarrierEligibility?: HomeApplicationCarrierEligibility;
    }>);

export type BackgroundServiceRepairApplyRuntime = Readonly<{
  platform: 'darwin' | 'linux' | 'win32';
  systemUser: string;
  uid: number | null;
  userHomeDir: string;
  happierHomeDir: string;
  nodePath?: string;
  entryPath?: string;
}>;
