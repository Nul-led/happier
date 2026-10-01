import { describe, expect, it } from 'vitest';
import { createCliActionDeps } from './createCliActionDeps';

describe('CLI message caller constraints', () => {
  it('refuses an ungranted Send override as invalid input before transport access', async () => {
    const deps = createCliActionDeps({ token: 'daemon-token', sessionId: 'session', mode: 'plain', ctx: null });
    await expect(deps.sessionSendMessage({
      context: { authority: 'account_automation', surface: 'api' }, sessionId: 'session', message: 'input', requestedAction: { v: 1, kind: 'send_now' },
      permissionModeOverride: 'bypassPermissions',
      callerInputConstraints: { models: null, permissionModes: ['default'] },
    })).resolves.toEqual({ status: 'rejected', code: 'session_input_invalid' });
  });
});
