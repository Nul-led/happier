import type { Session } from '@/sync/domains/state/storageTypes';
import { isSessionAccessRecipient } from '@/sync/engine/sessions/normalizeSessionAccessProjection';
import { readSessionMetadataLayoutVersion } from '@/sync/engine/sessions/parsePlainSessionPayload';

export type SessionTupleApplyCurrentness = Readonly<{
    metadataCurrent: boolean;
    agentStateCurrent: boolean;
    fullyCurrent: boolean;
}>;

type SessionTupleOrderingFields = Pick<
    Session,
    'access' | 'accessLevel' | 'agentStateVersion' | 'metadataLayoutVersion' | 'metadataVersion'
>;

function normalizeOrderingNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.trunc(value)
        : null;
}

function isIncomingRevisionCurrent(incoming: unknown, previous: unknown): boolean {
    const previousRevision = normalizeOrderingNumber(previous);
    if (previousRevision === null) return true;
    const incomingRevision = normalizeOrderingNumber(incoming);
    return incomingRevision !== null && incomingRevision >= previousRevision;
}

/**
 * Canonical admission decision for independently versioned Session tuple
 * fields. Async decryptors may finish out of order, so transport arrival order
 * never owns metadata, owner-view, or Agent-state currentness.
 */
export function classifySessionTupleApplyCurrentness(
    previousSession: SessionTupleOrderingFields | null | undefined,
    incomingSession: SessionTupleOrderingFields,
): SessionTupleApplyCurrentness {
    if (!previousSession) {
        const metadataCurrent =
            readSessionMetadataLayoutVersion(incomingSession.metadataLayoutVersion) >= 0;
        return {
            metadataCurrent,
            agentStateCurrent: true,
            fullyCurrent: metadataCurrent,
        };
    }

    const previousLayoutVersion = readSessionMetadataLayoutVersion(previousSession.metadataLayoutVersion);
    const incomingLayoutVersion = readSessionMetadataLayoutVersion(incomingSession.metadataLayoutVersion);
    const metadataLayoutVersionsValid = previousLayoutVersion >= 0 && incomingLayoutVersion >= 0;
    const isParticipantProjection = isSessionAccessRecipient(incomingSession.access, incomingSession.accessLevel);
    const isAuthoritativeParticipantPrivacyContraction =
        previousLayoutVersion === 0
        && incomingLayoutVersion === 1
        && isParticipantProjection;
    const metadataCurrent =
        metadataLayoutVersionsValid
        && (
            isAuthoritativeParticipantPrivacyContraction
            || (incomingLayoutVersion >= previousLayoutVersion
                && isIncomingRevisionCurrent(incomingSession.metadataVersion, previousSession.metadataVersion))
        );
    const agentStateCurrent =
        isAuthoritativeParticipantPrivacyContraction
        || isIncomingRevisionCurrent(
            incomingSession.agentStateVersion,
            previousSession.agentStateVersion,
        );

    return {
        metadataCurrent,
        agentStateCurrent,
        fullyCurrent: metadataCurrent && agentStateCurrent,
    };
}
