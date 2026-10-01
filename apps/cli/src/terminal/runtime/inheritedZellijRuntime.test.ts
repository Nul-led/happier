import { describe, expect, it } from 'vitest';

import { resolveInheritedZellijRuntime } from './inheritedZellijRuntime';

describe('resolveInheritedZellijRuntime', () => {
  it('binds a terminal-started wrapper to the current Zellij pane', () => {
    expect(resolveInheritedZellijRuntime({
      terminalRuntime: null,
      env: {
        ZELLIJ: '0',
        ZELLIJ_SESSION_NAME: 'work',
        ZELLIJ_PANE_ID: '17',
        ZELLIJ_SOCKET_DIR: '/tmp/zellij',
        HAPPIER_TERMINAL_ATTACHMENT_ID: 'attachment-current',
      },
    })).toEqual({
      mode: 'zellij',
      requested: 'zellij',
      zellijSessionName: 'work',
      zellijPaneId: '17',
      zellijSocketDir: '/tmp/zellij',
      attachmentId: 'attachment-current',
    });
  });

  it('does not override a daemon-supplied terminal decision', () => {
    expect(resolveInheritedZellijRuntime({
      terminalRuntime: { mode: 'plain', requested: 'zellij' },
      env: { ZELLIJ: '0', ZELLIJ_SESSION_NAME: 'work', ZELLIJ_PANE_ID: '17' },
    })).toEqual({ mode: 'plain', requested: 'zellij' });
  });

  it('requires Zellij to identify the current pane', () => {
    expect(resolveInheritedZellijRuntime({
      terminalRuntime: null,
      env: { ZELLIJ: '0', ZELLIJ_SESSION_NAME: 'work' },
    })).toBeNull();
  });
});
