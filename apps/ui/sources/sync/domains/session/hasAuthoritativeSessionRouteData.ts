import { SessionSharedMetadataV1Schema } from '@happier-dev/protocol';

import { readSessionOwnerMetadataView } from './readSessionOwnerMetadataView';
import { isSessionAccessOwner, isSessionAccessRecipient, type NormalizedSessionAccessProjection } from '@/sync/engine/sessions/normalizeSessionAccessProjection';
import { readSessionMetadataLayoutVersion } from '@/sync/engine/sessions/parsePlainSessionPayload';
import type { SessionContentAvailability } from './encryptedContentAvailability';

type SessionRouteDataCandidate = Readonly<{
    metadataLayoutVersion?: number;
    metadata?: unknown;
    ownerMetadataView?: unknown;
    accessLevel?: unknown;
    access?: NormalizedSessionAccessProjection | null;
    encryptionMode?: unknown;
    encryptedContentAvailability?: SessionContentAvailability | null;
}> | null | undefined;

/**
 * Returns whether a stored Session has the owner-authoritative metadata needed
 * by route consumers. Layout-1 owner list rows intentionally omit the owner
 * view and require exact-session hydration. Shared participants, identified by
 * their access level, are authoritative from the strict shared projection and
 * must never be made to request owner data.
 */
export function hasAuthoritativeSessionRouteData(
    session: SessionRouteDataCandidate,
    options?: Readonly<{ hasSessionEncryption: boolean }>,
): boolean {
    if (!session) return false;
    const metadataLayoutVersion = readSessionMetadataLayoutVersion(session.metadataLayoutVersion);
    if (metadataLayoutVersion !== 0 && metadataLayoutVersion !== 1) return false;
    if (session.encryptedContentAvailability && session.encryptedContentAvailability !== 'ready') return true;
    if (options && session.encryptionMode !== 'plain' && !options.hasSessionEncryption) return false;
    if (metadataLayoutVersion === 0) {
        return session.metadata != null;
    }
    if (metadataLayoutVersion !== 1) {
        return false;
    }
    if (isSessionAccessRecipient(session.access, session.accessLevel)) {
        return SessionSharedMetadataV1Schema.safeParse(session.metadata).success;
    }
    if (!isSessionAccessOwner(session.access, session.accessLevel)) {
        return false;
    }
    return readSessionOwnerMetadataView({
        metadataLayoutVersion,
        metadata: session.metadata ?? null,
        ownerMetadataView: session.ownerMetadataView,
    }) != null;
}
