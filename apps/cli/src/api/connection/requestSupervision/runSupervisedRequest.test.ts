import { describe, expect, it, vi } from 'vitest';

import {
  createManagedConnectionSupervisor,
  DEFAULT_MANAGED_CONNECTION_POLICY,
  type ManagedConnectionSupervisor,
  type ManagedConnectionState,
  type ManagedConnectionTransport,
  type ReadinessProbeResult,
} from '@happier-dev/connection-supervisor';

import { HttpStatusError, readHttpStatus } from '@/api/client/httpStatusError';

import { assertManagedConnectionReadyForRequest } from './assertManagedConnectionReadyForRequest';
import { handleRequestAuthenticationFailure, reportRequestOutcomeToSupervisor } from './reportRequestOutcomeToSupervisor';
import { runSupervisedRequest } from './runSupervisedRequest';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createTransportHarness(): {
  transport: ManagedConnectionTransport;
  emitDisconnect: () => void;
} {
  const connectedListeners = new Set<() => void>();
  const disconnectedListeners = new Set<(event: { reason?: string }) => void>();
  const errorListeners = new Set<(error: unknown) => void>();
  let connected = false;
  return {
    transport: {
      connect: vi.fn(async () => {
        connected = true;
        for (const listener of connectedListeners) listener();
      }),
      disconnect: vi.fn(async () => {
        connected = false;
      }),
      destroy: vi.fn(async () => {
        connected = false;
      }),
      isConnected: () => connected,
      onConnected: (listener) => {
        connectedListeners.add(listener);
        return () => connectedListeners.delete(listener);
      },
      onDisconnected: (listener) => {
        disconnectedListeners.add(listener);
        return () => disconnectedListeners.delete(listener);
      },
      onError: (listener) => {
        errorListeners.add(listener);
        return () => errorListeners.delete(listener);
      },
    },
    emitDisconnect: () => {
      connected = false;
      for (const listener of disconnectedListeners) listener({ reason: 'transport closed' });
    },
  };
}

function createState(overrides: Partial<ManagedConnectionState> = {}): ManagedConnectionState {
  return {
    phase: 'online',
    reason: null,
    attempt: 0,
    nextRetryAt: null,
    lastConnectedAt: Date.now(),
    lastDisconnectedAt: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

function createSupervisor(state: ManagedConnectionState = createState()): ManagedConnectionSupervisor {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    captureProbeReportScope: vi.fn(() => ({ generation: 0 })),
    getState: vi.fn(() => state),
    reportProbeResult: vi.fn(),
  };
}

describe('request supervision', () => {
  it('does not let a deferred auth failure from an older connection poison its replacement', async () => {
    vi.useFakeTimers();
    const firstTransport = createTransportHarness();
    const secondTransport = createTransportHarness();
    const transports = [firstTransport, secondTransport];
    const supervisor = createManagedConnectionSupervisor({
      ...DEFAULT_MANAGED_CONNECTION_POLICY,
      createTransport: () => {
        const next = transports.shift();
        if (!next) throw new Error('missing transport');
        return next.transport;
      },
      probeReadiness: async () => ({ status: 'ready' }),
      initialFastRetryDelayMs: 1,
      maxFastRetries: 1,
      backoffMinMs: 1,
      backoffMaxMs: 1,
      jitterRatio: 0,
    });
    try {
      await supervisor.start();
      expect(supervisor.getState().phase).toBe('online');
      const scope = supervisor.captureProbeReportScope?.();
      const request = createDeferred<void>();
      const completion = request.promise.catch((error: unknown) => {
        handleRequestAuthenticationFailure({
          supervisor,
          error,
          hadAuth: true,
          scope,
        });
      });

      firstTransport.emitDisconnect();
      await vi.advanceTimersByTimeAsync(1);
      expect(supervisor.getState().phase).toBe('online');

      request.reject(new HttpStatusError(401, 'expired token'));
      await completion;
      await Promise.resolve();

      expect(supervisor.getState()).toEqual(expect.objectContaining({
        phase: 'online',
        lastErrorMessage: null,
      }));
    } finally {
      await supervisor.stop();
      vi.useRealTimers();
    }
  });

  it('fails fast when the managed connection is already auth_failed', async () => {
    const supervisor = createSupervisor(createState({ phase: 'auth_failed', reason: 'auth_invalid' }));

    expect(() => assertManagedConnectionReadyForRequest(supervisor.getState(), { requireAuth: true })).toThrowError(
      expect.objectContaining({
        name: 'HttpStatusError',
        message: 'Authentication required',
        code: 'not_authenticated',
      }),
    );
    expect(() => assertManagedConnectionReadyForRequest(createState({ phase: 'offline', reason: 'server_unreachable' }))).toThrowError(
      expect.objectContaining({
        name: 'HttpStatusError',
        message: 'Server is currently unreachable',
      }),
    );
    expect(() =>
      assertManagedConnectionReadyForRequest(createState({ phase: 'offline', reason: 'server_unreachable' }), {
        requireOnline: false,
      }),
    ).not.toThrow();
    try {
      assertManagedConnectionReadyForRequest(supervisor.getState(), { requireAuth: true });
    } catch (error) {
      expect(readHttpStatus(error)).toBe(401);
    }

    await expect(
      runSupervisedRequest({
        supervisor,
        requireAuth: true,
        request: async () => 'ok',
      }),
    ).rejects.toMatchObject({
      name: 'HttpStatusError',
      message: 'Authentication required',
    });
  });

  it('can intentionally run supervised requests while the connection is offline', async () => {
    const supervisor = createSupervisor(createState({ phase: 'offline', reason: 'server_unreachable' }));
    const request = vi.fn(async () => 'ok');

    await expect(
      runSupervisedRequest({
        supervisor,
        requireAuth: true,
        requireOnline: false,
        request,
      }),
    ).resolves.toBe('ok');

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows probe-purpose requests while the connection is offline', async () => {
    const supervisor = createSupervisor(createState({ phase: 'offline', reason: 'server_unreachable' }));
    const request = vi.fn(async () => 'ok');

    await expect(
      runSupervisedRequest({
        supervisor,
        purpose: 'probe',
        request,
      }),
    ).resolves.toBe('ok');

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('defers recovery-read requests while the connection is offline by default', async () => {
    const supervisor = createSupervisor(createState({ phase: 'offline', reason: 'server_unreachable' }));
    const request = vi.fn(async () => 'ok');

    await expect(
      runSupervisedRequest({
        supervisor,
        purpose: 'recovery_read',
        request,
      }),
    ).rejects.toMatchObject({
      name: 'HttpStatusError',
      response: { status: 503 },
    });

    expect(request).not.toHaveBeenCalled();
  });

  it('reports terminal auth errors back into the supervisor', async () => {
    const supervisor = createSupervisor();

    await expect(
      runSupervisedRequest({
        supervisor,
        requireAuth: true,
        request: async () => {
          throw new HttpStatusError(401, 'expired token');
        },
      }),
    ).rejects.toThrow(/expired token/i);

    expect(supervisor.reportProbeResult).toHaveBeenCalledWith({
      status: 'auth_failed',
      statusCode: 401,
      errorMessage: 'expired token',
    } satisfies ReadinessProbeResult, { generation: 0 });
  });

  it('keeps every non-probe request failure operation-local', async () => {
    const purposes = [
      undefined,
      'durable_write',
      'recovery_read',
      'transcript_sync',
      'ephemeral_update',
      'snapshot_fetch',
    ] as const;

    for (const purpose of purposes) {
      const supervisor = createSupervisor();
      const failures = [
        new HttpStatusError(503, 'domain unavailable'),
        Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
        Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' }),
        new Error('malformed response'),
      ];

      for (const failure of failures) {
        await expect(runSupervisedRequest({
          supervisor,
          ...(purpose ? { purpose } : {}),
          request: async () => {
            throw failure;
          },
        })).rejects.toBe(failure);
      }

      expect(supervisor.reportProbeResult).not.toHaveBeenCalled();
    }
  });

  it('keeps explicit readiness probes as connection-health transition owners', async () => {
    const supervisor = createSupervisor();
    const serviceUnavailable = new HttpStatusError(503, 'readiness unavailable');

    await expect(runSupervisedRequest({
      supervisor,
      purpose: 'probe',
      request: async () => {
        throw serviceUnavailable;
      },
    })).rejects.toBe(serviceUnavailable);

    expect(supervisor.reportProbeResult).toHaveBeenCalledWith({
      status: 'retry_later',
      errorMessage: 'readiness unavailable',
    } satisfies ReadinessProbeResult, { generation: 0 });
  });

  it('reports socket connect auth errors back into the supervisor', async () => {
    const supervisor = createSupervisor();
    const socketAuthError = Object.assign(new Error('invalid token'), {
      data: {
        statusCode: 401,
        error: 'invalid-token',
      },
    });

    await expect(
      runSupervisedRequest({
        supervisor,
        requireAuth: true,
        request: async () => {
          throw socketAuthError;
        },
      }),
    ).rejects.toBe(socketAuthError);

    expect(supervisor.reportProbeResult).toHaveBeenCalledWith({
      status: 'auth_failed',
      statusCode: 401,
      errorMessage: 'invalid token',
    } satisfies ReadinessProbeResult, { generation: 0 });
  });

  it('reports retryable response and transport failures without inventing domain semantics', () => {
    const supervisor = createSupervisor();
    const connectionError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });

    reportRequestOutcomeToSupervisor({
      supervisor,
      statusCode: 503,
      error: new HttpStatusError(503, 'busy'),
      hadAuth: true,
    });

    reportRequestOutcomeToSupervisor({
      supervisor,
      error: connectionError,
      hadAuth: true,
    });

    reportRequestOutcomeToSupervisor({
      supervisor,
      error: new Error('domain validation failed'),
      hadAuth: true,
    });

    expect(supervisor.reportProbeResult).toHaveBeenNthCalledWith(1, {
      status: 'retry_later',
      errorMessage: 'busy',
    } satisfies ReadinessProbeResult, { generation: 0 });
    expect(supervisor.reportProbeResult).toHaveBeenNthCalledWith(2, {
      status: 'server_unreachable',
      errorMessage: 'connect ECONNREFUSED 127.0.0.1:443',
    } satisfies ReadinessProbeResult, { generation: 0 });
    expect(supervisor.reportProbeResult).toHaveBeenCalledTimes(2);
  });

  it('handles request auth failures by reporting with a supervisor or throwing without one', async () => {
    const supervisionModule = await import('./reportRequestOutcomeToSupervisor') as typeof import('./reportRequestOutcomeToSupervisor') & {
      handleRequestAuthenticationFailure?: (params: Readonly<{
        supervisor?: ManagedConnectionSupervisor | null;
        error?: unknown;
        hadAuth: boolean;
        scope: ReturnType<NonNullable<ManagedConnectionSupervisor['captureProbeReportScope']>> | undefined;
      }>) => boolean;
    };
    expect(typeof supervisionModule.handleRequestAuthenticationFailure).toBe('function');
    if (!supervisionModule.handleRequestAuthenticationFailure) return;

    const supervisor = createSupervisor();
    const authError = new HttpStatusError(403, 'forbidden');

    expect(supervisionModule.handleRequestAuthenticationFailure({
      supervisor,
      error: authError,
      hadAuth: true,
      scope: supervisor.captureProbeReportScope?.(),
    })).toBe(true);
    expect(supervisor.reportProbeResult).toHaveBeenCalledWith({
      status: 'auth_failed',
      statusCode: 403,
      errorMessage: 'forbidden',
    } satisfies ReadinessProbeResult, { generation: 0 });

    expect(() => supervisionModule.handleRequestAuthenticationFailure({
      supervisor: null,
      error: authError,
      hadAuth: true,
      scope: undefined,
    })).toThrow(authError);
  });
});
