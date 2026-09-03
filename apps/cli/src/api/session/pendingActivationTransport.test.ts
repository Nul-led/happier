import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportPendingSessionActivationFailure } from './pendingActivationTransport';

const post = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: { post },
}));

describe('pending activation transport', () => {
  beforeEach(() => post.mockReset());

  it('reports terminal runtime-start failure through the exact request CAS route', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, didFail: true } });

    await expect(reportPendingSessionActivationFailure({
      token: 'token',
      sessionId: 'session/with spaces',
      requestId: 'pending-1',
      requestedAt: 10,
      failureCode: 'runtime_start_failed',
    })).resolves.toEqual({ didFail: true });

    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/\/v2\/sessions\/session%2Fwith%20spaces\/pending\/activation\/fail$/),
      {
        requestId: 'pending-1',
        requestedAt: 10,
        failureCode: 'runtime_start_failed',
      },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
  });
});
