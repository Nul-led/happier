import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

import { buildBackendTargetKey } from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/agent/core/AgentMessage';
import type {
  ExecutionRunHostRuntime,
  ExecutionRunHostRuntimeMessageHandler,
} from '@/agent/runtime/bridges/executionRun/executionRunHostRuntime';

const createStubRuntime = () => {
  const messages: AgentMessage[] = [];
  let handler: ExecutionRunHostRuntimeMessageHandler | null = null;

  const runtime: ExecutionRunHostRuntime = {
    readResumeSupport: vi.fn(async () => false),
    provisionSession: vi.fn(async () => {
      handler?.({ type: 'model-output', fullText: 'pi-runtime-ready' });
      return { sessionId: 'pi-session-1' };
    }),
    sendPrompt: vi.fn(async (_sessionId: string, prompt: string) => {
      handler?.({ type: 'model-output', fullText: `pi:${prompt}` });
    }),
    cancel: vi.fn(async () => undefined),
    subscribeMessages: vi.fn((next: ExecutionRunHostRuntimeMessageHandler) => {
      handler = next;
      return () => {
        if (handler === next) {
          handler = null;
        }
      };
    }),
    waitForTurnCompletion: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };

  return { runtime, messages };
};

const resolveBackendEngineAdapterResolutionMock = vi.fn();

vi.mock('@/agent/runtime/registry/engineRegistry', () => ({
  resolveBackendEngineAdapterResolution: (...args: unknown[]) => resolveBackendEngineAdapterResolutionMock(...args),
}));

describe('createExecutionRunRuntime (pi)', () => {
  beforeEach(() => {
    resolveBackendEngineAdapterResolutionMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.HAPPIER_HOME_DIR;
    delete process.env.HAPPIER_SERVER_URL;
    delete process.env.HAPPIER_WEBAPP_URL;
  });

  it('creates the pi execution-run runtime through runtimeCore without using the legacy execution-run registry directly', async () => {
    const { runtime, messages } = createStubRuntime();
    const createExecutionRunBackendMock = vi.fn(() => runtime);
    resolveBackendEngineAdapterResolutionMock.mockResolvedValue({
      backendId: 'pi',
      engineAdapter: {
        runtimeCore: {
          createExecutionRunBackend: createExecutionRunBackendMock,
        },
      },
    });
    const { createExecutionRunRuntime } = await import('./create');

    const executionRuntime = createExecutionRunRuntime({
      cwd: process.cwd(),
      backendId: 'pi',
      permissionMode: 'read_only',
    });

    const unsubscribe = executionRuntime.subscribeMessages((message) => {
      messages.push(message);
    });

    await expect(executionRuntime.provisionSession()).resolves.toEqual({ sessionId: 'pi-session-1' });
    await expect(executionRuntime.sendPrompt('pi-session-1', 'hello')).resolves.toBeUndefined();
    await expect(executionRuntime.cancel('pi-session-1')).resolves.toBeUndefined();
    await expect(executionRuntime.waitForTurnCompletion?.()).resolves.toBeUndefined();
    await expect(executionRuntime.dispose()).resolves.toBeUndefined();
    unsubscribe();

    expect(resolveBackendEngineAdapterResolutionMock).toHaveBeenCalledWith('pi', expect.any(Object));
    expect(createExecutionRunBackendMock).toHaveBeenCalledWith(expect.objectContaining({
      backendId: 'pi',
      permissionMode: 'read_only',
    }));
    expect(messages).toEqual(expect.arrayContaining([
      { type: 'model-output', fullText: 'pi-runtime-ready' },
      { type: 'model-output', fullText: 'pi:hello' },
      {
        type: 'event',
        name: 'runtime.capabilities',
        payload: {
          executionRun: { supported: true },
        },
      },
    ]));
    expect('startSession' in executionRuntime).toBe(false);
    expect('onMessage' in executionRuntime).toBe(false);
  });

  it('carries the initial active-turn authority to the runtime-core backend factory', async () => {
    const { runtime } = createStubRuntime();
    const createExecutionRunBackendMock = vi.fn(() => runtime);
    const causalPermissionAuthority = {
      kind: 'admittedSessionInputV1',
      admittedPermissionCeiling: 'default',
    } as const;
    resolveBackendEngineAdapterResolutionMock.mockResolvedValue({
      backendId: 'pi',
      engineAdapter: {
        runtimeCore: {
          createExecutionRunBackend: createExecutionRunBackendMock,
        },
      },
    });
    const { createExecutionRunRuntime } = await import('./create');

    const executionRuntime = createExecutionRunRuntime({
      cwd: process.cwd(),
      backendId: 'pi',
      permissionMode: 'yolo',
      causalPermissionAuthority,
    });

    await expect(executionRuntime.provisionSession()).resolves.toEqual({ sessionId: 'pi-session-1' });

    expect(createExecutionRunBackendMock).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'yolo',
      causalPermissionAuthority,
    }));
  });

  // Ephemeral isolation is created before the engine can fail, so this owner —
  // the only execution-run backend composer — must remove the run's isolation
  // root when backend construction throws, or a failed run leaks a directory.
  it('removes the ephemeral isolation root when runtime-core backend construction throws', async () => {
    const homeDir = await mkdtemp(join(os.tmpdir(), 'happier-execution-run-isolation-home-'));
    try {
      process.env.HAPPIER_HOME_DIR = homeDir;
      process.env.HAPPIER_SERVER_URL = 'https://api.example.test';
      process.env.HAPPIER_WEBAPP_URL = 'https://app.example.test';

      const { reloadConfiguration, configuration } = await import('@/configuration');
      reloadConfiguration();

      resolveBackendEngineAdapterResolutionMock.mockResolvedValue({
        backendId: 'pi',
        engineAdapter: {
          runtimeCore: {
            createExecutionRunBackend: () => {
              throw new Error('engine backend failed');
            },
          },
        },
      });
      const { createExecutionRunRuntime } = await import('./create');

      const executionRuntime = createExecutionRunRuntime({
        cwd: process.cwd(),
        backendId: 'pi',
        runId: 'run_engine_throw',
        permissionMode: 'read_only',
        start: {
          intent: 'review',
          retentionPolicy: 'ephemeral',
        },
      });
      const isolationRoot = join(
        configuration.activeServerDir,
        'isolation',
        'pi',
        'execution_run',
        'run_engine_throw',
      );

      await expect(executionRuntime.provisionSession({ initialPrompt: 'boot' }))
        .rejects.toThrow('engine backend failed');
      await expect.poll(() => existsSync(isolationRoot)).toBe(false);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('throws when the built-in backend target is disabled in account settings before creating the runtime shell', async () => {
    const targetKey = buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'pi' });
    const { createExecutionRunRuntime } = await import('./create');

    expect(() =>
      createExecutionRunRuntime({
        cwd: process.cwd(),
        backendId: 'pi',
        backendTarget: { kind: 'builtInAgent', agentId: 'pi' },
        permissionMode: 'read_only',
        accountSettings: {
          backendEnabledByTargetKey: {
            [targetKey]: false,
          },
        },
      }),
    ).toThrow('pi is disabled in your account settings (enable it in the UI provider settings).');
  });
});
