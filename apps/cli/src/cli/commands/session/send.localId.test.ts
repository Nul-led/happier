import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';

describe('session send caller identity through the real command and HTTP transport', () => {
  it('reconciles an exact terminal identity and refuses a corrupted proof', async () => {
    let corruptProof = false;
    const sessionId = 'c123456789012345678901234';
    const localIds = [" board-wake'42 ", "-claim-1", "--claim-1", "--json", "--"];
    // The relay fixture has one existing terminal transcript row per identity. Only
    // network/account state is substituted; CLI, ActionExecutor, send service,
    // encryption selection, HTTP client, and terminal-proof parser are real.
    const transcript = new Map(localIds.map((localId, index) => [localId, {
      id: `msg-${index + 1}`, seq: index + 1, localId, requestedAction: { v: 1, kind: 'steer_if_active' },
    }]));
    const server = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      const path = request.url?.split('?')[0];
      if (path === `/v2/sessions/${sessionId}`) {
        response.end(JSON.stringify({ session: {
          id: sessionId, seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
          encryptionMode: 'plain', metadata: '{}', metadataVersion: 1,
          agentState: null, agentStateVersion: 0, dataEncryptionKey: null,
        } }));
        return;
      }
      if (path === '/v1/account/encryption/currentness') {
        response.end(JSON.stringify({ mode: 'plain', version: 1,
          signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 }));
        return;
      }
      if (path === '/v2/account/settings') {
        response.end(JSON.stringify({ version: 1, content: { t: 'plain', v: {} } }));
        return;
      }
      if (request.method === 'POST' && path === `/v2/sessions/${sessionId}/pending`) {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { localId: string };
        const row = transcript.get(body.localId);
        if (!row) {
          response.statusCode = 409;
          response.end(JSON.stringify({ error: 'identity_mismatch' }));
          return;
        }
        response.end(JSON.stringify({ didWrite: false, terminal: true,
          message: { ...row, localId: corruptProof ? `${row.localId}:changed` : row.localId } }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'unexpected_fixture_route', path }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubEnv('HAPPIER_SERVER_URL', url);
    vi.stubEnv('HAPPIER_LOCAL_SERVER_URL', url);
    vi.stubEnv('HAPPIER_PUBLIC_SERVER_URL', url);
    vi.stubEnv('HAPPIER_SESSION_ID', '');
    try {
      const { cmdSessionSend } = await import('./send');
      const credentials = { token: 'fixture_token',
        encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(7) } };
      for (const localId of localIds) {
        const localIdArgs = ['--json', '--'].includes(localId)
          ? [`--local-id=${localId}`]
          : ['--local-id', localId];
        for (const corrupt of [false, true]) {
          corruptProof = corrupt;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const output = captureConsoleJsonOutput();
            try {
              await cmdSessionSend(['send', sessionId, 'Hello', ...localIdArgs, '--json'], {
                readCredentialsFn: async () => credentials,
              });
              const result = output.json();
              expect(result, JSON.stringify(result)).toMatchObject(corruptProof
                ? { ok: false, kind: 'session_send', error: { code: 'timeout' } }
                : { ok: true, kind: 'session_send', data: { sessionId, localId, waited: false } });
            } finally { output.restore(); }
          }
        }
      }
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
