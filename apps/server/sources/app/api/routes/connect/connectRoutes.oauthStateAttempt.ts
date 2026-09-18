import { db } from "@/storage/db";

export function oauthStateAttemptKey(sid: string): string {
    const normalized = sid.toString().trim();
    return `oauth_state_${normalized}`;
}

export async function deleteOAuthStateAttemptBestEffort(sid: string): Promise<void> {
    const key = oauthStateAttemptKey(sid);
    if (!key || key === "oauth_state_") return;
    await db.repeatKey.delete({ where: { key } }).catch(() => {});
}

export async function consumeValidOAuthStateAttempt(
    sid: string,
): Promise<{ key: string; value: string; expiresAt: Date } | null> {
    const key = oauthStateAttemptKey(sid);
    if (!key || key === "oauth_state_") return null;

    const row = await db.repeatKey.findUnique({ where: { key } });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
        await deleteOAuthStateAttemptBestEffort(sid);
        return null;
    }

    const consumed = await db.repeatKey.deleteMany({
        where: { key: row.key, value: row.value, expiresAt: { gt: new Date() } },
    });
    return consumed.count === 1 ? { key: row.key, value: row.value, expiresAt: row.expiresAt } : null;
}
