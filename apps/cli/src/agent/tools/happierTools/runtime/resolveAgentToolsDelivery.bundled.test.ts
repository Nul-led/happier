import { describe, expect, it } from 'vitest';

import { resolveAgentToolsDelivery } from './resolveAgentToolsDelivery';

describe('resolveAgentToolsDelivery (bundled catalog)', () => {
  it('resolves Antigravity native MCP delivery from the current bundled catalog', () => {
    expect(resolveAgentToolsDelivery('antigravity')).toBe('native_mcp');
  });
});
