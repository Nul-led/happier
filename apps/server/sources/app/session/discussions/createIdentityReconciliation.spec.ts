import { describe, expect, it } from "vitest";

import {
    isSessionDiscussionCreationIdentityConflict,
    reconcileSessionDiscussionCreationIdentityRace,
} from "./createIdentityReconciliation";

const createIdentityFieldsError = () => ({
    code: "P2002",
    meta: { modelName: "SessionDiscussion", target: ["sessionId", "creationLocalId"] },
});

describe("Session Discussion create identity reconciliation", () => {
    it("reruns the complete operation once for a field-list creation-identity P2002", async () => {
        let attempts = 0;
        const result = await reconcileSessionDiscussionCreationIdentityRace(async () => {
            attempts += 1;
            if (attempts === 1) throw createIdentityFieldsError();
            return { ok: false as const, error: "session_discussion_idempotency_conflict" as const };
        });

        expect(result).toEqual({ ok: false, error: "session_discussion_idempotency_conflict" });
        expect(attempts).toBe(2);
    });

    it("recognizes the creation identity's constraint-name P2002 target", () => {
        expect(isSessionDiscussionCreationIdentityConflict({
            code: "P2002",
            meta: { modelName: "SessionDiscussion", target: "SessionDiscussion_sessionId_creationLocalId_key" },
        })).toBe(true);
    });

    it("does not retry unrelated or ambiguous unique failures", async () => {
        const errors = [
            { code: "P2002", meta: { target: ["discussionId", "localId"] } },
            { code: "P2002", meta: { target: ["discussionId", "seq"] } },
            { code: "P2002", meta: {} },
            { code: "P2002", meta: { modelName: "OtherModel", target: ["sessionId", "creationLocalId"] } },
            { code: "P2003", meta: { target: ["sessionId", "creationLocalId"] } },
        ];

        for (const error of errors) {
            let attempts = 0;
            await expect(reconcileSessionDiscussionCreationIdentityRace(async () => {
                attempts += 1;
                throw error;
            })).rejects.toBe(error);
            expect(attempts).toBe(1);
        }
    });

    it("bounds an exact identity-conflict retry to one", async () => {
        const error = createIdentityFieldsError();
        let attempts = 0;

        await expect(reconcileSessionDiscussionCreationIdentityRace(async () => {
            attempts += 1;
            throw error;
        })).rejects.toBe(error);
        expect(attempts).toBe(2);
    });
});
