import { getServerProfileById } from './serverProfiles';

/**
 * Maps an already-selected device-local routing/profile id to its portable
 * server identity without inventing an identity for an unknown profile.
 */
export function resolvePortableServerIdentityForRoutingId(
    serverId: string | null | undefined,
): string | null {
    const profile = getServerProfileById(String(serverId ?? '').trim());
    return profile?.serverIdentityId?.trim() || null;
}
