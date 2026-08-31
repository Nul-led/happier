import type { AccountDirectoryCapabilities } from '@happier-dev/protocol';
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
import { resolveDirectoryHomeTransport } from './resolveDirectoryHomeTransport';

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
    /** Stable identity of the Home captured at login start (or at an explicit refresh retry). */
    homeServerIdentityId: string;
    /** Stable identity of the selected Account Service, verified by the caller. */
    issuerServerIdentityId: string;
    /** Observed Account Directory capability carrying the advertised assertion signing key. */
    capability: AccountDirectoryCapabilities;
    /** Explicit user-approved replacement of the Home's pinned Account Service trust facts. */
    relink?: boolean;
}>;

/**
 * Automatic current-Home relationship provisioning for the authenticated-Home login intent.
 * Resolves the captured stable identity through the canonical profile registry, composes the
 * canonical descriptor, and provisions Home trust first (authenticated with that Home's own
 * full credential through the canonical Home transport), then publishes the Home into the
 * Account Service directory. Both PUTs are idempotent; a partial failure is retried by the
 * next explicit login/refresh, never by rollback machinery. Every lookup is bound to the
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
    const resolved = resolveServerProfileForPortableIdentity(homeServerIdentityId);
    if (resolved.kind !== 'resolved') {
        return { kind: 'unavailable', reason: 'home_profile_unavailable' };
    }
    const profile = resolved.profile;
    const descriptor = buildHomeConnectionDescriptorForProfile(profile);
    if (!descriptor) {
        return { kind: 'unavailable', reason: 'home_profile_unavailable' };
    }
    const credentials = await TokenStorage.getCredentialsForServerUrl(
        profile.serverUrl,
        { serverId: homeServerIdentityId },
    ).catch(() => null);
    if (!credentials) {
        return { kind: 'unavailable', reason: 'home_credentials_unavailable' };
    }
    const transport = await resolveDirectoryHomeTransport(descriptor, {
        verification: { kind: 'authenticated', token: credentials.token },
    });
    if (!transport.ok) {
        return { kind: 'unavailable', reason: 'home_transport_unavailable' };
    }
    try {
        const account = await input.session.readAccountSummary();
        await putHomeDirectoryLink(
            transport,
            {
                issuerServerIdentityId,
                issuerSubjectId: account.accountId,
                issuerSigningKeyId: input.capability.homeLoginAssertion.keyId,
                issuerSigningPublicKeyBase64Url: input.capability.homeLoginAssertion.publicKeyBase64Url,
            },
            { credentials, relink: input.relink === true },
        );
        await input.session.putHome({
            homeServerIdentityId: descriptor.homeServerIdentityId,
            label: profile.name,
            connectionDescriptor: descriptor,
        });
        return { kind: 'linked', homeServerIdentityId };
    } catch (error) {
        if (input.relink !== true && isAccountDirectoryRelinkConflict(error)) {
            return { kind: 'relink_required', homeServerIdentityId };
        }
        return { kind: 'failed', error };
    } finally {
        await transport.close().catch(() => {});
    }
}
