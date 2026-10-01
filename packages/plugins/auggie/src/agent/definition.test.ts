import { describe, expect, it } from 'vitest';

import { AGENT_DEFINITION } from './definition.js';

describe('Auggie agent definition', () => {
  it('advertises the MCP delivery path used by its ACP runtime', () => {
    expect(AGENT_DEFINITION.core.tools).toEqual({
      delivery: 'native_mcp',
      support: 'experimental',
    });
  });

  it('keeps the public Agent definition free of private runtime aggregates', () => {
    expect(AGENT_DEFINITION.id).toBe('auggie');
    expect(AGENT_DEFINITION).not.toHaveProperty('runtimeContributions');
  });
});
