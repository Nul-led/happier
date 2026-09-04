import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import {
    createHomeCredentialDestinationDigestV1,
    createHomeCredentialDestinationV1,
    HomeConnectionDescriptorV1Schema,
    isHomeCredentialDestinationAllowedV1,
    type HomeConnectionDescriptorV1,
    type HomeCredentialDestinationSelectionV1,
} from '@happier-dev/protocol';
import {
    adoptHomeProfile,
    getServerProfileById,
    listServerProfiles,
    preflightHomeProfileAdoption,
    type ServerProfile,
} from './serverProfiles';

type HomeProfileAdoptionInput = Parameters<typeof adoptHomeProfile>[0];

export type AdoptHomeProfileWithCredentialsInput = HomeProfileAdoptionInput & Readonly<{
    credentials: AuthCredentials;
    shouldCancel?: () => boolean;
    credentialWriteAuthorization?: HomeProfileCredentialWriteAuthorizationV1;
}>;

/**
 * Short-lived proof that Account-Service enrollment redeemed a Home assertion through one
 * destination covered by the assertion's signed Directory descriptor. It authorizes only the
 * credential write; the profile remains advisory until authenticated Home features establish it.
 */
export type HomeProfileCredentialWriteAuthorizationV1 = Readonly<{
    kind: 'assertion_destination_binding_v1';
    descriptor: HomeConnectionDescriptorV1;
    credentialDestinationDigestBase64Url: string;
    selectedDestination: HomeCredentialDestinationSelectionV1;
}>;

const issuedCredentialWriteAuthorizations = new WeakSet<object>();

/**
 * Issues an owner-custodied, one-shot authorization after validating the assertion's canonical
 * destination projection. Structural lookalikes are rejected by the adoption owner at runtime.
 */
export function createHomeProfileCredentialWriteAuthorization(
    input: Omit<HomeProfileCredentialWriteAuthorizationV1, 'kind'>,
): HomeProfileCredentialWriteAuthorizationV1 | null {
    const descriptor = HomeConnectionDescriptorV1Schema.safeParse(input.descriptor);
    if (!descriptor.success) return null;
    try {
        if (
            createHomeCredentialDestinationDigestV1(descriptor.data)
            !== input.credentialDestinationDigestBase64Url
            || !isHomeCredentialDestinationAllowedV1(
                createHomeCredentialDestinationV1(descriptor.data),
                input.selectedDestination,
            )
        ) return null;
    } catch {
        return null;
    }
    const authorization = Object.freeze({
        kind: 'assertion_destination_binding_v1' as const,
        descriptor: descriptor.data,
        credentialDestinationDigestBase64Url: input.credentialDestinationDigestBase64Url,
        selectedDestination: input.selectedDestination,
    });
    issuedCredentialWriteAuthorizations.add(authorization);
    return authorization;
}

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
 * Directory descriptors are discovery hints, not credential-routing authority. A credential can
 * be stored only after this exact Home has been observed through a current identity-bound Home
 * connection, or through the one-shot assertion-destination authorization issued by this owner.
 */
export class HomeProfileAdoptionRequiresCurrentObservationError extends Error {
    readonly code = 'home_profile_adoption_requires_current_observation' as const;

    constructor(
        readonly canonicalServerUrl: string,
        readonly serverIdentityId: string,
    ) {
        super('Home credentials require a current identity-bound Home observation');
        this.name = 'HomeProfileAdoptionRequiresCurrentObservationError';
    }
}

function authorizesAdvisoryCredentialWrite(
    input: AdoptHomeProfileWithCredentialsInput,
): boolean {
    const authorization = input.credentialWriteAuthorization;
    if (!authorization || authorization.kind !== 'assertion_destination_binding_v1') return false;
    if (!issuedCredentialWriteAuthorizations.delete(authorization)) return false;
    const inputDescriptor = HomeConnectionDescriptorV1Schema.safeParse(input.descriptor);
    const authorizedDescriptor = HomeConnectionDescriptorV1Schema.safeParse(authorization.descriptor);
    if (!inputDescriptor.success || !authorizedDescriptor.success) return false;
    if (JSON.stringify(inputDescriptor.data) !== JSON.stringify(authorizedDescriptor.data)) return false;
    try {
        if (
            createHomeCredentialDestinationDigestV1(authorizedDescriptor.data)
            !== authorization.credentialDestinationDigestBase64Url
        ) return false;
        return isHomeCredentialDestinationAllowedV1(
            createHomeCredentialDestinationV1(authorizedDescriptor.data),
            authorization.selectedDestination,
        );
    } catch {
        return false;
    }
}

export type HomeProfileCanonicalUrlMigrationResult =
    | Readonly<{ kind: 'adopted'; profile: ServerProfile }>
    | Readonly<{
        kind: 'migrated';
        profile: ServerProfile;
        fromCanonicalServerUrl: string;
        toCanonicalServerUrl: string;
    }>;

/**
 * The profile move committed, but its credential verification or obsolete URL-scope
 * cleanup could not be completed. Callers receive the exact incomplete stage rather
 * than a clean success or an ambiguous generic failure.
 */
export class HomeProfileCanonicalUrlMigrationPartialCommitError extends Error {
    readonly code = 'home_profile_canonical_url_migration_partial_commit' as const;

    constructor(
        readonly stage: 'destination_credential_verification' | 'obsolete_credential_cleanup',
        readonly serverIdentityId: string,
        readonly fromCanonicalServerUrl: string,
        readonly toCanonicalServerUrl: string,
        readonly profile: ServerProfile,
    ) {
        super('Home canonical URL migration did not complete its credential transaction');
        this.name = 'HomeProfileCanonicalUrlMigrationPartialCommitError';
    }
}

/**
 * Authoritative same-identity canonical URL migration. A Home that proves the same stable
 * identity may move its canonical URL through this one transaction. The profile owner
 * decides the move (so label, aliases, groups, focus pointers and unrelated Homes are
 * preserved by construction); the credential remains in its canonical identity scope,
 * is verified through the destination URL, and only obsolete URL-hash aliases are removed.
 * An incomplete verification or cleanup surfaces typed partial-commit facts instead of a
 * clean result. Advisory descriptors can never reach the migration branch: the profile
 * owner keeps their target pinned to the established URL.
 */
export async function adoptHomeProfileWithCanonicalUrlMigration(
    input: HomeProfileAdoptionInput,
): Promise<HomeProfileCanonicalUrlMigrationResult> {
    const target = preflightHomeProfileAdoption(input);
    const identity = target.serverIdentityId;
    const existing = identity ? getServerProfileById(identity) : null;
    const fromCanonicalServerUrl = existing
        ? existing.canonicalServerUrl ?? existing.serverUrl
        : null;
    const toCanonicalServerUrl = target.canonicalServerUrl;
    if (
        !identity
        || !existing
        || existing.serverIdentityId !== identity
        || !fromCanonicalServerUrl
        || fromCanonicalServerUrl === toCanonicalServerUrl
    ) {
        return { kind: 'adopted', profile: await adoptHomeProfile(input) };
    }

    const credentials = await TokenStorage.getCredentialsForServerUrl(
        fromCanonicalServerUrl,
        { serverId: identity },
    );
    // Credentials are canonically keyed by stable Home identity, not URL. The
    // old-URL read above also migrates a supported legacy URL-hash credential
    // into that identity scope. Rewriting it at the destination before the
    // profile moves would correctly be rejected as an identity/URL conflict.
    const profile = await adoptHomeProfile(input);
    // Revision adjudication may legitimately decline the move. The identity-keyed
    // credential was never rewritten, so the unchanged profile remains coherent.
    if ((profile.canonicalServerUrl ?? profile.serverUrl) !== toCanonicalServerUrl) {
        return { kind: 'adopted', profile };
    }

    if (credentials) {
        const destinationCredentials = await TokenStorage.getCredentialsForServerUrl(
            toCanonicalServerUrl,
            { serverId: identity },
        );
        if (JSON.stringify(destinationCredentials) !== JSON.stringify(credentials)) {
            throw new HomeProfileCanonicalUrlMigrationPartialCommitError(
                'destination_credential_verification',
                identity,
                fromCanonicalServerUrl,
                toCanonicalServerUrl,
                profile,
            );
        }
    }

    // Cleanup targets the obsolete URL scope only. A Home that now occupies that URL
    // owns its own credentials, so the obsolete slot is left to its owner instead.
    const obsoleteUrlReassigned = listServerProfiles().some((candidate) => (
        candidate.id !== profile.id
        && ((candidate.canonicalServerUrl ?? candidate.serverUrl) === fromCanonicalServerUrl
            || candidate.serverUrl === fromCanonicalServerUrl)
    ));
    if (
        credentials
        && !obsoleteUrlReassigned
        && !await TokenStorage.removeCredentialsForServerUrl(fromCanonicalServerUrl)
    ) {
        throw new HomeProfileCanonicalUrlMigrationPartialCommitError(
            'obsolete_credential_cleanup',
            identity,
            fromCanonicalServerUrl,
            toCanonicalServerUrl,
            profile,
        );
    }
    return { kind: 'migrated', profile, fromCanonicalServerUrl, toCanonicalServerUrl };
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
    if (
        target.credentialWrite === 'requiresCurrentObservation'
        && !authorizesAdvisoryCredentialWrite(input)
    ) {
        throw new HomeProfileAdoptionRequiresCurrentObservationError(
            target.canonicalServerUrl,
            target.serverIdentityId,
        );
    }
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
