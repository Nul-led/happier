import { describe, expect, it } from 'vitest';

import { DROID_TERMINAL_CONTRIBUTION } from './contribution.js';

describe('Droid terminal contribution', () => {
  // The host appends `argv` after the Agent CLI executable it already
  // resolved, so repeating the executable name here would launch
  // `droid droid` instead of the ordinary interactive command.
  it('contributes arguments only, never the resolved Droid executable', async () => {
    const plan = await DROID_TERMINAL_CONTRIBUTION.resolveLaunch({
      sessionId: 'session', cwd: '/workspace', metadata: {}, modelSelection: null,
    });
    expect(plan.argv).toEqual([]);
    expect(plan).toMatchObject({ process: { stdio: 'inherit' } });
  });
});
