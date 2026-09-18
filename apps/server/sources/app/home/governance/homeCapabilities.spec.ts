import { describe, expect, it } from "vitest";
import { NO_HOME_CAPABILITIES_V1, type HomeRoleV1, type TeamCreationPolicyV1 } from "@happier-dev/protocol";

import {
    resolveHomeCapabilitiesV1,
    type HomeGovernanceAccountFacts,
} from "./homeCapabilities";

function account(
    homeRole: HomeRoleV1,
    status: HomeGovernanceAccountFacts["status"] = "active",
): HomeGovernanceAccountFacts {
    return { accountId: `acc-${homeRole}-${status}`, homeRole, status };
}

function capabilities(input: Readonly<{
    account: HomeGovernanceAccountFacts | null;
    teamCreationPolicy?: TeamCreationPolicyV1;
    teamsEnabled?: boolean;
}>) {
    return resolveHomeCapabilitiesV1({
        account: input.account,
        teamCreationPolicy: input.teamCreationPolicy ?? "managed_only",
        teamsEnabled: input.teamsEnabled ?? true,
    });
}

describe("Home capability resolution", () => {
    it("denies every capability to an unknown or inactive Account", () => {
        expect(capabilities({ account: null })).toEqual(NO_HOME_CAPABILITIES_V1);
        expect(capabilities({ account: account("owner", "suspended") })).toEqual(NO_HOME_CAPABILITIES_V1);
        expect(capabilities({ account: account("owner", "disabled") })).toEqual(NO_HOME_CAPABILITIES_V1);
        expect(capabilities({
            account: account("admin", "suspended"),
            teamCreationPolicy: "self_service",
        })).toEqual(NO_HOME_CAPABILITIES_V1);
    });

    it("gives an active owner every governance capability", () => {
        expect(capabilities({ account: account("owner"), teamCreationPolicy: "self_service" })).toEqual({
            viewAdministration: true,
            manageAccounts: true,
            manageHomeRoles: true,
            manageTeamCreationPolicy: true,
            manageAuthentication: true,
            eraseAccounts: true,
            createTeam: true,
            manageAllTeams: true,
        });
    });

    it("withholds owner-only authority from an admin", () => {
        const admin = capabilities({ account: account("admin") });
        expect(admin.viewAdministration).toBe(true);
        expect(admin.manageAccounts).toBe(true);
        expect(admin.manageTeamCreationPolicy).toBe(true);
        expect(admin.manageAllTeams).toBe(true);
        expect(admin.manageHomeRoles).toBe(false);
        expect(admin.manageAuthentication).toBe(false);
        expect(admin.eraseAccounts).toBe(false);
    });

    it("keeps an ordinary member out of Home administration", () => {
        const member = capabilities({ account: account("member"), teamCreationPolicy: "self_service" });
        expect(member).toEqual({
            ...NO_HOME_CAPABILITIES_V1,
            createTeam: true,
        });
    });

    it("resolves Team creation from deployment availability, Home policy, and viewer class together", () => {
        for (const policy of ["self_service", "managed_only", "disabled"] as const) {
            expect(capabilities({
                account: account("owner"),
                teamCreationPolicy: policy,
                teamsEnabled: false,
            }).createTeam).toBe(false);
        }

        expect(capabilities({ account: account("member"), teamCreationPolicy: "managed_only" }).createTeam).toBe(false);
        expect(capabilities({ account: account("admin"), teamCreationPolicy: "managed_only" }).createTeam).toBe(true);
        expect(capabilities({ account: account("owner"), teamCreationPolicy: "managed_only" }).createTeam).toBe(true);

        expect(capabilities({ account: account("member"), teamCreationPolicy: "self_service" }).createTeam).toBe(true);

        expect(capabilities({ account: account("owner"), teamCreationPolicy: "disabled" }).createTeam).toBe(false);
        expect(capabilities({ account: account("admin"), teamCreationPolicy: "disabled" }).createTeam).toBe(false);
        expect(capabilities({ account: account("member"), teamCreationPolicy: "disabled" }).createTeam).toBe(false);
    });

    it("never lets Team administration authority imply Team creation", () => {
        const owner = capabilities({ account: account("owner"), teamCreationPolicy: "disabled" });
        expect(owner.manageAllTeams).toBe(true);
        expect(owner.createTeam).toBe(false);
    });
});
