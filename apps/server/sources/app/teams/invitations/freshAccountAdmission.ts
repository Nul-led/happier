import type { Tx } from "@/storage/inTx";
import { resolveTeamInvitationAuthEntryContextInTx } from "./invitationService";
import { readTeamInvitationByIdInTx, readTeamInvitationByTokenHashInTx } from "./invitationLifecycle";
import { tryDigestTeamInvitationToken } from "./token";
import {
    requireAcceptedTeamInvitationInTx,
    acceptTeamInvitationAdmissionReferenceInTx,
    type JoinedTeamInvitation,
} from "./accept";

export type TeamInvitationMailboxVerificationAdmission = Readonly<{
    invitationId: string;
    tokenHash: string;
    teamId: string;
}>;

/**
 * Converts a currently active invitation bearer into the bounded facts used by
 * server-held authentication continuations. The bearer never needs to leave
 * this owner after these facts have been captured.
 */
export async function resolveTeamInvitationFreshAccountAdmissionReferenceInTx(
    tx: Tx,
    input: Readonly<{ token: unknown }>,
): Promise<TeamInvitationMailboxVerificationAdmission | null> {
    const context = await resolveTeamInvitationAuthEntryContextInTx(tx, input);
    if (!context) return null;
    const tokenHashBytes = tryDigestTeamInvitationToken(input.token);
    if (!tokenHashBytes) return null;
    const record = await readTeamInvitationByTokenHashInTx(tx, tokenHashBytes);
    if (!record || record.teamId !== context.team.teamId) return null;
    return {
        invitationId: record.id,
        tokenHash: Buffer.from(tokenHashBytes).toString("hex"),
        teamId: record.teamId,
    };
}

/**
 * Resolves the exact active transferable invitation that may request its
 * separate mailbox proof. The public email route consumes this bounded result;
 * it never interprets invitation state or admission policy on its own.
 */
export async function resolveTeamInvitationMailboxVerificationAdmissionInTx(
    tx: Tx,
    input: Readonly<{ token: unknown }>,
): Promise<TeamInvitationMailboxVerificationAdmission | null> {
    const context = await resolveTeamInvitationAuthEntryContextInTx(tx, input);
    if (!context || context.recipientEmailNormalized !== null) return null;
    return await resolveTeamInvitationFreshAccountAdmissionReferenceInTx(tx, input);
}

/**
 * Consumes one Team invitation inside the fresh-Account transaction.
 *
 * The Home auth owner has already admitted the Account-creation method. Team
 * authentication qualification is a later protected-operation constraint, not
 * structural membership authority, so it is deliberately absent here.
 */
export async function requireTeamInvitationFreshAccountAdmissionInTx(
    tx: Tx,
    input: Readonly<{
        token: string;
        accountId: string;
    }>,
): Promise<JoinedTeamInvitation> {
    return await requireAcceptedTeamInvitationInTx(tx, {
        token: input.token,
        accountId: input.accountId,
    });
}

/** Internal counterpart for a mailbox proof that captured the exact invitation reference. */
export async function requireTeamInvitationFreshAccountAdmissionReferenceInTx(
    tx: Tx,
    input: Readonly<{
        invitationId: string;
        tokenHash: string;
        teamId: string;
        accountId: string;
    }>,
): Promise<JoinedTeamInvitation> {
    const invitation = await readTeamInvitationByIdInTx(tx, input.invitationId);
    if (!invitation
        || invitation.teamId !== input.teamId
        || !/^[0-9a-f]{64}$/u.test(input.tokenHash)
        || !Buffer.from(invitation.tokenHash).equals(Buffer.from(input.tokenHash, "hex"))) {
        throw new TeamInvitationFreshAccountAdmissionAbort();
    }
    const result = await acceptTeamInvitationAdmissionReferenceInTx(tx, {
        invitationId: input.invitationId,
        tokenHash: input.tokenHash,
        accountId: input.accountId,
    });
    if (result.outcome !== "joined") throw new TeamInvitationFreshAccountAdmissionAbort();
    return result;
}

export class TeamInvitationFreshAccountAdmissionAbort extends Error {
    constructor() {
        super("team_invitation_fresh_account_admission_denied");
        this.name = "TeamInvitationFreshAccountAdmissionAbort";
    }
}
