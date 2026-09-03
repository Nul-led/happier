import type { DeepIndexDbHandle } from './deepIndex/deepIndexDb';
import type { SummaryShardIndexDbHandle } from './summaryShardIndexDb';

/**
 * The one memory-owner removal operation for derived daemon index state.
 *
 * A Session reaches it when the durable Account-change witness proves it was
 * deleted or its access was revoked, or when it leaves the configured
 * archived-eligibility. It clears summary shards/terms, deep chunks/terms,
 * embeddings, progress cursors, and queue/index state. Callers own the
 * worker-local candidate/observed/backfill and Session crypto caches and the
 * rule that a change cursor is acknowledged only after this succeeds.
 *
 * @returns the normalized Session ids that were processed.
 */
export function removeMemorySessionIndexes(params: Readonly<{
  tier1: SummaryShardIndexDbHandle | null;
  deep: DeepIndexDbHandle | null;
  sessionIds: readonly string[];
}>): readonly string[] {
  const removed: string[] = [];
  const seen = new Set<string>();

  for (const raw of params.sessionIds) {
    const sessionId = String(raw ?? '').trim();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    params.tier1?.deleteSessionIndexData({ sessionId });
    params.deep?.deleteSessionIndexData({ sessionId });
    removed.push(sessionId);
  }

  return removed;
}
