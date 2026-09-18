import { describe, expect, it, vi } from 'vitest';

import { readAccountEncryptionModeOnce } from './accountEncryptionMode';

describe('readAccountEncryptionModeOnce', () => {
  it('uses only the caller-bound Home transport and bearer', async () => {
    const request = vi.fn(async () => ({ status: 200, data: { mode: 'plain', updatedAt: 1 } }));

    await expect(readAccountEncryptionModeOnce({ request })).resolves.toEqual({
      kind: 'resolved',
      mode: 'plain',
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('retains HTTP and schema failures without interpreting an outage as plain', async () => {
    await expect(readAccountEncryptionModeOnce({
      request: async () => ({ status: 503, data: { mode: 'plain' } }),
    })).resolves.toEqual({ kind: 'http_error', status: 503 });
    await expect(readAccountEncryptionModeOnce({
      request: async () => ({ status: 200, data: { mode: 'unexpected' } }),
    })).resolves.toEqual({ kind: 'invalid_response', status: 200 });
  });
});
