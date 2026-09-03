import { describe, expect, it } from 'vitest';

import { createPromptRegistryAdapterRegistry } from './createPromptRegistryAdapterRegistry';

describe('createPromptRegistryAdapterRegistry', () => {
  it('registers exactly the shipped registry adapters with real sources', () => {
    const registry = createPromptRegistryAdapterRegistry();

    // The retired `claude_marketplace` reserved slot stays retired: it exposed
    // an empty marketplace adapter row with no producer, no configurable
    // source, and no fetch capability, so its descriptor id must not return.
    expect([...registry.adapters.keys()].sort()).toEqual([
      'git',
      'skills_sh',
    ]);
    expect(registry.adapters.has('claude_marketplace')).toBe(false);
  });
});
