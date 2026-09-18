export { isOrgMemberViaDeploymentApp as isGithubOrgMemberViaApp } from "@/app/integrations/github/githubDeploymentApp";

/**
 * Organization membership check using the signing-in user's own GitHub OAuth
 * access token (`AUTH_GITHUB_ORG_MEMBERSHIP_SOURCE=oauth_user_token`).
 *
 * App-authenticated membership checks are purpose-bound operations of the
 * single deployment GitHub App owner at
 * `@/app/integrations/github/githubDeploymentApp`; the `isGithubOrgMemberViaApp`
 * signature above is re-exported unchanged for the existing eligibility
 * contract.
 */
export async function isGithubOrgMemberViaUserToken(params: {
    org: string;
    username: string;
    accessToken: string;
    timeoutMs?: number;
}): Promise<boolean> {
    const org = params.org.toString().trim().toLowerCase();
    const username = params.username.toString().trim();
    const accessToken = params.accessToken.toString();
    const timeoutMs = typeof params.timeoutMs === "number"
        && Number.isFinite(params.timeoutMs)
        && params.timeoutMs > 0
        ? params.timeoutMs
        : undefined;

    const controller = typeof timeoutMs === "number" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response: Response;
    try {
        response = await fetch(
            `https://api.github.com/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(username)}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/vnd.github.v3+json",
                },
                ...(controller ? { signal: controller.signal } : {}),
            },
        );
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }

    if (response.status === 204) return true;
    if (response.status === 404) return false;
    if (response.status === 302) return false;

    if (!response.ok) {
        throw new Error(`GitHub membership check failed (status=${response.status})`);
    }

    // Some proxy layers can convert 204->200; treat any 2xx as member if ok.
    return true;
}
