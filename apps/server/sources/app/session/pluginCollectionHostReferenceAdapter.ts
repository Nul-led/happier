import type {
    PluginCollectionHostReferenceAdapter,
    PluginCollectionHostReferenceResolution,
} from "@/app/plugins/data/collections/hostReferences";
import { resolveSessionAccessForOperation, resolveStructuralSessionAccess } from "@/app/session/access/sessionAccess";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";
import type { Tx } from "@/storage/inTx";

const AVAILABLE = Object.freeze({ status: "available" as const });
const TOMBSTONE = Object.freeze({ status: "tombstone" as const });
const UNAVAILABLE = Object.freeze({ status: "unavailable" as const });
const AUTHENTICATION_REQUIRED = Object.freeze({ status: "authentication_required" as const });
const AUTHENTICATION_UNAVAILABLE = Object.freeze({ status: "authentication_unavailable" as const });

export type AuthenticatedSessionHostReferenceResolution =
    | PluginCollectionHostReferenceResolution
    | typeof AUTHENTICATION_REQUIRED
    | typeof AUTHENTICATION_UNAVAILABLE;

/** Exact-credential Session availability for request-bound access witnesses. */
export async function resolveSessionHostReferenceForAuthenticationInTx(input: Readonly<{
    tx: Tx;
    accountId: string;
    targetId: string;
    authentication: SessionAccessAuthentication;
}>): Promise<AuthenticatedSessionHostReferenceResolution> {
    const decision = await resolveSessionAccessForOperation(input.tx, {
        accountId: input.accountId,
        sessionId: input.targetId,
        authentication: input.authentication,
        capability: "readTranscript",
    });
    if (decision.status === "allowed") return AVAILABLE;
    // Authentication failure is not evidence of structural revocation. Keep
    // it distinct for durable access witnesses; relation validation still
    // fails closed because neither result is `available`.
    if (decision.status === "authentication_required") return AUTHENTICATION_REQUIRED;
    if (decision.status === "authentication_unavailable") return AUTHENTICATION_UNAVAILABLE;

    const change = await input.tx.accountChange.findUnique({
        where: {
            accountId_kind_entityId: {
                accountId: input.accountId,
                kind: "session",
                entityId: input.targetId,
            },
        },
        select: { sessionId: true },
    });
    return change?.sessionId === null ? TOMBSTONE : UNAVAILABLE;
}

/**
 * Canonical Account-authorized Session identity/availability adapter for Data.
 *
 * Live references use the Session access owner, including current collaborator
 * access and publication policy. A deleted Session resolves only through its
 * Account-scoped change row after the Session foreign key has been cleared.
 * Neither result grants Session mutation authority or exposes private rows.
 */
export const sessionPluginCollectionHostReferenceAdapter = {
    hostKind: "session",
    async resolveInTx({ tx, accountId, targetId }) {
        const access = await resolveStructuralSessionAccess(tx, { accountId, sessionId: targetId });
        if (access?.capabilities.readTranscript) return AVAILABLE;
        const change = await tx.accountChange.findUnique({
            where: { accountId_kind_entityId: { accountId, kind: "session", entityId: targetId } },
            select: { sessionId: true },
        });
        return change?.sessionId === null ? TOMBSTONE : UNAVAILABLE;
    },
} satisfies PluginCollectionHostReferenceAdapter;

/**
 * Canonical Account-scoped Message identity adapter for Data. The Message
 * domain owns the Session join; a missing or other-Account row stays
 * unavailable so a Collection relation cannot become a Message oracle.
 */
export const messagePluginCollectionHostReferenceAdapter = {
    hostKind: "message",
    async resolveInTx({ tx, accountId, targetId }) {
        const message = await tx.sessionMessage.findFirst({
            where: {
                id: targetId,
                session: { is: { accountId } },
            },
            select: { id: true },
        });
        return message ? AVAILABLE : UNAVAILABLE;
    },
} satisfies PluginCollectionHostReferenceAdapter;
