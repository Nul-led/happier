import type { EffectiveSessionAccess } from "@/app/session/access/sessionAccess";
import {
    SessionInputAdmissionReceiptV1Schema,
    type SessionInputAdmissionReceiptV1,
} from "@happier-dev/protocol";
import type { CallerInputConstraintsV1 } from "@happier-dev/protocol/auth/apiTokenGrant";

/** The sole server receipt builder; callers supply transaction-final admission. */
export function buildSessionInputAdmissionReceipt(input:
    | Readonly<{ issuer: "authenticatedAccount"; access: EffectiveSessionAccess; callerInputConstraints?: CallerInputConstraintsV1 }>
    | Readonly<{ issuer: "authenticatedMachine"; callerInputConstraints?: CallerInputConstraintsV1 }>,
): SessionInputAdmissionReceiptV1 {
    const constraints = input.callerInputConstraints
        && (input.callerInputConstraints.models !== null || input.callerInputConstraints.permissionModes !== null)
        ? { callerInputConstraints: {
            models: input.callerInputConstraints.models,
            permissionModes: input.callerInputConstraints.permissionModes,
        } } : {};
    if (input.issuer === "authenticatedMachine") {
        return SessionInputAdmissionReceiptV1Schema.parse({ v: 1, issuer: input.issuer, ...constraints });
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
        ...constraints,
    });
}

/** Authenticated wire projection; absent legacy receipts remain absent. */
export function projectSessionInputAdmissionReceipt(value: unknown): Readonly<{ inputAdmissionReceipt?: SessionInputAdmissionReceiptV1 }> {
    return value === null || value === undefined ? {} : {
        inputAdmissionReceipt: SessionInputAdmissionReceiptV1Schema.parse(value),
    };
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
