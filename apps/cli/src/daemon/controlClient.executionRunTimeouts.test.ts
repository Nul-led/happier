import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/persistence')>(),
  readDaemonState: vi.fn(async () => ({
    pid: process.pid,
    httpPort: 43_210,
    controlToken: 'test-control-token',
  })),
}));

import {
  requestExecutionRunConnectedServicesMaterialization,
  resolveExecutionRunConnectedServiceMaterializeTimeoutMs,
} from './controlClient';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveExecutionRunConnectedServiceMaterializeTimeoutMs', () => {
  it('covers the daemon materialization tail backstop plus the materialization work itself', () => {
    expect(resolveExecutionRunConnectedServiceMaterializeTimeoutMs({})).toBe(600_000);
    expect(resolveExecutionRunConnectedServiceMaterializeTimeoutMs({
      HAPPIER_EXECUTION_RUN_CS_MATERIALIZE_TIMEOUT_MS: '250000',
    })).toBe(250_000);
    expect(resolveExecutionRunConnectedServiceMaterializeTimeoutMs({
      HAPPIER_EXECUTION_RUN_CS_MATERIALIZE_TIMEOUT_MS: '10',
    })).toBe(1_000);
    expect(resolveExecutionRunConnectedServiceMaterializeTimeoutMs({
      HAPPIER_EXECUTION_RUN_CS_MATERIALIZE_TIMEOUT_MS: '9999999',
    })).toBe(600_000);
  });

  it('applies the complete materialization budget to the effective request AbortSignal', async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(timeoutSignal);
      return new Response(JSON.stringify({
        ok: true,
        result: {
          activationId: 'activation-1',
          env: { CODEX_HOME: '/tmp/materialized-codex-home' },
          connectedServicesBindings: {},
          registration: {},
        },
      }), { status: 200 });
    }));

    await expect(requestExecutionRunConnectedServicesMaterialization({
      runId: 'run-1',
      runnerPid: process.pid,
      agentId: 'codex',
      connectedServices: {
        v: 2,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
      cwd: '/tmp/workspace',
    })).resolves.toMatchObject({ ok: true });

    expect(timeoutSpy).toHaveBeenCalledWith(600_000);
  });
});
