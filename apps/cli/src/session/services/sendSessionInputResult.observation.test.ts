import { afterEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { waitForSessionInputResult } from './sendSessionMessage';
import { configuration } from '@/configuration';

afterEach(() => vi.restoreAllMocks());

it('reads settled exact input evidence once even when resolving transport passes the observation deadline', async () => {
  const sessionId = 'c' + 'a'.repeat(24);
  const localId = 'input-1';
  let currentTime = 100;
  vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
  const input = { id: 'input-row', seq: 7, localId, createdAt: 1, updatedAt: 1,
    content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'Work' } } } };
  const lifecycle = (type: string) => ({ role: 'agent', content: { type: 'acp', data: { type, id: 'turn-1' } } });
  // HTTP and clock are system boundaries; resolution and transcript classification stay real.
  const get = vi.spyOn(axios, 'get').mockImplementation(async (url) => {
    if (url.endsWith('/v1/account/encryption/currentness')) {
      currentTime = 200;
      return { status: 200, data: { mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null,
        updatedAt: 1, recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' } } };
    }
    if (url.includes('/messages/by-local-id/')) return { status: 200, data: { message: input } };
    if (url.includes('/messages?')) return { status: 200, data: { messages: [input,
      ...[lifecycle('task_started'), { role: 'agent', content: { type: 'acp', agentId: 'codex', data: { type: 'text', text: 'Done' } } }, lifecycle('task_complete')]
        .map((value, ordinal) => ({ id: `result-${ordinal}`, localId: null, seq: 8 + ordinal, createdAt: 2,
          content: { t: 'plain', v: value } })),
    ] } };
    if (url.endsWith('/pending')) return { status: 200, data: { pending: [] } };
    if (url.includes(`/v2/sessions/${sessionId}`)) return { status: 200, data: { session:
      createSessionRecordFixture({ id: sessionId, encryptionMode: 'plain', metadata: '{}', active: true }) } };
    throw new Error(`unexpected_http_read:${url}`);
  });
  const result = await waitForSessionInputResult({ credentials: { token: 'token', encryption: null }, idOrPrefix: sessionId, localId,
    observation: { kind: 'absolute_deadline', deadlineMs: 100 } });
  expect(get.mock.calls.map(([url]) => url)).toContainEqual(expect.stringContaining('/messages/by-local-id/'));
  const nativeRead = get.mock.calls.find(([url]) => url.includes('/messages/by-local-id/'));
  expect(nativeRead?.[1]?.timeout).toBe(configuration.transcriptLookupRequestTimeoutMs);
  expect(result)
    .toMatchObject({ ok: true, sessionId, localId, result: { kind: 'final_text', text: 'Done' } });
});
