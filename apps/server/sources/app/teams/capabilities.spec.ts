import { describe, expect, it } from "vitest";

import { NO_TEAM_CAPABILITIES_V1, type TeamCapabilitiesV1 } from "@happier-dev/protocol";
import { AccountStatus, TeamMembershipStatus, TeamRole } from "@/storage/enums.generated";

import { resolveHomeGovernanceAuthority } from "@/app/home/governance/homeCapabilities";
import { resolveTeamCapabilitiesV1, resolveTeamCredentialCapabilities, type TeamViewerFacts } from "./capabilities";

const NO_HOME_AUTHORITY = resolveHomeGovernanceAuthority(null);

function viewer(overrides: Partial<TeamViewerFacts> = {}): TeamViewerFacts {
    return {
        accountStatus: AccountStatus.active,
        homeAuthority: NO_HOME_AUTHORITY,
        membership: null,
        teamArchivedAt: null,
        ...overrides,
    };
}

function membership(role: TeamRole, status: TeamMembershipStatus = TeamMembershipStatus.active) {
    return { role, status };
}

function granted(capabilities: TeamCapabilitiesV1): string[] {
    return Object.entries(capabilities).filter(([, value]) => value).map(([key]) => key).sort();
}

const homeAdminAuthority = resolveHomeGovernanceAuthority({
    accountId: "a_admin",
    homeRole: "admin",
    status: "active",
});
const homeOwnerAuthority = resolveHomeGovernanceAuthority({
    accountId: "a_owner",
    homeRole: "owner",
    status: "active",
});

describe("Team capability resolver", () => {
    it("admits credential offers by current non-guests and management only by Team managers", () => {
        for (const role of [TeamRole.owner, TeamRole.admin, TeamRole.member, TeamRole.guest]) {
            expect(resolveTeamCredentialCapabilities(viewer({ membership: membership(role) }))).toEqual({
                offerOwnCredential: role !== TeamRole.guest,
                manageCredentials: role === TeamRole.owner || role === TeamRole.admin,
            });
        }
    });

    it("never promotes Home authority or stale membership into credential authority", () => {
        const denied = { offerOwnCredential: false, manageCredentials: false };
        expect(resolveTeamCredentialCapabilities(viewer({ homeAuthority: homeOwnerAuthority }))).toEqual(denied);
        for (const overrides of [
            { accountStatus: AccountStatus.disabled },
            { accountStatus: AccountStatus.suspended },
            { teamArchivedAt: new Date() },
            { membership: membership(TeamRole.owner, TeamMembershipStatus.suspended) },
        ]) {
            expect(resolveTeamCredentialCapabilities(viewer({
                membership: membership(TeamRole.owner), homeAuthority: homeOwnerAuthority, ...overrides,
            }))).toEqual(denied);
        }
        expect(resolveTeamCredentialCapabilities(viewer({
            membership: membership(TeamRole.guest), homeAuthority: homeOwnerAuthority,
        }))).toEqual(denied);
    });
    it("denies everything to a viewer with neither membership nor Home authority", () => {
        expect(resolveTeamCapabilitiesV1(viewer())).toEqual(NO_TEAM_CAPABILITIES_V1);
    });

    it("gives an ordinary member visibility and no governance", () => {
        const capabilities = resolveTeamCapabilitiesV1(viewer({ membership: membership(TeamRole.member) }));
        expect(granted(capabilities)).toEqual(["viewTeam"]);
    });

    it("gives a guest exactly what a member gets and never more", () => {
        // D2: a guest is rostered and visible but carries no governance capability.
        const guest = resolveTeamCapabilitiesV1(viewer({ membership: membership(TeamRole.guest) }));
        const member = resolveTeamCapabilitiesV1(viewer({ membership: membership(TeamRole.member) }));
        expect(granted(guest)).toEqual(["viewTeam"]);
        expect(guest).toEqual(member);
    });

    it("gives a Team admin authentication governance but not ownership", () => {
        const capabilities = resolveTeamCapabilitiesV1(viewer({ membership: membership(TeamRole.admin) }));
        expect(capabilities.manageSettings).toBe(true);
        expect(capabilities.managePolicy).toBe(true);
        expect(capabilities.manageMembers).toBe(true);
        expect(capabilities.manageGroups).toBe(true);
        expect(capabilities.manageInvitations).toBe(true);
        expect(capabilities.archiveTeam).toBe(true);
        expect(capabilities.manageOwners).toBe(false);
        expect(capabilities.manageAuthentication).toBe(true);
    });

    it("gives a Team owner ownership and accepted-authentication authority", () => {
        const capabilities = resolveTeamCapabilitiesV1(viewer({ membership: membership(TeamRole.owner) }));
        expect(capabilities.manageOwners).toBe(true);
        expect(capabilities.manageAuthentication).toBe(true);
        expect(capabilities.archiveTeam).toBe(true);
    });

    it("withdraws every capability from a suspended membership", () => {
        // A suspended member is not an effective member; role alone grants nothing.
        expect(resolveTeamCapabilitiesV1(viewer({
            membership: membership(TeamRole.owner, TeamMembershipStatus.suspended),
        }))).toEqual(NO_TEAM_CAPABILITIES_V1);
    });

    it("withdraws every capability from an inactive Account regardless of role", () => {
        for (const accountStatus of [AccountStatus.suspended, AccountStatus.disabled]) {
            expect(resolveTeamCapabilitiesV1(viewer({
                accountStatus,
                membership: membership(TeamRole.owner),
                homeAuthority: homeOwnerAuthority,
            }))).toEqual(NO_TEAM_CAPABILITIES_V1);
        }
    });

    it("limits Home-only administration to metadata and Team lifecycle", () => {
        const capabilities = resolveTeamCapabilitiesV1(viewer({ homeAuthority: homeAdminAuthority }));
        expect(granted(capabilities)).toEqual(["archiveTeam", "manageSettings", "viewTeam"]);
    });

    it("does not turn Home ownership into Team membership or authentication authority", () => {
        expect(granted(resolveTeamCapabilitiesV1(viewer({ homeAuthority: homeOwnerAuthority }))))
            .toEqual(["archiveTeam", "manageSettings", "viewTeam"]);
    });

    it("never lets Home authority imply membership or a viewer role", () => {
        // Governance only: the projection carries no Team role for an administrator.
        const capabilities = resolveTeamCapabilitiesV1(viewer({ homeAuthority: homeOwnerAuthority }));
        expect(capabilities.viewTeam).toBe(true);
        expect(granted(capabilities)).not.toContain("restoreTeam");
    });

    it("makes an archived Team read-only except restore", () => {
        const archived = { teamArchivedAt: new Date("2026-01-01T00:00:00.000Z") };
        const owner = resolveTeamCapabilitiesV1(viewer({ ...archived, membership: membership(TeamRole.owner) }));
        expect(granted(owner)).toEqual(["restoreTeam", "viewTeam"]);

        const member = resolveTeamCapabilitiesV1(viewer({ ...archived, membership: membership(TeamRole.member) }));
        expect(granted(member)).toEqual(["viewTeam"]);
    });

    it("never offers restore on an active Team or archive on an archived one", () => {
        const active = resolveTeamCapabilitiesV1(viewer({ membership: membership(TeamRole.owner) }));
        expect(active.restoreTeam).toBe(false);
        expect(active.archiveTeam).toBe(true);

        const archived = resolveTeamCapabilitiesV1(viewer({
            teamArchivedAt: new Date(),
            membership: membership(TeamRole.owner),
        }));
        expect(archived.archiveTeam).toBe(false);
        expect(archived.restoreTeam).toBe(true);
    });

    it("unions Team role and Home authority rather than letting one mask the other", () => {
        const capabilities = resolveTeamCapabilitiesV1(viewer({
            membership: membership(TeamRole.member),
            homeAuthority: homeAdminAuthority,
        }));
        expect(capabilities.manageSettings).toBe(true);
        expect(capabilities.manageMembers).toBe(false);
        expect(capabilities.viewTeam).toBe(true);

        const teamAdmin = resolveTeamCapabilitiesV1(viewer({
            membership: membership(TeamRole.admin),
            homeAuthority: homeAdminAuthority,
        }));
        expect(teamAdmin.manageAuthentication).toBe(true);
        expect(teamAdmin.manageMembers).toBe(true);
    });
});
