import type { SessionMessageV1, SessionMessagesPageV1 } from '@happier-dev/protocol';
import { throwIfAborted } from '../abortSignal.js';

export class SessionMessageGapError extends Error {
  readonly code = 'session_message_gap';
  constructor(readonly expectedSeq: number, readonly actualSeq: number) {
    super(`Session message gap: expected ${expectedSeq}, received ${actualSeq}`);
    this.name = 'SessionMessageGapError';
  }
}
export async function drainSessionMessagesAfter(params: Readonly<{
  fetchPage: (afterSeq: number, signal: AbortSignal) => Promise<SessionMessagesPageV1>;
  afterSeq: number; signal: AbortSignal;
  onPage: (messages: readonly SessionMessageV1[]) => Promise<void> | void;
}>): Promise<Readonly<{ lastSeq: number }>> {
  let lastSeq = params.afterSeq;
  while (true) {
    throwIfAborted(params.signal);
    const page = await params.fetchPage(lastSeq, params.signal);
    throwIfAborted(params.signal);
    const messages = [...page.messages].sort((left, right) => left.seq - right.seq).filter((message) => message.seq > lastSeq);
    let through = lastSeq;
    const ordered: SessionMessageV1[] = [];
    for (const message of messages) {
      if (message.seq === through) continue;
      ordered.push(message);
      through = message.seq;
    }
    const continues = page.nextAfterSeq !== null && page.nextAfterSeq !== undefined;
    if (continues && (page.nextAfterSeq !== through || ordered.length === 0)) throw new SessionMessageGapError(through, page.nextAfterSeq!);
    await params.onPage(ordered);
    throwIfAborted(params.signal);
    lastSeq = through;
    if (!continues) return { lastSeq };
  }
}
