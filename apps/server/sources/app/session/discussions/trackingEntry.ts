import { prismaRuntime as Prisma } from "@/storage/prisma";
import { getDbProviderFromEnv } from "@/storage/prisma";
import type { Tx } from "@/storage/inTx";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";

import { filterAccountsWithCurrentSessionReadAccessInTx } from "./access";

/**
 * The Discussion half of the canonical Follow tracking-entry transaction.
 *
 * This function is called only after the Follow owner has proved an actual
 * inactive-to-active tracking transition. It therefore replaces any retained,
 * inert cursor with the current Discussion ceiling. An already-tracked refresh
 * never reaches this leaf, so unread accumulated while tracking cannot be
 * erased. Keeping this leaf separate also avoids making Discussion read state a
 * second enrollment owner.
 */
export async function initializeSessionDiscussionCursorsOnTrackingEntryInTx(tx: Tx, params: Readonly<{
    sessionId: string;
    accountId: string;
    authentication?: SessionAccessAuthentication;
}>): Promise<number> {
    return await initializeSessionDiscussionCursorsOnTrackingEntriesInTx(tx, {
        sessionId: params.sessionId,
        accountIds: [params.accountId],
        authentication: params.authentication,
    });
}

/**
 * Set-oriented tracking entry for many Accounts.
 *
 * One bulk access check plus one bulk INSERT...SELECT... upsert replaces the
 * per-Discussion awaited upsert loop. Archive affects the default list, not
 * readability, so every Discussion in the Session is baselined including
 * archived ones; a restored Discussion retains the same entry baseline.
 * `updatedAt` is always rewritten so the affected count equals the Discussion
 * count even when the sequence already matches, preserving the single-entry
 * return contract. The statement is atomic: a concurrent post commits either
 * before the SELECT (new ceiling, caught up) or after (old ceiling, later
 * message unread), never a missing baseline or future cursor.
 */
export async function initializeSessionDiscussionCursorsOnTrackingEntriesInTx(tx: Tx, params: Readonly<{
    sessionId: string;
    accountIds: readonly string[];
    authentication?: SessionAccessAuthentication;
}>): Promise<number> {
    const unique = [...new Set(params.accountIds)].filter(accountId => typeof accountId === 'string' && accountId.length > 0);
    if (unique.length === 0) return 0;
    const readable = await filterAccountsWithCurrentSessionReadAccessInTx(tx, {
        sessionId: params.sessionId,
        accountIds: unique,
        authentication: params.authentication,
    });
    const eligible = unique.filter(accountId => readable.has(accountId));
    if (eligible.length === 0) return 0;
    const now = new Date();
    const provider = getDbProviderFromEnv(process.env, 'postgres');
    // Chunk to respect provider variable limits while staying set-oriented:
    // test fixtures (20-31 Accounts) settle in one chunk.
    const CHUNK = 200;
    let affected = 0;
    for (let offset = 0; offset < eligible.length; offset += CHUNK) {
        const chunk = eligible.slice(offset, offset + CHUNK);
        if (provider === 'mysql') {
            // Single-statement matrix upsert: params are now, K accountIds, sessionId.
            const derivedSql = chunk.length === 1
                ? 'SELECT ? AS `accountId`'
                : `SELECT ? AS \`accountId\` UNION ALL SELECT ${chunk.slice(1).map(() => '?').join(' UNION ALL SELECT ')}`;
            const fullSql = 'INSERT INTO `SessionDiscussionReadState` (`discussionId`, `accountId`, `lastReadSeq`, `updatedAt`) ' +
                `SELECT \`d\`.\`id\`, \`e\`.\`accountId\`, \`d\`.\`messageSeq\`, ? FROM \`SessionDiscussion\` AS \`d\` CROSS JOIN (${derivedSql}) AS \`e\` ` +
                'WHERE `d`.`sessionId` = ? ON DUPLICATE KEY UPDATE `lastReadSeq` = VALUES(`lastReadSeq`), `updatedAt` = VALUES(`updatedAt`)';
            const count = await tx.$executeRawUnsafe(fullSql, now, ...chunk, params.sessionId);
            affected += Number(count);
        } else {
            const eligibleRows = Prisma.join(chunk.map(accountId => Prisma.sql`SELECT ${accountId} AS "accountId"`), ' UNION ALL ');
            const count = await tx.$executeRaw(Prisma.sql`
                INSERT INTO "SessionDiscussionReadState" ("discussionId", "accountId", "lastReadSeq", "updatedAt")
                SELECT "d"."id", "e"."accountId", "d"."messageSeq", ${now}
                FROM "SessionDiscussion" AS "d"
                CROSS JOIN (${eligibleRows}) AS "e"
                WHERE "d"."sessionId" = ${params.sessionId}
                ON CONFLICT("discussionId", "accountId") DO UPDATE SET "lastReadSeq" = excluded."lastReadSeq", "updatedAt" = excluded."updatedAt"
            `);
            affected += Number(count);
        }
    }
    return affected;
}
