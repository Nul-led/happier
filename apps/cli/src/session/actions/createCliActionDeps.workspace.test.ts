import axios, { AxiosHeaders } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V2SessionByIdResponseSchema } from '@happier-dev/protocol';
import { createCliActionExecutorHarness } from './createCliActionExecutorHarness';

afterEach(() => vi.restoreAllMocks());

describe('headless Session-open workspace targeting', () => {
  it('preserves ordinary Session open but refuses a UI tab instead of claiming that tab was opened', async () => {
    const sessionId = 'c123456789012345678901234';
    const sessionResponse = V2SessionByIdResponseSchema.parse({ session: {
      id: sessionId, seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
      encryptionMode: 'plain', metadata: '{}', metadataVersion: 1, dataEncryptionKey: null,
      agentState: '{}', agentStateVersion: 1,
    } });
    // HTTP is the genuine boundary; ID resolution, codecs and Session-open admission remain real.
    vi.spyOn(axios, 'get').mockImplementation(async (url) => {
      const href = String(url);
      const data = href.endsWith('/v1/account/encryption/currentness')
        ? { mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 }
        : href.includes(`/sessions/${sessionId}`) ? sessionResponse : null;
      if (!data) throw new Error(`Unexpected test HTTP request ${href}`);
      return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };
    });
    const { executor } = createCliActionExecutorHarness({
      token: 'workspace-test-token', credentials: { token: 'workspace-test-token', encryption: null },
      serverId: 'home-a', serverHttpBaseUrl: 'https://home-a.example.test', sessionId,
      mode: 'plain', ctx: null,
      resolveServerFeaturesSnapshot: () => ({ status: 'unsupported', reason: 'endpoint_missing' }),
    });
    await expect(executor.execute('session.open', { sessionId, serverId: 'home-a' }, { surface: 'cli' }))
      .resolves.toMatchObject({ ok: true, result: { status: 'opened' } });
    await expect(executor.execute('session.open', { sessionId, serverId: 'home-a', tabId: 'ui-tab' }, { surface: 'cli' })).resolves.toMatchObject({
      ok: false, errorCode: 'unsupported_action',
    });
  });
});
