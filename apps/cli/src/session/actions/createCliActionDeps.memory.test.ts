import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionExecutor } from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

const { callMachineRpc, fetchSessionById } = vi.hoisted(() => ({
  callMachineRpc: vi.fn(),
  fetchSessionById: vi.fn(),
}));

vi.mock('@/session/transport/rpc/machineRpc', () => ({
  callMachineRpc,
}));

vi.mock('@/session/transport/http/sessionsHttp', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/session/transport/http/sessionsHttp')>(),
  fetchSessionById,
}));

import { createCliActionDeps } from './createCliActionDeps';

describe('createCliActionDeps memory bindings', () => {
  beforeEach(() => {
    callMachineRpc.mockReset();
    fetchSessionById.mockReset();
  });

  it('suppresses retained hits that the current Account can no longer read through Action execution', async () => {
    const credentials = {
      token: 'token',
      encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(1) },
    };
    const hit = (sessionId: string) => ({
      sessionId,
      seqFrom: 1,
      seqTo: 2,
      createdAtFromMs: 10,
      createdAtToMs: 20,
      summary: `retained ${sessionId}`,
      score: 0.8,
    });
    callMachineRpc.mockResolvedValue({
      v: 1,
      ok: true,
      hits: [hit('still-readable'), hit('revoked')],
    });
    fetchSessionById.mockImplementation(async ({ sessionId }: { sessionId: string }) => (
      sessionId === 'still-readable' ? { id: sessionId, seq: 2 } : null
    ));

    const executor = createActionExecutor(createCliActionDeps({
      token: credentials.token,
      credentials,
      sessionId: 'plugin-global',
      mode: 'plain',
      ctx: null,
    }));
    const result = await executor.execute('memory.search', {
      machineId: 'machine-1',
      query: { v: 1, query: 'retained', scope: { type: 'global' }, mode: 'hints' },
    }, { surface: 'agent' });

    expect(result).toEqual({
      ok: true,
      result: { v: 1, ok: true, hits: [hit('still-readable')] },
    });
    expect(fetchSessionById).toHaveBeenCalledTimes(2);
  });

  it('suppresses retained ranges above the current caller-visible Session sequence ceiling', async () => {
    const credentials = {
      token: 'token',
      encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(1) },
    };
    const hit = (seqFrom: number, seqTo: number) => ({
      sessionId: 'shared-session',
      seqFrom,
      seqTo,
      createdAtFromMs: seqFrom,
      createdAtToMs: seqTo,
      summary: `retained ${seqFrom}-${seqTo}`,
      score: 0.8,
    });
    callMachineRpc.mockResolvedValue({
      v: 1,
      ok: true,
      hits: [hit(1, 4), hit(5, 6)],
    });
    fetchSessionById.mockResolvedValue({ id: 'shared-session', seq: 4 });

    const executor = createActionExecutor(createCliActionDeps({
      token: credentials.token,
      credentials,
      sessionId: 'plugin-global',
      mode: 'plain',
      ctx: null,
    }));
    const result = await executor.execute('memory.search', {
      machineId: 'machine-1',
      query: { v: 1, query: 'retained', scope: { type: 'global' }, mode: 'hints' },
    }, { surface: 'agent' });

    expect(result).toEqual({
      ok: true,
      result: { v: 1, ok: true, hits: [hit(1, 4)] },
    });
  });

  it('rejects a memory window for a revoked Session before daemon RPC', async () => {
    const credentials = {
      token: 'token',
      encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(1) },
    };
    fetchSessionById.mockResolvedValue(null);
    const deps = createCliActionDeps({
      token: credentials.token,
      credentials,
      sessionId: 'plugin-global',
      mode: 'plain',
      ctx: null,
    });

    await expect(deps.daemonMemoryGetWindow({
      machineId: 'machine-1',
      sessionId: 'revoked-session',
      seqFrom: 1,
      seqTo: 2,
      serverId: null,
    })).rejects.toMatchObject({ code: 'not_authenticated' });
    expect(callMachineRpc).not.toHaveBeenCalled();
  });

  it('rejects a memory window crossing the caller-visible Session ceiling before daemon RPC', async () => {
    const credentials = {
      token: 'token',
      encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(1) },
    };
    fetchSessionById.mockResolvedValue({ id: 'shared-session', seq: 5 });
    const deps = createCliActionDeps({
      token: credentials.token,
      credentials,
      sessionId: 'plugin-global',
      mode: 'plain',
      ctx: null,
    });

    await expect(deps.daemonMemoryGetWindow({
      machineId: 'machine-1',
      sessionId: 'shared-session',
      seqFrom: 4,
      seqTo: 6,
      serverId: null,
    })).rejects.toMatchObject({ code: 'not_authenticated' });
    expect(callMachineRpc).not.toHaveBeenCalled();
  });

  it('routes the three canonical memory actions through the authenticated machine RPC owner', async () => {
    const credentials = {
      token: 'token',
      encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(1) },
    };
    const searchResult = { v: 1 as const, ok: true as const, hits: [] };
    const windowResult = { v: 1 as const, snippets: [], citations: [] };
    const ensureResult = { ok: true as const };
    callMachineRpc
      .mockResolvedValueOnce(searchResult)
      .mockResolvedValueOnce(windowResult)
      .mockResolvedValueOnce(ensureResult)
      .mockResolvedValueOnce(ensureResult);
    fetchSessionById.mockResolvedValue({ id: 'session-1', seq: 18 });

    const deps = createCliActionDeps({
      token: credentials.token,
      credentials,
      sessionId: 'plugin-global',
      mode: 'plain',
      ctx: null,
    });
    const query = {
      v: 1 as const,
      query: 'canonical owner',
      scope: { type: 'global' as const },
      mode: 'hints' as const,
    };

    await expect(deps.daemonMemorySearch({
      machineId: 'machine-1',
      query,
      serverId: null,
    })).resolves.toEqual(searchResult);
    await expect(deps.daemonMemoryGetWindow({
      machineId: 'machine-1',
      sessionId: 'session-1',
      seqFrom: 12,
      seqTo: 18,
      serverId: null,
    })).resolves.toEqual(windowResult);
    await expect(deps.daemonMemoryEnsureUpToDate({
      machineId: 'machine-1',
      sessionId: 'session-1',
      serverId: null,
    })).resolves.toEqual(ensureResult);
    await expect(deps.daemonMemoryEnsureUpToDate({
      machineId: 'machine-1',
      serverId: null,
    })).resolves.toEqual(ensureResult);

    expect(callMachineRpc.mock.calls).toEqual([
      [{
        credentials,
        machineId: 'machine-1',
        method: RPC_METHODS.DAEMON_MEMORY_SEARCH,
        request: query,
      }],
      [{
        credentials,
        machineId: 'machine-1',
        method: RPC_METHODS.DAEMON_MEMORY_GET_WINDOW,
        request: { v: 1, sessionId: 'session-1', seqFrom: 12, seqTo: 18 },
      }],
      [{
        credentials,
        machineId: 'machine-1',
        method: RPC_METHODS.DAEMON_MEMORY_ENSURE_UP_TO_DATE,
        request: { sessionId: 'session-1' },
      }],
      [{
        credentials,
        machineId: 'machine-1',
        method: RPC_METHODS.DAEMON_MEMORY_ENSURE_UP_TO_DATE,
        request: {},
      }],
    ]);
  });
});
