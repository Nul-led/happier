import { describe, expect, it } from 'vitest';

import {
  OPEN_CODE_STABLE_SYSTEM_TOOL_ID,
  OPEN_CODE_V2_SYSTEM_TOOL_ID,
  resolveOpenCodeSystemToolId,
} from './systemTool.js';

describe('resolveOpenCodeSystemToolId', () => {
  it('maps the provider-owned generation setting to the matching declared system tool', () => {
    expect(resolveOpenCodeSystemToolId('stable')).toBe(OPEN_CODE_STABLE_SYSTEM_TOOL_ID);
    expect(resolveOpenCodeSystemToolId('v2')).toBe(OPEN_CODE_V2_SYSTEM_TOOL_ID);
  });

  it('preserves the canonical stable-first resolver for auto and invalid values', () => {
    expect(resolveOpenCodeSystemToolId('auto')).toBe('opencode-cli');
    expect(resolveOpenCodeSystemToolId('beta')).toBe('opencode-cli');
    expect(resolveOpenCodeSystemToolId(null)).toBe('opencode-cli');
  });
});
