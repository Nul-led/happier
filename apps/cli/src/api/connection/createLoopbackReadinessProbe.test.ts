import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: { get: axiosGet },
}));

import { createLoopbackReadinessProbe } from './createLoopbackReadinessProbe';

describe('createLoopbackReadinessProbe', () => {
  beforeEach(() => {
    axiosGet.mockReset();
  });

  it('requires both the expected Home identity and authenticated account access', async () => {
    axiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: {
          features: {},
          capabilities: {
            serverIdentity: { serverIdentityId: 'srv_expected' },
          },
        },
      })
      .mockResolvedValueOnce({ status: 401, data: { error: 'unauthorized' } });

    await expect(createLoopbackReadinessProbe({
      serverUrl: 'http://127.0.0.1:48123',
      token: 'account-token',
      expectedServerIdentityId: 'srv_expected',
    })()).resolves.toMatchObject({ status: 'auth_failed', statusCode: 401 });

    expect(axiosGet).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:48123/v1/features',
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    );
    expect(axiosGet).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:48123/v1/auth/ping',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer account-token' }),
        validateStatus: expect.any(Function),
      }),
    );
  });

  it('fails closed when the public Home identity does not match', async () => {
    axiosGet.mockResolvedValueOnce({
      status: 200,
      data: {
        features: {},
        capabilities: {
          serverIdentity: { serverIdentityId: 'srv_other' },
        },
      },
    });

    await expect(createLoopbackReadinessProbe({
      serverUrl: 'http://127.0.0.1:48123',
      token: 'account-token',
      expectedServerIdentityId: 'srv_expected',
    })()).resolves.toMatchObject({ status: 'auth_failed' });
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });
});
