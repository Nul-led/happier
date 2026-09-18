import { describe, expect, it, vi } from 'vitest';

const { pairRemote, enrollRemote } = vi.hoisted(() => ({
  pairRemote: vi.fn(async () => undefined),
  enrollRemote: vi.fn(async () => undefined),
}));

vi.mock('./auth/pairRemote', () => ({ handleAuthPairRemote: pairRemote }));
vi.mock('./auth/enrollRemote', () => ({ handleAuthEnrollRemote: enrollRemote }));
vi.mock('./auth/help', () => ({ showAuthHelp: vi.fn() }));
vi.mock('./auth/approve', () => ({ handleAuthApprove: vi.fn() }));
vi.mock('./auth/login', () => ({ handleAuthLogin: vi.fn() }));
vi.mock('./auth/logout', () => ({ handleAuthLogout: vi.fn() }));
vi.mock('./auth/request', () => ({ handleAuthRequest: vi.fn() }));
vi.mock('./auth/status', () => ({ handleAuthStatus: vi.fn() }));
vi.mock('./auth/wait', () => ({ handleAuthWait: vi.fn() }));

import { handleAuthCommand } from './auth';

describe('auth command cancellation ownership', () => {
  it.each([
    ['pair-remote', pairRemote],
    ['enroll-remote', enrollRemote],
  ] as const)('threads the dispatch signal into %s', async (subcommand, handler) => {
    const controller = new AbortController();

    await handleAuthCommand([subcommand, '--fixture'], controller.signal);

    expect(handler).toHaveBeenCalledWith(['--fixture'], controller.signal);
  });
});
