import { describe, expect, it } from "vitest";

import {
    MEMBERSHIP_SESSION_DATA_KEY_ENVELOPE_ERROR_RESPONSES,
    MembershipSessionDataKeyEnvelopeErrorV1Schema,
    membershipSessionDataKeyEnvelopeHttpStatus,
} from "./membershipSessionDataKeyEnvelopeService";

describe("membership Session data-key envelope error schema", () => {
    it("accepts only Team errors and errors reachable from membership history", () => {
        const reachable = [
            "invalid_request",
            "invalid_cursor",
            "forbidden",
            "recipient_changed",
            "recipient_key_unavailable",
            "session_data_key_unavailable",
            "membership_not_found",
            "group_not_found",
        ] as const;
        for (const error of reachable) {
            expect(MembershipSessionDataKeyEnvelopeErrorV1Schema.safeParse({ error }).success).toBe(true);
        }

        const perSessionOnly = [
            "session_not_found",
            "data_key_not_required",
            "recipient_envelope_required",
            "conflict",
        ] as const;
        for (const error of perSessionOnly) {
            expect(MembershipSessionDataKeyEnvelopeErrorV1Schema.safeParse({ error }).success).toBe(false);
        }
    });

    it("declares the canonical Team authentication-unavailable response", () => {
        expect(membershipSessionDataKeyEnvelopeHttpStatus("team_authentication_unavailable")).toBe(503);
        expect(MEMBERSHIP_SESSION_DATA_KEY_ENVELOPE_ERROR_RESPONSES).toHaveProperty("503");
    });
});
