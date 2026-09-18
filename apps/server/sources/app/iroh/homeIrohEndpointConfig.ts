import {
    IROH_RELAY_POLICY_ENV_KEY,
    IROH_RELAY_URLS_ENV_KEY,
    readIrohRelayConfigFromEnv,
    type IrohRelayEnvConfig,
} from '@happier-dev/iroh-native/node';

/** Compatibility names retained for the Personal Home composition owner. */
export const HOME_IROH_RELAY_POLICY_ENV_KEY = IROH_RELAY_POLICY_ENV_KEY;
export const HOME_IROH_RELAY_URLS_ENV_KEY = IROH_RELAY_URLS_ENV_KEY;
export type HomeIrohEndpointEnvConfig = IrohRelayEnvConfig;

export function readHomeIrohEndpointConfigFromEnv(env: NodeJS.ProcessEnv): HomeIrohEndpointEnvConfig {
    return readIrohRelayConfigFromEnv(env);
}
