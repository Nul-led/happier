import { getPublicUrl } from "@/storage/blob/files";
import {
    AccountDisplayProfileV1Schema,
    ReleasedDirectSessionShareProfileV1Schema,
    type AccountDisplayProfileV1,
    type ReleasedDirectSessionShareProfileV1,
} from "@happier-dev/protocol";

/**
 * The one select every neutral Account display projection uses.
 *
 * `id` is selected so callers can key a batch lookup by Account; it is not part
 * of the neutral display profile and must be attached by the caller's own
 * authorized identity projection when a consumer needs it.
 */
export const ACCOUNT_DISPLAY_PROFILE_SELECT = {
    id: true,
    firstName: true,
    lastName: true,
    username: true,
    avatar: true,
} as const;

export type AccountDisplayProfileRow = Readonly<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    avatar: unknown;
}>;

/**
 * Stored avatars are a `[ImageRef]` JSON column. A malformed or absent value is
 * a presentation downgrade, never a raw storage path on the wire.
 */
function resolveAccountAvatarUrl(avatar: unknown): string | null {
    if (!avatar || typeof avatar !== "object" || Array.isArray(avatar)) return null;
    const path = (avatar as { path?: unknown }).path;
    return typeof path === "string" && path.length > 0 ? getPublicUrl(path) : null;
}

/**
 * Projects one Home Account row into the neutral display fields that are safe
 * to disclose beside an already-authorized resource. Never returns identity,
 * email, role, relationship, key, or access information.
 */
export function projectAccountDisplayProfileV1(row: AccountDisplayProfileRow): AccountDisplayProfileV1 {
    return AccountDisplayProfileV1Schema.parse({
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        avatarUrl: resolveAccountAvatarUrl(row.avatar),
    });
}

/**
 * Released direct-share/public-owner wire shape. It is the same projection with
 * the Account id and the historical `avatar` field name that those APIs
 * already publish; keep it thin rather than reintroducing a second projector.
 */
export function toShareUserProfile(row: AccountDisplayProfileRow): ReleasedDirectSessionShareProfileV1 {
    const profile = projectAccountDisplayProfileV1(row);
    return ReleasedDirectSessionShareProfileV1Schema.parse({
        id: row.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        username: profile.username,
        avatar: profile.avatarUrl,
    });
}
