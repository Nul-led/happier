import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import {
    adoptHomeProfile,
    preflightHomeProfileAdoption,
    type ServerProfile,
} from './serverProfiles';

export type AdoptHomeProfileWithCredentialsInput = Parameters<typeof adoptHomeProfile>[0] & Readonly<{
    credentials: AuthCredentials;
}>;

/**
 * Non-focusing credential adoption composition. The profile owner validates the exact target
 * without mutation, credentials are written under that canonical target, and the same owner
 * revalidates before adopting the profile. A storage failure leaves profile/focus state intact;
 * a later adoption failure rolls back the exact credential write before surfacing that failure.
 */
export async function adoptHomeProfileWithCredentials(
    input: AdoptHomeProfileWithCredentialsInput,
): Promise<ServerProfile> {
    const adoption = {
        descriptor: input.descriptor,
        source: input.source,
        ...(input.preserveUserLabel !== undefined
            ? { preserveUserLabel: input.preserveUserLabel }
            : {}),
        ...(input.suggestedName !== undefined ? { suggestedName: input.suggestedName } : {}),
    } satisfies Parameters<typeof preflightHomeProfileAdoption>[0];
    const target = preflightHomeProfileAdoption(adoption);
    if (!target.serverIdentityId) throw new Error('Credentialed Home adoption requires a stable identity');
    const credentialWrite = await TokenStorage.setCredentialsForServerUrlWithRollback(
        target.canonicalServerUrl,
        { serverId: target.serverIdentityId },
        input.credentials,
    );
    if (!credentialWrite) throw new Error('Unable to store Home credentials');

    try {
        return await adoptHomeProfile(adoption);
    } catch (error) {
        try {
            await credentialWrite.rollback();
        } catch {
            // Preserve the adoption failure: it is the authoritative reason the
            // composition did not commit, even when best-effort rollback fails.
        }
        throw error;
    }
}
