import { describe, expect, it, vi } from 'vitest';

const boundaries = vi.hoisted(() => ({
  discard: vi.fn(),
  resolve: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/api/session/pendingQueueV2Transport', () => ({
  discardPendingQueueV2Messages: boundaries.discard,
}));
vi.mock('./resolveSessionTransportContext', () => ({ resolveSessionTransportContext: boundaries.resolve }));
vi.mock('@/session/transport/rpc/sessionRpc', () => ({ callSessionRpc: boundaries.rpc }));

import { cancelSessionInput } from './cancelSessionInput';

describe('cancelSessionInput', () => {
  it('retires an exact pending input without cancelling a whole Session', async () => {
    boundaries.discard.mockResolvedValueOnce(1);
    await expect(cancelSessionInput({
      credentials: { token: 'token', encryption: null },
      sessionId: 'session-1', localId: 'local-1',
    })).resolves.toEqual({ kind: 'pending_retired' });
    expect(boundaries.resolve).not.toHaveBeenCalled();
    expect(boundaries.rpc).not.toHaveBeenCalled();
  });

  it('requests exact-turn cancellation only after pending materialization', async () => {
    boundaries.discard.mockRejectedValueOnce(Object.assign(new Error('not found'), {
      isAxiosError: true,
      response: { status: 404, data: { error: 'not-found' } },
    }));
    boundaries.resolve.mockResolvedValueOnce({ ok: true, mode: 'plain', sessionId: 'session-1' });
    boundaries.rpc.mockResolvedValueOnce({ ok: true });
    await expect(cancelSessionInput({
      credentials: { token: 'token', encryption: null },
      sessionId: 'session-1', localId: 'local-1',
    })).resolves.toEqual({ kind: 'turn_cancel_requested' });
    expect(boundaries.rpc).toHaveBeenCalledWith(expect.objectContaining({
      request: { sessionId: 'session-1', localId: 'local-1' },
    }));
  });
});
