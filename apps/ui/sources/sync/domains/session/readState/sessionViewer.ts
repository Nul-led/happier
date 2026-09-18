import { SessionViewerProjectionV1Schema, type SessionViewerProjectionV1 } from '@happier-dev/protocol';
import {
    isSessionAccessOwner,
    type NormalizedSessionAccessProjection,
} from '@/sync/engine/sessions/normalizeSessionAccessProjection';

type SessionViewerTrackingInput = Readonly<{
    viewer?: unknown;
    owner?: string;
    accessLevel?: 'view' | 'edit' | 'admin';
    access?: NormalizedSessionAccessProjection | null;
}>;

type NormalizedSessionViewerCompatibility =
    | Readonly<{ kind: 'current'; viewer: SessionViewerProjectionV1 }>
    | Readonly<{ kind: 'legacy_owner' }>
    | Readonly<{ kind: 'untracked' }>;

/**
 * Single UI compatibility decision for current viewer facts and released
 * pre-viewer rows. A malformed current projection is evidence of neither a
 * viewer nor an owner, so it fails closed instead of entering the legacy path.
 */
export function normalizeSessionViewerCompatibility(
    session: SessionViewerTrackingInput,
): NormalizedSessionViewerCompatibility {
    if (session.viewer !== undefined) {
        const parsed = SessionViewerProjectionV1Schema.safeParse(session.viewer);
        return parsed.success
            ? { kind: 'current', viewer: parsed.data }
            : { kind: 'untracked' };
    }
    // A sourced access projection is current-generation evidence. If its
    // required viewer companion is absent, do not reinterpret even an owner
    // access role through the released fallback.
    if (session.access?.sources !== undefined) return { kind: 'untracked' };
    return session.owner === undefined
        && isSessionAccessOwner(session.access, session.accessLevel)
        ? { kind: 'legacy_owner' }
        : { kind: 'untracked' };
}

/**
 * Current Homes normalize inert retained cursors to `not_started`. Keep that
 * private projection authoritative, including when old metadata says unread.
 *
 * The 0.2.11 list/detail wire has no viewer projection and identifies shared
 * recipients through `share`, normalized here as owner/accessLevel. Preserve
 * owner tracking for those Homes without enrolling their shared recipients.
 * Remove this fallback when pre-viewer Homes are no longer supported.
 */
export function isSessionPersonallyTrackedForViewer(session: SessionViewerTrackingInput): boolean {
    const normalized = normalizeSessionViewerCompatibility(session);
    return normalized.kind === 'legacy_owner'
        || (normalized.kind === 'current' && normalized.viewer.readState.state === 'tracking');
}

export function hasUnreadActivityForSessionViewer(viewer: SessionViewerProjectionV1): boolean {
    return viewer.readState.state === 'tracking' && viewer.attention.reasons.includes('unread');
}

export function resolveSessionViewerProjectionUpdate(
    value: unknown,
    previous: SessionViewerProjectionV1 | undefined,
): SessionViewerProjectionV1 | undefined {
    if (value === undefined) return previous;
    const parsed = SessionViewerProjectionV1Schema.safeParse(value);
    return parsed.success ? parsed.data : previous;
}
