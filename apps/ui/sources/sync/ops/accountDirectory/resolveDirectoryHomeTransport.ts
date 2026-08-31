import type { HomeConnectionDescriptorV1 } from '@/sync/api/accountDirectory/accountDirectoryClient';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import type { HomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';

export type DirectoryHomeTransportResolution =
    | (Readonly<{
        ok: true;
    }> & HomeEnrollmentTransport)
    | Readonly<{
        ok: false;
        homeServerIdentityId: string;
        reason: 'iroh_target_transport_unavailable' | 'no_approved_endpoint';
    }>;

/**
 * Resolve a non-focused Home request target without changing the active runtime snapshot.
 * Stable canonical identity remains separate from the selected network origin.
 */
export async function resolveDirectoryHomeTransport(
    descriptor: HomeConnectionDescriptorV1,
    options: Parameters<typeof resolveHomeEnrollmentTransport>[1] = {},
): Promise<DirectoryHomeTransportResolution> {
    const resolved = await resolveHomeEnrollmentTransport(descriptor, options);
    if (resolved.ok) {
        return {
            ok: true,
            ...resolved.transport,
        };
    }
    return {
        ok: false,
        homeServerIdentityId: descriptor.homeServerIdentityId,
        reason: resolved.reason === 'iroh_transport_unavailable'
            ? 'iroh_target_transport_unavailable'
            : 'no_approved_endpoint',
    };
}
