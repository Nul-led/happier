import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { get, post } }));
vi.mock('@/session/transport/http/serverHttpBaseUrl', () => ({
  resolveServerHttpBaseUrl: () => 'https://api.example.test',
}));

describe('runAutomationNow', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('uses the authenticated V3 definition-list owner and validates its response', async () => {
    get.mockResolvedValue({
      status: 200,
      data: { automations: [], nextCursor: null },
    });
    const { listAutomationDefinitions } = await import('./automations');

    await expect(listAutomationDefinitions({ token: 'token-1' })).resolves.toEqual({
      automations: [],
      nextCursor: null,
    });

    expect(get).toHaveBeenCalledWith(
      'https://api.example.test/v3/automations?limit=100',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-1' },
      }),
    );
  });

  it('uses the V3 run-now owner and sends the caller occurrence identity', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { run: { id: 'run-1', automationId: 'automation-1', state: 'queued' } },
    });
    const { runAutomationNow } = await import('./automations');

    await expect(runAutomationNow({
      token: 'token-1',
      automationId: 'automation/1',
      idempotencyKey: 'ci-build-42',
    })).resolves.toEqual(expect.objectContaining({ id: 'run-1' }));

    expect(post).toHaveBeenCalledWith(
      'https://api.example.test/v3/automations/automation%2F1/run-now',
      undefined,
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token-1',
          'Idempotency-Key': 'ci-build-42',
        },
      }),
    );
  });
});
