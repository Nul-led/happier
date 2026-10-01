import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { installTerminalAuthorityCeiling } from './terminalAuthorityCeiling';

vi.mock('@/configuration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/configuration')>();
  return { ...actual, configuration: { ...actual.configuration, terminalPresentUserPolicy: 'disallowed' } };
});

describe('terminal HTTP authority ceiling', () => {
  it('narrows bearer and private daemon requests before they reach the HTTP adapter', async () => {
    const client = axios.create({ adapter: async (config) => ({
      status: 200, statusText: 'OK', headers: {}, config,
      data: config.headers.toJSON(),
    }) });
    const dispose = installTerminalAuthorityCeiling(client);
    try {
      const response = await client.get('https://happier.example.com/v1/account/security', {
        headers: { Authorization: 'Bearer terminal-token', 'x-happier-authority-ceiling': 'present_user' },
      });
      expect(response.data).toHaveProperty('x-happier-authority-ceiling', 'account_automation');
      const daemon = await client.post('http://127.0.0.1:12345/actions/root/execute', {}, {
        headers: { 'x-happier-daemon-token': 'private-control-token' },
      });
      expect(daemon.data).toHaveProperty('x-happier-authority-ceiling', 'account_automation');
      const unrelated = await client.get('https://other.example.com/public');
      expect(unrelated.data).not.toHaveProperty('x-happier-authority-ceiling');
    } finally { dispose(); }
  });
});
