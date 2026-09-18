import type { AccountDisplayProfileV1 } from '@happier-dev/protocol';

export function formatAccountDisplayName(profile: AccountDisplayProfileV1): string | null {
    const fullName = [profile.firstName, profile.lastName]
        .map((part) => part?.trim() ?? '')
        .filter(Boolean)
        .join(' ');
    if (fullName) return fullName;
    const username = profile.username?.trim();
    return username ? `@${username}` : null;
}
