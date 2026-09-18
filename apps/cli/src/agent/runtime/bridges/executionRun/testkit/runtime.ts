import type {
  ExecutionRunHostRuntime,
  ExecutionRunHostRuntimeMessageHandler,
  ExecutionRunPermissionCapability,
  ExecutionRunRuntimeProvisionOptions,
  ExecutionRunRuntimeProvisionResult,
  RuntimePermissionResponseOutcome,
} from '../executionRunHostRuntime';

export type TestExecutionRunHostRuntimeMessage = Parameters<ExecutionRunHostRuntimeMessageHandler>[0];

export type TestExecutionRunHostRuntimeActions = Readonly<{
  emit: (message: TestExecutionRunHostRuntimeMessage) => void;
}>;

type PromptMeta = Parameters<ExecutionRunHostRuntime['deliverInput']>[2];

export type TestExecutionRunHostRuntimeOverrides = Readonly<{
  runtimeId?: string;
  permissionCapability?: ExecutionRunPermissionCapability;
  readResumeSupport?: ExecutionRunHostRuntime['readResumeSupport'];
  provisionRuntime?: (
    opts: ExecutionRunRuntimeProvisionOptions | undefined,
    actions: TestExecutionRunHostRuntimeActions,
  ) => Promise<ExecutionRunRuntimeProvisionResult> | ExecutionRunRuntimeProvisionResult;
  sendPrompt?: (
    runtimeId: string,
    prompt: string,
    actions: TestExecutionRunHostRuntimeActions,
    meta: PromptMeta,
  ) => Promise<void> | void;
  deliverInput?: ExecutionRunHostRuntime['deliverInput'];
  steerInput?: ExecutionRunHostRuntime['steerInput'];
  sendSteerPrompt?: (
    runtimeId: string,
    prompt: string,
    meta: PromptMeta,
    actions: TestExecutionRunHostRuntimeActions,
  ) => Promise<void> | void;
  cancel?: (runtimeId: string, actions: TestExecutionRunHostRuntimeActions) => Promise<void> | void;
  respondToPermission?: (
    requestId: string,
    approved: boolean,
  ) => Promise<RuntimePermissionResponseOutcome> | RuntimePermissionResponseOutcome;
  waitForTurnCompletion?: ExecutionRunHostRuntime['waitForTurnCompletion'];
  probeTurnLiveness?: ExecutionRunHostRuntime['probeTurnLiveness'];
  dispose?: () => Promise<void> | void;
}>;

export type TestExecutionRunHostRuntimeHarness = Readonly<{
  runtime: ExecutionRunHostRuntime;
  emit: (message: TestExecutionRunHostRuntimeMessage) => void;
  wasDisposed: () => boolean;
}>;

export function createTestExecutionRunHostRuntime(
  overrides: TestExecutionRunHostRuntimeOverrides = {},
): TestExecutionRunHostRuntimeHarness {
  const handlers = new Set<ExecutionRunHostRuntimeMessageHandler>();
  let disposed = false;
  const lifetime = new AbortController();

  const emit = (message: TestExecutionRunHostRuntimeMessage): void => {
    for (const handler of handlers) {
      handler(message);
    }
  };
  const actions: TestExecutionRunHostRuntimeActions = Object.freeze({ emit });
  const runtimeId = overrides.runtimeId ?? 'test_runtime_1';

  const runtime: ExecutionRunHostRuntime = Object.freeze({
    ...(overrides.permissionCapability
      ? { permissionCapability: overrides.permissionCapability }
      : {}),
    readResumeSupport: overrides.readResumeSupport ?? (async () => true),
    provisionRuntime: async (opts) => {
      if (overrides.provisionRuntime) {
        return await overrides.provisionRuntime(opts, actions);
      }
      return { runtimeId };
    },
    getRuntimeLifetimeSignal: () => lifetime.signal,
    deliverInput: async (activeRuntimeId, input, meta) => {
      if (overrides.deliverInput) return await overrides.deliverInput(activeRuntimeId, input, meta);
      await overrides.sendPrompt?.(activeRuntimeId, input.text, actions, meta);
      return { status: 'admitted' };
    },
    ...(overrides.sendSteerPrompt || overrides.steerInput
      ? {
          steerInput: async (
            activeRuntimeId: string,
            input: Parameters<ExecutionRunHostRuntime['deliverInput']>[1],
            meta?: PromptMeta,
          ) => {
            if (overrides.steerInput) return await overrides.steerInput(activeRuntimeId, input, meta);
            await overrides.sendSteerPrompt!(activeRuntimeId, input.text, meta, actions);
            return { status: 'admitted' as const };
          },
        }
      : {}),
    cancel: async (activeRuntimeId) => {
      await overrides.cancel?.(activeRuntimeId, actions);
    },
    subscribeMessages(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    ...(overrides.respondToPermission
      ? {
          respondToPermission: async (requestId: string, approved: boolean) =>
            await overrides.respondToPermission!(requestId, approved),
        }
      : {}),
    ...(overrides.waitForTurnCompletion
      ? { waitForTurnCompletion: overrides.waitForTurnCompletion }
      : {}),
    ...(overrides.probeTurnLiveness
      ? { probeTurnLiveness: overrides.probeTurnLiveness }
      : {}),
    dispose: async () => {
      disposed = true;
      lifetime.abort();
      await overrides.dispose?.();
    },
  });

  return Object.freeze({
    runtime,
    emit,
    wasDisposed: () => disposed,
  });
}
