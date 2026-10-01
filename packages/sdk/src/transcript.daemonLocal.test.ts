import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';

import { connect } from './index.js';

describe('public transcript following at a daemon-local Action endpoint', () => {
  it('reads the transcript without waiting for a Home viewer socket', async () => {
    // A daemon-local HTTP listener serves Actions, not the Home viewer socket.
    // This is the actual network boundary; SDK follower/transport logic stays real.
    let followReads = 0;
    const server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://fixture').pathname;
      response.setHeader('content-type', 'application/json');
      if (!path.startsWith('/v1/actions/')) {
        response.writeHead(404).end('{}');
        return;
      }
      for await (const _chunk of request) { /* Drain the finite Action input. */ }
      const actionId = decodeURIComponent(path.slice('/v1/actions/'.length));
      if (actionId === 'transcript.follow') followReads++;
      const result = actionId === 'transcript.follow'
        ? { items: [{ id: '1', seq: 1, text: 'daemon transcript' }], nextCursor: '1', truncated: false }
        : { ok: true, released: true };
      response.end(JSON.stringify({ v: 1, actionId, execution: { ok: true, result } }));
    });
    server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener address');
    const client = connect({
      endpoint: `http://127.0.0.1:${address.port}`,
      token: 'hap_v1_123e4567-e89b-42d3-a456-426614174000_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const iterator = client.sessions.get('session-1').followTranscript({ cursor: '0' })[Symbol.asyncIterator]();
    const next = iterator.next();
    void next.catch(() => undefined);
    try {
      await expect.poll(() => followReads).toBe(1);
      await expect(next).resolves.toMatchObject({ done: false, value: { id: '1', text: 'daemon transcript' } });
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
