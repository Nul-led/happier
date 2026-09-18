import { describe, expect, it } from 'vitest';

import { DEVIN_TERMINAL_SURFACE } from './contribution.js';

describe('Devin terminal surface', () => {
  it('contributes arguments only so the host launches its resolved Devin CLI once', async () => {
    expect(DEVIN_TERMINAL_SURFACE.resolveLaunch({
      sessionId: 'session', cwd: '/workspace', metadata: {}, modelSelection: null,
    })).toMatchObject({ argv: [], process: { stdio: 'inherit', windowsHide: true } });
  });
});
