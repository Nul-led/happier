import { resolveProfileLogin } from "./resolveProfileLogin";
import { unlinkIdentity } from "../accountIdentityLifecycle";
import { db } from "@/storage/db";
import { Context } from "@/context";
import { log } from "@/utils/logging/log";

/**
 * Disconnects a GitHub account from a user profile.
 *
 * Flow:
 * 1. Check if user has GitHub connected - early exit if not
 * 2. In transaction: clear GitHub link and username from account (keeps avatar) and delete GitHub user record
 * 3. Send socket update after transaction completes
 *
 * @param ctx - Request context containing user ID
 */
export async function githubDisconnect(ctx: Context): Promise<void> {
    const userId = ctx.uid;

    // Step 1: Check if user has GitHub connection
    const user = await db.account.findUnique({
        where: { id: userId },
        select: { username: true },
    });
    const identity = await db.accountIdentity.findFirst({
        where: { accountId: userId, provider: "github" },
        select: { providerUserId: true, profile: true },
    });

    // Early exit if no GitHub connection
    if (!user || !identity) {
        log({ module: 'github-disconnect' }, `User ${userId} has no GitHub account connected`);
        return;
    }

    const currentUsername = user.username?.toString().trim() || null;
    const githubLogin = resolveProfileLogin({ profile: identity.profile, providerLogin: null });
    const normalize = (v: string | null) => (v ?? '').trim().toLowerCase();
    const shouldClearUsername = Boolean(currentUsername) && Boolean(githubLogin) && normalize(currentUsername) === normalize(githubLogin);

    log({ module: 'github-disconnect' }, `Disconnecting GitHub account ${identity.providerUserId} from user ${userId}`);

    await unlinkIdentity({ accountId: userId, provider: "github", clearMatchingUsername: shouldClearUsername ? currentUsername : null });

    log({ module: 'github-disconnect' }, `GitHub account ${identity.providerUserId} disconnected successfully from user ${userId}`);
}
