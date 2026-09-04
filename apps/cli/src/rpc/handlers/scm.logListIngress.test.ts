import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RpcHandler, RpcHandlerRegistrar } from '@/api/rpc/types';
import { SCM_OPERATION_ERROR_CODES } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const { runScmRouteMock } = vi.hoisted(() => ({
  runScmRouteMock: vi.fn(),
}));

vi.mock('@/scm/rpc/dispatch', () => ({
  createNonRepositoryScmSnapshotResponse: vi.fn(),
  notRepositoryResponse: vi.fn(),
  runScmRoute: (...args: unknown[]) => runScmRouteMock(...args),
}));

describe('registerScmHandlers scm.log.list ingress', () => {
  afterEach(() => {
    vi.resetModules();
    runScmRouteMock.mockReset();
    vi.restoreAllMocks();
  });

  it.each([
    ['malformed', { cwd: '.', query: 42 }],
    ['over-bound', { cwd: '.', query: 'q'.repeat(513) }],
    ['unknown-field', { cwd: '.', query: 'fix login', routeToAnotherWorkspace: true }],
  ])('rejects %s requests before SCM route/backend execution', async (_label, request) => {
    const handlers = new Map<string, RpcHandler>();
    const registrar: RpcHandlerRegistrar = {
      registerHandler(method, handler) {
        handlers.set(method, handler);
      },
    };
    const { registerScmHandlers } = await import('./scm');
    registerScmHandlers(registrar, '/workspace');
    const handler = handlers.get(RPC_METHODS.SCM_LOG_LIST);
    if (!handler) throw new Error('SCM log-list handler was not registered');

    await expect(handler(request)).resolves.toEqual({
      success: false,
      errorCode: SCM_OPERATION_ERROR_CODES.INVALID_REQUEST,
      error: 'Invalid SCM log-list request',
    });
    expect(runScmRouteMock).not.toHaveBeenCalled();
  });

  it('passes the parsed bounded request and RPC signal into route dispatch', async () => {
    const handlers = new Map<string, RpcHandler>();
    const registrar: RpcHandlerRegistrar = {
      registerHandler(method, handler) {
        handlers.set(method, handler);
      },
    };
    const { registerScmHandlers } = await import('./scm');
    registerScmHandlers(registrar, '/workspace');
    const handler = handlers.get(RPC_METHODS.SCM_LOG_LIST);
    if (!handler) throw new Error('SCM log-list handler was not registered');
    const controller = new AbortController();
    runScmRouteMock.mockResolvedValue({ success: true, entries: [], queryApplied: true });

    await handler({ cwd: '.', query: 'fix login', limit: 20 }, { signal: controller.signal });

    expect(runScmRouteMock).toHaveBeenCalledWith(expect.objectContaining({
      request: { cwd: '.', query: 'fix login', limit: 20 },
      signal: controller.signal,
    }));
  });
});
