import type { Context } from "@/context";
import type { GitHubProfile } from "@/app/auth/providers/github/types";
import type { PreparedIdentityConnection } from "@/app/auth/providers/identityProviders/types";

export async function prepareGitHubIdentityConnection(params: {
    ctx: Context;
    profile: unknown;
    accessToken: string;
    preferredUsername?: string | null;
}): Promise<PreparedIdentityConnection> {
    // Lazy import to avoid provider-registry import cycles during server startup/tests.
    const { prepareGithubConnect } = await import("./githubConnect");
    return await prepareGithubConnect(
        params.ctx,
        params.profile as GitHubProfile,
        params.accessToken,
        params.preferredUsername ? { preferredUsername: params.preferredUsername } : undefined,
    );
}

export async function connectGitHubIdentity(params: {
    ctx: Context;
    profile: unknown;
    accessToken: string;
    preferredUsername?: string | null;
}): Promise<void> {
    const prepared = await prepareGitHubIdentityConnection(params);
    const { inTx } = await import("@/storage/inTx");
    await inTx(prepared.connectInTx);
}

export async function disconnectGitHubIdentity(ctx: Context): Promise<void> {
    // Lazy import to avoid provider-registry import cycles during server startup/tests.
    const { githubDisconnect } = await import("./githubDisconnect");
    await githubDisconnect(ctx);
}
