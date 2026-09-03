import { describe, expect, it } from 'vitest';

import {
  PendingActivationAuthorizationV1Schema,
  PendingActivationFailureRequestV1Schema,
  PendingActivationFailureResponseV1Schema,
} from './pendingActivationAuthorizationV1.js';

describe('PendingActivationAuthorizationV1', () => {
  it('accepts waiting and terminal-failed authorizations and rejects unbounded failure codes', () => {
    expect(PendingActivationAuthorizationV1Schema.parse({
      requestId: 'pending-1',
      requestedAt: 42,
      status: 'waiting',
    })).toEqual({ requestId: 'pending-1', requestedAt: 42, status: 'waiting' });
    expect(PendingActivationAuthorizationV1Schema.parse({
      requestId: 'pending-1',
      requestedAt: 42,
      status: 'failed',
      failureCode: 'runtime_start_failed',
    })).toEqual({
      requestId: 'pending-1',
      requestedAt: 42,
      status: 'failed',
      failureCode: 'runtime_start_failed',
    });
    expect(PendingActivationFailureRequestV1Schema.safeParse({
      requestId: 'pending-1',
      requestedAt: 42,
      failureCode: 'machine_offline',
    }).success).toBe(false);
    expect(PendingActivationFailureResponseV1Schema.parse({ ok: true, didFail: false }))
      .toEqual({ ok: true, didFail: false });
  });
});
