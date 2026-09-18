import type { FeaturesResponse } from "@/app/features/types";
import type { AuthProviderResolver } from "@/app/auth/providers/types";
import { resolveDeploymentProviderSnapshot } from "@/app/auth/providers/providerModules";

/**
 * Bounded synchronous `/v1/features` compatibility projection of built-in and deployment providers.
 *
 * `ServerFeatureResolver`, route gates, and startup viability checks are synchronous, so they cannot
 * await the asynchronous catalog in `identityProviderCatalog.ts`. This adapter is not a second
 * authority: it owns no provider instance, executes no OAuth, decides no policy, and derives its
 * only interpretation from the same `resolveDeploymentProviderSnapshot` composition the catalog
 * uses. Live provider lookups belong to the catalog.
 */

export type OAuthProviderStatusSchema = FeaturesResponse["capabilities"]["oauth"]["providers"][string];

export function resolveDeploymentAuthProviderFeatures(env: NodeJS.ProcessEnv): Readonly<{
    providers: readonly AuthProviderResolver[];
    errors: readonly string[];
}> {
    const snapshot = resolveDeploymentProviderSnapshot(env);
    return Object.freeze({
        providers: Object.freeze(snapshot.modules.flatMap((module) => (module.auth ? [module.auth] : []))),
        errors: snapshot.errors,
    });
}

export function resolveDeploymentOAuthProviderStatuses(
    env: NodeJS.ProcessEnv,
): Record<string, OAuthProviderStatusSchema> {
    const statuses: Record<string, OAuthProviderStatusSchema> = {};
    for (const module of resolveDeploymentProviderSnapshot(env).modules) {
        if (!module.oauth) continue;
        statuses[module.oauth.id] = module.oauth.resolveStatus(env) as OAuthProviderStatusSchema;
    }
    return statuses;
}

/**
 * Whether a built-in or deployment identity provider with this id exists. Used only by the
 * synchronous friends feature projection to fail closed when a required provider is absent.
 */
export function hasDeploymentIdentityProvider(env: NodeJS.ProcessEnv, id: string): boolean {
    const normalized = id.toString().trim().toLowerCase();
    if (!normalized) return false;
    return resolveDeploymentProviderSnapshot(env).modules.some(
        (module) => Boolean(module.identity) && module.id.toString().trim().toLowerCase() === normalized,
    );
}
