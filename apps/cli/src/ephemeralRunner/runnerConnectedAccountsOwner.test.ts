import { describe, expect, it } from 'vitest';

import { createRunnerConnectedAccountsAuthorityV1 } from './runnerConnectedAccountsOwner';

const account = Object.freeze({
  service: Object.freeze({ pluginId: 'acme.agent', localId: 'cloud' }),
  accountId: 'work',
});

describe('Runner activation-scoped Connected Accounts authority', () => {
  it('cannot admit direct Account Connected Service selections', () => {
    expect(() => createRunnerConnectedAccountsAuthorityV1({
      sessionId: 'session-1',
      bindings: { v: 2, bindingsByServiceId: {
        'acme.agent/cloud': { source: 'connected', selection: 'profile', profileId: 'work' },
      } },
    })).toThrow();
  });

  it('keeps the public purpose owner empty for native endpoint selections', async () => {
    const authority = createRunnerConnectedAccountsAuthorityV1({
      sessionId: 'session-1',
      bindings: { v: 2, bindingsByServiceId: { 'acme.agent/cloud': { source: 'native' } } },
    });
    authority.dispose();
    await expect(authority.owner.getBinding({
      purpose: { consumer: { pluginId: 'acme.agent', localId: 'agent' }, purpose: 'cloud' },
      serviceRefs: [account.service],
      sessionId: 'session-1',
      signal: new AbortController().signal,
    })).resolves.toBeNull();
  });
});
