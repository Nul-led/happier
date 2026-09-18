import { describe, expect, it, vi } from "vitest";

import type { Tx } from "@/storage/inTx";

import { isGitHubAppInstallationEligibleForOwnerInTx } from "./githubAppInstallationEligibility";

describe("managed GitHub App installation owner eligibility", () => {
    it.each([
        [{ kind: "home" as const }, null, true],
        [{ kind: "home" as const }, "team-a", false],
        [{ kind: "team" as const, teamId: "team-a" }, null, true],
        [{ kind: "team" as const, teamId: "team-a" }, "team-a", true],
        [{ kind: "team" as const, teamId: "team-a" }, "team-b", false],
    ])("checks installation registration ownership for %j against %j", async (owner, ownerTeamId, expected) => {
        const findUnique = vi.fn(async () => ({ id: "installation", registration: { ownerTeamId } }));
        const tx = { gitHubAppInstallation: { findUnique } } as unknown as Tx;

        await expect(isGitHubAppInstallationEligibleForOwnerInTx(tx, {
            installationId: "installation",
            owner,
        })).resolves.toBe(expected);
        expect(findUnique).toHaveBeenCalledWith({
            where: { id: "installation" },
            select: { registration: { select: { ownerTeamId: true } } },
        });
    });

    it("rejects a missing installation", async () => {
        const tx = {
            gitHubAppInstallation: { findUnique: vi.fn(async () => null) },
        } as unknown as Tx;
        await expect(isGitHubAppInstallationEligibleForOwnerInTx(tx, {
            installationId: "missing",
            owner: { kind: "home" },
        })).resolves.toBe(false);
    });
});
