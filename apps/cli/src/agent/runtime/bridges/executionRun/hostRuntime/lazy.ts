import type {
  ExecutionRunHostRuntime,
  ExecutionRunHostRuntimeMessageHandler,
  ExecutionRunPermissionCapability,
} from '@/agent/runtime/bridges/executionRun/executionRunHostRuntime';
import { wrapExecutionRunHostRuntime } from './wrap';

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function readPermissionCapability(value: unknown): ExecutionRunPermissionCapability | null {
  return value === 'responds' || value === 'inline' || value === 'static' ? value : null;
}

function readRuntimePermissionCapability(
  value: unknown,
): ExecutionRunPermissionCapability | null | undefined {
  const record = readRecord(value);
  if (!record) return null;

  let sawMalformedPermissionData = false;
  if (Object.prototype.hasOwnProperty.call(record, 'permissions')) {
    const permissions = readRecord(record.permissions);
    if (!permissions) {
      sawMalformedPermissionData = true;
    } else if (Object.prototype.hasOwnProperty.call(permissions, 'capability')) {
      const capability = readPermissionCapability(permissions.capability);
      if (capability) return capability;
      sawMalformedPermissionData = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(record, 'permissionCapability')) {
    const capability = readPermissionCapability(record.permissionCapability);
    if (capability) return capability;
    sawMalformedPermissionData = true;
  }

  return sawMalformedPermissionData ? null : undefined;
}

export function createLazyExecutionRunHostRuntime(params: Readonly<{
  resolveRuntime: () => Promise<ExecutionRunHostRuntime>;
  onProvisionRuntime?: (runtimeId: string) => Promise<void>;
}>): ExecutionRunHostRuntime {
  const handlers = new Set<ExecutionRunHostRuntimeMessageHandler>();
  const unsubscribeByHandler = new Map<ExecutionRunHostRuntimeMessageHandler, () => void>();
  let resolvedRuntimePromise: Promise<ExecutionRunHostRuntime> | null = null;
  let resolvedRuntime: ExecutionRunHostRuntime | null = null;
  let runtimeProvisionPromise: Promise<string> | null = null;
  let disposePromise: Promise<void> | null = null;
  let disposed = false;
  let activeRuntimeId: string | null = null;
  let permissionCapability: ExecutionRunPermissionCapability | null = null;
  const lifetime = new AbortController();
  let unsubscribeLifetime: (() => void) | null = null;

  const attachQueuedHandlers = (runtime: ExecutionRunHostRuntime): void => {
    for (const handler of handlers) {
      if (!handlers.has(handler) || unsubscribeByHandler.has(handler)) continue;
      unsubscribeByHandler.set(handler, runtime.subscribeMessages((message) => {
        if (message.type === 'event' && message.name === 'runtime.capabilities') {
          const nextPermissionCapability = readRuntimePermissionCapability(message.payload);
          if (nextPermissionCapability !== undefined) {
            permissionCapability = nextPermissionCapability ?? 'static';
          }
        }
        handler(message);
      }));
    }
  };

  const resolveRuntime = async (): Promise<ExecutionRunHostRuntime> => {
    if (disposed) throw new Error('Lazy execution-run runtime is disposed');
    if (resolvedRuntimePromise) {
      return await resolvedRuntimePromise;
    }

    resolvedRuntimePromise = (async () => {
      const runtime = await params.resolveRuntime();
      if (disposed) {
        await runtime.dispose();
        throw new Error('Lazy execution-run runtime is disposed');
      }
      resolvedRuntime = runtime;
      const runtimeLifetime = runtime.getRuntimeLifetimeSignal();
      const onRuntimeAbort = () => lifetime.abort(runtimeLifetime.reason);
      if (runtimeLifetime.aborted) {
        onRuntimeAbort();
      } else {
        runtimeLifetime.addEventListener('abort', onRuntimeAbort, { once: true });
        unsubscribeLifetime = () => runtimeLifetime.removeEventListener('abort', onRuntimeAbort);
      }
      permissionCapability = runtime.permissionCapability ?? permissionCapability;
      attachQueuedHandlers(runtime);
      return runtime;
    })();

    return await resolvedRuntimePromise;
  };

  const refreshPermissionCapability = (runtime: ExecutionRunHostRuntime): void => {
    permissionCapability = runtime.permissionCapability ?? permissionCapability;
  };

  const respondToPermission = async (requestId: string, approved: boolean) => {
    if (!activeRuntimeId) {
      if (!runtimeProvisionPromise) {
        return { delivered: false as const, reason: 'no_active_session' as const };
      }
      await runtimeProvisionPromise;
    }
    const runtime = await resolveRuntime();
    const runtimeResponder = permissionCapability === 'responds'
      ? runtime.respondToPermission
      : undefined;
    if (!runtimeResponder) {
      return { delivered: false as const, reason: 'no_active_session' as const };
    }
    return await runtimeResponder(requestId, approved);
  };

  return wrapExecutionRunHostRuntime({
    readPermissionCapability: () => permissionCapability ?? undefined,
    readInteraction: () => resolvedRuntime?.interaction,
    async readResumeSupport(opts) {
      const runtime = await resolveRuntime();
      return await runtime.readResumeSupport(opts);
    },
    async provisionRuntime(opts) {
      const provisionPromise = (async () => {
        const runtime = await resolveRuntime();
        const started = await runtime.provisionRuntime(opts);
        activeRuntimeId = started.runtimeId;
        refreshPermissionCapability(runtime);
        await params.onProvisionRuntime?.(started.runtimeId);
        return started.runtimeId;
      })();
      runtimeProvisionPromise = provisionPromise;
      try {
        const runtimeId = await provisionPromise;
        return { runtimeId };
      } finally {
        if (runtimeProvisionPromise === provisionPromise) {
          runtimeProvisionPromise = null;
        }
      }
    },
    async deliverInput(runtimeId, input, context) {
      const runtime = await resolveRuntime();
      activeRuntimeId = runtimeId;
      return await runtime.deliverInput(runtimeId, input, context);
    },
    readSteerInput: () => {
      const steerInput = resolvedRuntime?.steerInput;
      return steerInput
        ? async (runtimeId, input, context) => {
            const runtime = await resolveRuntime();
            activeRuntimeId = runtimeId;
            return await steerInput.call(runtime, runtimeId, input, context);
          }
        : undefined;
    },
    getRuntimeLifetimeSignal: () => lifetime.signal,
    readSubscribeProviderInputOutcomes: () => resolvedRuntime?.subscribeProviderInputOutcomes?.bind(resolvedRuntime),
    readSubscribeRuntimeEvents: () => resolvedRuntime?.subscribeRuntimeEvents?.bind(resolvedRuntime),
    readActiveTurnAdmissionWitness: () => resolvedRuntime?.readActiveTurnAdmissionWitness?.bind(resolvedRuntime),
    async cancel(runtimeId) {
      if (!activeRuntimeId) {
        if (!runtimeProvisionPromise) return;
        await runtimeProvisionPromise;
      }
      if (!activeRuntimeId || !resolvedRuntimePromise) return;
      const runtime = await resolveRuntime();
      await runtime.cancel(runtimeId);
    },
    subscribeMessages(handler) {
      handlers.add(handler);
      void resolvedRuntimePromise?.then((runtime) => {
        if (!handlers.has(handler) || unsubscribeByHandler.has(handler)) return;
        unsubscribeByHandler.set(handler, runtime.subscribeMessages(handler));
      }).catch(() => {});
      return () => {
        handlers.delete(handler);
        unsubscribeByHandler.get(handler)?.();
        unsubscribeByHandler.delete(handler);
      };
    },
    readRespondToPermission: () => permissionCapability === 'responds' ? respondToPermission : undefined,
    readAbortPendingPermissionRequests: () => resolvedRuntime?.abortPendingPermissionRequests
      ? async (reason) => await resolvedRuntime?.abortPendingPermissionRequests?.(reason)
      : undefined,
    readWaitForTurnCompletion: () => resolvedRuntime?.waitForTurnCompletion
      ? async (timeoutMs) => {
          const runtime = await resolveRuntime();
          await runtime.waitForTurnCompletion?.(timeoutMs);
        }
      : undefined,
    readProbeTurnLiveness: () => resolvedRuntime?.probeTurnLiveness
      ? async (runtimeId) => {
          const runtime = await resolveRuntime();
          const probeTurnLiveness = runtime.probeTurnLiveness;
          if (typeof probeTurnLiveness !== 'function') {
            return { active: false };
          }
          return await probeTurnLiveness(runtimeId);
        }
      : undefined,
    async dispose() {
      if (disposePromise) {
        return await disposePromise;
      }
      disposed = true;
      lifetime.abort();
      unsubscribeLifetime?.();
      unsubscribeLifetime = null;
      activeRuntimeId = null;
      handlers.clear();
      disposePromise = (async () => {
        for (const unsubscribe of unsubscribeByHandler.values()) {
          unsubscribe();
        }
        unsubscribeByHandler.clear();
        if (resolvedRuntime) {
          await resolvedRuntime.dispose();
          return;
        }
        if (resolvedRuntimePromise) {
          void resolvedRuntimePromise.then(
            async (runtime) => await runtime.dispose(),
            () => undefined,
          ).catch(() => undefined);
        }
      })();
      return await disposePromise;
    },
  });
}
