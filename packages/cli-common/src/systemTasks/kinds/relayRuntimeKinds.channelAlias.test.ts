import { describe, expect, it } from 'vitest';

import { parseRelayRuntimeTaskParams } from './relayRuntimeKinds.js';

describe('parseRelayRuntimeTaskParams', () => {
  it('normalizes channel publicdev to dev (systemTasks channels are labels)', () => {
    const parsed = parseRelayRuntimeTaskParams({
      target: { kind: 'local' },
      channel: 'publicdev',
    });

    expect(parsed.channel).toBe('dev');
  });

  it('rejects Personal Home purpose over SSH instead of silently installing a generic relay', () => {
    expect(() => parseRelayRuntimeTaskParams({
      target: {
        kind: 'ssh',
        ssh: { target: 'home.example.test', auth: 'agent' },
      },
      purpose: {
        kind: 'personal-home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
      },
    })).toThrow(/Personal Home.*SSH/u);
  });
});
