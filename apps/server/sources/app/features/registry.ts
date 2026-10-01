import { resolveServerFeatureDecisions, resolveServerFeaturePayload } from './catalog/resolveServerFeaturePayload';
import {
    serverFeatureRegistry,
    type ServerFeatureResolver,
} from './catalog/serverFeatureRegistry';

export type FeatureResolver = ServerFeatureResolver;
// Defaults read `serverFeatureRegistry` when called, not at module load: the feature resolvers
// import auth owners that reach Home settings, which import this module back, so a value
// captured at load can be `undefined` for the whole process depending on import order.

export function resolveFeaturesFromEnv(
    env: NodeJS.ProcessEnv,
    resolvers: readonly FeatureResolver[] = serverFeatureRegistry,
) {
    return resolveServerFeaturePayload(env, resolvers);
}

/** Typed on/off reasons for every server feature under `env` (see `resolveServerFeatureDecisions`). */
export function resolveFeatureDecisionsFromEnv(
    env: NodeJS.ProcessEnv,
    resolvers: readonly FeatureResolver[] = serverFeatureRegistry,
) {
    return resolveServerFeatureDecisions(env, resolvers);
}
