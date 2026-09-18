import { initializeSessionOwnerReadStateInTx } from "@/app/session/personal/readState";
import {
    encodeSessionOwnerMetadataEnvelopeV1,
    SESSION_METADATA_LAYOUT_VERSION_V1,
} from "@happier-dev/protocol";

import { applySessionCreationPlacementInTx } from "@/app/session/organization/organizationMutations";
import { writeSessionDataKeyEnvelopeInTx } from "@/app/session/encryption/sessionDataKeyEnvelopePersistence";
import type { SessionArchiveTransitionPublication } from "@/app/session/archive/publishSessionArchiveTransition";
import type { Tx } from "@/storage/inTx";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";
import { publishSessionCreationInTx } from "./publishSessionCreationInTx";
import {
    applyInitialSessionAccessInTx,
    type SessionAccessGrantErrorCode,
} from "@/app/session/access/sessionAccessGrantService";
import {
    projectReleasedDirectShareEvent,
    scheduleReleasedDirectShareEvent,
} from "@/app/session/access/publishSessionAccessChange";
import { ACCOUNT_DISPLAY_PROFILE_SELECT } from "@/app/account/profile/accountDisplayProfile";
import {
    validatePlannedSessionTeamCredentialBindingIntentInTx,
    writeSessionTeamCredentialBindingsInTx,
    type SessionTeamCredentialBindingRejection,
} from "@/app/teams/credentials/sessionBinding";

import type {
    Layout1SessionCreateRejection,
    PreparedLayout1SessionCreate,
} from "./prepareLayout1SessionCreate";

export type CreatedSessionRow = Awaited<ReturnType<Tx["session"]["create"]>>;

export type SessionOrganizationPlacement = Readonly<{
    folderId: string | null;
    tagIds: string[];
}>;

export type Layout1SessionCreateOutcome<
    TRejection = Layout1SessionCreateRejection,
> =
    | Readonly<{
        kind: "created";
        session: CreatedSessionRow;
        ownerAccountMode: "e2ee" | "plain";
        organizationPlacement: SessionOrganizationPlacement;
    }>
    | Readonly<{
        kind: "rejoined";
        session: CreatedSessionRow;
        ownerAccountMode: "e2ee" | "plain";
        organizationPlacement: SessionOrganizationPlacement;
        publication: SessionArchiveTransitionPublication | null;
    }>
    | Readonly<{ kind: "rejected"; rejection: TRejection }>;

/**
 * Requested organization placement is invalid input, but it is discovered after
 * the Session row insert. It is raised so the enclosing transaction rolls the
 * Session and its placement writes back together.
 */
export class SessionCreationPlacementError extends Error {
    constructor(readonly code: "invalid-folder" | "invalid-session-tags") {
        super(code);
        this.name = "SessionCreationPlacementError";
    }
}

export function isSessionCreationPlacementError(
    error: unknown,
): error is SessionCreationPlacementError {
    return error instanceof SessionCreationPlacementError;
}

/**
 * The submitted owner envelope is not a structurally valid data-key envelope.
 *
 * Like an invalid placement, this is invalid input discovered after the Session
 * row insert, so it is raised to roll the whole materialization back rather than
 * leaving a Session whose owner can never open it.
 */
export class SessionOwnerEnvelopeError extends Error {
    constructor() {
        super("invalid-owner-envelope");
        this.name = "SessionOwnerEnvelopeError";
    }
}

export class SessionInitialAccessError extends Error {
    constructor(readonly code: SessionAccessGrantErrorCode | "session_initial_access_creator_mismatch") {
        super(code);
        this.name = "SessionInitialAccessError";
    }
}

/**
 * A Team credential selection is part of the same Session-create commit. A
 * failed resource/revision preflight must roll the Session row back rather
 * than leave a visible Session without its enforcement witness.
 */
export class SessionTeamCredentialBindingError extends Error {
    constructor(readonly reason: SessionTeamCredentialBindingRejection) {
        super(reason);
        this.name = "SessionTeamCredentialBindingError";
    }
}

export function isSessionTeamCredentialBindingError(
    error: unknown,
): error is SessionTeamCredentialBindingError {
    return error instanceof SessionTeamCredentialBindingError;
}

export function isSessionOwnerEnvelopeError(
    error: unknown,
): error is SessionOwnerEnvelopeError {
    return error instanceof SessionOwnerEnvelopeError;
}

export const UNPLACED_SESSION_ORGANIZATION: SessionOrganizationPlacement = {
    folderId: null,
    tagIds: [],
};

/**
 * Writes the canonical Layout-1 Session row. `sessionId` is supplied only by
 * fresh bound creation, which reserves its final Session identity before the
 * transaction; ordinary creation lets the database mint it.
 */
export async function insertLayout1SessionRowInTx(
    tx: Tx,
    params: Readonly<{
        prepared: PreparedLayout1SessionCreate;
        effectiveEncryptionMode: "e2ee" | "plain";
        ownerAccountMode: "e2ee" | "plain";
        authentication: SessionAccessAuthentication;
        sessionId?: string;
    }>,
): Promise<CreatedSessionRow> {
    const { prepared, effectiveEncryptionMode } = params;
    const selectedTeamCredentialBindings = (prepared.teamCredentialBindings ?? []).filter((intent) => (
        intent.resourceId !== null
    ));
    if (selectedTeamCredentialBindings.length > 0) {
        const visibleTeamIds = new Set(
            (prepared.initialAccess?.grants ?? []).flatMap((grant) =>
                grant.subject.kind === "team" ? [grant.subject.teamId] : []),
        );
        if (prepared.primaryTeamId) {
            const primaryTeam = await tx.team.findUnique({
                where: { id: prepared.primaryTeamId },
                select: { archivedAt: true, sessionCreationPolicy: true },
            });
            if (
                primaryTeam?.archivedAt === null
                && primaryTeam.sessionCreationPolicy === "team_required"
            ) {
                visibleTeamIds.add(prepared.primaryTeamId);
            }
        }
        for (const binding of selectedTeamCredentialBindings) {
            const bindingAdmission = await validatePlannedSessionTeamCredentialBindingIntentInTx(tx, {
                accountId: prepared.accountId,
                intent: binding,
                plannedSession: {
                    primaryTeamId: prepared.primaryTeamId ?? null,
                    teamVisibilityTeamIds: [...visibleTeamIds],
                },
                authentication: params.authentication,
            });
            if (!bindingAdmission.ok) {
                throw new SessionTeamCredentialBindingError(bindingAdmission.reason);
            }
        }
    }
    const createdAt = new Date();
    const session = await tx.session.create({
        data: {
            ...(params.sessionId ? { id: params.sessionId } : {}),
            accountId: prepared.accountId,
            tag: prepared.tag,
            encryptionMode: effectiveEncryptionMode,
            metadata: prepared.metadata,
            metadataLayoutVersion: SESSION_METADATA_LAYOUT_VERSION_V1,
            ownerMetadata: encodeSessionOwnerMetadataEnvelopeV1(prepared.ownerMetadata),
            agentState: prepared.agentState,
            createdAt,
            lastActiveAt: createdAt,
            meaningfulActivityAt: createdAt,
            ...(prepared.requestedStorageState
                ? { currentStorageState: prepared.requestedStorageState }
                : {}),
            ...(prepared.primaryTeamId !== undefined ? { primaryTeamId: prepared.primaryTeamId } : {}),
        },
    });
    // The owner is an ordinary recipient of their own Session key, so their
    // envelope lands in the one canonical tuple inside this same transaction. A
    // plain Session is genuinely keyless and writes nothing; a legacy-credential
    // Session that carries no per-Session key also writes nothing, and stays
    // readable through the historical owner-only path.
    if (effectiveEncryptionMode !== "plain" && prepared.dataEncryptionKey) {
        const owner = await writeSessionDataKeyEnvelopeInTx(tx, {
            sessionId: session.id,
            recipientAccountId: session.accountId,
            encryptedDataKey: prepared.dataEncryptionKey,
            markRecipientChanged: false,
        });
        if (!owner.ok) throw new SessionOwnerEnvelopeError();
    }
    await initializeSessionOwnerReadStateInTx(tx, { accountId: session.accountId, sessionId: session.id });
    const initialAccess = prepared.initialAccess ?? { grants: [] };
    const accessResult = await applyInitialSessionAccessInTx(tx, {
        creatorAccountId: prepared.accountId,
        sessionId: session.id,
        initialAccess,
        authentication: params.authentication,
    });
    if (!accessResult.ok) throw new SessionInitialAccessError(accessResult.error);
    if (accessResult.directShares.length > 0) {
        const sharedByUser = await tx.account.findUnique({
            where: { id: prepared.accountId },
            select: ACCOUNT_DISPLAY_PROFILE_SELECT,
        });
        for (const directShare of accessResult.directShares) {
            const recipientAccountId = directShare.sharedWithUserId;
            scheduleReleasedDirectShareEvent(tx, {
                recipientAccountId,
                cursor: accessResult.effects.accountCursors.get(recipientAccountId) ?? 0,
                event: projectReleasedDirectShareEvent({
                    recipientAccountId,
                    effects: accessResult.effects,
                    directShare,
                    directShareRemoved: false,
                }),
                sharedByUser,
            });
        }
    }
    if (prepared.teamCredentialBindings !== undefined) {
        const bindingResult = await writeSessionTeamCredentialBindingsInTx(tx, {
            sessionId: session.id,
            accountId: prepared.accountId,
            intents: prepared.teamCredentialBindings,
            authentication: params.authentication,
        });
        if (!bindingResult.ok) throw new SessionTeamCredentialBindingError(bindingResult.reason);
    }
    await publishSessionCreationInTx(tx, { session, ownerAccountMode: params.ownerAccountMode });
    return session;
}

/** Applies the submitted organization placement to a freshly created Session. */
export async function applyRequestedSessionPlacementInTx(
    tx: Tx,
    params: Readonly<{
        prepared: PreparedLayout1SessionCreate;
        sessionId: string;
    }>,
): Promise<SessionOrganizationPlacement> {
    const requested = params.prepared.organizationPlacement;
    if (
        !requested
        || (requested.folderId === null && requested.tagIds.length === 0)
    ) {
        return { ...UNPLACED_SESSION_ORGANIZATION };
    }
    const applied = await applySessionCreationPlacementInTx(tx, {
        accountId: params.prepared.accountId,
        sessionId: params.sessionId,
        folderId: requested.folderId,
        tagIds: [...requested.tagIds],
    });
    if ("error" in applied) {
        throw new SessionCreationPlacementError(applied.error);
    }
    return applied;
}
