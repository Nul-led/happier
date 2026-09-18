import type { AuthMethodModule } from "@/app/auth/methods/types";

import {
    EMAIL_PASSWORD_AUTH_METHOD_ID,
    emailPasswordAuthMethodModule,
} from "@/app/auth/methods/modules/emailPasswordAuthMethodModule";
import { keyChallengeAuthMethodModule } from "@/app/auth/methods/modules/keyChallengeAuthMethodModule";
import { mtlsAuthMethodModule } from "@/app/auth/methods/modules/mtlsAuthMethodModule";

let staticAuthMethodModules: readonly AuthMethodModule[] | undefined;

export function resolveAuthMethodRegistry(_env: NodeJS.ProcessEnv): readonly AuthMethodModule[] {
    // Construct the static registry lazily. Auth method route modules consume the
    // auth-policy owner, whose provider collision check consumes this registry;
    // capturing imported bindings during module initialization would therefore
    // permanently retain an undefined entry under that production import order.
    staticAuthMethodModules ??= Object.freeze([
        keyChallengeAuthMethodModule,
        mtlsAuthMethodModule,
        emailPasswordAuthMethodModule,
    ] satisfies readonly AuthMethodModule[]);
    return staticAuthMethodModules;
}

export function resolveAuthMethodIdForAccountIdentityProvider(
    env: NodeJS.ProcessEnv,
    accountIdentityProviderId: string,
): string | null {
    const wanted = accountIdentityProviderId.trim().toLowerCase();
    if (!wanted) return null;
    const module = resolveAuthMethodRegistry(env).find((candidate) =>
        candidate.accountIdentityProviderId?.trim().toLowerCase() === wanted);
    return module?.id.trim().toLowerCase() ?? null;
}

/**
 * Whether an AccountIdentity belongs in generic provider/profile projections.
 * Native email rows are authentication locators managed by Account Security,
 * not provider identities. Other native methods (for example mTLS) retain
 * their existing presentation behavior.
 */
export function isAccountIdentityEligibleForGenericPresentation(
    env: NodeJS.ProcessEnv,
    accountIdentityProviderId: string,
): boolean {
    return resolveAuthMethodIdForAccountIdentityProvider(env, accountIdentityProviderId) !== EMAIL_PASSWORD_AUTH_METHOD_ID;
}
