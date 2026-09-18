import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  followInput: null as Record<string, unknown> | null,
}));

vi.mock('@/api/sessionFollowActionDeps', () => ({
  createSessionFollowActionDeps: (input: Record<string, unknown>) => {
    captured.followInput = input;
    return { sessionFollowAction: vi.fn() };
  },
}));

vi.mock('./createCliActionExecutorHarness', () => ({
  createCliActionExecutorHarness: () => ({
    executor: {
      prepare: vi.fn(),
      execute: vi.fn(),
      replayApprovedApprovalRequest: vi.fn(),
    },
  }),
}));

vi.mock('./createDaemonPluginActionExecutor', () => ({
  createDaemonPluginActionExecutor: ({ base }: { base: unknown }) => base,
}));

import { createCliActionExecutor } from './createCliActionExecutor';

describe('createCliActionExecutor Session Follow preparation composition', () => {
  beforeEach(() => {
    captured.followInput = null;
  });

  it('binds post-commit source-key preparation for a credentialed direct CLI host', () => {
    createCliActionExecutor({
      token: 'credential-token',
      credentials: {
        token: 'credential-token',
        encryption: { type: 'legacy', secret: new Uint8Array(32).fill(3) },
      },
      serverId: 'home-a',
      serverHttpBaseUrl: 'https://home-a.example.test',
      sessionId: 'destination-session',
      mode: 'plain',
      ctx: null,
    });

    expect(captured.followInput).toMatchObject({
      token: 'credential-token',
      serverId: 'home-a',
      serverHttpBaseUrl: 'https://home-a.example.test',
      prepareSourceKeyAfterSet: expect.any(Function),
    });
  });
});
