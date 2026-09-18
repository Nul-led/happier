import type { EffectiveSessionAccess } from "@/app/session/access/sessionAccess";
import {
    SessionInputAdmissionReceiptV1Schema,
    type SessionInputAdmissionReceiptV1,
} from "@happier-dev/protocol";

/** The sole server receipt builder; callers supply transaction-final admission. */
export function buildSessionInputAdmissionReceipt(input:
    | Readonly<{ issuer: "authenticatedAccount"; access: EffectiveSessionAccess }>
    | Readonly<{ issuer: "authenticatedMachine" }>,
): SessionInputAdmissionReceiptV1 {
    if (input.issuer === "authenticatedMachine") {
        return SessionInputAdmissionReceiptV1Schema.parse({ v: 1, issuer: input.issuer });
    }
    if (!input.access.capabilities.submitAgentInput || input.access.level === "view") {
        throw new TypeError("Session input admission requires current input capability");
    }
    return SessionInputAdmissionReceiptV1Schema.parse({
        v: 1,
        issuer: input.issuer,
        actorAccountId: input.access.accountId,
        sessionRelationship: input.access.level === "owner" ? "owner"
            : input.access.level === "admin" ? "sharedAdmin" : "sharedEditor",
    });
}

/** Relationship changes never change the identity of an already admitted input. */
export function isSameSessionInputAdmissionIssuer(
    existing: SessionInputAdmissionReceiptV1,
    current: SessionInputAdmissionReceiptV1,
): boolean {
    return existing.issuer === current.issuer
        && (existing.issuer === "authenticatedMachine"
            || current.issuer === "authenticatedAccount" && existing.actorAccountId === current.actorAccountId);
}
