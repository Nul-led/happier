import { EventEmitter } from 'node:events';
import { createSocketTransportAdapter } from '@happier-dev/sync-client';
import axios from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import { archiveSessionOnceInactive } from './archiveSessionOnceInactive';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';

const boundary = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/api/session/sockets', () => ({
  createSessionScopedSocket: boundary.create,
  createSessionScopedSocketConnection: () => {
    const socket = boundary.create();
    return { socket, transport: createSocketTransportAdapter(socket) };
  },
}));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('retries archive on an inactive event after parking without reads or writes', async () => {
  vi.useFakeTimers();
  const socket = Object.assign(new EventEmitter(), { connected: false, connect: vi.fn(), disconnect: vi.fn(), close: vi.fn() });
  boundary.create.mockReturnValue(socket);
  const sessionId = 'c' + 'd'.repeat(24);
  let active = true;
  const get = vi.spyOn(axios, 'get').mockImplementation(async () => ({ status: 200, data: { session:
    createSessionRecordFixture({ id: sessionId, active, encryptionMode: 'plain', metadata: '{}' }) } }));
  const post = vi.spyOn(axios, 'post').mockImplementation(async () => active
    ? { status: 409, data: { error: 'session_active' } }
    : { status: 200, data: { success: true, archivedAt: 123 } });
  const result = archiveSessionOnceInactive({ token: 'token', sessionId, timeoutMs: 5_000 });
  await vi.advanceTimersByTimeAsync(0);
  const reads = get.mock.calls.length;
  const writes = post.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(get.mock.calls).toHaveLength(reads);
  expect(post.mock.calls).toHaveLength(writes);
  active = false;
  socket.emit('connect');
  await vi.advanceTimersByTimeAsync(0);
  await expect(result).resolves.toEqual({ archivedAt: 123 });
  expect(socket.eventNames()).toEqual([]);
});
