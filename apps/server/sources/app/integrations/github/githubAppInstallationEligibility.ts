import type { ProviderCatalogContext } from "@/app/auth/providers/providerReference";
import type { HomeGovernancePolicyRecord } from "@/app/home/governance/governancePolicy";
import type { Tx } from "@/storage/inTx";

export function isManagedGitHubHostApprovedByHome(
    home: HomeGovernancePolicyRecord,
    githubHost: string,
): boolean {
    return githubHost === "https://github.com"
        || (
            home.teamProviders.status === "narrowed"
            && home.teamProviders.policy.approvedGitHubEnterpriseOrigins.includes(githubHost)
        );
}

export function isGitHubAppRegistrationOwnerEligible(
    ownerTeamId: string | null,
    owner: ProviderCatalogContext,
): boolean {
    return owner.kind === "home"
        ? ownerTeamId === null
        : ownerTeamId === null || ownerTeamId === owner.teamId;
}

/** Owner-scope admission for a managed GitHub App installation consumer. */
export async function isGitHubAppInstallationEligibleForOwnerInTx(
    tx: Tx,
    input: Readonly<{ installationId: string; owner: ProviderCatalogContext }>,
): Promise<boolean> {
    const installation = await tx.gitHubAppInstallation.findUnique({
        where: { id: input.installationId },
        select: { registration: { select: { ownerTeamId: true } } },
    });
    if (!installation) return false;
    return isGitHubAppRegistrationOwnerEligible(installation.registration.ownerTeamId, input.owner);
}
