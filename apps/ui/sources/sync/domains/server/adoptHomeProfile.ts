import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import {
    adoptHomeProfile,
    preflightHomeProfileAdoption,
    type ServerProfile,
} from './serverProfiles';

export type AdoptHomeProfileWithCredentialsInput = Parameters<typeof adoptHomeProfile>[0] & Readonly<{
    credentials: AuthCredentials;
    shouldCancel?: () => boolean;
}>;

export type HomeProfileCredentialRollbackOutcome =
    | Readonly<{ kind: 'succeeded' }>
    | Readonly<{ kind: 'not_applied'; reason: 'ownership_changed' }>
    | Readonly<{ kind: 'failed'; error: unknown }>;

/**
 * Credential persistence succeeded, but profile adoption did not and the exact
 * attempted write could not be rolled back. Callers must surface this as a
 * recoverable partial state rather than reporting a clean adoption failure.
 */
export class HomeProfileAdoptionPartialCommitError extends Error {
    readonly code = 'home_profile_adoption_partial_commit' as const;

    constructor(
        readonly adoptionError: unknown,
        readonly canonicalServerUrl: string,
        readonly serverIdentityId: string,
        readonly rollbackOutcome: Exclude<HomeProfileCredentialRollbackOutcome, { kind: 'succeeded' }>,
    ) {
        super('Home credential was stored, but profile adoption did not complete');
        this.name = 'HomeProfileAdoptionPartialCommitError';
    }
}

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
        ...(input.descriptorAuthority !== undefined
            ? { descriptorAuthority: input.descriptorAuthority }
            : {}),
    } satisfies Parameters<typeof preflightHomeProfileAdoption>[0];
    const target = preflightHomeProfileAdoption(adoption);
    if (!target.serverIdentityId) throw new Error('Credentialed Home adoption requires a stable identity');
    if (input.shouldCancel?.()) throw new Error('Home credential adoption cancelled');
    // Advisory discovery never overwrites an established credential. A signed-out
    // established Home still accepts the newly issued credential in its canonical
    // slot, while its established descriptor facts remain unchanged.
    if (target.credentialWrite === 'preserveExisting') {
        const established = await TokenStorage.getCredentialsForServerUrl(
            target.canonicalServerUrl,
            { serverId: target.serverIdentityId },
        );
        if (established) {
            if (input.shouldCancel?.()) throw new Error('Home credential adoption cancelled');
            return await adoptHomeProfile(adoption);
        }
    }
    const credentialWrite = await TokenStorage.setCredentialsForServerUrlWithRollback(
        target.canonicalServerUrl,
        { serverId: target.serverIdentityId },
        input.credentials,
    );
    if (!credentialWrite) {
        throw new Error('Unable to store Home credentials');
    }

    try {
        if (input.shouldCancel?.()) throw new Error('Home credential adoption cancelled');
        return await adoptHomeProfile(adoption);
    } catch (adoptionError) {
        let rollbackApplied: boolean;
        try {
            rollbackApplied = await credentialWrite.rollback();
        } catch (rollbackError) {
            throw new HomeProfileAdoptionPartialCommitError(
                adoptionError,
                target.canonicalServerUrl,
                target.serverIdentityId,
                { kind: 'failed', error: rollbackError },
            );
        }
        if (!rollbackApplied) {
            throw new HomeProfileAdoptionPartialCommitError(
                adoptionError,
                target.canonicalServerUrl,
                target.serverIdentityId,
                { kind: 'not_applied', reason: 'ownership_changed' },
            );
        }
        throw adoptionError;
    }
}
