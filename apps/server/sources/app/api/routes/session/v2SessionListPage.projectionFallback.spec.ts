import { describe, expect, it, vi } from "vitest";

// The primary attention predicate compares `latestReadyEventSeq` to `lastViewedSessionSeq` through
// a Prisma field reference, which is reached off the client. Only the field handles are needed here.
vi.mock("@/storage/db", () => ({
    db: {
        session: {
            fields: {
                lastViewedSessionSeq: { modelName: "Session", name: "lastViewedSessionSeq" },
            },
        },
    },
}));

import {
    isMissingAttentionProjectionColumnError,
} from "./v2SessionListPage";
import { createV2SessionListAttentionRowsWhere } from "./v2SessionListInitialPage";
import {
    createV2SessionListLegacyRowSelect,
    createV2SessionListRowSelect,
    SESSION_LIST_PROJECTION_FALLBACK_COLUMNS,
} from "./v2SessionListRows";

function createMissingColumnError(column: string): unknown {
    return {
        code: "P2022",
        message: `The column \`main.Session.${column}\` does not exist in the current database.`,
    };
}

describe("session list projection fallback", () => {
    it("derives all four activation columns into the established legacy projection gap", () => {
        const primary = createV2SessionListRowSelect({ userId: "u1" });
        const legacy = createV2SessionListLegacyRowSelect({ userId: "u1" });
        const columns = [
            "pendingActivationRequestId",
            "pendingActivationRequestedAt",
            "pendingActivationStatus",
            "pendingActivationFailureCode",
        ] as const;

        for (const column of columns) {
            expect(primary).toHaveProperty(column, true);
            expect(legacy).not.toHaveProperty(column);
            expect(SESSION_LIST_PROJECTION_FALLBACK_COLUMNS).toContain(column);
            expect(isMissingAttentionProjectionColumnError(createMissingColumnError(column))).toBe(true);
        }
    });

    it("keeps recognising the rollback-turn relation columns the primary projection reaches through", () => {
        for (const column of ["rollbackState", "SessionTurn"]) {
            expect(
                isMissingAttentionProjectionColumnError(createMissingColumnError(column)),
            ).toBe(true);
        }
    });

    it("recognises Prisma missing-column metadata when the message omits the column name", () => {
        expect(isMissingAttentionProjectionColumnError({
            code: "P2022",
            message: "The column does not exist in the current database.",
            meta: { column: "main.Session.pendingActivationRequestedAt" },
        })).toBe(true);
    });

    it("does not recognise an unrelated database failure", () => {
        expect(isMissingAttentionProjectionColumnError(new Error("connection reset"))).toBe(false);
        expect(
            isMissingAttentionProjectionColumnError({
                code: "P2022",
                message: 'The column `main.Session.tag` does not exist in the current database.',
            }),
        ).toBe(false);
    });

    it("keeps the ready-event attention predicate on shareable publication states", () => {
        const primaryWhere = JSON.stringify(
            createV2SessionListAttentionRowsWhere(),
            (_key, value) => typeof value === "bigint" ? value.toString() : value,
        );
        expect(primaryWhere).toContain("latestReadyEventSeq");
        expect(primaryWhere).not.toContain("server_partial");
    });
});
