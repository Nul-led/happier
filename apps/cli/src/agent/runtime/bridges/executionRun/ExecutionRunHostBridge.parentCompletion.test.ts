import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildExecutionRunProfileCatalog } from '@/agent/executionRuns/profiles/intentRegistry';
import type { ExecutionRunHostRuntime } from './executionRunHostRuntime';
import { createTestExecutionRunHostRuntime } from './testkit';

const { createExecutionRunRuntimeMock } = vi.hoisted(() => ({
  createExecutionRunRuntimeMock: vi.fn(),
}));

vi.mock('./createExecutionRunBridgeRuntime', () => ({
  createExecutionRunBridgeRuntime: createExecutionRunRuntimeMock,
}));

import { ExecutionRunHostBridge } from './ExecutionRunHostBridge';

const temporaryDirectories: string[] = [];

afterEach(() => {
  createExecutionRunRuntimeMock.mockReset();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ExecutionRunHostBridge parent completion input', () => {
  it('enqueues one opted-in provider-neutral Session input from the terminal lifecycle owner', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'happier-execution-run-parent-completion-'));
    const happyHomeDir = mkdtempSync(join(tmpdir(), 'happier-execution-run-parent-completion-home-'));
    temporaryDirectories.push(cwd, happyHomeDir);
    const parentInputs: Array<Readonly<{ text: string; meta: Record<string, unknown> }>> = [];
    createExecutionRunRuntimeMock.mockImplementation((): ExecutionRunHostRuntime => {
      let runtime: ReturnType<typeof createTestExecutionRunHostRuntime>;
      runtime = createTestExecutionRunHostRuntime({
        onSendPrompt: async () => {
          runtime.emitMessage({ type: 'model-output', fullText: 'done' });
        },
        onWaitForTurnCompletion: async () => {},
      });
      return runtime;
    });

    const manager = new ExecutionRunHostBridge({
      parentProvider: `${'primary'}.${'backend'}` as never,
      cwd,
      happyHomeDir,
      executionRunProfileCatalog: buildExecutionRunProfileCatalog(),
      sendAcp: async () => {},
      enqueueParentSessionInput: async (input) => {
        parentInputs.push(input);
      },
      getNowMs: () => 1_700_000_000_000,
    });

    const silent = await manager.start({
      sessionId: 'parent_session_0',
      intent: 'task',
      backendTarget: { kind: 'builtInAgent', agentId: `${'primary'}.${'backend'}` as never },
      instructions: 'Run this task.',
      permissionMode: 'read_only',
      retentionPolicy: 'resumable',
      runClass: 'bounded',
      ioMode: 'request_response',
    });
    await manager.waitForTerminal(silent.runId);
    expect(parentInputs).toHaveLength(0);

    const started = await manager.start({
      sessionId: 'parent_session_1',
      intent: 'task',
      backendTarget: { kind: 'builtInAgent', agentId: `${'primary'}.${'backend'}` as never },
      instructions: 'Review this repo.',
      permissionMode: 'read_only',
      retentionPolicy: 'resumable',
      runClass: 'bounded',
      ioMode: 'request_response',
      accountSettings: { executionRunsNotifyParentOnCompletionDefault: true },
    });
    await manager.waitForTerminal(started.runId);

    expect(parentInputs).toHaveLength(1);
    expect(parentInputs[0]?.text).toContain(started.runId);
    expect(parentInputs[0]?.text).toContain('Final result:\nTask completed.');
    expect((parentInputs[0]?.meta.happierStructuredInputV1 as Record<string, unknown>)).toMatchObject({
      v: 1,
      executionRunCompletion: {
        v: 1,
        runId: started.runId,
        status: 'succeeded',
        canInspect: true,
        summary: 'Task completed.',
      },
    });
  });
});
