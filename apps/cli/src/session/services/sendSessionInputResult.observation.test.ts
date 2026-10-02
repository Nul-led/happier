import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createSocketTransportAdapter } from '@happier-dev/sync-client';
import axios from 'axios';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { waitForSessionInputResult } from './sendSessionMessage';
import { configuration } from '@/configuration';
import { openSessionEventSource } from '@/session/transport/socket/sessionSocketAgentState';

const socketBoundary = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/api/session/sockets', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/session/sockets')>(),
  createSessionScopedSocket: socketBoundary.create,
  createSessionScopedSocketConnection: () => {
    const socket = socketBoundary.create();
    return { socket, transport: createSocketTransportAdapter(socket) };
  },
}));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('keeps the containing deadline authoritative when a change races a parked read', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100);
  const socket = Object.assign(new EventEmitter(), {
    connected: false, connect: vi.fn(), disconnect: vi.fn(), close: vi.fn(),
  });
  socketBoundary.create.mockReturnValue(socket);
  const events = openSessionEventSource({ token: 'token', sessionId: 'session-1' });
  const revision = events.currentRevision();
  socket.emit('connect');
  try {
    await expect(events.waitForChange(revision, { deadlineMs: 100 })).resolves.toBe(false);
  } finally {
    await events.close();
  }
});

it.each(['materialization', 'completion'] as const)('parks exact input %s and catches completion missed while disconnected', async (phase) => {
  vi.useFakeTimers();
  const socket = Object.assign(new EventEmitter(), { connected: false, connect: vi.fn(), disconnect: vi.fn(), close: vi.fn() });
  socket.connect.mockImplementation(() => { socket.connected = true; socket.emit('connect'); });
  socket.disconnect.mockImplementation(() => { socket.connected = false; });
  socketBoundary.create.mockReturnValue(socket);
  const sessionId = 'c' + 'b'.repeat(24);
  const localId = 'input-event-1';
  const input = { id: 'input', seq: 7, localId, createdAt: 1, updatedAt: 1,
    content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: 'Work' } } } };
  let completed = false;
  let materialized = phase === 'completion';
  const reads: string[] = [];
  vi.spyOn(axios, 'get').mockImplementation(async (url) => {
    reads.push(url);
    if (url.endsWith('/v1/account/encryption/currentness')) return { status: 200, data: {
      mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1,
      recipientEnvelopeReadiness: { status: 'unavailable', reason: 'plain_account' } } };
    if (url.includes('/messages/by-local-id/')) {
      if (!materialized) throw Object.assign(new Error('Message not found'), {
        isAxiosError: true, response: { status: 404, data: { error: 'Message not found' } },
      });
      return { status: 200, data: { message: input } };
    }
    if (url.includes('/messages?')) return { status: 200, data: { messages: completed ? [input,
      { id: 'text', seq: 8, localId: null, createdAt: 2, content: { t: 'plain', v: { role: 'agent', content: {
        type: 'acp', agentId: 'codex', data: { type: 'text', text: 'Done after reconnect' } } } } },
      { id: 'done', seq: 9, localId: null, createdAt: 2, content: { t: 'plain', v: { role: 'agent', content: {
        type: 'acp', data: { type: 'task_complete', id: 'turn-1' } } } } },
    ] : [input] } };
    if (url.endsWith('/pending')) return { status: 200, data: { pending: [] } };
    if (url.includes(`/v2/sessions/${sessionId}`)) return { status: 200, data: { session:
      createSessionRecordFixture({ id: sessionId, encryptionMode: 'plain', metadata: '{}', active: true }) } };
    throw new Error(`unexpected_http_read:${url}`);
  });
  const result = waitForSessionInputResult({ credentials: { token: 'token', encryption: null },
    idOrPrefix: sessionId, localId, timeoutMs: 10_000 });
  await vi.advanceTimersByTimeAsync(0);
  const baselineReads = reads.length;
  // Provisional stream deltas do not change retained exact-input/turn evidence.
  socket.emit('ephemeral', { type: 'transcript-stream-segment-delta', sessionId,
    message: { localId: 'live-segment', tick: 1, baseLength: 0, createdAt: 1, updatedAt: 1,
      content: { t: 'plain', v: { role: 'agent', content: { type: 'text', text: 'Still working' } } } } });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(reads).toHaveLength(baselineReads);
  socket.emit('disconnect', 'transport close');
  completed = true;
  materialized = true;
  await vi.advanceTimersByTimeAsync(500);
  await expect(result).resolves.toMatchObject({ ok: true, localId,
    result: { kind: 'final_text', text: 'Done after reconnect' } });
  expect(socket.eventNames()).toEqual([]);
  expect(socket.connected).toBe(false);
});

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
