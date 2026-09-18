import { describe, expect, it } from "vitest";
import { encodeBase64 } from "privacy-kit";
import { SESSION_DATA_KEY_ENVELOPE_BYTES_V1 } from "@happier-dev/protocol";

import type { AccountRecipientEnvelopeReadiness } from "@/app/encryption/accountRecipientEnvelopeReadiness";

import { admitDirectSessionRecipientEnvelope } from "./sessionDataKeyEnvelopeAdmission";

/** Structurally canonical: exact length and the v1 version byte. */
const validEnvelopeB64 = encodeBase64(new Uint8Array(SESSION_DATA_KEY_ENVELOPE_BYTES_V1));
const ready: AccountRecipientEnvelopeReadiness = {
    status: "available",
    binding: {
        contentPublicKey: new Uint8Array(32).fill(1),
        contentPublicKeySignature: new Uint8Array(64).fill(2),
        contentPublicKeyFingerprint: "fingerprint",
    },
};
const notReady = (reason: "plain_account" | "encryption_setup_required" | "encryption_inconsistent") =>
    ({ status: "unavailable", reason }) as const satisfies AccountRecipientEnvelopeReadiness;

describe("admitDirectSessionRecipientEnvelope", () => {
    describe("Plain Session", () => {
        it("requires nothing and writes nothing", () => {
            expect(admitDirectSessionRecipientEnvelope({
                sessionEncryptionMode: "plain",
                recipientReadiness: notReady("plain_account"),
                hasExistingEnvelope: false,
                input: undefined,
            })).toEqual({ outcome: "not_required" });
        });

        it("rejects supplied recipient material instead of ignoring it", () => {
            expect(admitDirectSessionRecipientEnvelope({
                sessionEncryptionMode: "plain",
                recipientReadiness: notReady("plain_account"),
                hasExistingEnvelope: false,
                input: { v: 1, encryptedDataKey: validEnvelopeB64 },
            })).toEqual({ outcome: "rejected", error: "data_key_not_required" });
        });
    });

    describe("E2EE Session with an envelope-ready recipient", () => {
        it("admits one canonical envelope for the tuple write", () => {
            expect(admitDirectSessionRecipientEnvelope({
                sessionEncryptionMode: "e2ee",
                recipientReadiness: ready,
                hasExistingEnvelope: false,
                input: { v: 1, encryptedDataKey: validEnvelopeB64 },
            })).toEqual({ outcome: "write", encryptedDataKey: validEnvelopeB64 });
        });

        it("rejects structurally impossible material as a malformed request", () => {
            for (const input of [
                { v: 1, encryptedDataKey: encodeBase64(new Uint8Array(SESSION_DATA_KEY_ENVELOPE_BYTES_V1 - 1)) },
                { v: 1, encryptedDataKey: encodeBase64(new Uint8Array(SESSION_DATA_KEY_ENVELOPE_BYTES_V1).fill(9)) },
                { v: 1, encryptedDataKey: "" },
                { v: 2, encryptedDataKey: validEnvelopeB64 },
                { encryptedDataKey: validEnvelopeB64 },
                { v: 1, encryptedDataKey: validEnvelopeB64, recipientAccountId: "account-1" },
                validEnvelopeB64,
                null,
            ]) {
                expect(admitDirectSessionRecipientEnvelope({
                    sessionEncryptionMode: "e2ee",
                    recipientReadiness: ready,
                    hasExistingEnvelope: false,
                    input,
                })).toEqual({ outcome: "rejected", error: "invalid_request" });
            }
        });

        it("reuses an existing tuple rather than demanding a needless rewrap", () => {
            expect(admitDirectSessionRecipientEnvelope({
                sessionEncryptionMode: "e2ee",
                recipientReadiness: ready,
                hasExistingEnvelope: true,
                input: undefined,
            })).toEqual({ outcome: "reuse_existing" });
        });

        it("names the omitted envelope distinctly from a malformed one", () => {
            expect(admitDirectSessionRecipientEnvelope({
                sessionEncryptionMode: "e2ee",
                recipientReadiness: ready,
                hasExistingEnvelope: false,
                input: undefined,
            })).toEqual({ outcome: "rejected", error: "recipient_envelope_required" });
        });

        it("replaces an existing tuple when the caller does supply fresh material", () => {
            expect(admitDirectSessionRecipientEnvelope({
                sessionEncryptionMode: "e2ee",
                recipientReadiness: ready,
                hasExistingEnvelope: true,
                input: { v: 1, encryptedDataKey: validEnvelopeB64 },
            })).toEqual({ outcome: "write", encryptedDataKey: validEnvelopeB64 });
        });

    });

    describe("E2EE Session with an unavailable recipient", () => {
        it("lets the grant commit with truthful pending access and no fabricated tuple", () => {
            for (const reason of ["plain_account", "encryption_setup_required", "encryption_inconsistent"] as const) {
                expect(admitDirectSessionRecipientEnvelope({
                    sessionEncryptionMode: "e2ee",
                    recipientReadiness: notReady(reason),
                    hasExistingEnvelope: false,
                    input: undefined,
                })).toEqual({ outcome: "grant_without_envelope", reason });
            }
        });

        // An existing tuple is left exactly as it is: this decision never
        // deletes recipient material, and revocation cleanup is not this owner.
        it("still commits without touching an existing tuple", () => {
            expect(admitDirectSessionRecipientEnvelope({
                sessionEncryptionMode: "e2ee",
                recipientReadiness: notReady("encryption_setup_required"),
                hasExistingEnvelope: true,
                input: undefined,
            })).toEqual({ outcome: "grant_without_envelope", reason: "encryption_setup_required" });
        });

        it("rejects supplied material the recipient could not possibly open", () => {
            expect(admitDirectSessionRecipientEnvelope({
                sessionEncryptionMode: "e2ee",
                recipientReadiness: notReady("encryption_setup_required"),
                hasExistingEnvelope: false,
                    input: { v: 1, encryptedDataKey: validEnvelopeB64 },
            })).toEqual({ outcome: "rejected", error: "recipient_key_unavailable" });
        });
    });
});
