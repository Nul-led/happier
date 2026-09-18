import { describe, expect, it } from 'vitest';

import { FX_TERMINAL_CONTRIBUTION } from './contribution.js';

describe('FX terminal contribution', () => {
  // The host appends `argv` after the Agent CLI executable it already
  // resolved, so repeating the executable name here would launch `fx fx`.
  it('contributes arguments only, never the resolved FX executable', async () => {
    const plan = await FX_TERMINAL_CONTRIBUTION.resolveLaunch({
      sessionId: 'session', cwd: '/workspace', metadata: {}, modelSelection: null,
    });
    expect(plan.argv).toEqual([]);
    expect(plan).toMatchObject({ process: { stdio: 'inherit' } });
  });
});
