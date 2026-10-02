import { beforeEach, expect, it, vi } from 'vitest';

import { sendSessionMessage } from './sendSessionMessage';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
// HTTP and Machine RPC are external boundaries; admission and resume logic stay real.
vi.mock('axios', () => ({ default: http }));
vi.mock('@/configuration', () => ({ configuration: {
  serverUrl: 'https://home.example', apiServerUrl: 'https://home.example', sessionControlHttpTimeoutMs: 1000,
  clientEncryptionRequirement: 'follow_account',
} }));

const sessionId = 'c123456789012345678901234';

beforeEach(() => {
  http.get.mockReset();
  http.post.mockReset();
  http.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/v1/account/encryption/currentness')) return { status: 200, data: {
      mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1,
    } };
    if (url.endsWith(`/v2/sessions/${sessionId}`)) return { status: 200, data: { session: {
      id: sessionId, seq: 1, createdAt: 1, updatedAt: 2, active: false, activeAt: 1, archivedAt: null,
      encryptionMode: 'plain', metadataVersion: 0, agentState: null, agentStateVersion: 0,
      pendingCount: 0, pendingVersion: 0, share: null, dataEncryptionKey: null,
      metadata: JSON.stringify({ machineId: 'machine-1', path: '/repo', claudeSessionId: 'native-1',
        runtimeDescriptorV1: { v: 1, agentId: 'claude', agent: {} } }),
    } } };
    throw new Error(`Unexpected HTTP request: ${url}`);
  });
  http.post.mockImplementation(async (url: string) => {
    if (url.endsWith(`/v2/sessions/${sessionId}/pending`)) return { status: 200, data: {
      didWrite: true, terminal: false, suppressed: false,
    } };
    throw new Error(`Unexpected HTTP request: ${url}`);
  });
});
it.each(['SESSION_DIRECTORY_MISSING', 'SPAWN_FAILED'])('maps the Machine resume refusal %s to resume_failed while retaining accepted input', async (errorCode) => {
  const machineResumeTransport = vi.fn(async () => ({ type: 'error', errorCode, errorMessage: 'Machine could not resume' }));
  await expect(sendSessionMessage({
    credentials: { token: 'account-token', encryption: null }, idOrPrefix: sessionId,
    message: 'continue', localId: 'resume-refusal-input', wait: false, timeoutMs: 1000,
    machineResumeTransport,
  })).resolves.toMatchObject({
    ok: false, code: 'resume_failed', message: 'Machine could not resume',
    admissionResult: { status: 'accepted', localId: 'resume-refusal-input' },
  });
  expect(machineResumeTransport).toHaveBeenCalledOnce();
});
