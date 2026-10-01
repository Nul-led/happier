import { describe, expect, it } from 'vitest';

import { AGENT_DEFINITION } from './definition.js';

describe('Qwen agent definition', () => {
  it('advertises the MCP delivery path used by its ACP runtime', () => {
    expect(AGENT_DEFINITION.core.tools).toEqual({
      delivery: 'native_mcp',
      support: 'experimental',
    });
  });

  it('advertises the session list served by every supported Qwen ACP release', () => {
    expect(AGENT_DEFINITION.core.sessionCapabilities.sessionListing).toBe('supported');
    expect(AGENT_DEFINITION.sessionModeDescriptor).toEqual({
      source: 'acp',
      semantics: 'agent-modes',
      runtimeSwitch: 'acp-setSessionMode',
    });
    expect(AGENT_DEFINITION.sessionModesKind).toBe('acpAgentModes');
  });
});
