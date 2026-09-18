import {
    serverAccountScopeKeySuffix,
    type ServerAccountScope,
} from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

/**
 * The one owner of realm-qualified device-local preference keys for a concrete
 * Session or Project.
 *
 * This used to live inside `mobileSurfacePersistence.ts`, which was fine while
 * the last mobile surface was the only such preference. Session Companion needs
 * exactly the same identity proof — a preference belongs to one Account realm on
 * one Home and one owner id — and a second delimiter scheme would let one Home's
 * layout apply to a same-ID Session on another Home or Account.
 *
 * `mobileSurfacePersistence.ts` remains the mobile-surface API and delegates
 * here; its stored key bytes are unchanged.
 */
export type SessionLocalPreferenceOwnerKind = 'session' | 'project';

export function normalizeSessionLocalPreferenceIdentityPart(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * A device-local preference belongs to the current Account realm and one concrete
 * owner. An unproven realm has no Account authority, so callers deliberately get
 * `null` instead of a bare owner-id fallback.
 */
export function resolveSessionLocalPreferenceRealm(input: Readonly<{
    activeScope: ServerAccountScope | null | undefined;
    activeServerId: string | null | undefined;
    targetServerId: string | null | undefined;
}>): ServerAccountScope | null {
    const activeScope = input.activeScope ?? null;
    const activeServerId = normalizeSessionLocalPreferenceIdentityPart(input.activeServerId);
    const targetServerId = normalizeSessionLocalPreferenceIdentityPart(input.targetServerId);
    if (!activeScope || !activeServerId || !targetServerId) return null;
    if (!areServerProfileIdentifiersEquivalent(activeScope.serverId, activeServerId)) return null;
    if (!areServerProfileIdentifiersEquivalent(activeScope.serverId, targetServerId)) return null;
    return activeScope;
}

/**
 * Length-prefixed owner ids keep `a:b` and `a` + `:b` distinct, matching the
 * scope suffix owner. Every consumer passes its own stable prefix so two
 * preference families never collide inside one local-settings map.
 */
export function buildRealmQualifiedSessionLocalPreferenceKey(input: Readonly<{
    prefix: string;
    kind: SessionLocalPreferenceOwnerKind;
    scope: ServerAccountScope;
    ownerId: string | null | undefined;
}>): string | null {
    const normalizedOwnerId = normalizeSessionLocalPreferenceIdentityPart(input.ownerId);
    if (!normalizedOwnerId) return null;
    return `${input.prefix}:${input.kind}:${serverAccountScopeKeySuffix(input.scope)}:${normalizedOwnerId.length}:${normalizedOwnerId}`;
}
