import { describe, expect, it } from 'vitest';

import { KIMI_TERMINAL_CONTRIBUTION } from './contribution.js';

describe('Kimi terminal contribution', () => {
  // The host appends `argv` after the Agent CLI executable it already resolved,
  // so repeating the executable name here would launch `kimi kimi`.
  it('contributes arguments only, never the resolved Kimi executable', async () => {
    await expect(KIMI_TERMINAL_CONTRIBUTION.resolveLaunch({
      sessionId: 'session', cwd: '/workspace', metadata: {}, modelSelection: null,
    })).resolves.toMatchObject({ argv: [], process: { stdio: 'inherit' } });
  });
});
