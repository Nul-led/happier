import { describe, expect, it } from 'vitest';

import { parseSessionChangedWakeV1, SessionChangedWakeV1Schema } from './sessionChangedWake.js';

describe('session_changed wake payload', () => {
  it('accepts the content-free wake with and without a Home identity', () => {
    expect(parseSessionChangedWakeV1({ type: 'session_changed', serverId: 'srv_a', sessionId: 's1' }))
      .toEqual({ type: 'session_changed', serverId: 'srv_a', sessionId: 's1' });
    expect(parseSessionChangedWakeV1({ type: 'session_changed', sessionId: 's1' }))
      .toEqual({ type: 'session_changed', sessionId: 's1' });
  });

  it('rejects the sibling push payloads and any added content field', () => {
    expect(parseSessionChangedWakeV1({ type: 'session_changed', sessionId: 's1', alert: 'muted' }))
      .toEqual({ type: 'session_changed', sessionId: 's1', alert: 'muted' });
    expect(parseSessionChangedWakeV1({ type: 'session_changed', sessionId: 's1', alert: 'visible' })).toBeNull();
    expect(parseSessionChangedWakeV1({ type: 'badge_refresh' })).toBeNull();
    expect(parseSessionChangedWakeV1({ type: 'activity_alert', v: 2, sessionId: 's1' })).toBeNull();
    expect(parseSessionChangedWakeV1({ type: 'session_changed', sessionId: 's1', title: 'secret' })).toBeNull();
    expect(parseSessionChangedWakeV1({ type: 'session_changed', sessionId: '  ' })).toBeNull();
    expect(parseSessionChangedWakeV1(null)).toBeNull();
  });

  it('keeps the schema strict so a future content field cannot ride in unnoticed', () => {
    expect(SessionChangedWakeV1Schema.safeParse({
      type: 'session_changed', sessionId: 's1', body: 'hello',
    }).success).toBe(false);
  });
});
