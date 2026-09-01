import { describe, expect, it } from 'vitest';

import { redactHarnessLogText } from './harnessLogRedaction';

describe('redactHarnessLogText', () => {
  it('redacts bearer tokens and cookies', () => {
    const token = 'SUPER_SECRET_TOKEN';
    const cookie = 'sessionid=SUPER_SECRET_COOKIE';
    const input = [
      `authorization: Bearer ${token}`,
      `cookie: ${cookie}`,
      `x-api-key: ${token}`,
      'ok=keep',
    ].join('\n');

    const redacted = redactHarnessLogText(input);

    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain(cookie);
    expect(redacted).toContain('ok=keep');
  });

  it('redacts credential-suffixed environment assignments', () => {
    const secret = 'sentinel-unregistered-environment-secret';
    const redacted = redactHarnessLogText([
      `HAPPIER_HOME_MASTER_SECRET=${secret}`,
      `SERVICE_ACCESS_TOKEN=${secret}`,
      'HAPPIER_STRESS_USERS=25',
    ].join('\n'));

    expect(redacted).not.toContain(secret);
    expect(redacted).toContain('HAPPIER_STRESS_USERS=25');
  });

  it('returns an empty string for empty input', () => {
    expect(redactHarnessLogText('')).toBe('');
  });
});
