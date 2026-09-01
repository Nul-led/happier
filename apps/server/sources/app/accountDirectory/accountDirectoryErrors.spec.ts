import { describe, expect, it } from "vitest";
import { ACCOUNT_DIRECTORY_ERROR_CODES_V1 } from "@happier-dev/protocol";
import {
    ACCOUNT_DIRECTORY_PROTOCOL_ERROR_BY_CODE,
    AccountDirectoryError,
    accountDirectoryProtocolErrorResponse,
} from "./accountDirectoryErrors";

describe("Account Directory domain error mapping", () => {
    it("maps every internal domain error code onto a protocol-owned strict error code", () => {
        const protocolCodes = Object.values(ACCOUNT_DIRECTORY_ERROR_CODES_V1);
        expect(Object.keys(ACCOUNT_DIRECTORY_PROTOCOL_ERROR_BY_CODE).length).toBeGreaterThan(0);
        for (const [internalCode, protocolCode] of Object.entries(ACCOUNT_DIRECTORY_PROTOCOL_ERROR_BY_CODE)) {
            expect(protocolCodes).toContain(protocolCode);
            expect(protocolCode).toMatch(/^[a-z][a-z_]*$/u);
            expect(internalCode).toMatch(/^[a-z][a-z_]*$/u);
        }
    });

    it("projects domain errors onto typed status-plus-body responses", () => {
        expect(accountDirectoryProtocolErrorResponse(new AccountDirectoryError("invalid_client_key")))
            .toEqual({ statusCode: 401, body: { error: "invalid_client_key" } });
        expect(accountDirectoryProtocolErrorResponse(new AccountDirectoryError("assertion_clock_skew")))
            .toEqual({ statusCode: 401, body: { error: "assertion_clock_skew" } });
        expect(accountDirectoryProtocolErrorResponse(new AccountDirectoryError("directory_link_not_found")))
            .toEqual({ statusCode: 401, body: { error: "directory_link_not_found" } });
        expect(accountDirectoryProtocolErrorResponse(new AccountDirectoryError("invalid_subject")))
            .toEqual({ statusCode: 401, body: { error: "invalid_subject" } });
        expect(accountDirectoryProtocolErrorResponse(new AccountDirectoryError("approval_invalid")))
            .toEqual({ statusCode: 401, body: { error: "approval_invalid" } });
        // A route may narrow only the status code; the body stays canonical.
        expect(accountDirectoryProtocolErrorResponse(new AccountDirectoryError("invalid_client_key", "Invalid client public key", 400)))
            .toEqual({ statusCode: 400, body: { error: "invalid_client_key" } });
    });

    it("projects only the route boundary's native validation and rate-limit failures", () => {
        expect(accountDirectoryProtocolErrorResponse({
            statusCode: 400,
            validation: [{ instancePath: "/v", message: "Invalid input" }],
        })).toEqual({ statusCode: 400, body: { error: "invalid_request" } });
        expect(accountDirectoryProtocolErrorResponse({
            statusCode: 400,
            code: "FST_ERR_CTP_INVALID_JSON_BODY",
        })).toEqual({ statusCode: 400, body: { error: "invalid_request" } });
        expect(accountDirectoryProtocolErrorResponse({
            statusCode: 429,
            message: "Rate limit exceeded",
        })).toEqual({ statusCode: 429, body: { error: "rate_limited" } });
    });

    it("returns null for unrecognized errors so routes rethrow instead of guessing a body", () => {
        expect(accountDirectoryProtocolErrorResponse(new Error("arbitrary failure"))).toBeNull();
        expect(accountDirectoryProtocolErrorResponse(null)).toBeNull();
    });
});
