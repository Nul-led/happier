import {
  HOME_CARRIER_POLICY_ENV_KEY,
  readHomeApplicationCarrierEligibilityFromEnv,
  type HomeApplicationCarrierEligibility,
} from '@happier-dev/cli-common/homeEnrollment';

import { readInstalledDaemonServiceEnvValue } from './discoverInstalledDaemonServiceEntries';
import type { DaemonServicePlatform } from './plan';

/** Keep an explicit operator choice across managed-service updates and repair. */
export function resolveDaemonServiceHomeCarrierPolicy(params: Readonly<{
  processEnv: NodeJS.ProcessEnv;
  installedService?: Readonly<{ platform: DaemonServicePlatform; path: string }>;
}>): HomeApplicationCarrierEligibility | undefined {
  const requested = params.processEnv[HOME_CARRIER_POLICY_ENV_KEY];
  if (requested !== undefined) {
    return readHomeApplicationCarrierEligibilityFromEnv(params.processEnv);
  }
  if (!params.installedService) return undefined;
  const installed = readInstalledDaemonServiceEnvValue({
    ...params.installedService,
    key: HOME_CARRIER_POLICY_ENV_KEY,
  });
  return installed === null
    ? undefined
    : readHomeApplicationCarrierEligibilityFromEnv({ [HOME_CARRIER_POLICY_ENV_KEY]: installed });
}
