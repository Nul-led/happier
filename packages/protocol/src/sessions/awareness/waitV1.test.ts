import { afterEach, expect, it, vi } from 'vitest';
import { projectSessionAwarenessV1 } from './projectV1.js';
import { waitForSessionAwarenessV1, type SessionWaitSourceV1 } from './waitV1.js';
import type { ProjectSessionAwarenessV1Input } from './inputV1.js';

afterEach(() => vi.useRealTimers());
const now = 1_700_000_000_000;
function snapshot(overrides: Partial<ProjectSessionAwarenessV1Input> = {}) {
  return { awareness: projectSessionAwarenessV1({
    nowMs: now, sessionId: 'session', lifecycle: {}, runtime: { presence: 'online', active: true },
    pending: {}, content: { mode: 'plain' },
    currentness: { lifecycle: 'observed', runtime: 'observed', pending: 'observed' }, ...overrides,
  }) };
}

it.each([
  ['idle', {}],
  ['ready', { lifecycle: { latestTurnStatus: 'completed', latestTurnStatusObservedAtMs: now } }],
  ['terminal', { lifecycle: { archivedAtMs: now } }],
  ['needs_attention', { pending: { hasPendingPermissionRequests: true, pendingRequestObservedAtMs: now } }],
  ['terminal_or_needs_attention', { pending: { hasPendingUserActionRequests: true, pendingRequestObservedAtMs: now } }],
] as const)('matches already-true %s with no subscription', async (kind, overrides) => {
  expect(await waitForSessionAwarenessV1({
    condition: { kind }, deadlineMs: null, read: async () => snapshot(overrides),
    open: () => { throw new Error('Already true'); },
  })).toMatchObject({ disposition: 'matched' });
});

it.each(['offline', 'unknown'] as const)('does not match idle from %s runtime evidence', async (presence) => {
  vi.useFakeTimers();
  const deadlineMs = Date.now() + 50;
  const waiting = waitForSessionAwarenessV1({
    condition: { kind: 'idle' }, deadlineMs, read: async () => snapshot({ runtime: { presence, active: false } }),
    open: () => ({ currentRevision: () => 0, close: async () => {},
      waitForChange: () => new Promise((resolve) => setTimeout(() => resolve(false), 50)),
    }),
  });
  await vi.advanceTimersByTimeAsync(50);
  expect(await waiting).toMatchObject({ disposition: 'observation_timeout' });
});

it('rechecks after arming and closes the source on a registration-time transition', async () => {
  let completed = false;
  let closed = false;
  const result = await waitForSessionAwarenessV1({
    condition: { kind: 'turn_terminal', turnId: 'exact-turn' }, deadlineMs: null,
    read: async () => ({ ...snapshot(), turn: { turnId: 'exact-turn', status: completed ? 'completed' : 'in_progress', startedAt: now, updatedAt: now } }),
    open: () => { completed = true; return {
      currentRevision: () => 1, close: async () => { closed = true; },
      waitForChange: async () => { throw new Error('Lost registration-time transition'); },
    }; },
  });
  expect(result).toMatchObject({ disposition: 'matched', snapshot: { turn: { turnId: 'exact-turn', status: 'completed' } } });
  expect(closed).toBe(true);
});

it('cancel releases this source without changing the target', async () => {
  const controller = new AbortController();
  let closed = false;
  const source: SessionWaitSourceV1 = {
    currentRevision: () => 0, close: async () => { closed = true; },
    waitForChange: (_revision, { signal }) => new Promise((resolve) => {
      controller.abort();
      if (signal?.aborted) resolve(false);
      else signal?.addEventListener('abort', () => resolve(false), { once: true });
    }),
  };
  expect(await waitForSessionAwarenessV1({ condition: { kind: 'terminal' }, deadlineMs: null,
    signal: controller.signal, read: async () => snapshot(), open: () => source,
  })).toMatchObject({ disposition: 'cancelled' });
  expect(closed).toBe(true);
});

it('distinguishes a closed observation source from an elapsed deadline', async () => {
  expect(await waitForSessionAwarenessV1({ condition: { kind: 'terminal' }, deadlineMs: null,
    read: async () => snapshot(), open: () => ({ currentRevision: () => 0,
      waitForChange: async () => false, close: async () => {},
    }),
  })).toMatchObject({ disposition: 'disconnected' });
});

it.each(['terminal', 'needs_attention', 'terminal_or_needs_attention', 'idle', 'ready', 'turn_terminal'] as const)(
  'times out an unmatched %s without reading on a healthy cadence', async (kind) => {
    vi.useFakeTimers();
    let reads = 0;
    const waiting = waitForSessionAwarenessV1({
      condition: kind === 'turn_terminal' ? { kind, turnId: 'wanted' } : { kind }, deadlineMs: Date.now() + 50,
      read: async () => { reads += 1; return { ...snapshot({ lifecycle: { latestTurnStatus: 'in_progress', latestTurnStatusObservedAtMs: now } }),
        turn: { turnId: 'other', status: 'completed', startedAt: now, updatedAt: now } }; },
      open: () => ({ currentRevision: () => 0, close: async () => {},
        waitForChange: () => new Promise((resolve) => setTimeout(() => resolve(false), 50)),
      }),
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(reads).toBe(2); // Baseline and post-arm recheck; no timed status reads.
    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toMatchObject({ disposition: 'observation_timeout' });
    expect(reads).toBe(2);
  },
);

it('watches initial and changed snapshots without inventing terminal work', async () => {
  const controller = new AbortController();
  let revision = 0;
  const observed: unknown[] = [];
  let closed = false;
  expect(await waitForSessionAwarenessV1({ condition: { kind: 'terminal' }, deadlineMs: null,
    signal: controller.signal, read: async () => snapshot({ lifecycle: revision ? { archivedAtMs: now } : {} }),
    onSnapshot: (value) => { observed.push(value.awareness.lifecycle); if (revision) controller.abort(); },
    open: () => ({ currentRevision: () => revision, close: async () => { closed = true; },
      waitForChange: async () => { revision += 1; return true; },
    }),
  })).toMatchObject({ disposition: 'cancelled' });
  expect(observed).toEqual(['unknown', 'archived']);
  expect(closed).toBe(true);
});
