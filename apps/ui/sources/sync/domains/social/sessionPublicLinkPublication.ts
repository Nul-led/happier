import type { SessionPublicLinkSettingsV1 } from '@happier-dev/protocol';

import { getRandomBytes } from '@/platform/cryptoRandom';

/**
 * The canonical publication projection plus the bearer this device generated.
 *
 * The Home stores only the bearer's hash and never returns it, so the
 * generating device is the one place a usable link can be assembled. Every
 * other field is the Protocol-owned public projection; this module adds no
 * second shape for publication settings.
 */
export type SessionPublicLinkPublication = SessionPublicLinkSettingsV1 & Readonly<{
    token: string | null;
}>;

/** Bearer material for a new publication; 12 bytes of hex, as the released link format expects. */
export function generateSessionPublicLinkBearer(): string {
    return Array.from(getRandomBytes(12), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type SessionPublicLinkReadOutcome =
    | Readonly<{ ok: true; publication: SessionPublicLinkSettingsV1 | null }>
    | Readonly<{ ok: false }>;

/**
 * A failed read preserves the last known publication rather than flashing an
 * empty link. A byte-identical successful settings read may keep the local
 * bearer for UI continuity; this is not bearer authorization, and any
 * observable publication change or absence clears it.
 */
export function mergeSessionPublicLinkWithCachedBearer(params: Readonly<{
    previousPublication: SessionPublicLinkPublication | null;
    cachedToken: string | null;
    outcome: SessionPublicLinkReadOutcome;
}>): Readonly<{ publication: SessionPublicLinkPublication | null; cachedToken: string | null }> {
    if (!params.outcome.ok) {
        return { publication: params.previousPublication, cachedToken: params.cachedToken };
    }
    if (!params.outcome.publication) {
        return { publication: null, cachedToken: null };
    }
    const previous = params.previousPublication;
    const refreshed = params.outcome.publication;
    const settingsAreIdentical = previous !== null
        && previous.id === refreshed.id
        && previous.expiresAt === refreshed.expiresAt
        && previous.maxUses === refreshed.maxUses
        && previous.useCount === refreshed.useCount
        && previous.isConsentRequired === refreshed.isConsentRequired
        && previous.updatedAt === refreshed.updatedAt;
    if (settingsAreIdentical) {
        return {
            publication: { ...refreshed, token: params.cachedToken },
            cachedToken: params.cachedToken,
        };
    }
    return {
        publication: { ...refreshed, token: null },
        cachedToken: null,
    };
}
