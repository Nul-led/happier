import { afterTx, type Tx } from "@/storage/inTx";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";
import {
    buildSessionSharedUpdate,
    buildSessionShareRevokedUpdate,
    buildSessionShareUpdatedUpdate,
    eventRouter,
} from "@/app/events/eventRouter";
import type {
    SessionAccessDirectShareRow,
    SessionAccessGrantEffects,
} from "./sessionAccessGrantService";

/**
 * The released direct-share socket events, projected from committed access state.
 *
 * These three events are a compatibility hint for clients that predate the
 * effective-access projection. They are derived here from the canonical before/after
 * result rather than from "a row was written", because a released client treats
 * `session-share-revoked` as deleting the whole Session locally. Emitting one because
 * a direct row disappeared, while a Team or Group grant still admits the reader,
 * would destroy a still-authorized client's local state.
 *
 * Two rules follow from the released payloads themselves and are load-bearing:
 * every event needs a real `SessionShare.id`, and no event may claim authority the
 * direct row does not carry. A pure Team/Group grant or membership change therefore
 * emits nothing and converges through AccountChange plus the current projection.
 */
export type ReleasedDirectShareEvent =
    | Readonly<{ kind: "shared"; share: SessionAccessDirectShareRow }>
    | Readonly<{ kind: "updated"; share: SessionAccessDirectShareRow }>
    | Readonly<{ kind: "revoked"; shareId: string; sessionId: string }>;

export function projectReleasedDirectShareEvent(
    input: Readonly<{
        recipientAccountId: string;
        effects: SessionAccessGrantEffects;
        /** The surviving direct row after a set, or the removed row after a delete. */
        directShare: SessionAccessDirectShareRow | null;
        directShareRemoved: boolean;
    }>,
): ReleasedDirectShareEvent | null {
    const { recipientAccountId, effects, directShare } = input;
    if (!directShare) return null;

    if (effects.revokedAccountIds.includes(recipientAccountId)) {
        return { kind: "revoked", shareId: directShare.id, sessionId: directShare.sessionId };
    }
    // Effective access survived. A released `updated` event carries the direct row's
    // own level and id, so once that row is gone there is nothing truthful to send.
    if (input.directShareRemoved) return null;
    if (effects.grantedAccountIds.includes(recipientAccountId)) {
        return { kind: "shared", share: directShare };
    }
    if (effects.changedAccountIds.includes(recipientAccountId)) {
        return { kind: "updated", share: directShare };
    }
    return null;
}

export type ReleasedDirectShareSenderProfile = Readonly<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    avatar: unknown;
}>;

/**
 * Schedule the projected released event after commit.
 *
 * Nothing is emitted from inside the transaction: an event that escaped a rolled
 * back transaction would tell a client about access it does not have.
 */
export function scheduleReleasedDirectShareEvent(
    tx: Tx,
    params: Readonly<{
        recipientAccountId: string;
        cursor: number;
        event: ReleasedDirectShareEvent | null;
        sharedByUser: ReleasedDirectShareSenderProfile | null;
    }>,
): void {
    const { event } = params;
    if (!event) return;

    afterTx(tx, () => {
        const payload = event.kind === "revoked"
            ? buildSessionShareRevokedUpdate(
                event.shareId,
                event.sessionId,
                params.cursor,
                randomKeyNaked(12),
            )
            : event.kind === "shared"
                ? buildSessionSharedUpdate(
                    {
                        id: event.share.id,
                        sessionId: event.share.sessionId,
                        sharedByUser: {
                            id: params.sharedByUser?.id ?? event.share.sharedByUserId,
                            firstName: params.sharedByUser?.firstName ?? null,
                            lastName: params.sharedByUser?.lastName ?? null,
                            username: params.sharedByUser?.username ?? null,
                            avatar: params.sharedByUser?.avatar ?? null,
                        },
                        accessLevel: event.share.accessLevel,
                        canApprovePermissions: event.share.canApprovePermissions,
                        createdAt: event.share.createdAt,
                    },
                    params.cursor,
                    randomKeyNaked(12),
                )
                : buildSessionShareUpdatedUpdate(
                    event.share.id,
                    event.share.sessionId,
                    event.share.accessLevel,
                    event.share.canApprovePermissions,
                    event.share.updatedAt,
                    params.cursor,
                    randomKeyNaked(12),
                );

        eventRouter.emitUpdate({
            userId: params.recipientAccountId,
            payload,
            recipientFilter: { type: "all-user-authenticated-connections" },
        });
    });
}
