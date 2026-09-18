import {
    resolveEffectiveSessionAccess,
    resolveStructuralSessionAccessForAccountsInTx,
    resolveStructuralSessionAccessForSessionsInTx,
    type EffectiveSessionAccess,
} from "@/app/session/access/sessionAccess";
import type { Tx } from "@/storage/inTx";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";

export type SessionDiscussionStorageMode = "plain" | "e2ee";

export type SessionDiscussionSessionContext = Readonly<{
    sessionId: string;
    ownerAccountId: string;
    storageMode: SessionDiscussionStorageMode;
    sessionArchived: boolean;
    access: EffectiveSessionAccess;
}>;

function readStorageMode(value: string): SessionDiscussionStorageMode | null {
    return value === "plain" || value === "e2ee" ? value : null;
}

/**
 * Resolves the Session facts every discussion operation needs together with the
 * actor's current effective access.
 *
 * Access is always the live Lane 04 projection: discussions never cache a share
 * level, re-derive one from authorship, or keep a per-discussion ACL. A missing
 * Session, an unrecognized storage mode, or an Account with no current grant all
 * fail closed as `null`, and the caller maps that to its own non-disclosing
 * result.
 */
export async function resolveSessionDiscussionContextInTx(tx: Tx, params: Readonly<{
    sessionId: string;
    accountId: string;
    authentication: SessionAccessAuthentication;
}>): Promise<SessionDiscussionSessionContext | null> {
    const session = await tx.session.findUnique({
        where: { id: params.sessionId },
        select: { id: true, accountId: true, encryptionMode: true, archivedAt: true },
    });
    if (!session) return null;
    const storageMode = readStorageMode(session.encryptionMode);
    if (!storageMode) return null;
    const access = await resolveEffectiveSessionAccess(tx, params);
    if (!access) return null;
    return {
        sessionId: session.id,
        ownerAccountId: session.accountId,
        storageMode,
        sessionArchived: session.archivedAt !== null,
        access,
    };
}

/**
 * Mention targets are validated against current Session read access at write
 * time. A stale client suggestion, a removed collaborator, or an Account that
 * never read the Session can never receive an attention row.
 */
export async function filterAccountsWithCurrentSessionReadAccessInTx(tx: Tx, params: Readonly<{
    sessionId: string;
    accountIds: readonly string[];
}>): Promise<ReadonlySet<string>> {
    if (params.accountIds.length === 0) return new Set();
    const access = await resolveStructuralSessionAccessForAccountsInTx(tx, params);
    const readable = new Set<string>();
    for (const [accountId, effective] of access) {
        if (effective?.capabilities.readTranscript === true) readable.add(accountId);
    }
    return readable;
}

/**
 * The same current-read-access filter for a whole candidate page of Sessions.
 *
 * A fact loader that answers "what is still unread for these Accounts in these
 * Sessions" must not pay one access round trip per Session; this keeps the exact
 * Lane 04 decision while resolving the page in one bounded read. Absence from
 * the returned set is always "not readable right now", so a revoked collaborator
 * disappears from personal attention without any cursor being deleted.
 */
export async function filterSessionsWithCurrentReadAccessInTx(tx: Tx, params: Readonly<{
    sessionIds: readonly string[];
    accountIds: readonly string[];
}>): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    const readable = new Map<string, Set<string>>();
    if (params.sessionIds.length === 0 || params.accountIds.length === 0) return readable;
    const access = await resolveStructuralSessionAccessForSessionsInTx(tx, params);
    for (const accountId of new Set(params.accountIds)) readable.set(accountId, new Set());
    for (const [sessionId, perAccount] of access) {
        for (const [accountId, effective] of perAccount) {
            if (effective?.capabilities.readTranscript !== true) continue;
            const sessions = readable.get(accountId) ?? new Set<string>();
            sessions.add(sessionId);
            readable.set(accountId, sessions);
        }
    }
    return readable;
}
