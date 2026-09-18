import { resolveEffectiveWebappBaseUrl } from "@/app/serverUrls/effectiveServerUrls";

export function resolveTeamIdentityConnectionReturnUrl(input: Readonly<{
    env: NodeJS.ProcessEnv;
    homeServerIdentityId: string;
    teamId: string;
    connectionId: string;
}>): string | null {
    const url = new URL(resolveEffectiveWebappBaseUrl(input.env));
    if (url.protocol !== "https:") return null;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/settings/teams/${encodeURIComponent(input.homeServerIdentityId)}/${encodeURIComponent(input.teamId)}/authentication/${encodeURIComponent(input.connectionId)}`;
    url.search = "";
    url.hash = "";
    return url.toString();
}
