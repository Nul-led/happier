// The enum definition site, deliberately not the `@/storage/prisma` re-export: these
// are pure horizon rules and must not drag the database-client bootstrap behind them.
import { SessionHistoryAccess } from "@/storage/enums.generated";

/**
 * Turn an admission-time history intention into the one persisted horizon fact.
 *
 * `null` completely means "no lower horizon"; a timestamp completely means "only
 * grants that became effective after this membership began". Persisting both an
 * enum and a cutoff would create two values that can disagree, so only the cutoff
 * is stored and the enum is projected back from it.
 *
 * `activationNow` must come from the deciding transaction's database clock. A
 * process clock would let skewed replicas mint horizons that disagree with the
 * grant timestamps they are later compared against.
 */
export function mintSessionAccessStartsAt(
    intent: SessionHistoryAccess,
    activationNow: Date,
): Date | null {
    return intent === SessionHistoryAccess.all_existing ? null : activationNow;
}

/**
 * Project the stored cutoff back to the public semantic mode.
 *
 * Callers and clients receive this enum; the raw cutoff stays a server-owned
 * access input so no consumer can start comparing timestamps locally.
 */
export function sessionHistoryAccessOf(sessionAccessStartsAt: Date | null): SessionHistoryAccess {
    return sessionAccessStartsAt === null
        ? SessionHistoryAccess.all_existing
        : SessionHistoryAccess.from_membership;
}
