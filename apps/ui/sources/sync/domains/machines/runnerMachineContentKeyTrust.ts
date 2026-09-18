import { deriveAccountSigningPublicKey } from '@/auth/flows/challenge';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { parseToken } from '@/utils/auth/parseToken';
import type { ExpectedRunnerMachineContentKeyBindingV1 } from '@happier-dev/protocol';

/**
 * Build the independently trusted scope used to verify a Runner Machine key.
 *
 * The Home publishes the signed binding and wrapped key, but never supplies
 * its own verification identity. Legacy Account credentials are the current
 * local source of the creator signing identity. DataKey credentials remain
 * unavailable because they carry no creator-only signing authority; adding
 * one requires an explicit protocol amendment.
 */
export function resolveExpectedRunnerMachineContentKeyBindingV1(params: Readonly<{
    credentials: AuthCredentials;
    homeServerIdentityId: string | null | undefined;
    machineId: string;
}>): ExpectedRunnerMachineContentKeyBindingV1 | null {
    const homeServerIdentityId = String(params.homeServerIdentityId ?? '').trim();
    const machineId = String(params.machineId ?? '').trim();
    if (!homeServerIdentityId || !machineId || !('secret' in params.credentials)) return null;

    let creatorAccountId: string;
    let secret: Uint8Array;
    try {
        creatorAccountId = parseToken(params.credentials.token);
        secret = decodeBase64(params.credentials.secret, 'base64url');
    } catch {
        return null;
    }
    if (secret.length !== 32) return null;

    return {
        homeServerIdentityId,
        creatorAccountId,
        machineId,
        accountSigningPublicKeyBase64Url: encodeBase64(
            deriveAccountSigningPublicKey(secret),
            'base64url',
        ),
    };
}
