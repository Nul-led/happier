import { describe, expect, it, vi } from 'vitest';

import type {
  AgentExecutionRunRuntime,
  AgentExecutionRunRuntimeContextV1,
  AgentRuntime,
  AgentSessionRuntimeContext,
} from '@happier-dev/plugin-sdk/agents/runtime';
import type {
  ResolvedAgentContribution,
  ResolvedAgentRuntimeContribution,
} from '@/plugins/projection/registry/types';
import { createExecutionRunOccurrenceWitnessRegistry } from '@/agent/runtime/bridges/executionRun/runOccurrenceWitness';
import type { AgentInvocationTurnAdmissionWitness } from '@/plugins/runtime/invocation/services/types';
import type { ExecutionRunController } from '@/agent/executionRuns/controllers/types';

import { createEmptyBackendExecutionSurfaces } from '../engineRegistryTypes';
import type { NativeAgentSessionRunToolBindingRequest } from '../engineRegistryTypes';
import { resolveBackendRuntimeCore } from './runtimeCore';

const acpProtocolParams = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@/agent/acp/runtime/publicSession/createPublicAcpRuntimeProtocols', () => ({
  createPublicAcpRuntimeProtocols: (params: Record<string, unknown>) => {
    acpProtocolParams.push(params);
    return Object.freeze({ acp: Object.freeze({ open: vi.fn(), openExecutionRunV1: vi.fn() }) });
  },
}));

const AGENT_ID = 'acme.session-agent';

function createContributions() {
  const backend = {
    id: AGENT_ID,
    agentId: AGENT_ID,
    provenance: 'external',
    source: { kind: 'path' },
    definition: { kindVersion: 1, id: AGENT_ID, agentId: AGENT_ID },
    pluginId: AGENT_ID,
  } as unknown as ResolvedAgentRuntimeContribution;
  const agent = {
    id: AGENT_ID,
    identity: { pluginId: AGENT_ID, localId: AGENT_ID },
    provenance: 'external',
    source: { kind: 'path' },
    definition: { kindVersion: 1, id: AGENT_ID, ownedBackendIds: [AGENT_ID] },
    richDefinition: {
      provenance: 'external',
      definition: {
        id: AGENT_ID,
        title: { key: 'agents.acme.title', fallback: 'Acme' },
        description: { key: 'agents.acme.description', fallback: 'Acme' },
        runtime: { kind: 'custom' },
        primary: 'sessions',
        capabilities: {
          sessions: {
            open: ['create', 'resume'],
            delivery: ['newTurn'],
            cancel: true,
            executionRunContext: { versions: [1] },
          },
        },
      },
    },
    pluginId: AGENT_ID,
  } as unknown as ResolvedAgentContribution;
  return { backend, agent };
}

describe('resolveBackendRuntimeCore Session-owned Execution Run scope', () => {
  it.each([
    {
      label: 'retained',
      start: { intent: 'delegate', runClass: 'long_lived', retentionPolicy: 'resumable' },
    },
    {
      label: 'bounded',
      start: { intent: 'review', runClass: 'bounded', retentionPolicy: 'ephemeral' },
    },
  ])('refuses a $label Session-owned Run when its parent host custody is missing', async ({ start }) => {
    const { backend, agent } = createContributions();
    const open = vi.fn();
    const adapter = await resolveBackendRuntimeCore({
      backend,
      agent,
      executionSurfaces: createEmptyBackendExecutionSurfaces(),
      runtimeOwner: {
        backendId: AGENT_ID,
        selected: { kind: 'plugin_engine', ownerId: AGENT_ID, provenance: 'external', pluginId: AGENT_ID },
        candidates: [],
      },
      nativeAgentRuntime: { sessions: { open } } as unknown as AgentRuntime,
      nativeAgentRuntimeIdentity: {
        pluginId: AGENT_ID,
        pluginVersion: '1.0.0',
        agentId: AGENT_ID,
        generation: 'agent-generation',
        isCurrent: () => true,
      },
    } as never);

    expect(() => adapter?.runtimeCore.createExecutionRunBackend({
      scope: 'session_owned',
      cwd: '/run/missing-parent',
      runId: 'run-missing-parent',
      controllerOccurrenceId: 'run-missing-parent-occurrence',
      callId: 'run-missing-parent-call',
      sidechainId: 'run-missing-parent-sidechain',
      backendId: AGENT_ID,
      permissionMode: 'default',
      start,
    } as never)).toThrow(expect.objectContaining({
      code: 'execution_run_interaction_unavailable',
    }));
    expect(open).not.toHaveBeenCalled();
  });

  it('constructs a truthful execution-run context only for explicit detached scope', async () => {
    const { backend, agent } = createContributions();
    const sessionOpen = vi.fn();
    let openedContext: AgentExecutionRunRuntimeContextV1 | null = null;
    const readOpenedContext = (): AgentExecutionRunRuntimeContextV1 | null => openedContext;
    const executionRunOpen = vi.fn(async (_request: unknown, context: AgentExecutionRunRuntimeContextV1) => {
      openedContext = context;
      return {
        send: vi.fn(async () => ({ status: 'admitted' as const })),
        stop: vi.fn(async () => ({ status: 'notRunning' as const })),
        watch: vi.fn(() => ({ dispose: vi.fn() })),
        dispose: vi.fn(async () => undefined),
      } satisfies AgentExecutionRunRuntime;
    });
    const adapter = await resolveBackendRuntimeCore({
      backend,
      agent,
      executionSurfaces: createEmptyBackendExecutionSurfaces(),
      runtimeOwner: {
        backendId: AGENT_ID,
        selected: { kind: 'plugin_engine', ownerId: AGENT_ID, provenance: 'external', pluginId: AGENT_ID },
        candidates: [],
      },
      nativeAgentRuntime: {
        sessions: {
          open: sessionOpen,
          executionRunContextV1: { open: executionRunOpen },
        },
      } as unknown as AgentRuntime,
      nativeAgentRuntimeIdentity: {
        pluginId: AGENT_ID,
        pluginVersion: '1.0.0',
        agentId: AGENT_ID,
        generation: 'agent-generation',
        isCurrent: () => true,
      },
    } as never);

    const runtime = adapter?.runtimeCore.createExecutionRunBackend({
      scope: 'detached',
      cwd: '/run/detached',
      runId: 'run-detached',
      controllerOccurrenceId: 'run-detached-occurrence',
      callId: 'run-detached-call',
      sidechainId: 'run-detached-sidechain',
      backendId: AGENT_ID,
      permissionMode: 'default',
      start: { intent: 'delegate', runClass: 'long_lived', retentionPolicy: 'resumable' },
    } as never);
    await expect(runtime?.provisionRuntime({ initialPrompt: 'Run independently' })).resolves.toEqual({
      runtimeId: 'run-detached',
    });

    expect(sessionOpen).not.toHaveBeenCalled();
    expect(executionRunOpen).toHaveBeenCalledOnce();
    const observedContext = readOpenedContext();
    if (!observedContext) throw new Error('Expected detached Execution Run context');
    expect(observedContext).toMatchObject({
      scope: { kind: 'execution_run', executionRunId: 'run-detached' },
      executionRun: { id: 'run-detached' },
    });
    expect(observedContext).not.toHaveProperty('session');
    expect(observedContext.executionRun.services).not.toHaveProperty('transcripts');
    await runtime?.dispose();
  });

  it('opens with the Run-bound tool profile and projects host transcript writes into the Run sidechain', async () => {
    const { backend, agent } = createContributions();
    const runtimeLifetime = new AbortController();
    const witness: AgentInvocationTurnAdmissionWitness = {
      inputId: 'input-run-a',
      turnId: 'turn-run-a',
      userMessageSeq: 1,
      userMessageSeqs: [1],
    };
    const controller = {
      kind: 'backend',
      controllerOccurrenceId: 'run-a-occurrence-1',
    } as ExecutionRunController;
    const occurrences = createExecutionRunOccurrenceWitnessRegistry(new Map([['run-a', controller]]));
    occurrences.register({
      runId: 'run-a',
      sidechainId: 'sidechain-a',
      runtimeLifetimeSignal: runtimeLifetime.signal,
      controller: controller as Extract<ExecutionRunController, { kind: 'backend' }>,
      readActiveTurnAdmissionWitness: () => witness,
    });

    const enqueued: { provider: string; body: Record<string, unknown> }[] = [];
    const parentSession = {
      sessionId: 'session-a',
      getMetadataSnapshot: () => ({ path: '/parent', machineId: 'machine-a' }),
      updateMetadata: async () => undefined,
      updateAgentState: async () => undefined,
      enqueueAgentMessageCommitted: async (provider: string, body: Record<string, unknown>) => {
        enqueued.push({ provider, body });
        return { persisted: true } as never;
      },
    };
    // The parent's durable writer must never receive a Session-owned Run event.
    const parentEnqueue = vi.spyOn(parentSession, 'enqueueAgentMessageCommitted');

    const disposeRunToolBinding = vi.fn();
    let toolBindingRequest: NativeAgentSessionRunToolBindingRequest | null = null;
    const composeRunToolBinding = vi.fn(async (request: NativeAgentSessionRunToolBindingRequest) => {
      toolBindingRequest = request;
      return {
        mcpServers: { happier: { command: 'happier-mcp', args: ['--run', request.runId] } },
        dispose: disposeRunToolBinding,
      };
    });

    let openedContext: AgentSessionRuntimeContext | null = null;
    let openedMcpServers: unknown = undefined;
    const open = vi.fn(async (request: { mcpServers?: unknown }, context: AgentSessionRuntimeContext) => {
      openedMcpServers = request.mcpServers;
      openedContext = context;
      await context.session.services.transcripts.publishSessionEvent({ type: 'switch', mode: 'local' });
      throw new Error('stop-after-open-request');
    });

    const adapter = await resolveBackendRuntimeCore({
      backend,
      agent,
      executionSurfaces: createEmptyBackendExecutionSurfaces(),
      runtimeOwner: {
        backendId: AGENT_ID,
        selected: { kind: 'plugin_engine', ownerId: AGENT_ID, provenance: 'external', pluginId: AGENT_ID },
        candidates: [],
      },
      nativeAgentRuntime: { sessions: { open } } as unknown as AgentRuntime,
      nativeAgentRuntimeIdentity: {
        pluginId: AGENT_ID,
        pluginVersion: '1.0.0',
        agentId: AGENT_ID,
        generation: 'agent-generation',
        isCurrent: () => true,
      },
    } as never);

    const runtime = adapter?.runtimeCore.createExecutionRunBackend({
      scope: 'session_owned',
      cwd: '/run/a',
      runId: 'run-a',
      controllerOccurrenceId: 'run-a-occurrence-1',
      backendId: AGENT_ID,
      permissionMode: 'default',
      start: { intent: 'delegate', runClass: 'long_lived', retentionPolicy: 'resumable' },
      sessionInteractionHost: {
        session: parentSession,
        machineId: 'machine-a',
        permissionHandler: {
          handleToolCall: async () => ({ decision: 'approved' }),
          abortPendingRequestAndFlush: vi.fn(async () => undefined),
        },
        composeRunToolBinding,
      },
      sessionOwnedRunScope: {
        runId: 'run-a',
        sidechainId: 'sidechain-a',
        readCurrentRunOccurrence: occurrences.reader.readCurrentRunOccurrence,
        publishSupportedSessionReadActions: vi.fn(),
        projectRunTranscriptSession: () => ({
          sessionId: parentSession.sessionId,
          requiresDurableTurnCompletionMarker: true,
          updateMetadata: parentSession.updateMetadata,
          enqueueAgentMessageCommitted: async (
            provider: string,
            body: Record<string, unknown>,
          ) => await parentSession.enqueueAgentMessageCommitted(
            provider,
            { ...body, sidechainId: 'sidechain-a' },
          ),
        }),
      },
    } as never);
    expect(runtime, 'retained Session-owned Run runtime').toBeTruthy();

    await expect(runtime!.provisionRuntime()).rejects.toThrow('stop-after-open-request');

    // The Run's own tool profile reached the provider open request.
    expect(openedMcpServers).toEqual({ happier: { command: 'happier-mcp', args: ['--run', 'run-a'] } });
    // The same Run-bound profile reaches the generic ACP composer, so an ACP-backed Agent opened
    // inside this Run sees the Happier bridge and configured servers exactly like a native one.
    expect(acpProtocolParams.at(-1)?.mcpServers).toEqual({ happier: { command: 'happier-mcp', args: ['--run', 'run-a'] } });
    expect(composeRunToolBinding).toHaveBeenCalledTimes(1);
    expect(toolBindingRequest!.runId).toBe('run-a');
    expect(toolBindingRequest!.cwd).toBe('/run/a');
    expect(toolBindingRequest!.getPermissionMode()).toBe('default');
    // The Run's occurrence owner answers currentness; the parent turn is not borrowed.
    expect(toolBindingRequest!.readCurrentRunOccurrence('run-a')?.sidechainId).toBe('sidechain-a');
    expect(toolBindingRequest!.isCurrent()).toBe(true);
    // Host-service transcript publication landed in the Run sidechain, not the main transcript.
    expect(openedContext).toBeTruthy();
    expect(parentEnqueue).toHaveBeenCalledTimes(1);
    expect(enqueued[0]?.body).toMatchObject({ sidechainId: 'sidechain-a', type: 'event' });

    // A failed open releases the Run-specific tool binding, never the parent's.
    expect(disposeRunToolBinding).toHaveBeenCalledTimes(1);
  });
});
