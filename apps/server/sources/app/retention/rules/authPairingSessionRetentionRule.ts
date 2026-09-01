import { db } from "@/storage/db";
import type { RetentionRule } from "@/app/retention/runtime/retentionRuleRegistry";

const DEFAULT_EXPIRY_CLEANUP_BATCH_SIZE = 100;

type AuthPairingSessionExpiryScope = Readonly<{
    accountId?: string;
    flow?: "direct_qr" | "account_assertion";
}>;

async function runExpiredAuthPairingSessionBatch(params: AuthPairingSessionExpiryScope & Readonly<{
    now: Date;
    batchSize: number;
    dryRun: boolean;
    skip?: number;
}>): Promise<Readonly<{ deleted: number; candidatesExamined: number; hasMore: boolean }>> {
    const limit = Math.max(1, params.batchSize);
    const scope = {
        ...(params.accountId ? { accountId: params.accountId } : null),
        ...(params.flow ? { flow: params.flow } : null),
    };
    const rows = await db.authPairingSession.findMany({
        where: { ...scope, expiresAt: { lte: params.now } },
        orderBy: { expiresAt: "asc" },
        take: limit,
        ...(params.dryRun && params.skip ? { skip: params.skip } : null),
        select: { id: true },
    });
    if (params.dryRun || rows.length === 0) {
        return { deleted: params.dryRun ? rows.length : 0, candidatesExamined: rows.length, hasMore: rows.length === limit };
    }
    const deleted = await db.authPairingSession.deleteMany({
        where: {
            id: { in: rows.map((row) => row.id) },
            ...scope,
            expiresAt: { lte: params.now },
        },
    });
    return { deleted: deleted.count, candidatesExamined: rows.length, hasMore: rows.length === limit };
}

/**
 * Opportunistically removes one bounded batch of intrinsically expired pairing rows.
 * Historical retention settings never extend an authorization request's lifetime.
 */
export async function cleanupExpiredAuthPairingSessions(
    params: AuthPairingSessionExpiryScope & Readonly<{ now: Date; batchSize?: number }>,
): Promise<number> {
    const result = await runExpiredAuthPairingSessionBatch({
        ...params,
        batchSize: params.batchSize ?? DEFAULT_EXPIRY_CLEANUP_BATCH_SIZE,
        dryRun: false,
    });
    return result.deleted;
}

export function createAuthPairingSessionRetentionRule(): RetentionRule {
    let dryRunOffset = 0;
    return {
        id: "authPairingSessions",
        run: async ({ batchSize, dryRun, maxDeletesPerRulePerRun, now }) => {
            const limit = Math.max(1, Math.min(batchSize, maxDeletesPerRulePerRun));
            const result = await runExpiredAuthPairingSessionBatch({
                now,
                batchSize: limit,
                dryRun,
                ...(dryRun && dryRunOffset > 0 ? { skip: dryRunOffset } : null),
            });
            if (dryRun) dryRunOffset += result.candidatesExamined;
            return { id: "authPairingSessions", ...result };
        },
    };
}
