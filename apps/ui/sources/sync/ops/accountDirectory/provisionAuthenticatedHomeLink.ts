import type { AccountDirectoryCapabilities } from '@happier-dev/protocol';
import { publishAccountServiceHomeLink } from '@happier-dev/cli-common/accountService';
import {
    isAccountDirectoryRelinkConflict,
    putHomeDirectoryLink,
} from '@/sync/api/accountDirectory/accountDirectoryClient';
import type { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import {
    buildHomeConnectionDescriptorForProfile,
    resolveServerProfileForPortableIdentity,
} from '@/sync/domains/server/serverProfiles';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';

export type AuthenticatedHomeLinkProvisionResult =
    | Readonly<{ kind: 'linked'; homeServerIdentityId: string }>
    | Readonly<{ kind: 'relink_required'; homeServerIdentityId: string }>
    | Readonly<{
        kind: 'unavailable';
        reason:
            | 'home_profile_unavailable'
            | 'home_credentials_unavailable'
            | 'home_transport_unavailable';
    }>
    | Readonly<{ kind: 'failed'; error?: unknown }>;

export type ProvisionAuthenticatedHomeLinkInput = Readonly<{
    session: AccountDirectorySession;
    /** Stable identity of the Home captured when the explicit link intent began. */
    homeServerIdentityId: string;
    /** Stable identity of the selected Account Service, verified by the caller. */
    issuerServerIdentityId: string;
    /** Observed Account Directory capability carrying the advertised assertion signing key. */
    capability: AccountDirectoryCapabilities;
    /** Explicit user-approved replacement of the Home's pinned Account Service trust facts. */
    relink?: boolean;
    shouldCancel?: () => boolean;
}>;

class HomeLinkTransportUnavailableError extends Error {}

/**
 * Automatic current-Home relationship provisioning for the authenticated-Home login intent.
 * Resolves the captured stable identity through the canonical profile registry, composes the
 * canonical descriptor, and provisions Home trust first (authenticated with that Home's own
 * full credential through the canonical Home transport), then publishes the Home into the
 * Account Service directory. Both PUTs are idempotent; a partial failure is retried only by
 * repeating this explicit linking action, never by ordinary Directory refresh or rollback
 * machinery. Every lookup is bound to the
 * captured identity — focus is never consulted, and missing profile, credentials, or an
 * approved transport fail closed without publishing an untrusted directory row. Pure-Iroh
 * descriptors acquire the shared verified Lane06 origin through HomeEnrollmentTransport.
 */
export async function provisionAuthenticatedHomeLink(
    input: ProvisionAuthenticatedHomeLinkInput,
): Promise<AuthenticatedHomeLinkProvisionResult> {
    const homeServerIdentityId = input.homeServerIdentityId.trim();
    const issuerServerIdentityId = input.issuerServerIdentityId.trim();
    if (!homeServerIdentityId || !issuerServerIdentityId) {
        return { kind: 'unavailable', reason: 'home_profile_unavailable' };
    }
    if (input.shouldCancel?.()) return { kind: 'failed' };
    const resolved = resolveServerProfileForPortableIdentity(homeServerIdentityId);
    if (resolved.kind !== 'resolved') {
        return { kind: 'unavailable', reason: 'home_profile_unavailable' };
    }
    const profile = resolved.profile;
    const descriptor = buildHomeConnectionDescriptorForProfile(profile);
    if (!descriptor || descriptor.homeServerIdentityId !== homeServerIdentityId) {
        return { kind: 'unavailable', reason: 'home_profile_unavailable' };
    }
    const directoryHome = {
        homeServerIdentityId: descriptor.homeServerIdentityId,
        canonicalServerUrl: descriptor.canonicalServerUrl,
        label: profile.name,
        connectionDescriptor: descriptor,
    };
    const selectedIssuerIdentity = input.session.serviceKey.slice(
        input.session.serviceKey.lastIndexOf('\u0000') + 1,
    );
    const result = await publishAccountServiceHomeLink({
        home: directoryHome,
        issuerServerIdentityId,
        issuerSigningKeyId: input.capability.homeLoginAssertion.keyId,
        issuerSigningPublicKeyBase64Url: input.capability.homeLoginAssertion.publicKeyBase64Url,
        ...(input.relink !== undefined ? { relink: input.relink } : {}),
        shouldCancel: input.shouldCancel,
        adapters: {
            readHomeCredential: async () => await TokenStorage.getCredentialsForServerUrl(
                profile.serverUrl,
                { serverId: homeServerIdentityId },
            ).catch(() => null),
            readAccountServiceCredential: async (identity) =>
                identity === selectedIssuerIdentity ? input.session : null,
            readAccountSubject: async (session) => (await session.readAccountSummary()).accountId,
            publishLinkToHome: async ({ credential, issuerSubjectId, relink }) => {
                const resolvedTransport = await resolveHomeEnrollmentTransport(descriptor, {
                    verification: { kind: 'authenticated', token: credential.token },
                });
                if (!resolvedTransport.ok) throw new HomeLinkTransportUnavailableError();
                try {
                    await putHomeDirectoryLink(
                        resolvedTransport.transport,
                        {
                            issuerServerIdentityId,
                            issuerSubjectId,
                            issuerSigningKeyId: input.capability.homeLoginAssertion.keyId,
                            issuerSigningPublicKeyBase64Url: input.capability.homeLoginAssertion.publicKeyBase64Url,
                        },
                        { credentials: credential, relink },
                    );
                } finally {
                    await resolvedTransport.transport.close().catch(() => {});
                }
            },
            publishHomeToAccountService: async ({ home, credential: session }) => {
                await session.putHome({
                    homeServerIdentityId: home.homeServerIdentityId,
                    label: home.label,
                    connectionDescriptor: home.connectionDescriptor,
                });
            },
        },
    });
    if (result.kind === 'linked') return result;
    if (result.kind === 'cancelled') return { kind: 'failed' };
    if (result.kind === 'unavailable') {
        return result.reason === 'home_credentials_unavailable'
            ? { kind: 'unavailable', reason: 'home_credentials_unavailable' }
            : { kind: 'failed' };
    }
    if (result.error instanceof HomeLinkTransportUnavailableError) {
        return { kind: 'unavailable', reason: 'home_transport_unavailable' };
    }
    if (input.relink !== true && isAccountDirectoryRelinkConflict(result.error)) {
        return { kind: 'relink_required', homeServerIdentityId };
    }
    return { kind: 'failed', error: result.error };
}
