import { describe, expect, it, vi } from 'vitest';

import type {
  AgentSessionRuntime,
  AgentSessionRuntimeContext,
} from '@happier-dev/plugin-sdk/agents/runtime';
import type { AgentSessionCapabilities } from '@/plugins/projection/registry/agentContributionDefinition';

import { createNativeAgentSessionInteractionOperations } from './nativeAgentSession';

/**
 * A Session runtime that implements every optional control. The declared
 * capabilities — not the presence of these methods — decide what the host may
 * offer, so this fixture is deliberately more capable than any declaration
 * under test.
 */
function createFullyCapableSessionRuntime(): AgentSessionRuntime {
  return {
    watch: () => ({ dispose() {} }),
    send: vi.fn(async () => undefined),
    cancel: vi.fn(async () => ({ status: 'requested' as const })),
    updateConfiguration: vi.fn(async () => ({ status: 'applied' as const })),
    compact: vi.fn(async () => ({ status: 'admitted' as const })),
    dispose: vi.fn(async () => undefined),
  } as unknown as AgentSessionRuntime;
}

function createContext(): AgentSessionRuntimeContext {
  return {
    agent: { id: 'acp:review-bot' },
    session: { id: 'host-session-1' },
  } as unknown as AgentSessionRuntimeContext;
}

function createOperations(
  capabilities: AgentSessionCapabilities,
  session: AgentSessionRuntime = createFullyCapableSessionRuntime(),
) {
  return createNativeAgentSessionInteractionOperations({
    session,
    sessionId: 'host-session-1',
    cwd: '/tmp/interaction-capabilities',
    context: createContext(),
    capabilities,
  });
}

describe('native Agent Session interaction capability ownership', () => {
  it('offers manual compaction only when the declaration declares it', () => {
    expect('compactContext' in createOperations({
      open: ['create'],
      delivery: ['newTurn'],
      cancel: true,
    })).toBe(false);

    expect('compactContext' in createOperations({
      open: ['create'],
      delivery: ['newTurn'],
      cancel: true,
      compaction: { events: true, manual: true },
    })).toBe(true);
  });

  it('refuses to compose when a declaration promises a control the runtime does not implement', () => {
    const session = {
      watch: () => ({ dispose() {} }),
      send: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    } as unknown as AgentSessionRuntime;

    expect(() => createOperations(
      { open: ['create'], delivery: ['newTurn'], cancel: true },
      session,
    )).toThrow(/does not implement cancel/);
  });
});
