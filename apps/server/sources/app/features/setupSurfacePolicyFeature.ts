import type { FeaturesPayloadDelta } from './types';

/**
 * Fixed deployment policy for setup and remote-host surfaces.
 *
 * These values are intentionally not configurable through feature-specific
 * environment variables. Keeping them in one explicit resolver gives every
 * represented server feature a discoverable producer before build-policy and
 * dependency closure are applied by the payload assembler.
 */
export function resolveSetupSurfacePolicyFeature(): FeaturesPayloadDelta {
    return {
        features: {
            setup: {
                relay: {
                    allowRelaySelection: { enabled: true },
                    allowHappierCloud: { enabled: true },
                    allowCustomRelayUrl: { enabled: true },
                    allowLocalRelayHost: { enabled: true },
                    allowRemoteSshRelayHost: { enabled: true },
                },
                relayAccess: {
                    allowTailscale: { enabled: true },
                    allowCloudflareTunnel: { enabled: true },
                },
            },
            remoteHosts: {
                management: { enabled: true },
                secretMaterial: { enabled: false },
            },
        },
    };
}
