import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentSessionOpenRequest,
  AgentSessionRuntime,
  AgentSessionRuntimeContext,
} from '@happier-dev/plugin-sdk/agents/runtime';

const mocks = vi.hoisted(() => ({
  createPiRuntimeOperations: vi.fn(),
  preparePiQualifiedConnectedAccounts: vi.fn(),
  preparePiHappierToolsExtension: vi.fn(),
}));

vi.mock('./rpc/operations.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./rpc/operations.js')>(),
  createPiRuntimeOperations: mocks.createPiRuntimeOperations,
}));

vi.mock('./qualifiedConnectedAccounts.js', () => ({
  preparePiQualifiedConnectedAccounts: mocks.preparePiQualifiedConnectedAccounts,
}));

vi.mock('../tools/assets.js', () => ({
  preparePiHappierToolsExtension: mocks.preparePiHappierToolsExtension,
}));

import { buildPiAgentRuntimeDescriptorV1 } from '../../protocol/runtimeDescriptorV1.js';
import { createPiAgentRuntime } from './engine.js';

function createRuntime(): AgentSessionRuntime {
  return {
    send: vi.fn(async () => ({ status: 'admitted' as const })),
    watch: () => ({ dispose: () => undefined }),
    dispose: vi.fn(async () => undefined),
  };
}

describe('Pi Agent runtime', () => {
  beforeEach(() => {
    mocks.createPiRuntimeOperations.mockReset();
    mocks.preparePiQualifiedConnectedAccounts.mockReset();
    mocks.preparePiHappierToolsExtension.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bounds preparation inside the aggregate session-open lifecycle and disposes a late result', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolvePreparation!: (value: ReturnType<typeof preparedConnectedAccounts>) => void;
    const preparation = new Promise<ReturnType<typeof preparedConnectedAccounts>>((resolve) => {
      resolvePreparation = resolve;
    });
    const dispose = vi.fn(async () => undefined);
    mocks.preparePiQualifiedConnectedAccounts.mockReturnValue(preparation);

    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    const opening = createPiAgentRuntime().sessions.open({
      kind: 'create',
      sessionId: 'pi-bounded-open',
      cwd: '/workspace',
    }, {
      signal: new AbortController().signal,
      services: { logger: { warn: vi.fn() } },
      session: { id: 'pi-bounded-open', services: {} },
      workState: { publish: vi.fn() },
    } as unknown as AgentSessionRuntimeContext).then(
      (runtime) => {
        outcome = 'resolved';
        return runtime;
      },
      (error: unknown) => {
        outcome = 'rejected';
        return error;
      },
    );

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(outcome).toBe('rejected');
    await expect(opening).resolves.toMatchObject({
      message: expect.stringMatching(/timed out.*qualified Connected Account preparation/i),
    });

    resolvePreparation(preparedConnectedAccounts({ dispose }));
    await vi.advanceTimersByTimeAsync(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.createPiRuntimeOperations).not.toHaveBeenCalled();
  });

  it('cancels preparation from the host signal and disposes a late result', async () => {
    let resolvePreparation!: (value: ReturnType<typeof preparedConnectedAccounts>) => void;
    const preparation = new Promise<ReturnType<typeof preparedConnectedAccounts>>((resolve) => {
      resolvePreparation = resolve;
    });
    const dispose = vi.fn(async () => undefined);
    mocks.preparePiQualifiedConnectedAccounts.mockReturnValue(preparation);
    const controller = new AbortController();
    const opening = createPiAgentRuntime().sessions.open({
      kind: 'create',
      sessionId: 'pi-cancelled-open',
      cwd: '/workspace',
    }, {
      signal: controller.signal,
      services: { logger: { warn: vi.fn() } },
      session: { id: 'pi-cancelled-open', services: {} },
      workState: { publish: vi.fn() },
    } as unknown as AgentSessionRuntimeContext);

    controller.abort(new Error('host cancelled Pi open'));
    await expect(opening).rejects.toThrow('host cancelled Pi open');

    resolvePreparation(preparedConnectedAccounts({ dispose }));
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(mocks.createPiRuntimeOperations).not.toHaveBeenCalled();
  });

  it('does not publish usage recovery without a provider-owned readiness fact', () => {
    const runtime = createPiAgentRuntime();
    expect(runtime.sessions.usageLimitRecovery).toBeUndefined();
  });

  it('interprets its bounded descriptor session file for an external resume', async () => {
    const sessionFile = '/home/lee/.pi/agent/sessions/workspace-a/pi-shared.jsonl';
    const models = { bind: vi.fn(() => ({ dispose: vi.fn() })) };
    const runtime = createRuntime();
    mocks.createPiRuntimeOperations.mockResolvedValue(runtime);
    mocks.preparePiQualifiedConnectedAccounts.mockResolvedValue({
      launchEnvironment: { values: {}, unset: [] },
      isInvalidated: () => false,
      bind: (value: AgentSessionRuntime) => value,
      dispose: async () => undefined,
    });

    await createPiAgentRuntime().sessions.open({
      kind: 'resume',
      sessionId: 'happier-session-1',
      cwd: '/workspace',
      providerSessionId: 'pi-shared',
      runtimeDescriptorV1: buildPiAgentRuntimeDescriptorV1({
        resumeStrategy: 'sessionFileAbsolutePreferred',
        providerSessionId: 'pi-shared',
        sessionFile,
      }),
    } as unknown as AgentSessionOpenRequest, {
      signal: new AbortController().signal,
      services: { logger: {} },
      session: { id: 'happier-session-1', services: { models } },
      workState: { publish: vi.fn() },
    } as unknown as AgentSessionRuntimeContext);

    expect(mocks.createPiRuntimeOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        models,
        eagerStart: true,
        resumeSessionSelector: sessionFile,
        resumeProviderSessionId: 'pi-shared',
        sessionOpenLifecycle: expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      }),
    );
  });

  it('applies the host-resolved configuration when opening a Session', async () => {
    const models = { bind: vi.fn(() => ({ dispose: vi.fn() })) };
    const updateConfiguration = vi.fn(async () => ({
      status: 'applied' as const,
      changed: ['model', 'permissionIntent'] as const,
    }));
    const runtime = {
      ...createRuntime(),
      updateConfiguration,
    };
    mocks.createPiRuntimeOperations.mockResolvedValue(runtime);
    mocks.preparePiQualifiedConnectedAccounts.mockResolvedValue({
      launchEnvironment: { values: {}, unset: [] },
      isInvalidated: () => false,
      bind: (value: AgentSessionRuntime) => value,
      dispose: async () => undefined,
    });
    const configuration = {
      mode: { value: null, updatedAtMs: 0 },
      model: { value: 'anthropic/claude-sonnet-4-6', updatedAtMs: 1 },
      permissionIntent: { value: 'default' as const, updatedAtMs: 1 },
      options: {},
    } as const;
    const request = {
      kind: 'create',
      sessionId: 'pi-configured-session',
      cwd: '/workspace',
      configuration,
    } satisfies AgentSessionOpenRequest;

    const session = await createPiAgentRuntime().sessions.open(request, {
      signal: new AbortController().signal,
      services: { logger: {} },
      session: { id: 'pi-configured-session', services: { models } },
      workState: { publish: vi.fn() },
    } as unknown as AgentSessionRuntimeContext);

    expect(updateConfiguration).toHaveBeenCalledWith(configuration, {
      signal: expect.any(AbortSignal),
    });
    await session.dispose();
  });

  it('binds Connected Account invalidation outside Pi tool-extension cleanup', async () => {
    const models = { bind: vi.fn(() => ({ dispose: vi.fn() })) };
    const runtime = createRuntime();
    const disposeTools = vi.fn(async () => undefined);
    const bind = vi.fn((value: AgentSessionRuntime) => value);
    mocks.createPiRuntimeOperations.mockResolvedValue(runtime);
    mocks.preparePiHappierToolsExtension.mockResolvedValue({
      extensionPath: '/tmp/pi-tools.js',
      configPath: '/tmp/pi-tools.json',
      toolNames: [],
      dispose: disposeTools,
    });
    mocks.preparePiQualifiedConnectedAccounts.mockResolvedValue({
      launchEnvironment: { values: {}, unset: [] },
      isInvalidated: () => false,
      bind,
      dispose: async () => undefined,
    });

    await createPiAgentRuntime().sessions.open({
      kind: 'create',
      sessionId: 'pi-invalidation-cleanup',
      cwd: '/workspace',
    }, {
      signal: new AbortController().signal,
      services: { logger: {} },
      session: {
        id: 'pi-invalidation-cleanup',
        services: {
          models,
          happierTools: {
            resolveNativeBridge: vi.fn(async () => ({
              transport: { kind: 'stdio', command: 'happier-tools' },
              tools: [],
            })),
          },
        },
      },
      workState: { publish: vi.fn() },
    } as unknown as AgentSessionRuntimeContext);

    const invalidationBoundRuntime = bind.mock.calls[0]?.[0];
    expect(invalidationBoundRuntime).toBeDefined();
    await invalidationBoundRuntime!.dispose('runtime_recovery');
    expect(runtime.dispose).toHaveBeenCalledWith('runtime_recovery');
    expect(disposeTools).toHaveBeenCalledOnce();
  });
});

function preparedConnectedAccounts(overrides: Readonly<{ dispose?: () => Promise<void> }> = {}) {
  return {
    launchEnvironment: { values: {}, unset: [] },
    isInvalidated: () => false,
    bind: (value: AgentSessionRuntime) => value,
    dispose: overrides.dispose ?? (async () => undefined),
  };
}
