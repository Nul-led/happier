import {
    deriveTeamInvitationStateV1,
    maskTeamInvitationRecipientEmail,
    TeamInvitationAdmissibleRoleV1Schema,
    type TeamInvitationRowV1,
} from "@happier-dev/protocol/teams";
import type { TeamInvitationRecord } from "./invitationLifecycle";

/**
 * The one projection from a stored invitation to its manager-visible row.
 *
 * It is the confinement boundary for the bearer: the digest is never carried out of
 * the server, and the recipient address is reduced to a mask so a Team manager list
 * cannot republish a full address. State is derived here at the caller's read time so
 * an expired row cannot be presented as active by a stale write.
 */
export function projectTeamInvitationRowV1(
    record: TeamInvitationRecord,
    now: Date,
): TeamInvitationRowV1 {
    // An `owner` row can only mean corrupted or out-of-band data: the creation parser
    // rejects it, so failing here keeps a forbidden offer from reaching any client.
    const role = TeamInvitationAdmissibleRoleV1Schema.parse(record.role);
    const deliveryStatus = record.lastEmailDeliveryStatus;
    const deliveryAttemptedAt = record.lastEmailDeliveryAttemptAt;
    return {
        id: record.id,
        teamId: record.teamId,
        state: deriveTeamInvitationStateV1({
            acceptedAt: record.acceptedAt?.getTime() ?? null,
            revokedAt: record.revokedAt?.getTime() ?? null,
            expiresAt: record.expiresAt.getTime(),
        }, now.getTime()),
        role,
        historyAccess: record.historyAccess,
        recipientEmailMask: maskTeamInvitationRecipientEmail(record.recipientEmailNormalized),
        expiresAt: record.expiresAt.getTime(),
        createdAt: record.createdAt.getTime(),
        createdByAccountId: record.createdByAccountId,
        acceptedByAccountId: record.acceptedByAccountId,
        // Both coarse fields are written together by the delivery boundary. A half
        // present pair is an unknown result, never a claim that mail was submitted.
        lastEmailDelivery: deliveryStatus !== null && deliveryAttemptedAt !== null
            ? { status: deliveryStatus, attemptedAt: deliveryAttemptedAt.getTime() }
            : null,
    };
}
