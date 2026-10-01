import {
  IROH_RELAY_POLICY_ENV_KEY,
  IROH_RELAY_URLS_ENV_KEY,
  readIrohRelayConfigFromEnv,
  type IrohRelayEnvConfig,
} from '@happier-dev/iroh-native/node';

import { readInstalledDaemonServiceEnvValue } from './discoverInstalledDaemonServiceEntries';
import type { DaemonServicePlatform } from './plan';

export function resolveDaemonServiceIrohRelayConfig(params: Readonly<{
  processEnv: NodeJS.ProcessEnv;
  installedService?: Readonly<{
    platform: DaemonServicePlatform;
    path: string;
  }>;
}>): IrohRelayEnvConfig {
  const requested = readIrohRelayConfigFromEnv(params.processEnv);
  if (requested.explicitlyConfigured || !params.installedService) {
    return requested;
  }

  return readIrohRelayConfigFromEnv({
    [IROH_RELAY_POLICY_ENV_KEY]: readInstalledDaemonServiceEnvValue({
      ...params.installedService,
      key: IROH_RELAY_POLICY_ENV_KEY,
    }) ?? undefined,
    [IROH_RELAY_URLS_ENV_KEY]: readInstalledDaemonServiceEnvValue({
      ...params.installedService,
      key: IROH_RELAY_URLS_ENV_KEY,
    }) ?? undefined,
  });
}
