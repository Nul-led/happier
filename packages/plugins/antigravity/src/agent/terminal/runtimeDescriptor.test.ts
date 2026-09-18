import { describe, expect, it } from 'vitest';

import { readAntigravityTerminalConversationId } from './runtimeDescriptor.js';

describe('Antigravity terminal conversation identity', () => {
  it('reads the Antigravity CLI conversation id from the canonical runtime handle', () => {
    expect(readAntigravityTerminalConversationId({
      v: 1,
      agentId: 'antigravity',
      agent: {
        agentExtra: {
          owner: 'antigravity',
          schemaId: 'antigravity.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeHandle: { agyConversationId: 'agy-conversation-1' },
        },
      },
    })).toBe('agy-conversation-1');
  });

  it('prefers the runtime handle over a stale top-level conversation id', () => {
    expect(readAntigravityTerminalConversationId({
      v: 1,
      agentId: 'antigravity',
      agent: {
        agyConversationId: 'stale-cli-conversation',
        agentExtra: {
          owner: 'antigravity',
          schemaId: 'antigravity.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeHandle: { agyConversationId: 'fresh-cli-conversation' },
        },
      },
    })).toBe('fresh-cli-conversation');
  });

  it('never resurrects a host ACP session id as an Antigravity CLI conversation', () => {
    expect(readAntigravityTerminalConversationId({
      v: 1,
      agentId: 'antigravity',
      agent: {
        providerSessionId: 'acp-session-1',
        agentExtra: {
          owner: 'antigravity',
          schemaId: 'antigravity.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeHandle: { providerSessionId: 'acp-session-1' },
        },
      },
    })).toBeNull();
  });

  it('ignores a runtime handle owned by another agent', () => {
    expect(readAntigravityTerminalConversationId({
      v: 1,
      agentId: 'antigravity',
      agent: {
        agentExtra: {
          owner: 'codex',
          schemaId: 'codex.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeHandle: { agyConversationId: 'not-ours' },
        },
      },
    })).toBeNull();
  });

  it('leaves legacy generic carrier normalization to the host compatibility owner', () => {
    expect(readAntigravityTerminalConversationId({
      v: 1,
      providerId: 'antigravity',
      provider: { agyConversationId: 'legacy-carrier' },
    })).toBeNull();
  });

  it('fails closed when canonical and deployed identity fields conflict', () => {
    expect(readAntigravityTerminalConversationId({
      v: 1,
      agentId: 'antigravity',
      providerId: 'codex',
      agent: { agyConversationId: 'conflicted' },
    })).toBeNull();
  });
});
