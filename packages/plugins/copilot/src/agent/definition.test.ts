import { describe, expect, it } from 'vitest';

import { AGENT_DEFINITION } from './definition.js';

describe('Copilot Agent definition', () => {
  it('advertises the MCP delivery path used by its ACP runtime', () => {
    expect(AGENT_DEFINITION.core.tools).toEqual({
      delivery: 'native_mcp',
      support: 'experimental',
    });
  });

  it('does not project a catalog-runtime hook after its retired metadata is removed', () => {
    expect(AGENT_DEFINITION.runtimeContributions?.agentCatalogEntry).toBeUndefined();
  });
});
