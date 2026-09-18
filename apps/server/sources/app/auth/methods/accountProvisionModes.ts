import type { AccountProvisionMode } from "@/app/auth/methods/types";

import { resolveKeylessAccountsAvailability } from "@/app/features/e2ee/resolveKeylessAccountsEnabled";

/**
 * Account protection modes a Home currently admits for new Accounts, read from
 * the existing encryption/storage policy owner.
 *
 * E2EE is always admissible. Plain (keyless) is admissible only when keyless
 * accounts are enabled and the storage policy does not require E2EE. This is a
 * projection of that one owner, not a second or password-specific policy.
 */
export function resolveAllowedAccountProvisionModes(
    env: NodeJS.ProcessEnv,
): readonly AccountProvisionMode[] {
    return resolveKeylessAccountsAvailability(env).ok
        ? Object.freeze<AccountProvisionMode[]>(["plain", "e2ee"])
        : Object.freeze<AccountProvisionMode[]>(["e2ee"]);
}

/**
 * The Home's recommended default protection for a new Account. With both modes
 * permitted the existing encryption posture recommends nothing in particular and
 * the client presents the explicit choice.
 */
export function resolveRecommendedAccountProvisionMode(
    env: NodeJS.ProcessEnv,
): AccountProvisionMode | null {
    const allowed = resolveAllowedAccountProvisionModes(env);
    return allowed.length === 1 ? allowed[0]! : null;
}
