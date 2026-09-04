import type { UniversalSearchTarget } from './universalSearchResult';

export type ExactUniversalSearchSessionTarget = Readonly<{
    serverId: string;
    accountId: string;
    sessionId: string;
    seq?: number;
}>;

export type ExactUniversalSearchSessionRead = Readonly<{
    ok: boolean;
    visibleThroughSeq?: number;
}>;

/**
 * Consequential target preparation happens before the host dismisses. Scope
 * currentness is the cheap first fence; Session/transcript results then use the
 * canonical exact-Account Session reader so deletion, access revocation, or a
 * lowered message-publication ceiling while Search is open leaves the surface
 * in place instead of opening a dead or no-longer-readable route.
 */
export async function prepareUniversalSearchResult(
    target: UniversalSearchTarget,
    owners: Readonly<{
        isTargetCurrent(target: UniversalSearchTarget): boolean;
        readExactSession(target: ExactUniversalSearchSessionTarget): Promise<ExactUniversalSearchSessionRead>;
    }>,
): Promise<boolean> {
    if (!owners.isTargetCurrent(target)) return false;
    if (target.kind !== 'session') return true;
    const read = await owners.readExactSession({
        serverId: target.serverId,
        accountId: target.accountId,
        sessionId: target.sessionId,
        ...(target.seq !== undefined ? { seq: target.seq } : {}),
    });
    if (!read.ok) return false;
    return target.seq === undefined
        || (typeof read.visibleThroughSeq === 'number' && target.seq <= read.visibleThroughSeq);
}
