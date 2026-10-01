import { describe, expect, it } from 'vitest';

import { isTerminalHostStartupError, TerminalHostStartupError } from './errors';

describe('isTerminalHostStartupError', () => {
  it('recognizes startup failures from every registered external terminal host', () => {
    for (const hostKind of ['tmux', 'zellij', 'herdr'] as const) {
      expect(isTerminalHostStartupError(new TerminalHostStartupError({
        hostKind,
        reason: 'startup_action_timeout',
        message: `${hostKind} startup failed`,
      }))).toBe(true);
    }
  });
});
