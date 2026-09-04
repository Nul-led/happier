import { describe, expect, it } from 'vitest';

import { renderAuthentication } from './renderAuthentication';

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

describe('renderAuthentication', () => {
  it('prints executable profile-scoped sign-in commands', () => {
    const text = stripAnsi(renderAuthentication([{
      serverId: 'studio',
      serverName: 'Studio',
      serverUrl: 'https://studio.example.test',
      credentialState: 'missing',
      machineRegistered: false,
      isActive: true,
    }], true, 'happier').join('\n'));

    expect(text).toContain('happier auth login --server studio');
    expect(text).not.toContain('happier auth --server');
  });

  it('describes an inactive stored credential as unverified rather than signed in', () => {
    const text = stripAnsi(renderAuthentication([{
      serverId: 'studio',
      serverName: 'Studio',
      serverUrl: 'https://studio.example.test',
      credentialState: 'stored-unverified',
      machineRegistered: true,
      isActive: false,
    }], true, 'happier').join('\n'));

    expect(text).toContain('stored sign-in · not checked');
    expect(text).not.toContain('other profile signed in');
  });
});
