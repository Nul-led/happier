import { describe, expect, it } from "vitest";

import { projectReleasedDirectShareEvent } from "./publishSessionAccessChange";
import type { SessionAccessGrantEffects } from "./sessionAccessGrantService";

const RECIPIENT = "account-recipient";

function effects(
    overrides: Partial<{
        changed: readonly string[];
        granted: readonly string[];
        revoked: readonly string[];
    }> = {},
): SessionAccessGrantEffects {
    return {
        changedAccountIds: overrides.changed ?? [],
        grantedAccountIds: overrides.granted ?? [],
        revokedAccountIds: overrides.revoked ?? [],
        rosterManagerAccountIds: [],
        accountCursors: new Map(),
    };
}

const DIRECT_SHARE = {
    id: "share-1",
    sessionId: "session-1",
    sharedByUserId: "account-owner",
    sharedWithUserId: RECIPIENT,
    accessLevel: "edit",
    canApprovePermissions: false,
    encryptedDataKey: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
} as const;

describe("released direct-share event projection", () => {
    it("emits nothing when the direct row is deleted but effective access survives", () => {
        // A released client deletes the whole Session locally on `revoked`, so a
        // surviving Team or Group grant must not produce one.
        expect(projectReleasedDirectShareEvent({
            recipientAccountId: RECIPIENT,
            effects: effects({ changed: [RECIPIENT] }),
            directShare: DIRECT_SHARE,
            directShareRemoved: true,
        })).toBeNull();
    });

    it("emits revoked with the real released share identity on final access loss", () => {
        expect(projectReleasedDirectShareEvent({
            recipientAccountId: RECIPIENT,
            effects: effects({ changed: [RECIPIENT], revoked: [RECIPIENT] }),
            directShare: DIRECT_SHARE,
            directShareRemoved: true,
        })).toEqual({ kind: "revoked", shareId: "share-1", sessionId: "session-1" });
    });

    it("distinguishes a first grant from a level change on a surviving row", () => {
        expect(projectReleasedDirectShareEvent({
            recipientAccountId: RECIPIENT,
            effects: effects({ changed: [RECIPIENT], granted: [RECIPIENT] }),
            directShare: DIRECT_SHARE,
            directShareRemoved: false,
        })).toEqual({ kind: "shared", share: DIRECT_SHARE });

        expect(projectReleasedDirectShareEvent({
            recipientAccountId: RECIPIENT,
            effects: effects({ changed: [RECIPIENT] }),
            directShare: DIRECT_SHARE,
            directShareRemoved: false,
        })).toEqual({ kind: "updated", share: DIRECT_SHARE });
    });

    it("never fabricates a direct-share event for a pure Team or Group transition", () => {
        // Every released payload needs a real `SessionShare.id`; a collective grant
        // has none, and inventing one would claim direct-grant provenance.
        expect(projectReleasedDirectShareEvent({
            recipientAccountId: RECIPIENT,
            effects: effects({ changed: [RECIPIENT], granted: [RECIPIENT] }),
            directShare: null,
            directShareRemoved: false,
        })).toBeNull();

        expect(projectReleasedDirectShareEvent({
            recipientAccountId: RECIPIENT,
            effects: effects({ changed: [RECIPIENT], revoked: [RECIPIENT] }),
            directShare: null,
            directShareRemoved: true,
        })).toBeNull();
    });

    it("emits nothing for an Account this mutation did not affect", () => {
        expect(projectReleasedDirectShareEvent({
            recipientAccountId: RECIPIENT,
            effects: effects({ changed: ["someone-else"] }),
            directShare: DIRECT_SHARE,
            directShareRemoved: false,
        })).toBeNull();
    });
});
