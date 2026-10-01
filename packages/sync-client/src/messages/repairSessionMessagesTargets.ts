import type { SessionMessageV1, SessionMessagesPageV1 } from '@happier-dev/protocol';
import { throwIfAborted } from '../abortSignal.js';

export type SessionMessageRepairTarget = Readonly<{ messageId: string; seq: number }>;

/** Refetch target ranges without owning the transcript window or its tail cursor. */
export async function repairSessionMessagesTargets(params: Readonly<{
  targets: readonly SessionMessageRepairTarget[];
  pageSize?: number;
  fetchPage: (afterSeq: number, signal: AbortSignal, targetIds: ReadonlySet<string>) => Promise<SessionMessagesPageV1>;
  signal: AbortSignal;
  onPage?: (messages: readonly SessionMessageV1[], targetIds: ReadonlySet<string>) => Promise<void | ReadonlySet<string>> | void | ReadonlySet<string>;
  onResolvedMessageIds?: (messageIds: ReadonlySet<string>) => void;
}>): Promise<ReadonlySet<string>> {
  const targets = [...params.targets].sort((left, right) => left.seq - right.seq);
  const resolved = new Set<string>();
  for (let start = 0; start < targets.length;) {
    throwIfAborted(params.signal);
    let end = start + 1;
    if (params.pageSize !== undefined) {
      while (end < targets.length && targets[end].seq - targets[start].seq < params.pageSize) end++;
    }
    const targetIds = new Set(targets.slice(start, end).map((target) => target.messageId));
    const page = await params.fetchPage(targets[start].seq - 1, params.signal, targetIds);
    throwIfAborted(params.signal);
    // Without a caller page budget, reuse the actual fetched range. No core limit
    // competes with the owning HTTP reader's paging policy.
    if (params.pageSize === undefined && page.messages.length > 0) {
      const through = page.messages.reduce((seq, message) => Math.max(seq, message.seq), -1);
      while (end < targets.length && targets[end].seq <= through) targetIds.add(targets[end++].messageId);
    }
    const acknowledged = await params.onPage?.(page.messages, targetIds);
    throwIfAborted(params.signal);
    for (const id of acknowledged ?? page.messages.filter((message) => targetIds.has(message.id)).map((message) => message.id)) {
      if (targetIds.has(id)) resolved.add(id);
    }
    params.onResolvedMessageIds?.(resolved);
    start = end;
  }
  return resolved;
}
