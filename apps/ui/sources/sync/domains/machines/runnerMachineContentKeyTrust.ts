import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { parseToken } from '@/utils/auth/parseToken';
import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { readRunnerCreatorMachineContentKeyTrust } from '@/sync/domains/ephemeralRunner/runnerCreatorMachineContentKeyTrust';
import type { ExpectedRunnerMachineContentKeyBindingV1 } from '@happier-dev/protocol';

/**
 * Build the independently trusted scope used to verify a Runner Machine key.
 *
 * The Home publishes the signed binding and wrapped key, but never supplies its
 * own verification identity. The verifier is the creator-generated activation
 * signing identity retained device-locally by the creating device, so any
 * current credential kind — recovery-secret, DataKey or token-only — reaches
 * the same proof: no Account signing private key is involved. A device without
 * that custody resolves nothing and the Runner Machine stays unavailable, which
 * is what makes joint substitution of verifier key, binding and an
 * Account-openable envelope fail.
 */
export function resolveExpectedRunnerMachineContentKeyBindingV1(params: Readonly<{
    credentials: AuthCredentials;
    homeServerIdentityId: string | null | undefined;
    machineId: string;
}>): ExpectedRunnerMachineContentKeyBindingV1 | null {
    const homeServerIdentityId = String(params.homeServerIdentityId ?? '').trim();
    const machineId = String(params.machineId ?? '').trim();
    if (!homeServerIdentityId || !machineId) return null;

    let creatorAccountId: string;
    try {
        creatorAccountId = parseToken(params.credentials.token);
    } catch {
        return null;
    }

    const scope = createServerAccountScope(homeServerIdentityId, creatorAccountId);
    if (!scope) return null;
    const trust = readRunnerCreatorMachineContentKeyTrust(scope, machineId);
    if (!trust) return null;

    return {
        homeServerIdentityId,
        creatorAccountId,
        machineId,
        // Field name is the released shape; the value is the creator activation
        // signing public key retained device-locally, never a Home-published one.
        accountSigningPublicKeyBase64Url: trust.activationSigningPublicKey,
    };
}
