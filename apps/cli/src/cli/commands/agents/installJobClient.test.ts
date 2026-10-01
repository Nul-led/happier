import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { waitForLocalAgentInstallJob } from './installJobClient';

describe('local install job execution', () => {
  let server: Server;
  let target: { pid: number; httpPort: number; controlToken: string };
  let requests: Array<{ path: string; body: unknown; token: string | undefined }>;
  let cancelOnRead: boolean;
  let cancelled: boolean;
  let successWinsCancellation: boolean;
  let invalidRead: boolean;
  let cancelOnStart: boolean;

  beforeEach(async () => {
    requests = [];
    cancelOnRead = false;
    cancelled = false;
    successWinsCancellation = false;
    invalidRead = false;
    cancelOnStart = false;
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { cursor?: number };
      requests.push({ path: request.url ?? '', body, token: request.headers['x-happier-daemon-token'] as string | undefined });
      response.setHeader('content-type', 'application/json');
      if (request.url?.endsWith('/start')) {
        if (cancelOnStart) process.emit('SIGINT');
        response.end(JSON.stringify({ ok: true, jobId: 'job-1' }));
      } else if (request.url?.endsWith('/cancel')) {
        cancelled = true;
        response.end(JSON.stringify({ ok: true }));
      } else if (invalidRead) {
        response.end(JSON.stringify({ ok: true, events: [], steps: [], progress: [], nextCursor: -1, done: true, outcome: { kind: 'succeeded', version: '1.2.3' } }));
      } else if (body.cursor === 0 && !cancelled) {
        if (cancelOnRead) process.emit('SIGINT');
        response.end(JSON.stringify({ ok: true, events: [{ t: 'step', stepId: 'download', label: 'Downloading', state: 'running' }], steps: [{ stepId: 'download', label: 'Downloading', state: 'running' }], progress: [], nextCursor: 1, done: false, outcome: null }));
      } else {
        response.end(JSON.stringify({ ok: true, events: [], steps: [{ stepId: 'download', label: 'Downloading', state: cancelled && !successWinsCancellation ? 'failed' : 'done' }], progress: [], nextCursor: 1, done: true, outcome: cancelled && !successWinsCancellation
          ? { kind: 'failed', code: 'cancelled', stepId: 'download', message: 'Cancelled' }
          : { kind: 'succeeded', version: '1.2.3' } }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    target = { pid: process.pid, httpPort: address.port, controlToken: 'test-token' };
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('authenticates and follows the event cursor to the daemon outcome', async () => {
    const events: unknown[] = [];
    const result = await waitForLocalAgentInstallJob({ request: { agentId: 'codex', intent: 'update', consent: { vendorRecipe: false } }, target, onEvent: (event) => events.push(event) });
    expect(result).toEqual({ ok: true, jobId: 'job-1', outcome: { kind: 'succeeded', version: '1.2.3' } });
    expect(events).toEqual([{ t: 'step', stepId: 'download', label: 'Downloading', state: 'running' }]);
    expect(requests).toEqual([
      { path: '/agents/install/start', body: { agentId: 'codex', intent: 'update', consent: { vendorRecipe: false } }, token: 'test-token' },
      { path: '/agents/install/read', body: { jobId: 'job-1', cursor: 0 }, token: 'test-token' },
      { path: '/agents/install/read', body: { jobId: 'job-1', cursor: 1 }, token: 'test-token' },
    ]);
  });

  it('cancels on SIGINT but waits for the authoritative terminal outcome and removes listeners', async () => {
    cancelOnRead = true;
    const listeners = process.listenerCount('SIGINT');
    const result = await waitForLocalAgentInstallJob({ request: { agentId: 'codex', intent: 'install', consent: { vendorRecipe: false } }, target });
    expect(result).toMatchObject({ ok: true, jobId: 'job-1', outcome: { kind: 'failed', code: 'cancelled' } });
    expect(requests.filter((request) => request.path.endsWith('/cancel'))).toHaveLength(1);
    expect(requests.at(-1)?.path).toBe('/agents/install/read');
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  });

  it('preserves success when completion wins a cancellation race', async () => {
    cancelOnRead = true;
    successWinsCancellation = true;
    const result = await waitForLocalAgentInstallJob({ request: { agentId: 'codex', intent: 'install', consent: { vendorRecipe: false } }, target });
    expect(result).toEqual({ ok: true, jobId: 'job-1', outcome: { kind: 'succeeded', version: '1.2.3' } });
    expect(cancelled).toBe(true);
  });

  it('retains the accepted job identity when interrupted during start', async () => {
    cancelOnStart = true;
    const result = await waitForLocalAgentInstallJob({ request: { agentId: 'codex', intent: 'install', consent: { vendorRecipe: false } }, target });
    expect(result).toMatchObject({ ok: true, jobId: 'job-1', outcome: { kind: 'failed', code: 'cancelled' } });
    expect(requests.map((request) => request.path)).toEqual(['/agents/install/start', '/agents/install/cancel', '/agents/install/read']);
  });

  it('rejects malformed daemon event cursors instead of reporting success', async () => {
    invalidRead = true;
    const result = await waitForLocalAgentInstallJob({ request: { agentId: 'codex', intent: 'install', consent: { vendorRecipe: false } }, target });
    expect(result).toMatchObject({ ok: false, errorCode: 'invalid_daemon_response' });
  });
});
