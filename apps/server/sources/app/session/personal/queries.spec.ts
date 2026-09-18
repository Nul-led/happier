import { describe, expect, it } from "vitest";

import {
    createSessionPersonalAttentionCandidateWhere,
    iterateBoundedSessionPersonalAttentionRows,
} from "./attentionQuery";
import { createSessionPersonalAttentionProjectionSelect } from "./projection";

describe("Session personal attention query candidacy", () => {
    it("keeps content and recipient key material out of exact count candidate reads", () => {
        const select = createSessionPersonalAttentionProjectionSelect("viewer");

        expect(select).not.toHaveProperty("dataKeyEnvelopes");
        expect(select).not.toHaveProperty("encryptionMode");
        expect(select).not.toHaveProperty("messages");
        expect(select).not.toHaveProperty("sessionPins");
    });

    it("uses Account-scoped relational predicates without materializing Session IDs", () => {
        const where = createSessionPersonalAttentionCandidateWhere({
            accountId: "viewer",
            now: new Date(42_000),
        });

        expect(where).toEqual({
            AND: [
                {
                    OR: [
                        {
                            OR: [
                                { accountId: "viewer" },
                                {
                                    accountFollows: {
                                        some: {
                                            accountId: "viewer",
                                            following: true,
                                            notificationLevel: { in: ["none", "important", "all_messages"] },
                                        },
                                    },
                                },
                            ],
                        },
                        {
                            sessionAttentionStandings: {
                                some: {
                                    accountId: "viewer",
                                    remindAt: { lte: new Date(42_000) },
                                },
                            },
                        },
                    ],
                },
                {
                    OR: expect.arrayContaining([
                        { accountReadStates: { some: { accountId: "viewer" } } },
                        {
                            discussions: {
                                some: {
                                    readStates: { some: { accountId: "viewer" } },
                                },
                            },
                        },
                        { latestTurnStatus: "failed", lastRuntimeIssue: { not: null } },
                        { pendingPermissionRequestCount: { gt: 0 } },
                        { pendingUserActionRequestCount: { gt: 0 } },
                        { pendingBlockedCount: { gt: 0 } },
                    ]),
                },
            ],
        });

        const serialized = JSON.stringify(where);
        expect(serialized).not.toContain('"id"');
        expect(serialized).not.toContain('"sessionId"');
    });

    it("keeps candidate reads bounded while finding an exact sparse match without a semantic cap", async () => {
        const candidates = Array.from({ length: 450 }, (_, index) => ({ id: index }));
        const readSizes: number[] = [];
        const admitted: number[] = [];

        for await (const rows of iterateBoundedSessionPersonalAttentionRows<{ id: number }, number>({
            readCandidates: async ({ cursor, take }) => {
                readSizes.push(take);
                return candidates.slice(cursor ?? 0, (cursor ?? 0) + take);
            },
            cursorAfter: (rows) => (rows[rows.length - 1]?.id ?? -1) + 1,
            admitCandidates: async (rows) => rows.filter((row) => row.id === 410),
        })) {
            admitted.push(...rows.map((row) => row.id));
        }

        expect(admitted).toEqual([410]);
        expect(readSizes).toEqual([200, 200, 200]);
    });
});
