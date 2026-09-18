import { describe, expect, it, vi } from "vitest";
import { projectEffectiveSessionAccess, type SessionAccessProjectionRow } from "./sessionAccess";

// Pure row projection never queries persistence; relational coverage uses the real SQLite harness.
vi.mock("@/storage/db", () => ({ db: {} }));

function session(overrides: Partial<SessionAccessProjectionRow> = {}): SessionAccessProjectionRow {
    return { id: "session", primaryTeamId: null, accountId: "owner", account: { status: "active" }, seq: 0, currentStorageState: "hosted",
        acceptedThroughServerSeq: null, materializationPublicationId: null,
        materializedThroughSourceAt: null, publishedThroughServerSeq: null,
        shares: [], teamGrants: [], groupGrants: [], ...overrides };
}

describe("Session effective capability projection", () => {
    it("keeps owner custody available without published transcript or a grant", () => {
        const access = projectEffectiveSessionAccess(session({ currentStorageState: "machine_only" }), "owner");
        expect(access?.level).toBe("owner");
        expect(Object.values(access!.capabilities).every(Boolean)).toBe(true);
        expect(access?.sources).toEqual([{ kind: "owner" }]);
    });
    it.each(["suspended", "disabled"] as const)("denies an %s owner from current Account lifecycle facts", status => {
        expect(projectEffectiveSessionAccess(session({ account: { status } }), "owner")).toBeNull();
    });
    it.each(["view", "edit", "admin"] as const)("projects the direct %s level without implicit runtime delegation", level => {
        const access = projectEffectiveSessionAccess(session({ shares: [{ id: "grant", sharedWithUserId: "reader", accessLevel: level, canApprovePermissions: false }] }), "reader");
        expect(access?.capabilities.readTranscript).toBe(true);
        expect(access?.capabilities.submitAgentInput).toBe(level !== "view");
        expect(access?.capabilities.manageAccess).toBe(level === "admin");
        expect(access?.capabilities.approveRuntimePermissions).toBe(false);
        expect(access?.capabilities.managePermissionDelegation).toBe(false);
        expect(access?.capabilities.stopSession).toBe(false);
        expect(access?.capabilities.deleteSession).toBe(false);
        expect(access?.capabilities.managePublicLink).toBe(false);
    });
    it.each(["view", "edit", "admin"] as const)("requires same-grant level for delegated %s authority", level => {
        const access = projectEffectiveSessionAccess(session({ shares: [{ id: "grant", sharedWithUserId: "reader", accessLevel: level, canApprovePermissions: true }] }), "reader");
        expect(access?.capabilities.approveRuntimePermissions).toBe(level !== "view");
        expect(access?.capabilities.managePermissionDelegation).toBe(level === "admin");
    });
    it("preserves every applicable relationship kind when decisive sources omit weaker grants", () => {
        const access = projectEffectiveSessionAccess(session({
            shares: [{ id: "direct", sharedWithUserId: "reader", accessLevel: "view", canApprovePermissions: false }],
            teamGrants: [{ teamId: "team", effectiveAt: new Date(1), accessLevel: "admin", canApprovePermissions: false, requiredByTeamPolicy: false,
                team: { authenticationPolicy: null, memberships: [{ accountId: "reader", sessionAccessStartsAt: null }] } }],
            groupGrants: [{ teamGroupId: "group", effectiveAt: new Date(1), accessLevel: "view", canApprovePermissions: false,
                teamGroup: { teamId: "team", team: { authenticationPolicy: null }, memberships: [{ sessionAccessStartsAt: null, teamMembership: { accountId: "reader" } }] } }],
        }), "reader", { includeCredentialRestrictedTeamEntitlements: true });
        expect(access?.sources).toEqual([{ kind: "team", teamId: "team", requiredByTeamPolicy: false }]);
        expect(access?.relationshipKinds).toEqual(["direct", "team", "group"]);
        // Quiet row context is more specific than the strongest access explanation.
        expect(access).toMatchObject({ audienceContext: { kind: "group", teamId: "team", groupId: "group" } });
    });
    it("projects only the exact credential-qualified Teams instead of trusting row-wide query admission", () => {
        const access = projectEffectiveSessionAccess(session({
            teamGrants: [
                {
                    teamId: "qualified-team", effectiveAt: new Date(1), accessLevel: "edit",
                    canApprovePermissions: false, requiredByTeamPolicy: false,
                    team: { authenticationPolicy: { kind: "method", methodId: "qualified" }, memberships: [{ accountId: "reader", sessionAccessStartsAt: null }] },
                },
                {
                    teamId: "unqualified-team", effectiveAt: new Date(1), accessLevel: "admin",
                    canApprovePermissions: true, requiredByTeamPolicy: false,
                    team: { authenticationPolicy: { kind: "method", methodId: "unqualified" }, memberships: [{ accountId: "reader", sessionAccessStartsAt: null }] },
                },
            ],
        }), "reader", { qualifiedTeamIds: new Set(["qualified-team"]) });

        expect(access).toMatchObject({
            level: "edit",
            sources: [{ kind: "team", teamId: "qualified-team", requiredByTeamPolicy: false }],
            capabilities: { manageAccess: false, managePermissionDelegation: false },
        });
    });
    it("keeps the released projection owner/direct-only even for an unrestricted stronger Team grant", () => {
        const access = projectEffectiveSessionAccess(session({
            shares: [{ id: "direct", sharedWithUserId: "reader", accessLevel: "view", canApprovePermissions: false }],
            teamGrants: [{
                teamId: "team", effectiveAt: new Date(1), accessLevel: "admin",
                canApprovePermissions: true, requiredByTeamPolicy: false,
                team: { authenticationPolicy: null, memberships: [{ accountId: "reader", sessionAccessStartsAt: null }] },
            }],
        }), "reader", { mode: "legacy_owner_or_direct" });

        expect(access).toMatchObject({
            level: "view",
            sources: [{ kind: "direct", shareId: "direct" }],
            capabilities: { manageAccess: false, managePermissionDelegation: false },
        });
    });
    it("preserves explicit owner Team context without turning it into access or exposing the ACL", () => {
        const row = { ...session(), primaryTeamId: "context-team" };
        expect(projectEffectiveSessionAccess(row, "owner")).toMatchObject({
            sources: [{ kind: "owner" }], primaryTeamId: "context-team", audienceContext: null,
        });
        expect(projectEffectiveSessionAccess(row, "reader")).toBeNull();
    });
    it("projects safe authored Team context to an authorized direct recipient without exposing grants", () => {
        const access = projectEffectiveSessionAccess(session({
            primaryTeamId: "context-team",
            shares: [{ id: "grant", sharedWithUserId: "reader", accessLevel: "view", canApprovePermissions: false }],
        }), "reader");
        expect(access).toMatchObject({
            level: "view",
            primaryTeamId: "context-team",
            sources: [{ kind: "direct", shareId: "grant" }],
        });
    });
    it("does not admit a missing grant or unpublished recipient", () => {
        expect(projectEffectiveSessionAccess(session(), "reader")).toBeNull();
        expect(projectEffectiveSessionAccess(session({ currentStorageState: "machine_only", shares: [{ id: "grant", sharedWithUserId: "reader", accessLevel: "admin", canApprovePermissions: true }] }), "reader")).toBeNull();
    });
});
