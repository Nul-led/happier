import type {
  AgentExecutionRunConversationRuntimeV1,
  AgentExecutionRunEvent,
  AgentExecutionRunRuntimeContextV1,
  AgentRuntimeFactoryContext,
} from '@happier-dev/plugin-sdk/agents/runtime';
import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  openSession: vi.fn(),
  openExecutionRunConversation: vi.fn(),
}));

vi.mock('./appServer/native.js', () => ({
  openCodexNativeAppServerSession: native.openSession,
  openCodexNativeAppServerExecutionRunConversation: native.openExecutionRunConversation,
}));

import { createCodexAgentRuntime } from './engine.js';

describe('Codex truthful detached execution scope', () => {
  it('uses the execution-run facet without passing the Run id to a Session owner', async () => {
    const listeners = new Set<Parameters<AgentExecutionRunConversationRuntimeV1['watch']>[0]>();
    const conversation: AgentExecutionRunConversationRuntimeV1 = {
      async send(request) {
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({ kind: 'turn-complete', turnId: request.delivery.turnId });
          }
        });
        return { status: 'admitted' };
      },
      watch(listener) {
        listeners.add(listener);
        return { dispose: () => { listeners.delete(listener); } };
      },
      async dispose() {},
    };
    native.openExecutionRunConversation.mockResolvedValueOnce(conversation);
    const context = {
      scope: { kind: 'execution_run', executionRunId: 'run-codex-1' },
      executionRun: {
        id: 'run-codex-1',
        services: {
          features: { isEnabled: () => true },
          hooks: {},
          fileFollow: {},
          mcp: {},
          toolExecution: {},
        },
      },
      protocols: { acp: { openExecutionRunV1: vi.fn() } },
      services: {},
      signal: new AbortController().signal,
    } as unknown as AgentExecutionRunRuntimeContextV1;
    const request = {
      kind: 'create' as const,
      runId: 'run-codex-1',
      cwd: '/repo',
      profile: { pluginId: 'happier.agent.codex', localId: 'default' },
      input: { text: 'Implement the change.' },
      localInputId: 'workflow-input-1',
    };

    const agent = await createCodexAgentRuntime({} as AgentRuntimeFactoryContext);
    const execution = await agent.sessions!.executionRunContextV1!.open(request, context);
    const events: AgentExecutionRunEvent[] = [];
    execution.watch((event) => { events.push(event); });
    await vi.waitFor(() => expect(events.some((event) => event.kind === 'run-complete')).toBe(true));

    expect(native.openSession).not.toHaveBeenCalled();
    expect(native.openExecutionRunConversation).toHaveBeenCalledWith(request, context);
    expect(events.every((event) => event.runId === 'run-codex-1' && !('sessionId' in event))).toBe(true);
  });
});
