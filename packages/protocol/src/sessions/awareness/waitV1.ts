import type { WaitConditionV1, WaitOwnerResultV1 } from '../../actions/specs/wait.js';
import type { SessionAwarenessProjectionV1 } from './projectionV1.js';
import type { SessionTurnV1 } from '../turns/sessionTurnV1.js';
import { normalizeStrictJsonValue, sameStrictJsonValue } from '../../json/strictJsonValue.js';

export type SessionWaitSnapshotV1 = Readonly<{ awareness: SessionAwarenessProjectionV1; turn?: SessionTurnV1 }>;
export type SessionWaitSourceV1 = Readonly<{
  currentRevision(): number;
  waitForChange(revision: number, options: { deadlineMs: number | null; signal?: AbortSignal }): Promise<boolean>;
  close(): Promise<void>;
}>;
function matches(snapshot: SessionWaitSnapshotV1, condition: WaitConditionV1): boolean {
  const { awareness, turn } = snapshot;
  const terminal = awareness.lifecycle === 'archived';
  const attention = awareness.operational.reasons.some((reason) =>
    reason === 'permission_required' || reason === 'action_required' || reason === 'blocked_input' || reason === 'failed');
  switch (condition.kind) {
    case 'terminal': return terminal;
    case 'needs_attention': return attention;
    case 'terminal_or_needs_attention': return terminal || attention;
    case 'turn_terminal': return turn?.turnId === condition.turnId
      && (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'cancelled');
    case 'idle': return awareness.freshness === 'live' && awareness.availability === 'complete'
      && awareness.runtime === 'idle' && !awareness.operational.reasons.includes('pending_input') && !attention;
    case 'ready': return awareness.freshness === 'live' && awareness.availability === 'complete'
      && awareness.operational.primary === 'ready' && !attention && !awareness.operational.reasons.includes('pending_input');
    case 'plugin': return false;
  }
}

/** Awareness/turn observation uses the incumbent Session change source, never a cadence. */
export async function waitForSessionAwarenessV1(args: Readonly<{
  condition: WaitConditionV1;
  deadlineMs: number | null;
  signal?: AbortSignal;
  read(): Promise<SessionWaitSnapshotV1 | null>;
  open(): SessionWaitSourceV1;
  onSnapshot?: (snapshot: SessionWaitSnapshotV1) => void | Promise<void>;
}>): Promise<WaitOwnerResultV1> {
  if (args.condition.kind === 'plugin') return { disposition: 'unsupported_condition' };
  let source: SessionWaitSourceV1 | undefined;
  let lastSnapshot: SessionWaitSnapshotV1 | undefined;
  const evaluate = async (): Promise<WaitOwnerResultV1 | null> => {
    if (args.signal?.aborted) return { disposition: 'cancelled' };
    const snapshot = await args.read();
    if (args.signal?.aborted) return { disposition: 'cancelled' };
    if (!snapshot) return { disposition: 'target_unavailable' };
    if (args.onSnapshot && !sameStrictJsonValue(lastSnapshot, snapshot)) await args.onSnapshot(snapshot);
    lastSnapshot = snapshot;
    if (!args.onSnapshot && matches(snapshot, args.condition)) return { disposition: 'matched', snapshot: normalizeStrictJsonValue(snapshot) };
    if (args.deadlineMs !== null && Date.now() >= args.deadlineMs) return { disposition: 'observation_timeout', snapshot: normalizeStrictJsonValue(snapshot) };
    return null;
  };
  try {
    const initial = await evaluate();
    if (initial) return initial;
    source = args.open();
    for (;;) {
      const revision = source.currentRevision();
      const checked = await evaluate();
      if (checked) return checked;
      if (!await source.waitForChange(revision, { deadlineMs: args.deadlineMs, ...(args.signal ? { signal: args.signal } : {}) })) {
        return { disposition: args.signal?.aborted ? 'cancelled'
          : args.deadlineMs !== null && Date.now() >= args.deadlineMs ? 'observation_timeout' : 'disconnected',
          ...(lastSnapshot ? { snapshot: normalizeStrictJsonValue(lastSnapshot) } : {}) };
      }
    }
  } finally { await source?.close(); }
}
